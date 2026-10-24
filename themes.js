import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Monthly backdrops. index.html picks the theme (from ?theme= or the month) and
// sets window.__theme before anything loads, so the loader and overlays match.
// Months without their own theme use the studio set.
export const THEME = window.__theme || 'studio';

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
};

export function themeConfig() {
  return CONFIGS[THEME] || CONFIGS.studio;
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
  return THEME === 'halloween' ? halloween(ctx) : null;
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
  function pumpkinGeometry(r) {
    const geo = new THREE.SphereGeometry(r, 72, 40);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const h = v.y / r;
      const phi = Math.atan2(v.z, v.x);
      const lobe = 0.92 + 0.08 * Math.pow(Math.abs(Math.sin(phi * 5)), 0.55);   // ten lobes
      const k = 1 - (1 - lobe) * (1 - h * h);
      v.x *= k;
      v.z *= k;
      v.y = v.y * 0.78 - r * 0.16 * Math.exp(-((1 - h) ** 2) / 0.02) + r * 0.06 * Math.exp(-((1 + h) ** 2) / 0.02);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
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
    const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grd.addColorStop(0, 'rgba(220,225,255,.5)');
    grd.addColorStop(1, 'rgba(220,225,255,0)');
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
