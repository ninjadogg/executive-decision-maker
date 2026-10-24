import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { THEME, themeConfig, buildThemeProps, installMist } from './themes.js';

const CFG = themeConfig();
installMist();

// The six windows, laid out as on the original faceplate: two columns, three rows.
const WINDOWS = [
  { text: 'DEFINITELY', col: 0, row: 0 },
  { text: 'ASK AGAIN', col: 1, row: 0 },
  { text: 'NEVER', col: 0, row: 1 },
  { text: 'FORGET IT', col: 1, row: 1 },
  { text: 'WHY NOT', col: 0, row: 2 },
  { text: 'POSSIBLY', col: 1, row: 2 },
];
// The chase runs clockwise around the grid.
const CHASE = [0, 1, 3, 5, 4, 2];

// Cabinet (world units ≈ inches). A flat woodgrain box; set slightly in from its
// edges, brushed-aluminum side and back walls rise toward the back and hold the
// sloped glass well between them, so the faceplate tilts toward you.
const W = 4.2, D = 4.0, HW = 1.5, FOOT = 0.05;
const BASE_TOP = FOOT + HW;
const INSET = 0.1, STRIP = 0.4, BACK_T = 0.12, WALL_BEV = 0.03;
const SEAT = WALL_BEV + 0.01;             // walls and lip sit this far into the wood
const LIP = 0.14, LIP_D = 0.07;            // black front lip below the glass's low edge
const GAP = 0.09, GLASS_T = 0.03;         // LEDs sit on a backplane under a floating smoked-glass sheet
const GLASS_TOP = GAP + GLASS_T;
const Z_OUT_FRONT = D / 2 - 0.03 - WALL_BEV, Z_OUT_BACK = -(D / 2 - INSET - WALL_BEV);
const Z_FRONT = Z_OUT_FRONT - LIP_D, Z_BACK = Z_OUT_BACK + BACK_T;   // glass well, front to back
const SLOPE = THREE.MathUtils.degToRad(13);
const RISE = (Z_FRONT - Z_BACK) * Math.tan(SLOPE);
const PW = W - 2 * INSET - 2 * STRIP, PL = Math.hypot(Z_FRONT - Z_BACK, RISE);

const COL_X = [-0.78, 0.78];
const ROW_Z = [-0.62, 0.1, 0.82];
const BOX_W = 1.4, BOX_H = 0.62;
const LED_DZ = 0.07;                       // LED sits a little below the box centre
const SWITCH = { x: -1.15, z: 1.62, travel: 0.12 };
const ASK = { x: 1.2, z: 1.62 };

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
// Wide geometric sans for the title, like the original's Avant Garde-style lettering.
const TITLE_FONT = `Montserrat, ${FONT}`;
const LOGO_FONT = `"Montserrat Alternates", ${FONT}`;
const LITE = matchMedia('(pointer: coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = Math.random;
const canvas = document.getElementById('c');
const readout = document.getElementById('readout');
const hint = document.getElementById('hint');
const muteBtn = document.getElementById('mute');
// Touch screens have no Space bar to mention.
if (LITE) hint.textContent = 'Tap ASK · drag to look around';
const HINT_READY = hint.textContent;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  const fail = document.getElementById('fail');
  // Chrome drops WebGL entirely when graphics acceleration is off, so say where the switch is.
  if (/Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent)) {
    fail.textContent = 'This needs WebGL, which Chrome only provides with graphics acceleration on: Settings › System › “Use graphics acceleration when available”, then Relaunch.';
  }
  fail.style.display = 'grid';
  window.__loader?.done();
  throw e;
}
const DPR = Math.min(devicePixelRatio, LITE ? 1.5 : 2);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CFG.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
// Shadows are redrawn only when a caster moves (the ASK button, the switch knob);
// the frame loop sets needsUpdate. Redrawing the VSM every frame was a big cost.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

// If the GPU drops the context (memory pressure, driver reset), say so and
// reload once at a lower texture budget rather than leaving a dead canvas.
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  const fail = document.getElementById('fail');
  let tries = 0;
  try { tries = Number(sessionStorage.getItem('edm-gl-resets') || 0); sessionStorage.setItem('edm-gl-resets', tries + 1); } catch {}
  if (tries >= 2) {
    fail.textContent = 'The graphics card keeps resetting. Try closing other tabs, or reopen the browser.';
    fail.style.display = 'grid';
    return;
  }
  fail.textContent = 'The graphics card reset. Reloading at a lighter setting…';
  fail.style.display = 'grid';
  const url = new URL(location.href);
  url.searchParams.set('tex', tries ? '1024' : '2048');
  setTimeout(() => location.replace(url), 1200);
});
RectAreaLightUniformsLib.init();

// ---------- loading ----------
// The pixel loading screen (inline in index.html) shows progress; the heavy
// texture work below yields a couple of frames between stages so it can animate.
const loader = window.__loader || { set() {}, done: () => Promise.resolve() };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
async function stage(progress, message) {
  loader.set(progress, message);
  await nextFrame();
  await nextFrame();
}
await stage(0.06, 'Loading the typefaces');
const fontSheet = document.getElementById('gfonts');
await Promise.race([
  (fontSheet?.sheet ? Promise.resolve() : new Promise((r) => fontSheet?.addEventListener('load', r, { once: true })))
    .then(() => Promise.all(['500 40px Montserrat', '800 40px "Montserrat Alternates"'].map((f) => document.fonts.load(f)))),
  new Promise((r) => setTimeout(r, 4000)),
]).catch(() => {});

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1917);
const pmrem = new THREE.PMREMGenerator(renderer);
// A dark room with a few bright panels (from the month's theme), so glossy
// surfaces pick up crisp softbox and window reflections, like a product shot.
function studioEnvironment() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 16, 40), new THREE.MeshBasicMaterial({ color: CFG.room, side: THREE.BackSide }));
  room.position.y = 7;
  env.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: CFG.envFloor }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.9;
  env.add(floor);
  const panel = (w, h, intensity, color, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide,
    }));
    m.position.set(...pos);
    m.lookAt(0, 2, 0);
    env.add(m);
  };
  for (const args of CFG.panels) panel(...args);
  return env;
}
scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
scene.environmentIntensity = CFG.envIntensity;

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 120);
const VIEW_DIR = new THREE.Vector3(0.3, 0.52, 0.8).normalize();

// Product-shot lighting: a big softbox up front, a shadow-casting key, a cool rim.
const softbox = new THREE.RectAreaLight(0xfff4e6, 5, 9, 4);
softbox.position.set(-1.5, 9, 7);
softbox.lookAt(0, 2, 0);
scene.add(softbox);
const key = new THREE.DirectionalLight(0xfff0dc, 1.6);
key.position.set(-6, 11, 7);
key.castShadow = true;
// 2048 is plenty under VSM's blur; 4096 cost ~270 MB of GPU memory on its own.
key.shadow.mapSize.set(LITE ? 1024 : 2048, LITE ? 1024 : 2048);
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 2, far: 30 });
key.shadow.radius = 10;
key.shadow.blurSamples = 20;
key.shadow.bias = -0.0005;
scene.add(key);
const rim = new THREE.DirectionalLight(0xbcd0ff, 0.9);
rim.position.set(7, 5, -8);
scene.add(rim);
const hemi = new THREE.HemisphereLight(0xfff6ea, 0x3a332c, 0.25);
scene.add(hemi);
if (CFG.lights) {
  const L = CFG.lights;
  softbox.color.set(L.softbox[0]);
  softbox.intensity = L.softbox[1];
  key.color.set(L.key[0]);
  key.intensity = L.key[1];
  key.position.set(...L.key[2]);
  rim.color.set(L.rim[0]);
  rim.intensity = L.rim[1];
  hemi.color.set(L.hemi[0]);
  hemi.groundColor.set(L.hemi[1]);
  hemi.intensity = L.hemi[2];
}

// ---------- textures ----------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat, color = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  return t;
}

