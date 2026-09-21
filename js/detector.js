/* ════════════════════════════════════════════
   detector.js — High-Performance Vision Loop
   ════════════════════════════════════════════ */

const Detector = (() => {
  let model         = null;
  let isRunning     = false;
  let frameCallback = null;
  let animFrameId   = null;
  let confThreshold = 0.35;

  let lastPreds = [];
  let missCount = {};

  const videoEl = document.getElementById('video');

  async function load(onProgress) {
    try {
      onProgress?.('Initializing WebGL engine…', 20);
      await tf.ready();
      console.log('[Detector] Backend:', tf.getBackend());

      onProgress?.('Loading vision model…', 50);
      try {
        model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      } catch (err1) {
        console.warn('[Detector] lite_mobilenet_v2 fallback:', err1);
        model = await cocoSsd.load();
      }
      console.log('[Detector] Model loaded successfully ✓');
      onProgress?.('Vision engine ready!', 100);
      return model;
    } catch (err) {
      console.error('[Detector] Load failed:', err);
      throw err;
    }
  }

  async function detect() {
    if (!model) return lastPreds;
    // Ensure video has actual frames before passing to WebGL
    if (videoEl.readyState < 2 || videoEl.videoWidth === 0) {
      return lastPreds;
    }

    try {
      const raw = await model.detect(videoEl, 20, confThreshold);

      // Temporal smoothing to prevent flicker
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
      console.warn('[Detector] Inference warning:', err.message);
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

    try {
      const preds = await detect();
      if (frameCallback && isRunning) {
        frameCallback(preds);
      }
    } catch (err) {
      console.error('[Detector] Loop callback error:', err);
    } finally {
      // ALWAYS schedule next frame so FPS never freezes at 0
      if (isRunning) {
        animFrameId = requestAnimationFrame(loop);
      }
    }
  }

  function pause() {
    isRunning = false;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function resume() {
    if (!isRunning) {
      isRunning = true;
      loop();
    }
  }

  function stopLoop() {
    pause();
  }

  function setConfThreshold(v) {
    confThreshold = Math.max(0.1, Math.min(0.95, v));
  }

  function isReady() {
    return !!model;
  }

  return { load, detect, startLoop, stopLoop, pause, resume, setConfThreshold, isReady };
})();
