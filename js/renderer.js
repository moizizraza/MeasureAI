/* ════════════════════════════════════════════
   renderer.js — Ultra-Clean & High-Response Canvas
   - ONLY selected objects are drawn (zero outlines on unselected items)
   - Magnetic high-response touch hit-testing (28px finger pad + 90px snap)
   ════════════════════════════════════════════ */

const Renderer = (() => {
  const canvas  = document.getElementById('canvas');
  const ctx     = canvas.getContext('2d');
  const videoEl = document.getElementById('video');

  const PALETTE = [
    '#00e5b3','#7c6eff','#f87171','#fbbf24',
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
      canvas.width = r.width;
      canvas.height = r.height;
    }
  }

  // Convert video coords to canvas screen space
  function toCanvas(bbox) {
    const vw = videoEl.videoWidth  || 1;
    const vh = videoEl.videoHeight || 1;
    const cw = canvas.width, ch = canvas.height;
    const s  = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * s) / 2;
    const oy = (ch - vh * s) / 2;
    const [x, y, w, h] = bbox;
    return [x * s + ox, y * s + oy, w * s, h * s];
  }

  /* ── Main Draw Call: ONLY draw selected objects! ── */
  function draw(items, unit = 'cm') {
    syncSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!items || items.length === 0) return;

    // Filter to ONLY items the user tapped
    const selectedItems = items.filter(m => m.selected);
    selectedItems.forEach(m => drawSelectedObject(m, unit));
  }

  function drawSelectedObject(m, unit) {
    const [cx, cy, cw, ch] = toCanvas(m.bbox);
    const color = colorFor(m.label);

    ctx.save();

    // ── Glowing neon bounding box ──
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(cx, cy, cw, ch);

    // Subtle fill
    ctx.shadowBlur = 0;
    ctx.fillStyle = hexRgba(color, 0.08);
    ctx.fillRect(cx, cy, cw, ch);

    // Corner brackets
    const cs = 16;
    ctx.lineWidth = 3.5;
    ctx.shadowBlur = 10;
    ctx.shadowColor = color;
    strokeCorner(cx,      cy,      cs,  1,  1);
    strokeCorner(cx + cw, cy,      cs, -1,  1);
    strokeCorner(cx,      cy + ch, cs,  1, -1);
    strokeCorner(cx + cw, cy + ch, cs, -1, -1);

    ctx.restore();

    // ── Dimension measurements (Width & Height arrows) ──
    if (m.measurement) {
      const meas = m.measurement;
      const wLabel = MeasureEngine.format(meas.widthMm, unit);
      const hLabel = MeasureEngine.format(meas.heightMm, unit);

      // Width arrow (below object)
      drawDimArrow(cx, cy + ch + 14, cx + cw, cy + ch + 14, `↔ ${wLabel}`, color, false);
      // Height arrow (right of object)
      drawDimArrow(cx + cw + 14, cy, cx + cw + 14, cy + ch, `↕ ${hLabel}`, color, true);

      // Distance tag (bottom-right)
      if (meas.distanceCm) {
        const distLabel = MeasureEngine.formatDist(meas.distanceCm);
        if (distLabel) drawTag(ctx, cx + cw - 2, cy + ch + 32, distLabel, color);
      }
    }

    // ── Object label pill ──
    const confPct = Math.round((m.measurement?.confScore || 0) * 100);
    const emoji   = m.measurement?.emoji || '📦';
    drawLabel(cx, cy, `${emoji} ${m.label}  ${confPct}%`, color);
  }

  function strokeCorner(x, y, s, dx, dy) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * s);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * s, y);
    ctx.stroke();
  }

  function drawDimArrow(x1, y1, x2, y2, label, color, vertical) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrow heads
    const sz = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    if (!vertical) {
      arrowHead(x1, y1, sz,  1, false);
      arrowHead(x2, y2, sz, -1, false);
    } else {
      arrowHead(x1, y1, sz,  1, true);
      arrowHead(x2, y2, sz, -1, true);
    }

    // Label pill
    ctx.font = '700 11px JetBrains Mono, monospace';
    ctx.shadowBlur = 0;
    const tw = ctx.measureText(label).width;
    let lx, ly;
    if (!vertical) {
      lx = (x1 + x2) / 2 - tw / 2 - 6;
      ly = y1 - 20;
    } else {
      ctx.save();
      ctx.translate(x1 + 16, (y1 + y2) / 2);
      ctx.rotate(-Math.PI / 2);
      drawPill(ctx, -tw / 2 - 6, -18, tw + 12, 17, 'rgba(4,6,14,.9)', color, label);
      ctx.restore();
      ctx.restore();
      return;
    }
    drawPill(ctx, lx, ly, tw + 12, 17, 'rgba(4,6,14,.9)', color, label);
    ctx.restore();
  }

  function arrowHead(x, y, sz, dir, vert) {
    ctx.beginPath();
    if (!vert) {
      ctx.moveTo(x + dir * sz, y - sz / 2);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dir * sz, y + sz / 2);
    } else {
      ctx.moveTo(x - sz / 2, y + dir * sz);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sz / 2, y + dir * sz);
    }
    ctx.stroke();
  }

  function drawPill(ctx, x, y, w, h, bg, border, text) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 4);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.strokeStyle = hexRgba(border, 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = border;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, x + 6, y + 3);
  }

  function drawLabel(cx, cy, text, color) {
    ctx.save();
    ctx.font = '700 11px Inter, sans-serif';
    const tw = ctx.measureText(text).width;
    const px = 10, py = 5, th = 11;
    const bx = cx, by = Math.max(cy - th - py * 2 - 4, 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw + px * 2, th + py * 2, 5);
    else ctx.rect(bx, by, tw + px * 2, th + py * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, bx + px, by + py);
    ctx.restore();
  }

  function drawTag(ctx, x, y, text, color) {
    ctx.save();
    ctx.font = '600 10px Inter, sans-serif';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(4,6,14,.85)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - tw - 12, y, tw + 10, 16, 4);
    else ctx.rect(x - tw - 12, y, tw + 10, 16);
    ctx.fill();
    ctx.strokeStyle = hexRgba(color, 0.4);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(text, x - 4, y + 3);
    ctx.restore();
  }

  /* ── Ultra-Responsive Magnetic Hit-Testing ── */
  function hitTest(items, px, py) {
    if (!items || items.length === 0) return null;

    // 1. Direct hit with generous 28px finger padding
    for (let i = items.length - 1; i >= 0; i--) {
      const [cx, cy, cw, ch] = toCanvas(items[i].bbox);
      const pad = 28;
      if (px >= cx - pad && px <= cx + cw + pad && py >= cy - pad && py <= cy + ch + pad) {
        return items[i];
      }
    }

    // 2. Magnetic nearest hit within 90px radius
    let closest = null;
    let minDist = 90;
    for (const item of items) {
      const [cx, cy, cw, ch] = toCanvas(item.bbox);
      const midX = cx + cw / 2;
      const midY = cy + ch / 2;
      const dist = Math.hypot(px - midX, py - midY);
      if (dist < minDist) {
        minDist = dist;
        closest = item;
      }
    }
    return closest;
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

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function hexRgba(hex, a) {
    if (!hex || hex[0] !== '#') return `rgba(0, 229, 179, ${a})`;
    const r = parseInt(hex.slice(1,3), 16) || 0;
    const g = parseInt(hex.slice(3,5), 16) || 0;
    const b = parseInt(hex.slice(5,7), 16) || 0;
    return `rgba(${r},${g},${b},${a})`;
  }

  return { draw, clear, snapshot, syncSize, hitTest, toCanvas };
})();
