/* ════════════════════════════════════════════════════
   intro.js — Particle Intro → Instructions → Loading
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
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  const COLORS = [
    'rgba(124, 110, 255, ',
    'rgba(0, 229, 179, ',
    'rgba(96, 165, 250, ',
    'rgba(255, 255, 255, ',
  ];

  class Particle {
    constructor(isCenterSwirl = false) {
      const w = window.innerWidth, h = window.innerHeight;
      this.isCenterSwirl = isCenterSwirl;
      if (isCenterSwirl) {
        this.centerRadius = Math.random() * Math.min(w, h) * 0.45 + 50;
        this.angle = Math.random() * Math.PI * 2;
        this.orbitSpeed = (Math.random() * 0.008 + 0.003) * (Math.random() < 0.5 ? 1 : -1);
        this.size = Math.random() * 2.2 + 0.8;
        this.opacity = Math.random() * 0.5 + 0.25;
        this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        this.x = w / 2 + Math.cos(this.angle) * this.centerRadius;
        this.y = h / 2 + Math.sin(this.angle) * this.centerRadius;
      } else {
        this.baseX = Math.random() * w;
        this.baseY = Math.random() * h;
        this.size = Math.random() * 2.0 + 0.6;
        this.speedX = (Math.random() - 0.5) * 0.5;
        this.speedY = (Math.random() - 0.5) * 0.5;
        this.opacity = Math.random() * 0.5 + 0.2;
        this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        this.angle = Math.random() * Math.PI * 2;
        this.orbitSpeed = (Math.random() * 0.014 + 0.010) * (Math.random() < 0.5 ? 1 : -1);
        this.orbitRadius = Math.random() * 45 + 15;
        this.x = this.baseX; this.y = this.baseY;
      }
    }
    update() {
      const w = window.innerWidth, h = window.innerHeight;
      this.angle += this.orbitSpeed;
      if (this.isCenterSwirl) {
        this.x = w / 2 + Math.cos(this.angle) * this.centerRadius;
        this.y = h / 2 + Math.sin(this.angle) * this.centerRadius;
      } else {
        this.baseX += this.speedX; this.baseY += this.speedY;
        this.x = this.baseX + Math.cos(this.angle) * this.orbitRadius;
        this.y = this.baseY + Math.sin(this.angle) * this.orbitRadius;
        if (this.baseX < -60) this.baseX = w + 60;
        if (this.baseX > w + 60) this.baseX = -60;
        if (this.baseY < -60) this.baseY = h + 60;
        if (this.baseY > h + 60) this.baseY = -60;
      }
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

  for (let i = 0; i < 65; i++) particles.push(new Particle(false));
  for (let i = 0; i < 30; i++) particles.push(new Particle(true));

  function drawLines() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dist = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y);
        if (dist < 110) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(124, 110, 255, ${(1 - dist / 110) * 0.14})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }
  }

  function animate() {
    if (!running) return;
    const w = window.innerWidth, h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) { p.update(); p.draw(); }
    drawLines();
    animId = requestAnimationFrame(animate);
  }
  animate();

  function cleanup() {
    running = false;
    if (animId) cancelAnimationFrame(animId);
    particles = [];
  }

  // ── Step 1: "Get Started" → show Instructions ──
  const introBtn = document.getElementById('intro-btn');
  const introEl = document.getElementById('intro-screen');
  const instrEl = document.getElementById('instructions-screen');
  let started = false;

  function handleGetStarted(e) {
    if (started) return;
    started = true;
    if (e && e.cancelable) e.preventDefault();
    try { navigator.vibrate?.(25); } catch {}

    introEl.classList.add('intro-fade');
    setTimeout(() => {
      introEl.style.display = 'none';
      if (instrEl) instrEl.classList.remove('hidden');
    }, 550);
  }

  if (introBtn) {
    introBtn.addEventListener('click', handleGetStarted);
    introBtn.addEventListener('touchend', handleGetStarted, { passive: false });
  }

  // ── Step 2: "Continue" → show Loading, start app ──
  const continueBtn = document.getElementById('instr-continue-btn');

  function handleContinue(e) {
    if (e && e.cancelable) e.preventDefault();
    try { navigator.vibrate?.(25); } catch {}

    if (instrEl) instrEl.classList.add('intro-fade');
    setTimeout(() => {
      cleanup();
      if (instrEl) instrEl.style.display = 'none';
      const ls = document.getElementById('loading-screen');
      if (ls) ls.classList.remove('hidden');
      window.dispatchEvent(new Event('intro-done'));
    }, 500);
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', handleContinue);
    continueBtn.addEventListener('touchend', handleContinue, { passive: false });
  }
})();
