/* ════════════════════════════════════════════════════════
   anchor.js — Visual Feature Anchor System (ARKit-like)
   
   Each placed point captures a visual "fingerprint" (template)
   from the video feed. Every frame, template matching finds
   where that surface patch moved to — keeping points locked
   to the real-world surface even as the camera moves.
   
   Combines:
   1. Per-point template matching (primary)
   2. Gyroscope/device motion (fast motion assist)
   3. Object-anchor fallback (when visual match fails)
   ════════════════════════════════════════════════════════ */

const Anchor = (() => {
  let videoEl = null;
  let trackCanvas = null;
  let trackCtx = null;
  let frameGray = null;  // full-frame grayscale cache
  let frameW = 0, frameH = 0;
  let gyroReady = false;
  let lastAlpha = null, lastBeta = null, lastGamma = null;
  let gyroDx = 0, gyroDy = 0;

  const points = [];   // [{ vx, vy, template, tw, th, confidence, age }]

  const TMPL  = 20;    // template size (20x20 px)
  const SEARCH = 30;   // search radius around last position
  const ADAPT = 0.25;  // template adaptation rate (blend new into old)
  const SAD_THRESH = 35; // max SAD per compared pixel to accept match

  function init(video) {
    videoEl = video;
    trackCanvas = document.createElement('canvas');
    trackCtx = trackCanvas.getContext('2d', { willReadFrequently: true });
    requestGyro();
  }

  /* ── Gyroscope ── */
  function requestGyro() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ requires permission
      // We'll request on first manual mode tap
    }
    window.addEventListener('deviceorientation', onOrientation, true);
  }

  function requestGyroPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(state => { if (state === 'granted') gyroReady = true; })
        .catch(() => {});
    } else {
      gyroReady = true;
    }
  }

  function onOrientation(e) {
    if (!gyroReady) return;
    const a = e.alpha, b = e.beta, g = e.gamma;
    if (a == null || b == null || g == null) return;

    if (lastAlpha !== null) {
      // Convert rotation delta to approximate pixel shift
      // ~5px per degree is a rough estimate for typical phone FOV
      let da = a - lastAlpha;
      let db = b - lastBeta;
      let dg = g - lastGamma;
      // Wrap alpha
      if (da > 180) da -= 360;
      if (da < -180) da += 360;

      // Horizontal pan ≈ gamma change, vertical ≈ beta change
      gyroDx += dg * 3.5;
      gyroDy += db * 3.5;
    }
    lastAlpha = a; lastBeta = b; lastGamma = g;
  }

  /* ── Grab full-frame grayscale from video ── */
  function captureFrame() {
    if (!videoEl || videoEl.readyState < 2) return false;
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (vw === 0 || vh === 0) return false;

    // Downscale for performance (half res)
    const scale = vw > 640 ? 0.5 : 1;
    frameW = Math.round(vw * scale);
    frameH = Math.round(vh * scale);
    trackCanvas.width = frameW;
    trackCanvas.height = frameH;
    trackCtx.drawImage(videoEl, 0, 0, frameW, frameH);

    const imgData = trackCtx.getImageData(0, 0, frameW, frameH);
    const d = imgData.data;
    frameGray = new Uint8Array(frameW * frameH);
    for (let i = 0, len = frameGray.length; i < len; i++) {
      const j = i << 2;
      frameGray[i] = (d[j] * 77 + d[j+1] * 150 + d[j+2] * 29) >> 8;
    }
    return true;
  }

  /* ── Extract grayscale patch from cached frame ── */
  function extractPatch(cx, cy, size) {
    const half = size >> 1;
    const x0 = Math.max(0, Math.round(cx - half));
    const y0 = Math.max(0, Math.round(cy - half));
    const x1 = Math.min(frameW, x0 + size);
    const y1 = Math.min(frameH, y0 + size);
    const pw = x1 - x0, ph = y1 - y0;
    if (pw < 4 || ph < 4) return null;

    const patch = new Uint8Array(pw * ph);
    for (let r = 0; r < ph; r++) {
      for (let c = 0; c < pw; c++) {
        patch[r * pw + c] = frameGray[(y0 + r) * frameW + (x0 + c)];
      }
    }
    return { data: patch, w: pw, h: ph };
  }

  /* ── Place a new anchor point ── */
  function placePoint(vx, vy) {
    // Convert to tracking frame coords
    const vw = videoEl.videoWidth || 1;
    const vh = videoEl.videoHeight || 1;
    const scale = vw > 640 ? 0.5 : 1;
    const tx = vx * scale, ty = vy * scale;

    captureFrame();
    const tmpl = extractPatch(tx, ty, TMPL);

    points.push({
      vx, vy,           // full-res video coords
      tx, ty,           // tracking-res coords
      template: tmpl ? tmpl.data : null,
      tw: tmpl ? tmpl.w : 0,
      th: tmpl ? tmpl.h : 0,
      confidence: 1.0,
      age: 0,
    });
    return points.length - 1;
  }

  /* ── SAD template matching ── */
  function matchTemplate(tmpl, tw, th, searchX, searchY, searchW, searchH) {
    let bestSAD = Infinity, bestX = 0, bestY = 0;
    const maxX = searchW - tw;
    const maxY = searchH - th;
    if (maxX < 0 || maxY < 0) return null;

    // Coarse pass (step=2)
    for (let sy = 0; sy <= maxY; sy += 2) {
      for (let sx = 0; sx <= maxX; sx += 2) {
        let sad = 0;
        for (let py = 0; py < th; py += 2) {
          const fRow = (searchY + sy + py) * frameW + searchX + sx;
          const tRow = py * tw;
          for (let px = 0; px < tw; px += 2) {
            sad += Math.abs(frameGray[fRow + px] - tmpl[tRow + px]);
          }
          if (sad >= bestSAD) break;
        }
        if (sad < bestSAD) { bestSAD = sad; bestX = sx; bestY = sy; }
      }
    }

    // Fine pass around best coarse match (step=1, ±2px)
    const fx0 = Math.max(0, bestX - 2);
    const fy0 = Math.max(0, bestY - 2);
    const fx1 = Math.min(maxX, bestX + 2);
    const fy1 = Math.min(maxY, bestY + 2);

    for (let sy = fy0; sy <= fy1; sy++) {
      for (let sx = fx0; sx <= fx1; sx++) {
        let sad = 0;
        for (let py = 0; py < th; py++) {
          const fRow = (searchY + sy + py) * frameW + searchX + sx;
          const tRow = py * tw;
          for (let px = 0; px < tw; px++) {
            sad += Math.abs(frameGray[fRow + px] - tmpl[tRow + px]);
          }
          if (sad >= bestSAD) break;
        }
        if (sad < bestSAD) { bestSAD = sad; bestX = sx; bestY = sy; }
      }
    }

    const comparedPixels = (tw >> 1) * (th >> 1) || 1;
    const sadPerPixel = bestSAD / comparedPixels;

    return { x: bestX, y: bestY, sad: bestSAD, sadPP: sadPerPixel };
  }

  /* ── Update all point positions via visual tracking ── */
  function updateAll() {
    if (points.length === 0) { gyroDx = 0; gyroDy = 0; return; }
    if (!captureFrame()) { gyroDx = 0; gyroDy = 0; return; }

    const vw = videoEl.videoWidth || 1;
    const scale = vw > 640 ? 0.5 : 1;

    for (const pt of points) {
      if (!pt.template || pt.tw === 0) { pt.age++; continue; }

      // Apply gyro hint to search center
      let searchCx = pt.tx + gyroDx * scale;
      let searchCy = pt.ty + gyroDy * scale;

      const sr = SEARCH;
      const sx = Math.max(0, Math.round(searchCx - sr));
      const sy = Math.max(0, Math.round(searchCy - sr));
      const sw = Math.min(frameW - sx, sr * 2 + pt.tw);
      const sh = Math.min(frameH - sy, sr * 2 + pt.th);

      if (sw <= pt.tw || sh <= pt.th) { pt.age++; continue; }

      const match = matchTemplate(pt.template, pt.tw, pt.th, sx, sy, sw, sh);
      if (!match) { pt.age++; continue; }

      const newTx = sx + match.x + pt.tw / 2;
      const newTy = sy + match.y + pt.th / 2;

      // Accept match if SAD is low enough
      if (match.sadPP < SAD_THRESH) {
        pt.tx = newTx;
        pt.ty = newTy;
        pt.vx = newTx / scale;
        pt.vy = newTy / scale;
        pt.confidence = Math.max(0, 1 - match.sadPP / SAD_THRESH);
        pt.age++;

        // Adaptive template update (blend old + new)
        if (pt.age > 3) {
          const newPatch = extractPatch(newTx, newTy, TMPL);
          if (newPatch && newPatch.w === pt.tw && newPatch.h === pt.th) {
            const tmpl = pt.template;
            const fresh = newPatch.data;
            for (let i = 0; i < tmpl.length; i++) {
              tmpl[i] = Math.round(tmpl[i] * (1 - ADAPT) + fresh[i] * ADAPT);
            }
          }
        }
      } else {
        pt.confidence = Math.max(0, pt.confidence - 0.1);
      }
    }

    // Reset gyro accumulator
    gyroDx = 0;
    gyroDy = 0;
  }

  /* ── Get points in full video coords ── */
  function getPoints() {
    return points.map(p => ({ vx: p.vx, vy: p.vy, confidence: p.confidence }));
  }

  function clear() {
    points.length = 0;
    gyroDx = 0; gyroDy = 0;
    lastAlpha = null; lastBeta = null; lastGamma = null;
  }

  function undoLast() {
    if (points.length > 0) points.pop();
  }

  function count() { return points.length; }

  return { init, placePoint, updateAll, getPoints, clear, undoLast, count, requestGyroPermission };
})();
