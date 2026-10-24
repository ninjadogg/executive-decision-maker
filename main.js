import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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
const LIP = 0.14, LIP_D = 0.07;            // black front lip below the glass's low edge
const GAP = 0.09, GLASS_T = 0.03;         // LEDs sit on a backplane under a floating smoked-glass sheet
const GLASS_TOP = GAP + GLASS_T;
const Z_OUT_FRONT = D / 2 - 0.03 - WALL_BEV, Z_OUT_BACK = -(D / 2 - INSET - WALL_BEV);
const Z_FRONT = Z_OUT_FRONT - LIP_D, Z_BACK = Z_OUT_BACK + BACK_T;   // glass well, front to back
const SLOPE = THREE.MathUtils.degToRad(13);
const RISE = (Z_FRONT - Z_BACK) * Math.tan(SLOPE);
const PW = W - 2 * INSET - 2 * STRIP, PL = Math.hypot(Z_FRONT - Z_BACK, RISE);
const PX = 300;                            // faceplate texture pixels per unit

const COL_X = [-0.78, 0.78];
const ROW_Z = [-0.62, 0.1, 0.82];
const BOX_W = 1.4, BOX_H = 0.62;
const LED_DZ = 0.07;                       // LED sits a little below the box centre
const SWITCH = { x: -1.15, z: 1.62, travel: 0.12 };
const ASK = { x: 1.2, z: 1.62 };

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const LITE = matchMedia('(pointer: coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = Math.random;
const canvas = document.getElementById('c');
const readout = document.getElementById('readout');
const hint = document.getElementById('hint');
const muteBtn = document.getElementById('mute');
const HINT_READY = hint.textContent;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('fail').style.display = 'grid';
  throw e;
}
const DPR = Math.min(devicePixelRatio, LITE ? 1.5 : 2);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
RectAreaLightUniformsLib.init();

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1917);
const pmrem = new THREE.PMREMGenerator(renderer);
// A dark studio with a few bright panels, so glossy surfaces pick up crisp
// softbox and window reflections the way they would in a product shot.
function studioEnvironment() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 16, 40), new THREE.MeshBasicMaterial({ color: 0x3a3632, side: THREE.BackSide }));
  room.position.y = 7;
  env.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x24211e }));
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
  panel(10, 5, 7, 0xfff3e2, [-2, 14.5, 8]);     // overhead softbox, matches the area light
  panel(2, 10, 3.5, 0xffffff, [-19.5, 6, 2]);   // left strip
  panel(2, 10, 2.5, 0xdfe8ff, [19.5, 6, -4]);   // right strip, cool
  panel(12, 6, 1.6, 0xffe2b8, [0, 7, -19.5]);   // warm window behind
  return env;
}
scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
scene.environmentIntensity = 0.7;

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
key.shadow.mapSize.set(LITE ? 2048 : 4096, LITE ? 2048 : 4096);
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 2, far: 30 });
key.shadow.radius = 10;
key.shadow.blurSamples = 20;
key.shadow.bias = -0.0005;
scene.add(key);
const rim = new THREE.DirectionalLight(0xbcd0ff, 0.9);
rim.position.set(7, 5, -8);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xfff6ea, 0x3a332c, 0.25));

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

