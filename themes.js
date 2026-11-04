import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Monthly backdrops. index.html picks the theme (from ?theme= or the month) and
// sets window.__theme before anything loads, so the loader and overlays match.
// Months without their own theme use the studio set.
export const THEME = window.__theme || 'studio';
// Phones (as main.js decides it) get lighter geometry for the heavier props.
const LITE = matchMedia('(pointer: coarse)').matches;

// Set dressing per theme: backdrop tone, floor, lights and the reflection
// environment. `panels` are bright shapes in the environment map that glossy
// surfaces (glass, LEDs, aluminum) reflect.
const CONFIGS = {
  studio: {
    tone: 0x9a948c,
    floor: 0x8a847d,
    exposure: 1.0,
    envIntensity: 0.7,
    room: 0x5a554e,
    envFloor: 0x24211e,
    panels: [
      [10, 5, 7, 0xfff3e2, [-2, 14.5, 8]],      // overhead softbox, matches the area light
      [2, 10, 3.5, 0xffffff, [-19.5, 6, 2]],    // left strip
      [2, 10, 2.5, 0xdfe8ff, [19.5, 6, -4]],    // right strip, cool
      [12, 6, 1.6, 0xffe2b8, [0, 7, -19.5]],    // warm window behind
    ],
    lights: null,
  },
  // October: a moonlit night with jack-o'-lanterns.
  halloween: {
    tone: 0x150f1b,
    floor: 0x231d26,
    exposure: 1.05,
    envIntensity: 0.55,
    room: 0x17121e,
    envFloor: 0x0e0b10,
    panels: [
      [10, 5, 2.5, 0xcfd6ff, [-2, 14.5, 8]],    // dim cool overhead, so the glass still catches a sheen
      [6, 6, 9, 0xdfe6ff, [-14, 12, -16]],      // the moon
      [6, 2, 2.2, 0xff8a2a, [-16, 1, 6]],       // lantern glow, low left
      [6, 2, 1.8, 0xff7a1a, [16, 1, 2]],        // lantern glow, low right
      [14, 6, 0.35, 0x5a6aa0, [0, 15, 0]],      // night sky
    ],
    lights: { softbox: [0xd6dcff, 2.4], key: [0xa9b8ff, 1.0, [-8, 12, -4]], rim: [0xa8b0ff, 0.7], hemi: [0x262a40, 0x0e0a08, 0.3] },
  },
  // November: a harvest table at golden hour, lit low from the side and by candles.
  thanksgiving: {
    tone: 0x3a2414,
    floor: 0xffffff,                            // the plank texture carries the colour
    exposure: 1.0,
    envIntensity: 0.6,
    room: 0x3a2516,
    envFloor: 0x1c110a,
    panels: [
      [10, 5, 2.2, 0xffe2c0, [-2, 14.5, 8]],    // warm overhead
      [9, 6, 6, 0xffb468, [-19.5, 5, 4]],       // low sun through a window, left
      [5, 2, 1.6, 0xffa04a, [16, 1.5, -6]],     // candle glow, low right
      [16, 5, 1.2, 0xff9a6a, [0, 4, -19.5]],    // dusk sky behind
    ],
    lights: { softbox: [0xffe0bc, 3.2], key: [0xffb470, 1.7, [-10, 7, 5]], rim: [0x9aaee8, 0.7], hemi: [0xffd2a0, 0x24160c, 0.3] },
  },
};

export function themeConfig() {
  return Object.hasOwn(CONFIGS, THEME) ? CONFIGS[THEME] : CONFIGS.studio;
}

// Low-lying mist, for themes that want it: built into every fogged material's
// fog step, so it has no planes to slice through objects. Thickest at the
// floor, thinning within ~0.5 units of height, building with distance and
// drifting slowly. Must run before any material compiles.
const MIST_TIME = { value: 0 };
export function installMist() {
  if (THEME !== 'halloween') return;
  THREE.ShaderChunk.fog_pars_vertex += '\n#ifdef USE_FOG\nvarying vec3 vMistWorld;\n#endif\n';
  THREE.ShaderChunk.fog_vertex += `
#ifdef USE_FOG
  vec4 mistLocal = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mistLocal = instanceMatrix * mistLocal;
  #endif
  vMistWorld = (modelMatrix * mistLocal).xyz;
#endif
`;
  THREE.ShaderChunk.fog_pars_fragment += '\n#ifdef USE_FOG\nvarying vec3 vMistWorld;\nuniform float mistTime;\n#endif\n';
  THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  vec2 mq = vMistWorld.xz * 0.32 + vec2(mistTime * 0.035, mistTime * 0.02);
  float drift = 0.6 + 0.4 * sin(mq.x * 2.1 + 1.3 * sin(mq.y * 1.7)) * sin(mq.y * 1.4 + 0.8 * sin(mq.x * 0.9));
  float mist = exp(-max(vMistWorld.y, 0.0) / 0.5) * smoothstep(3.0, 16.0, vFogDepth) * drift * 0.6;
  vec3 mistColor = fogColor * 2.4 + vec3(0.015, 0.015, 0.025);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, mistColor, mist);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif
