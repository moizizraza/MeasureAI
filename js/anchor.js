/**
 * anchor.js — Lucas-Kanade Optical Flow Tracker
 *
 * Features:
 *  - LK Optical Flow (iterative, image pyramid, 3 levels, scale 0.5x)
 *  - 11x11 tracking window (half=5), 3 iterations per pyramid level
 *  - Gyroscope assist via deviceorientation
 *  - Shi-Tomasi quality score (min eigenvalue of gradient matrix)
 *  - Adaptive template refresh only when quality is high
 *  - Working resolution: 160x120 grayscale
 *  - Pure JS TypedArrays, no external libraries
 */

const Anchor = (() => {
  // ── Constants ────────────────────────────────────────────────────────────────
  const WORK_W = 160;
  const WORK_H = 120;
  const PYRAMID_LEVELS = 3;
  const PYRAMID_SCALE  = 0.5;
  const LK_HALF        = 5;          // 11x11 window
  const LK_ITERS       = 3;
  const DET_THRESH     = 1e-4;
  const CONFIDENCE_MAX = 500;        // eigenvalue clamped at this → 1.0
  const REFRESH_THRESH = 0.6;        // min confidence to refresh template

  // ── State ─────────────────────────────────────────────────────────────────
  let videoEl   = null;
  let offCanvas = null;   // offscreen canvas for frame capture
  let offCtx    = null;

  // Grayscale pyramids: arrays of Float32Array, index 0 = full working res
  let prevPyramid = [];
  let currPyramid = [];

  // Point list: stored in working-res coords
  // Each: { wx, wy, confidence, templatePyramid: [] }
  let points = [];

  // Gyro accumulators (in full-video-res pixels, converted on use)
  let gyroDX = 0;
  let gyroDY = 0;
  let gyroActive = false;

  // Scale factor: working-res / full-video-res
  let scaleX = 1;
  let scaleY = 1;

  // ── Utility: bilinear sample ───────────────────────────────────────────────
  function bilinear(gray, W, H, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const cx0 = Math.max(0, Math.min(W - 1, x0));
    const cy0 = Math.max(0, Math.min(H - 1, y0));
    const cx1 = Math.max(0, Math.min(W - 1, x1));
    const cy1 = Math.max(0, Math.min(H - 1, y1));
    const fx = x - x0;
    const fy = y - y0;
    return (
      gray[cy0 * W + cx0] * (1 - fx) * (1 - fy) +
      gray[cy0 * W + cx1] *      fx  * (1 - fy) +
      gray[cy1 * W + cx0] * (1 - fx) *      fy  +
      gray[cy1 * W + cx1] *      fx  *      fy
    );
  }

  // ── Utility: clamp ────────────────────────────────────────────────────────
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // ── Build grayscale image from ImageData into Float32Array ────────────────
  function imageDataToGray(imageData, W, H) {
    const gray = new Float32Array(W * H);
    const d = imageData.data;
    for (let i = 0; i < W * H; i++) {
      const p = i * 4;
      gray[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    }
    return gray;
  }

  // ── Downsample a grayscale image by 0.5x (simple 2x2 box filter) ─────────
  function downsample(gray, W, H) {
    const nW = Math.max(1, Math.floor(W * PYRAMID_SCALE));
    const nH = Math.max(1, Math.floor(H * PYRAMID_SCALE));
    const out = new Float32Array(nW * nH);
    for (let y = 0; y < nH; y++) {
      for (let x = 0; x < nW; x++) {
        const sx = x * 2;
        const sy = y * 2;
        const sx1 = Math.min(sx + 1, W - 1);
        const sy1 = Math.min(sy + 1, H - 1);
        out[y * nW + x] = (
          gray[sy  * W + sx ] +
          gray[sy  * W + sx1] +
          gray[sy1 * W + sx ] +
          gray[sy1 * W + sx1]
        ) * 0.25;
      }
    }
    return { gray: out, W: nW, H: nH };
  }

  // ── Build pyramid from base gray ──────────────────────────────────────────
  function buildPyramid(baseGray, baseW, baseH) {
    const pyr = [{ gray: baseGray, W: baseW, H: baseH }];
    for (let l = 1; l < PYRAMID_LEVELS; l++) {
      const prev = pyr[l - 1];
      pyr.push(downsample(prev.gray, prev.W, prev.H));
    }
    return pyr;
  }

  // ── Capture current video frame into working-res grayscale ────────────────
  function captureFrame() {
    if (!videoEl || videoEl.readyState < 2) return null;
    offCtx.drawImage(videoEl, 0, 0, WORK_W, WORK_H);
    const imageData = offCtx.getImageData(0, 0, WORK_W, WORK_H);
    return imageDataToGray(imageData, WORK_W, WORK_H);
  }

  // ── Shi-Tomasi: min eigenvalue of 2x2 symmetric matrix ───────────────────
  function minEigenvalue(m00, m01, m11) {
    // eigenvalues of [[m00,m01],[m01,m11]]
    const trace = m00 + m11;
    const det   = m00 * m11 - m01 * m01;
    const disc  = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
    return trace / 2 - disc;   // smaller eigenvalue
  }

  // ── Core LK tracker for one point at one pyramid level ───────────────────
  /**
   * @param {Float32Array} prevGray
   * @param {Float32Array} currGray
   * @param {number} W  width at this level
   * @param {number} H  height at this level
   * @param {number} px  point x at this level
   * @param {number} py  point y at this level
   * @param {number} initVX  initial velocity guess (from coarser level or gyro)
   * @param {number} initVY
   * @returns {{ vx, vy, quality }}
   */
  function trackPointAtLevel(prevGray, currGray, W, H, px, py, initVX, initVY) {
    const half = LK_HALF;
    let vx_acc = initVX;
    let vy_acc = initVY;
    let m00 = 0, m01 = 0, m11 = 0;   // will be reused from last iteration

    for (let iter = 0; iter < LK_ITERS; iter++) {
      m00 = 0; m01 = 0; m11 = 0;
      let b0 = 0, b1 = 0;

      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const ix = clamp(Math.round(px + dx), 1, W - 2);
          const iy = clamp(Math.round(py + dy), 1, H - 2);

          const Ix = (prevGray[iy * W + (ix + 1)] - prevGray[iy * W + (ix - 1)]) * 0.5;
          const Iy = (prevGray[(iy + 1) * W + ix] - prevGray[(iy - 1) * W + ix]) * 0.5;

          const cx = px + dx + vx_acc;
          const cy = py + dy + vy_acc;
          const It = bilinear(currGray, W, H, cx, cy) - prevGray[iy * W + ix];

          m00 += Ix * Ix;
          m01 += Ix * Iy;
          m11 += Iy * Iy;
          b0  -= Ix * It;
          b1  -= Iy * It;
        }
      }

      const det = m00 * m11 - m01 * m01;
      if (Math.abs(det) < DET_THRESH) break;   // low texture

      const dvx = (m11 * b0 - m01 * b1) / det;
      const dvy = (m00 * b1 - m01 * b0) / det;
      vx_acc += dvx;
      vy_acc += dvy;
    }

    const quality = minEigenvalue(m00, m01, m11);
    return { vx: vx_acc, vy: vy_acc, quality };
  }

  // ── Run full pyramid LK for one point ────────────────────────────────────
  /**
   * @param {Array} prevPyr   Array of {gray, W, H}
   * @param {Array} currPyr   Array of {gray, W, H}
   * @param {number} wx  working-res x
   * @param {number} wy  working-res y
   * @param {number} gyroWX  gyro-predicted delta in working-res
   * @param {number} gyroWY
   * @returns {{ newWX, newWY, confidence }}
   */
  function trackPointPyramid(prevPyr, currPyr, wx, wy, gyroWX, gyroWY) {
    const L = PYRAMID_LEVELS - 1;   // coarsest level index

    // Scale point down to coarsest level
    const levelScale = Math.pow(PYRAMID_SCALE, L);
    let px = wx * levelScale;
    let py = wy * levelScale;

    // Initial velocity guess: gyro at coarsest level
    let vx = gyroWX * levelScale;
    let vy = gyroWY * levelScale;

    let finalQuality = 0;

    // Coarse → fine
    for (let l = L; l >= 0; l--) {
      const { gray: pGray, W, H } = prevPyr[l];
      const { gray: cGray } = currPyr[l];

      const lScale = Math.pow(PYRAMID_SCALE, l);
      const plx = wx * lScale;
      const ply = wy * lScale;

      const result = trackPointAtLevel(pGray, cGray, W, H, plx, ply, vx, vy);
      vx = result.vx;
      vy = result.vy;
      finalQuality = result.quality;

      if (l > 0) {
        // Propagate velocity to next (finer) level — undo scale for next iteration
        vx /= PYRAMID_SCALE;
        vy /= PYRAMID_SCALE;
      }
    }

    // vx/vy are now in working-res pixels
    const newWX = wx + vx;
    const newWY = wy + vy;
    const confidence = Math.min(1, Math.max(0, finalQuality / CONFIDENCE_MAX));

    return { newWX, newWY, confidence };
  }

  // ── Gyroscope handling ────────────────────────────────────────────────────
  function onDeviceOrientation(evt) {
    // beta  = rotation around X (tilt front/back)  → vertical motion
    // gamma = rotation around Y (tilt left/right)  → horizontal motion
    // We accumulate small deltas (degrees → approximate pixel motion)
    // Rough mapping: 1 degree ≈ a few pixels at typical FoV;
    // use a gain factor tuned to 160px wide frame.
    const GYRO_GAIN = 0.5;   // pixels per degree at working resolution
    if (evt.gamma !== null) gyroDX += evt.gamma * GYRO_GAIN;
    if (evt.beta  !== null) gyroDY += evt.beta  * GYRO_GAIN;
  }

  // ── Public: requestGyroPermission ─────────────────────────────────────────
  async function requestGyroPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state === 'granted') {
          window.addEventListener('deviceorientation', onDeviceOrientation, true);
          gyroActive = true;
        }
      } catch (e) {
        console.warn('Anchor: gyro permission denied', e);
      }
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      window.addEventListener('deviceorientation', onDeviceOrientation, true);
      gyroActive = true;
    }
  }

  // ── Public: init ──────────────────────────────────────────────────────────
  function init(video) {
    videoEl = video;

    offCanvas = document.createElement('canvas');
    offCanvas.width  = WORK_W;
    offCanvas.height = WORK_H;
    offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

    // Capture initial frame to seed prevPyramid
    const baseGray = captureFrame();
    if (baseGray) {
      prevPyramid = buildPyramid(baseGray, WORK_W, WORK_H);
    } else {
      prevPyramid = buildPyramid(new Float32Array(WORK_W * WORK_H), WORK_W, WORK_H);
    }
    currPyramid = prevPyramid;

    points = [];
    gyroDX = 0;
    gyroDY = 0;
  }

  // ── Public: placePoint ────────────────────────────────────────────────────
  /**
   * Place a new tracking point.
   * @param {number} vx  x in full-video-resolution coords
   * @param {number} vy  y in full-video-resolution coords
   */
  function placePoint(vx, vy) {
    if (!videoEl) return;

    // Compute scale factors
    const vidW = videoEl.videoWidth  || 1;
    const vidH = videoEl.videoHeight || 1;
    scaleX = WORK_W / vidW;
    scaleY = WORK_H / vidH;

    const wx = vx * scaleX;
    const wy = vy * scaleY;

    // Build template pyramid from current frame
    const baseGray = captureFrame();
    const templatePyr = baseGray
      ? buildPyramid(baseGray, WORK_W, WORK_H)
      : buildPyramid(new Float32Array(WORK_W * WORK_H), WORK_W, WORK_H);

    points.push({ wx, wy, confidence: 1, templatePyramid: templatePyr });

    // Ensure prevPyramid is set
    if (baseGray && prevPyramid.length === 0) {
      prevPyramid = templatePyr;
    }
  }

  // ── Public: updateAll ─────────────────────────────────────────────────────
  /**
   * Capture a new frame, run LK on all points, update positions.
   * Call this once per animation frame.
   */
  function updateAll() {
    if (!videoEl || points.length === 0) return;

    // Capture current frame
    const baseGray = captureFrame();
    if (!baseGray) return;

    currPyramid = buildPyramid(baseGray, WORK_W, WORK_H);

    // Gyro delta in working-res pixels
    const gyroWX = gyroDX;   // already in working-res (gain applied in handler)
    const gyroWY = gyroDY;

    // Reset gyro accumulators after reading
    gyroDX = 0;
    gyroDY = 0;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];

      const { newWX, newWY, confidence } = trackPointPyramid(
        pt.templatePyramid,   // track relative to per-point template
        currPyramid,
        pt.wx,
        pt.wy,
        gyroWX,
        gyroWY
      );

      pt.wx = newWX;
      pt.wy = newWY;
      pt.confidence = confidence;

      // Adaptive template refresh: only when quality is high
      if (confidence >= REFRESH_THRESH) {
        pt.templatePyramid = currPyramid;   // shared ref is fine (immutable per frame)
      }
    }

    // Rotate pyramids for next call (currPyramid becomes prevPyramid)
    prevPyramid = currPyramid;
  }

  // ── Public: getPoints ─────────────────────────────────────────────────────
  /**
   * Returns tracked points in full-video-resolution coordinates.
   * @returns {Array<{vx: number, vy: number, confidence: number}>}
   */
  function getPoints() {
    if (!videoEl) return [];
    const vidW = videoEl.videoWidth  || 1;
    const vidH = videoEl.videoHeight || 1;
    const sX = WORK_W / vidW;
    const sY = WORK_H / vidH;

    return points.map(pt => ({
      vx: pt.wx / sX,
      vy: pt.wy / sY,
      confidence: pt.confidence
    }));
  }

  // ── Public: clear ─────────────────────────────────────────────────────────
  function clear() {
    points = [];
  }

  // ── Public: undoLast ──────────────────────────────────────────────────────
  function undoLast() {
    points.pop();
  }

  // ── Public: count ─────────────────────────────────────────────────────────
  function count() {
    return points.length;
  }

  // ── Exports ───────────────────────────────────────────────────────────────
  return {
    init,
    requestGyroPermission,
    placePoint,
    updateAll,
    getPoints,
    clear,
    undoLast,
    count
  };
})();
