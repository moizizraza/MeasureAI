/* ════════════════════════════════════════════════════
   intro.js — Particle Animation Intro Screen
   - Multi-layer revolving particles (orbiting + swirling)
   - Retina canvas support for crisp rendering
   - Smooth 60fps WebGL/Canvas loop
   - Instant touch/click response
   ════════════════════════════════════════════════════ */

(() => {
  const canvas = document.getElementById('intro-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];
  let animId = null;
  let running = true;
  let dpr = window.devicePixelRatio || 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  const COLORS = [
    'rgba(124, 110, 255, ',  // neon purple
    'rgba(0, 229, 179, ',    // neon teal
    'rgba(96, 165, 250, ',   // cyan blue
    'rgba(255, 255, 255, ',  // crisp white
  ];

  class Particle {
    constructor(isCenterSwirl = false) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.isCenterSwirl = isCenterSwirl;

      if (isCenterSwirl) {
        // Revolves around the center of the screen
        this.centerRadius = Math.random() * Math.min(w, h) * 0.45 + 50;
        this.angle = Math.random() * Math.PI * 2;
        this.orbitSpeed = (Math.random() * 0.008 + 0.003) * (Math.random() < 0.5 ? 1 : -1);
        this.size = Math.random() * 2.2 + 0.8;
        this.opacity = Math.random() * 0.5 + 0.25;
        this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        this.x = w / 2 + Math.cos(this.angle) * this.centerRadius;
        this.y = h / 2 + Math.sin(this.angle) * this.centerRadius;
      } else {
        // Revolves around a local anchor that slowly drifts
        this.baseX = Math.random() * w;
        this.baseY = Math.random() * h;
        this.size = Math.random() * 2.0 + 0.6;
        this.speedX = (Math.random() - 0.5) * 0.5;
        this.speedY = (Math.random() - 0.5) * 0.5;
        this.opacity = Math.random() * 0.5 + 0.2;
        this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        this.angle = Math.random() * Math.PI * 2;
        // Revolving speed: ~0.012 to 0.024 rad/frame (~0.7 to 1.4 deg/frame)
        this.orbitSpeed = (Math.random() * 0.014 + 0.010) * (Math.random() < 0.5 ? 1 : -1);
        this.orbitRadius = Math.random() * 45 + 15;
        this.x = this.baseX;
        this.y = this.baseY;
      }
    }

    update() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.angle += this.orbitSpeed;

      if (this.isCenterSwirl) {
        this.x = w / 2 + Math.cos(this.angle) * this.centerRadius;
        this.y = h / 2 + Math.sin(this.angle) * this.centerRadius;
      } else {
        this.baseX += this.speedX;
        this.baseY += this.speedY;

        this.x = this.baseX + Math.cos(this.angle) * this.orbitRadius;
        this.y = this.baseY + Math.sin(this.angle) * this.orbitRadius;

        if (this.baseX < -60) this.baseX = w + 60;
        if (this.baseX > w + 60) this.baseX = -60;
        if (this.baseY < -60) this.baseY = h + 60;
        if (this.baseY > h + 60) this.baseY = -60;
      }

      // Subtle breathing pulse
      this.opacity += (Math.random() - 0.5) * 0.015;
      this.opacity = Math.max(0.12, Math.min(0.75, this.opacity));
    }

    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = this.color + this.opacity + ')';
      ctx.fill();
    }
  }

  // Create revolving particle network: 65 local orbiters + 30 center swirlers
  const COUNT_LOCAL = 65;
  const COUNT_CENTER = 30;
  for (let i = 0; i < COUNT_LOCAL; i++) particles.push(new Particle(false));
  for (let i = 0; i < COUNT_CENTER; i++) particles.push(new Particle(true));

  // Draw faint connecting constellation lines
  function drawLines() {
    const len = particles.length;
    for (let i = 0; i < len; i++) {
      for (let j = i + 1; j < len; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < 110) {
          const alpha = (1 - dist / 110) * 0.14;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(124, 110, 255, ${alpha})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }
  }

  function animate() {
    if (!running) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    const len = particles.length;
    for (let i = 0; i < len; i++) {
      particles[i].update();
      particles[i].draw();
    }
    drawLines();

    animId = requestAnimationFrame(animate);
  }
  animate();

  // "Get Started" button handler with debounce & instant response
  const btn = document.getElementById('intro-btn');
  const intro = document.getElementById('intro-screen');
  let started = false;

  function handleStart(e) {
    if (started) return;
    started = true;
    if (e && e.cancelable) e.preventDefault();

    try { navigator.vibrate?.(25); } catch {}

    // Smooth fade out
    intro.classList.add('intro-fade');

    setTimeout(() => {
      running = false;
      if (animId) cancelAnimationFrame(animId);
      particles = [];

      intro.style.display = 'none';
      const ls = document.getElementById('loading-screen');
      if (ls) ls.classList.remove('hidden');

      // Dispatch event to unblock app.js
      window.dispatchEvent(new Event('intro-done'));
    }, 550);
  }

  if (btn) {
    btn.addEventListener('click', handleStart);
    btn.addEventListener('touchend', handleStart, { passive: false });
  }
})();
