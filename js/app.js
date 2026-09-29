/* ════════════════════════════════════════════════════════
   app.js — AI + AR-Anchored Measurement Controller
   
   Manual mode uses visual feature tracking (anchor.js)
   to lock points to real-world surfaces. Points follow
   the surface texture when the camera moves — like ARKit.
   ════════════════════════════════════════════════════════ */

(async () => {

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
    mode: 'auto',
    manualSegments: [],
    manualTotal: null,
  };

  const $ = id => document.getElementById(id);
  const videoEl = document.getElementById('video');

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

  /* ── Video ↔ Canvas coordinate conversion ── */
  function canvasToVideo(cx, cy) {
    const canvasEl = document.getElementById('canvas');
    const vw = videoEl.videoWidth || 1, vh = videoEl.videoHeight || 1;
    const cw = canvasEl.width, ch = canvasEl.height;
    const s = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
    return { vx: (cx - ox) / s, vy: (cy - oy) / s };
  }

  function videoToCanvas(vx, vy) {
    const canvasEl = document.getElementById('canvas');
    const vw = videoEl.videoWidth || 1, vh = videoEl.videoHeight || 1;
    const cw = canvasEl.width, ch = canvasEl.height;
    const s = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
    return { x: vx * s + ox, y: vy * s + oy };
  }

  /* ── Recalculate manual segments from anchor points ── */
  function recalcManual() {
    const info = MeasureEngine.getCalibrationInfo();
    const pts = Anchor.getPoints();
    S.manualSegments = [];
    let totalMm = 0;

    for (let i = 0; i < pts.length - 1; i++) {
      const distPx = Math.hypot(pts[i+1].vx - pts[i].vx, pts[i+1].vy - pts[i].vy);
      if (info.calibrated && info.pxPerMm > 0) {
        const mm = distPx / info.pxPerMm;
        totalMm += mm;
        S.manualSegments.push(MeasureEngine.format(mm, S.unit));
      } else {
        S.manualSegments.push(`${Math.round(distPx)}px`);
      }
    }

    if (pts.length >= 2) {
      S.manualTotal = info.calibrated && info.pxPerMm > 0
        ? MeasureEngine.format(totalMm, S.unit)
        : 'Uncalibrated';
    } else {
      S.manualTotal = null;
    }
  }

  /* ── Get canvas-coord points with confidence for renderer ── */
  function getCanvasPointsWithConf() {
    return Anchor.getPoints().map(p => {
      const c = videoToCanvas(p.vx, p.vy);
      return { x: c.x, y: c.y, conf: p.confidence };
    });
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

  // Initialize visual anchor tracker
  Anchor.init(videoEl);

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

    // Calibrate
    const { w, h } = Camera.getDims();
    MeasureEngine.calibrate(preds, w || vidW, h || vidH);
    updateCalibBadge();

    // ── Visual feature tracking: update anchored points ──
    if (S.mode === 'manual' && Anchor.count() > 0) {
      Anchor.updateAll();
    }

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

    // Draw AR-anchored manual points
    if (S.mode === 'manual' && Anchor.count() > 0) {
      recalcManual();
      const canvasPts = getCanvasPointsWithConf();
      Renderer.drawMultiPoints(canvasPts, S.manualSegments, S.manualTotal, '#fbbf24');
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
      const n = Anchor.count();
      if (n >= 2) {
        setStatus(`${n} anchored · ${S.manualTotal || '—'}`, 'live');
      } else if (n === 1) {
        setStatus('Tap next point', 'live');
      } else {
        setStatus('Tap surface to anchor point', 'live');
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

    // ── Manual mode: anchor point to surface ──
    if (S.mode === 'manual') {
      try { navigator.vibrate?.(25); } catch {}

      const vidPt = canvasToVideo(px, py);
      Anchor.placePoint(vidPt.vx, vidPt.vy);
      recalcManual();

      const n = Anchor.count();
      if (n === 1) {
        toast('📌 Point anchored — tap next', 's', 1500);
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

    const n = Anchor.count();
    if (n < 2) {
      scroll.querySelector('.mcard[data-key="manual"]')?.remove();
      ph.classList.remove('hidden');
      const sp = ph.querySelector('span');
      if (sp) sp.textContent = n === 0 ? 'Tap surface to anchor point' : 'Tap next point';
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
        <span class="mcard-conf-chip med">${n} pts</span>
      </div>
      <div class="mcard-label">Total: <b>${S.manualTotal || '—'}</b></div>
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
      Anchor.clear();
      Anchor.requestGyroPermission();
      S.manualSegments = []; S.manualTotal = null;
      S.selectedTrackIds.clear();
      $('mode-label').textContent = 'A→B';
      $('btn-mode').classList.add('mode-active');
      toast('📌 AR Anchor mode — points lock to surfaces', 's', 2500);
    } else {
      S.mode = 'auto';
      Anchor.clear();
      S.manualSegments = []; S.manualTotal = null;
      $('mode-label').textContent = 'Auto';
      $('btn-mode').classList.remove('mode-active');
      toast('AI Auto mode', '', 1500);
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
      Anchor.clear(); S.manualSegments = []; S.manualTotal = null;
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
    const hasMeas = S.lastDetections.some(m => m.selected) || (S.mode === 'manual' && Anchor.count() >= 2);
    if (!hasMeas) { toast('Measure something first!', 'w', 2000); return; }
    saveHistory(Renderer.snapshot()); flashEffect(); toast('📸 Saved!', 's', 1500);
  });

  // Clear
  $('btn-reset').addEventListener('click', () => {
    if (S.mode === 'manual') {
      Anchor.clear(); S.manualSegments = []; S.manualTotal = null;
      toast('Anchors cleared', '', 1200);
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
    const dims = S.mode === 'manual' ? `${Anchor.count()} pts · ${S.manualTotal}` :
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

  console.log('[MeasureAI] ✓ AR Anchor tracking active');
})();