// Rosewood-look vinyl: long, nearly straight dark streaks of uneven weight over
// fine grain, running along the canvas y axis. Tiles in both directions.
function rosewood(size = 1024) {
  const [c, g] = makeCanvas(size, size);
  g.fillStyle = '#8a3b1b';
  g.fillRect(0, 0, size, size);
  // Grain lines run roughly parallel: every streak follows one shared flow, with
  // a little drift of its own so the figure gently converges and spreads.
  const TAU = Math.PI * 2;
  const p1 = rand() * TAU, p2 = rand() * TAU, p3 = rand() * TAU;
  const flow = (y) => 14 * Math.sin((TAU * y) / size + p1) + 6 * Math.sin((2 * TAU * y) / size + p2) + 2.5 * Math.sin((3 * TAU * y) / size + p3);
  const band = (x0, width, alpha, wobble, color, blur = 0) => {
    g.filter = blur ? `blur(${blur}px)` : 'none';
    const k = 1 + Math.floor(rand() * 2), f = (TAU * k) / size, ph = rand() * TAU, follow = 0.7 + rand() * 0.6;
    g.strokeStyle = `rgba(${color},${alpha})`;
    g.lineWidth = width;
    for (const off of [-size, 0, size]) {
      g.beginPath();
      for (let y = 0; y <= size; y += 8) {
        const x = x0 + off + flow(y) * follow + Math.sin(y * f + ph) * wobble * 0.35;
        y ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  };
  // Broad colour variation first, then fine grain, then the heavy figure.
  for (let i = 0; i < 46; i++) band(rand() * size, 10 + rand() * 50, 0.08 + rand() * 0.12, 4 + rand() * 10, rand() < 0.5 ? '60,18,6' : '170,80,38', 8);
  for (let i = 0; i < 600; i++) band(rand() * size, 0.4 + rand() * 1.6, 0.05 + rand() * 0.14, 1 + rand() * 6, rand() < 0.8 ? '42,12,4' : '196,104,56');
  for (let i = 0; i < 30; i++) band(rand() * size, 4 + rand() * 18, 0.22 + rand() * 0.35, 3 + rand() * 14, '30,8,3', 3 + rand() * 4);
  for (let i = 0; i < 12; i++) band(rand() * size, 1.5 + rand() * 3, 0.25 + rand() * 0.25, 3 + rand() * 10, '24,7,2', 1);
  g.filter = 'none';
  return c;
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
function sprinkleDust(g, w, h, count, { density = () => 1, color = '214,208,196', fibres = 0 } = {}) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w, y = rand() * h;
    if (rand() > density(x / w, y / h)) continue;
    const big = rand() < 0.015;
    g.fillStyle = `rgba(${color},${big ? 0.12 + rand() * 0.14 : 0.04 + rand() * 0.13})`;
    g.beginPath();
    g.arc(x, y, big ? 0.8 + rand() * 0.6 : 0.3 + rand() * 0.45, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 0.7;
  for (let i = 0; i < fibres; i++) {
    const x = rand() * w, y = rand() * h, len = 12 + rand() * 50, a = rand() * Math.PI * 2;
    g.strokeStyle = `rgba(${color},${0.08 + rand() * 0.1})`;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(
      x + Math.cos(a) * len * 0.4 + (rand() - 0.5) * 20, y + Math.sin(a) * len * 0.4 + (rand() - 0.5) * 20,
      x + Math.cos(a) * len * 0.7 + (rand() - 0.5) * 20, y + Math.sin(a) * len * 0.7 + (rand() - 0.5) * 20,
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

  let [x, y] = toPx(0, -1.5);
  g.font = `400 ${u(0.32)}px ${FONT}`;
  spaced(u(0.012));
  g.fillText('EXECUTIVE', x, y);
  [x, y] = toPx(0, -1.2);
  g.font = `400 ${u(0.185)}px ${FONT}`;
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

  // Brand wordmark, set in a generic bold italic.
  g.font = `italic 800 ${u(0.2)}px "Arial Black", ${FONT}`;
  spaced(0);
  [x, y] = toPx(0.02, SWITCH.z - 0.02);
  g.fillText('Radio Shack', x, y);
  return c;
}

function faceplateMaps() {
  // Ink layer for the top of the glass: the print, the switch slot, a little dust.
  const [c, g] = makeCanvas(CW, CH);
  const [sx, sy] = toPx(SWITCH.x - SWITCH.travel - 0.09, SWITCH.z - 0.07);
  roundRect(g, sx, sy, u(2 * SWITCH.travel + 0.18), u(0.14), u(0.06));
  g.fillStyle = '#050505';
  g.fill();
  g.lineWidth = u(0.008);
  g.strokeStyle = '#3a3a3a';
  g.stroke();
  g.drawImage(printCanvas(), 0, 0);
  // A faint film of settled dust along the walls and back edge, then the specks.
  for (const [x0, y0, x1, y1] of [[0, 0, u(0.25), 0], [CW, 0, CW - u(0.25), 0], [0, 0, 0, u(0.3)]]) {
    const grd = g.createLinearGradient(x0, y0, x1, y1);
    grd.addColorStop(0, 'rgba(200,194,182,.07)');
    grd.addColorStop(1, 'rgba(200,194,182,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, CW, CH);
  }
  sprinkleDust(g, CW, CH, 7000, { density: edgeDust, fibres: 8 });

  // Glass roughness (green channel): polished, with soft smudges and a couple of
  // thumbprints by the ASK button. Rough spots also blur what's seen through them.
  const [r, rg] = makeCanvas(512, Math.round(512 * CH / CW));
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
  for (let i = 0; i < 14; i++) smudge(rand() * r.width, rand() * r.height, 20 + rand() * 60, 0.15 + rand() * 0.2);
  const ax = (ASK.x / PW + 0.5) * r.width, az = (ASK.z / PL + 0.5) * r.height;
  smudge(ax - 30, az - 40, 34, 0.5);
  smudge(ax - 60, az - 10, 26, 0.35);
  // Dust specks diffuse the reflection where they sit.
  sprinkleDust(rg, r.width, r.height, 2500, { density: edgeDust, color: '0,200,0' });

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
    g.fillRect(rand() * CW, rand() * CH, 2 + rand() * 5, 1 + rand() * 2);
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
  return { map: toTexture(c), orm: toTexture(o, { color: false }) };
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
  return toTexture(c);
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
// follows the figure, and open pores along the grain.
// aspect: face height / width, so the grain keeps its true scale on short faces.
function vinyl({ aspect = 1, dusty = false } = {}) {
  const src = rosewood();
  const [b, bg] = makeCanvas(src.width, src.height);
  bg.drawImage(src, 0, 0);
  for (let i = 0; i < 9000; i++) {
    bg.fillStyle = `rgba(0,0,0,${0.2 + rand() * 0.4})`;
    bg.fillRect(rand() * b.width, rand() * b.height, 1, 2 + rand() * 5);
  }
  const [r, rg] = makeCanvas(src.width, src.height);
  rg.fillStyle = 'rgb(0,215,0)';
  rg.fillRect(0, 0, r.width, r.height);
  rg.globalCompositeOperation = 'multiply';
  rg.globalAlpha = 0.35;
  rg.drawImage(src, 0, 0);
  let colour = src;
  if (dusty) {
    const [d, dg] = makeCanvas(src.width, src.height);
    dg.drawImage(src, 0, 0);
    sprinkleDust(dg, d.width, d.height, 7000, { fibres: 6 });
    colour = d;
  }
  const map = toTexture(colour, { repeat: 1 });
  const bump = toTexture(b, { repeat: 1, color: false });
  const rough = toTexture(r, { color: false });
  for (const t of [map, bump, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, aspect);
  }
  return new THREE.MeshPhysicalMaterial({
    map, bumpMap: bump, bumpScale: 0.8,
    roughness: 1, roughnessMap: rough,
    clearcoat: 0.06, clearcoatRoughness: 0.6,
    sheen: 0.25, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x6a2a14),
  });
}
const blackPlastic = new THREE.MeshPhysicalMaterial({
  color: 0x0e0e0e, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.5,
  bumpMap: toTexture(noiseCanvas(256, '#808080', 9000, 0.5), { repeat: 6, color: false }), bumpScale: 0.15,
});
// Brushing runs front to back along the walls (and side to side on the back wall).
// Satin brushed aluminum: bright, with highlights stretched along the brushing
// (anisotropy follows the UV u axis, which runs front to back on the walls).
const brushedSrc = brushedCanvas(512, 1024, '#d4cfc6');
sprinkleDust(brushedSrc.getContext('2d'), 512, 1024, 2600, { color: '238,234,226', fibres: 3 });
const brushed = toTexture(brushedSrc, { repeat: 0.35 });
const brushedBump = toTexture(brushedSrc, { repeat: 0.35, color: false });
for (const t of [brushed, brushedBump]) t.rotation = Math.PI / 2;
const aluminum = new THREE.MeshPhysicalMaterial({
  map: brushed, bumpMap: brushedBump, bumpScale: 0.15, metalness: 1, roughness: 0.3,
  anisotropy: 0.9, anisotropyRotation: 0, envMapIntensity: 1.8,
});
const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95 });

// ---------- studio sweep ----------
function sweepGeometry() {
  const floor = 16, R = 6, wall = 16, width = 60, front = 9;
  const arc = (Math.PI * R) / 2, total = floor + arc + wall;
  const geo = new THREE.PlaneGeometry(width, total, 1, 120);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = p.getY(i) + total / 2;
    let y, z;
    if (s < floor) {
      y = 0; z = front - s;
    } else if (s < floor + arc) {
      const a = (s - floor) / R;
      y = R - R * Math.cos(a); z = front - floor - R * Math.sin(a);
    } else {
      y = R + (s - floor - arc); z = front - floor - R;
    }
    p.setXYZ(i, p.getX(i), y, z);
  }
  geo.computeVertexNormals();
  return geo;
}
const sweep = new THREE.Mesh(sweepGeometry(), new THREE.MeshStandardMaterial({
  color: 0x77726c, roughness: 0.92,
  bumpMap: toTexture(noiseCanvas(512, '#808080', 40000, 0.35), { repeat: 14, color: false }), bumpScale: 0.3,
}));
sweep.receiveShadow = true;
scene.add(sweep);

// ---------- cabinet ----------
const cabinet = new THREE.Group();
scene.add(cabinet);

// Flat woodgrain base. RoundedBoxGeometry keeps BoxGeometry's per-face UVs and
// material groups, so the grain runs vertically on every side.
const body = new THREE.Mesh(
  new RoundedBoxGeometry(W, HW, D, 4, 0.035),
  [vinyl({ aspect: HW / D }), vinyl({ aspect: HW / D }), vinyl({ dusty: true }), blackPlastic, vinyl({ aspect: HW / W }), vinyl({ aspect: HW / W })]
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

// Side walls: chamfered aluminum wedges. Profile is (-z, y), extruded along x.
const sideShape = new THREE.Shape([
  new THREE.Vector2(-Z_OUT_FRONT, BASE_TOP),
  new THREE.Vector2(-Z_OUT_FRONT, wallTopY(Z_OUT_FRONT)),
  new THREE.Vector2(-Z_OUT_BACK, wallTopY(Z_OUT_BACK)),
  new THREE.Vector2(-Z_OUT_BACK, BASE_TOP),
]);
const sideGeo = new THREE.ExtrudeGeometry(sideShape, {
  depth: STRIP - 2 * WALL_BEV, bevelEnabled: true, bevelSize: WALL_BEV, bevelThickness: WALL_BEV, bevelSegments: 2, curveSegments: 1,
});
sideGeo.rotateY(Math.PI / 2);          // profile x (= -z) -> world z, extrusion -> +x
for (const s of [-1, 1]) {
  const wall = new THREE.Mesh(sideGeo, aluminum);
  wall.position.x = s < 0 ? -(W / 2 - INSET) + WALL_BEV : W / 2 - INSET - STRIP + WALL_BEV;
  wall.castShadow = wall.receiveShadow = true;
  cabinet.add(wall);
}
const backH = wallTopY(Z_OUT_BACK) - BASE_TOP;
const backWall = new THREE.Mesh(new RoundedBoxGeometry(W - 2 * INSET, backH, BACK_T + WALL_BEV, 3, WALL_BEV), aluminum);
backWall.position.set(0, BASE_TOP + backH / 2, Z_OUT_BACK - WALL_BEV + (BACK_T + WALL_BEV) / 2);
backWall.castShadow = backWall.receiveShadow = true;
cabinet.add(backWall);

const lipH = backplaneY(Z_FRONT) + GLASS_TOP + 0.01 - BASE_TOP;
const lip = new THREE.Mesh(new RoundedBoxGeometry(PW + 0.04, lipH, LIP_D + WALL_BEV, 2, 0.012), blackPlastic);
lip.position.set(0, BASE_TOP + lipH / 2, Z_FRONT + (LIP_D + WALL_BEV) / 2);
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
const fp = faceplateMaps();

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
  new THREE.MeshStandardMaterial({ color: 0x050505, map: paintMask(), alphaTest: 0.5, roughness: 0.35, side: THREE.DoubleSide })
);
paint.rotation.x = -Math.PI / 2;
paint.position.y = GAP - 0.002;
paint.castShadow = true;
paint.userData.bloomHide = true;
plate.add(paint);

// Smoked acrylic: real transmission so the LEDs and backplane are seen through
// (and refracted by) it. depthWrite off so the ink and LED glow layer over it.
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x9a9592, metalness: 0, roughness: 1, roughnessMap: fp.roughness,
  transmission: 1, thickness: GLASS_T, ior: 1.49,
  attenuationColor: new THREE.Color(0x3a3230), attenuationDistance: 0.18,
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
    color: 0x3a0604, emissive: LED_COLOR, emissiveIntensity: 0, emissiveMap: ledHot,
    roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0.15, sheenColor: 0xff5030,
  });
  const dome = new THREE.Mesh(ledGeo, mat);
  dome.position.set(x, 0, z);
  dome.castShadow = true;
  dome.layers.enable(BLOOM_LAYER);
  plate.add(dome);
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex, color: 0xff2a10, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.75), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(x, 0.003, z);
  plate.add(glow);
  return { text: w.text, mat, glowMat, pos: new THREE.Vector3(x, 0.1, z), level: 0, target: 0 };
});
// Short range: it only reaches the board, resistor and paint inside its own window
// (point lights cast no shadows here, so a longer reach would leak onto the walls).
const ledLight = new THREE.PointLight(0xff2a10, 0, 0.6, 2);
plate.add(ledLight);

