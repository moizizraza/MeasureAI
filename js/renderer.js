/* ════════════════════════════════════════════
   renderer.js v3 — Enhanced canvas drawing
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

  // Video-space bbox → canvas-space (object-fit:cover aware)
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
  function draw(measurements, unit = 'cm') {
    syncSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    measurements.forEach(m => drawObject(m, unit));
  }

  function drawObject(m, unit) {
    const [cx, cy, cw, ch] = toCanvas(m.bbox);
    const color = colorFor(m.label);

    ctx.save();

    // ── Glow + box ──────────────────────────────
    ctx.shadowColor = color; ctx.shadowBlur = 16;
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.strokeRect(cx, cy, cw, ch);

    // Semi-transparent fill
    ctx.shadowBlur = 0;
    ctx.fillStyle  = hexRgba(color, 0.06);
    ctx.fillRect(cx, cy, cw, ch);

    // Corner accents
    const cs = 14;
    ctx.lineWidth = 3; ctx.shadowBlur = 8; ctx.shadowColor = color;
    strokeCorner(cx,    cy,    cs, 1,  1);
    strokeCorner(cx+cw, cy,    cs, -1, 1);
    strokeCorner(cx,    cy+ch, cs, 1,  -1);
    strokeCorner(cx+cw, cy+ch, cs, -1, -1);

    ctx.restore();

    // ── Measurement overlays ─────────────────────
    if (m.measurement) {
      const meas = m.measurement;
      const wLabel = MeasureEngine.format(meas.widthMm,  unit);
      const hLabel = MeasureEngine.format(meas.heightMm, unit);

      // Width arrow (below box)
      drawDimArrow(cx, cy+ch+12, cx+cw, cy+ch+12, `↔ ${wLabel}`, color, false);
      // Height arrow (right of box)
      drawDimArrow(cx+cw+12, cy, cx+cw+12, cy+ch, `↕ ${hLabel}`, color, true);

      // Distance label (bottom-right of box)
      if (meas.distanceCm) {
        const distLabel = MeasureEngine.formatDist(meas.distanceCm);
        if (distLabel) drawTag(ctx, cx + cw - 2, cy + ch + 28, distLabel, 'rgba(255,255,255,0.35)', '#fff');
      }
    }

    // ── Label pill ───────────────────────────────
    const confPct = Math.round((m.measurement?.confScore || 0) * 100);
    const emoji   = m.measurement?.emoji || '📦';
    drawLabel(cx, cy, `${emoji} ${m.label}  ${confPct}%`, color);
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

    // Arrowheads
    const sz = 4.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    if (!vertical) {
      arrowHead(x1, y1,  sz,  1, false);
      arrowHead(x2, y2,  sz, -1, false);
    } else {
      arrowHead(x1, y1, sz,  1, true);
      arrowHead(x2, y2, sz, -1, true);
    }

    // Label
    ctx.font = `600 10px JetBrains Mono, monospace`;
    ctx.shadowBlur = 0;
    const tw = ctx.measureText(label).width;
    let lx, ly;
    if (!vertical) {
      lx = (x1+x2)/2 - tw/2 - 5; ly = y1 - 20;
    } else {
      // rotate
      ctx.save();
      ctx.translate(x1+16, (y1+y2)/2);
      ctx.rotate(-Math.PI/2);
      lx = -tw/2 - 5; ly = -18;
      drawPill(ctx, lx, ly, tw+10, 16, 'rgba(4,6,14,.85)', color, label);
      ctx.restore();
      ctx.restore();
      return;
    }
    drawPill(ctx, lx, ly, tw+10, 16, 'rgba(4,6,14,.85)', color, label);
    ctx.restore();
  }

  function arrowHead(x, y, sz, dir, vert) {
    ctx.beginPath();
    if (!vert) {
      ctx.moveTo(x+dir*sz, y-sz/2); ctx.lineTo(x, y); ctx.lineTo(x+dir*sz, y+sz/2);
    } else {
      ctx.moveTo(x-sz/2, y+dir*sz); ctx.lineTo(x, y); ctx.lineTo(x+sz/2, y+dir*sz);
    }
    ctx.stroke();
  }

  function drawPill(ctx, x, y, w, h, bg, border, text) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 4); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.strokeStyle = hexRgba(border, 0.55);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = border;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
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
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(text, bx+px, by+py);
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
    ctx.fillStyle = fg;
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(text, x - 4, y + 2);
    ctx.restore();
  }

  function snapshot() {
    const w = canvas.width, h = canvas.height;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tc = tmp.getContext('2d');
    tc.drawImage(videoEl, 0, 0, w, h);
    tc.drawImage(canvas, 0, 0);
    return tmp.toDataURL('image/jpeg', 0.87);
  }

  function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); }

  function hexRgba(hex, a) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  return { draw, clear, snapshot, syncSize };
})();
