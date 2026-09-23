/* ════════════════════════════════════════════════
   app.js — Instance-Based Tap-To-Measure
   - Each specific object instance is tracked independently
   - Tapping bottle #1 does NOT select bottle #2
   - Screen stays 100% clean until user taps
   ════════════════════════════════════════════════ */

(async () => {

  /* ── App State ── */
  const S = {
    unit:    'cm',
    frozen:  false,
    history: [],
    lastDetections: [],  // all detections this frame
    // Instance-based selection: each entry = { label, cx, cy }
    // We match by label + spatial proximity each frame
    selectedInstances: [],
    fps: 0,
  };

  /* ── DOM helpers ── */
  const $ = id => document.getElementById(id);
  const setProgress = (msg, pct) => {
    const m = $('loader-msg'), f = $('loader-fill');
    if (m) m.textContent = msg;
    if (f) f.style.width = pct + '%';
  };

  function setStatus(txt, type = 'live') {
    const st = $('status-txt'), led = $('status-led');
    if (st) st.textContent = txt;
    if (led) led.className = 'status-led ' + type;
  }

  function toast(msg, type = '', dur = 2200) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    const toasts = $('toasts');
    if (toasts) toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, dur);
  }

  function updateCalibBadge() {
    const info  = MeasureEngine.getCalibrationInfo();
    const badge = $('calib-badge');
    const txt   = $('calib-txt');
    if (!badge || !txt) return;
    if (info.calibrated) {
      badge.className = 'calib-badge calibrated';
      txt.textContent = `Calibrated · ${info.sampleCount} samples`;
    } else {
      badge.className = 'calib-badge';
      txt.textContent = 'Calibrating…';
    }
  }

  /* ── Instance matching: is this detection the same physical object? ── */
  function instanceMatch(sel, item) {
    if (sel.label !== item.label) return false;
    const [bx, by, bw, bh] = item.bbox;
    const icx = bx + bw / 2;
    const icy = by + bh / 2;
    // Allow up to 35% of bbox diagonal drift between frames
    const diag = Math.hypot(bw, bh);
    const drift = Math.hypot(icx - sel.cx, icy - sel.cy);
    return drift < diag * 0.35;
  }

  function markSelected(items) {
    // For each selected instance, find the closest matching detection
    const used = new Set();
    for (const sel of S.selectedInstances) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < items.length; i++) {
        if (used.has(i)) continue;
        if (items[i].label !== sel.label) continue;
        const [bx, by, bw, bh] = items[i].bbox;
        const d = Math.hypot((bx + bw/2) - sel.cx, (by + bh/2) - sel.cy);
        const diag = Math.hypot(bw, bh);
        if (d < diag * 0.5 && d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        items[bestIdx].selected = true;
        used.add(bestIdx);
        // Update stored center to follow the object as it moves
        const [bx, by, bw, bh] = items[bestIdx].bbox;
        sel.cx = bx + bw / 2;
        sel.cy = by + bh / 2;
      }
    }
    // Remove any selected instances that weren't matched for 60+ frames
    // (object left the view)
    S.selectedInstances = S.selectedInstances.filter(sel => {
      sel._missFrames = (sel._missFrames || 0);
      const matched = items.some(it => it.selected && it.label === sel.label &&
        Math.hypot((it.bbox[0] + it.bbox[2]/2) - sel.cx, (it.bbox[1] + it.bbox[3]/2) - sel.cy) < Math.hypot(it.bbox[2], it.bbox[3]) * 0.5);
      if (!matched) {
        sel._missFrames++;
        return sel._missFrames < 60; // keep for ~2 seconds
      }
      sel._missFrames = 0;
      return true;
    });
  }

  /* ═══════════════════════════════════
     STEP 1 — Start Camera
  ═══════════════════════════════════ */
  setProgress('Starting camera feed…', 15);
  try {
    await Camera.start();
    setProgress('Camera ready ✓', 35);
  } catch (err) {
    setProgress('⚠️ Camera access denied — allow camera and reload', 0);
    const fill = $('loader-fill');
    if (fill) fill.style.background = '#f87171';
    console.error('[App] Camera error:', err);
    return;
  }

  /* ═══════════════════════════════════
     STEP 2 — Load AI Vision Model
  ═══════════════════════════════════ */
  setProgress('Loading vision engine…', 45);
  let modelOk = false;
  try {
    await Detector.load((msg, pct) => {
      setProgress(`🤖 ${msg}`, 45 + pct * 0.5);
    });
    modelOk = true;
    setProgress('AI model loaded ✓', 95);
  } catch (err) {
    setProgress('⚠️ Model failed — check connection and reload', 0);
    const fill = $('loader-fill');
    if (fill) fill.style.background = '#f87171';
    console.error('[App] Detector error:', err);
    await new Promise(r => setTimeout(r, 2000));
  }

  /* ═══════════════════════════════════
     STEP 3 — Reveal App
  ═══════════════════════════════════ */
  setProgress('Launching…', 100);
  await new Promise(r => setTimeout(r, 350));

  $('loading-screen').classList.add('hidden');
  $('app').classList.remove('hidden');

  if (!modelOk) {
    setStatus('Model not loaded', 'error');
    toast('Vision model failed. Please reload.', 'e', 8000);
    return;
  }

  setStatus('Point camera & tap any object', 'live');

  /* ═══════════════════════════════════
     STEP 4 — Detection Loop
  ═══════════════════════════════════ */
  const { w: vidW, h: vidH } = Camera.getDims();
  let fc = 0;
  let fpsT = performance.now();

  Detector.startLoop(preds => {
    if (S.frozen) return;

    // FPS counter
    fc++;
    const now = performance.now();
    if (now - fpsT >= 500) {
      S.fps = Math.round((fc * 1000) / (now - fpsT));
      const chip = $('fps-chip');
      if (chip) chip.textContent = `${Math.max(1, S.fps)} fps`;
      fc = 0;
      fpsT = now;
    }

    // Background calibration
    const { w, h } = Camera.getDims();
    MeasureEngine.calibrate(preds, w || vidW, h || vidH);
    updateCalibBadge();

    // Build items — all start as selected: false
    const items = preds.map(pred => ({
      label:       pred.class,
      bbox:        pred.bbox,
      score:       pred.score,
      selected:    false,
      measurement: MeasureEngine.measure(pred, w || vidW, h || vidH),
    }));

    // Mark only the specific instances the user tapped
    markSelected(items);

    S.lastDetections = items;

    // Renderer ONLY draws items where selected === true
    Renderer.draw(items, S.unit);

    // Bottom cards — only selected
    const sel = items.filter(m => m.selected);
    renderCards(sel);

    // Status
    if (sel.length > 0) {
      setStatus(`Measuring: ${sel.map(m => m.label).join(', ')}`, 'live');
    } else if (preds.length > 0) {
      setStatus('Tap any object to measure', 'live');
    } else {
      setStatus('Scanning for objects…', 'live');
    }
  });

  /* ═══════════════════════════════════
     TAP-TO-MEASURE (Instance-Based)
  ═══════════════════════════════════ */
  let lastTapTs = 0;

  function handleTap(e) {
    if (S.frozen) return;

    // Debounce touch+click double-fire
    const now = performance.now();
    if (now - lastTapTs < 350) return;
    lastTapTs = now;

    const vp = $('viewport');
    const rect = vp.getBoundingClientRect();

    let cx, cy;
    if (e.changedTouches && e.changedTouches.length > 0) {
      cx = e.changedTouches[0].clientX;
      cy = e.changedTouches[0].clientY;
    } else if (e.touches && e.touches.length > 0) {
      cx = e.touches[0].clientX;
      cy = e.touches[0].clientY;
    } else {
      cx = e.clientX;
      cy = e.clientY;
    }

    const px = cx - rect.left;
    const py = cy - rect.top;

    // Hit test — find the EXACT object tapped (strict, no magnetic snap to other objects)
    const hit = Renderer.hitTest(S.lastDetections, px, py);

    if (hit) {
      try { navigator.vibrate?.(30); } catch {}

      const [bx, by, bw, bh] = hit.bbox;
      const hitCx = bx + bw / 2;
      const hitCy = by + bh / 2;

      // Check if this specific instance is already selected
      const existingIdx = S.selectedInstances.findIndex(sel =>
        sel.label === hit.label && instanceMatch(sel, hit)
      );

      if (existingIdx >= 0) {
        // Already selected → deselect THIS instance only
        S.selectedInstances.splice(existingIdx, 1);
        toast(`Deselected: ${hit.label}`, '', 1200);
      } else {
        // Select THIS specific instance
        S.selectedInstances.push({
          label: hit.label,
          cx: hitCx,
          cy: hitCy,
          _missFrames: 0,
        });
        const meas = hit.measurement;
        const wStr = MeasureEngine.format(meas.widthMm, S.unit);
        const hStr = MeasureEngine.format(meas.heightMm, S.unit);
        toast(`📏 ${hit.label}: ${wStr} × ${hStr}`, 's', 2500);
      }
    } else {
      // Tapped empty space → clear all
      if (S.selectedInstances.length > 0) {
        S.selectedInstances = [];
        toast('Selection cleared', '', 1000);
      }
    }
  }

  const vpEl = $('viewport');
  vpEl.addEventListener('click', handleTap);
  vpEl.addEventListener('touchend', handleTap, { passive: true });

  /* ═══════════════════════════════════
     MEASUREMENT CARDS (Bottom Panel)
  ═══════════════════════════════════ */
  function renderCards(measurements) {
    const scroll = $('results-scroll');
    const ph     = $('result-placeholder');
    if (!scroll || !ph) return;

    if (measurements.length === 0) {
      scroll.querySelectorAll('.mcard').forEach(c => c.remove());
      ph.classList.remove('hidden');
      return;
    }

    ph.classList.add('hidden');

    // Build unique card IDs from label + index
    const existing = [...scroll.querySelectorAll('.mcard')];
    const cardKeys = measurements.map((m, i) => `${m.label}-${i}`);
    existing.forEach(card => {
      if (!cardKeys.includes(card.dataset.key)) card.remove();
    });

    measurements.forEach((m, i) => {
      const key     = `${m.label}-${i}`;
      const meas    = m.measurement;
      const wLbl    = MeasureEngine.format(meas.widthMm,  S.unit);
      const hLbl    = MeasureEngine.format(meas.heightMm, S.unit);
      const dist    = meas.distanceCm ? MeasureEngine.formatDist(meas.distanceCm) : null;
      const confPct = Math.round(m.score * 100);
      const confCls = confPct >= 70 ? 'high' : confPct >= 45 ? 'med' : 'low';

      let card = scroll.querySelector(`.mcard[data-key="${key}"]`);
      if (!card) {
        card = document.createElement('div');
        card.className = 'mcard';
        card.dataset.key = key;
        card.dataset.label = m.label;
        scroll.appendChild(card);
      }

      card.innerHTML = `
        <div class="mcard-hdr">
          <span class="mcard-emoji">${meas.emoji}</span>
          <span class="mcard-conf-chip ${confCls}">${confPct}%</span>
        </div>
        <div class="mcard-label">${m.label}</div>
        <div class="mcard-dims">
          <div class="mcard-dim"><span class="dim-lbl">W</span>${wLbl}</div>
          <div class="mcard-dim"><span class="dim-lbl">H</span>${hLbl}</div>
          ${dist ? `<div class="mcard-dim" style="color:var(--txt2);font-size:.68rem"><span class="dim-lbl">📏</span>${dist}</div>` : ''}
        </div>
      `;
    });
  }

  /* ═══════════════════════════════════
     CONTROLS
  ═══════════════════════════════════ */

  // Unit toggle
  $('btn-unit').addEventListener('click', () => {
    const units = ['cm', 'in', 'mm'];
    S.unit = units[(units.indexOf(S.unit) + 1) % units.length];
    $('unit-label').textContent = S.unit;
    toast(`Unit: ${S.unit}`, '', 1200);
  });

  // Flip Camera
  $('btn-flip').addEventListener('click', async () => {
    setStatus('Switching camera…', 'paused');
    try {
      await Camera.flip();
      MeasureEngine.reset();
      S.selectedInstances = [];
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
    } else {
      Detector.resume();
      ico.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
      setStatus('Point camera & tap any object', 'live');
    }
  }

  // Capture
  $('btn-capture').addEventListener('click', () => {
    const sel = S.lastDetections.filter(m => m.selected);
    if (sel.length === 0) { toast('Tap an object first!', 'w', 2000); return; }
    const img = Renderer.snapshot();
    saveHistory(img);
    flashEffect();
    toast('📸 Saved!', 's', 1500);
  });

  // Clear all
  $('btn-reset').addEventListener('click', () => {
    S.selectedInstances = [];
    MeasureEngine.reset();
    updateCalibBadge();
    toast('Cleared', '', 1200);
  });

  // Drawers
  $('btn-history').addEventListener('click', () => { closeDrawers(); $('history-drawer').classList.remove('hidden'); $('backdrop').classList.remove('hidden'); });
  $('btn-tips').addEventListener('click', () => { closeDrawers(); $('tips-drawer').classList.remove('hidden'); $('backdrop').classList.remove('hidden'); });
  $('btn-tips-close').addEventListener('click', closeDrawers);
  $('backdrop').addEventListener('click', closeDrawers);
  function closeDrawers() { $('history-drawer').classList.add('hidden'); $('tips-drawer').classList.add('hidden'); $('backdrop').classList.add('hidden'); }
  $('btn-clear').addEventListener('click', () => { S.history = []; $('history-list').innerHTML = '<li class="hist-empty">No measurements yet</li>'; toast('History cleared', '', 1200); });

  window.addEventListener('resize', () => Renderer.syncSize());

  /* ═══════════════════════════════════
     HISTORY & FLASH
  ═══════════════════════════════════ */
  function saveHistory(imgUrl) {
    const ts  = new Date();
    const top = S.lastDetections.find(m => m.selected) || S.lastDetections[0];
    S.history.unshift({ img: imgUrl, meas: S.lastDetections, ts });
    const hl = $('history-list');
    const empty = hl.querySelector('.hist-empty');
    if (empty) empty.remove();
    const wLbl = top ? MeasureEngine.format(top.measurement.widthMm, S.unit) : '—';
    const hLbl = top ? MeasureEngine.format(top.measurement.heightMm, S.unit) : '—';
    const li = document.createElement('li');
    li.className = 'hist-item';
    li.innerHTML = `<img class="hist-thumb" src="${imgUrl}" alt="snap"/><div class="hist-info"><div class="hist-label">${top ? top.measurement.emoji + ' ' + top.label : 'Snap'}</div><div class="hist-dims">${wLbl} × ${hLbl}</div><div class="hist-time">${ts.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div></div>`;
    hl.prepend(li);
  }

  function flashEffect() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:99;background:rgba(255,255,255,.2);pointer-events:none;transition:opacity .35s;';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); });
  }

  console.log('[MeasureAI] ✓ Instance-based tap-to-measure ready');
})();