// ASK pushbutton, standing proud of the glass; its stem drops through to the backplane.
const askCollar = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.03, 14, 48), new THREE.MeshPhysicalMaterial({ color: 0x1a1a1a, metalness: 0.5, roughness: 0.35, clearcoat: 0.5 }));
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

// ON/OFF slide switch
const NUB_UP = GLASS_TOP + 0.065, NUB_DOWN = GLASS_TOP + 0.03;
const nub = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.065, 0.05, 8, 20),
  new THREE.MeshPhysicalMaterial({ color: 0x141414, roughness: 0.3, clearcoat: 0.8 })
);
nub.rotation.x = Math.PI / 2;
nub.position.set(SWITCH.x - SWITCH.travel, NUB_UP, SWITCH.z);
nub.castShadow = true;
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

// ---------- post ----------
// Bloom is selective: a second render with everything but the LEDs blacked out
// feeds the bloom, which is then added onto the main image before tone mapping.
const bloomComposer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, { type: THREE.HalfFloatType }));
bloomComposer.renderToScreen = false;
bloomComposer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.35, 0);
bloomComposer.addPass(bloom);

const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER);
const blackout = new THREE.MeshBasicMaterial({ color: 0x000000 });
const stashed = new Map();
function renderBloom() {
  const bg = scene.background;
  scene.background = null;
  renderer.shadowMap.autoUpdate = false;
  scene.traverse((o) => {
    if (!o.isMesh || bloomLayer.test(o.layers) || o.material.visible === false) return;
    stashed.set(o, [o.material, o.visible]);
    if (o.userData.bloomHide) o.visible = false;
    else o.material = blackout;
  });
  bloomComposer.render();
  for (const [o, [m, v]] of stashed) {
    o.material = m;
    o.visible = v;
  }
  stashed.clear();
  scene.background = bg;
  renderer.shadowMap.autoUpdate = true;
}

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, {
  type: THREE.HalfFloatType, samples: 4,
}));
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1, scale: 1.1, samples: LITE ? 8 : 16 });
gtao.updatePdMaterial({ radius: 6, rings: 2, samples: LITE ? 8 : 16 });
gtao.blendIntensity = 0.9;
composer.addPass(gtao);
let bokeh = null;
if (!LITE) {
  bokeh = new BokehPass(scene, camera, { focus: 10, aperture: 0.0012, maxblur: 0.006 });
  composer.addPass(bokeh);
}
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
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.028 }, vignette: { value: 0.55 } },
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

