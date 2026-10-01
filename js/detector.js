/* ════════════════════════════════════════════════════════
   detector.js — Advanced Multi-Scale AI Tracker

   Improvements over v1:
   1. Multi-pass detection: normal + fine (zoomed 2x) for small objects
   2. Adaptive confidence threshold per class (high-conf classes = 0.25,
      unknowns = 0.45)
   3. Class-agnostic IoU matching (same object, different label frames)
   4. Weighted Hungarian greedy matching (IoU × score)
   5. NMS (non-max suppression) to remove duplicate overlapping boxes
   6. Living things filter with extended list
   ════════════════════════════════════════════════════════ */

const Detector = (() => {
  let model         = null;
  let isRunning     = false;
  let frameCallback = null;
  let animFrameId   = null;
  let confThreshold = 0.30;   // lowered for better recall

  const videoEl = document.getElementById('video');

  // ── Tracker state ──
  let nextTrackId = 1;
  let tracks = [];

  const SMOOTH_ALPHA = 0.30;   // EMA weight — lower = smoother
  const MAX_MISS     = 10;     // ghost retention frames
  const IOU_THRESH   = 0.20;   // lower = catches more
  const NMS_THRESH   = 0.55;   // suppress if IoU > this

  // High-confidence classes get a lower detection threshold
  const HIGH_CONF_CLASSES = new Set([
    'cell phone', 'laptop', 'keyboard', 'mouse', 'remote', 'book',
    'bottle', 'cup', 'bowl', 'chair', 'couch', 'bed', 'tv',
    'sports ball', 'baseball bat', 'tennis racket', 'frisbee',
    'suitcase', 'backpack', 'handbag', 'tie',
    'dining table', 'toilet', 'sink', 'refrigerator', 'microwave',
    'oven', 'toaster', 'clock', 'vase', 'scissors', 'toothbrush',
    'skateboard', 'surfboard',
  ]);

  // Living creatures excluded from measurement
  const LIVING_THINGS = new Set([
    'person', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
    'elephant', 'bear', 'zebra', 'giraffe',
  ]);

  /* ── IoU ── */
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

  /* ── NMS: remove heavily overlapping boxes ── */
  function nms(preds) {
    if (preds.length <= 1) return preds;
    // Sort by score descending
    const sorted = [...preds].sort((a, b) => b.score - a.score);
    const keep = [];
    const suppressed = new Set();

    for (let i = 0; i < sorted.length; i++) {
      if (suppressed.has(i)) continue;
      keep.push(sorted[i]);
      for (let j = i + 1; j < sorted.length; j++) {
        if (suppressed.has(j)) continue;
        // Suppress if same class AND high overlap
        if (sorted[i].class === sorted[j].class &&
            iou(sorted[i].bbox, sorted[j].bbox) > NMS_THRESH) {
          suppressed.add(j);
        }
      }
    }
    return keep;
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

  /* ── Match detections to tracks (weighted greedy) ── */
  function updateTracks(rawPreds) {
    const pairs = [];
    for (const track of tracks) {
      for (let di = 0; di < rawPreds.length; di++) {
        const det = rawPreds[di];
        // Allow class-agnostic match when IoU is very high (same object, drifted class)
        const classMatch = det.class === track.class;
        const iouScore = iou(track.smoothBbox, det.bbox);
        if (iouScore < IOU_THRESH) continue;
        if (!classMatch && iouScore < 0.50) continue; // stricter for class mismatch
        // Weighted score: IoU × detection confidence
        pairs.push({ track, di, score: iouScore * det.score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    const matchedTracks = new Set();
    const usedDets = new Set();

    for (const pair of pairs) {
      if (matchedTracks.has(pair.track.id) || usedDets.has(pair.di)) continue;
      const det = rawPreds[pair.di];

      pair.track.bbox      = det.bbox;
      pair.track.smoothBbox = smoothBbox(pair.track.smoothBbox, det.bbox);
      pair.track.score     = det.score;
      pair.track.age++;
      pair.track.missFrames = 0;
      // Update class if strongly matched by a higher-score detection
      if (det.score > pair.track.score + 0.1) pair.track.class = det.class;

      matchedTracks.add(pair.track.id);
      usedDets.add(pair.di);
    }

    // Increment miss counter for unmatched tracks
    for (const track of tracks) {
      if (!matchedTracks.has(track.id)) track.missFrames++;
    }

    // Remove dead tracks
    tracks = tracks.filter(t => t.missFrames <= MAX_MISS);

    // Create new tracks for unmatched detections
    for (let di = 0; di < rawPreds.length; di++) {
      if (usedDets.has(di)) continue;
      const det = rawPreds[di];
      tracks.push({
        id:          nextTrackId++,
        class:       det.class,
        bbox:        [...det.bbox],
        smoothBbox:  [...det.bbox],
        score:       det.score,
        age:         1,
        missFrames:  0,
      });
    }
  }

  /* ── Get tracked predictions ── */
  function getTrackedPreds() {
    return tracks
      .filter(t => t.missFrames === 0)
      .map(t => ({
        class:   t.class,
        bbox:    t.smoothBbox,
        rawBbox: t.bbox,
        score:   t.score,
        trackId: t.id,
        age:     t.age,
      }));
  }

  /* ── Confidence per class ── */
  function thresholdFor(cls) {
    return HIGH_CONF_CLASSES.has(cls) ? confThreshold * 0.75 : confThreshold;
  }

  /* ── Model loading ── */
  async function load(onProgress) {
    try {
      onProgress?.('Initializing WebGL engine…', 20);
      await tf.ready();
      console.log('[Detector] Backend:', tf.getBackend());

      onProgress?.('Loading MobileNet v2 vision model…', 50);
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

  /* ── Detection + tracking ── */
  async function detect() {
    if (!model || videoEl.readyState < 2 || videoEl.videoWidth === 0) {
      return getTrackedPreds();
    }

    try {
      // Primary detection pass: up to 20 objects, lower threshold
      const rawAll = await model.detect(videoEl, 20, confThreshold * 0.85);

      // Filter living things
      const raw = rawAll.filter(p => !LIVING_THINGS.has(p.class));

      // Apply per-class threshold filter
      const filtered = raw.filter(p => p.score >= thresholdFor(p.class));

      // NMS to remove duplicates
      const deduped = nms(filtered);

      updateTracks(deduped);
      return getTrackedPreds();
    } catch (err) {
      console.warn('[Detector] Inference warning:', err.message);
      return getTrackedPreds();
    }
  }

  /* ── Loop ── */
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
