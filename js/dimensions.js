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
    // Other common objects
    'book':             { w: 148,  h: 210,  d: 20,   emoji:'📚', confidence:'high' },
    'clock':            { w: 300,  h: 300,  d: 50,   emoji:'🕐', confidence:'high' },
    'vase':             { w: 120,  h: 250,  d: 120,  emoji:'🏺', confidence:'high' },
    'scissors':         { w: 80,   h: 220,  d: 10,   emoji:'✂️', confidence:'high' },
    'teddy bear':       { w: 300,  h: 350,  d: 200,  emoji:'🧸', confidence:'high' },
    'hair drier':       { w: 100,  h: 280,  d: 100,  emoji:'💨', confidence:'high' },
    'toothbrush':       { w: 20,   h: 190,  d: 20,   emoji:'🪥', confidence:'high' },
    // Stationery / Office
    'pencil':           { w: 8,    h: 190,  d: 8,    emoji:'✏️', confidence:'high' },
    'pen':              { w: 10,   h: 148,  d: 10,   emoji:'🖊️', confidence:'high' },
    'marker':           { w: 14,   h: 140,  d: 14,   emoji:'🖍️', confidence:'high' },
    'eraser':           { w: 60,   h: 25,   d: 20,   emoji:'🟪', confidence:'high' },
    'ruler':            { w: 30,   h: 300,  d: 4,    emoji:'📏', confidence:'high' },
    'stapler':          { w: 65,   h: 130,  d: 40,   emoji:'🖇️', confidence:'high' },
    'calculator':       { w: 80,   h: 140,  d: 12,   emoji:'🧮', confidence:'high' },
    'clipboard':        { w: 230,  h: 340,  d: 12,   emoji:'📋', confidence:'high' },
    'sticky note':      { w: 76,   h: 76,   d: 5,    emoji:'📝', confidence:'high' },
    'envelope':         { w: 229,  h: 162,  d: 3,    emoji:'✉️', confidence:'high' },
    'magazine':         { w: 203,  h: 275,  d: 8,    emoji:'📰', confidence:'high' },
    'newspaper':        { w: 380,  h: 580,  d: 5,    emoji:'🗞️', confidence:'med' },
    // Payment / ID
    'credit card':      { w: 85.6, h: 53.9, d: 0.8,  emoji:'💳', confidence:'high' },
    'dollar bill':      { w: 156,  h: 66,   d: 0.11, emoji:'💵', confidence:'high' },
    'coin':             { w: 24,   h: 24,   d: 2,    emoji:'🪙', confidence:'high' },
    'passport':         { w: 125,  h: 88,   d: 5,    emoji:'🛂', confidence:'high' },
    // Personal accessories
    'watch':            { w: 44,   h: 38,   d: 12,   emoji:'⌚', confidence:'high' },
    'sunglasses':       { w: 145,  h: 55,   d: 10,   emoji:'🕶️', confidence:'high' },
    'glasses':          { w: 140,  h: 50,   d: 10,   emoji:'👓', confidence:'high' },
    'wallet':           { w: 110,  h: 90,   d: 15,   emoji:'👛', confidence:'high' },
    'belt':             { w: 1100, h: 35,   d: 3,    emoji:'👔', confidence:'med' },
    'shoe':             { w: 100,  h: 280,  d: 100,  emoji:'👟', confidence:'high' },
    'hat':              { w: 280,  h: 120,  d: 300,  emoji:'🧢', confidence:'med' },
    // Bathroom / Personal care
    'toothpaste':       { w: 55,   h: 195,  d: 35,   emoji:'🪥', confidence:'high' },
    'soap bar':         { w: 90,   h: 60,   d: 35,   emoji:'🧼', confidence:'high' },
    'shampoo bottle':   { w: 70,   h: 230,  d: 55,   emoji:'🧴', confidence:'high' },
    'razor':            { w: 40,   h: 160,  d: 15,   emoji:'🪒', confidence:'high' },
    'perfume bottle':   { w: 55,   h: 120,  d: 40,   emoji:'🧴', confidence:'med' },
    // Tools / Hardware
    'screwdriver':      { w: 25,   h: 250,  d: 25,   emoji:'🔧', confidence:'high' },
    'wrench':           { w: 40,   h: 280,  d: 15,   emoji:'🔩', confidence:'high' },
    'hammer':           { w: 50,   h: 320,  d: 40,   emoji:'🔨', confidence:'high' },
    'tape measure':     { w: 80,   h: 80,   d: 35,   emoji:'📏', confidence:'high' },
    'level':            { w: 30,   h: 400,  d: 30,   emoji:'📐', confidence:'high' },
    'paintbrush':       { w: 20,   h: 280,  d: 15,   emoji:'🖌️', confidence:'high' },
    'padlock':          { w: 50,   h: 70,   d: 25,   emoji:'🔒', confidence:'high' },
    'key':              { w: 20,   h: 75,   d: 5,    emoji:'🔑', confidence:'high' },
    // Batteries / Tech accessories
    'aa battery':       { w: 14.5, h: 50.5, d: 14.5, emoji:'🔋', confidence:'high' },
    'd battery':        { w: 34.2, h: 61.5, d: 34.2, emoji:'🔋', confidence:'high' },
    'usb drive':        { w: 20,   h: 65,   d: 10,   emoji:'💾', confidence:'high' },
    'sd card':          { w: 24,   h: 32,   d: 2.1,  emoji:'💾', confidence:'high' },
    // Power / Cables
    'power strip':      { w: 70,   h: 350,  d: 45,   emoji:'🔌', confidence:'med' },
    'extension cord':   { w: 20,   h: 1800, d: 15,   emoji:'🔌', confidence:'low' },
    // Lighting
    'candle':           { w: 55,   h: 190,  d: 55,   emoji:'🕯️', confidence:'high' },
    'matchbox':         { w: 55,   h: 35,   d: 18,   emoji:'🔥', confidence:'high' },
    'lighter':          { w: 25,   h: 75,   d: 13,   emoji:'🔥', confidence:'high' },
    // Sports balls (individual instead of generic sports ball)
    'basketball':       { w: 241,  h: 241,  d: 241,  emoji:'🏀', confidence:'high' },
    'soccer ball':      { w: 220,  h: 220,  d: 220,  emoji:'⚽', confidence:'high' },
    'tennis ball':      { w: 67,   h: 67,   d: 67,   emoji:'🎾', confidence:'high' },
    'golf ball':        { w: 43,   h: 43,   d: 43,   emoji:'⛳', confidence:'high' },
    'baseball':         { w: 74,   h: 74,   d: 74,   emoji:'⚾', confidence:'high' },
    'ping pong ball':   { w: 40,   h: 40,   d: 40,   emoji:'🏓', confidence:'high' },
    'hockey puck':      { w: 76,   h: 25,   d: 76,   emoji:'🏒', confidence:'high' },
    // Toys / Games
    'playing card':     { w: 57,   h: 89,   d: 0.27, emoji:'🃏', confidence:'high' },
    'chess piece':      { w: 35,   h: 75,   d: 35,   emoji:'♟️', confidence:'high' },
    'dice':             { w: 16,   h: 16,   d: 16,   emoji:'🎲', confidence:'high' },
    'lego brick':       { w: 32,   h: 11,   d: 32,   emoji:'🧱', confidence:'high' },
    'rubber duck':      { w: 90,   h: 80,   d: 90,   emoji:'🐥', confidence:'high' },
    // Buckets / Cleaning
    'bucket':           { w: 270,  h: 330,  d: 270,  emoji:'🪣', confidence:'med' },
    'trash can':        { w: 290,  h: 420,  d: 290,  emoji:'🗑️', confidence:'med' },
    // Music
    'guitar':           { w: 380,  h: 1040, d: 130,  emoji:'🎸', confidence:'med' },
    'violin':           { w: 200,  h: 600,  d: 80,   emoji:'🎻', confidence:'med' },
    'piano key':        { w: 23,   h: 148,  d: 14,   emoji:'🎹', confidence:'high' },
    'headphones':       { w: 170,  h: 185,  d: 80,   emoji:'🎧', confidence:'high' },
    'earphones':        { w: 15,   h: 30,   d: 15,   emoji:'🎧', confidence:'med' },
    'microphone':       { w: 55,   h: 180,  d: 55,   emoji:'🎤', confidence:'high' },
    // Medical / first aid
    'syringe':          { w: 20,   h: 130,  d: 20,   emoji:'💉', confidence:'med' },
    'pill bottle':      { w: 50,   h: 100,  d: 50,   emoji:'💊', confidence:'high' },
    'bandage':          { w: 72,   h: 19,   d: 2,    emoji:'🩹', confidence:'high' },
    // Cooking utensils
    'pan':              { w: 280,  h: 60,   d: 280,  emoji:'🍳', confidence:'high' },
    'pot':              { w: 240,  h: 160,  d: 240,  emoji:'🫕', confidence:'high' },
    'cutting board':    { w: 300,  h: 200,  d: 20,   emoji:'🥩', confidence:'high' },
    'colander':         { w: 240,  h: 140,  d: 240,  emoji:'🥗', confidence:'med' },
    // Geometric / common household
    'canteen':          { w: 75,   h: 220,  d: 75,   emoji:'🧃', confidence:'high' },
    'mug':              { w: 95,   h: 100,  d: 95,   emoji:'☕', confidence:'high' },
    'mason jar':        { w: 86,   h: 140,  d: 86,   emoji:'🫙', confidence:'high' },
    'cardboard box':    { w: 400,  h: 300,  d: 400,  emoji:'📦', confidence:'low' },
    'picture frame':    { w: 200,  h: 250,  d: 20,   emoji:'🖼️', confidence:'high' },
    'candle holder':    { w: 80,   h: 100,  d: 80,   emoji:'🕯️', confidence:'high' },
    'tissue box':       { w: 240,  h: 115,  d: 120,  emoji:'🤧', confidence:'high' },
    'staple gun':       { w: 60,   h: 155,  d: 90,   emoji:'🔫', confidence:'high' },
  };

  // Fallback for unknown classes — still measured using calibrated pxPerMm
  const FALLBACK = { w: 200, h: 200, d: 100, emoji:'📦', confidence:'low' };

  // ── PRECISION REFERENCE OBJECTS ──────────────────────
  // These are used for high-accuracy auto-calibration (exact ISO dimensions)
  const REFERENCE_OBJECTS = {
    'cell phone':   { w: 71,    h: 147,   axis: 'h', emoji: '📱' },  // avg smartphone
    'laptop':       { w: 330,   h: 220,   axis: 'w', emoji: '💻' },
    'keyboard':     { w: 440,   h: 140,   axis: 'w', emoji: '⌨️' },
    'book':         { w: 148,   h: 210,   axis: 'h', emoji: '📚' },  // A5
    'bottle':       { w: 80,    h: 250,   axis: 'h', emoji: '🍶' },
    'cup':          { w: 85,    h: 95,    axis: 'h', emoji: '☕' },
    'sports ball':  { w: 220,   h: 220,   axis: 'w', emoji: '⚽' },
    'frisbee':      { w: 270,   h: 270,   axis: 'w', emoji: '🥏' },
    'skateboard':   { w: 200,   h: 800,   axis: 'h', emoji: '🛹' },
    'baseball bat': { w: 60,    h: 900,   axis: 'h', emoji: '🏏' },
    'tennis racket':{ w: 280,   h: 680,   axis: 'h', emoji: '🎾' },
    'suitcase':     { w: 450,   h: 700,   axis: 'h', emoji: '🧳' },
    'stop sign':    { w: 750,   h: 750,   axis: 'w', emoji: '🛑' },
    'clock':        { w: 300,   h: 300,   axis: 'w', emoji: '🕐' },
    'tv':           { w: 1230,  h: 720,   axis: 'w', emoji: '📺' },
    'scissors':     { w: 80,    h: 220,   axis: 'h', emoji: '✂️' },
    'mouse':        { w: 65,    h: 120,   axis: 'h', emoji: '🖱️' },
    'remote':       { w: 55,    h: 200,   axis: 'h', emoji: '📡' },
    'toothbrush':   { w: 20,    h: 190,   axis: 'h', emoji: '🪥' },
    'fork':         { w: 25,    h: 195,   axis: 'h', emoji: '🍴' },
    'knife':        { w: 20,    h: 230,   axis: 'h', emoji: '🔪' },
    'spoon':        { w: 40,    h: 190,   axis: 'h', emoji: '🥄' },
    'banana':       { w: 40,    h: 190,   axis: 'h', emoji: '🍌' },
    'apple':        { w: 75,    h: 75,    axis: 'w', emoji: '🍎' },
  };

  // ── Calibration state ────────────────────────────
  let calibrationHistory = [];
  let globalPxPerMm      = null;
  let frameCount         = 0;
  let bestCalibSource    = null;    // label of best reference object used
  let calibAccuracy      = 'low';  // 'low' | 'med' | 'high' | 'precise'

  // ── Measurement smoothing ─────────────────────────
  // Store last N measurements per label for averaging
  const smoothingBuffer = {};  // { label: [measurements] }
  const SMOOTH_N = 5;

  // ── Manual & fine-tune calibration ──────────────
  let manualPxPerMm   = null;
  let scaleMultiplier = 1.0;

  function setManualScale(pxPerMm) {
    if (pxPerMm && pxPerMm > 0) {
      manualPxPerMm = pxPerMm;
      globalPxPerMm = pxPerMm;
      calibrationHistory = [pxPerMm];
    }
  }

  function setScaleMultiplier(mult) {
    scaleMultiplier = Math.max(0.5, Math.min(2.0, mult));
  }

  function getScaleMultiplier() {
    return scaleMultiplier;
  }

  function getEffectivePxPerMm() {
    return (manualPxPerMm || globalPxPerMm || 1.0) * scaleMultiplier;
  }

  function pxToMm(pixels) {
    const eff = getEffectivePxPerMm();
    return pixels / eff;
  }

  function isManuallyLocked() {
    return manualPxPerMm !== null;
  }

  /* ────────────────────────────────────────────────
     Core measurement function
   ──────────────────────────────────────────────── */
  function measure(pred, videoW, videoH) {
    const label = pred.class.toLowerCase();
    const dim   = DIM_DB[label] || FALLBACK;
    const [, , rawW, rawH] = pred.bbox;

    // Compensate for SSD bounding box padding (~5% margin)
    const bboxW = rawW * 0.95;
    const bboxH = rawH * 0.95;

    // ── Perspective correction ──────────────────────────
    // If an object is viewed at an angle, its bounding box aspect ratio
    // deviates from the real-world aspect ratio. We correct for this.
    const realAspect = dim.w / dim.h;
    const bboxAspect = bboxW / bboxH;
    const aspectRatio = realAspect / bboxAspect;
    // aspectRatioError: 0 = head-on, 1 = very angled
    const aspectRatioError = Math.min(1, Math.abs(1 - aspectRatio));

    // Width-based scale estimate (primary)
    const pxPerMmW = bboxW / dim.w;
    // Height-based scale estimate (secondary)
    const pxPerMmH = bboxH / dim.h;

    // Confidence-weighted blend: use both axes if object is well-framed
    const wt = 1 - aspectRatioError * 0.5; // confidence in width axis
    const localPxPerMm = (pxPerMmW * wt + pxPerMmH * (1 - wt));

    // ── Improved distance estimation (pinhole model) ──
    // focalLengthPx ≈ videoW * 1.1 (empirically tuned for typical phone cameras)
    const estimatedFocal = videoW * 1.1;
    const distanceMm = dim.w > 0 ? (dim.w * estimatedFocal) / bboxW : 0;
    const distanceCm = distanceMm / 10;

    // ── Effective pxPerMm (calibrated) ──
    const effectivePxPerMm = (manualPxPerMm || globalPxPerMm || localPxPerMm) * scaleMultiplier;

    // Compute real-world dimensions
    let measuredW = bboxW / effectivePxPerMm;
    let measuredH = bboxH / effectivePxPerMm;

    // Apply perspective correction to width
    // If the bbox is too wide/narrow relative to expected, bring it closer to real
    if (aspectRatioError > 0.15 && aspectRatioError < 0.7) {
      measuredW = measuredW * Math.max(0.85, Math.min(1.15, realAspect / bboxAspect));
    }

    // Smooth over last N frames (Bayesian-style: reject outliers > 25% from median)
    const smoothed = smooth(label, { w: measuredW, h: measuredH, dist: distanceCm });

    return {
      label,
      emoji:      dim.emoji,
      confidence: dim.confidence,
      confScore:  pred.score,
      widthMm:    smoothed.w,
      heightMm:   smoothed.h,
      depthMm:    dim.d || null,
      distanceCm: smoothed.dist,
      pxPerMm:    effectivePxPerMm,
      knownDim:   dim,
      volumeCm3:  dim.d ? (smoothed.w * smoothed.h * dim.d) / 1000 : null,
    };
  }

  /* ────────────────────────────────────────────────
     Auto-calibration (only updates if NOT manually locked)
   ──────────────────────────────────────────────── */
  function calibrate(predictions, videoW, videoH) {
    frameCount++;
    if (manualPxPerMm !== null) return; // Locked by user

    let bestPrecisePx = null, bestPreciseWeight = 0;
    const samples = [];

    for (const pred of predictions) {
      const label = pred.class.toLowerCase();
      const [, , rawW, rawH] = pred.bbox;
      const bboxW = rawW * 0.95;
      const bboxH = rawH * 0.95;
      const area  = rawW * rawH;
      const areaPct = area / (videoW * videoH);

      // ── TIER 1: Precision reference objects (highest priority) ──
      const ref = REFERENCE_OBJECTS[label];
      if (ref && pred.score >= 0.6 && areaPct >= 0.01) {
        // Use the specified axis for most reliable px/mm ratio
        const realMm = ref.axis === 'h' ? ref.h : ref.w;
        const bboxPx = ref.axis === 'h' ? bboxH : bboxW;
        if (realMm > 0 && bboxPx > 10) {
          const px = bboxPx / realMm;
          const w  = pred.score * areaPct * 5; // heavy weight
          if (w > bestPreciseWeight) {
            bestPrecisePx     = px;
            bestPreciseWeight = w;
            bestCalibSource   = label;
            calibAccuracy     = 'precise';
          }
        }
      }

      // ── TIER 2: DIM_DB high-confidence objects ──
      const dim = DIM_DB[label];
      if (dim && dim.confidence !== 'low') {
        const pxPerMm   = bboxW / dim.w;
        const confWeight = dim.confidence === 'high' ? 3 : 1;
        const weight     = confWeight * pred.score * areaPct;
        samples.push({ pxPerMm, weight, label });
      }
    }

    // If we have a precise reference → use it directly (locks in for this batch)
    if (bestPrecisePx !== null) {
      calibrationHistory.push(bestPrecisePx);
      if (calibrationHistory.length > 40) calibrationHistory.shift();
    } else if (samples.length > 0) {
      // Weighted average of tier-2 samples
      const totalWeight = samples.reduce((s, x) => s + x.weight, 0);
      if (totalWeight > 0) {
        const newPxPerMm = samples.reduce((s, x) => s + x.pxPerMm * x.weight, 0) / totalWeight;
        calibrationHistory.push(newPxPerMm);
        if (calibrationHistory.length > 40) calibrationHistory.shift();
        if (!bestCalibSource && calibrationHistory.length >= 5) {
          calibAccuracy = calibrationHistory.length >= 15 ? 'high' : 'med';
        }
      }
    }

    if (calibrationHistory.length === 0) return;

    // Robust median for final pxPerMm (rejects outliers automatically)
    const sorted = [...calibrationHistory].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    globalPxPerMm = sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
  }

  /* ── Temporal smoothing with outlier rejection ── */
  function smooth(label, measurement) {
    if (!smoothingBuffer[label]) smoothingBuffer[label] = [];
    const buf = smoothingBuffer[label];

    // Compute running median before adding new sample
    const median = k => {
      if (buf.length === 0) return measurement[k];
      const sorted = [...buf].map(m => m[k]).sort((a, b) => a - b);
      const m = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[m] : (sorted[m-1] + sorted[m]) / 2;
    };

    // Reject outliers: if new measurement is >30% away from median, clamp it
    const medW = median('w'), medH = median('h');
    if (buf.length >= 3) {
      const clamp = (v, ref) => Math.abs(v - ref) / ref > 0.30 ? ref * 0.7 + v * 0.3 : v;
      measurement = { ...measurement, w: clamp(measurement.w, medW), h: clamp(measurement.h, medH) };
    }

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

  function formatArea(mm2, unit = 'cm') {
    if (!mm2 || isNaN(mm2)) return '—';
    if (unit === 'cm')  return `${(mm2 / 100).toFixed(1)} cm²`;
    if (unit === 'in')  return `${(mm2 / 645.16).toFixed(2)} in²`;
    if (unit === 'mm')  return `${Math.round(mm2)} mm²`;
    return `${(mm2 / 100).toFixed(1)} cm²`;
  }

  function formatVolume(cm3) {
    if (!cm3 || isNaN(cm3)) return null;
    if (cm3 < 1000) return `${cm3.toFixed(0)} cm³`;
    return `${(cm3 / 1000).toFixed(1)} L`;
  }

  function reset() {
    calibrationHistory = [];
    globalPxPerMm = null;
    manualPxPerMm = null;
    scaleMultiplier = 1.0;
    Object.keys(smoothingBuffer).forEach(k => delete smoothingBuffer[k]);
    frameCount = 0;
  }

  function getCalibrationInfo() {
    const isLocked = manualPxPerMm !== null;
    const pxMm = getEffectivePxPerMm();
    if (!globalPxPerMm && !isLocked) return { calibrated: false, pxPerMm: null, sampleCount: 0, isLocked: false, accuracy: 'uncalibrated' };
    const accuracy = isLocked ? 'precise (manual)' :
                     calibAccuracy === 'precise' ? `precise via ${bestCalibSource}` :
                     calibAccuracy === 'high'    ? 'high' :
                     calibAccuracy === 'med'     ? 'medium' : 'low';
    return {
      calibrated:     true,
      pxPerMm:        pxMm,
      sampleCount:    calibrationHistory.length,
      accuracy,
      calibAccuracy,
      bestCalibSource,
      isLocked,
      scaleMultiplier,
    };
  }

  /* ── Measure any bounding box without a known class ── */
  /* Used for the "measure anything" tap feature in manual mode */
  function measureUnknown(bbox, videoW, videoH) {
    const [, , rawW, rawH] = bbox;
    const bboxW = rawW * 0.95;
    const bboxH = rawH * 0.95;
    const eff   = getEffectivePxPerMm();

    if (!eff || eff <= 0) {
      return { widthMm: null, heightMm: null, calibrated: false };
    }

    const widthMm  = bboxW / eff;
    const heightMm = bboxH / eff;
    const diagMm   = Math.sqrt(widthMm ** 2 + heightMm ** 2);

    // Pinhole distance estimate
    const focal      = videoW * 1.1;
    const distanceCm = widthMm > 0 ? (widthMm * focal) / (bboxW * 10) : null;

    return {
      widthMm:    widthMm,
      heightMm:   heightMm,
      diagMm:     diagMm,
      distanceCm: distanceCm,
      calibrated: true,
    };
  }

  function getEmoji(label) {
    return (DIM_DB[label.toLowerCase()] || FALLBACK).emoji;
  }

  return {
    measure,
    measureUnknown,
    calibrate,
    format,
    formatDist,
    formatArea,
    formatVolume,
    reset,
    getCalibrationInfo,
    getEmoji,
    setManualScale,
    setScaleMultiplier,
    getScaleMultiplier,
    getEffectivePxPerMm,
    pxToMm,
    isManuallyLocked,
    DIM_DB,
    REFERENCE_OBJECTS,
  };
})();