function audio() {
  if (!ac) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      noiseBuf = ac.createBuffer(1, Math.round(ac.sampleRate * 0.05), ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
    } catch { return null; }
  }
  if (ac.state === 'suspended') ac.resume();
  return muted ? null : ac;
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
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
  src.stop(t + 0.05);
}

// Piezo-style chirp: a square wave that sweeps up into its note and dies fast.
function chirp(freq, dur = 0.05, vol = 0.07) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(freq * 0.72, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + Math.min(0.018, dur * 0.4));
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 4200;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function renderMute() {
  muteBtn.textContent = muted ? 'Sound: off' : 'Sound: on';
  muteBtn.setAttribute('aria-pressed', String(muted));
}
renderMute();
muteBtn.addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem('edm-muted', muted ? '1' : '0'); } catch {}
  renderMute();
});

// ---------- decision logic ----------
// One press of ASK: the light races round every answer a few times, slows,
// and stops on the decision, which stays lit until ASK is pressed again.
const FAST_LAPS = reduceMotion ? 1 : 3;
const FAST_MS = 55;
// Each window chirps its own note, so a lap plays a little rising run.
const NOTES = [1480, 1660, 1860, 2090, 2350, 2640];
let powered = true;
let holding = false;
let pressedAt = -1e9;
let spinning = false;
let pos = randInt(CHASE.length);
let lit = -1;
let stepsDone = 0, fastSteps = 0, totalSteps = 0;
let timer = null;

