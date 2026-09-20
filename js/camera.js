/* ════════════════════════════════════════════════
   camera.js v4 — Cross-Platform Camera (iOS Safari + Chrome)
   ════════════════════════════════════════════════ */

const Camera = (() => {
  let stream = null;
  let facing = 'environment';
  const vid  = document.getElementById('video');

  async function start() {
    if (stream) stop();

    // iOS Safari requires playsinline attributes on video element
    vid.setAttribute('playsinline', 'true');
    vid.setAttribute('webkit-playsinline', 'true');
    vid.muted = true;

    const constraints = {
      video: {
        facingMode: { ideal: facing },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    };

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not supported in this browser');
      }

      stream = await navigator.mediaDevices.getUserMedia(constraints);
      vid.srcObject = stream;

      // Safe wait for video metadata that won't hang on iOS Safari
      await new Promise((resolve) => {
        if (vid.readyState >= 1 && vid.videoWidth > 0) {
          resolve();
        } else {
          const onLoaded = () => {
            vid.removeEventListener('loadedmetadata', onLoaded);
            resolve();
          };
          vid.addEventListener('loadedmetadata', onLoaded);
          // Fallback timeout so it never hangs indefinitely
          setTimeout(resolve, 1500);
        }
      });

      try {
        await vid.play();
      } catch (playErr) {
        console.warn('[Camera] Auto-play was prevented:', playErr);
      }

      return true;
    } catch (err) {
      console.warn('[Camera] Start error with facing=' + facing + ':', err);
      // If environment camera failed, try user (selfie) camera
      if (facing === 'environment') {
        facing = 'user';
        return start();
      }
      throw err;
    }
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (vid) {
      vid.srcObject = null;
    }
  }

  async function flip() {
    facing = facing === 'environment' ? 'user' : 'environment';
    return start();
  }

  function getDims() {
    return { w: vid.videoWidth || 640, h: vid.videoHeight || 480 };
  }

  return { start, stop, flip, getDims };
})();