// Rosewood-look vinyl, w x h: long, nearly parallel dark streaks over fine grain,
// running along the canvas y axis, tileable both ways. The soft, blurred figure
// is drawn at quarter size and scaled up; fine grain is drawn at full size.
// Widths, wobble and blur are given in pixels of a 1024-wide sheet.
function rosewood(w, h) {
  const TAU = Math.PI * 2;
  const p1 = rand() * TAU, p2 = rand() * TAU, p3 = rand() * TAU;
  // Grain lines run roughly parallel: every streak follows one shared flow (as a
  // fraction of the width), with a little drift of its own.
  const flow = (v) => (5 * Math.sin(TAU * v + p1) + 2.5 * Math.sin(2 * TAU * v + p2) + 1 * Math.sin(3 * TAU * v + p3)) / 1024;
  const band = (g, cw, ch, x0, width, alpha, wobble, color, blur = 0) => {
    const k = cw / 1024;
    g.filter = blur ? `blur(${blur * k}px)` : 'none';
    const m = 1 + Math.floor(rand() * 2), ph = rand() * TAU, follow = 0.7 + rand() * 0.6;
    g.strokeStyle = `rgba(${color},${alpha})`;
    g.lineWidth = width * k;
    const dy = Math.max(4, ch / 128);
    for (const off of [-cw, 0, cw]) {
      g.beginPath();
      for (let y = 0; y <= ch + 0.01; y += dy) {
        const v = y / ch;
        const x = x0 * cw + off + flow(v) * follow * cw + Math.sin(TAU * m * v + ph) * wobble * 0.35 * k;
        y ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  };
  // Broad colour variation: wide and faint, so it's drawn small, blurred and scaled up.
  const [soft, sg] = makeCanvas(w >> 2, h >> 2);
  sg.fillStyle = '#7e3619';
  sg.fillRect(0, 0, soft.width, soft.height);
  for (let i = 0; i < 46; i++) band(sg, soft.width, soft.height, rand(), 10 + rand() * 50, 0.08 + rand() * 0.12, 4 + rand() * 10, rand() < 0.5 ? '60,18,6' : '170,80,38', 8);
  sg.filter = 'none';
  // The figure: dark streaks with crisp edges (no blur, which made it look gummy).
  const [fig, fg] = makeCanvas(w >> 1, h >> 1);
  for (let i = 0; i < 30; i++) band(fg, fig.width, fig.height, rand(), 4 + rand() * 18, 0.16 + rand() * 0.3, 3 + rand() * 14, '30,8,3');
  for (let i = 0; i < 30; i++) band(fg, fig.width, fig.height, rand(), 1 + rand() * 4, 0.2 + rand() * 0.3, 3 + rand() * 10, '24,7,2');
  // Fine grain at full size, on its own layer so it can also be embossed.
  const [fine, ng] = makeCanvas(w, h);
  const lines = Math.round((600 * w) / 1024);
  for (let i = 0; i < lines; i++) band(ng, w, h, rand(), 0.12 + rand() * 0.45, 0.06 + rand() * 0.16, 1 + rand() * 6, rand() < 0.8 ? '42,12,4' : '196,104,56');
  const [c, g] = makeCanvas(w, h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(soft, 0, 0, w, h);
  g.drawImage(fig, 0, 0, w, h);
  g.drawImage(fine, 0, 0);
  return { color: c, fine };
}

function noiseCanvas(size, base, amount, alpha) {
  const [c, g] = makeCanvas(size, size);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < amount; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${alpha * rand()})` : `rgba(255,255,255,${alpha * rand()})`;
    g.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  return c;
}

function halfSize(src) {
  const [c, g] = makeCanvas(src.width >> 1, src.height >> 1);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function brushedCanvas(w, h, base) {
  const [c, g] = makeCanvas(w, h);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * 4; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${rand() * 0.06})` : `rgba(0,0,0,${rand() * 0.05})`;
    g.fillRect(rand() * w, 0, 0.3 + rand() * 0.9, h);
  }
  return c;
}

// Fine household dust: mostly tiny specks, a few bigger soft flecks, the odd
// lint fibre. density(u, v) (0..1 across the canvas) lets it gather in corners.
// scale: canvas pixels per unit relative to 300, so specks keep their real size.
function sprinkleDust(g, w, h, count, { density = () => 1, color = '214,208,196', fibres = 0, scale = 1 } = {}) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w, y = rand() * h;
    if (rand() > density(x / w, y / h)) continue;
    const big = rand() < 0.015;
    g.fillStyle = `rgba(${color},${big ? 0.12 + rand() * 0.14 : 0.04 + rand() * 0.13})`;
    g.beginPath();
    g.arc(x, y, (big ? 0.8 + rand() * 0.6 : 0.3 + rand() * 0.45) * scale, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 0.7 * scale;
  for (let i = 0; i < fibres; i++) {
    const x = rand() * w, y = rand() * h, len = (12 + rand() * 50) * scale, a = rand() * Math.PI * 2, j = 20 * scale;
    g.strokeStyle = `rgba(${color},${0.08 + rand() * 0.1})`;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(
      x + Math.cos(a) * len * 0.4 + (rand() - 0.5) * j, y + Math.sin(a) * len * 0.4 + (rand() - 0.5) * j,
      x + Math.cos(a) * len * 0.7 + (rand() - 0.5) * j, y + Math.sin(a) * len * 0.7 + (rand() - 0.5) * j,
      x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
}
// Dust settles thicker against the walls and the back edge of the glass.
const edgeDust = (x, y) => {
  const edge = Math.min(x, 1 - x, y * 0.8, (1 - y) * 2);
  return 0.35 + 0.65 * Math.max(0, 1 - edge / 0.07);
};

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Faceplate coordinates (x right, z toward the viewer) to canvas pixels.
// Texture resolution: the faceplate artwork's long side is 4096 px (2048 on touch devices).
// ?tex=2048 (or 1024) overrides it, for slower machines.
const TEX_MAX = Math.min(4096, Number(new URLSearchParams(location.search).get('tex')) || (LITE ? 2048 : 4096));
const PX = Math.floor(TEX_MAX / Math.max(PW, PL));   // faceplate texture pixels per unit
const DUST_SCALE = PX / 300;                          // dust sizes were tuned at 300 px/unit
const CW = Math.round(PW * PX), CH = Math.round(PL * PX);
const toPx = (x, z) => [(x / PW + 0.5) * CW, (z / PL + 0.5) * CH];
const u = (n) => n * PX;

// The screen print. Drawn white-on-transparent so it doubles as the ink mask.
function printCanvas() {
  const [c, g] = makeCanvas(CW, CH);
  const ink = '#ebe8e0';
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const spaced = (px) => { if ('letterSpacing' in g) g.letterSpacing = `${px}px`; };

  // On the unit both title lines run the same width, a bit over half the panel.
  const fitFont = (text, weight, family, width, track) => {
    g.font = `${weight} 100px ${family}`;
    spaced(100 * track);
    const size = (100 * u(width)) / g.measureText(text).width;
    g.font = `${weight} ${size}px ${family}`;
    spaced(size * track);
  };
  let [x, y] = toPx(0, -1.52);
  fitFont('EXECUTIVE', 500, TITLE_FONT, 1.74, 0.02);
  g.fillText('EXECUTIVE', x, y);
  [x, y] = toPx(0, -1.21);
  fitFont('DECISION MAKER', 500, TITLE_FONT, 1.74, 0.03);
  g.fillText('DECISION MAKER', x, y);

  spaced(u(0.006));
  g.lineWidth = u(0.022);
  for (const w of WINDOWS) {
    const [bx, by] = toPx(COL_X[w.col] - BOX_W / 2, ROW_Z[w.row] - BOX_H / 2);
    roundRect(g, bx, by, u(BOX_W), u(BOX_H), u(0.1));
    g.stroke();
    const [tx, ty] = toPx(COL_X[w.col], ROW_Z[w.row] - BOX_H / 2 + 0.15);
    g.font = `500 ${u(0.14)}px ${FONT}`;
    g.fillText(w.text, tx, ty);
  }

  g.font = `500 ${u(0.1)}px ${FONT}`;
  [x, y] = toPx(SWITCH.x - SWITCH.travel - 0.04, SWITCH.z - 0.24);
  g.fillText('ON', x, y);
  [x, y] = toPx(SWITCH.x + SWITCH.travel + 0.06, SWITCH.z - 0.24);
  g.fillText('OFF', x, y);
  [x, y] = toPx(ASK.x, ASK.z - 0.27);
  g.fillText('ASK', x, y);

  [x, y] = toPx(0.08, SWITCH.z - 0.02);
  drawWordmark(g, x, y, u(1.43));
  return c;
}

// The 1970s wordmark, set by hand from a photo of the unit (not copied from
// logo artwork): heavy geometric lowercase, a dotless i, and the S drawn as a
// tall integral-sign stroke, all upright. Centred on (cx, cy), width wide.
function drawWordmark(g, cx, cy, width) {
  const F = 100;
  g.save();
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.font = `800 ${F}px ${LOGO_FONT}`;
  g.textBaseline = 'alphabetic';            // measure from the baseline, not the caller's setting
  g.textAlign = 'left';
  const capH = g.measureText('H').actualBoundingBoxAscent;
  const xH = g.measureText('x').actualBoundingBoxAscent;
  const l = g.measureText('l');
  const stem = l.actualBoundingBoxRight + l.actualBoundingBoxLeft;
  const track = -0.025 * F;
  const S_W = 0.72 * F;
  const glyphs = ['R', 'a', 'd', 'ı', 'o', ' ', 'S', 'h', 'a', 'c', 'k'];
  const advance = (ch) => (ch === 'S' ? S_W : ch === 'ı' ? l.width : g.measureText(ch).width) + track;
  const total = glyphs.reduce((sum, ch) => sum + advance(ch), -track);
  const k = width / total;
  g.translate(cx - (total * k) / 2, cy + (capH * k) / 2);
  g.scale(k, k);
  let pen = 0;
  for (const ch of glyphs) {
    if (ch === 'ı') {
      g.fillRect(pen + (l.width - stem) / 2, -xH, stem, xH);
    } else if (ch === 'S') {
      // A calligraphic stroke: discs stamped along a centreline, full stem weight
      // in the slanted middle, tapering into the right-curling top hook and the
      // left-curling bottom hook.
      const segs = [
        [[0.6, -capH + 0.1 * F], [0.6, -capH - 0.04 * F], [0.34, -capH - 0.06 * F], [0.35, -capH + 0.2 * F]],
        [[0.35, -capH + 0.2 * F], [0.33, -capH * 0.6], [0.31, -capH * 0.4], [0.29, -0.2 * F]],
        [[0.29, -0.2 * F], [0.28, 0.04 * F], [0.06, 0.05 * F], [0.06, -0.12 * F]],
      ].map((seg) => seg.map(([x, y]) => [x < 1 ? x * F + 0.06 * F : x, y]));
      const bez = ([a, b, c, d], t) => {
        const m = 1 - t;
        return [0, 1].map((k) => m * m * m * a[k] + 3 * m * m * t * b[k] + 3 * m * t * t * c[k] + t * t * t * d[k]);
      };
      segs.forEach((seg, si) => {
        for (let n = 0; n <= 80; n++) {
          const t = n / 80;
          const [px2, py2] = bez(seg, t);
          // 0 at the hook tips, 1 along the stem
          const weight = si === 1 ? 1 : si === 0 ? 0.55 + 0.45 * t : 1 - 0.45 * t;
          g.beginPath();
          g.arc(pen + px2, py2, (stem / 2) * weight, 0, Math.PI * 2);
          g.fill();
        }
      });
    } else if (ch !== ' ') {
      g.fillText(ch, pen, 0);
    }
    pen += advance(ch);
  }
  g.restore();
}

function faceplateMaps() {
  // Ink layer for the top of the glass: the print and a little dust.
  const [c, g] = makeCanvas(CW, CH);
  g.drawImage(printCanvas(), 0, 0);
  // A faint film of settled dust along the walls and back edge, then the specks.
  for (const [x0, y0, x1, y1] of [[0, 0, u(0.25), 0], [CW, 0, CW - u(0.25), 0], [0, 0, 0, u(0.3)]]) {
    const grd = g.createLinearGradient(x0, y0, x1, y1);
    grd.addColorStop(0, 'rgba(200,194,182,.07)');
    grd.addColorStop(1, 'rgba(200,194,182,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, CW, CH);
  }
  sprinkleDust(g, CW, CH, 7000, { density: edgeDust, fibres: 8, scale: DUST_SCALE });

  // Glass roughness (green channel): polished, with soft smudges and a couple of
  // thumbprints by the ASK button. Rough spots also blur what's seen through them.
  const [r, rg] = makeCanvas(1024, Math.round(1024 * CH / CW));
  rg.fillStyle = 'rgb(0,10,0)';
  rg.fillRect(0, 0, r.width, r.height);
  const smudge = (x, y, rad, a) => {
    const grd = rg.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(0,90,0,${a})`);
    grd.addColorStop(1, 'rgba(0,90,0,0)');
    rg.fillStyle = grd;
    rg.beginPath();
    rg.ellipse(x, y, rad, rad * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
    rg.fill();
  };
  const sk = r.width / 512;
  for (let i = 0; i < 14; i++) smudge(rand() * r.width, rand() * r.height, (20 + rand() * 60) * sk, 0.15 + rand() * 0.2);
  const ax = (ASK.x / PW + 0.5) * r.width, az = (ASK.z / PL + 0.5) * r.height;
  smudge(ax - 30 * sk, az - 40 * sk, 34 * sk, 0.5);
  smudge(ax - 60 * sk, az - 10 * sk, 26 * sk, 0.35);
  // Dust specks diffuse the reflection where they sit.
  sprinkleDust(rg, r.width, r.height, 2500, { density: edgeDust, color: '0,200,0', scale: r.width / PW / 300 });

  return { ink: toTexture(c), roughness: toTexture(r, { color: false }) };
}

// The circuit board under the glass: red solder mask over glass-fibre board,
// copper traces just visible under the mask, tinned pads, white silkscreen.
// Returns colour plus an ORM-style map (G = roughness, B = metalness).
const RES_DX = 0.4;                         // each LED's resistor sits to its right
function pcbMaps() {
  const [c, g] = makeCanvas(CW, CH);
  const [o, og] = makeCanvas(CW, CH);
  g.fillStyle = '#5a170f';
  g.fillRect(0, 0, CW, CH);
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${0.05 * rand()})` : `rgba(255,120,90,${0.04 * rand()})`;
    g.fillRect(rand() * CW, rand() * CH, (2 + rand() * 5) * DUST_SCALE, (1 + rand() * 2) * DUST_SCALE);
  }
  og.fillStyle = 'rgb(0,140,0)';
  og.fillRect(0, 0, CW, CH);

  const trace = (pts, width = 0.03) => {
    for (const [ctx, style] of [[g, '#7a2a18'], [og, 'rgb(0,95,0)']]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = u(width);
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, z], i) => { const [px, py] = toPx(x, z); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
    }
  };
  const pad = (x, z, r, hole = 0) => {
    const [px, py] = toPx(x, z);
    g.fillStyle = '#cfc7b6';
    og.fillStyle = 'rgb(0,55,255)';
    for (const ctx of [g, og]) {
      ctx.beginPath();
      ctx.arc(px, py, u(r), 0, Math.PI * 2);
      ctx.fill();
    }
    if (hole) {
      g.fillStyle = '#1a0805';
      g.beginPath();
      g.arc(px, py, u(hole), 0, Math.PI * 2);
      g.fill();
    }
  };

  // Power buses down the gutters, hidden behind the paint but there all the same.
  trace([[-0.02, -1.0], [-0.02, 1.25]], 0.06);
  trace([[0.02, -1.0], [0.02, 1.25]], 0.06);
  g.font = `600 ${u(0.06)}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  WINDOWS.forEach((w, i) => {
    const x = COL_X[w.col], z = ROW_Z[w.row] + LED_DZ;
    const toBus = w.col ? -0.02 : 0.02;
    trace([[x + 0.06, z], [x + RES_DX - 0.08, z]]);
    trace([[x + RES_DX + 0.08, z], [x + RES_DX + 0.2, z], [x + RES_DX + 0.2, z + 0.2], [toBus, z + 0.2]]);
    trace([[x - 0.06, z], [x - 0.4, z], [x - 0.4, z - 0.2], [toBus, z - 0.2]]);
    pad(x, z, 0.13, 0);
    pad(x + RES_DX - 0.08, z, 0.035, 0.012);
    pad(x + RES_DX + 0.08, z, 0.035, 0.012);
    g.fillStyle = '#e6e1d6';
    let [lx, ly] = toPx(x - 0.24, z + 0.1);
    g.fillText(`D${i + 1}`, lx, ly);
    [lx, ly] = toPx(x + RES_DX, z - 0.09);
    g.fillText(`R${i + 1}`, lx, ly);
  });
  return { map: toTexture(c), orm: toTexture(halfSize(o), { color: false }) };
}

// Black paint on the back of the glass, clear only through the six windows.
function paintMask() {
  const [c, g] = makeCanvas(CW, CH);
  g.fillStyle = '#000';
  g.fillRect(0, 0, CW, CH);
  g.globalCompositeOperation = 'destination-out';
  const inset = 0.014;
  for (const w of WINDOWS) {
    const [bx, by] = toPx(COL_X[w.col] - BOX_W / 2 + inset, ROW_Z[w.row] - BOX_H / 2 + inset);
    roundRect(g, bx, by, u(BOX_W - 2 * inset), u(BOX_H - 2 * inset), u(0.09));
    g.fill();
  }
  return toTexture(halfSize(c));
}

// Carbon-film resistor bands: orange, orange, brown, gold (330 ohm).
function resistorTexture() {
  const [c, g] = makeCanvas(16, 128);
  g.fillStyle = '#cdb68a';
  g.fillRect(0, 0, 16, 128);
  [['#c8641e', 30], ['#c8641e', 46], ['#5a3014', 62], ['#b8902c', 92]].forEach(([col, y]) => {
    g.fillStyle = col;
    g.fillRect(0, y, 16, 9);
  });
  return toTexture(c);
}

function glowTexture() {
  const [c, g] = makeCanvas(256, 256);
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,255,255,.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return toTexture(c);
}

// ---------- materials ----------
// Matte, oiled-rosewood finish: no gloss coat to speak of, roughness that
// follows the figure, and open pores along the grain. One sheet is shared by
// every face (each takes its own offset); the top gets a dusty copy.
const WOOD_W = TEX_MAX, WOOD_H = WOOD_W / 2;
const WOOD_PX = WOOD_W / W;                 // the sheet's width spans the box width
await stage(0.16, 'Sanding the rosewood');
const wood = (() => {
  const { color: src, fine } = rosewood(WOOD_W, WOOD_H);
  // Emboss only the fine grain and pores, like wood-grain vinyl, not the figure.
  const [b, bg] = makeCanvas(WOOD_W, WOOD_H);
  bg.fillStyle = '#808080';
  bg.fillRect(0, 0, WOOD_W, WOOD_H);
  bg.drawImage(fine, 0, 0);
  const k = WOOD_W / 1024;
  for (let i = 0; i < 20000; i++) {
    bg.fillStyle = `rgba(0,0,0,${0.2 + rand() * 0.4})`;
    bg.fillRect(rand() * WOOD_W, rand() * WOOD_H, Math.max(1, 0.5 * k), (2 + rand() * 5) * k);
  }
  const [r, rg] = makeCanvas(1024, 512);
  rg.fillStyle = 'rgb(0,215,0)';
  rg.fillRect(0, 0, 1024, 512);
  rg.globalCompositeOperation = 'multiply';
  rg.globalAlpha = 0.35;
  rg.drawImage(src, 0, 0, 1024, 512);
  const [d, dg] = makeCanvas(WOOD_W, WOOD_H);
  dg.drawImage(src, 0, 0);
  sprinkleDust(dg, WOOD_W, WOOD_H, 3500, { fibres: 4, scale: WOOD_PX / 300 });
  const tex = (canvas, color) => {
    const t = toTexture(canvas, { color });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  return { map: tex(src, true), dusty: tex(d, true), bump: tex(b, false), rough: tex(r, false) };
})();

// ---------- dust ----------
// Settled dust on up-facing surfaces: a mottled, matte film plus specks, laid
// down in world space so it ignores UVs. buildUp adds a heavier band on the
// wood ledge against the aluminum housing, where a duster never quite reaches.
const DUST_COLOR = new THREE.Color(0.5, 0.48, 0.45);
// Housing footprint on the wood top: xmin, xmax, zmin, zmax.
const HOUSING = new THREE.Vector4(-(W / 2 - INSET), W / 2 - INSET, -(D / 2 - INSET), D / 2 - 0.03);
function addDust(material, { amount = 0.15, buildUp = 0 } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uDust: { value: amount }, uDustEdge: { value: buildUp }, uDustColor: { value: DUST_COLOR }, uHousing: { value: HOUSING },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDustPos;\nvarying vec3 vDustN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDustPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvDustN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vDustPos;
varying vec3 vDustN;
uniform float uDust, uDustEdge;
uniform vec3 uDustColor;
uniform vec4 uHousing;
float dustHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float dustNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dustHash(i), dustHash(i + vec3(1, 0, 0)), f.x), mix(dustHash(i + vec3(0, 1, 0)), dustHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(dustHash(i + vec3(0, 0, 1)), dustHash(i + vec3(1, 0, 1)), f.x), mix(dustHash(i + vec3(0, 1, 1)), dustHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Dust is particles, not paint: fine noise is thresholded by a density that
// varies broadly, so thin dust is scattered grains and thick dust is a patchy
// mat. Noise is 3D, so it carries on over bevels and (lightly) down the sides.
float dustAmount() {
  vec3 n = normalize(vDustN);
  float up = n.y < -0.2 ? 0.0 : mix(0.06, 1.0, smoothstep(0.0, 0.95, n.y));
  vec3 p = vDustPos;
  float density = uDust * (0.35 + 1.3 * dustNoise(p * 6.0)) * up;
  // Build-up on the wood ledge: a band whose width wanders along the wall.
  vec2 q = p.xz;
  vec2 d = max(vec2(uHousing.x - q.x, uHousing.z - q.y), vec2(q.x - uHousing.y, q.y - uHousing.w));
  float outside = max(d.x, d.y);
  float reach = 0.02 + 0.06 * dustNoise(vec3(q * 9.0, 3.1));
  float band = (1.0 - smoothstep(0.0, reach, outside)) * step(-0.01, outside);
  density += uDustEdge * band * (0.25 + 0.9 * dustNoise(p * 31.0)) * up;
  float grain = 0.6 * dustNoise(p * 170.0) + 0.4 * dustNoise(p * 520.0);
  // The grain noise sits mostly in 0.2-0.8, so this threshold covers roughly
  // the density as a share of the surface: light dust is scattered grains, heavy dust a mat.
  float cover = clamp(density, 0.0, 1.0);
  float threshold = 0.8 - 0.6 * cover;
  // Soft-edged grains, antialiased: where a grain is smaller than a pixel the
  // edge widens and they average into an even film instead of sparkling.
  float aa = fwidth(grain) * 1.5 + 0.05;
  float particles = smoothstep(threshold - aa * 0.5, threshold + aa, grain);
  float haze = cover * 0.4;
  return clamp(max(particles * 0.42, haze), 0.0, 0.55);
}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat dust = dustAmount();\ndiffuseColor.rgb = mix(diffuseColor.rgb, uDustColor, dust);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, dust);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, dust);');
  };
  material.customProgramCacheKey = () => `dust-${amount}-${buildUp}`;
  return material;
}

// faceW x faceH in world units, so the grain keeps its true scale on every face.
function vinyl(faceW, faceH, { dusty = false } = {}) {
  const ox = rand(), oy = rand();
  const fit = (t) => {
    const c = t.clone();                    // clones share the uploaded image
    c.repeat.set(faceW / W, faceH / (WOOD_H / WOOD_PX));
    c.offset.set(ox, oy);
    return c;
  };
  return addDust(new THREE.MeshPhysicalMaterial({
    map: fit(dusty ? wood.dusty : wood.map), bumpMap: fit(wood.bump), bumpScale: 0.5,
    roughness: 1, roughnessMap: fit(wood.rough),
    clearcoat: 0.12, clearcoatRoughness: 0.45,
  }), { amount: 0.1, buildUp: 0.6 });
}
const blackPlastic = addDust(new THREE.MeshPhysicalMaterial({
  color: 0x0e0e0e, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.5,
  bumpMap: toTexture(noiseCanvas(256, '#808080', 9000, 0.5), { repeat: 6, color: false }), bumpScale: 0.15,
}), { amount: 0.14 });
// Satin brushed aluminum. UVs are box-projected (see brushedUVs) so v always
// follows the brushing; anisotropy works along u, across the brush lines, which
// is how real brushed metal stretches its highlights.
const BRUSH_UV = 0.35;                      // UV per world unit
await stage(0.42, 'Brushing the aluminum');
const brushedSrc = brushedCanvas(TEX_MAX / 2, TEX_MAX, '#d4cfc6');
sprinkleDust(brushedSrc.getContext('2d'), brushedSrc.width, brushedSrc.height, 2600,
  { color: '238,234,226', fibres: 3, scale: brushedSrc.width * BRUSH_UV / 300 });
const brushed = toTexture(brushedSrc, { repeat: 1 });
const brushedBump = toTexture(brushedSrc, { repeat: 1, color: false });
const aluminum = addDust(new THREE.MeshPhysicalMaterial({
  map: brushed, bumpMap: brushedBump, bumpScale: 0.15, metalness: 1, roughness: 0.3,
  anisotropy: 0.9, anisotropyRotation: 0, envMapIntensity: 1.8,
}), { amount: 0.22 });

// Box-projected UVs from each vertex's dominant normal: faces looking along z
// brush along x; side faces and tops brush along z.
function brushedUVs(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let a, b;
    if (az >= ax && az >= ay) { a = p.getY(i); b = p.getX(i); }
    else if (ax >= ay) { a = p.getY(i); b = p.getZ(i); }
    else { a = p.getX(i); b = p.getZ(i); }
    uv[i * 2] = a * BRUSH_UV;
    uv[i * 2 + 1] = b * BRUSH_UV;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95 });

// ---------- studio floor ----------
// A wide floor inside a dome of the same tone, both fogged to that tone, so the
// set fades out evenly from every angle (the dome goes through the same fog and
// tone mapping as the floor, so there is no visible horizon).
const SET_TONE = CFG.tone;                  // the studio's tone matches its lit floor after tone mapping
scene.fog = new THREE.Fog(SET_TONE, 12, 32);
// Purely diffuse (Lambert): a matte floor shouldn't pick up the softbox's
// specular sheen, which flares into a bright band at grazing angles.
const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 96), new THREE.MeshLambertMaterial({
  color: CFG.floor,
  bumpMap: toTexture(noiseCanvas(512, '#808080', 40000, 0.35), { repeat: 40, color: false }), bumpScale: 0.3,
}));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const dome = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 24), new THREE.MeshBasicMaterial({ color: SET_TONE, side: THREE.BackSide }));
scene.add(dome);

// ---------- cabinet ----------
const cabinet = new THREE.Group();
scene.add(cabinet);

// Flat woodgrain base. RoundedBoxGeometry keeps BoxGeometry's per-face UVs and
// material groups, so the grain runs vertically on every side.
const body = new THREE.Mesh(
  new RoundedBoxGeometry(W, HW, D, 4, 0.035),
  [vinyl(D, HW), vinyl(D, HW), vinyl(W, D, { dusty: true }), blackPlastic, vinyl(W, HW), vinyl(W, HW)]
);
body.position.y = FOOT + HW / 2;
body.castShadow = body.receiveShadow = true;
cabinet.add(body);

for (const [x, z] of [[-1.7, 1.6], [1.7, 1.6], [-1.7, -1.6], [1.7, -1.6]]) {
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, FOOT, 24), rubber);
  foot.position.set(x, FOOT / 2, z);
  foot.castShadow = true;
  cabinet.add(foot);
}

// Backplane height along the slope, and the walls' top line just above the glass.
const backplaneY = (z) => BASE_TOP + LIP + ((Z_FRONT - z) / (Z_FRONT - Z_BACK)) * RISE;
const wallTopY = (z) => backplaneY(z) + (GLASS_TOP + 0.02) / Math.cos(SLOPE);

// The aluminum housing is one piece, like bent sheet metal: a U-shaped
// footprint (two side arms and the back) extruded upward with one bevel all
// round, then its top raised along the slope. One mesh means the corners flow
// with no notches, overlaps or coplanar faces.
const housingGeo = (() => {
  const xo = W / 2 - INSET - WALL_BEV;              // outer faces land at W/2 - INSET once bevelled
  const xi = W / 2 - INSET - STRIP + WALL_BEV;      // inner faces land at the glass edge
  const zbi = Z_BACK + 0.03 - WALL_BEV;             // inner back face just in front of the glass end, so the glass tucks under
  const zf = Z_OUT_FRONT, zb = Z_OUT_BACK;
  // Shape coordinates are (x, -z): the shape is extruded along +z, then turned upright.
  const shape = new THREE.Shape([
    [-xo, -zf], [-xo, -zb], [xo, -zb], [xo, -zf], [xi, -zf], [xi, -zbi], [-xi, -zbi], [-xi, -zf],
  ].map(([x, y]) => new THREE.Vector2(x, y)));
  const y0 = BASE_TOP - SEAT;
  const depth = wallTopY(zb) - WALL_BEV - y0;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSize: WALL_BEV, bevelThickness: WALL_BEV, bevelSegments: 3, curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);                        // extrusion -> +y, shape y -> -z (so world z)
  geo.translate(0, y0, 0);
  // Drop the top (cap plus its bevel) to follow the slope; it stays planar
  // because the drop is linear in z.
  const p = geo.attributes.position;
  const topBody = y0 + depth - 1e-5;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) >= topBody) p.setY(i, p.getY(i) + wallTopY(p.getZ(i)) - wallTopY(zb));
  }
  geo.computeVertexNormals();
  return brushedUVs(geo);
})();
const housing = new THREE.Mesh(housingGeo, aluminum);
housing.castShadow = housing.receiveShadow = true;
cabinet.add(housing);

const lipH = backplaneY(Z_FRONT) + GLASS_TOP + 0.01 - BASE_TOP + SEAT;
// Front face a hair behind the walls' so the two never share a plane.
const lip = new THREE.Mesh(new RoundedBoxGeometry(PW + 0.04, lipH, LIP_D + WALL_BEV - 0.004, 2, 0.012), blackPlastic);
lip.position.set(0, BASE_TOP - SEAT + lipH / 2, Z_FRONT + (LIP_D + WALL_BEV - 0.004) / 2);
lip.castShadow = lip.receiveShadow = true;
cabinet.add(lip);

// The glass well, tilted to the slope. Local y = 0 is the backplane line.
const top = new THREE.Group();
const zMid = (Z_FRONT + Z_BACK) / 2;
top.position.set(0, backplaneY(zMid), zMid);
top.rotation.x = SLOPE;
cabinet.add(top);

// Everything in the glass well lives in this group; y = 0 is the backplane the
// LEDs are mounted on, and the glass floats GAP above it.
const plate = new THREE.Group();
top.add(plate);
await stage(0.52, 'Screen-printing the faceplate');
const fp = faceplateMaps();

await stage(0.66, 'Soldering the circuit board');
const pcb = pcbMaps();
const board = new THREE.Mesh(
  new THREE.PlaneGeometry(PW, PL),
  new THREE.MeshStandardMaterial({
    map: pcb.map, roughness: 1, metalness: 1, roughnessMap: pcb.orm, metalnessMap: pcb.orm,
    bumpMap: toTexture(noiseCanvas(256, '#808080', 12000, 0.5), { repeat: 6, color: false }), bumpScale: 0.25,
  })
);
board.rotation.x = -Math.PI / 2;
board.position.y = 0.001;
board.receiveShadow = true;
plate.add(board);

// A resistor beside each LED, standing on short legs.
const resGeo = new THREE.CapsuleGeometry(0.028, 0.09, 6, 16);
const resMat = new THREE.MeshPhysicalMaterial({ map: resistorTexture(), roughness: 0.45, clearcoat: 0.6 });
const legMat = new THREE.MeshStandardMaterial({ color: 0xc9c6c0, metalness: 1, roughness: 0.3 });
const legGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6);
for (const w of WINDOWS) {
  const x = COL_X[w.col] + RES_DX, z = ROW_Z[w.row] + LED_DZ;
  const body = new THREE.Mesh(resGeo, resMat);
  body.rotation.z = Math.PI / 2;
  body.position.set(x, 0.05, z);
  body.castShadow = body.receiveShadow = true;
  plate.add(body);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x + s * 0.08, 0.025, z);
    plate.add(leg);
    const lead = new THREE.Mesh(legGeo, legMat);
    lead.rotation.z = Math.PI / 2;
    lead.scale.y = 0.6;
    lead.position.set(x + s * 0.065, 0.05, z);
    plate.add(lead);
  }
}

// The painted back of the glass. Opaque cut-out, so it also shadows the board:
// room light only reaches the PCB through the windows.
const paint = new THREE.Mesh(
  new THREE.PlaneGeometry(PW, PL),
  new THREE.MeshStandardMaterial({ color: 0x0b0807, map: paintMask(), alphaTest: 0.5, roughness: 0.35, side: THREE.DoubleSide })
);
paint.rotation.x = -Math.PI / 2;
paint.position.y = GAP - 0.002;
paint.castShadow = true;
paint.userData.bloomHide = true;
plate.add(paint);

// Smoked acrylic: real transmission so the LEDs and backplane are seen through
// (and refracted by) it. depthWrite off so the ink and LED glow layer over it.
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x7d7672, metalness: 0, roughness: 1, roughnessMap: fp.roughness,
  transmission: 1, thickness: GLASS_T, ior: 1.49,
  attenuationColor: new THREE.Color(0x3a302c), attenuationDistance: 0.13,
  specularIntensity: 1, envMapIntensity: 1, depthWrite: false,
});
const glass = new THREE.Mesh(new THREE.BoxGeometry(PW, GLASS_T, PL), glassMat);
glass.position.y = GAP + GLASS_T / 2;
glass.userData.bloomHide = true;
plate.add(glass);
const ink = new THREE.Mesh(
  new THREE.PlaneGeometry(PW, PL),
  new THREE.MeshStandardMaterial({ map: fp.ink, transparent: true, roughness: 0.55, depthWrite: false })
);
ink.rotation.x = -Math.PI / 2;
ink.position.y = GLASS_TOP + 0.0015;
ink.userData.bloomHide = true;
plate.add(ink);

// LEDs: diffused 5 mm red domes with a flange, plus a soft spill on the backplane.
const LED_COLOR = new THREE.Color(0xff1e0a);
const BLOOM_LAYER = 1;
const SMOKE_GLOW = 0.3;                   // share of an LED's light that makes it out through the smoke
// Lathe profiles run bottom to top so the faces point outward.
const ledGeo = new THREE.LatheGeometry([
  new THREE.Vector2(0, 0), new THREE.Vector2(0.095, 0), new THREE.Vector2(0.095, 0.012),
  new THREE.Vector2(0.08, 0.012), new THREE.Vector2(0.08, 0.025), new THREE.Vector2(0.075, 0.05),
  new THREE.Vector2(0.06, 0.07), new THREE.Vector2(0.035, 0.082), new THREE.Vector2(0, 0.085),
], 40);
// A diffused LED is hottest at the tip of the dome: v runs 0 at the base to 1 at the tip.
const ledHot = (() => {
  const [c, g] = makeCanvas(4, 128);
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.2, '#c8c8c8');
  grd.addColorStop(0.45, '#4a4a4a');
  grd.addColorStop(1, '#262626');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  return toTexture(c);
})();
const glowTex = glowTexture();
const leds = WINDOWS.map((w) => {
  const x = COL_X[w.col], z = ROW_Z[w.row] + LED_DZ;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x1e0302, emissive: LED_COLOR, emissiveIntensity: 0, emissiveMap: ledHot,
    roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.18,
  });
  const ledDome = new THREE.Mesh(ledGeo, mat);
  ledDome.position.set(x, 0, z);
  ledDome.castShadow = true;
  ledDome.layers.enable(BLOOM_LAYER);
  // What the bloom pass sees: only the light the LED emits, dimmed by the smoke.
  const bloomMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: ledHot });
  ledDome.userData.bloomMat = bloomMat;
  plate.add(ledDome);
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex, color: 0xff2a10, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.75), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(x, 0.003, z);
  plate.add(glow);
  // The halo you see is light scattering in the smoked acrylic, so it lives on
  // the glass as geometry: anything in front of it (the lip, a wall) hides it,
  // which a screen-space blur can't do.
  const haloMat = glowMat.clone();
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.5), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(x, GLASS_TOP + 0.003, z);
  halo.userData.bloomHide = true;
  plate.add(halo);
  return { text: w.text, mat, glowMat, haloMat, bloomMat, pos: new THREE.Vector3(x, 0.1, z), level: 0, target: 0 };
});
// Short range: it only reaches the board, resistor and paint inside its own window
// (point lights cast no shadows here, so a longer reach would leak onto the walls).
const ledLight = new THREE.PointLight(0xff2a10, 0, 0.6, 2);
plate.add(ledLight);

// ASK pushbutton, standing proud of the glass; its stem drops through to the backplane.
const askCollar = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.03, 14, 48), new THREE.MeshStandardMaterial({ color: 0xd2d0cc, metalness: 1, roughness: 0.22 }));
askCollar.rotation.x = -Math.PI / 2;
askCollar.position.set(ASK.x, GLASS_TOP + 0.012, ASK.z);
plate.add(askCollar);
const askCap = new THREE.Mesh(
  new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.1), new THREE.Vector2(0.14, -0.1), new THREE.Vector2(0.14, 0.15),
    new THREE.Vector2(0.138, 0.17), new THREE.Vector2(0.125, 0.184), new THREE.Vector2(0.1, 0.194),
    new THREE.Vector2(0.06, 0.199), new THREE.Vector2(0, 0.2),
  ], 48),
  new THREE.MeshPhysicalMaterial({
    map: (() => {
      const [c, g] = makeCanvas(256, 256);
      g.fillStyle = '#151515';
      g.fillRect(0, 0, 256, 256);
      sprinkleDust(g, 256, 256, 500);
      return toTexture(c);
    })(),
    roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12,
  })
);
askCap.position.set(ASK.x, GLASS_TOP, ASK.z);
askCap.castShadow = true;
plate.add(askCap);
const ASK_UP = GLASS_TOP, ASK_DOWN = GLASS_TOP - 0.1;

// ON/OFF slide switch: a raised black bezel round a dark slot, and a knurled
// round knob riding in it.
function pillShape(w, h) {
  const r = h / 2, s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -r);
  s.lineTo(w / 2 - r, -r);
  s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-w / 2 + r, r);
  s.absarc(-w / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  return s;
}
const SLOT_W = 2 * SWITCH.travel + 0.15, SLOT_H = 0.13, BEZEL_W = 0.035, SLOT_DEPTH = 0.035;
const bezelShape = pillShape(SLOT_W + 2 * BEZEL_W, SLOT_H + 2 * BEZEL_W);
bezelShape.holes.push(pillShape(SLOT_W, SLOT_H));
const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, {
  depth: SLOT_DEPTH, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 24,
});
bezelGeo.rotateX(-Math.PI / 2);             // extrude upward
const slotBezel = new THREE.Mesh(bezelGeo, blackPlastic);
slotBezel.position.set(SWITCH.x, GLASS_TOP, SWITCH.z);
slotBezel.castShadow = slotBezel.receiveShadow = true;
plate.add(slotBezel);
const slotFloorGeo = new THREE.ShapeGeometry(pillShape(SLOT_W, SLOT_H), 24);
slotFloorGeo.rotateX(-Math.PI / 2);
const slotFloor = new THREE.Mesh(slotFloorGeo, new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 0.95 }));
slotFloor.position.set(SWITCH.x, GLASS_TOP + 0.002, SWITCH.z);
slotFloor.receiveShadow = true;
plate.add(slotFloor);

const KNOB_R = 0.055, KNOB_H = 0.075;
const knobGeo = new THREE.CylinderGeometry(KNOB_R, KNOB_R, KNOB_H, 48, 1);
{
  // Knurling: every other column of the side pushed out a touch.
  const kp = knobGeo.attributes.position;
  for (let i = 0; i < kp.count; i++) {
    const x = kp.getX(i), z = kp.getZ(i);
    if (Math.hypot(x, z) < KNOB_R * 0.99) continue;
    const a = Math.atan2(z, x);
    const k = Math.round((a / (Math.PI * 2)) * 48) % 2 ? 1.06 : 1;
    kp.setXYZ(i, x * k, kp.getY(i), z * k);
  }
  knobGeo.computeVertexNormals();
}
const knobMat = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
const nub = new THREE.Group();
const knobBody = new THREE.Mesh(knobGeo, knobMat);
knobBody.position.y = KNOB_H / 2;
const knobTop = new THREE.Mesh(new THREE.SphereGeometry(KNOB_R, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), knobMat);
knobTop.scale.y = 0.35;
knobTop.position.y = KNOB_H;
knobBody.castShadow = knobTop.castShadow = true;
nub.add(knobBody, knobTop);
const NUB_UP = GLASS_TOP + 0.002, NUB_DOWN = GLASS_TOP - 0.012;
nub.position.set(SWITCH.x - SWITCH.travel, NUB_UP, SWITCH.z);
plate.add(nub);

// Larger invisible hit areas so the small controls are easy to tap.
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const askHit = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.4, 16), hitMat);
askHit.position.set(ASK.x, GLASS_TOP + 0.1, ASK.z);
askHit.userData.action = 'ask';
const switchHit = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.42), hitMat);
switchHit.position.set(SWITCH.x, GLASS_TOP + 0.1, SWITCH.z);
switchHit.userData.action = 'power';
plate.add(askHit, switchHit);
const pickables = [askHit, switchHit];

scene.updateMatrixWorld(true);
const TARGET = plate.localToWorld(new THREE.Vector3(0, -0.5, 0.15));

// ---------- monthly theme props ----------
if (THEME === 'halloween') await stage(0.74, 'Carving the pumpkins');
const themeUpdate = buildThemeProps({
  scene, camera, makeCanvas, toTexture, BLOOM_LAYER,
  viewPoint: TARGET.clone().addScaledVector(VIEW_DIR, 11),
  anchors: {
    web: {
      boxX: -W / 2, boxZ: -D / 2, boxTop: BASE_TOP,
      houseX: -(W / 2 - INSET), houseZ: Z_OUT_BACK - WALL_BEV, houseTop: wallTopY(Z_OUT_BACK),
    },
  },
});

// ---------- post ----------
await stage(0.78, 'Wiring the buzzer');
// Bloom is selective: a second render with everything but the LEDs blacked out
// feeds the bloom, which is then added onto the main image before tone mapping.
const bloomComposer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, { type: THREE.HalfFloatType }));
bloomComposer.renderToScreen = false;
bloomComposer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.08, 0);
bloomComposer.addPass(bloom);

const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);
const blackout = new THREE.MeshBasicMaterial({ color: 0x000000 });
const stashed = new Map();
function renderBloom() {
  // No background or fog here: the blacked-out set must stay black, or the far
  // floor would be fogged to grey and bloom into a haze over everything.
  const bg = scene.background, fog = scene.fog;
  scene.background = null;
  scene.fog = null;
  // Leave any pending shadow redraw for the main render: here the materials are swapped out.
  const shadowsPending = renderer.shadowMap.needsUpdate;
  renderer.shadowMap.needsUpdate = false;
  scene.traverse((o) => {
    if (o.isLine) {                         // cobweb threads and the like: not glowing
      stashed.set(o, [o.material, o.visible]);
      o.visible = false;
      return;
    }
    if (!o.isMesh || o.material.visible === false) return;
    stashed.set(o, [o.material, o.visible]);
    if (bloomLayer.test(o.layers)) o.material = o.userData.bloomMat;
    else if (o.userData.bloomHide) o.visible = false;
    else o.material = blackout;
  });
  bloomComposer.render();
  for (const [o, [m, v]] of stashed) {
    o.material = m;
    o.visible = v;
  }
  stashed.clear();
  scene.background = bg;
  scene.fog = fog;
  renderer.shadowMap.needsUpdate = shadowsPending;
}

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, {
  type: THREE.HalfFloatType, samples: 4,
}));
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
// Fewer AO samples where there are a lot of pixels to shade (phones, big monitors).
const AO_SAMPLES = LITE || innerWidth * innerHeight * DPR * DPR > 3.5e6 ? 8 : 16;
gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1, scale: 1.1, samples: AO_SAMPLES });
gtao.updatePdMaterial({ radius: 6, rings: 2, samples: AO_SAMPLES });
gtao.blendIntensity = 0.9;
composer.addPass(gtao);
composer.addPass(new ShaderPass(new THREE.ShaderMaterial({
  uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D baseTexture, bloomTexture; varying vec2 vUv;
    void main() { gl_FragColor = texture2D(baseTexture, vUv) + vec4(texture2D(bloomTexture, vUv).rgb, 0.0); }`,
}), 'baseTexture'));
composer.addPass(new OutputPass());
// Film grain and a soft lens vignette, applied after tone mapping.
const film = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.012 }, vignette: { value: 0.55 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time, grain, vignette; varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * dot(d, d) * 1.6;
      c.rgb += (hash(gl_FragCoord.xy + fract(time) * 917.0) - 0.5) * grain;
      gl_FragColor = c;
    }`,
});
composer.addPass(film);

// ---------- sound ----------
let ac = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('edm-muted') === '1'; } catch {}

// A short log of what the audio engine did, readable as __edm.audioLog when
// sound misbehaves in a particular browser.
const audioLog = [];
let master = null, meter = null, audioPeak = 0;
// Peak output level since last read, sampled a few times a second (for diagnosing silent browsers).
setInterval(() => {
  if (!meter) return;
  const buf = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(buf);
  for (const v of buf) audioPeak = Math.max(audioPeak, Math.abs(v));
}, 30);
const logAudio = (msg) => { if (audioLog.length < 60) audioLog.push(`${Math.round(performance.now())} ${msg}`); };

function audioContext() {
  if (!ac) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      logAudio(`created ${ac.state} ${ac.sampleRate}`);
      noiseBuf = ac.createBuffer(1, Math.round(ac.sampleRate * 0.05), ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
      ac.onstatechange = () => { logAudio(`state ${ac.state}`); renderMute(); };
      // Everything plays through one master bus with a level meter on it.
      master = ac.createGain();
      master.gain.value = 2.5;
      meter = ac.createAnalyser();
      meter.fftSize = 512;
      master.connect(meter).connect(ac.destination);
    } catch (e) {
      logAudio(`create failed ${e}`);
      return null;
    }
  }
  // Safari can also leave a context 'interrupted', not just 'suspended'.
  if (ac.state !== 'running') {
    ac.resume().then(() => logAudio(`resumed ${ac.state}`), (e) => logAudio(`resume failed ${e}`));
  }
  return ac;
}

// Sounds only play once a real interaction has created the context (see
// unlockAudio); until then they're skipped rather than creating it early.
function audio() {
  if (!ac || muted) return null;
  if (ac.state !== 'running') ac.resume().catch(() => {});
  return ac;
}

// Browsers only let audio start from a user gesture, and Safari is picky about
// which events count, so try on every kind of interaction until it's running,
// playing a one-sample silent buffer to unlock it.
function unlockAudio(e) {
  if (ac && ac.state === 'running') return;
  logAudio(`unlock on ${e?.type}`);
  const a = audioContext();
  if (!a) return;
  const s = a.createBufferSource();
  s.buffer = a.createBuffer(1, 1, a.sampleRate);
  s.connect(master);
  s.start(0);
}
// Only events Safari counts as a completed user gesture: a context created on
// pointerdown/mousedown reports 'running' in Safari yet stays silent.
for (const ev of ['pointerup', 'click', 'touchend', 'keydown']) {
  addEventListener(ev, unlockAudio, { capture: true, passive: true });
}

function tick(gain = 0.25, freq = 2600) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq * (0.9 + rand() * 0.2);
  f.Q.value = 2.5;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.05);
}

// The buzzer, measured from a recording of a real unit: ~1.27 kHz with strong
// 2nd and 3rd harmonics, 40 ms per step, dropping in from ~1.45 kHz as it starts
// and blipping up to ~1.56 kHz as it cuts off.
const BEEP_HZ = 1270, BEEP_S = 0.04;
let buzzerWave = null;
function beep() {
  const a = audio();
  if (!a) return;
  if (!buzzerWave) {
    // Harmonic amplitudes relative to the fundamental: -10.5, -9, -19.5, -22, -31 dB.
    buzzerWave = a.createPeriodicWave(
      new Float32Array(7),
      new Float32Array([0, 1, 0.3, 0.355, 0.106, 0.079, 0.028])
    );
  }
  const t = a.currentTime;
  const o = a.createOscillator();
  o.setPeriodicWave(buzzerWave);
  o.frequency.setValueAtTime(1450, t);
  o.frequency.exponentialRampToValueAtTime(BEEP_HZ, t + 0.006);
  o.frequency.setValueAtTime(BEEP_HZ, t + BEEP_S - 0.005);
  o.frequency.exponentialRampToValueAtTime(1560, t + BEEP_S);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.0015);
  g.gain.setValueAtTime(0.09, t + BEEP_S - 0.0015);
  g.gain.linearRampToValueAtTime(0, t + BEEP_S);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + BEEP_S + 0.01);
}

// Game-show whoosh for the answer wipe: band-passed noise sweeping up.
let whooshBuf = null;
function whoosh() {
  const a = audio();
  if (!a) return;
  if (!whooshBuf) {
    whooshBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = whooshBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  }
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = whooshBuf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(300, t);
  f.frequency.exponentialRampToValueAtTime(3200, t + 0.42);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.18);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.55);
}

function renderMute() {
  // "blocked" means the browser hasn't let audio start yet; clicking here unlocks it.
  const blocked = ac && ac.state !== 'running';
  muteBtn.textContent = muted ? 'Sound: off' : blocked ? 'Sound: click to enable' : 'Sound: on';
  muteBtn.setAttribute('aria-pressed', String(muted));
}
renderMute();
muteBtn.addEventListener('click', () => {
  if (!muted && ac && ac.state !== 'running') {
    unlockAudio();
    return;
  }
  muted = !muted;
  try { localStorage.setItem('edm-muted', muted ? '1' : '0'); } catch {}
  renderMute();
});

// ---------- randomness ----------
// Each answer comes from true random bytes (random.org's atmospheric-noise
// generator) hashed with SHA-256 together with the browser's CSPRNG. The result
// is at least as unpredictable as either source alone, and if random.org can't
// be reached it carries on with the CSPRNG.
const TRUE_RNG_URL = 'https://www.random.org/cgi-bin/randbyte?nbytes=64&format=h';
const rngNote = document.getElementById('rng');
const truePool = [];
let poolFill = null;
let mixCounter = 0;

function fillPool() {
  if (!poolFill) {
    poolFill = fetch(TRUE_RNG_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        const bytes = text.trim().split(/\s+/).map((h) => parseInt(h, 16));
        if (bytes.length < 16 || bytes.some((b) => !(b >= 0 && b < 256))) throw new Error('bad response');
        truePool.push(...bytes);
      })
      .catch(() => {})
      .finally(() => { poolFill = null; });
  }
  return poolFill;
}
fillPool();

// 32 mixed random bytes, plus which sources went into them.
async function mixedBytes() {
  if (truePool.length < 16) await Promise.race([fillPool(), new Promise((r) => setTimeout(r, 900))]);
  const remote = truePool.splice(0, 16);
  if (truePool.length < 16) fillPool();
  const local = crypto.getRandomValues(new Uint8Array(32));
  const source = remote.length ? 'random.org atmospheric noise + device CSPRNG' : 'device CSPRNG (random.org unreachable)';
  if (!crypto.subtle) return { bytes: local, source: 'device CSPRNG' };
  const input = new Uint8Array(32 + remote.length + 8);
  input.set(local);
  input.set(remote, 32);
  new DataView(input.buffer).setFloat64(32 + remote.length, ++mixCounter);
  return { bytes: new Uint8Array(await crypto.subtle.digest('SHA-256', input)), source };
}

// Uniform integer in [0, n) by rejection sampling, so no answer is favoured.
function uniformFrom(bytes, n) {
  const limit = 256 - (256 % n);
  for (const b of bytes) if (b < limit) return b % n;
  return uniformFrom(crypto.getRandomValues(new Uint8Array(32)), n);
}
function randInt(n) {
  return uniformFrom(crypto.getRandomValues(new Uint8Array(32)), n);
}

// ---------- decision logic ----------
// One press of ASK: the light races round every answer a few times, slows,
// and stops on the decision, which stays lit until ASK is pressed again.
// The lights start at once; the answer is drawn while they run, and the
// slowdown is planned so the light lands on it.
const FAST_LAPS = reduceMotion ? 1 : 3;
const STEP_MS = 60;                       // the real unit steps every ~60 ms
const SLOW_MIN = reduceMotion ? 4 : 9;
let powered = true;
let holding = false;
let pressedAt = -1e9;
let spinning = false;
let pos = randInt(CHASE.length);
let lit = -1;
let stepsDone = 0, fastSteps = 0, slowFrom = 0, totalSteps = 0;
let target = null;                        // index into CHASE, once drawn
let run = 0;
let timer = null;

function light(i) {
  lit = i;
  leds.forEach((l, j) => { l.target = j === i ? 1 : 0; });
}

function decide() {
  spinning = true;
  stopWipe();
  readout.classList.remove('show');
  stepsDone = 0;
  fastSteps = FAST_LAPS * CHASE.length;
  totalSteps = 0;
  target = null;
  const thisRun = ++run;
  mixedBytes().then(({ bytes, source }) => {
    if (thisRun !== run) return;
    target = uniformFrom(bytes, CHASE.length);
    if (rngNote) rngNote.textContent = `Randomness: ${source}`;
  });
  step();
}

function step() {
  pos = (pos + 1) % CHASE.length;
  light(CHASE[pos]);
  stepsDone++;
  beep();
  // Once the fast laps are done and the answer is in, plan a slowdown of
  // SLOW_MIN..SLOW_MIN+5 steps that ends on it.
  if (!totalSteps && target !== null && stepsDone >= fastSteps) {
    const n = CHASE.length;
    slowFrom = stepsDone;
    totalSteps = stepsDone + SLOW_MIN + ((target - pos - SLOW_MIN) % n + n) % n;
  }
  if (totalSteps && stepsDone >= totalSteps) {
    finish();
    return;
  }
  const p = totalSteps ? (stepsDone - slowFrom) / (totalSteps - slowFrom) : 0;
  timer = setTimeout(step, STEP_MS + 520 * p * p);
}

function finish() {
  spinning = false;
  timer = null;
  const text = leds[lit].text;
  const thisRun = run;
  hint.textContent = 'Press ASK again for a second opinion';
  gameShowWipe(text).then(() => {
    if (thisRun !== run || spinning) return;
    readout.textContent = text;
    readout.classList.add('show');
    wake(4000);
  });
}

// ---------- game-show wipe ----------
// The answer sweeps across the whole screen on a slanted, striped band, holds,
// and sweeps off the other side; the small readout stays behind afterwards.
const wipeBand = document.querySelector('#wipe .band');
const wipeWord = document.querySelector('#wipe .word');
let wipeAnims = [];
function stopWipe() {
  wipeAnims.forEach((a) => a.cancel());
  wipeAnims = [];
}
function gameShowWipe(text) {
  stopWipe();
  wipeWord.textContent = text;
  const at = (x) => `translate(${x}, -50%) skewX(-16deg)`;
  const inOut = 'cubic-bezier(.65,0,.35,1)';
  if (reduceMotion) {
    wipeAnims = [wipeBand.animate(
      [{ transform: at(0), opacity: 0 }, { transform: at(0), opacity: 1, offset: 0.15 }, { transform: at(0), opacity: 1, offset: 0.85 }, { transform: at(0), opacity: 0 }],
      { duration: 2000 })];
  } else {
    whoosh();
    setTimeout(() => { if (wipeAnims.length) whoosh(); }, 1850);
    wipeAnims = [
      wipeBand.animate([
        { transform: at('-110%'), easing: inOut },
        { transform: at('0%'), offset: 0.2 },
        { transform: at('0%'), offset: 0.8, easing: inOut },
        { transform: at('110%') },
      ], { duration: 2400 }),
      wipeWord.animate([
        { transform: 'skewX(16deg) translateX(-30vw) scale(.8)', opacity: 0, easing: 'cubic-bezier(.2,.8,.2,1)' },
        { transform: 'skewX(16deg) translateX(0) scale(1.06)', opacity: 1, offset: 0.26 },
        { transform: 'skewX(16deg) translateX(0) scale(1)', opacity: 1, offset: 0.34 },
        { transform: 'skewX(16deg) translateX(0) scale(1)', opacity: 1, offset: 0.78, easing: 'cubic-bezier(.7,0,.8,.4)' },
        { transform: 'skewX(16deg) translateX(40vw) scale(.9)', opacity: 0 },
      ], { duration: 2400 }),
    ];
  }
  return wipeAnims[0].finished.then(() => {}, () => {});
}

function askDown() {
  if (holding) return;
  holding = true;
  pressedAt = performance.now();
  tick(0.35, 1300);
  if (powered && !spinning) decide();
}

function askUp() {
  if (!holding) return;
  holding = false;
  tick(0.2, 1100);
}

function setPower(on) {
  powered = on;
  tick(0.45, 1800);
  clearTimeout(timer);
  timer = null;
  spinning = false;
  light(-1);
  run++;
  stopWipe();
  readout.classList.remove('show');
  hint.textContent = on ? HINT_READY : 'Power is off. Slide the switch to ON';
}

// ---------- input ----------
let switchHeld = false;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  return hit ? hit.object.userData.action : null;
}

// Registered before OrbitControls so pressing a control never starts an orbit.
canvas.addEventListener('pointerdown', (e) => {
  const action = pick(e);
  if (!action) return;
  controls.enabled = false;
  if (action === 'ask') askDown();
  if (action === 'power') {
    switchHeld = true;
    setPower(!powered);
  }
});
addEventListener('pointerup', () => {
  switchHeld = false;
  askUp();
  controls.enabled = true;
});
addEventListener('pointercancel', () => {
  switchHeld = false;
  askUp();
  controls.enabled = true;
});
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  canvas.style.cursor = pick(e) ? 'pointer' : 'grab';
});

addEventListener('keydown', (e) => {
  if (e.repeat || e.target === muteBtn || e.target.id === 'decide') return;
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    askDown();
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') askUp();
});
addEventListener('blur', askUp);
document.getElementById('decide').addEventListener('click', () => {
  askDown();
  askUp();
});

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minPolarAngle = 0.08;
controls.maxPolarAngle = 1.5;
controls.target.copy(TARGET);

// Safari turns a trackpad pinch into page zoom, which just magnifies the
// rendered bitmap (blurry). Catch the gesture and move the camera instead.
let pinchFrom = 0;
document.addEventListener('gesturestart', (e) => {
  e.preventDefault();
  pinchFrom = camera.position.distanceTo(controls.target);
});
document.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  const d = THREE.MathUtils.clamp(pinchFrom / e.scale, controls.minDistance, controls.maxDistance);
  camera.position.sub(controls.target).setLength(d).add(controls.target);
});
document.addEventListener('gestureend', (e) => e.preventDefault());

// ---------- adaptive resolution ----------
// If the frame rate sags (big monitors, slower GPUs), render a little smaller
// and let the browser scale it up; creep back up when there's headroom. The
// glow pass always runs at half resolution, since it's blurred anyway.
let renderScale = 1;
let scaleFrames = 0, scaleTime = 0;
function applyRenderScale() {
  const pr = DPR * renderScale;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  bloomComposer.setPixelRatio(pr * 0.5);
}
let adaptFrom = Infinity;                 // set once the intro has played
function adaptResolution(dt) {
  if (performance.now() < adaptFrom) return;
  scaleFrames++;
  scaleTime += dt;
  if (scaleTime < 1.5) return;
  const fps = scaleFrames / scaleTime;
  scaleFrames = scaleTime = 0;
  const next = fps < 48 ? Math.max(0.6, renderScale - 0.1) : fps > 57 ? Math.min(1, renderScale + 0.05) : renderScale;
  if (next !== renderScale) {
    renderScale = next;
    applyRenderScale();
  }
}

// ---------- layout ----------
let fitDistance = 10;
function layout() {
  const aspect = innerWidth / innerHeight;
  camera.aspect = aspect;
  camera.fov = aspect < 1 ? 46 : 32;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  fitDistance = Math.max(3.3 / tanHalf, 3.2 / (tanHalf * aspect));
  camera.updateProjectionMatrix();
  controls.minDistance = fitDistance * 0.15;   // close enough to inspect the dust and brushing
  controls.maxDistance = fitDistance * 1.7;
  // Haze starts behind the device even at the furthest zoom.
  scene.fog.near = fitDistance * 1.7 + 4;
  scene.fog.far = scene.fog.near + 26;
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloomComposer.setSize(innerWidth, innerHeight);
  applyRenderScale();
}
layout();
camera.position.copy(TARGET).addScaledVector(VIEW_DIR, fitDistance * (reduceMotion ? 1 : 1.5));
addEventListener('resize', layout);

// ---------- loop ----------
const clock = new THREE.Clock();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
let intro = 1;                            // the intro plays once the loader is gone

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const ease = (rate) => 1 - Math.exp(-rate * dt);

  if (intro < 1) {
    intro = Math.min(1, intro + dt / 1.8);
    const e = 1 - Math.pow(1 - intro, 3);
    tmp.copy(VIEW_DIR).applyAxisAngle(Y_AXIS, (1 - e) * -0.7);
    camera.position.copy(TARGET).addScaledVector(tmp, fitDistance * (1.5 - 0.5 * e));
  }
  controls.update();

  // LEDs snap on and fade off a touch slower, so the chase leaves a short trail.
  let brightest = leds[0];
  for (const l of leds) {
    l.level += (l.target - l.level) * ease(l.target > l.level ? 60 : 22);
    l.glowMat.opacity = l.level * 0.3;
    l.haloMat.opacity = l.level * 0.32;
    if (l.level > brightest.level) brightest = l;
  }
  // Unlit domes pick up a faint red from whichever LED is lit nearby.
  for (const l of leds) {
    let spill = 0;
    for (const o of leds) if (o !== l) spill += o.level / (1 + 8 * o.pos.distanceToSquared(l.pos));
    l.mat.emissiveIntensity = l.level * 9 + spill * 0.35;
    l.bloomMat.color.copy(LED_COLOR).multiplyScalar(l.mat.emissiveIntensity * SMOKE_GLOW);
  }
  ledLight.position.copy(brightest.pos);
  ledLight.intensity = brightest.level * 1.2;

  // A quick tap still shows the button travel all the way down.
  const pressed = holding || performance.now() - pressedAt < 170;
  const capY = pressed ? ASK_DOWN : ASK_UP;
  const nubX = SWITCH.x + (powered ? -SWITCH.travel : SWITCH.travel);
  const nubY = switchHeld ? NUB_DOWN : NUB_UP;
  if (Math.abs(capY - askCap.position.y) + Math.abs(nubX - nub.position.x) + Math.abs(nubY - nub.position.y) > 1e-4) {
    renderer.shadowMap.needsUpdate = true;
  }
  askCap.position.y += (capY - askCap.position.y) * ease(pressed ? 60 : 28);
  nub.position.x += (nubX - nub.position.x) * ease(30);
  nub.position.y += (nubY - nub.position.y) * ease(40);
  adaptResolution(dt);

  film.uniforms.time.value += dt;
  themeUpdate?.(performance.now() / 1000);
  renderBloom();
  composer.render(dt);
  requestAnimationFrame(frame);
}
await stage(0.88, 'Warming up the LEDs');
if (renderer.compileAsync) await renderer.compileAsync(scene, camera).catch(() => {});
// Upload every texture now (the 4K ones take a moment), then run the real
// render loop behind the loading screen until frames come steadily, so shader
// variants for every pass are compiled before anyone sees the first frame.
scene.traverse((o) => {
  for (const m of [].concat(o.material || [])) {
    for (const v of Object.values(m)) if (v?.isTexture) renderer.initTexture(v);
  }
});
requestAnimationFrame(frame);
{
  const until = performance.now() + 4000;
  let steady = 0, last = performance.now();
  while (steady < 8 && performance.now() < until) {
    await nextFrame();
    const now = performance.now();
    steady = now - last < 40 ? steady + 1 : 0;
    last = now;
  }
}
loader.set(1, 'Ready');

// Test and diagnostic hooks, only with ?debug in the URL (the test suite uses them).
const DEBUG = new URLSearchParams(location.search).has('debug');
const debugHooks = {
  // Draw n answers with the same unbiased sampler the device uses; returns counts per answer.
  rngSample(n) {
    const counts = new Array(CHASE.length).fill(0);
    for (let i = 0; i < n; i++) counts[randInt(CHASE.length)]++;
    return counts;
  },
  askDown, askUp, setPower, ready: false, audioLog,
  get renderScale() { return renderScale; },
  get audioState() { return ac ? ac.state : 'none'; },
  readPeak() { const p = audioPeak; audioPeak = 0; return p; },
  // Diagnostics: a one-second tone straight to the speakers, or through the master bus.
  testTone(viaMaster = false) {
    if (!ac) return 'no audio context yet: click the page first';
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = viaMaster ? 880 : 660;
    g.gain.value = 0.3;
    o.connect(g).connect(viaMaster ? master : ac.destination);
    o.start();
    o.stop(ac.currentTime + 1);
    return ac.state;
  },
  get answer() { return !spinning && lit >= 0 ? leds[lit].text : null; },
  printPNG: () => printCanvas().toDataURL(),
  // Point the camera at a spot on the faceplate (plate-local) or in the world.
  view(target, offset, local = true) {
    const t = local ? plate.localToWorld(new THREE.Vector3(...target)) : new THREE.Vector3(...target);
    controls.target.copy(t);
    camera.position.copy(t).add(new THREE.Vector3(...offset));
    controls.update();
  },
};
if (DEBUG) window.__edm = debugHooks;

// ---------- quiet UI ----------
// The text overlays fade out when nobody is interacting, leaving just the device;
// any pointer, wheel or key activity brings them back.
let quietTimer = null;
function wake(ms = 3500) {
  document.body.classList.remove('quiet');
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => document.body.classList.add('quiet'), ms);
}
for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart', 'focusin']) addEventListener(ev, () => wake(), { passive: true });
wake(5000);

// Once the loading screen has wiped away, play the camera's intro move.
await loader.done();
intro = reduceMotion ? 1 : 0;
adaptFrom = performance.now() + 2500;        // judge the frame rate after the intro, not during it
debugHooks.ready = true;