`;
}

// Props and animation for themes that have them. Returns a per-frame update, or null.
export function buildThemeProps(ctx) {
  if (THEME === 'halloween') return halloween(ctx);
  if (THEME === 'thanksgiving') return thanksgiving(ctx);
  return null;
}

// A pumpkin (or squash) from a sphere: `ribs` lobes running pole to pole,
// flattened, with a dimple at the stem end. `taper` draws the blossom end to a
// point, as on an acorn squash. In the sphere's UVs the creases between lobes
// fall at u = k / ribs (for an even count).
function pumpkinGeometry(r, { ribs = 10, depth = 0.08, squash = 0.78, taper = 0, fine = 0 } = {}) {
  const geo = new THREE.SphereGeometry(r, fine ? 128 : 72, fine ? 64 : 40);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const h = v.y / r;
    const phi = Math.atan2(v.z, v.x);
    const lobe = 1 - depth + depth * Math.pow(Math.abs(Math.sin((phi * ribs) / 2)), 0.55);
    let k = (1 - (1 - lobe) * (1 - h * h)) * (1 - taper * Math.pow(Math.max(0, -h), 1.6));
    // Fine ridges running stem to blossom, and a slight unevenness (whole periods round, so no seam).
    if (fine) k *= 1 + fine * ((0.55 * Math.sin(phi * ribs * 4.5) + 0.45 * Math.sin(phi * ribs * 9 + 1.3)) * (1 - h * h) + 0.6 * Math.sin(phi * 23 + h * 9) * Math.sin(h * 17 + phi * 3));
    v.x *= k;
    v.z *= k;
    v.y = v.y * squash - r * 0.16 * Math.exp(-((1 - h) ** 2) / 0.02) + r * 0.06 * Math.exp(-((1 + h) ** 2) / 0.02);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- Halloween ----------
function halloween({ scene, camera, viewPoint, makeCanvas, toTexture, BLOOM_LAYER, anchors }) {
  const rand = Math.random;
  const parts = [];

  // --- jack-o'-lanterns ---
  // Skin: orange with faint vertical streaks; the carved shapes are dark when
  // unlit. The face is centred at u = 0.25, which a SphereGeometry puts at +z.
  const FACES = [
    (g, w, h) => {                                   // classic: triangle eyes, toothy grin
      const tri = (cx, cy, s, up = true) => {
        g.beginPath();
        g.moveTo(cx - s, cy + (up ? s * 0.6 : -s * 0.6));
        g.lineTo(cx + s, cy + (up ? s * 0.6 : -s * 0.6));
        g.lineTo(cx, cy + (up ? -s * 0.8 : s * 0.8));
        g.closePath();
        g.fill();
      };
      tri(w * 0.25 - 62, h * 0.4, 34);
      tri(w * 0.25 + 62, h * 0.4, 34);
      tri(w * 0.25, h * 0.5, 16);
      g.beginPath();
      const mx = w * 0.25, my = h * 0.6, mw = 110;
      g.moveTo(mx - mw, my - 8);
      for (let i = 0; i <= 8; i++) g.lineTo(mx - mw + (i * 2 * mw) / 8, my + (i % 2 ? 14 : -2) - 8);
      g.quadraticCurveTo(mx, my + 70, mx - mw, my - 8);
      g.fill();
    },
    (g, w, h) => {                                   // spooky: slanted eyes, jagged frown
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(w * 0.25 + s * 30, h * 0.44);
        g.lineTo(w * 0.25 + s * 92, h * 0.36);
        g.lineTo(w * 0.25 + s * 80, h * 0.47);
        g.closePath();
        g.fill();
      }
      g.beginPath();
      const mx = w * 0.25, my = h * 0.62;
      g.moveTo(mx - 90, my + 10);
      for (let i = 0; i <= 10; i++) g.lineTo(mx - 90 + i * 18, my + (i % 2 ? -18 : 6));
      g.lineTo(mx + 90, my + 30);
      g.quadraticCurveTo(mx, my - 6, mx - 90, my + 30);
      g.fill();
    },
    (g, w, h) => {                                   // round-eyed, surprised
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(w * 0.25 + s * 58, h * 0.42, 26, 0, Math.PI * 2);
        g.fill();
      }
      g.beginPath();
      g.ellipse(w * 0.25, h * 0.62, 34, 42, 0, 0, Math.PI * 2);
      g.fill();
    },
  ];
  function faceMask(draw) {
    const [c, g] = makeCanvas(1024, 512);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#fff';
    draw(g, 1024, 512);
    return c;
  }
  function skin(draw) {
    const [c, g] = makeCanvas(1024, 512);
    g.fillStyle = '#d4601a';
    g.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = rand() < 0.5 ? `rgba(120,40,0,${rand() * 0.12})` : `rgba(255,170,70,${rand() * 0.1})`;
      g.fillRect(rand() * 1024, 0, 1 + rand() * 6, 512);
    }
    g.fillStyle = '#2a1204';                         // the carved openings, dark when the candle dips
    draw(g, 1024, 512);
    return c;
  }
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4d5a24, roughness: 0.85 });
  const lanterns = [
    { r: 0.9, pos: [-3.7, 1.7], face: 0 },
    { r: 0.62, pos: [3.6, 1.1], face: 1 },
    { r: 0.48, pos: [2.9, -2.6], face: 2 },
  ].map(({ r, pos: [x, z], face }) => {
    const mask = faceMask(FACES[face]);
    const maskTex = toTexture(mask);
    const mat = new THREE.MeshPhysicalMaterial({
      map: toTexture(skin(FACES[face])), emissiveMap: maskTex, emissive: 0xff9a2a, emissiveIntensity: 2.5,
      roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.4,
    });
    const body = new THREE.Mesh(pumpkinGeometry(r), mat);
    body.position.set(x, r * 0.78 - 0.02, z);
    body.rotation.y = Math.atan2(viewPoint.x - x, viewPoint.z - z) + (rand() - 0.5) * 0.4;
    body.castShadow = body.receiveShadow = true;
    // Only the carved face blooms.
    const bloomMat = new THREE.MeshBasicMaterial({ map: maskTex, color: 0x000000 });
    body.layers.enable(BLOOM_LAYER);
    body.userData.bloomMat = bloomMat;
    scene.add(body);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.07, r * 0.11, r * 0.38, 8), stemMat);
    stem.position.set(x + r * 0.03, body.position.y + r * 0.62 + r * 0.15, z);
    stem.rotation.set((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.5);
    stem.castShadow = true;
    scene.add(stem);
    const light = new THREE.PointLight(0xff8a2a, 0, 7 * r, 2);
    light.position.set(x, body.position.y + r * 0.1, z);
    scene.add(light);
    return { mat, bloomMat, light, r, phase: rand() * 100 };
  });

  // --- the moon, low behind the set ---
  const moonTex = (() => {
    const [c, g] = makeCanvas(512, 512);
    const grd = g.createRadialGradient(230, 220, 40, 256, 256, 256);
    grd.addColorStop(0, '#fbf6e6');
    grd.addColorStop(1, '#d9d0b8');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(256, 256, 250, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 26; i++) {                 // maria and craters
      const x = 256 + (rand() - 0.5) * 360, y = 256 + (rand() - 0.5) * 360, rr = 10 + rand() * 60;
      if (Math.hypot(x - 256, y - 256) + rr > 245) continue;
      g.fillStyle = `rgba(150,140,120,${0.12 + rand() * 0.2})`;
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.fill();
    }
    return toTexture(c);
  })();
  const moonPos = new THREE.Vector3(-16, 15, -44);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(4.2, 64), new THREE.MeshBasicMaterial({
    map: moonTex, color: new THREE.Color(1.5, 1.5, 1.5), fog: false, transparent: true,
  }));
  moon.position.copy(moonPos);
  moon.userData.bloomHide = true;
  scene.add(moon);
  const glowTex = (() => {
    const [c, g] = makeCanvas(256, 256);
    // Opaque, on black, and added: a mostly transparent canvas comes out speckled
    // in Safari (it dithers gradients; faint pixels blow up when un-premultiplied).
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
    const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grd.addColorStop(0, 'rgb(110,112,128)');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    return toTexture(c);
  })();
  const moonGlow = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
  }));
  moonGlow.position.copy(moonPos).add(new THREE.Vector3(0, 0, -0.5));
  moonGlow.userData.bloomHide = true;
  scene.add(moonGlow);

  // --- bats wheeling across the sky ---
  const batTex = (() => {
    const [c, g] = makeCanvas(256, 128);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(128, 48);
    for (const s of [1, -1]) {
      g.moveTo(128, 50);
      g.quadraticCurveTo(128 + s * 40, 20, 128 + s * 120, 30);
      g.quadraticCurveTo(128 + s * 100, 52, 128 + s * 104, 74);
      g.quadraticCurveTo(128 + s * 84, 60, 128 + s * 70, 82);
      g.quadraticCurveTo(128 + s * 52, 64, 128 + s * 40, 86);
      g.quadraticCurveTo(128 + s * 26, 64, 128, 76);
    }
    g.fill();
    g.beginPath();                                   // body and ears
    g.ellipse(128, 62, 14, 22, 0, 0, Math.PI * 2);
    g.moveTo(118, 44); g.lineTo(114, 28); g.lineTo(124, 40);
    g.moveTo(138, 44); g.lineTo(142, 28); g.lineTo(132, 40);
    g.fill();
    return toTexture(c);
  })();
  const batMat = new THREE.MeshBasicMaterial({ map: batTex, color: 0x0a0610, alphaTest: 0.4, side: THREE.DoubleSide, fog: false });
  const bats = Array.from({ length: 7 }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), batMat);
    m.userData.bloomHide = true;
    m.userData.noAO = true;
    scene.add(m);
    return { m, cx: -8 + rand() * 16, cy: 3.5 + rand() * 5, cz: -16 + rand() * 7, rad: 4 + rand() * 6, speed: 0.25 + rand() * 0.3, phase: rand() * 6.3, flap: 9 + rand() * 5 };
  });

  // --- fallen leaves scattered round the device ---
  const LEAF_COLOURS = ['#b8400f', '#8f2f10', '#d27a12', '#6e2a10'];
  for (const colour of LEAF_COLOURS) {
    const [c, g] = makeCanvas(128, 128);
    g.fillStyle = colour;
    g.beginPath();
    for (let i = 0; i <= 160; i++) {                // a lobed leaf with a pointed tip at +x
      const a = (i / 160) * Math.PI * 2;
      const tip = Math.pow(Math.max(0, Math.cos(a)), 6) * 0.35;
      const r = 50 * (0.78 + 0.22 * Math.abs(Math.sin(a * 3.5)) + tip) * (0.9 + 0.1 * Math.cos(a));
      const x = 58 + Math.cos(a) * r, y = 64 + Math.sin(a) * r * 0.62;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.fill();
    g.strokeStyle = 'rgba(40,12,4,.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(20, 64); g.lineTo(110, 64);
    g.stroke();
    const count = 22;
    const leaves = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshStandardMaterial({ map: toTexture(c), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }),
      count
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      let x, z;
      do { x = (rand() - 0.5) * 14; z = (rand() - 0.5) * 11 + 0.5; } while (Math.abs(x) < 2.4 && Math.abs(z) < 2.3);
      e.set(-Math.PI / 2 + (rand() - 0.5) * 0.4, 0, rand() * Math.PI * 2);
      q.setFromEuler(e);
      const s = 0.7 + rand() * 0.6;
      m.compose(new THREE.Vector3(x, 0.012 + rand() * 0.01, z), q, new THREE.Vector3(s, s, s));
      leaves.setMatrixAt(i, m);
    }
    leaves.receiveShadow = true;
    leaves.userData.bloomHide = true;
    leaves.userData.noAO = true;                    // alpha cut-out: keep it out of the AO pass
    scene.add(leaves);
  }

  // --- tombstones fading into the fog behind ---
  const stoneTex = (() => {
    const [c, g] = makeCanvas(256, 256);
    g.fillStyle = '#6a6670';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${rand() * 0.15})` : `rgba(255,255,255,${rand() * 0.08})`;
      g.fillRect(rand() * 256, rand() * 256, 2, 2);
    }
    return c;
  })();
  const stoneShape = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.6, 0);
    s.lineTo(-0.6, 1.0);
    s.absarc(0, 1.0, 0.6, Math.PI, 0, true);
    s.lineTo(0.6, 0);
    s.closePath();
    return s;
  })();
  const stoneGeo = new THREE.ExtrudeGeometry(stoneShape, { depth: 0.22, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 20 });
  stoneGeo.translate(0, 0, -0.11);
  for (const [x, z, s, tilt] of [[-4.6, -6.8, 1.0, 0.08], [0.8, -9.2, 1.2, -0.05], [5.2, -7.6, 0.85, 0.12]]) {
    const [c, g] = makeCanvas(256, 256);
    g.drawImage(stoneTex, 0, 0);
    g.fillStyle = 'rgba(30,28,34,.85)';
    g.font = 'bold 54px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('R.I.P.', 128, 120);
    const tex = toTexture(c);
    tex.repeat.set(0.8, 0.6);
    tex.offset.set(0.6, 0.15);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const stone = new THREE.Mesh(stoneGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    stone.position.set(x, -0.05, z);
    stone.scale.setScalar(s);
    stone.rotation.set(-0.04, (rand() - 0.5) * 0.4, tilt);
    stone.castShadow = stone.receiveShadow = true;
    scene.add(stone);
  }

  // --- bare trees, silhouettes in the distance ---
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x17111b, roughness: 1 });
  // Branch segments are collected and merged, so each tree is one draw call
  // rather than hundreds (each tree was ~350 meshes, drawn three times a frame).
  function branch(parts, from, dir, len, radius, depth) {
    const to = from.clone().addScaledVector(dir, len);
    const seg = new THREE.CylinderGeometry(radius * 0.7, radius, len, 6);
    seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    const mid = from.clone().lerp(to, 0.5);
    seg.translate(mid.x, mid.y, mid.z);
    parts.push(seg);
    if (depth === 0) return;
    const n = 2 + (rand() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(new THREE.Vector3((rand() - 0.5) * 1.4, 0.15 + rand() * 0.4, (rand() - 0.5) * 1.4)).normalize();
      branch(parts, to, d, len * (0.6 + rand() * 0.15), radius * 0.62, depth - 1);
    }
  }
  for (const [x, z, h] of [[-9, -15, 3.2], [9.5, -17, 3.8]]) {
    const parts = [];
    branch(parts, new THREE.Vector3(x, 0, z), new THREE.Vector3((rand() - 0.5) * 0.2, 1, 0).normalize(), h, 0.32, 5);
    scene.add(new THREE.Mesh(mergeGeometries(parts), barkMat));
  }

  // --- cobwebs: a gauzy sheet slung in the corner where the wood box meets the
  // floor at the back left, laced with fine silk threads (thin 3D tubes that
  // sag and catch the light), and a few strands hanging from the housing.
  {
    const { boxX, boxZ, boxTop, houseX, houseZ, houseTop } = anchors.web;
    const r = (a, b) => a + rand() * (b - a);
    const near = (max) => max * Math.pow(rand(), 1.8);           // clustered towards the corner
    const onSide = () => new THREE.Vector3(boxX, 0.02 + near(0.6), boxZ + near(0.7));
    const onBack = () => new THREE.Vector3(boxX + near(0.7), 0.02 + near(0.6), boxZ);
    const onFloor = () => {
      const a = r(Math.PI * 1.05, Math.PI * 1.45), d = 0.08 + near(0.6);
      return new THREE.Vector3(boxX + Math.cos(a) * d, 0.004, boxZ + Math.sin(a) * d);
    };
    const groups = [onSide, onBack, onFloor];
    const threads = [];
    const strand = (a, b, sag = 0.2) => {
      const len = a.distanceTo(b);
      const mid = a.clone().lerp(b, 0.5);
      mid.y = Math.max(0.003, mid.y - sag * len * r(0.5, 1.2));
      mid.x -= 0.05 * len;                           // bellies out away from the corner
      mid.z -= 0.05 * len;
      threads.push(new THREE.QuadraticBezierCurve3(a, mid, b));
    };
    for (let i = 0; i < 110; i++) {
      const g1 = groups[i % 3], g2 = groups[(i + 1 + (rand() < 0.5 ? 1 : 0)) % 3];
      strand(g1(), g2());
    }
    for (let i = 0; i < 50; i++) {                   // tangle between existing threads
      const a = threads[Math.floor(rand() * threads.length)].getPoint(r(0.2, 0.8));
      const b = threads[Math.floor(rand() * threads.length)].getPoint(r(0.2, 0.8));
      if (a.distanceTo(b) > 0.04 && a.distanceTo(b) < 0.4) strand(a, b, 0.08);
    }
    for (let i = 0; i < 5; i++) {                    // long strands down from the housing's top edge
      strand(new THREE.Vector3(houseX, houseTop - r(0, 0.05), houseZ + r(0, 0.5)), new THREE.Vector3(boxX + r(0, 0.05), boxTop + 0.002, boxZ + r(0, 0.4)), 0.03);
    }
    const silk = new THREE.MeshStandardMaterial({ color: 0xe6e4ee, roughness: 0.3, transparent: true, opacity: 0.4, depthWrite: false });
    const geo = mergeGeometries(threads.map((c, i) => new THREE.TubeGeometry(c, 12, i % 9 ? 0.0012 : 0.0022, 3, false)));
    const web = new THREE.Mesh(geo, silk);
    web.userData.bloomHide = true;
    web.userData.noAO = true;
    scene.add(web);

    // Gauze: a sagging patch across the corner, textured with a tangle of fibres.
    const gauzeTex = (() => {
      const [c, g] = makeCanvas(512, 512);
      g.strokeStyle = '#fff';
      for (let i = 0; i < 900; i++) {
        g.globalAlpha = 0.05 + rand() * 0.22;
        g.lineWidth = 0.5 + rand();
        const x = rand() * 512, y = rand() * 512, a = rand() * Math.PI, l = 30 + rand() * 160;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rand() - 0.5) * 30, y + Math.sin(a) * l * 0.5 + (rand() - 0.5) * 30, x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      return toTexture(c, { color: false });
    })();
    const q = [                                      // corners of the patch: corner, side, floor, back
      new THREE.Vector3(boxX, 0.03, boxZ),
      new THREE.Vector3(boxX, 0.42, boxZ + 0.5),
      new THREE.Vector3(boxX - 0.42, 0.004, boxZ - 0.42),
      new THREE.Vector3(boxX + 0.5, 0.42, boxZ),
    ];
    const patch = new THREE.PlaneGeometry(1, 1, 14, 14);
    const pp = patch.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const s = pp.getX(i) + 0.5, u = pp.getY(i) + 0.5;
      const top = q[1].clone().lerp(q[2], s), bottom = q[0].clone().lerp(q[3], s);
      const v = bottom.lerp(top, u);
      v.y = Math.max(0.004, v.y - 0.12 * Math.sin(Math.PI * s) * Math.sin(Math.PI * u));   // sags in the middle
      pp.setXYZ(i, v.x, v.y, v.z);
    }
    patch.computeVertexNormals();
    const gauze = new THREE.Mesh(patch, new THREE.MeshStandardMaterial({
      color: 0xdedce8, alphaMap: gauzeTex, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, roughness: 0.5,
    }));
    gauze.userData.bloomHide = true;
    gauze.userData.noAO = true;
    scene.add(gauze);
  }

  // Every fogged material shares the mist's clock uniform.
  scene.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, renderer) => {
        prev?.call(m, shader, renderer);
        shader.uniforms.mistTime = MIST_TIME;
      };
    }
  });

  const camPos = new THREE.Vector3();
  return function update(t) {
    for (const l of lanterns) {
      // Candle flicker: a few incommensurate wobbles plus the odd gutter.
      const f = 0.78 + 0.12 * Math.sin(t * 7.3 + l.phase) + 0.07 * Math.sin(t * 13.1 + l.phase * 2) + 0.05 * Math.sin(t * 23.7 + l.phase * 3);
      const gutter = Math.sin(t * 0.7 + l.phase) > 0.97 ? 0.6 : 1;
      const k = f * gutter;
      l.mat.emissiveIntensity = 2.6 * k;
      l.bloomMat.color.setRGB(1, 0.55, 0.15).multiplyScalar(1.3 * k);
      l.light.intensity = 6 * l.r * k;
    }
    MIST_TIME.value = t;
    camera.getWorldPosition(camPos);
    for (const b of bats) {
      const a = t * b.speed + b.phase;
      b.m.position.set(b.cx + Math.cos(a) * b.rad, b.cy + Math.sin(a * 2.3) * 0.8, b.cz + Math.sin(a) * b.rad * 0.4);
      b.m.lookAt(camPos);
      b.m.scale.set(0.55 + 0.45 * Math.abs(Math.sin(t * b.flap + b.phase)), 1, 1);
    }
  };
}

