/* ════════════════════════════════════════════
   renderer.js v4 — Tap-to-Measure Canvas
   Detected objects: dim outline + label
   Selected objects: full neon + measurements
   ════════════════════════════════════════════ */

const Renderer = (() => {
  const canvas  = document.getElementById('canvas');
  const ctx     = canvas.getContext('2d');
  const videoEl = document.getElementById('video');

  const PALETTE = [
    '#7c6eff','#00e5b3','#f87171','#fbbf24',
    '#60a5fa','#fb923c','#c084fc','#34d399',
    '#f472b6','#a3e635','#38bdf8','#e879f9',
  ];
  const colCache = {};
  function colorFor(label) {
    if (!colCache[label]) colCache[label] = PALETTE[Object.keys(colCache).length % PALETTE.length];
    return colCache[label];
  }

  function syncSize() {
    const r = videoEl.getBoundingClientRect();
    if (canvas.width !== r.width || canvas.height !== r.height) {
      canvas.width = r.width; canvas.height = r.height;
    }
  }

  function toCanvas(bbox) {
    const vw = videoEl.videoWidth  || 1;
    const vh = videoEl.videoHeight || 1;
    const cw = canvas.width, ch = canvas.height;
    const s  = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
    const [x, y, w, h] = bbox;
    return [x*s + ox, y*s + oy, w*s, h*s];
  }

  /* ── Main draw call ── */
  function draw(items, unit = 'cm', tapeState = null, guideState = null) {
    syncSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw unselected (dim) first, then selected (bright) on top
    items.filter(m => !m.selected).forEach(m => drawObject(m, unit, false));
    items.filter(m =>  m.selected).forEach(m => drawObject(m, unit, true));

    // Draw reference card guide box if calibration guide is active
    if (guideState && guideState.active) {
      drawGuideBox(guideState);
    }

    // Draw virtual tape measure if points exist
    if (tapeState && (tapeState.pA || tapeState.pB)) {
      drawTape(tapeState, unit);
    }
  }

  function drawObject(m, unit, selected) {
    const [cx, cy, cw, ch] = toCanvas(m.bbox);
    const color = colorFor(m.label);

    ctx.save();

    if (selected) {
      // ── SELECTED: Full glow + box ──
      ctx.shadowColor = color; ctx.shadowBlur = 18;
      ctx.strokeStyle = color; ctx.lineWidth = 2.5;
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.shadowBlur = 0;
      ctx.fillStyle  = hexRgba(color, 0.08);
      ctx.fillRect(cx, cy, cw, ch);

      // Corner accents
      const cs = 16;
      ctx.lineWidth = 3; ctx.shadowBlur = 10; ctx.shadowColor = color;
      strokeCorner(cx,    cy,    cs, 1,  1);
      strokeCorner(cx+cw, cy,    cs, -1, 1);
      strokeCorner(cx,    cy+ch, cs, 1,  -1);
      strokeCorner(cx+cw, cy+ch, cs, -1, -1);
      ctx.restore();

      // ── Measurement overlays ──
      if (m.measurement) {
        const meas = m.measurement;
        const wLabel = MeasureEngine.format(meas.widthMm,  unit);
        const hLabel = MeasureEngine.format(meas.heightMm, unit);
        drawDimArrow(cx, cy+ch+14, cx+cw, cy+ch+14, `↔ ${wLabel}`, color, false);
        drawDimArrow(cx+cw+14, cy, cx+cw+14, cy+ch, `↕ ${hLabel}`, color, true);
        if (meas.distanceCm) {
          const distLabel = MeasureEngine.formatDist(meas.distanceCm);
          if (distLabel) drawTag(ctx, cx + cw - 2, cy + ch + 30, distLabel, 'rgba(255,255,255,0.35)', '#fff');
        }
      }

      // Label pill (bright)
      const confPct = Math.round((m.measurement?.confScore || 0) * 100);
      const emoji   = m.measurement?.emoji || '📦';
      drawLabel(cx, cy, `${emoji} ${m.label}  ${confPct}%`, color);

      // "TAP TO DESELECT" hint - small
      drawSmallHint(cx + cw/2, cy + ch - 8, '✓ Measuring', color);

    } else {
      // ── UNSELECTED: Dim dashed outline ──
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();

      // Dim label
      const emoji = m.measurement?.emoji || '📦';
      drawDimLabel(cx, cy, `${emoji} ${m.label}`, color);

      // "TAP TO MEASURE" hint
      drawSmallHint(cx + cw/2, cy + ch/2, 'Tap to measure', 'rgba(255,255,255,0.6)');
    }
  }

  function strokeCorner(x, y, s, dx, dy) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy*s); ctx.lineTo(x, y); ctx.lineTo(x + dx*s, y);
    ctx.stroke();
  }

  function drawDimArrow(x1, y1, x2, y2, label, color, vertical) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth   = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.shadowColor = color; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    const sz = 4.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    if (!vertical) { arrowHead(x1,y1,sz,1,false); arrowHead(x2,y2,sz,-1,false); }
    else           { arrowHead(x1,y1,sz,1,true);  arrowHead(x2,y2,sz,-1,true);  }
    ctx.font = '600 10px JetBrains Mono, monospace';
    ctx.shadowBlur = 0;
    const tw = ctx.measureText(label).width;
    if (vertical) {
      ctx.save();
      ctx.translate(x1+16, (y1+y2)/2);
      ctx.rotate(-Math.PI/2);
      drawPill(ctx, -tw/2-5, -18, tw+10, 16, 'rgba(4,6,14,.85)', color, label);
      ctx.restore(); ctx.restore(); return;
    }
    drawPill(ctx, (x1+x2)/2-tw/2-5, y1-20, tw+10, 16, 'rgba(4,6,14,.85)', color, label);
    ctx.restore();
  }

  function arrowHead(x,y,sz,dir,vert) {
    ctx.beginPath();
    if (!vert) { ctx.moveTo(x+dir*sz,y-sz/2); ctx.lineTo(x,y); ctx.lineTo(x+dir*sz,y+sz/2); }
    else       { ctx.moveTo(x-sz/2,y+dir*sz); ctx.lineTo(x,y); ctx.lineTo(x+sz/2,y+dir*sz); }
    ctx.stroke();
  }

  function drawPill(ctx, x, y, w, h, bg, border, text) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 4); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.strokeStyle = hexRgba(border, 0.55); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = border; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(text, x+5, y+3);
  }

  function drawLabel(cx, cy, text, color) {
    ctx.save();
    ctx.font = '600 11px Inter, sans-serif';
    const tw = ctx.measureText(text).width;
    const px = 9, py = 5, th = 11;
    const bx = cx, by = Math.max(cy - th - py*2 - 4, 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw+px*2, th+py*2, 5); else ctx.rect(bx, by, tw+px*2, th+py*2);
    ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(text, bx+px, by+py);
    ctx.restore();
  }

  // Dimmed label for unselected objects
  function drawDimLabel(cx, cy, text, color) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.font = '600 10px Inter, sans-serif';
    const tw = ctx.measureText(text).width;
    const bx = cx, by = Math.max(cy - 22, 2);
    ctx.fillStyle = 'rgba(4,6,14,0.7)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw+14, 18, 4); else ctx.rect(bx, by, tw+14, 18);
    ctx.fill();
    ctx.strokeStyle = hexRgba(color, 0.3); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = hexRgba(color, 0.8); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(text, bx+7, by+4);
    ctx.restore();
  }

  // Small centered hint text
  function drawSmallHint(cx, cy, text, color) {
    ctx.save();
    ctx.font = '600 9px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(4,6,14,0.65)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - tw/2 - 8, cy - 9, tw + 16, 18, 9);
    else ctx.rect(cx - tw/2 - 8, cy - 9, tw + 16, 18);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  function drawTag(ctx, x, y, text, bg, fg) {
    ctx.save();
    ctx.font = '500 10px Inter, sans-serif';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(4,6,14,.75)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - tw - 12, y, tw+10, 15, 3); else ctx.rect(x - tw - 12, y, tw+10, 15);
    ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(text, x - 4, y + 2);
    ctx.restore();
  }

  /* ── Hit test: which object bbox contains (px, py)? ── */
  function hitTest(items, px, py) {
    // Check in reverse so top-drawn (selected) items are hit first
    for (let i = items.length - 1; i >= 0; i--) {
      const [cx, cy, cw, ch] = toCanvas(items[i].bbox);
      if (px >= cx && px <= cx + cw && py >= cy && py <= cy + ch) {
        return items[i];
      }
    }
    return null;
  }

  /* ── Virtual Tape Measure ── */
  function drawTape(tape, unit) {
    const { pA, pB, distMm } = tape;
    const color = '#00e5b3';

    ctx.save();

    // Draw Point A
    if (pA) {
      drawPointMarker(pA.x, pA.y, 'A', color);
    }

    // Draw Point B + connecting line
    if (pB && pA) {
      drawPointMarker(pB.x, pB.y, 'B', color);

      // Connecting line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Distance pill in the middle
      const midX = (pA.x + pB.x) / 2;
      const midY = (pA.y + pB.y) / 2;
      const labelText = `📏 ${MeasureEngine.format(distMm, unit)}`;
      ctx.font = '700 12px JetBrains Mono, monospace';
      const tw = ctx.measureText(labelText).width;

      ctx.fillStyle = 'rgba(6, 8, 15, 0.9)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(midX - tw/2 - 10, midY - 14, tw + 20, 26, 6);
      else ctx.rect(midX - tw/2 - 10, midY - 14, tw + 20, 26);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, midX, midY - 1);
    }

    ctx.restore();
  }

  function drawPointMarker(x, y, label, color) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;

    // Outer circle
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.stroke();

    // Inner dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Crosshairs
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 20, y); ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y); ctx.lineTo(x + 20, y);
    ctx.moveTo(x, y - 20); ctx.lineTo(x, y - 6);
    ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 20);
    ctx.stroke();

    // Label tag
    ctx.font = '800 10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(6, 8, 15, 0.85)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x + 10, y - 22, 18, 16, 4);
    else ctx.rect(x + 10, y - 22, 18, 16);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 19, y - 14);

    ctx.restore();
  }

  /* ── Reference Card Alignment Guide Box ── */
  function drawGuideBox(guide) {
    const cw = canvas.width, ch = canvas.height;
    // Standard credit card aspect ratio: 85.6mm / 53.98mm = 1.586
    const boxW = Math.min(cw * 0.65, 260);
    const boxH = boxW / 1.586;
    const boxX = (cw - boxW) / 2;
    const boxY = (ch - boxH) / 2;

    guide.box = { x: boxX, y: boxY, w: boxW, h: boxH };

    ctx.save();
    // Dim surrounding area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, cw, boxY);
    ctx.fillRect(0, boxY + boxH, cw, ch - (boxY + boxH));
    ctx.fillRect(0, boxY, boxX, boxH);
    ctx.fillRect(boxX + boxW, boxY, cw - (boxX + boxW), boxH);

    // Glowing target card outline
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(boxX, boxY, boxW, boxH, 10);
    else ctx.rect(boxX, boxY, boxW, boxH);
    ctx.stroke();

    // Center icon & instruction
    ctx.shadowBlur = 0;
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💳 Place Credit Card / ID inside box', cw / 2, boxY + boxH / 2 - 8);
    ctx.font = '500 10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText('Tap "Calibrate" to lock 100% precision scale', cw / 2, boxY + boxH / 2 + 10);

    ctx.restore();
  }

  function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); }

  function hexRgba(hex, a) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  return { draw, clear, snapshot, syncSize, hitTest, toCanvas };
})();