function randInt(n) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

function light(i) {
  lit = i;
  leds.forEach((l, j) => { l.target = j === i ? 1 : 0; });
}

function decide() {
  const n = CHASE.length;
  spinning = true;
  readout.classList.remove('show');
  stepsDone = 0;
  fastSteps = FAST_LAPS * n;
  // randInt(n) makes every final window equally likely.
  totalSteps = fastSteps + (reduceMotion ? 4 : 9) + randInt(n);
  step();
}

function step() {
  pos = (pos + 1) % CHASE.length;
  light(CHASE[pos]);
  stepsDone++;
  const p = Math.max(0, (stepsDone - fastSteps) / (totalSteps - fastSteps));
  chirp(NOTES[pos], 0.045 + 0.05 * p);
  if (stepsDone >= totalSteps) {
    finish();
    return;
  }
  timer = setTimeout(step, FAST_MS + 520 * p * p);
}

function finish() {
  spinning = false;
  timer = null;
  const note = NOTES[pos];
  setTimeout(() => chirp(note * 1.26, 0.07, 0.08), 110);
  setTimeout(() => chirp(note * 1.5, 0.12, 0.08), 210);
  readout.textContent = leds[lit].text;
  readout.classList.add('show');
  hint.textContent = 'Press ASK again for a second opinion';
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
  readout.classList.remove('show');
  hint.textContent = on ? HINT_READY : 'Power is off. Slide the switch to ON';
  if (on) chirp(2640, 0.06, 0.05);
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

// ---------- layout ----------
let fitDistance = 10;
function layout() {
  const aspect = innerWidth / innerHeight;
  camera.aspect = aspect;
  camera.fov = aspect < 1 ? 46 : 32;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  fitDistance = Math.max(3.3 / tanHalf, 3.2 / (tanHalf * aspect));
  camera.updateProjectionMatrix();
  controls.minDistance = fitDistance * 0.45;
  controls.maxDistance = fitDistance * 1.7;
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloomComposer.setSize(innerWidth, innerHeight);
}
layout();
camera.position.copy(TARGET).addScaledVector(VIEW_DIR, fitDistance * (reduceMotion ? 1 : 1.5));
addEventListener('resize', layout);

// ---------- loop ----------
const clock = new THREE.Clock();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
let intro = reduceMotion ? 1 : 0;

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
    if (l.level > brightest.level) brightest = l;
  }
  // Unlit domes pick up a faint red from whichever LED is lit nearby.
  for (const l of leds) {
    let spill = 0;
    for (const o of leds) if (o !== l) spill += o.level / (1 + 8 * o.pos.distanceToSquared(l.pos));
    l.mat.emissiveIntensity = l.level * 9 + spill * 0.35;
  }
  ledLight.position.copy(brightest.pos);
  ledLight.intensity = brightest.level * 1.2;

  // A quick tap still shows the button travel all the way down.
  const pressed = holding || performance.now() - pressedAt < 170;
  askCap.position.y += ((pressed ? ASK_DOWN : ASK_UP) - askCap.position.y) * ease(pressed ? 60 : 28);
  const nubX = SWITCH.x + (powered ? -SWITCH.travel : SWITCH.travel);
  nub.position.x += (nubX - nub.position.x) * ease(30);
  nub.position.y += ((switchHeld ? NUB_DOWN : NUB_UP) - nub.position.y) * ease(40);

  if (bokeh) bokeh.uniforms.focus.value = camera.position.distanceTo(TARGET);
  film.uniforms.time.value += dt;
  renderBloom();
  composer.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For automated checks.
window.__edm = {
  askDown, askUp, setPower,
  get answer() { return !spinning && lit >= 0 ? leds[lit].text : null; },
};
