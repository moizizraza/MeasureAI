/* ════════════════════════════════════════════════════
   dimensions.js — On-Device AI Measurement Engine

   Strategy:
   1. Real-world dimension database for all 80 COCO classes
   2. Focal-length estimation from known object bounding box
   3. Multi-object cross-calibration (best-fit scale factor)
   4. Distance estimation for each detected object
   5. Smooth temporal averaging to stabilise measurements
   ════════════════════════════════════════════════════ */

const MeasureEngine = (() => {

  /* ── Real-world dimension DB (mm) ──────────────────
     widthMm, heightMm, depthMm (depth optional)
     Source: ISO standards, manufacturer specs, averages  */
  const DIM_DB = {
    // People
    'person':           { w: 450,  h: 1700, d: 250,  emoji:'🧍', confidence:'med' },
    // Vehicles
    'bicycle':          { w: 600,  h: 1000, d: 1700, emoji:'🚲', confidence:'med' },
    'car':              { w: 1800, h: 1450, d: 4500, emoji:'🚗', confidence:'med' },
    'motorcycle':       { w: 800,  h: 1100, d: 2200, emoji:'🏍️', confidence:'med' },
    'airplane':         { w:35000, h: 4000, d:60000, emoji:'✈️', confidence:'low' },
    'bus':              { w: 2500, h: 3000, d: 12000,emoji:'🚌', confidence:'med' },
    'train':            { w: 3200, h: 3800, d:20000, emoji:'🚆', confidence:'low' },
    'truck':            { w: 2500, h: 2800, d: 8000, emoji:'🚚', confidence:'med' },
    'boat':             { w: 2000, h: 1000, d: 5000, emoji:'⛵', confidence:'low' },
    // Outdoor
    'traffic light':    { w: 300,  h: 900,  d: 300,  emoji:'🚦', confidence:'high' },
    'fire hydrant':     { w: 250,  h: 600,  d: 250,  emoji:'🧯', confidence:'high' },
    'stop sign':        { w: 750,  h: 750,  d: 10,   emoji:'🛑', confidence:'high' },
    'parking meter':    { w: 150,  h: 1200, d: 150,  emoji:'🅿️', confidence:'med' },
    'bench':            { w: 1500, h: 800,  d: 600,  emoji:'🪑', confidence:'med' },
    // Animals
    'bird':             { w: 200,  h: 150,  d: 250,  emoji:'🐦', confidence:'low' },
    'cat':              { w: 300,  h: 250,  d: 450,  emoji:'🐱', confidence:'med' },
    'dog':              { w: 500,  h: 450,  d: 600,  emoji:'🐕', confidence:'med' },
    'horse':            { w: 1500, h: 1500, d: 2500, emoji:'🐴', confidence:'med' },
    'sheep':            { w: 800,  h: 700,  d: 1200, emoji:'🐑', confidence:'med' },
    'cow':              { w: 1800, h: 1400, d: 2500, emoji:'🐄', confidence:'med' },
    'elephant':         { w: 2500, h: 2800, d: 5000, emoji:'🐘', confidence:'med' },
    'bear':             { w: 1000, h: 1100, d: 1800, emoji:'🐻', confidence:'low' },
    'zebra':            { w: 1500, h: 1400, d: 2400, emoji:'🦓', confidence:'med' },
    'giraffe':          { w: 1200, h: 5000, d: 1800, emoji:'🦒', confidence:'med' },
    // Accessories
    'backpack':         { w: 300,  h: 450,  d: 180,  emoji:'🎒', confidence:'med' },
    'umbrella':         { w: 900,  h: 900,  d: 30,   emoji:'☂️', confidence:'med' },
    'handbag':          { w: 300,  h: 250,  d: 100,  emoji:'👜', confidence:'med' },
    'tie':              { w: 80,   h: 1400, d: 5,    emoji:'👔', confidence:'med' },
    'suitcase':         { w: 450,  h: 700,  d: 250,  emoji:'🧳', confidence:'high' },
    // Sports
    'frisbee':          { w: 270,  h: 270,  d: 30,   emoji:'🥏', confidence:'high' },
    'skis':             { w: 80,   h: 1700, d: 80,   emoji:'🎿', confidence:'med' },
    'snowboard':        { w: 300,  h: 1500, d: 20,   emoji:'🏂', confidence:'med' },
    'sports ball':      { w: 220,  h: 220,  d: 220,  emoji:'⚽', confidence:'high' },
    'kite':             { w: 800,  h: 600,  d: 10,   emoji:'🪁', confidence:'low' },
    'baseball bat':     { w: 60,   h: 900,  d: 60,   emoji:'🏏', confidence:'high' },
    'baseball glove':   { w: 280,  h: 280,  d: 120,  emoji:'🥊', confidence:'high' },
    'skateboard':       { w: 200,  h: 800,  d: 100,  emoji:'🛹', confidence:'high' },
    'surfboard':        { w: 500,  h: 1800, d: 80,   emoji:'🏄', confidence:'med' },
    'tennis racket':    { w: 280,  h: 680,  d: 30,   emoji:'🎾', confidence:'high' },
    // Kitchen
    'bottle':           { w: 80,   h: 250,  d: 80,   emoji:'🍶', confidence:'high' },
    'wine glass':       { w: 80,   h: 220,  d: 80,   emoji:'🍷', confidence:'high' },
    'cup':              { w: 85,   h: 95,   d: 85,   emoji:'☕', confidence:'high' },
    'fork':             { w: 25,   h: 195,  d: 10,   emoji:'🍴', confidence:'high' },
    'knife':            { w: 20,   h: 230,  d: 8,    emoji:'🔪', confidence:'high' },
    'spoon':            { w: 40,   h: 190,  d: 20,   emoji:'🥄', confidence:'high' },
    'bowl':             { w: 160,  h: 70,   d: 160,  emoji:'🥣', confidence:'high' },
    // Food
    'banana':           { w: 40,   h: 190,  d: 35,   emoji:'🍌', confidence:'high' },
    'apple':            { w: 75,   h: 75,   d: 75,   emoji:'🍎', confidence:'high' },
    'sandwich':         { w: 150,  h: 60,   d: 120,  emoji:'🥪', confidence:'med' },
    'orange':           { w: 75,   h: 75,   d: 75,   emoji:'🍊', confidence:'high' },
    'broccoli':         { w: 180,  h: 200,  d: 180,  emoji:'🥦', confidence:'high' },
    'carrot':           { w: 35,   h: 200,  d: 35,   emoji:'🥕', confidence:'high' },
    'hot dog':          { w: 50,   h: 180,  d: 50,   emoji:'🌭', confidence:'high' },
    'pizza':            { w: 300,  h: 300,  d: 30,   emoji:'🍕', confidence:'high' },
    'donut':            { w: 100,  h: 100,  d: 35,   emoji:'🍩', confidence:'high' },
    'cake':             { w: 200,  h: 120,  d: 200,  emoji:'🎂', confidence:'high' },
    // Furniture
    'chair':            { w: 500,  h: 900,  d: 500,  emoji:'🪑', confidence:'high' },
    'couch':            { w: 2000, h: 850,  d: 900,  emoji:'🛋️', confidence:'high' },
    'potted plant':     { w: 250,  h: 400,  d: 250,  emoji:'🪴', confidence:'med' },
    'bed':              { w: 1600, h: 500,  d: 2100, emoji:'🛏️', confidence:'high' },
    'dining table':     { w: 1200, h: 750,  d: 800,  emoji:'🍽️', confidence:'high' },
    'toilet':           { w: 380,  h: 750,  d: 650,  emoji:'🚽', confidence:'high' },
    // Electronics (excellent calibration objects)
    'tv':               { w: 1230, h: 720,  d: 80,   emoji:'📺', confidence:'high' },
    'laptop':           { w: 330,  h: 220,  d: 20,   emoji:'💻', confidence:'high' },
    'mouse':            { w: 65,   h: 120,  d: 38,   emoji:'🖱️', confidence:'high' },
    'remote':           { w: 55,   h: 200,  d: 18,   emoji:'📡', confidence:'high' },
    'keyboard':         { w: 440,  h: 140,  d: 20,   emoji:'⌨️', confidence:'high' },
    'cell phone':       { w: 71,   h: 147,  d: 8,    emoji:'📱', confidence:'high' },
    // Appliances
    'microwave':        { w: 540,  h: 330,  d: 430,  emoji:'📦', confidence:'high' },
    'oven':             { w: 600,  h: 850,  d: 600,  emoji:'🍳', confidence:'high' },
    'toaster':          { w: 280,  h: 200,  d: 160,  emoji:'🍞', confidence:'high' },
    'sink':             { w: 500,  h: 200,  d: 400,  emoji:'🚰', confidence:'high' },
    'refrigerator':     { w: 700,  h: 1800, d: 700,  emoji:'🧊', confidence:'high' },
    // Other
    'book':             { w: 148,  h: 210,  d: 20,   emoji:'📚', confidence:'high' },
    'clock':            { w: 300,  h: 300,  d: 50,   emoji:'🕐', confidence:'high' },
    'vase':             { w: 120,  h: 250,  d: 120,  emoji:'🏺', confidence:'high' },
    'scissors':         { w: 80,   h: 220,  d: 10,   emoji:'✂️', confidence:'high' },
    'teddy bear':       { w: 300,  h: 350,  d: 200,  emoji:'🧸', confidence:'high' },
    'hair drier':       { w: 100,  h: 280,  d: 100,  emoji:'💨', confidence:'high' },
    'toothbrush':       { w: 20,   h: 190,  d: 20,   emoji:'🪥', confidence:'high' },
  };

  // Fallback for unknown classes
  const FALLBACK = { w: 200, h: 200, d: 100, emoji:'📦', confidence:'low' };

  // ── Calibration state ────────────────────────────
  // pixelsPerMm computed from best-confidence detected objects
  let calibrationHistory = [];  // [{ pxPerMm, confidence, label }]
  let globalPxPerMm      = null;
  let frameCount         = 0;

  // ── Measurement smoothing ─────────────────────────
  // Store last N measurements per label for averaging
  const smoothingBuffer = {};  // { label: [measurements] }
  const SMOOTH_N = 5;

  /* ────────────────────────────────────────────────
     Core measurement function
     Given a detected prediction + canvas dimensions,
     returns real-world measurement data.
   ──────────────────────────────────────────────── */
  function measure(pred, videoW, videoH) {
    const label = pred.class.toLowerCase();
    const dim   = DIM_DB[label] || FALLBACK;
    const [, , bboxW, bboxH] = pred.bbox;

    // Pixel-per-mm: derived from this object's known real width
    const localPxPerMm = bboxW / dim.w;
    const localPxPerMmH = bboxH / dim.h;

    // Use horizontal ratio as primary (usually more reliable)
    const pxPerMm = localPxPerMm;

    // Estimate distance using simple pinhole camera model
    // distance = (realWidth_mm * focalLength_px) / bbox_px
    // We estimate focal length from sensor (typical phone: ~1000-1500px for 1280px wide)
    const estimatedFocal = videoW * 0.8;
    const distanceMm = (dim.w * estimatedFocal) / bboxW;
    const distanceCm = distanceMm / 10;

    // Compute measured dimensions using calibrated pxPerMm
    const effectivePxPerMm = globalPxPerMm || pxPerMm;
    const measuredW = bboxW / effectivePxPerMm;
    const measuredH = bboxH / effectivePxPerMm;

    // Smooth over last N frames
    const smoothed = smooth(label, { w: measuredW, h: measuredH, dist: distanceCm });

    return {
      label,
      emoji:      dim.emoji,
      confidence: dim.confidence,
      confScore:  pred.score,
      widthMm:    smoothed.w,
      heightMm:   smoothed.h,
      distanceCm: smoothed.dist,
      pxPerMm,
      knownDim:   dim,
    };
  }

  /* ────────────────────────────────────────────────
     Auto-calibration:
     Each frame, collect all detected objects' implied
     px/mm ratios. Weight by confidence + bbox area.
     Keep a rolling average → globalPxPerMm.
   ──────────────────────────────────────────────── */
  function calibrate(predictions, videoW, videoH) {
    frameCount++;

    const samples = predictions.map(pred => {
      const label = pred.class.toLowerCase();
      const dim   = DIM_DB[label];
      if (!dim || dim.confidence === 'low') return null;

      const [, , bboxW, bboxH] = pred.bbox;
      const pxPerMm = bboxW / dim.w;
      const area    = bboxW * bboxH;
      const confWeight = dim.confidence === 'high' ? 3 : 1;
      const weight = confWeight * pred.score * (area / (videoW * videoH));

      return { pxPerMm, weight, label };
    }).filter(Boolean);

    if (samples.length === 0) return;

    // Weighted average
    const totalWeight = samples.reduce((s, x) => s + x.weight, 0);
    const weightedPx  = samples.reduce((s, x) => s + x.pxPerMm * x.weight, 0);
    const newPxPerMm  = weightedPx / totalWeight;

    // Rolling calibration history
    calibrationHistory.push(newPxPerMm);
    if (calibrationHistory.length > 30) calibrationHistory.shift();

    // Reject outliers using median
    const sorted = [...calibrationHistory].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    globalPxPerMm = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
  }

  /* ── Temporal smoothing ── */
  function smooth(label, measurement) {
    if (!smoothingBuffer[label]) smoothingBuffer[label] = [];
    const buf = smoothingBuffer[label];
    buf.push(measurement);
    if (buf.length > SMOOTH_N) buf.shift();

    const avg = k => buf.reduce((s, m) => s + m[k], 0) / buf.length;
    return { w: avg('w'), h: avg('h'), dist: avg('dist') };
  }

  /* ── Formatting ── */
  function format(mm, unit = 'cm') {
    if (mm === null || mm === undefined || isNaN(mm)) return '—';
    if (unit === 'cm')  return `${(mm / 10).toFixed(1)} cm`;
    if (unit === 'in')  return `${(mm / 25.4).toFixed(2)}"`;
    if (unit === 'mm')  return `${Math.round(mm)} mm`;
    return `${(mm / 10).toFixed(1)} cm`;
  }

  function formatDist(cm) {
    if (!cm || isNaN(cm)) return null;
    if (cm < 100) return `${Math.round(cm)} cm away`;
    return `${(cm / 100).toFixed(1)} m away`;
  }

  function reset() {
    calibrationHistory = [];
    globalPxPerMm = null;
    Object.keys(smoothingBuffer).forEach(k => delete smoothingBuffer[k]);
    frameCount = 0;
  }

  function getCalibrationInfo() {
    if (!globalPxPerMm) return { calibrated: false, pxPerMm: null, sampleCount: 0 };
    return {
      calibrated:   true,
      pxPerMm:      globalPxPerMm,
      sampleCount:  calibrationHistory.length,
      accuracy:     calibrationHistory.length >= 10 ? 'high' : calibrationHistory.length >= 5 ? 'med' : 'low',
    };
  }

  function getEmoji(label) {
    return (DIM_DB[label.toLowerCase()] || FALLBACK).emoji;
  }

  return {
    measure,
    calibrate,
    format,
    formatDist,
    reset,
    getCalibrationInfo,
    getEmoji,
    DIM_DB,
  };
})();
