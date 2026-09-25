/* ════════════════════════════════════════════════════════
   app.js — AI + Manual Multi-Point Measurement
   
   Two modes:
   - Auto: AI detects objects, tap to measure
   - Manual: Continuous multi-point measurement (like Apple Measure)
     tap point after point to measure along any path/shape
   ════════════════════════════════════════════════════════ */

(async () => {

  // Wait for intro + instructions to be dismissed
  if (document.getElementById('intro-screen')) {
    await new Promise(resolve => {
      window.addEventListener('intro-done', resolve, { once: true });
    });
  }

  const S = {
    unit:    'cm',
    frozen:  false,
    history: [],
    lastDetections: [],
    selectedTrackIds: new Set(),
    fps: 0,
    mode: 'auto',           // 'auto' or 'manual'
    manualPoints: [],       // [{ x, y }, ...] in canvas coords
    manualSegments: [],     // ['3.2 cm', '5.1 cm', ...] per segment
    manualTotal: null,      // '8.3 cm' total distance
  };

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
    const info = MeasureEngine.getCalibrationInfo();
    const badge = $('calib-badge'), txt = $('calib-txt');
    if (!badge || !txt) return;
    if (info.calibrated) {
      badge.className = 'calib-badge calibrated';
      txt.textContent = `Calibrated · ${info.sampleCount} samples`;
    } else {
      badge.className = 'calib-badge';
      txt.textContent = 'Calibrating…';
    }
  }

  /* ── Recalculate all manual segments ── */
  function recalcManual() {
    const info = MeasureEngine.getCalibrationInfo();
    const pts = S.manualPoints;
    S.manualSegments = [];
    let totalMm = 0;

    for (let i = 0; i < pts.length - 1; i++) {
      const distPx = Math.hypot(pts[i+1].x - pts[i].x, pts[i+1].y - pts[i].y);
      if (info.calibrated && info.pxPerMm > 0) {
        const mm = distPx / info.pxPerMm;
        totalMm += mm;
        S.manualSegments.push(MeasureEngine.format(mm, S.unit));
      } else {
        S.manualSegments.push(`${Math.round(distPx)}px`);
      }
    }

    if (pts.length >= 2) {
      if (info.calibrated && info.pxPerMm > 0) {
        S.manualTotal = MeasureEngine.format(totalMm, S.unit);
      } else {
        S.manualTotal = 'Uncalibrated';
      }
    } else {
      S.manualTotal = null;
    }
  }

  /* ═══════════════════════════════════
     STEP 1 — Camera
  ═══════════════════════════════════ */
  setProgress('Starting camera…', 15);
  try {
    await Camera.start();
    setProgress('Camera ready ✓', 35);
  } catch (err) {
    setProgress('⚠️ Camera denied — allow and reload', 0);
    const f = $('loader-fill'); if (f) f.style.background = '#f87171';
    return;
  }

  /* ═══════════════════════════════════
     STEP 2 — Load AI Model
  ═══════════════════════════════════ */
  setProgress('Loading AI vision…', 45);
  let modelOk = false;
  try {
    await Detector.load((msg, pct) => setProgress(`🤖 ${msg}`, 45 + pct * 0.5));
    modelOk = true;
    setProgress('AI ready ✓', 95);
  } catch (err) {
    setProgress('⚠️ Model failed — check connection', 0);
    const f = $('loader-fill'); if (f) f.style.background = '#f87171';
    await new Promise(r => setTimeout(r, 2000));
  }

  /* ═══════════════════════════════════
     STEP 3 — Launch
  ═══════════════════════════════════ */
  setProgress('Ready!', 100);
  await new Promise(r => setTimeout(r, 350));
  $('loading-screen').classList.add('hidden');
  $('app').classList.remove('hidden');

  if (!modelOk) {
    setStatus('Model not loaded', 'error');
    toast('AI failed. Please reload.', 'e', 8000);
    return;
  }

  setStatus('Point camera & tap any object', 'live');

  /* ═══════════════════════════════════
     STEP 4 — Detection Loop
  ═══════════════════════════════════ */
  const { w: vidW, h: vidH } = Camera.getDims();
  let fc = 0, fpsT = performance.now();

  Detector.startLoop(preds => {
    if (S.frozen) return;

    // FPS
    fc++;
    const now = performance.now();
    if (now - fpsT >= 500) {
      S.fps = Math.round((fc * 1000) / (now - fpsT));
      const chip = $('fps-chip');
      if (chip) chip.textContent = `${Math.max(1, S.fps)} fps`;
      fc = 0; fpsT = now;
    }

    // Calibrate (always runs for both modes)
    const { w, h } = Camera.getDims();
    MeasureEngine.calibrate(preds, w || vidW, h || vidH);
    updateCalibBadge();

    // Prune dead selections
    const liveIds = new Set(preds.map(p => p.trackId));
    for (const tid of S.selectedTrackIds) {
      if (!liveIds.has(tid)) S.selectedTrackIds.delete(tid);
    }

    // Build items
    const items = preds.map(pred => ({
      label:       pred.class,
      bbox:        pred.bbox,
      score:       pred.score,
      trackId:     pred.trackId,
      age:         pred.age,
      selected:    S.selectedTrackIds.has(pred.trackId),
      measurement: MeasureEngine.measure(pred, w || vidW, h || vidH),
    }));

    S.lastDetections = items;

    // Draw AI detections
    Renderer.draw(items, S.unit);

    // Draw manual multi-point overlay
    if (S.mode === 'manual' && S.manualPoints.length > 0) {
      recalcManual(); // live recalc as calibration improves
      Renderer.drawMultiPoints(S.manualPoints, S.manualSegments, S.manualTotal, '#fbbf24');
    }

    // Cards
    const sel = items.filter(m => m.selected);
    if (S.mode === 'auto') {
      renderCards(sel);
    } else {
      renderManualCard();
    }

    // Status
    if (S.mode === 'manual') {
      const n = S.manualPoints.length;
      if (n >= 2) {
        setStatus(`${n} points · ${S.manualTotal || '—'}`, 'live');
      } else if (n === 1) {
        setStatus('Tap next point to measure', 'live');
      } else {
        setStatus('Tap to place first point', 'live');
      }
    } else if (sel.length > 0) {
      const info = sel.map(m => `${m.label}${m.age >= 15 ? ' ✓' : ''}`).join(', ');
      setStatus(`Measuring: ${info}`, 'live');
    } else if (preds.length > 0) {
      setStatus('Tap any object to measure', 'live');
    } else {
      setStatus('Scanning…', 'live');
    }
  });

  /* ═══════════════════════════════════
     TAP HANDLER
  ═══════════════════════════════════ */
  let lastTapTs = 0;

  function handleTap(e) {
    if (S.frozen) return;
    const now = performance.now();
    if (now - lastTapTs < 300) return;
    lastTapTs = now;

    const rect = $('viewport').getBoundingClientRect();
    let cx, cy;
    if (e.changedTouches && e.changedTouches.length > 0) {
      cx = e.changedTouches[0].clientX; cy = e.changedTouches[0].clientY;
    } else if (e.touches && e.touches.length > 0) {
      cx = e.touches[0].clientX; cy = e.touches[0].clientY;
    } else {
      cx = e.clientX; cy = e.clientY;
    }

    const px = cx - rect.left, py = cy - rect.top;

    // ── Manual mode: add point ──
    if (S.mode === 'manual') {
      try { navigator.vibrate?.(25); } catch {}

      S.manualPoints.push({ x: px, y: py });
      recalcManual();

      const n = S.manualPoints.length;
      if (n === 1) {
        toast('Point 1 set — keep tapping', 's', 1500);
      } else {
        const lastSeg = S.manualSegments[S.manualSegments.length - 1];
        toast(`📐 Segment ${n-1}: ${lastSeg}`, 's', 2000);
      }
      return;
    }

    // ── Auto mode ──
    const hit = Renderer.hitTest(S.lastDetections, px, py);

    if (hit) {
      try { navigator.vibrate?.(30); } catch {}
      if (S.selectedTrackIds.has(hit.trackId)) {
        S.selectedTrackIds.delete(hit.trackId);
        toast(`Deselected: ${hit.label}`, '', 1200);
      } else {
        S.selectedTrackIds.add(hit.trackId);
        const m = hit.measurement;
        const w = MeasureEngine.format(m.widthMm, S.unit);
        const h = MeasureEngine.format(m.heightMm, S.unit);
        toast(`📏 ${hit.label}: ${w} × ${h}`, 's', 2500);
      }
    } else {
      if (S.selectedTrackIds.size > 0) {
        S.selectedTrackIds.clear();
        toast('Cleared', '', 1000);
      }
    }
  }

  $('viewport').addEventListener('click', handleTap);
  $('viewport').addEventListener('touchend', handleTap, { passive: true });

  /* ═══════════════════════════════════
     MEASUREMENT CARDS
  ═══════════════════════════════════ */
  function renderCards(measurements) {
    const scroll = $('results-scroll'), ph = $('result-placeholder');
    if (!scroll || !ph) return;

    if (measurements.length === 0) {
      scroll.querySelectorAll('.mcard').forEach(c => c.remove());
      ph.classList.remove('hidden');
      return;
    }
    ph.classList.add('hidden');

    const existing = [...scroll.querySelectorAll('.mcard')];
    const keys = measurements.map(m => `t${m.trackId}`);
    existing.forEach(c => { if (!keys.includes(c.dataset.key)) c.remove(); });

    measurements.forEach(m => {
      const key  = `t${m.trackId}`;
      const meas = m.measurement;
      const wLbl = MeasureEngine.format(meas.widthMm, S.unit);
      const hLbl = MeasureEngine.format(meas.heightMm, S.unit);
      const conf = Math.round(m.score * 100);
      const cls  = conf >= 70 ? 'high' : conf >= 45 ? 'med' : 'low';
      const locked = m.age >= 15;

      let card = scroll.querySelector(`.mcard[data-key="${key}"]`);
      if (!card) {
        card = document.createElement('div');
        card.className = 'mcard';
        card.dataset.key = key;
        scroll.appendChild(card);
      }

      card.innerHTML = `
        <div class="mcard-hdr">
          <span class="mcard-emoji">${meas.emoji}</span>
          <span class="mcard-conf-chip ${cls}">${conf}%</span>
          <span class="mcard-lock" style="font-size:.6rem;margin-left:auto;">${locked ? '🔒' : `⏳ ${Math.min(m.age,15)}/15`}</span>
        </div>
        <div class="mcard-label">${m.label}${locked ? ' <span style="color:var(--a);font-size:.65rem;">Locked ✓</span>' : ''}</div>
        <div class="mcard-dims">
          <div class="mcard-dim"><span class="dim-lbl">W</span>${wLbl}</div>
          <div class="mcard-dim"><span class="dim-lbl">H</span>${hLbl}</div>
        </div>
      `;
    });
  }

  function renderManualCard() {
    const scroll = $('results-scroll'), ph = $('result-placeholder');
    if (!scroll || !ph) return;

    scroll.querySelectorAll('.mcard:not([data-key="manual"])').forEach(c => c.remove());

    if (S.manualPoints.length < 2) {
      scroll.querySelector('.mcard[data-key="manual"]')?.remove();
      ph.classList.remove('hidden');
      const hint = S.manualPoints.length === 0 ? 'Tap to place first point' : 'Tap next point to measure';
      const sp = ph.querySelector('span');
      if (sp) sp.textContent = hint;
      return;
    }

    ph.classList.add('hidden');

    let card = scroll.querySelector('.mcard[data-key="manual"]');
    if (!card) {
      card = document.createElement('div');
      card.className = 'mcard';
      card.dataset.key = 'manual';
      scroll.appendChild(card);
    }

    const segHtml = S.manualSegments.map((s, i) =>
      `<div class="mcard-dim"><span class="dim-lbl">${i+1}</span>${s}</div>`
    ).join('');

    card.innerHTML = `
      <div class="mcard-hdr">
        <span class="mcard-emoji">📐</span>
        <span class="mcard-conf-chip med">${S.manualPoints.length} pts</span>
      </div>
      <div class="mcard-label">Manual · Total: <b>${S.manualTotal || '—'}</b></div>
      <div class="mcard-dims">${segHtml}</div>
    `;
  }

  /* ═══════════════════════════════════
     CONTROLS
  ═══════════════════════════════════ */

  // Mode toggle
  $('btn-mode').addEventListener('click', () => {
    if (S.mode === 'auto') {
      S.mode = 'manual';
      S.manualPoints = []; S.manualSegments = []; S.manualTotal = null;
      S.selectedTrackIds.clear();
      $('mode-label').textContent = 'A→B';
      $('btn-mode').classList.add('mode-active');
      toast('Manual mode — tap points to measure', 's', 2000);
    } else {
      S.mode = 'auto';
      S.manualPoints = []; S.manualSegments = []; S.manualTotal = null;
      $('mode-label').textContent = 'Auto';
      $('btn-mode').classList.remove('mode-active');
      toast('AI Auto mode', '', 1500);
    }
  });

  // Undo last point (long press Clear in manual mode)
  $('btn-undo')?.addEventListener('click', () => {
    if (S.mode === 'manual' && S.manualPoints.length > 0) {
      S.manualPoints.pop();
      recalcManual();
      toast(`Undo — ${S.manualPoints.length} points`, '', 1200);
    }
  });

  // Unit toggle
  $('btn-unit').addEventListener('click', () => {
    const u = ['cm','in','mm'];
    S.unit = u[(u.indexOf(S.unit)+1) % u.length];
    $('unit-label').textContent = S.unit;
    toast(`Unit: ${S.unit}`, '', 1200);
    if (S.mode === 'manual') recalcManual();
  });

  // Flip camera
  $('btn-flip').addEventListener('click', async () => {
    setStatus('Switching…', 'paused');
    try {
      await Camera.flip();
      MeasureEngine.reset(); Detector.resetTracks();
      S.selectedTrackIds.clear();
      S.manualPoints = []; S.manualSegments = []; S.manualTotal = null;
      setStatus('Point camera & tap any object', 'live');
    } catch { toast('Cannot flip', 'e'); }
  });

  // Freeze
  $('btn-freeze').addEventListener('click', toggleFreeze);
  $('freeze-overlay').addEventListener('click', toggleFreeze);
  function toggleFreeze() {
    S.frozen = !S.frozen;
    $('freeze-overlay').classList.toggle('hidden', !S.frozen);
    const ico = $('freeze-ico');
    if (S.frozen) { Detector.pause(); ico.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>'; setStatus('Frozen', 'paused'); }
    else { Detector.resume(); ico.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'; setStatus('Scanning…', 'live'); }
  }

  // Capture
  $('btn-capture').addEventListener('click', () => {
    const hasMeas = S.lastDetections.some(m => m.selected) || (S.mode === 'manual' && S.manualPoints.length >= 2);
    if (!hasMeas) { toast('Measure something first!', 'w', 2000); return; }
    saveHistory(Renderer.snapshot()); flashEffect(); toast('📸 Saved!', 's', 1500);
  });

  // Clear / Reset
  $('btn-reset').addEventListener('click', () => {
    if (S.mode === 'manual') {
      S.manualPoints = []; S.manualSegments = []; S.manualTotal = null;
      toast('Points cleared', '', 1200);
    } else {
      S.selectedTrackIds.clear(); MeasureEngine.reset(); Detector.resetTracks();
      updateCalibBadge(); toast('Cleared', '', 1200);
    }
  });

  // Drawers
  $('btn-history').addEventListener('click', () => { closeDrawers(); $('history-drawer').classList.remove('hidden'); $('backdrop').classList.remove('hidden'); });
  $('btn-tips').addEventListener('click', () => { closeDrawers(); $('tips-drawer').classList.remove('hidden'); $('backdrop').classList.remove('hidden'); });
  $('btn-tips-close').addEventListener('click', closeDrawers);
  $('backdrop').addEventListener('click', closeDrawers);
  function closeDrawers() { $('history-drawer').classList.add('hidden'); $('tips-drawer').classList.add('hidden'); $('backdrop').classList.add('hidden'); }
  $('btn-clear').addEventListener('click', () => { S.history = []; $('history-list').innerHTML = '<li class="hist-empty">No measurements yet</li>'; });

  window.addEventListener('resize', () => Renderer.syncSize());

  /* ═══════════════════════════════════
     HISTORY & FLASH
  ═══════════════════════════════════ */
  function saveHistory(imgUrl) {
    const ts = new Date();
    const top = S.lastDetections.find(m => m.selected) || S.lastDetections[0];
    S.history.unshift({ img: imgUrl, ts });
    const hl = $('history-list'), empty = hl.querySelector('.hist-empty');
    if (empty) empty.remove();
    const label = S.mode === 'manual' ? `📐 Manual: ${S.manualTotal}` : (top ? `${top.measurement.emoji} ${top.label}` : 'Snap');
    const dims = S.mode === 'manual' ? `${S.manualPoints.length} points · ${S.manualTotal}` :
      (top ? `${MeasureEngine.format(top.measurement.widthMm, S.unit)} × ${MeasureEngine.format(top.measurement.heightMm, S.unit)}` : '—');
    const li = document.createElement('li');
    li.className = 'hist-item';
    li.innerHTML = `<img class="hist-thumb" src="${imgUrl}" alt="snap"/><div class="hist-info"><div class="hist-label">${label}</div><div class="hist-dims">${dims}</div><div class="hist-time">${ts.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div></div>`;
    hl.prepend(li);
  }

  function flashEffect() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:99;background:rgba(255,255,255,.2);pointer-events:none;transition:opacity .35s;';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); });
  }

  console.log('[MeasureAI] ✓ AI + Multi-Point Manual measurement ready');
})();
