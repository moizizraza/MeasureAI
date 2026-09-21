/* ════════════════════════════════════════════════
   app.js — Clean Tap-To-Measure Controller
   AI detects continuously in background.
   Screen stays 100% clean — ONLY the tapped object is measured!
   ════════════════════════════════════════════════ */

(async () => {

  /* ── App State ── */
  const S = {
    unit:    'cm',
    frozen:  false,
    history: [],
    lastDetections: [],
    selectedObjects: new Set(), // Labels tapped by user
    fps: 0, fpsTs: 0,
  };

  /* ── DOM helpers ── */
  const $ = id => document.getElementById(id);
  const setProgress = (msg, pct) => {
    $('loader-msg').textContent = msg;
    $('loader-fill').style.width = pct + '%';
  };

  function setStatus(txt, type = 'live') {
    $('status-txt').textContent = txt;
    $('status-led').className = 'status-led ' + type;
  }

  function toast(msg, type = '', dur = 2500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, dur);
  }

  function updateCalibBadge() {
    const info  = MeasureEngine.getCalibrationInfo();
    const badge = $('calib-badge');
    const txt   = $('calib-txt');
    if (info.calibrated) {
      badge.className = 'calib-badge calibrated';
      txt.textContent = `Scale calibrated · ${info.sampleCount} samples`;
    } else {
      badge.className = 'calib-badge';
      txt.textContent = 'Calibrating…';
    }
  }

  /* ═══════════════════════════════════
     STEP 1 — Start Camera
  ═══════════════════════════════════ */
  setProgress('Starting camera…', 15);
  try {
    await Camera.start();
    setProgress('Camera ready ✓', 30);
  } catch (err) {
    setProgress('⚠️ Camera access denied — please allow camera and reload', 0);
    $('loader-fill').style.background = '#f87171';
    console.error('[App] Camera error:', err);
    return;
  }

  /* ═══════════════════════════════════
     STEP 2 — Load AI Neural Network
  ═══════════════════════════════════ */
  setProgress('Loading on-device AI…', 45);
  let modelOk = false;
  try {
    await Detector.load((msg, pct) => {
      setProgress(`🤖 ${msg}`, 45 + pct * 0.5);
    });
    modelOk = true;
    setProgress('AI model ready ✓', 95);
  } catch (err) {
    setProgress('⚠️ Model failed to load — check internet connection', 0);
    $('loader-fill').style.background = '#f87171';
    console.error('[App] Detector error:', err);
    await new Promise(r => setTimeout(r, 2500));
  }

  /* ═══════════════════════════════════
     STEP 3 — Launch Application
  ═══════════════════════════════════ */
  setProgress('Ready!', 100);
  await new Promise(r => setTimeout(r, 400));

  $('loading-screen').classList.add('hidden');
  $('app').classList.remove('hidden');

  if (!modelOk) {
    setStatus('Model not loaded', 'error');
    toast('AI model failed to load. Check internet and reload.', 'e', 8000);
    return;
  }

  setStatus('Point camera & tap any object', 'live');

  /* ═══════════════════════════════════
     STEP 4 — Detection Loop
  ═══════════════════════════════════ */
  const { w: vidW, h: vidH } = Camera.getDims();

  Detector.startLoop(preds => {
    if (S.frozen) return;

    // FPS
    const now = performance.now();
    if (S.fpsTs) S.fps = Math.round(1000 / (now - S.fpsTs));
    S.fpsTs = now;
    $('fps-chip').textContent = `${S.fps} fps`;

    // Background Calibration: calibrate scale using all detected objects
    const { w, h } = Camera.getDims();
    MeasureEngine.calibrate(preds, w || vidW, h || vidH);
    updateCalibBadge();

    // Map all predictions with measurements
    const items = preds.map(pred => ({
      label:       pred.class,
      bbox:        pred.bbox,
      score:       pred.score,
      selected:    S.selectedObjects.has(pred.class),
      measurement: MeasureEngine.measure(pred, w || vidW, h || vidH),
    }));

    S.lastDetections = items;

    // Draw: Renderer ONLY draws objects where selected === true!
    // Unselected objects are completely invisible (clean camera view).
    Renderer.draw(items, S.unit);

    // Update bottom measurement cards: ONLY show selected objects!
    const selectedMeasurements = items.filter(m => m.selected);
    renderCards(selectedMeasurements);

    // Status bar text
    if (selectedMeasurements.length > 0) {
      const names = selectedMeasurements.map(m => m.label).join(', ');
      setStatus(`Measuring: ${names}`, 'live');
    } else if (preds.length > 0) {
      setStatus(`Tap any object on screen to measure`, 'live');
    } else {
      setStatus(`Scanning for objects…`, 'live');
    }
  });

  /* ═══════════════════════════════════
     TAP-TO-MEASURE: Canvas Tap / Click
  ═══════════════════════════════════ */
  const canvasEl = $('canvas');

  function handleTap(e) {
    if (S.frozen) return;
    e.preventDefault();

    const rect = canvasEl.getBoundingClientRect();
    let px, py;
    if (e.touches && e.touches.length > 0) {
      px = e.touches[0].clientX - rect.left;
      py = e.touches[0].clientY - rect.top;
    } else {
      px = e.clientX - rect.left;
      py = e.clientY - rect.top;
    }

    // Check which detected object was tapped
    const hit = Renderer.hitTest(S.lastDetections, px, py);
    if (hit) {
      if (S.selectedObjects.has(hit.label)) {
        // Tapped already selected object → deselect it
        S.selectedObjects.delete(hit.label);
        toast(`Deselected: ${hit.label}`, '', 1500);
      } else {
        // Tapped a new object → measure it!
        S.selectedObjects.add(hit.label);
        const meas = hit.measurement;
        const wStr = MeasureEngine.format(meas.widthMm, S.unit);
        const hStr = MeasureEngine.format(meas.heightMm, S.unit);
        toast(`📏 ${hit.label}: ${wStr} × ${hStr}`, 's', 2500);
      }
    } else {
      // Tapped empty space → if objects are selected, clear selection
      if (S.selectedObjects.size > 0) {
        S.selectedObjects.clear();
        toast('Selection cleared', '', 1200);
      }
    }
  }

  canvasEl.style.pointerEvents = 'auto';
  canvasEl.addEventListener('click', handleTap);
  canvasEl.addEventListener('touchstart', handleTap, { passive: false });

  /* ═══════════════════════════════════
     MEASUREMENT CARDS (Bottom Strip)
  ═══════════════════════════════════ */
  function renderCards(measurements) {
    const scroll = $('results-scroll');
    const ph     = $('result-placeholder');

    if (measurements.length === 0) {
      scroll.querySelectorAll('.mcard').forEach(c => c.remove());
      ph.classList.remove('hidden');
      return;
    }

    ph.classList.add('hidden');

    // Remove cards for objects no longer selected
    const existing = [...scroll.querySelectorAll('.mcard')];
    const labels   = measurements.map(m => m.label);
    existing.forEach(card => {
      if (!labels.includes(card.dataset.label)) card.remove();
    });

    measurements.forEach(m => {
      const meas    = m.measurement;
      const wLbl    = MeasureEngine.format(meas.widthMm,  S.unit);
      const hLbl    = MeasureEngine.format(meas.heightMm, S.unit);
      const dist    = meas.distanceCm ? MeasureEngine.formatDist(meas.distanceCm) : null;
      const confPct = Math.round(m.score * 100);
      const confCls = confPct >= 70 ? 'high' : confPct >= 45 ? 'med' : 'low';

      let card = scroll.querySelector(`.mcard[data-label="${m.label}"]`);
      if (!card) {
        card = document.createElement('div');
        card.className = 'mcard';
        card.dataset.label = m.label;
        card.title = 'Tap to remove measurement';
        card.addEventListener('click', () => {
          S.selectedObjects.delete(m.label);
          toast(`Removed ${m.label}`, '', 1200);
        });
        scroll.appendChild(card);
      }

      card.innerHTML = `
        <div class="mcard-hdr">
          <span class="mcard-emoji">${meas.emoji}</span>
          <span class="mcard-conf-chip ${confCls}">${confPct}%</span>
        </div>
        <div class="mcard-label">${m.label} <span style="font-size:.65rem;color:var(--txt3);">(tap to close)</span></div>
        <div class="mcard-dims">
          <div class="mcard-dim"><span class="dim-lbl">W</span>${wLbl}</div>
          <div class="mcard-dim"><span class="dim-lbl">H</span>${hLbl}</div>
          ${dist ? `<div class="mcard-dim" style="color:var(--txt2);font-size:.68rem"><span class="dim-lbl">📏</span>${dist}</div>` : ''}
        </div>
      `;
    });
  }

  /* ═══════════════════════════════════
     HEADER & FOOTER CONTROLS
  ═══════════════════════════════════ */

  // Unit toggle: cm → in → mm
  $('btn-unit').addEventListener('click', () => {
    const units = ['cm', 'in', 'mm'];
    S.unit = units[(units.indexOf(S.unit) + 1) % units.length];
    $('unit-label').textContent = S.unit;
    toast(`Unit: ${S.unit}`, '', 1200);
    if (S.lastDetections.length) Renderer.draw(S.lastDetections, S.unit);
  });

  // Flip Camera
  $('btn-flip').addEventListener('click', async () => {
    setStatus('Switching camera…', 'paused');
    try {
      await Camera.flip();
      MeasureEngine.reset();
      setStatus('Point camera & tap any object', 'live');
      toast('Camera flipped', '', 1200);
    } catch {
      toast('Cannot flip camera', 'e');
      setStatus('Camera error', 'error');
    }
  });

  // Freeze / Resume
  $('btn-freeze').addEventListener('click', toggleFreeze);
  $('freeze-overlay').addEventListener('click', toggleFreeze);

  function toggleFreeze() {
    S.frozen = !S.frozen;
    $('freeze-overlay').classList.toggle('hidden', !S.frozen);
    const ico = $('freeze-ico');
    if (S.frozen) {
      Detector.pause();
      ico.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
      setStatus('Frozen', 'paused');
      toast('Paused — tap screen to resume', 'w', 2000);
    } else {
      Detector.resume();
      ico.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
      setStatus('Point camera & tap any object', 'live');
    }
  }

  // Capture snapshot
  $('btn-capture').addEventListener('click', () => {
    const selected = S.lastDetections.filter(m => m.selected);
    if (selected.length === 0) {
      toast('Tap an object first to measure and capture!', 'w', 2500);
      return;
    }
    const img = Renderer.snapshot();
    saveHistory(img);
    flashEffect();
    toast('📸 Saved to history!', 's', 2000);
  });

  // Clear / Reset selection
  $('btn-reset').addEventListener('click', () => {
    S.selectedObjects.clear();
    MeasureEngine.reset();
    updateCalibBadge();
    toast('Cleared all measurements', '', 1500);
  });

  // History Drawer
  $('btn-history').addEventListener('click', () => {
    closeDrawers();
    $('history-drawer').classList.remove('hidden');
    $('backdrop').classList.remove('hidden');
  });

  // Accuracy Instructions Drawer
  $('btn-tips').addEventListener('click', () => {
    closeDrawers();
    $('tips-drawer').classList.remove('hidden');
    $('backdrop').classList.remove('hidden');
  });

  $('btn-tips-close').addEventListener('click', closeDrawers);
  $('backdrop').addEventListener('click', closeDrawers);

  function closeDrawers() {
    $('history-drawer').classList.add('hidden');
    $('tips-drawer').classList.add('hidden');
    $('backdrop').classList.add('hidden');
  }

  $('btn-clear').addEventListener('click', () => {
    S.history = [];
    $('history-list').innerHTML = '<li class="hist-empty">No measurements yet</li>';
    toast('History cleared', '', 1200);
  });

  window.addEventListener('resize', () => Renderer.syncSize());

  /* ═══════════════════════════════════
     HISTORY STORAGE & FLASH
  ═══════════════════════════════════ */
  function saveHistory(imgUrl) {
    const ts  = new Date();
    const top = S.lastDetections.find(m => m.selected) || S.lastDetections[0];
    S.history.unshift({ img: imgUrl, meas: S.lastDetections, ts });

    const hl = $('history-list');
    const empty = hl.querySelector('.hist-empty');
    if (empty) empty.remove();

    const wLbl = top ? MeasureEngine.format(top.measurement.widthMm,  S.unit) : '—';
    const hLbl = top ? MeasureEngine.format(top.measurement.heightMm, S.unit) : '—';

    const li = document.createElement('li');
    li.className = 'hist-item';
    li.innerHTML = `
      <img class="hist-thumb" src="${imgUrl}" alt="snapshot" />
      <div class="hist-info">
        <div class="hist-label">${top ? top.measurement.emoji + ' ' + top.label : 'Snapshot'}</div>
        <div class="hist-dims">${wLbl} × ${hLbl}</div>
        <div class="hist-time">${ts.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
      </div>`;
    hl.prepend(li);
  }

  function flashEffect() {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;inset:0;z-index:99;background:rgba(255,255,255,.2);pointer-events:none;transition:opacity .35s;`;
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); });
  }

  console.log('[MeasureAI] ✓ Clean Tap-To-Measure ready');
})();
