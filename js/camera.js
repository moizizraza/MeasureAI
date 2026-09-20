/* ════════════════════════════════════════════════
   camera.js v3 — Camera module
   ════════════════════════════════════════════════ */

const Camera = (() => {
  let stream = null;
  let facing = 'environment';
  const vid  = document.getElementById('video');

  async function start() {
    if (stream) stop();
    const constraints = {
      video: {
        facingMode: facing,
        width:  { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      vid.srcObject = stream;
      await new Promise((res, rej) => { vid.onloadedmetadata = res; vid.onerror = rej; });
      await vid.play();
      return true;
    } catch (err) {
      if (facing === 'environment') {
        facing = 'user';
        return start();
      }
      throw err;
    }
  }

  function stop() {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    vid.srcObject = null;
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
