(() => {
  document.body.classList.remove("no-js");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const q = (s, r = document) => r.querySelector(s);
  const hasIO = "IntersectionObserver" in window;

  // sticky header hairline
  const top = q(".top");
  const onScroll = () => top && top.classList.toggle("is-stuck", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // scroll reveals
  const nodes = document.querySelectorAll(".reveal");
  if (reduce || !hasIO) nodes.forEach((n) => n.classList.add("is-in"));
  else {
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
    nodes.forEach((n, i) => { n.style.transitionDelay = (i % 3) * 70 + "ms"; io.observe(n); });
  }

  // embers, hero only, paused off screen
  const canvas = q(".embers");
  if (canvas && !reduce) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w = 0, h = 0, parts = [], last = 0, on = true;
    const size = () => {
      const r = canvas.getBoundingClientRect();
      w = canvas.width = r.width * dpr; h = canvas.height = r.height * dpr;
    };
    const spawn = (y) => parts.push({
      x: w * (0.35 + Math.random() * 0.65), y: y ?? h + 4,
      r: (0.6 + Math.random() * 1.2) * dpr, vy: (0.02 + Math.random() * 0.04) * dpr,
      a: 0.15 + Math.random() * 0.35, life: 0, max: 5000 + Math.random() * 6000, ph: Math.random() * 6
    });
    const tick = (t) => {
      if (!on) return;
      const dt = Math.min(40, t - last || 16); last = t;
      ctx.clearRect(0, 0, w, h);
      if (parts.length < 14) spawn();
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.y -= p.vy * dt; p.life += dt;
        p.x += Math.sin(p.ph + t / 1400) * 0.15 * dpr;
        const f = Math.min(1, p.life / 600) * (1 - p.life / p.max);
        if (f <= 0 || p.y < -8) { parts.splice(i, 1); continue; }
        ctx.fillStyle = `rgba(255,120,40,${p.a * f})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      requestAnimationFrame(tick);
    };
    size();
    for (let i = 0; i < 8; i++) spawn(Math.random() * h);
    addEventListener("resize", size, { passive: true });
    if (hasIO) new IntersectionObserver(([e]) => {
      const was = on; on = e.isIntersecting;
      if (on && !was) requestAnimationFrame(tick);
    }).observe(canvas);
    requestAnimationFrame(tick);
  }

})();
