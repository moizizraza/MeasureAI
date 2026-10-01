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

    // ── Precision lock ellipse ring (after 15 frames) ──
    if (m.age >= 15) {
      ctx.save();
      ctx.strokeStyle = hexRgba(color, 0.35);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.ellipse(cx + cw/2, cy + ch/2, cw/2 + 8, ch/2 + 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Dimension measurements (Width & Height arrows) ──
    if (m.measurement) {
      const meas = m.measurement;
      const wLabel = MeasureEngine.format(meas.widthMm, unit);
      const hLabel = MeasureEngine.format(meas.heightMm, unit);

      // Width arrow (below object)
      drawDimArrow(cx, cy + ch + 14, cx + cw, cy + ch + 14, `↔ ${wLabel}`, color, false);
      // Height arrow (right of object)
      drawDimArrow(cx + cw + 14, cy, cx + cw + 14, cy + ch, `↕ ${hLabel}`, color, true);

      // Distance badge bottom-left
      if (meas.distanceCm) {
        const distLabel = MeasureEngine.formatDist(meas.distanceCm);
        if (distLabel) drawTag(ctx, cx + cw - 2, cy + ch + 32, distLabel, color);
      }
      // Volume tag
      if (meas.volumeCm3) {
        const volLabel = MeasureEngine.formatVolume(meas.volumeCm3);
        if (volLabel) drawTag(ctx, cx + cw - 2, cy + ch + (meas.distanceCm ? 52 : 32), `📦 ${volLabel}`, color);
      }
    }

    // ── Label pill with lock status ──
    const confPct = Math.round((m.measurement?.confScore || 0) * 100);
    const emoji   = m.measurement?.emoji || '📦';
    const lockTxt = m.age >= 15 ? ' 🔒' : ` ${Math.min(m.age,15)}/15`;
    drawLabel(cx, cy, `${emoji} ${m.label}  ${confPct}%${lockTxt}`, color);
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

  /* ── Strict Hit-Testing: only the EXACT tapped object ── */
  function hitTest(items, px, py) {
    if (!items || items.length === 0) return null;

    // Direct bbox hit with 20px finger padding — no magnetic snap
    for (let i = items.length - 1; i >= 0; i--) {
      const [cx, cy, cw, ch] = toCanvas(items[i].bbox);
      const pad = 20;
      if (px >= cx - pad && px <= cx + cw + pad && py >= cy - pad && py <= cy + ch + pad) {
        return items[i];
      }
    }

    return null;
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

  /* ── Multi-Point AR-Anchored Measurement with Area, Angles & Closed Shapes ── */
  function drawMultiPoints(points, segments, total, color, shapeClosed = false, area = null) {
    if (!points || points.length === 0) return;
    ctx.save();

    // 1. If closed shape, fill polygon with soft glow
    if (shapeClosed && points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
      ctx.fillStyle = hexRgba(color, 0.12);
      ctx.fill();
    }

    const n = points.length;
    const loop = shapeClosed ? n : n - 1;

    // 2. Draw connecting segments
    for (let i = 0; i < loop; i++) {
      const pt = points[i];
      const next = points[(i + 1) % n];

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Segment measurement label
      if (segments && segments[i]) {
        const mx = (pt.x + next.x) / 2;
        const my = (pt.y + next.y) / 2;
        const angle = Math.atan2(next.y - pt.y, next.x - pt.x);
        const offsetX = Math.sin(angle) * 16;
        const offsetY = -Math.cos(angle) * 16;

        ctx.font = '700 11px JetBrains Mono, monospace';
        const tw = ctx.measureText(segments[i]).width;
        const pw = tw + 12, ph = 18;
        const lx = mx + offsetX, ly = my + offsetY;

        ctx.fillStyle = 'rgba(4,6,14,.9)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(lx - pw/2, ly - ph/2, pw, ph, 4);
        else ctx.rect(lx - pw/2, ly - ph/2, pw, ph);
        ctx.fill();
        ctx.strokeStyle = hexRgba(color, 0.5);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(segments[i], lx, ly);
      }
    }

    // 3. Draw points & vertex angles
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const conf = pt.conf != null ? pt.conf : 1;

      // Confidence color: green=locked, yellow=tracking, red=lost
      const ptColor = conf > 0.6 ? '#00e5b3' : conf > 0.3 ? '#fbbf24' : '#f87171';

      // ARKit-style crosshair marker
      const r = i === 0 ? 10 : 8;
      ctx.strokeStyle = ptColor;
      ctx.lineWidth = 2;
      ctx.shadowColor = ptColor;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = ptColor;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fill();

      // Cross lines
      ctx.strokeStyle = ptColor;
      ctx.lineWidth = 1.5;
      const cl = 6;
      ctx.beginPath();
      ctx.moveTo(pt.x - r - cl, pt.y); ctx.lineTo(pt.x - r + 3, pt.y);
      ctx.moveTo(pt.x + r + cl, pt.y); ctx.lineTo(pt.x + r - 3, pt.y);
      ctx.moveTo(pt.x, pt.y - r - cl); ctx.lineTo(pt.x, pt.y - r + 3);
      ctx.moveTo(pt.x, pt.y + r + cl); ctx.lineTo(pt.x, pt.y + r - 3);
      ctx.stroke();

      // Point number
      ctx.font = '700 9px Inter, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), pt.x, pt.y - r - 8);

      // Vertex angle badge
      if (pt.angle != null) {
        ctx.font = '700 9px JetBrains Mono, monospace';
        const aTxt = `${pt.angle}°`;
        const atw = ctx.measureText(aTxt).width;
        ctx.fillStyle = 'rgba(4,6,14,.88)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(pt.x + r + 4, pt.y - 8, atw + 8, 16, 3);
        else ctx.rect(pt.x + r + 4, pt.y - 8, atw + 8, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(251,191,36,.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#fbbf24';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(aTxt, pt.x + r + 8, pt.y);
      }
    }

    // 4. Total & Area Pill at top
    if (total && points.length >= 2) {
      ctx.font = '700 12px JetBrains Mono, monospace';
      const label = shapeClosed && area ? `🔷 Area: ${area}  ·  Perimeter: ${total}` : `📐 Total: ${total}`;
      const tw = ctx.measureText(label).width;
      const pw = tw + 22, ph = 28;
      const tx = canvas.width / 2, ty = 46;

      ctx.fillStyle = 'rgba(4,6,14,.92)';
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx - pw/2, ty - ph/2, pw, ph, 8);
      else ctx.rect(tx - pw/2, ty - ph/2, pw, ph);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, tx, ty);
    }

    // 5. Single point pulse hint
    if (points.length === 1) {
      const pt = points[0];
      const pulse = (Math.sin(Date.now() / 300) + 1) / 2;
      ctx.strokeStyle = hexRgba('#00e5b3', 0.2 + pulse * 0.3);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 18 + pulse * 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 6. Close shape hint on point 1 when 3+ points placed
    if (!shapeClosed && points.length >= 3) {
      const p1 = points[0];
      const pulse = (Math.sin(Date.now() / 250) + 1) / 2;
      ctx.strokeStyle = hexRgba('#fbbf24', 0.4 + pulse * 0.4);
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 22 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '600 8px Inter, sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.textAlign = 'center';
      ctx.fillText('Tap to Close', p1.x, p1.y + 26);
    }

    ctx.restore();
  }

  /* ── AR Center Targeting Reticle ── */
  function drawReticle() {
    syncSize();
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.save();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#00e5b3';
    ctx.shadowColor = '#00e5b3';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy); ctx.lineTo(cx - 16, cy);
    ctx.moveTo(cx + 16, cy); ctx.lineTo(cx + 20, cy);
    ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy - 16);
    ctx.moveTo(cx, cy + 16); ctx.lineTo(cx, cy + 20);
    ctx.stroke();
    ctx.restore();
  }

  return { draw, clear, snapshot, syncSize, hitTest, toCanvas, drawMultiPoints, drawReticle };
})();
