'use strict';
/*
 * Ilustrações de "antes e depois" desenhadas por código (canvas) e o controle deslizante de comparação.
 * Quando o administrador envia fotos reais de um serviço, as fotos substituem as ilustrações.
 */
(function () {
  const W = 960, H = 600;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rgba = (r, g, b, a) => `rgba(${Math.max(0, Math.min(255, r)) | 0},${Math.max(0, Math.min(255, g)) | 0},${Math.max(0, Math.min(255, b)) | 0},${a})`;

  /* pintura brilhante: céu claro, faixa escura do horizonte, linha de luz e chão */
  function paint(c, base, k) {
    k = k || {};
    const m = (f, a) => rgba(base[0] * f, base[1] * f, base[2] * f, a === undefined ? 1 : a);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, m(k.top || 1.7));
    g.addColorStop(0.4, m(0.6));
    g.addColorStop(0.47, m(0.1));
    g.addColorStop(0.5, m(k.horizon || 2.4));
    g.addColorStop(0.54, m(0.35));
    g.addColorStop(1, m(0.2));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    const side = c.createLinearGradient(0, 0, W, 0);
    side.addColorStop(0, 'rgba(0,0,0,.45)');
    side.addColorStop(0.5, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,.5)');
    c.fillStyle = side;
    c.fillRect(0, 0, W, H);
  }

  /* reflexo de uma luz de estúdio: nítido quando a pintura está polida */
  function softbox(c, sharp) {
    const boxes = [[120, 56, 330, 96], [520, 70, 250, 70]];
    for (const [x, y, w, h] of boxes) {
      if (sharp) {
        const g = c.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, 'rgba(255,255,255,.96)');
        g.addColorStop(1, 'rgba(255,244,230,.82)');
        c.fillStyle = g;
        c.fillRect(x, y, w, h);
        c.fillStyle = 'rgba(255,255,255,.35)';
        c.fillRect(x, y + h + 6, w, 3);
      } else {
        for (let i = 12; i >= 0; i--) {
          c.fillStyle = `rgba(255,255,255,${0.018 + (12 - i) * 0.006})`;
          c.fillRect(x - i * 4, y - i * 3, w + i * 8, h + i * 6);
        }
      }
    }
    if (sharp) {
      c.fillStyle = 'rgba(255,255,255,.55)';
      c.fillRect(0, H * 0.5 - 1, W, 2);
    }
  }

  function swirls(c, r, count, cx, cy) {
    for (let i = 0; i < count; i++) {
      const near = r() < 0.6;
      const x = near ? cx + (r() + r() + r() - 1.5) * 380 : r() * W;
      const y = near ? cy + (r() + r() + r() - 1.5) * 220 : r() * H;
      const rad = 6 + r() * 46, a0 = r() * 6.283;
      c.strokeStyle = `rgba(255,255,255,${0.04 + r() * 0.1})`;
      c.lineWidth = 0.6 + r() * 1.3;
      c.beginPath();
      c.arc(x, y, rad, a0, a0 + 0.8 + r() * 2.4);
      c.stroke();
    }
  }

  function blob(c, r, x, y, rad, color) {
    c.fillStyle = color;
    for (let i = 0; i < 14; i++) {
      const a = r() * 6.283, d = r() * rad * 0.7;
      c.beginPath();
      c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rad * (0.25 + r() * 0.35), 0, 6.283);
      c.fill();
    }
  }

  /* ---- lavagem ---- */
  function wash(c, mode, r) {
    paint(c, [30, 52, 92], mode === 'before' ? { top: 1.2, horizon: 1.3 } : {});
    if (mode === 'after') {
      softbox(c, true);
      return;
    }
    softbox(c, false);
    c.fillStyle = 'rgba(122,98,72,.38)';
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      const x = r() * W, w = 2 + r() * 9, h = 90 + r() * 330, y = r() * (H - 60);
      const g = c.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, `rgba(84,64,44,${0.25 + r() * 0.35})`);
      g.addColorStop(1, 'rgba(84,64,44,0)');
      c.fillStyle = g;
      c.fillRect(x, y, w, h);
    }
    for (let i = 0; i < 1400; i++) {
      c.fillStyle = `rgba(${60 + r() * 40},${46 + r() * 30},${32 + r() * 20},${0.2 + r() * 0.4})`;
      c.beginPath();
      c.arc(r() * W, r() * H, 0.6 + r() * 2.4, 0, 6.283);
      c.fill();
    }
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = 'rgba(210,200,185,.28)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(r() * W, r() * H, 5 + r() * 14, 0, 6.283);
      c.stroke();
    }
  }

  /* ---- polimento ---- */
  function polish(c, mode, r) {
    paint(c, [26, 30, 40], mode === 'before' ? { top: 1.5 } : { top: 1.9 });
    softbox(c, mode === 'after');
    if (mode === 'before') {
      c.fillStyle = 'rgba(190,196,205,.17)';
      c.fillRect(0, 0, W, H);
      swirls(c, r, 900, 330, 120);
      for (let i = 0; i < 14; i++) {
        c.strokeStyle = 'rgba(255,255,255,.22)';
        c.lineWidth = 1;
        c.beginPath();
        const x = r() * W, y = r() * H;
        c.moveTo(x, y);
        c.lineTo(x + 60 + r() * 140, y + (r() - 0.5) * 40);
        c.stroke();
      }
    }
  }

  /* ---- vitrificação ---- */
  function ceramic(c, mode, r) {
    paint(c, [22, 24, 30], { top: 1.8 });
    softbox(c, true);
    if (mode === 'before') {
      for (let i = 0; i < 16; i++) {
        const cx = r() * W, cy = r() * H, rad = 50 + r() * 110, pts = 11;
        c.beginPath();
        for (let k = 0; k <= pts; k++) {
          const a = (k / pts) * 6.283, d = rad * (0.6 + r() * 0.6);
          const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d * 0.7;
          if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.closePath();
        c.fillStyle = 'rgba(170,190,210,.13)';
        c.fill();
        c.strokeStyle = 'rgba(255,255,255,.2)';
        c.lineWidth = 1.5;
        c.stroke();
      }
      c.fillStyle = 'rgba(160,170,180,.09)';
      c.fillRect(0, 0, W, H);
      return;
    }
    const placed = [];
    for (let i = 0; i < 700 && placed.length < 300; i++) {
      const rad = 3 + Math.pow(r(), 2.2) * 16, x = r() * W, y = r() * H;
      if (placed.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < (p.r + rad) ** 2 * 0.8)) continue;
      placed.push({ x, y, r: rad });
      c.fillStyle = 'rgba(0,0,0,.35)';
      c.beginPath();
      c.arc(x + rad * 0.15, y + rad * 0.25, rad, 0, 6.283);
      c.fill();
      const g = c.createRadialGradient(x - rad * 0.3, y - rad * 0.35, rad * 0.05, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,.75)');
      g.addColorStop(0.35, 'rgba(200,225,245,.12)');
      g.addColorStop(0.85, 'rgba(120,150,180,.18)');
      g.addColorStop(1, 'rgba(255,255,255,.5)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, rad, 0, 6.283);
      c.fill();
    }
  }

  /* ---- proteção de pintura ---- */
  function ppf(c, mode, r) {
    paint(c, [38, 40, 46], { top: 1.9 });
    softbox(c, true);
    if (mode === 'before') {
      for (let i = 0; i < 46; i++) {
        const x = r() * W, y = r() * H, rad = 2 + r() * 6;
        c.fillStyle = 'rgba(10,10,12,.85)';
        c.beginPath();
        c.arc(x, y, rad, 0, 6.283);
        c.fill();
        c.strokeStyle = 'rgba(235,235,235,.75)';
        c.lineWidth = 1.2;
        c.beginPath();
        c.arc(x, y, rad + 1.2, 0.4, 4.6);
        c.stroke();
      }
      for (let i = 0; i < 24; i++) {
        const x = r() * W, y = r() * H;
        c.strokeStyle = `rgba(255,255,255,${0.18 + r() * 0.25})`;
        c.lineWidth = 0.8;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 30 + r() * 120, y + (r() - 0.5) * 70);
        c.stroke();
      }
    } else {
      c.strokeStyle = 'rgba(255,255,255,.16)';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, H * 0.78);
      c.bezierCurveTo(W * 0.3, H * 0.74, W * 0.7, H * 0.82, W, H * 0.77);
      c.stroke();
    }
  }

  /* ---- revitalização ---- */
  function revive(c, mode, r) {
    if (mode === 'before') {
      paint(c, [168, 92, 88], { top: 1.2, horizon: 1.3 });
      softbox(c, false);
      for (let i = 0; i < 38; i++) blob(c, r, r() * W, r() * H, 40 + r() * 90, 'rgba(236,214,204,.07)');
      c.fillStyle = 'rgba(214,196,186,.18)';
      c.fillRect(0, 0, W, H);
    } else {
      paint(c, [150, 14, 20], { top: 1.5 });
      softbox(c, true);
    }
  }

  /* ---- farol ---- */
  function lamp(c, mode, r) {
    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#17171b');
    bg.addColorStop(1, '#09090b');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 30; i++) {
      c.strokeStyle = 'rgba(255,255,255,.025)';
      c.beginPath();
      c.moveTo(0, i * 22);
      c.lineTo(W, i * 22 - 60);
      c.stroke();
    }
    const shape = () => {
      c.beginPath();
      c.moveTo(110, 260);
      c.bezierCurveTo(190, 150, 620, 120, 850, 190);
      c.bezierCurveTo(900, 280, 880, 390, 790, 430);
      c.bezierCurveTo(560, 470, 300, 450, 150, 390);
      c.bezierCurveTo(100, 350, 92, 296, 110, 260);
      c.closePath();
    };
    const good = mode === 'after';
    shape();
    c.fillStyle = '#050506';
    c.fill();
    c.save();
    shape();
    c.clip();
    const bowl = c.createRadialGradient(330, 300, 20, 400, 300, 420);
    bowl.addColorStop(0, good ? '#d9dde4' : '#8a7648');
    bowl.addColorStop(0.5, good ? '#6f7682' : '#4a3f26');
    bowl.addColorStop(1, '#111114');
    c.fillStyle = bowl;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) {
      c.strokeStyle = `rgba(255,255,255,${good ? 0.12 : 0.05})`;
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(300, 300, 60 + i * 38, 40 + i * 20, -0.12, 0, 6.283);
      c.stroke();
    }
    const proj = c.createRadialGradient(330, 300, 4, 330, 300, 78);
    proj.addColorStop(0, good ? '#ffffff' : 'rgba(215,190,120,.8)');
    proj.addColorStop(0.5, good ? '#cfe4ff' : 'rgba(150,120,60,.7)');
    proj.addColorStop(1, '#101014');
    c.fillStyle = proj;
    c.beginPath();
    c.arc(330, 300, 78, 0, 6.283);
    c.fill();
    c.shadowColor = good ? 'rgba(190,220,255,.95)' : 'rgba(210,170,80,.4)';
    c.shadowBlur = good ? 34 : 10;
    c.fillStyle = good ? '#ffffff' : 'rgba(230,205,150,.75)';
    c.beginPath();
    c.roundRect(520, 240, 300, 20, 10);
    c.fill();
    c.beginPath();
    c.roundRect(520, 280, 260, 14, 7);
    c.fill();
    c.shadowBlur = 0;
    if (good) {
      const gloss = c.createLinearGradient(100, 120, 500, 460);
      gloss.addColorStop(0, 'rgba(255,255,255,.28)');
      gloss.addColorStop(0.35, 'rgba(255,255,255,0)');
      c.fillStyle = gloss;
      c.fillRect(0, 0, W, H);
    } else {
      c.fillStyle = 'rgba(176,128,36,.55)';
      c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(235,225,205,.2)';
      c.fillRect(0, 0, W, H);
      for (let i = 0; i < 220; i++) {
        c.strokeStyle = `rgba(255,255,255,${0.05 + r() * 0.1})`;
        c.lineWidth = 0.8;
        c.beginPath();
        const x = r() * W, y = r() * H;
        c.moveTo(x, y);
        c.lineTo(x + 10 + r() * 40, y + (r() - 0.5) * 16);
        c.stroke();
      }
    }
    c.restore();
    shape();
    c.lineWidth = 6;
    c.strokeStyle = good ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.18)';
    c.stroke();
  }

  /* ---- bancos e interior ---- */
  function seat(c, mode, r, variant) {
    const beige = variant === 'interior';
    const base = beige ? [172, 146, 112] : [30, 30, 34];
    const m = (f, a) => rgba(base[0] * f, base[1] * f, base[2] * f, a === undefined ? 1 : a);
    c.fillStyle = m(0.5);
    c.fillRect(0, 0, W, H);
    const size = 100, hs = size / 2;
    for (let row = -1; row < H / hs + 2; row++) {
      for (let col = -1; col < W / size + 2; col++) {
        const cx = col * size + (row % 2 ? hs : 0), cy = row * hs;
        const g = c.createRadialGradient(cx, cy, 2, cx, cy, hs * 1.05);
        g.addColorStop(0, m(1.45));
        g.addColorStop(1, m(0.72));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(cx, cy - hs);
        c.lineTo(cx + hs, cy);
        c.lineTo(cx, cy + hs);
        c.lineTo(cx - hs, cy);
        c.closePath();
        c.fill();
        c.strokeStyle = 'rgba(0,0,0,.55)';
        c.lineWidth = 2;
        c.stroke();
        c.save();
        c.setLineDash([5, 4]);
        c.strokeStyle = beige ? 'rgba(236,222,196,.55)' : 'rgba(255,138,61,.7)';
        c.lineWidth = 1;
        const q = hs - 7;
        c.beginPath();
        c.moveTo(cx, cy - q);
        c.lineTo(cx + q, cy);
        c.lineTo(cx, cy + q);
        c.lineTo(cx - q, cy);
        c.closePath();
        c.stroke();
        c.restore();
        c.fillStyle = m(0.35);
        c.beginPath();
        c.arc(cx, cy, 3, 0, 6.283);
        c.fill();
      }
    }
    if (mode === 'before') {
      const darkBlot = beige ? 'rgba(66,44,26,.38)' : 'rgba(150,140,125,.2)';
      for (let i = 0; i < 9; i++) blob(c, r, r() * W, r() * H, 40 + r() * 70, darkBlot);
      for (let i = 0; i < 6; i++) blob(c, r, r() * W, r() * H, 26 + r() * 40, beige ? 'rgba(40,28,18,.45)' : 'rgba(20,18,16,.5)');
      const grime = c.createLinearGradient(0, H * 0.55, 0, H);
      grime.addColorStop(0, 'rgba(60,46,32,0)');
      grime.addColorStop(1, 'rgba(60,46,32,.4)');
      c.fillStyle = grime;
      c.fillRect(0, 0, W, H);
      for (let i = 0; i < 900; i++) {
        c.fillStyle = `rgba(${150 + r() * 60},${140 + r() * 50},${120 + r() * 40},${0.08 + r() * 0.16})`;
        c.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
      }
    } else {
      const sheen = c.createLinearGradient(0, 0, W, H);
      sheen.addColorStop(0.25, 'rgba(255,255,255,0)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,.17)');
      sheen.addColorStop(0.75, 'rgba(255,255,255,0)');
      c.fillStyle = sheen;
      c.fillRect(0, 0, W, H);
    }
  }

  const ART = { wash, polish, ceramic, ppf, revive, headlight: lamp, interior: (c, m, r) => seat(c, m, r, 'interior'), seat: (c, m, r) => seat(c, m, r, 'seat') };

  function draw(canvas, kind, mode) {
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d');
    const seedBase = Array.from(kind).reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7);
    (ART[kind] || polish)(c, mode, rng(seedBase + (mode === 'after' ? 99 : 1)));
  }

  /* ---- comparador ---- */
  function layer(src, kind, mode, label) {
    const box = document.createElement('div');
    box.className = 'cmp-layer cmp-' + mode;
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = label;
      img.loading = 'lazy';
      img.decoding = 'async';
      box.appendChild(img);
    } else {
      const cv = document.createElement('canvas');
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', label + ' (ilustração)');
      cv._pending = () => draw(cv, kind, mode);
      box.appendChild(cv);
    }
    return box;
  }

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        e.target.querySelectorAll('canvas').forEach((cv) => { if (cv._pending) { cv._pending(); cv._pending = null; } });
      }
    }, { rootMargin: '300px' })
    : null;

  function mountCompare(host, svc, opts) {
    opts = opts || {};
    host.textContent = '';
    host.classList.add('cmp');
    const before = layer(svc.before_image, svc.kind, 'before', 'Antes: ' + svc.name);
    const after = layer(svc.after_image, svc.kind, 'after', 'Depois: ' + svc.name);
    const tagB = Object.assign(document.createElement('span'), { className: 'cmp-tag cmp-tag-b', textContent: 'Antes' });
    const tagA = Object.assign(document.createElement('span'), { className: 'cmp-tag cmp-tag-a', textContent: 'Depois' });
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = '50';
    range.className = 'cmp-range';
    range.setAttribute('aria-label', 'Arraste para comparar o antes e o depois: ' + svc.name);
    const handle = document.createElement('div');
    handle.className = 'cmp-handle';
    handle.appendChild(document.createElement('i'));
    const set = (v) => {
      after.style.clipPath = `inset(0 0 0 ${v}%)`;
      handle.style.left = v + '%';
      range.value = String(v);
    };
    range.addEventListener('input', () => set(Number(range.value)));
    host.append(before, after, tagB, tagA, range, handle);
    set(50);
    if (io) io.observe(host); else host.querySelectorAll('canvas').forEach((cv) => { cv._pending(); });
    if (opts.intro && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let started = false;
      const run = () => {
        if (started) return;
        started = true;
        const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / 1500);
          const ease = 1 - Math.pow(1 - k, 3);
          set(Math.round(6 + 44 * ease));
          if (k < 1) requestAnimationFrame(step);
        };
        set(6);
        requestAnimationFrame(step);
      };
      if (io) {
        const o = new IntersectionObserver((es) => { if (es[0].isIntersecting) { o.disconnect(); run(); } }, { threshold: 0.5 });
        o.observe(host);
      }
    }
    return { set };
  }

  window.HLArt = { mountCompare, draw };
})();