// ---------- Thanksgiving ----------
// A harvest table at golden hour: plank boards and a plaid runner, a wicker
// cornucopia spilling the harvest, pumpkins and squash, pillar candles on a log
// round, a bundle of ornamental corn, leaves underfoot and drifting down, and
// corn shocks and hay bales out in the dusk.
function thanksgiving({ scene, camera, makeCanvas, toTexture, BLOOM_LAYER, floor }) {
  const rand = Math.random;
  const rr = (a, b) => a + rand() * (b - a);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const UP = new THREE.Vector3(0, 1, 0);
  const put = (mesh, cast = true) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  // Floor spots props occupy, [x, z, radius], so leaves don't land inside them.
  const taken = [];
  // Spheres the camera is kept out of: orbiting low and far would otherwise pass
  // it through the candles, the horn, the bales and the corn shocks.
  const keepOut = [];
  const guard = (x, y, z, r) => keepOut.push([new THREE.Vector3(x, y, z), r + 0.2]);
  const free = (x, z, m = 0) => !(Math.abs(x) < 2.4 + m && Math.abs(z) < 2.3 + m) &&
    taken.every(([ox, oz, or]) => Math.hypot(x - ox, z - oz) > or + m);

  // --- plank table: boards about 5 units wide, running away from the viewer ---
  {
    const S = 2048, N = 8, PW = S / N;
    const [c, g] = makeCanvas(S, S);
    const tones = ['#6e4526', '#5c391f', '#77502e', '#654029', '#6a4327', '#5f3c22', '#73492b', '#604027'];
    for (let i = 0; i < N; i++) {
      const x0 = i * PW;
      g.save();
      g.beginPath();
      g.rect(x0, 0, PW, S);
      g.clip();
      g.fillStyle = tones[i];
      g.fillRect(x0, 0, PW, S);
      for (let k = 0; k < 160; k++) {               // grain: whole periods over the tile, so it repeats cleanly
        const x = x0 + rand() * PW, amp = rr(1, 7), per = 1 + Math.floor(rand() * 3), ph = rand() * 6.3;
        g.strokeStyle = rand() < 0.65 ? `rgba(38,18,6,${rr(0.05, 0.22)})` : `rgba(210,160,105,${rr(0.03, 0.1)})`;
        g.lineWidth = rr(0.6, 2.8);
        g.beginPath();
        for (let y = 0; y <= S; y += 24) {
          const xx = x + amp * Math.sin((y / S) * Math.PI * 2 * per + ph);
          y ? g.lineTo(xx, y) : g.moveTo(xx, y);
        }
        g.stroke();
      }
      for (let k = rand() < 0.5 ? 1 : 2; k > 0; k--) {   // knots
        const kx = x0 + rr(40, PW - 40), ky = rr(90, S - 90);
        for (let ring = 6; ring >= 0; ring--) {
          g.strokeStyle = `rgba(40,18,6,${0.1 + (6 - ring) * 0.05})`;
          g.lineWidth = 1.5;
          g.beginPath();
          g.ellipse(kx, ky, 4 + ring * 4, 10 + ring * 9, 0, 0, Math.PI * 2);
          g.stroke();
        }
        g.fillStyle = 'rgba(35,15,5,.75)';
        g.beginPath();
        g.ellipse(kx, ky, 5, 9, 0, 0, Math.PI * 2);
        g.fill();
      }
      const joint = rr(60, S - 60);                   // a butt joint, nailed either side
      g.fillStyle = 'rgba(20,10,4,.85)';
      g.fillRect(x0, joint, PW, 4);
      g.fillStyle = 'rgba(15,8,3,.9)';
      for (const dy of [-16, 20]) {
        for (const fx of [0.25, 0.75]) {
          g.beginPath();
          g.arc(x0 + PW * fx, joint + dy, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
      g.fillStyle = '#1a0d05';                        // the gap between boards
      g.fillRect(x0, 0, 4, S);
      g.fillStyle = 'rgba(255,210,160,.08)';
      g.fillRect(x0 + 4, 0, 2, S);
    }
    floor.material.map = toTexture(c, { repeat: 4 });
    const [bc, bg] = makeCanvas(1024, 1024);          // fine grain relief, for close views
    bg.fillStyle = '#808080';
    bg.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 2600; i++) {
      const x = rand() * 1024, y = rand() * 1024, l = rr(40, 300), w = rr(0.8, 2);
      bg.fillStyle = rand() < 0.55 ? `rgba(0,0,0,${rr(0.08, 0.25)})` : `rgba(255,255,255,${rr(0.05, 0.15)})`;
      bg.fillRect(x, y, w, l);
      if (y + l > 1024) bg.fillRect(x, y - 1024, w, l);   // wrap, so the tile repeats cleanly
    }
    floor.material.bumpMap = toTexture(bc, { repeat: 16, color: false });
    floor.material.bumpScale = 0.5;
    floor.material.needsUpdate = true;
    // Real boards under the set, so the joints are true bevelled grooves. They
    // take the floor's material, mapped as the floor is (its UVs span 160 units),
    // so each board lines up with its painted plank. The floor beyond sits a hair lower.
    floor.position.y = -0.003;
    for (let bx = -20; bx < 20; bx += 5) {
      const bg2 = new RoundedBoxGeometry(4.985, 0.06, 40, 2, 0.014);
      bg2.translate(bx + 2.5, -0.03, 0);
      const bp = bg2.attributes.position, buv = bg2.attributes.uv;
      for (let i = 0; i < bp.count; i++) buv.setXY(i, bp.getX(i) / 160 + 0.5, -bp.getZ(i) / 160 + 0.5);
      const board = new THREE.Mesh(bg2, floor.material);
      board.receiveShadow = true;
      scene.add(board);
    }
  }

  // --- a plaid runner under the device, fringed at the ends ---
  {
    const L = 28, WD = 7, TH = 0.008, SETT_UNITS = 2.2;
    const sett = [['#7e2e16', 46], ['#b9862f', 34], ['#3a2414', 8], ['#b9862f', 34], ['#efe0bc', 5], ['#b9862f', 34]];
    const SETT = sett.reduce((s, [, w]) => s + w, 0);
    const settAt = (q) => {
      q = ((q % SETT) + SETT) % SETT;
      for (const [col, w] of sett) {
        if (q < w) return col;
        q -= w;
      }
      return sett[0][0];
    };
    // One sett, square, tiled along and across, so the cloth stays sharp up close.
    const T = 1024, k = T / SETT;
    const [c, g] = makeCanvas(T, T);
    g.globalAlpha = 0.9;
    for (let y = 0; y < T; y++) { g.fillStyle = settAt(y / k); g.fillRect(0, y, T, 1); }   // warp, along the length
    g.globalAlpha = 0.5;
    for (let x = 0; x < T; x++) { g.fillStyle = settAt(x / k); g.fillRect(x, 0, 1, T); }   // weft, across
    g.globalAlpha = 1;
    g.lineWidth = 3;                                  // twill ribs (spacing divides the tile, so it repeats cleanly)
    for (let q = -T; q < T; q += 8) {
      g.strokeStyle = 'rgba(0,0,0,.13)';
      g.beginPath();
      g.moveTo(q, 0);
      g.lineTo(q + T, T);
      g.stroke();
      g.strokeStyle = 'rgba(255,240,210,.06)';
      g.beginPath();
      g.moveTo(q + 4, 0);
      g.lineTo(q + 4 + T, T);
      g.stroke();
    }
    for (let i = 0; i < 2600; i++) {                  // slubs: the odd thicker or paler bit of thread
      g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${rr(0.05, 0.14)})` : `rgba(255,245,220,${rr(0.04, 0.1)})`;
      const x = rr(4, T - 30), y = rr(4, T - 30);
      rand() < 0.5 ? g.fillRect(x, y, rr(6, 24), 1.5) : g.fillRect(x, y, 1.5, rr(6, 24));
    }
    const rep = (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(L / SETT_UNITS, WD / SETT_UNITS);
      return t;
    };
    // A slab of cloth with real thickness (its top face takes the pattern).
    const runner = new THREE.Mesh(new THREE.BoxGeometry(L, TH, WD), new THREE.MeshStandardMaterial({
      map: rep(toTexture(c)), bumpMap: rep(toTexture(c, { color: false })), bumpScale: 0.6, roughness: 0.95,
    }));
    runner.position.y = TH / 2;
    runner.userData.bloomHide = true;
    put(runner, false);

    // Fringe: the warp threads run on past each end, loose and a little ragged,
    // each the colour of its stripe (the box's top face runs v = 1 at -z, as a plane would).
    const RV = WD / SETT_UNITS;
    const warpAt = (z) => {
      const f = ((((0.5 - z / WD) * RV) % 1) + 1) % 1;
      return settAt((1 - f) * SETT);
    };
    const threads = [], tc = new THREE.Color();
    for (let z = -WD / 2 + 0.02; z < WD / 2 - 0.01; z += LITE ? 0.06 : 0.035) {
      const len = rr(0.3, 0.5), wob = rr(-0.04, 0.04);
      const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
        new THREE.Vector3(L / 2 - 0.03, TH * 0.6, z),
        new THREE.Vector3(L / 2 + 0.04, TH * 0.5, z + wob * 0.2),
        new THREE.Vector3(L / 2 + len * 0.55, 0.0055, z + wob),
        new THREE.Vector3(L / 2 + len, 0.005, z + wob * 1.6 + rr(-0.02, 0.02)),
      ]), 8, 0.0045, 3, false);
      tc.set(warpAt(z));
      const nv = tg.attributes.position.count, ca = new Float32Array(nv * 3);
      for (let i = 0; i < nv; i++) tc.toArray(ca, i * 3);
      tg.setAttribute('color', new THREE.BufferAttribute(ca, 3));
      threads.push(tg);
    }
    const fringeGeo = mergeGeometries(threads);
    const fringeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    for (const sx of [1, -1]) {
      const f = new THREE.Mesh(fringeGeo, fringeMat);
      f.scale.x = sx;                                 // mirrored for the far end
      f.userData.bloomHide = true;
      put(f, false);
    }
  }

  // --- pumpkins and squash ---
  function skin({ base, crease, crown, streak = [[120, 50, 0], [255, 185, 100]], ribs = 10, blotch = null, speck = [255, 205, 140] }) {
    const [c, g] = makeCanvas(1024, 512);
    g.fillStyle = base;
    g.fillRect(0, 0, 1024, 512);
    if (blotch) {
      for (let i = 0; i < 10; i++) {                  // patches of a second colour, towards the blossom end
        const x = rr(80, 944), y = rr(250, 480), rad = rr(40, 130);
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, rgba(blotch, 0.75));
        grd.addColorStop(1, rgba(blotch, 0));
        g.fillStyle = grd;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
    for (let i = 0; i < 160; i++) {                   // broad, soft mottling
      const x = rr(70, 954), y = rr(30, 482), rad = rr(20, 70);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, rgba(streak[i & 1], 0.07));
      grd.addColorStop(1, rgba(streak[i & 1], 0));
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 900; i++) {                   // hair-fine ribbing, stem to blossom
      const x = rand() * 1024, wob = rr(-6, 6);
      g.strokeStyle = rgba(streak[i & 1], rr(0.04, 0.12));
      g.lineWidth = rr(0.6, 1.4);
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + wob, 256, x, 512);
      g.stroke();
    }
    const w = 1024 / ribs;
    for (let k = 0; k < ribs; k++) {                  // shadowed creases, lighter crowns
      const a = g.createLinearGradient(k * w, 0, (k + 1) * w, 0);
      a.addColorStop(0, rgba(crease, 0.6));
      a.addColorStop(0.24, rgba(crease, 0));
      a.addColorStop(0.76, rgba(crease, 0));
      a.addColorStop(1, rgba(crease, 0.6));
      g.fillStyle = a;
      g.fillRect(k * w, 0, w, 512);
      const b = g.createLinearGradient(k * w, 0, (k + 1) * w, 0);
      b.addColorStop(0.2, rgba(crown, 0));
      b.addColorStop(0.5, rgba(crown, 0.16));
      b.addColorStop(0.8, rgba(crown, 0));
      g.fillStyle = b;
      g.fillRect(k * w, 0, w, 512);
    }
    for (let i = 0; i < 1400; i++) {                  // speckle
      g.fillStyle = rgba(speck, rr(0.12, 0.32));
      g.fillRect(rand() * 1024, rr(20, 492), rr(1, 2.2), rr(1, 2.2));
    }
    const poles = g.createLinearGradient(0, 0, 0, 512);
    poles.addColorStop(0, rgba(crease, 0.45));
    poles.addColorStop(0.2, rgba(crease, 0));
    poles.addColorStop(0.85, rgba(crease, 0));
    poles.addColorStop(1, rgba(crease, 0.35));
    g.fillStyle = poles;
    g.fillRect(0, 0, 1024, 512);
    return c;
  }
  const SKINS = {
    orange: { base: '#d8681c', crease: [110, 40, 4], crown: [255, 200, 120] },
    rouge: { base: '#c4441a', crease: [100, 24, 6], crown: [255, 170, 110] },
    white: { base: '#e6dfcc', crease: [150, 138, 110], crown: [255, 255, 245], streak: [[160, 150, 120], [255, 255, 250]], speck: [170, 160, 130] },
    acorn: { base: '#24351d', crease: [8, 16, 6], crown: [90, 115, 60], streak: [[10, 20, 8], [70, 90, 50]], ribs: 8, blotch: [214, 120, 40], speck: [120, 140, 90] },
  };
  const skins = new Map();                          // one texture per variety, shared
  const skinTexture = (kind, ribs) => {
    const k = kind + ribs;
    if (!skins.has(k)) {
      const c = skin({ ...SKINS[kind], ribs });
      skins.set(k, { map: toTexture(c), bump: toTexture(c, { color: false }) });
    }
    return skins.get(k);
  };
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x7c6c3c, roughness: 0.9 });
  const greenStem = new THREE.MeshStandardMaterial({ color: 0x56602c, roughness: 0.85 });
  function stem(r, mat) {
    // Ridged and a little twisted, splaying into feet where it meets the pumpkin.
    const h = r * 0.45;
    const geo = new THREE.CylinderGeometry(r * 0.06, r * 0.1, h, LITE ? 20 : 40, 12);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    const bend = rr(-0.6, 0.6), twist = rr(0.5, 1.1);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const t = v.y / h + 0.5, a = Math.atan2(v.z, v.x) + twist * t;
      const ridge = Math.pow(Math.abs(Math.cos(a * 2.5)), 0.7);
      const k = (0.84 + 0.24 * ridge) * (1 + 1.2 * Math.pow(1 - t, 6) * (0.6 + 0.8 * ridge));
      p.setXYZ(i, v.x * k + bend * h * t * t, v.y, v.z * k);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  }
  function gourd(kind, r, x, z, { ribs = 10, depth = 0.08, squash = 0.78, taper = 0, tilt = 0, y = 0, stemMaterial = stemMat } = {}) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(pumpkinGeometry(r, { ribs, depth, squash, taper, fine: 0.008 }), new THREE.MeshPhysicalMaterial({
      map: skinTexture(kind, ribs).map, bumpMap: skinTexture(kind, ribs).bump, bumpScale: 0.6, roughness: kind === 'white' ? 0.7 : 0.66, clearcoat: 0.06, clearcoatRoughness: 0.7,
    }));
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    const st = stem(r, stemMaterial);
    st.position.y = r * (squash - 0.16 + 0.2);
    st.rotation.y = rand() * 6.3;
    group.add(st);
    group.position.set(x, y + r * squash * 0.97, z);
    group.rotation.set(rr(-tilt, tilt), rand() * 6.3, rr(-tilt, tilt));
    scene.add(group);
    guard(x, y + r * squash, z, r * 1.1);
    if (!y) taken.push([x, z, r * 1.05]);
    return group;
  }
  gourd('rouge', 1.05, 4.2, 0.5, { squash: 0.58, depth: 0.12 });
  gourd('white', 0.58, 3.25, 2.35, { stemMaterial: greenStem });
  gourd('orange', 0.45, 5.15, 1.95, { tilt: 0.08 });
  gourd('acorn', 0.38, 4.3, 2.75, { ribs: 8, depth: 0.2, squash: 0.95, taper: 0.5, tilt: 0.25, stemMaterial: greenStem });

  // --- pillar candles on a log round, behind to the right ---
  const flames = [];
  {
    const cx = 4.0, cz = -2.8, RR = 1.35, RH = 0.2;
    const [c, g] = makeCanvas(512, 512);              // end grain: growth rings, a few checks, bark at the rim
    g.fillStyle = '#c69a66';
    g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 38; k++) {
      const rad = 6 + k * 6.3 + rr(-1.5, 1.5);
      g.strokeStyle = `rgba(110,62,28,${rr(0.25, 0.55)})`;
      g.lineWidth = rr(1, 2.5);
      g.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2, w = rad * (1 + 0.025 * Math.sin(a * 3 + k * 0.3));
        const x = 262 + Math.cos(a) * w * (1 - k / 400), y = 252 + Math.sin(a) * w;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    g.strokeStyle = 'rgba(40,20,8,.7)';
    for (let k = 0; k < 3; k++) {
      const a = rand() * 6.3;
      g.lineWidth = rr(1.5, 3);
      g.beginPath();
      g.moveTo(262 + Math.cos(a) * 20, 252 + Math.sin(a) * 20);
      g.lineTo(256 + Math.cos(a + 0.04) * 240, 256 + Math.sin(a + 0.04) * 240);
      g.stroke();
    }
    g.strokeStyle = '#3a2414';
    g.lineWidth = 18;
    g.beginPath();
    g.arc(256, 256, 248, 0, Math.PI * 2);
    g.stroke();
    const [bc, bg] = makeCanvas(512, 128);            // bark: furrows running up the side
    bg.fillStyle = '#3e2c1e';
    bg.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 220; i++) {
      bg.fillStyle = rand() < 0.5 ? `rgba(15,8,4,${rr(0.2, 0.5)})` : `rgba(140,110,80,${rr(0.1, 0.25)})`;
      bg.fillRect(rand() * 512, 0, rr(1, 5), 128);
    }
    const bark = toTexture(bc);
    bark.wrapS = THREE.RepeatWrapping;
    bark.repeat.set(3, 1);
    const roundGeo = new THREE.CylinderGeometry(RR, RR * 1.02, RH, LITE ? 64 : 160, 4);
    {
      const rp = roundGeo.attributes.position, ph = rand() * 6.3;
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i), z = rp.getZ(i), r = Math.hypot(x, z);
        if (r < RR * 0.98) continue;
        const a = Math.atan2(z, x);
        const ridge = 0.035 * Math.pow(Math.abs(Math.sin(a * 22 + 1.5 * Math.sin(a * 5 + ph))), 0.6) + 0.008 * Math.sin(a * 61 + rp.getY(i) * 40);
        rp.setXYZ(i, (x * (r + ridge)) / r, rp.getY(i), (z * (r + ridge)) / r);
      }
      roundGeo.computeVertexNormals();
    }
    const round = new THREE.Mesh(roundGeo, [
      new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark, bumpScale: 1, roughness: 1 }),
      new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 1 }),
    ]);
    round.position.set(cx, RH / 2, cz);
    put(round);
    guard(cx, 1.3, cz, 1.6);
    taken.push([cx, cz, RR + 0.1]);

    // Light through the melted pool makes the top of the wax glow.
    const waxGlow = (() => {
      const [gc, gg] = makeCanvas(4, 256);
      const grd = gg.createLinearGradient(0, 256, 0, 0);
      grd.addColorStop(0, '#000');
      grd.addColorStop(0.72, '#000');
      grd.addColorStop(0.93, '#3a2410');
      grd.addColorStop(1, '#b8703a');
      gg.fillStyle = grd;
      gg.fillRect(0, 0, 4, 256);
      return toTexture(gc);
    })();
    // Albedo: white down the side, amber in the melted pool (lit from right above,
    // cream wax there clipped to white).
    const poolMap = (() => {
      const [pc, pg] = makeCanvas(4, 256);
      const grd = pg.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, '#d09a62');
      grd.addColorStop(0.012, '#d09a62');
      grd.addColorStop(0.02, '#ffffff');
      grd.addColorStop(1, '#ffffff');
      pg.fillStyle = grd;
      pg.fillRect(0, 0, 4, 256);
      return toTexture(pc);
    })();
    const flameGeo = new THREE.SphereGeometry(1, 16, 12);
    const fp = flameGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) {              // a teardrop, drawn up to a point
      const y = fp.getY(i), k = y > 0 ? 1 - 0.75 * y : 1;
      fp.setXYZ(i, fp.getX(i) * k * 0.055, (y > 0 ? y * 2.8 : y) * 0.06, fp.getZ(i) * k * 0.055);
    }
    flameGeo.computeVertexNormals();
    const wickMat = new THREE.MeshStandardMaterial({ color: 0x141010, roughness: 0.9 });
    for (const [dx, dz, H, R, wax] of [[-0.45, 0.3, 1.9, 0.36, 0xe2d4b4], [0.55, 0.45, 1.25, 0.32, 0xe8dcc2], [0.2, -0.55, 2.55, 0.38, 0xdcc8a0]]) {
      const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(R * 0.97, 0), new THREE.Vector2(R, 0.03)];
      for (let i = 1; i <= 8; i++) pts.push(new THREE.Vector2(R * (1 + 0.006 * Math.sin(i * 2.3)), 0.03 + (H - 0.05) * (i / 8)));
      pts.push(new THREE.Vector2(R * 0.96, H), new THREE.Vector2(R * 0.85, H - 0.035), new THREE.Vector2(R * 0.4, H - 0.08), new THREE.Vector2(0, H - 0.09));
      const lathe = new THREE.LatheGeometry(pts, LITE ? 48 : 96);
      // UVs by height, so the glow map runs up the side; the top (the last four
      // profile points: rim, pool and wick well) gets v = 1, the pool's own colour.
      // The melted rim dips and rises unevenly (the side's top point moves with it, so the profile never folds).
      const uv = lathe.attributes.uv, pos = lathe.attributes.position, n = pts.length, w1 = rand() * 6.3, w2 = rand() * 6.3;
      for (let i = 0; i < uv.count; i++) {
        const j = i % n;
        if (j >= n - 5) {
          const a = Math.atan2(pos.getX(i), pos.getZ(i));
          pos.setY(i, pos.getY(i) + 0.022 * Math.sin(3 * a + w1) + 0.01 * Math.sin(7 * a + w2) - 0.012);
        }
        uv.setY(i, j >= n - 4 ? 1 : Math.min(0.97, pos.getY(i) / H));
      }
      // Drips run down from the lip, fuller at the bottom where the wax gathers.
      const parts = [lathe];
      for (let k = 0, nd = 3 + Math.floor(rand() * 4); k < nd; k++) {
        const a = rand() * Math.PI * 2, len = rr(0.1, Math.min(0.7, H * 0.45)), w = rr(0.03, 0.055);
        const d = new THREE.CapsuleGeometry(w / 2, len, 4, 10);
        const dp = d.attributes.position;
        for (let i = 0; i < dp.count; i++) {
          const y = dp.getY(i), f = 1 + 0.45 * Math.max(0, -y / (len / 2 + w / 2));
          dp.setXYZ(i, dp.getX(i) * f, y, dp.getZ(i) * f * 0.55);
        }
        d.translate(0, H - 0.035 - len / 2, R - w * 0.08);
        d.rotateY(a);
        d.computeVertexNormals();
        const du = d.attributes.uv, dq = d.attributes.position;
        for (let i = 0; i < du.count; i++) du.setY(i, Math.min(0.97, dq.getY(i) / H));
        parts.push(d);
      }
      const geo = mergeGeometries(parts);
      const waxMat = new THREE.MeshStandardMaterial({ color: wax, map: poolMap, roughness: 0.6, emissive: 0xffa050, emissiveMap: waxGlow, emissiveIntensity: 1 });
      const candle = new THREE.Mesh(geo, waxMat);
      const x = cx + dx, z = cz + dz;
      candle.position.set(x, RH, z);
      put(candle);
      const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.13, 6), wickMat);
      wick.position.set(x, RH + H - 0.03, z);
      wick.rotation.z = 0.12;
      scene.add(wick);
      const bloomMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.4, 0.9) }));
      flame.position.set(x + 0.008, RH + H + 0.07, z);
      flame.layers.enable(BLOOM_LAYER);
      flame.userData.bloomMat = bloomMat;
      scene.add(flame);
      // Hung a little above the flame: right at it, the wax under it blows out to white.
      const light = new THREE.PointLight(0xffa04a, 0, 7, 2);
      light.position.set(x, RH + H + 0.8, z);
      scene.add(light);
      flames.push({ flame, bloomMat, light, waxMat, phase: rand() * 100 });
    }
  }

  // --- a woven wicker cornucopia on the left, its mouth to the viewer ---
  {
    // Built strand by strand: K stakes run from the rim to the tip, and flat
    // weavers circle the horn, riding over one stake and under the next (each
    // row the other way round). The cells keep their proportions as it narrows.
    const K = LITE ? 32 : 40;                         // stakes (even, so each weaver closes on itself)
    const AROUND = K * (LITE ? 3 : 4), XS = LITE ? 4 : 6;
    const R0 = 1.0, LIFT0 = 0.012;                    // LIFT0: the runner's thickness; the weave rests on it
    const rad = (t) => 0.04 + R0 * Math.pow(1 - t, 1.15);
    const cell = (t) => Math.max((2 * Math.PI * rad(t)) / K, 0.022);
    const stakeR = (t) => 0.12 * cell(t);
    const halfW = (t) => 0.46 * cell(t);              // weaver half-width, along the horn (rows overlap a touch: no gaps)
    const halfT = (t) => 0.22 * cell(t);              // weaver half-thickness
    // How far a weaver rides out over / in under a stake: less than its thickness,
    // so neighbouring rows (opposite phase) still close up and leave no holes.
    const amp = (t) => 0.6 * stakeR(t) + 0.3 * halfT(t);
    const ext = (t) => amp(t) + halfT(t);             // half the wall's thickness
    const lift = (t) => (t > 0.65 ? 1.5 * ((t - 0.65) / 0.35) ** 2 : 0);
    const flat = new THREE.CatmullRomCurve3([[-3.65, 0.95], [-4.35, -0.15], [-4.95, -1.3], [-5.05, -2.35], [-4.6, -3.1], [-3.95, -3.3], [-3.55, -2.95]]
      .map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    // A curve whose parameter is its own even step, so each ring's radius and its
    // height off the table come from the same t: the underside rests on the cloth.
    class HornPath extends THREE.Curve {
      getPoint(t, out = new THREE.Vector3()) {
        t = Math.min(1, Math.max(0, t));
        return flat.getPointAt(t, out).setY(LIFT0 + rad(t) + ext(t) + lift(t));
      }
    }
    const curve = new HornPath();
    curve.getPointAt = curve.getPoint;
    curve.getTangentAt = curve.getTangent;
    const FR = 600, frames = curve.computeFrenetFrames(FR, false);
    const C = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
    const frameAt = (t) => {                          // centre and frame at t, interpolated
      const f = Math.min(FR - 1e-6, Math.max(0, t * FR)), i = Math.floor(f), w = f - i;
      curve.getPoint(t, C);
      T.copy(frames.tangents[i]).lerp(frames.tangents[i + 1], w).normalize();
      N.copy(frames.normals[i]).lerp(frames.normals[i + 1], w).normalize();
      B.crossVectors(T, N).normalize();
    };
    const speed = (t) => curve.getPoint(Math.min(1, t + 0.001)).distanceTo(curve.getPoint(Math.max(0, t - 0.001))) / (Math.min(1, t + 0.001) - Math.max(0, t - 0.001));

    const pos = [], nrm = [], uvs = [], col = [], idx = [];
    const grid = (rows, cols, write) => {             // a (rows+1) x (cols+1) vertex grid, quads between
      const base = pos.length / 3;
      for (let a = 0; a <= rows; a++) for (let b = 0; b <= cols; b++) write(a, b);
      for (let a = 0; a < rows; a++) {
        for (let b = 0; b < cols; b++) {
          const p0 = base + a * (cols + 1) + b, p1 = p0 + cols + 1;
          idx.push(p0, p0 + 1, p1, p1, p0 + 1, p1 + 1);
        }
      }
    };
    const P = new THREE.Vector3(), nr = new THREE.Vector3(), eT = new THREE.Vector3(), q = new THREE.Vector3(), n = new THREE.Vector3(), tone = new THREE.Color();
    const TONES = [0xc4955a, 0xb48448, 0xcfa46a, 0xa8783e, 0xbe8e52];
    // Weavers, row after row from the rim towards the tip.
    let row = 0;
    for (let t = 0.004; t < 0.975; row++) {
      frameAt(t);
      const R = rad(t), hw = halfW(t), ht = halfT(t), a = amp(t), par = row & 1;
      const c0 = C.clone(), T0 = T.clone(), N0 = N.clone(), B0 = B.clone();
      tone.setHex(pick(TONES));
      const vary = rand() * 6.3;
      grid(AROUND, XS, (m, k) => {
        const th = (m / AROUND) * Math.PI * 2, ph = (k / XS) * Math.PI * 2;
        nr.copy(N0).multiplyScalar(Math.cos(th)).addScaledVector(B0, Math.sin(th));
        P.copy(c0).addScaledVector(nr, R + a * Math.cos((K / 2) * th + par * Math.PI));
        q.copy(P).addScaledVector(T0, Math.cos(ph) * hw).addScaledVector(nr, Math.sin(ph) * ht);
        n.copy(T0).multiplyScalar(Math.cos(ph) / hw).addScaledVector(nr, Math.sin(ph) / ht).normalize();
        pos.push(q.x, q.y, q.z);
        nrm.push(n.x, n.y, n.z);
        uvs.push((R * th) / 0.3, k / XS);
        const shade = 0.88 + 0.12 * Math.sin(th * 3 + vary);     // sun-bleached and darker stretches
        col.push(tone.r * shade, tone.g * shade, tone.b * shade);
      });
      t += (0.78 * cell(t)) / speed(t);
    }
    // Stakes, rim to tip.
    const NS = 160;
    tone.setHex(0x9a6c38);
    for (let s = 0; s < K; s++) {
      const th = (s / K) * Math.PI * 2;
      grid(NS, XS, (j, k) => {
        const t = j / NS, ph = (k / XS) * Math.PI * 2;
        frameAt(t);
        nr.copy(N).multiplyScalar(Math.cos(th)).addScaledVector(B, Math.sin(th));
        eT.copy(N).multiplyScalar(-Math.sin(th)).addScaledVector(B, Math.cos(th));
        const rs = stakeR(t);
        P.copy(C).addScaledVector(nr, rad(t));
        n.copy(eT).multiplyScalar(Math.cos(ph)).addScaledVector(nr, Math.sin(ph));
        q.copy(P).addScaledVector(n, rs);
        pos.push(q.x, q.y, q.z);
        nrm.push(n.x, n.y, n.z);
        uvs.push((t * 6) / 0.3, k / XS);
        col.push(tone.r, tone.g, tone.b);
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    // Fibre running along each strand (tinted by the strand's colour).
    const [fc, fg] = makeCanvas(256, 64);
    fg.fillStyle = '#dcdcdc';
    fg.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 260; i++) {
      fg.fillStyle = rand() < 0.6 ? `rgba(40,25,10,${rr(0.1, 0.35)})` : `rgba(255,250,235,${rr(0.1, 0.3)})`;
      const y = rand() * 64, x = rand() * 256, l = rr(30, 200);
      fg.fillRect(x, y, l, rr(0.6, 1.6));
      if (x + l > 256) fg.fillRect(x - 256, y, l, rr(0.6, 1.6));
    }
    const fibre = toTexture(fc), fibreBump = toTexture(fc, { color: false });
    for (const t of [fibre, fibreBump]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const strandMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: fibre, bumpMap: fibreBump, bumpScale: 0.6, roughness: 0.75 });
    put(new THREE.Mesh(geo, strandMat));

    // A three-strand braid binds the rim.
    frameAt(0);
    const c0 = C.clone(), T0 = T.clone(), N0 = N.clone(), B0 = B.clone(), R0r = rad(0), rb = ext(0) * 1.15, TW = 64;
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb98a50, map: fibre, bumpMap: fibreBump, bumpScale: 0.6, roughness: 0.75 });
    for (let i = 0; i < 3; i++) {
      const pts = [];
      for (let m = 0; m < 360; m++) {
        const ph = (m / 360) * Math.PI * 2, d = N0.clone().multiplyScalar(Math.cos(ph)).addScaledVector(B0, Math.sin(ph));
        const tw = TW * ph + (i * Math.PI * 2) / 3;
        pts.push(c0.clone().addScaledVector(d, R0r + rb * Math.cos(tw)).addScaledVector(T0, rb * Math.sin(tw) - rb * 0.3));
      }
      put(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 720, rb * 0.62, LITE ? 5 : 8, true), rimMat));
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(ext(1) + 0.03, 12, 8), rimMat);
    tip.position.copy(curve.getPoint(1));
    scene.add(tip);
    for (let t = 0; t <= 0.82; t += 0.06) {           // no leaves under it, up to where the tip lifts clear
      const p2 = curve.getPoint(t);
      taken.push([p2.x, p2.z, rad(t) + ext(t) + 0.15]);
    }
    for (let t = 0; t <= 1.001; t += 0.1) {
      const p2 = curve.getPoint(t);
      guard(p2.x, p2.y, p2.z, rad(t) + ext(t) + 0.15);
    }
  }

  // --- the harvest spilling out of it ---
  function apple(r, x, z) {
    const geo = new THREE.SphereGeometry(r, 40, 28);
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {               // broad shoulders, dimpled at stem and calyx
      v.fromBufferAttribute(p, i);
      const h = v.y / r, k = 1 + 0.08 * h - 0.06 * h * h;
      v.x *= k;
      v.z *= k;
      v.y = v.y * 0.9 - r * 0.22 * Math.exp(-((1 - h) ** 2) / 0.03) + r * 0.12 * Math.exp(-((1 + h) ** 2) / 0.03);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const [c, g] = makeCanvas(512, 256);
    g.scale(2, 2);                                    // drawn in 256 x 128 units
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, '#8e1414');
    grd.addColorStop(0.55, '#b0241a');
    grd.addColorStop(1, '#d8a040');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 160; i++) {                   // streaks and a sunny blush
      g.fillStyle = rand() < 0.6 ? `rgba(110,10,10,${rr(0.05, 0.18)})` : `rgba(230,170,70,${rr(0.03, 0.12)})`;
      g.fillRect(rand() * 256, rr(0, 60), rr(0.4, 1.2), rr(30, 90));
    }
    for (let i = 0; i < 140; i++) {                   // lenticels
      g.fillStyle = `rgba(255,225,170,${rr(0.2, 0.5)})`;
      g.fillRect(rand() * 256, rand() * 128, 1.2, 1.2);
    }
    const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ map: toTexture(c), roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.45 }));
    m.position.set(x, r * 0.88, z);
    m.rotation.set(rr(-0.3, 0.3), rand() * 6.3, rr(-0.3, 0.3));
    put(m);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, r * 0.55, 5), stemMat);
    st.position.set(0, r * 0.75, 0);
    st.rotation.z = rr(-0.4, 0.4);
    m.add(st);
    taken.push([x, z, r * 1.1]);
  }
  function grapes(x, z, yaw) {
    const parts = [];
    for (let i = 0; i < 30; i++) {
      const t = Math.sqrt(rand()), spread = 0.2 * (1 - t * 0.65) * Math.sqrt(rand()), a = rand() * 6.3;
      const gg = new THREE.SphereGeometry(0.085, 14, 10);
      gg.scale(1, 1, 1.12);
      gg.translate(Math.cos(a) * spread, Math.max(0.083, 0.11 + Math.sin(a) * spread), t * 0.75);
      parts.push(gg);
    }
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshPhysicalMaterial({
      color: 0x3b1a3a, roughness: 0.42, sheen: 1, sheenColor: 0x8a7a9a, sheenRoughness: 0.6,
    }));
    m.position.set(x, 0, z);
    m.rotation.y = yaw;
    put(m);
    const branch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.22, 0.02), new THREE.Vector3(0.02, 0.3, -0.08), new THREE.Vector3(-0.03, 0.33, -0.18), new THREE.Vector3(-0.07, 0.3, -0.24),
    ]), 12, 0.013, 6, false), stemMat);
    branch.castShadow = true;
    m.add(branch);
    taken.push([x + Math.sin(yaw) * 0.35, z + Math.cos(yaw) * 0.35, 0.45]);
  }
  function pearGourd(x, z, yaw) {
    const L = 0.95, pts = [];
    for (let i = 0; i <= 28; i++) {
      const s = i / 28;
      const r = (0.25 * Math.exp(-(((s - 0.28) / 0.25) ** 2)) + 0.12 * Math.exp(-(((s - 0.76) / 0.26) ** 2))) * Math.pow(Math.sin(Math.PI * s), 0.35);
      pts.push(new THREE.Vector2(Math.max(r, 0.001), s * L));
    }
    const [c, g] = makeCanvas(256, 256);              // yellow neck, green bulb with pale stripes
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#e2b22a');
    grd.addColorStop(0.52, '#d8aa28');
    grd.addColorStop(0.6, '#3c6a2a');
    grd.addColorStop(1, '#2e5222');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 8; k++) {
      g.fillStyle = 'rgba(230,220,150,.45)';
      g.fillRect(k * 32 + 12, 150, 7, 106);
    }
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), new THREE.MeshPhysicalMaterial({ map: toTexture(c), roughness: 0.4, clearcoat: 0.5 }));
    m.rotation.set(0, yaw, Math.PI / 2 - 0.12, 'YXZ');
    m.position.set(x, 0.24, z);
    put(m);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.12, 6), greenStem);
    st.position.y = L + 0.04;
    m.add(st);
    taken.push([x, z, 0.55]);
  }
  function wheat(base, dir, len) {
    const parts = [];
    const stalk = new THREE.CylinderGeometry(0.011, 0.015, len, 5);
    stalk.translate(0, len / 2, 0);
    parts.push(stalk);
    for (let i = 0; i < 20; i++) {                    // grains in two alternating rows, with awns
      const y = len + 0.02 + (i >> 1) * 0.034, side = i & 1 ? 1 : -1;
      const grain = new THREE.SphereGeometry(0.026, 6, 5);
      grain.scale(1, 1.9, 0.8);
      grain.rotateZ(side * 0.35);
      grain.translate(side * 0.022, y, 0);
      parts.push(grain);
      const awn = new THREE.CylinderGeometry(0.002, 0.003, 0.22, 3);
      awn.translate(0, 0.11, 0);
      awn.rotateZ(side * 0.28);
      awn.translate(side * 0.03, y + 0.03, 0);
      parts.push(awn);
    }
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0xd2ac62, roughness: 0.75 }));
    m.position.copy(base);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    m.castShadow = true;
    scene.add(m);
  }
  gourd('orange', 0.45, -3.95, 0.49, { tilt: 0.1, y: 0.12 });          // inside the horn, on the weave, clear of the rim
  grapes(-3.35, 1.45, 0.35);
  gourd('acorn', 0.36, -4.5, 2.05, { ribs: 8, depth: 0.2, squash: 0.95, taper: 0.5, tilt: 0.3, stemMaterial: greenStem });
  gourd('white', 0.3, -2.7, 1.65, { stemMaterial: greenStem });
  apple(0.22, -3.45, 2.3);
  apple(0.21, -4.05, 2.6);
  apple(0.2, -2.6, 2.7);
  pearGourd(5.0, -0.95, Math.PI + 0.3);
  for (let i = 0; i < 7; i++) {
    wheat(new THREE.Vector3(-4.5 + rr(-0.15, 0.15), 0.4, 0.2 + rr(-0.15, 0.15)), new THREE.Vector3(0.3 + rr(-0.25, 0.25), 1, 0.6 + rr(-0.15, 0.2)), rr(0.8, 1.2));
  }

  // --- a bundle of ornamental corn lying in front, husks peeled back ---
  {
    const KPAL = ['#5a1420', '#8e2418', '#d9a22a', '#e8dcc0', '#4a5468', '#3a1e3a', '#c8641c', '#a04a1c', '#2a2a3a'];
    const AR = 16, AL = 38;
    // Husk: papery, with fine veins running its length, a few darker flecks and
    // paler edges. Faintly lit from within, as thin dry leaf lets light through.
    const huskTex = (() => {
      const [c, g] = makeCanvas(256, 512);
      const grd = g.createLinearGradient(0, 0, 256, 0);
      grd.addColorStop(0, '#e2cfa0');
      grd.addColorStop(0.15, '#cdb27a');
      grd.addColorStop(0.5, '#c4a66c');
      grd.addColorStop(0.85, '#cdb27a');
      grd.addColorStop(1, '#e2cfa0');
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 512);
      for (let i = 0; i < 520; i++) {
        const x = rand() * 256;
        g.fillStyle = rand() < 0.6 ? `rgba(110,82,40,${rr(0.12, 0.35)})` : `rgba(245,232,200,${rr(0.15, 0.35)})`;
        g.fillRect(x, rand() * 120, rr(0.5, 1.6), rr(250, 512));
      }
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(120,70,30,${rr(0.08, 0.25)})`;
        g.beginPath();
        g.ellipse(rand() * 256, rand() * 512, rr(1, 4), rr(4, 18), 0, 0, Math.PI * 2);
        g.fill();
      }
      return c;
    })();
    const huskMap = toTexture(huskTex), huskBump = toTexture(huskTex, { color: false });
    const huskMats = [0xffffff, 0xf0e2c8, 0xe4cfa6].map((tint) => new THREE.MeshStandardMaterial({
      color: tint, map: huskMap, bumpMap: huskBump, bumpScale: 0.8, roughness: 0.85, side: THREE.DoubleSide,
      emissive: 0x3a2610, emissiveMap: huskMap, emissiveIntensity: 0.3,
    }));
    const twineMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 1 });
    const cobMat = new THREE.MeshStandardMaterial({ color: 0xcdb98a, roughness: 0.9 });
    const L = 1.7, R = 0.21, KH = R * 0.3;            // KH: a kernel's depth
    const profile = (s) => {                          // the ear's outer radius along its length
      const tip = Math.max(0, (s - 0.86) / 0.14);
      return R * (s < 0.06 ? 0.78 + 0.22 * (s / 0.06) : 1 - 0.55 * Math.pow((s - 0.06) / 0.94, 2.4)) * Math.sqrt(1 - tip * tip);
    };
    // The cob under the kernels: dark, just showing in the seams between them.
    const corePts = [new THREE.Vector2(0, 0)];
    for (let i = 0; i <= 40; i++) corePts.push(new THREE.Vector2(Math.max(profile(i / 40) - KH * 0.55, 0.001), (i / 40) * L));
    const coreGeo = new THREE.LatheGeometry(corePts, 32);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x4a2014, roughness: 0.7 });
    // One kernel: a rounded block with a domed crown (squared off from a sphere).
    const kernelGeo = new THREE.SphereGeometry(0.5, LITE ? 8 : 10, LITE ? 6 : 8);
    {
      const kp = kernelGeo.attributes.position;
      for (let i = 0; i < kp.count; i++) {
        const sq = (a) => (Math.sign(a) * Math.pow(Math.abs(a) * 2, 0.5)) / 2;
        kp.setXYZ(i, sq(kp.getX(i)), sq(kp.getY(i)), kp.getZ(i));
      }
      kernelGeo.computeVertexNormals();
    }
    const bundleGeo = (() => {
      const pts = [new THREE.Vector2(0.001, 0.02)];
      for (let i = 0; i <= 16; i++) {
        const g2 = i / 16, e = g2 * g2 * (3 - 2 * g2);
        pts.push(new THREE.Vector2(R * 0.97 + (0.07 - R * 0.97) * e, -g2 * 0.3 * 1.45));
      }
      pts.push(new THREE.Vector2(0.05, -0.47), new THREE.Vector2(0.001, -0.49));
      return new THREE.LatheGeometry(pts.reverse(), 32);
    })();
    const tipGeo = (() => {                          // from just inside the last kernels to the point
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const sj = 0.9 + (i / 14) * 0.1;
        pts.push(new THREE.Vector2(Math.max(0.001, profile(sj) - KH * 0.25), sj * L));
      }
      return new THREE.LatheGeometry(pts, 24);
    })();
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 0.85 });
    const kernelMat = new THREE.MeshPhysicalMaterial({ roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    const kx = new THREE.Vector3(), ky = new THREE.Vector3(0, 1, 0), kz = new THREE.Vector3(), km = new THREE.Matrix4(), kc = new THREE.Color();
    function ear(table) {                             // table: distance from the ear's axis down to the table
      const group = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.castShadow = core.receiveShadow = true;
      group.add(core);
      // Kernels in straight rows along the ear, each one sized to its spot.
      const bias = pick(KPAL), spots = [];
      for (let i = 0; i < AR; i++) {
        for (let j = 0; j < AL; j++) {
          const sj = (j + 0.5) / AL, r = profile(sj);
          if (r < R * 0.42) continue;               // the last stretch is bare cob (below)
          spots.push([((i + rr(-0.06, 0.06) + (j & 1) * 0.04) / AR) * Math.PI * 2, sj, r]);
        }
      }
      const kernels = new THREE.InstancedMesh(kernelGeo, kernelMat, spots.length);
      const surf = new THREE.Vector3();
      spots.forEach(([th, sj, r], n) => {
        // Sit each kernel square to the surface: on the tapering tip they lean
        // forward with it instead of standing straight out like petals.
        const slope = (profile(Math.min(1, sj + 0.01)) - profile(Math.max(0, sj - 0.01))) / (0.02 * L);
        const out = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
        kz.copy(out).add(surf.set(0, -slope, 0)).normalize();         // surface normal
        ky.copy(out).multiplyScalar(slope).add(surf.set(0, 1, 0)).normalize();   // along the surface, towards the tip
        kx.set(Math.cos(th), 0, -Math.sin(th));        // around
        const w = ((2 * Math.PI * r) / AR) * 0.92, l = (L / AL) * 0.9 * Math.min(1, 0.55 + r / R), d = KH * rr(0.9, 1.05) * Math.min(1, 0.45 + r / R);
        km.makeBasis(kx.clone().multiplyScalar(w), ky.clone().multiplyScalar(l), kz.clone().multiplyScalar(d));
        km.setPosition(out.x * (r - d / 2), sj * L, out.z * (r - d / 2));
        kernels.setMatrixAt(n, km);
        kc.set(rand() < 0.4 ? bias : pick(KPAL)).offsetHSL(rr(-0.01, 0.01), 0, rr(-0.04, 0.04));
        kernels.setColorAt(n, kc);
      });
      kernels.castShadow = kernels.receiveShadow = true;
      group.add(kernels);
      // The tip: a short rounded nub of bare cob dotted with a few small,
      // shrivelled kernels, as on real ornamental corn.
      const nub = new THREE.Mesh(tipGeo, tipMat);
      nub.castShadow = nub.receiveShadow = true;
      group.add(nub);
      const NS2 = 14, shrivel = new THREE.InstancedMesh(kernelGeo, kernelMat, NS2);
      for (let n = 0; n < NS2; n++) {
        const sj = rr(0.935, 0.975), r = profile(sj) - KH * 0.25, th = rand() * Math.PI * 2, d = KH * rr(0.35, 0.6);
        const out = new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
        kx.set(Math.cos(th), 0, -Math.sin(th));
        km.makeBasis(kx.clone().multiplyScalar(R * rr(0.12, 0.2)), new THREE.Vector3(0, R * rr(0.1, 0.16), 0), out.clone().multiplyScalar(d));
        km.setPosition(out.x * r, sj * L, out.z * r);
        shrivel.setMatrixAt(n, km);
        shrivel.setColorAt(n, kc.set(pick(KPAL)).multiplyScalar(0.8));
      }
      group.add(shrivel);
      // Under the husks, from the butt back to the tie, a solid bundle (shank and
      // the inner husks), so the gathered husks never show a hollow inside.
      const bundle = new THREE.Mesh(bundleGeo, huskMats[2]);
      bundle.castShadow = bundle.receiveShadow = true;
      group.add(bundle);
      // Husks: broad papery leaves peeled back from the butt. Each one wraps the
      // ear (it is built on a cylinder round the ear's axis, so it curves, not a
      // flat fin), gathers in a twist to the tie, then falls loose beyond it,
      // ribbed lengthwise, crinkled, its edges curling, sagging onto the table.
      // Built in the ear's frame, where +x points down at the table once the ear lies on its side.
      const NH = LITE ? 7 : 9, HL = 1.45, TIE = 0.3;
      const twist = rr(0.5, 0.9);
      for (let h = 0; h < NH; h++) {
        const a0 = (h / NH) * Math.PI * 2 + rr(-0.2, 0.2);
        const reach = rr(0.75, 1.05), sag = rr(0.25, 0.45), flare = rr(0.16, 0.3), seed = rand() * 50;
        const hg = new THREE.PlaneGeometry(1, 1, LITE ? 6 : 10, LITE ? 22 : 34);
        const hp = hg.attributes.position;
        for (let i = 0; i < hp.count; i++) {
          const x = hp.getX(i) * 2, t = 0.5 - hp.getY(i);           // x across (-1..1), t from the butt back
          const g2 = Math.min(t / TIE, 1), u = Math.max(0, (t - TIE) / (1 - TIE));
          // Distance out from the axis: hugging the ear at the butt, drawn in to the tie, loose beyond.
          const ease = g2 * g2 * (3 - 2 * g2);
          let rad = t < TIE ? R * 1.02 + (0.075 - R * 1.02) * ease + 0.03 * Math.sin(Math.PI * g2) : 0.075 + flare * Math.pow(u, 1.2);
          if (t < TIE) rad += Math.sin(Math.PI * g2) * (0.014 * Math.sin(x * 6 + seed) + 0.008 * Math.sin(t * 60 + seed * 2 + x * 3));   // crumpled where it's gathered
          // Width: wide round the butt, bunched at the tie, opening into a broad leaf that tapers to a soft point.
          const leaf = Math.sin(Math.PI * Math.min(1, 0.15 + 0.85 * Math.pow(u, 0.6))) * Math.pow(1 - u, 0.25);
          const w = t < TIE ? (2 * Math.PI * R * 0.85) / NH * (1 - 0.62 * ease) : 0.035 + 0.17 * leaf;
          // Ribs along the length, crinkles across it, edges curling outward.
          rad += 0.004 * Math.sin(x * 9 + seed) + u * (0.012 * Math.sin(t * 38 + seed + x * 2) + 0.05 * Math.pow(Math.abs(x), 3));
          const ang = a0 + twist * Math.min(t, TIE) + (x * w) / Math.max(rad, 0.06) * (t < TIE ? 1 : 1 - 0.5 * u);
          let px = rad * Math.cos(ang), pz = rad * Math.sin(ang);
          const py = -(t < TIE ? t : TIE + (t - TIE) * reach) * HL;
          px += sag * u * u;                                         // the loose ends sag towards the table
          px = Math.min(px, table - 0.008 - 0.003 * Math.abs(x));    // and come to rest on it
          hp.setXYZ(i, px, py, pz);
        }
        hg.computeVertexNormals();
        const husk = new THREE.Mesh(hg, huskMats[h % huskMats.length]);
        husk.castShadow = husk.receiveShadow = true;
        group.add(husk);
      }
      // The tie: three turns of twine round the gathered husks.
      const turns = [];
      for (let i = 0; i <= 90; i++) {
        const a = (i / 90) * Math.PI * 6;
        turns.push(new THREE.Vector3(0.095 * Math.cos(a), -TIE * HL - 0.03 + (i / 90) * 0.06, 0.095 * Math.sin(a)));
      }
      const tie = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(turns), 120, 0.013, 6, false), twineMat);
      tie.castShadow = true;
      group.add(tie);
      return group;

    }
    // Two side by side and a third resting in the groove between them.
    for (const [x, y, z, yaw] of [[-0.1, R, 2.36, 0.06], [0.05, R, 2.76, -0.05], [0.1, R * 2.75, 2.56, 0.0]]) {
      const outer = new THREE.Group();
      outer.position.set(x, y, z);
      outer.rotation.y = yaw;
      const e = ear(y);
      e.rotation.z = -Math.PI / 2;                   // tip to +x; the husks stay on the upper side
      outer.add(e);
      scene.add(outer);
    }
    taken.push([0.9, 2.56, 0.7], [-0.6, 2.56, 0.8]);
  }

  // --- out in the dusk: corn shocks and hay bales ---
  {
    const stalkTex = (() => {                         // streaks along the stalk and a couple of nodes (tinted by vertex colour)
      const [c, g] = makeCanvas(64, 256);
      g.fillStyle = '#d8d8d8';
      g.fillRect(0, 0, 64, 256);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = rand() < 0.6 ? `rgba(0,0,0,${rr(0.08, 0.25)})` : `rgba(255,255,255,${rr(0.1, 0.3)})`;
        g.fillRect(rand() * 64, 0, rr(1, 3), 256);
      }
      for (const y of [86, 172]) {
        g.fillStyle = 'rgba(60,40,20,.45)';
        g.fillRect(0, y, 64, 4);
        g.fillStyle = 'rgba(255,255,255,.3)';
        g.fillRect(0, y + 4, 64, 2);
      }
      return toTexture(c);
    })();
    const shockMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: stalkTex, roughness: 1, side: THREE.DoubleSide });
    const col = new THREE.Color();
    const tint = (geo) => {
      const n = geo.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(a, i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return geo;
    };
    function shock(x, z, H) {
      const parts = [];
      const tie = new THREE.Vector3(x, H * 0.6, z);
      const seg = (a, b, r0, r1) => {
        const geo = new THREE.CylinderGeometry(r1, r0, a.distanceTo(b), 5);
        geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
        const m = a.clone().lerp(b, 0.5);
        geo.translate(m.x, m.y, m.z);
        parts.push(tint(geo));
      };
      for (let i = 0; i < 54; i++) {
        const a = rand() * Math.PI * 2, rb = rr(0.55, 1.05);
        const base = new THREE.Vector3(x + Math.cos(a) * rb, 0, z + Math.sin(a) * rb);
        const mid = tie.clone().add(new THREE.Vector3(Math.cos(a) * 0.22, rr(-0.1, 0.1), Math.sin(a) * 0.22));
        const top = mid.clone().add(new THREE.Vector3(Math.cos(a) * rr(0.2, 0.7), H * rr(0.32, 0.45), Math.sin(a) * rr(0.2, 0.7)));
        col.setHSL(rr(0.085, 0.12), rr(0.32, 0.5), rr(0.3, 0.52));
        seg(base, mid, 0.035, 0.03);
        seg(mid, top, 0.03, 0.012);
        if (rand() < 0.7) {                           // a long leaf drooping from the upper stalk
          const at = mid.clone().lerp(top, rr(0.1, 0.6));
          const out = new THREE.Vector3(Math.cos(a + rr(-0.5, 0.5)), 0, Math.sin(a + rr(-0.5, 0.5)));
          const side = new THREE.Vector3().crossVectors(out, UP);
          const len = rr(0.9, 1.5);
          const lg = new THREE.PlaneGeometry(0.09, 1, 1, 8);
          const lp = lg.attributes.position;
          for (let k = 0; k < lp.count; k++) {
            const w = lp.getX(k), t = lp.getY(k) + 0.5;
            const q = at.clone().addScaledVector(out, t * len * 0.8).addScaledVector(side, w * (1 - t * 0.7));
            q.y += len * (0.35 * t - 0.85 * t * t);
            lp.setXYZ(k, q.x, q.y, q.z);
          }
          lg.computeVertexNormals();
          col.offsetHSL(0, 0, 0.05);
          parts.push(tint(lg));
        }
      }
      col.set(0x5a4630);
      const band = new THREE.TorusGeometry(0.3, 0.035, 6, 24);
      band.rotateX(Math.PI / 2);
      band.translate(tie.x, tie.y, tie.z);
      parts.push(tint(band));
      put(new THREE.Mesh(mergeGeometries(parts), shockMat));
      guard(x, 1.2, z, 1.3);
      guard(x, H * 0.72, z, 1.2);
    }
    shock(-8.2, -10.5, 4.4);
    shock(8.6, -11.5, 4.8);
    shock(1.8, -13.8, 4.2);

    // Hay bales: a rounded block pressed into flakes (the grooves across its
    // length), thousands of loose straws lying on it, and two loops of twine.
    const straw = (w, h, ends) => {                   // underlay, seen between the straws
      const [c, g] = makeCanvas(w, h);
      g.fillStyle = '#a8843e';
      g.fillRect(0, 0, w, h);
      const tones = ['#e8cc84', '#c9a458', '#a07a38', '#7a5a26', '#f2dc98', '#b89448'];
      for (let i = 0; i < (ends ? 5000 : 8000); i++) {
        g.strokeStyle = pick(tones);
        g.globalAlpha = rr(0.5, 0.9);
        g.lineWidth = rr(1, 2);
        const x = rand() * w, y = rand() * h, a = ends ? rand() * 6.3 : rr(-0.3, 0.3), l = ends ? rr(2, 6) : rr(10, 50);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      g.globalAlpha = 1;
      return c;
    };
    const side = straw(512, 256, false), end = straw(256, 256, true);
    const sideMat = new THREE.MeshStandardMaterial({ map: toTexture(side), bumpMap: toTexture(side, { color: false }), bumpScale: 1.2, roughness: 1 });
    const endMat = new THREE.MeshStandardMaterial({ map: toTexture(end), bumpMap: toTexture(end, { color: false }), bumpScale: 1.2, roughness: 1 });
    const BW = 2.4, BH = 1.1, BD = 1.25, BR = 0.13, FLAKE = 0.16;
    const baleGeo = (() => {
      const geo = new THREE.BoxGeometry(BW, BH, BD, LITE ? 48 : 96, 20, 22);
      const p = geo.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
      const hx = BW / 2 - BR, hy = BH / 2 - BR, hz = BD / 2 - BR;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
        d.subVectors(v, c).normalize();                // rounded edges
        const onEnd = Math.abs(d.x) > 0.7;
        const groove = 0.6 * Math.pow(Math.abs(Math.cos((Math.PI * (v.x + BW / 2)) / FLAKE)), 14);
        const lump = 0.012 * Math.sin(v.x * 37 + v.y * 11) * Math.sin(v.z * 29 + v.x * 7) + 0.006 * Math.sin(v.y * 53 + v.z * 41);
        v.copy(c).addScaledVector(d, BR + (onEnd ? lump * 1.5 : -0.035 * groove + lump));
        p.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      // The box's faces are separate grids: average normals where they meet so the rounded edges don't show a seam.
      const nrm = geo.attributes.normal, seen = new Map();
      for (let i = 0; i < p.count; i++) {
        const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push(i);
      }
      for (const list of seen.values()) {
        if (list.length < 2) continue;
        v.set(0, 0, 0);
        for (const i of list) v.x += nrm.getX(i), v.y += nrm.getY(i), v.z += nrm.getZ(i);
        v.normalize();
        for (const i of list) nrm.setXYZ(i, v.x, v.y, v.z);
      }
      return geo;
    })();
    // Twine: two loops round the bale, bedded into a groove.
    const twineGeo = (() => {                         // a superellipse hugging the rounded section
      const pts = [], a = BH / 2 + 0.014, b = BD / 2 + 0.014, e = 2 / 8;
      for (let i = 0; i < 96; i++) {
        const t = (i / 96) * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t);
        pts.push(new THREE.Vector3(0, a * Math.sign(ct) * Math.pow(Math.abs(ct), e), b * Math.sign(st) * Math.pow(Math.abs(st), e)));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.012, 6, true);
    })();
    const twineMat2 = new THREE.MeshStandardMaterial({ color: 0x6a5436, roughness: 0.9 });
    const strawGeo = new THREE.BoxGeometry(1, 0.006, 0.012);
    const strawMat = new THREE.MeshStandardMaterial({ roughness: 0.75 });
    const STRAW = ['#e8cc84', '#d9b86a', '#c9a458', '#b8924a', '#f2dc98', '#a8843e'];
    const sm = new THREE.Matrix4(), sp = new THREE.Vector3(), sd = new THREE.Vector3(), sn = new THREE.Vector3(), sw = new THREE.Vector3(), sc = new THREE.Color();
    // A straw from its direction d (along it), the surface normal n and a length.
    const lay = (d, n, len) => {
      d.normalize();
      sw.crossVectors(d, n).normalize();
      n.crossVectors(sw, d);
      sm.makeBasis(d.multiplyScalar(len), n, sw);
      sm.setPosition(sp);
    };
    const bale = (x, y, z, yaw) => {
      const m = new THREE.Mesh(baleGeo, [endMat, endMat, sideMat, sideMat, sideMat, sideMat]);
      m.position.set(x, y + BH / 2, z);
      m.rotation.y = yaw;
      for (const fx of [-0.528, 0.528]) {
        const tw = new THREE.Mesh(twineGeo, twineMat2);
        tw.position.x = fx;
        m.add(tw);
      }
      // Loose straws: lying along the length on the top and sides, short cut
      // stubs on the ends, every one a little proud of the surface.
      const count = LITE ? 350 : 900;
      const straws = new THREE.InstancedMesh(strawGeo, strawMat, count);
      for (let i = 0; i < count; i++) {
        const face = rand();
        if (face < 0.16) {                             // a cut end: short stubs, mostly poking out
          const sx = rand() < 0.5 ? -1 : 1;
          sp.set(sx * (BW / 2 + 0.01), rr(-BH / 2 + 0.1, BH / 2 - 0.08), rr(-BD / 2 + 0.08, BD / 2 - 0.08));
          lay(sd.set(sx, rr(-0.5, 0.5), rr(-0.5, 0.5)), sn.set(0, 1, 0), rr(0.03, 0.09));
        } else if (face < 0.5) {                       // the top
          const a = rr(-0.3, 0.3) + (rand() < 0.08 ? rr(-1.2, 1.2) : 0);
          sp.set(rr(-BW / 2 + 0.2, BW / 2 - 0.2), BH / 2 + 0.006, rr(-BD / 2 + 0.16, BD / 2 - 0.16));
          lay(sd.set(Math.cos(a), rr(0, 0.06), Math.sin(a)), sn.set(0, 1, 0), rr(0.08, 0.24));
        } else {                                       // the long sides
          const sz = face < 0.75 ? 1 : -1, a = rr(-0.3, 0.3) + (rand() < 0.08 ? rr(-1.2, 1.2) : 0);
          sp.set(rr(-BW / 2 + 0.2, BW / 2 - 0.2), rr(-BH / 2 + 0.16, BH / 2 - 0.16), sz * (BD / 2 + 0.006));
          lay(sd.set(Math.cos(a), Math.sin(a), sz * rr(0, 0.06)), sn.set(0, 0, sz), rr(0.08, 0.24));
        }
        straws.setMatrixAt(i, sm);
        straws.setColorAt(i, sc.set(pick(STRAW)));
      }
      straws.receiveShadow = true;
      m.add(straws);
      put(m);
      guard(x, y + BH / 2, z, 1.5);
    };
    bale(-4.5, 0, -7.6, 0.08);
    bale(-4.2, 0, -8.95, -0.05);
    bale(-4.3, BH, -8.25, 0.2);
    bale(6.6, 0, -7.4, -0.45);
    gourd('orange', 0.55, 6.6, -7.4, { y: BH });
    gourd('orange', 0.75, -6.6, -9.4);
    gourd('rouge', 0.8, 7.4, -9.9, { squash: 0.6, depth: 0.12 });
    gourd('white', 0.5, 3.4, -12.2);
    taken.push([-4.35, -8.25, 1.7], [6.6, -7.4, 1.4], [-8.2, -10.5, 1.3], [8.6, -11.5, 1.3], [1.8, -13.8, 1.3]);
  }

  // --- the last of the sunset low behind the set (seen when looking up and out) ---
  {
    // A round gradient that reaches zero well inside the canvas (no hard edges),
    // stretched wide by the plane; its lower half sinks below the far floor.
    // Opaque colour on black, added (see the moon glow: a transparent canvas speckles in Safari).
    const [c, g] = makeCanvas(512, 512);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 512, 512);
    const grd = g.createRadialGradient(256, 256, 0, 256, 256, 250);
    grd.addColorStop(0, 'rgb(153,114,66)');
    grd.addColorStop(0.35, 'rgb(77,45,29)');
    grd.addColorStop(0.7, 'rgb(18,9,7)');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(76, 40), new THREE.MeshBasicMaterial({
      map: toTexture(c), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    }));
    sky.position.set(8, 0, -46);                       // corners stay ~66 from the centre, inside the dome
    sky.userData.bloomHide = true;
    scene.add(sky);
  }

  // --- leaves: maple, oak and birch, cupped as they dry ---
  function leafCanvas(kind, inner, outer) {
    const [c, g] = makeCanvas(256, 256);
    g.scale(2, 2);                                    // drawn in 128 x 128 units
    const path = new Path2D();
    const cx = 64, cy = 60;
    if (kind === 'maple') {
      for (let i = 0; i <= 240; i++) {
        const a = (i / 240) * Math.PI * 2;
        const lobes = Math.pow(Math.abs(Math.cos(2.5 * (a + Math.PI / 2))), 2);
        const low = Math.sin(a) > 0 ? 1 - 0.4 * Math.sin(a) : 1;
        const r = 54 * (0.38 + 0.62 * lobes) * low * (1 + 0.07 * Math.abs(Math.sin(a * 24)) * lobes);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i ? path.lineTo(x, y) : path.moveTo(x, y);
      }
    } else if (kind === 'oak') {
      const edge = (t, ph) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.8) * 30 * (0.5 + 0.5 * Math.pow(Math.abs(Math.sin(t * Math.PI * 4.5 + ph)), 0.6));
      for (let i = 0; i <= 60; i++) path[i ? 'lineTo' : 'moveTo'](cx + edge(i / 60, 0), 8 + (i / 60) * 100);
      for (let i = 60; i >= 0; i--) path.lineTo(cx - edge(i / 60, 0.5), 8 + (i / 60) * 100);
    } else {
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * Math.PI * 2, s = Math.sin(a);
        const r = 1 + 0.04 * Math.abs(Math.sin(a * 30));
        const x = cx + Math.cos(a) * 32 * r * (s < 0 ? 1 - 0.55 * Math.pow(-s, 3) : 1), y = 62 + s * 46 * r;
        i ? path.lineTo(x, y) : path.moveTo(x, y);
      }
    }
    path.closePath();
    g.save();
    g.clip(path);
    const grd = g.createRadialGradient(cx, cy + 10, 4, cx, cy, 62);
    grd.addColorStop(0, inner);
    grd.addColorStop(1, outer);
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) {                    // blemishes
      g.fillStyle = `rgba(70,25,5,${rr(0.04, 0.16)})`;
      g.beginPath();
      g.arc(rand() * 128, rand() * 128, rr(1, 6), 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(255,230,170,.35)';          // veins
    g.lineWidth = 1.2;
    g.beginPath();
    if (kind === 'maple') {
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k * Math.PI * 2) / 5, l = k === 2 || k === 3 ? 30 : 48;
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
      }
    } else {
      const top = kind === 'oak' ? 8 : 16, bottom = 108;
      g.moveTo(cx, top);
      g.lineTo(cx, bottom);
      for (let y = top + 14; y < bottom - 6; y += 14) {
        g.moveTo(cx, y + 8);
        g.lineTo(cx - 22, y);
        g.moveTo(cx, y + 8);
        g.lineTo(cx + 22, y);
      }
    }
    g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(70,35,12,.9)';              // stalk
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(cx, kind === 'maple' ? cy : 106);
    g.lineTo(cx + 3, 127);
    g.stroke();
    return c;
  }
  const leafGeo = new THREE.PlaneGeometry(0.55, 0.55, 4, 4);
  {
    const lp = leafGeo.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i) / 0.275, y = lp.getY(i) / 0.275;
      lp.setZ(i, 0.06 * (x * x + y * y) + 0.02 * x * y + 0.045 * Math.abs(x));   // cupped, and folded along the midrib
    }
    leafGeo.computeVertexNormals();
  }
  const leafMats = [
    ['maple', '#e8a030', '#b0201a'], ['maple', '#f0c040', '#d8601a'], ['maple', '#f2d468', '#d8a020'],
    ['oak', '#a8703a', '#6e4020'], ['oak', '#c07030', '#8a3414'], ['birch', '#f0d050', '#c8a020'],
  ].map(([kind, a, b]) => new THREE.MeshStandardMaterial({ map: toTexture(leafCanvas(kind, a, b)), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 }));
  const mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), eul = new THREE.Euler(0, 0, 0, 'YXZ'), at = new THREE.Vector3(), scl = new THREE.Vector3();
  for (const mat of leafMats) {
    const count = 16;
    const leaves = new THREE.InstancedMesh(leafGeo, mat, count);
    for (let i = 0; i < count; i++) {
      let x, z;
      do { x = rr(-7, 7); z = rr(-6.5, 3.2); } while (!free(x, z, 0.15));
      eul.set(-Math.PI / 2 + rr(-0.15, 0.15) + (rand() < 0.25 ? Math.PI : 0), rand() * 6.3, rand() * 6.3);
      const s = rr(0.7, 1.3);
      mtx.compose(at.set(x, 0.012 + rand() * 0.02, z), quat.setFromEuler(eul), scl.set(s, s, s));
      leaves.setMatrixAt(i, mtx);
    }
    leaves.userData.bloomHide = true;
    leaves.userData.noAO = true;                    // alpha cut-out: keep it out of the AO pass
    put(leaves);
  }

  // A few drift down, tumbling, settle a while, then go and fall again. They
  // cast no shadow: the shadow map is only redrawn when the device moves.
  const fallers = [];
  const spawn = (f, high) => {
    let x, z;
    do { x = rr(-9, 9); z = rr(-12, 2.8); } while (!free(x, z, 0.9));
    Object.assign(f, {
      x0: x, z0: z, y: high ? rr(6, 9) : rr(0.5, 9), vy: rr(0.35, 0.6), amp: rr(0.3, 0.8), fq: rr(0.6, 1.2), ph: rand() * 6.3,
      spin: rr(-1.5, 1.5), yaw: rand() * 6.3, size: rr(0.8, 1.2), state: 'fall', rest: 0, shrink: 1,
    });
  };
  const fallMeshes = leafMats.slice(0, 4).map((mat) => {
    const m = new THREE.InstancedMesh(leafGeo, mat, 4);
    m.frustumCulled = false;                          // they move, so the bounds computed at load would be wrong
    m.userData.bloomHide = true;
    m.userData.noAO = true;
    scene.add(m);
    for (let i = 0; i < 4; i++) {
      const f = { mesh: m, i };
      spawn(f, false);
      fallers.push(f);
    }
    return m;
  });

  const away = new THREE.Vector3();
  let lastT = null;
  return function update(t) {
    const dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    // Nudge the camera back out of any prop it has been orbited into; the orbit
    // controls take up the new position on their next update.
    for (const [c, r] of keepOut) {
      away.subVectors(camera.position, c);
      const d = away.length();
      if (d < r && d > 1e-6) camera.position.copy(c).addScaledVector(away, r / d);
    }
    for (const l of flames) {
      // Candle flicker: a few incommensurate wobbles, the flame stretching as it brightens.
      const k = 0.85 + 0.08 * Math.sin(t * 8.1 + l.phase) + 0.05 * Math.sin(t * 13.7 + l.phase * 2) + 0.03 * Math.sin(t * 27.3 + l.phase * 3);
      l.flame.scale.set(1, 0.85 + 0.3 * k, 1);
      l.flame.rotation.z = 0.06 * Math.sin(t * 2.3 + l.phase);
      l.bloomMat.color.setRGB(1, 0.6, 0.25).multiplyScalar(1.4 * k);
      l.light.intensity = 1.4 * k;
      l.waxMat.emissiveIntensity = 0.7 * k;
    }
    for (const f of fallers) {
      let x, z;
      if (f.state === 'fall') {
        f.y -= f.vy * dt;
        x = f.x0 + f.amp * Math.sin(t * f.fq + f.ph);
        z = f.z0 + f.amp * 0.6 * Math.cos(t * f.fq * 0.8 + f.ph);
        eul.set(-Math.PI / 2 + 0.9 * Math.sin(t * f.fq * 1.3 + f.ph), f.yaw + f.spin * t, 0.6 * Math.cos(t * f.fq + f.ph));
        if (f.y <= 0.02) {
          Object.assign(f, { state: 'rest', rest: rr(5, 12), x0: x, z0: z, y: 0.015, landYaw: f.yaw + f.spin * t });
        }
      }
      if (f.state !== 'fall') {
        x = f.x0;
        z = f.z0;
        eul.set(-Math.PI / 2, f.landYaw, 0);
        if (f.state === 'rest' && (f.rest -= dt) <= 0) f.state = 'go';
        if (f.state === 'go' && (f.shrink -= dt / 1.2) <= 0) {
          spawn(f, true);
          x = f.x0;
          z = f.z0;
        }
      }
      const s = f.size * (f.state === 'go' ? Math.max(0, f.shrink) : 1);
      mtx.compose(at.set(x, f.y, z), quat.setFromEuler(eul), scl.set(s, s, s));
      f.mesh.setMatrixAt(f.i, mtx);
    }
    for (const m of fallMeshes) m.instanceMatrix.needsUpdate = true;
  };
}
