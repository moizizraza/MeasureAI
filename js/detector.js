/* ════════════════════════════════════════════
   detector.js v3 — COCO-SSD with smoothing
   ════════════════════════════════════════════ */

const Detector = (() => {
  let model         = null;
  let isRunning     = false;
  let frameCallback = null;
  let animFrameId   = null;
  let confThreshold = 0.35;

  // Temporal NMS — carry forward boxes if detection misses a frame
  let lastPreds = [];
  let missCount = {};   // label → consecutive miss frames

  const videoEl = document.getElementById('video');

  async function load(onProgress) {
    try {
      onProgress?.('Loading TensorFlow.js…', 20);
      await tf.ready();
      console.log('[Detector] Backend:', tf.getBackend());

      onProgress?.('Downloading COCO-SSD model…', 45);
      model = await cocoSsd.load({ base: 'mobilenet_v2' });
      console.log('[Detector] Model loaded ✓');

      onProgress?.('Model ready!', 100);
      return model;
    } catch (err) {
      console.error('[Detector] Load failed:', err);
      throw err;
    }
  }

  async function detect() {
    if (!model || videoEl.readyState < 2 || videoEl.videoWidth === 0) return lastPreds;
    try {
      const raw = await model.detect(videoEl, 20, confThreshold);

      // Temporal smoothing: if a previously-seen object disappears for
      // ≤2 frames, keep showing it (avoids flickering)
      const newLabels = new Set(raw.map(p => p.class));

      lastPreds.forEach(prev => {
        if (!newLabels.has(prev.class)) {
          missCount[prev.class] = (missCount[prev.class] || 0) + 1;
          if (missCount[prev.class] <= 2) raw.push(prev);
        } else {
          missCount[prev.class] = 0;
        }
      });

      lastPreds = raw;
      return raw;
    } catch (err) {
      console.warn('[Detector] Inference error:', err.message);
      return lastPreds;
    }
  }

  function startLoop(callback) {
    frameCallback = callback;
    isRunning = true;
    loop();
  }

  async function loop() {
    if (!isRunning) return;
    const preds = await detect();
    frameCallback?.(preds);
    animFrameId = requestAnimationFrame(loop);
  }

  function pause()  {
    isRunning = false;
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  }
  function resume() { isRunning = true; loop(); }
  function stopLoop() { pause(); }

  function setConfThreshold(v) { confThreshold = Math.max(0.1, Math.min(0.95, v)); }
  function isReady() { return !!model; }

  return { load, detect, startLoop, stopLoop, pause, resume, setConfThreshold, isReady };
})();
