// Pixel-art loading screen. Runs before the 3D module loads; main.js reports
// progress through window.__loader and calls done() when the scene is ready.
(() => {
  const el = document.getElementById('loader');
  const g = document.getElementById('pix').getContext('2d');
  const bar = el.querySelector('.bar');
  const msg = el.querySelector('.msg');
  const blocks = [];
  const BLOCK = ['#ffb81c', '#ff9a16', '#ff7a12', '#f25a16', '#e8331b'];
  for (let i = 0; i < 20; i++) blocks.push(bar.appendChild(document.createElement('i')));
  const start = performance.now();
  let progress = 0, shown = 0, running = true;

  // Wood streak columns, fixed so the art doesn't shimmer.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const streaks = Array.from({ length: 22 }, () => [12 + Math.floor(rnd() * 72), rnd() < 0.7 ? '#4a1a08' : '#a04c22', Math.floor(rnd() * 6)]);
  const CHASE = [0, 1, 3, 5, 4, 2];
  const px = (c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const outline = (c, x, y, w, h) => { px(c, x + 1, y, w - 2); px(c, x + 1, y + h - 1, w - 2); px(c, x, y + 1, 1, h - 2); px(c, x + w - 1, y + 1, 1, h - 2); };

  function draw(t) {
    g.clearRect(0, 0, 96, 64);
    px('#0f0703', 14, 58, 72, 3);                    // shadow
    px('#7a3518', 12, 36, 72, 22);                   // rosewood box
    for (const [x, c, gap] of streaks) { px(c, x, 36, 1, 22); px('#7a3518', x, 40 + gap * 3, 1, 2); }
    px('#97461f', 12, 35, 72, 1);                    // top ledge
    px('#0c0605', 12, 57, 72, 1);
    for (const x of [16, 73]) {                      // aluminum walls
      px('#b9b3a8', x, 8, 7, 28); px('#e6e1d8', x, 8, 1, 28); px('#8a847a', x + 6, 8, 1, 28);
    }
    px('#140d0b', 23, 8, 50, 28);                    // smoked faceplate
    px('#e6e1d6', 36, 10, 24, 2);                    // EXECUTIVE
    px('#e6e1d6', 38, 13, 20, 1);                    // DECISION MAKER
    const lit = CHASE[Math.floor(t / 90) % 6];
    for (let i = 0; i < 6; i++) {
      const x = 25 + (i % 2) * 23, y = 15 + Math.floor(i / 2) * 6;
      outline('#e6e1d6', x, y, 21, 5);
      px('#8d8a84', x + 6, y + 1, 9, 1);             // label
      if (i === lit) { px('#7a1408', x + 8, y + 1, 4, 3); px('#ff3a1a', x + 9, y + 2, 2, 2); px('#ffd0b0', x + 9, y + 2); }
      else px('#3a0a06', x + 9, y + 2, 2, 2);
    }
    px('#050303', 26, 33, 7, 2); px('#3a3a3a', 26, 33, 2, 2);   // ON/OFF slide
    px('#e6e1d6', 40, 33, 16, 2);                               // wordmark
    px('#c8c6c2', 64, 32, 4, 4); px('#1a1a1a', 65, 33, 2, 2);    // ASK button
    if (window.__theme === 'halloween') {             // a jack-o'-lantern beside it
      const glow = Math.sin(t / 70) > -0.6 ? '#ffd23a' : '#c9861a';
      px('#d4601a', 86, 50, 9, 8); px('#d4601a', 85, 51, 11, 6); px('#a8420e', 90, 50, 1, 8);
      px('#4d5a24', 90, 47, 2, 3);
      px(glow, 87, 52, 2, 1); px(glow, 92, 52, 2, 1); px(glow, 88, 55, 5, 1); px(glow, 89, 54, 1, 1); px(glow, 91, 54, 1, 1);
    }
  }

  function loop(t) {
    if (!running) return;
    shown += (progress - shown) * 0.12;
    const on = Math.round(shown * blocks.length);
    blocks.forEach((b, i) => { b.style.background = i < on ? BLOCK[Math.floor((i / blocks.length) * BLOCK.length)] : '#3a2418'; });
    draw(t - start);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.__loader = {
    set(p, text) {
      progress = Math.max(progress, p);
      if (text) msg.textContent = text;
    },
    // Hold for a moment so it's seen even on fast loads, fill the bar, then wipe away.
    done() {
      return new Promise((resolve) => {
        const hold = Math.max(0, 1500 - (performance.now() - start));
        setTimeout(() => {
          progress = 1;
          setTimeout(() => {
            el.classList.add('out');
            setTimeout(() => { running = false; el.remove(); resolve(); }, 900);
          }, 350);
        }, hold);
      });
    },
  };
  // If anything fails before the scene is up (a script blocked or tampered
  // with, no import-map support, an exception), say so instead of loading forever.
  function fail(text) {
    if (!running) return;
    running = false;
    el.remove();
    const box = document.getElementById('fail');
    box.textContent = text;
    box.style.display = 'grid';
  }
  const broken = 'Something went wrong loading the 3D scene. Try reloading; if it keeps happening, your browser or network may be blocking it.';
  addEventListener('error', () => fail(broken), true);
  addEventListener('unhandledrejection', () => fail(broken));
  addEventListener('DOMContentLoaded', () => {
    if (!(HTMLScriptElement.supports && HTMLScriptElement.supports('importmap'))) {
      fail('This needs a newer browser: one that supports JavaScript import maps (Chrome, Edge or Firefox from 2023, Safari 16.4 or later).');
    }
  });
  setTimeout(() => { if (running && progress < 1) msg.textContent = 'Still loading. Check your connection'; }, 30000);
})();
