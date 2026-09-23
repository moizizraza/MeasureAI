/* ════════════════════════════════════════════════════════
   detector.js — AI Precision Tracker
   
   IoU-based multi-object tracker that:
   1. Assigns stable unique IDs to each detected object
   2. Smooths bounding boxes with exponential moving average
   3. Carries objects through brief detection gaps (anti-flicker)
   4. Reports tracking age (frames tracked) per object
   ════════════════════════════════════════════════════════ */

const Detector = (() => {
  let model         = null;
  let isRunning     = false;
  let frameCallback = null;
  let animFrameId   = null;
  let confThreshold = 0.35;

  const videoEl = document.getElementById('video');

  // ── Tracker state ──
  let nextTrackId = 1;
  let tracks = [];  // { id, class, bbox, smoothBbox, score, age, missFrames }

  const SMOOTH_ALPHA = 0.35;   // EMA weight (lower = smoother, slower to react)
  const MAX_MISS     = 8;      // keep ghost for 8 frames (~0.3s at 25fps)
  const IOU_THRESH   = 0.25;   // minimum IoU to match detection to track

  /* ── IoU (Intersection over Union) ── */
  function iou(a, b) {
    const ax1 = a[0], ay1 = a[1], ax2 = a[0] + a[2], ay2 = a[1] + a[3];
    const bx1 = b[0], by1 = b[1], bx2 = b[0] + b[2], by2 = b[1] + b[3];
    const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
    const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
    const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    const areaA = a[2] * a[3], areaB = b[2] * b[3];
    return inter / (areaA + areaB - inter + 1e-6);
  }

  /* ── Smooth bbox with EMA ── */
  function smoothBbox(prev, curr) {
    const a = SMOOTH_ALPHA;
    return [
      prev[0] * (1 - a) + curr[0] * a,
      prev[1] * (1 - a) + curr[1] * a,
      prev[2] * (1 - a) + curr[2] * a,
      prev[3] * (1 - a) + curr[3] * a,
    ];
  }

  /* ── Match detections to existing tracks (Hungarian-lite greedy) ── */
  function updateTracks(rawPreds) {
    const unmatched = rawPreds.map((p, i) => i);
    const matchedTracks = new Set();

    // Score all (track, detection) pairs by IoU, take best greedily
    const pairs = [];
    for (const track of tracks) {
      for (let di = 0; di < rawPreds.length; di++) {
        if (rawPreds[di].class !== track.class) continue;
        const score = iou(track.bbox, rawPreds[di].bbox);
        if (score >= IOU_THRESH) {
          pairs.push({ track, di, score });
        }
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    const usedDetections = new Set();
    for (const pair of pairs) {
      if (matchedTracks.has(pair.track.id) || usedDetections.has(pair.di)) continue;

      const det = rawPreds[pair.di];
      pair.track.bbox = det.bbox;
      pair.track.smoothBbox = smoothBbox(pair.track.smoothBbox, det.bbox);
      pair.track.score = det.score;
      pair.track.age++;
      pair.track.missFrames = 0;

      matchedTracks.add(pair.track.id);
      usedDetections.add(pair.di);
    }

    // Increment miss counter for unmatched tracks
    for (const track of tracks) {
      if (!matchedTracks.has(track.id)) {
        track.missFrames++;
      }
    }

    // Remove dead tracks
    tracks = tracks.filter(t => t.missFrames <= MAX_MISS);

    // Create new tracks for unmatched detections
    for (let di = 0; di < rawPreds.length; di++) {
      if (usedDetections.has(di)) continue;
      const det = rawPreds[di];
      tracks.push({
        id:         nextTrackId++,
        class:      det.class,
        bbox:       det.bbox,
        smoothBbox: [...det.bbox],
        score:      det.score,
        age:        1,
        missFrames: 0,
      });
    }
  }

  /* ── Get tracked predictions (with smooth bboxes + track IDs) ── */
  function getTrackedPreds() {
    return tracks
      .filter(t => t.missFrames === 0)  // only actively detected
      .map(t => ({
        class:     t.class,
        bbox:      t.smoothBbox,  // use smoothed bbox for measurement
        rawBbox:   t.bbox,        // original raw bbox
        score:     t.score,
        trackId:   t.id,
        age:       t.age,         // frames tracked (higher = more stable)
      }));
  }

  // ── Model loading ──
  async function load(onProgress) {
    try {
      onProgress?.('Initializing WebGL engine…', 20);
      await tf.ready();
      console.log('[Detector] Backend:', tf.getBackend());

      onProgress?.('Loading vision model…', 50);
      try {
        model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      } catch (e) {
        console.warn('[Detector] Fallback to default model:', e);
        model = await cocoSsd.load();
      }
      console.log('[Detector] Model loaded ✓');
      onProgress?.('Vision engine ready!', 100);
      return model;
    } catch (err) {
      console.error('[Detector] Load failed:', err);
      throw err;
    }
  }

  // ── Detection + tracking ──
  async function detect() {
    if (!model || videoEl.readyState < 2 || videoEl.videoWidth === 0) {
      return getTrackedPreds();
    }

    try {
      const raw = await model.detect(videoEl, 20, confThreshold);
      updateTracks(raw);
      return getTrackedPreds();
    } catch (err) {
      console.warn('[Detector] Inference warning:', err.message);
      return getTrackedPreds();
    }
  }

  // ── Loop ──
  function startLoop(callback) {
    frameCallback = callback;
    isRunning = true;
    loop();
  }

  async function loop() {
    if (!isRunning) return;
    try {
      const preds = await detect();
      if (frameCallback && isRunning) frameCallback(preds);
    } catch (err) {
      console.error('[Detector] Loop error:', err);
    } finally {
      if (isRunning) animFrameId = requestAnimationFrame(loop);
    }
  }

  function pause() {
    isRunning = false;
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  }

  function resume() {
    if (!isRunning) { isRunning = true; loop(); }
  }

  function stopLoop() { pause(); }

  function resetTracks() {
    tracks = [];
    nextTrackId = 1;
  }

  function setConfThreshold(v) { confThreshold = Math.max(0.1, Math.min(0.95, v)); }
  function isReady() { return !!model; }

  return { load, detect, startLoop, stopLoop, pause, resume, setConfThreshold, isReady, resetTracks };
})();
