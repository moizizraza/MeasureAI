/* ════════════════════════════════════════════════
   app.js v3 — Main Controller (100% On-Device)
   ════════════════════════════════════════════════ */

(async () => {

  /* ── State ── */
  const S = {
    unit:    'cm',
    frozen:  false,
    history: [],
    lastMeasurements: [],
    fps: 0, fpsTs: 0,
    filterMode: 'all',        // 'all' or 'custom'
    selectedObjects: new Set(),  // classes selected in custom mode
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

  function toast(msg, type = '', dur = 3000) {
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
     STEP 1 — Camera
  ═══════════════════════════════════ */
  setProgress('Starting camera…', 10);
  try {
    await Camera.start();
    setProgress('Camera ready ✓', 20);
  } catch (err) {
    setProgress('⚠️ Camera error — please allow camera access and reload', 0);
    $('loader-fill').style.background = '#f87171';
    console.error('[App] Camera:', err);
    return;
  }

  /* ═══════════════════════════════════
     STEP 2 — Load AI Models
  ═══════════════════════════════════ */
  setProgress('Loading on-device AI model…', 35);

  let modelOk = false;
  try {
    await Detector.load((msg, pct) => {
      setProgress(`🤖 ${msg}`, 35 + pct * 0.55);
    });
    modelOk = true;
    setProgress('AI model ready ✓', 95);
  } catch (err) {
    setProgress('⚠️ Model load failed — check internet connection', 0);
    $('loader-fill').style.background = '#f87171';
    console.error('[App] Detector:', err);
    await new Promise(r => setTimeout(r, 3000));
  }

  /* ═══════════════════════════════════
     STEP 3 — Launch App
  ═══════════════════════════════════ */
  setProgress('All systems ready!', 100);
  await new Promise(r => setTimeout(r, 500));

  $('loading-screen').classList.add('hidden');
  $('app').classList.remove('hidden');

  if (!modelOk) {
    setStatus('Model not loaded', 'error');
    toast('AI model failed to load. Check internet and reload.', 'e', 8000);
    return;
  }

  setStatus('Detecting objects…', 'live');

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

    // Calibrate scale (use ALL detections for calibration even when filtering)
    const { w, h } = Camera.getDims();
    MeasureEngine.calibrate(preds, w || vidW, h || vidH);
    updateCalibBadge();

    // Apply object filter
    let filtered = preds;
    if (S.filterMode === 'custom' && S.selectedObjects.size > 0) {
      filtered = preds.filter(p => S.selectedObjects.has(p.class));
    }

    // Measure each detected object
    const measurements = filtered.map(pred => ({
      label:       pred.class,
      bbox:        pred.bbox,
      score:       pred.score,
      measurement: MeasureEngine.measure(pred, w || vidW, h || vidH),
    }));

    S.lastMeasurements = measurements;

    // Draw
    Renderer.draw(measurements, S.unit);

    // Update results strip
    renderCards(measurements);

    // Object count badge
    if (preds.length > 0) {
      setStatus(`${preds.length} object${preds.length > 1 ? 's' : ''} detected`, 'live');
    } else {
      setStatus('Scanning for objects…', 'live');
    }
  });

  /* ═══════════════════════════════════
     MEASUREMENT CARDS
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

    // Update existing cards or create new ones
    const existing = [...scroll.querySelectorAll('.mcard')];
    const labels   = measurements.map(m => m.label);

    // Remove cards for objects no longer detected
    existing.forEach(card => {
      if (!labels.includes(card.dataset.label)) card.remove();
    });

    measurements.forEach(m => {
      const meas  = m.measurement;
      const wLbl  = MeasureEngine.format(meas.widthMm,  S.unit);
      const hLbl  = MeasureEngine.format(meas.heightMm, S.unit);
      const dist  = meas.distanceCm ? MeasureEngine.formatDist(meas.distanceCm) : null;
      const confPct = Math.round(m.score * 100);
      const confCls = confPct >= 70 ? 'high' : confPct >= 45 ? 'med' : 'low';
      const calib = MeasureEngine.getCalibrationInfo();

      let card = scroll.querySelector(`.mcard[data-label="${m.label}"]`);
      if (!card) {
        card = document.createElement('div');
        card.className = 'mcard';
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
        ${!calib.calibrated ? `<div class="mcard-dist">⚠️ Keep objects in frame to calibrate</div>` : ''}
      `;
    });
  }

  /* ═══════════════════════════════════
     CONTROLS
  ═══════════════════════════════════ */

  // Unit cycle: cm → in → mm → cm
  $('btn-unit').addEventListener('click', () => {
    const units = ['cm', 'in', 'mm'];
    S.unit = units[(units.indexOf(S.unit) + 1) % units.length];
    $('unit-label').textContent = S.unit;
    toast(`Unit: ${S.unit}`, '', 1200);
    // Redraw immediately with new unit
    if (S.lastMeasurements.length) Renderer.draw(S.lastMeasurements, S.unit);
  });

  // Flip camera
  $('btn-flip').addEventListener('click', async () => {
    setStatus('Switching camera…', 'paused');
    try {
      await Camera.flip();
      MeasureEngine.reset();
      setStatus('Detecting objects…', 'live');
      toast('Camera flipped', '', 1200);
    } catch {
      toast('Cannot flip camera', 'e');
      setStatus('Camera error', 'error');
    }
  });

  // Freeze / resume
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
      setStatus('Detecting objects…', 'live');
    }
  }

  // Capture
  $('btn-capture').addEventListener('click', () => {
    if (S.lastMeasurements.length === 0) {
      toast('No objects detected yet!', 'w'); return;
    }
    const img = Renderer.snapshot();
    saveHistory(img);
    flashEffect();
    toast('📸 Saved to history!', 's', 2000);
  });

  // Reset calibration
  $('btn-reset').addEventListener('click', () => {
    MeasureEngine.reset();
    updateCalibBadge();
    toast('Calibration reset', '', 1500);
  });

  // History
  $('btn-history').addEventListener('click', () => {
    closeAllDrawers();
    $('history-drawer').classList.remove('hidden');
    $('backdrop').classList.remove('hidden');
  });
  $('backdrop').addEventListener('click', closeAllDrawers);
  $('btn-clear').addEventListener('click', () => {
    S.history = [];
    $('history-list').innerHTML = '<li class="hist-empty">No measurements yet</li>';
    toast('History cleared', '', 1200);
  });

  // Window resize
  window.addEventListener('resize', () => Renderer.syncSize());

  /* ═══════════════════════════════════
     OBJECT FILTER
  ═══════════════════════════════════ */
  const CATEGORIES = {
    'Electronics':  ['laptop','cell phone','tv','keyboard','mouse','remote'],
    'Kitchen':      ['bottle','wine glass','cup','fork','knife','spoon','bowl'],
    'Appliances':   ['microwave','oven','toaster','refrigerator','sink'],
    'Furniture':    ['chair','couch','bed','dining table','potted plant','toilet'],
    'Food':         ['banana','apple','orange','sandwich','broccoli','carrot','pizza','donut','cake','hot dog'],
    'Vehicles':     ['car','bicycle','motorcycle','airplane','bus','train','truck','boat'],
    'People & Acc': ['person','backpack','handbag','suitcase','umbrella','tie'],
    'Outdoor':      ['traffic light','fire hydrant','stop sign','parking meter','bench'],
    'Animals':      ['dog','cat','bird','horse','sheep','cow','elephant','bear','zebra','giraffe'],
    'Sports':       ['sports ball','frisbee','skateboard','surfboard','tennis racket','baseball bat','baseball glove','snowboard','skis','kite'],
    'Other':        ['book','clock','vase','scissors','teddy bear','hair drier','toothbrush'],
  };

  // Build filter chips
  function buildFilterGrid() {
    const grid = $('filter-grid');
    grid.innerHTML = '';
    for (const [cat, items] of Object.entries(CATEGORIES)) {
      const catLabel = document.createElement('div');
      catLabel.style.cssText = 'width:100%;font-size:.65rem;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.06em;margin-top:8px;padding:0 2px;';
      catLabel.textContent = cat;
      grid.appendChild(catLabel);

      items.forEach(name => {
        const emoji = MeasureEngine.getEmoji ? MeasureEngine.getEmoji(name) : '📦';
        const chip = document.createElement('div');
        chip.className = 'filter-chip' + (S.selectedObjects.has(name) ? ' selected' : '');
        chip.dataset.obj = name;
        chip.innerHTML = `<span class="fc-emoji">${emoji}</span>${name}<span class="fc-check">✓</span>`;
        chip.addEventListener('click', () => {
          if (S.selectedObjects.has(name)) {
            S.selectedObjects.delete(name);
            chip.classList.remove('selected');
          } else {
            S.selectedObjects.add(name);
            chip.classList.add('selected');
          }
          updateFilterStatus();
        });
        grid.appendChild(chip);
      });
    }
  }

  function updateFilterStatus() {
    const count = S.selectedObjects.size;
    const btn = $('btn-filter');
    if (S.filterMode === 'custom' && count > 0) {
      btn.classList.add('active');
      toast(`Measuring ${count} object type${count > 1 ? 's' : ''}`, '', 1200);
    } else {
      btn.classList.remove('active');
    }
  }

  // Build grid on startup
  buildFilterGrid();

  // Filter button opens drawer
  $('btn-filter').addEventListener('click', () => {
    closeAllDrawers();
    $('filter-drawer').classList.remove('hidden');
    $('backdrop').classList.remove('hidden');
  });

  // Mode buttons
  $('fmode-all').addEventListener('click', () => {
    S.filterMode = 'all';
    $('fmode-all').classList.add('active');
    $('fmode-custom').classList.remove('active');
    $('filter-grid').classList.add('hidden');
    $('btn-filter').classList.remove('active');
    toast('Measuring all objects', '', 1200);
  });

  $('fmode-custom').addEventListener('click', () => {
    S.filterMode = 'custom';
    $('fmode-custom').classList.add('active');
    $('fmode-all').classList.remove('active');
    $('filter-grid').classList.remove('hidden');
    updateFilterStatus();
  });

  // Select All / Deselect All
  $('btn-filter-all').addEventListener('click', () => {
    const allNames = Object.values(CATEGORIES).flat();
    if (S.selectedObjects.size === allNames.length) {
      S.selectedObjects.clear();
      $('filter-grid').querySelectorAll('.filter-chip').forEach(c => c.classList.remove('selected'));
    } else {
      allNames.forEach(n => S.selectedObjects.add(n));
      $('filter-grid').querySelectorAll('.filter-chip').forEach(c => c.classList.add('selected'));
    }
    updateFilterStatus();
  });

  /* ═══════════════════════════════════
     ACCURACY TIPS
  ═══════════════════════════════════ */
  $('btn-tips').addEventListener('click', () => {
    closeAllDrawers();
    $('tips-drawer').classList.remove('hidden');
    $('backdrop').classList.remove('hidden');
  });

  $('btn-tips-close').addEventListener('click', () => {
    $('tips-drawer').classList.add('hidden');
    $('backdrop').classList.add('hidden');
  });

  /* ═══════════════════════════════════
     DRAWER HELPERS
  ═══════════════════════════════════ */
  function closeAllDrawers() {
    $('history-drawer').classList.add('hidden');
    $('filter-drawer').classList.add('hidden');
    $('tips-drawer').classList.add('hidden');
    $('backdrop').classList.add('hidden');
  }


  /* ═══════════════════════════════════
     HISTORY
  ═══════════════════════════════════ */
  function saveHistory(imgUrl) {
    const ts  = new Date();
    const top = S.lastMeasurements[0];
    S.history.unshift({ img: imgUrl, meas: S.lastMeasurements, ts });

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

  console.log('[MeasureAI v3] ✓ On-device AI running — no API key needed');
})();
