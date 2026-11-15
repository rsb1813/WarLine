// render-viewmodel: barrel, muzzle devices, sights/optics and underbarrel attachments.
import * as THREE from 'three';
import { GunCtx, handAnchor, has } from './vm-gunparts';
import { rrect, circlePts, shellZ, hollowZ, planeGeo, circleGeo, torusGeo } from './vm-geo';
import { barrelMods, supportHand } from './vm-bodies';
import * as M from './vm-mats';

// ───────────────────────── barrel ─────────────────────────

export function buildBarrel(c: GunCtx): void {
  const L = c.L, k = c.k, m = c.m, P = c.root;
  if (L.pistol || L.barLen <= 0) return;
  const bm = barrelMods(c);
  const taper = (c.ud.barTaper as number | undefined) ?? 0.97;
  const z0 = L.barZ0 + 0.012, z1 = L.muzzleZ;
  k.tubeZ(P, L.barR, L.barR * taper, z0, z1, m.steel, 0, L.boreY, 20);
  const len = z0 - z1;
  if ((bm.fluted || c.ud.flutes) && len > 0.06) {
    const rMid = L.barR * (1 + taper) / 2;
    const fz0 = z1 + len * 0.12, fz1 = z0 - len * 0.12;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + Math.PI / 6;
      const b = k.box(P, 0.0014, L.barR * 0.34, fz1 - fz0, m.hole, Math.cos(a) * rMid * 0.97, L.boreY + Math.sin(a) * rMid * 0.97, (fz0 + fz1) / 2);
      b.rotation.z = a;
    }
  }
  if (bm.heavy && len > 0.05) {
    // barrel collar + gas block look on heavy barrels
    k.tubeZ(P, L.barR * 1.18, L.barR * 1.18, z0 - 0.03, z0 - 0.012, m.dark, 0, L.boreY, 18);
  }
  if (bm.match) k.tubeZ(P, L.barR * 1.08, L.barR * 1.08, z1 + 0.018, z1 + 0.024, m.accent, 0, L.boreY, 18);
}

// ───────────────────────── muzzle ─────────────────────────

export function buildMuzzle(c: GunCtx): void {
  const L = c.L, k = c.k, m = c.m, P = c.root;
  const a = c.att.muzzle; const id = a?.id ?? '';
  const z = L.muzzleZ, y = L.boreY, r = L.barR;
  const col = a?.model?.color ? M.metal(a.model.color, 0.5, 0.55) : m.dark;
  let tip = z;
  if (a?.suppressed) {
    const heavy = has(id, 'heavy', 'linear');
    let len = a.model?.len ?? (heavy ? 0.22 : 0.16);
    let R = (a.model?.size ?? (heavy ? 0.04 : 0.032)) / 2;
    if (L.pistol) { len *= 0.85; R *= 0.88; }
    const zr = z + (L.pistol ? 0.0 : 0.004);
    if (L.pistol) k.tubeZ(P, r * 1.05, r * 1.05, z - 0.008, z + 0.004, m.steel, 0, y, 14);   // threaded barrel
    k.tubeZ(P, R * 0.72, R, zr, zr - 0.02, col, 0, y, 22);                                   // rear taper
    k.tubeZ(P, R, R, zr - 0.02, zr - len + 0.01, col, 0, y, 22);
    k.tubeZ(P, R, R * 0.86, zr - len + 0.01, zr - len, col, 0, y, 22);
    for (let i = 0; i < 6; i++) k.tubeZ(P, R * 1.035, R * 1.035, zr - 0.024 - i * 0.0055, zr - 0.027 - i * 0.0055, m.dark, 0, y, 22);
    if (heavy) for (let zz = zr - 0.07; zz > zr - len + 0.03; zz -= 0.03) k.tubeZ(P, R * 1.03, R * 1.03, zz, zz - 0.004, col, 0, y, 22);
    k.tubeZ(P, R * 0.87, R * 0.87, zr - len, zr - len - 0.003, m.dark, 0, y, 18);
    tip = zr - len - 0.003;
  } else if (L.pistol && has(id, 'comp')) {
    k.box(P, 0.026, 0.03, 0.03, col, 0, y - 0.004, z - 0.013, 0.003);
    for (let i = 0; i < 3; i++) k.box(P, 0.007, 0.0012, 0.0045, m.hole, 0, y - 0.004 + 0.0152, z - 0.006 - i * 0.008);
    tip = z - 0.028;
  } else if (has(id, 'flash')) {
    const len = a?.model?.len ?? 0.05, R = Math.max(r * 1.45, 0.0115);
    k.tubeZ(P, R, R, z + 0.002, z - 0.016, col, 0, y, 18);
    k.tubeZ(P, R * 0.6, R * 0.6, z - 0.016, z - len + 0.002, m.hole, 0, y, 12);
    for (let i = 0; i < 3; i++) {
      const an = Math.PI / 2 + i * Math.PI * 2 / 3;
      const p = k.box(P, R * 0.72, 0.005, len - 0.016, col, Math.cos(an) * R * 0.66, y + Math.sin(an) * R * 0.66, z - 0.016 - (len - 0.016) / 2, 0.0012);
      p.rotation.z = an;
    }
    tip = z - len;
  } else if (has(id, 'comp')) {
    const len = a?.model?.len ?? 0.06, R = Math.max(r * 1.55, (a?.model?.size ?? 0.026) / 2);
    k.tubeZ(P, R, R, z + 0.002, z - len + 0.008, col, 0, y, 20);
    k.tubeZ(P, R, R * 0.74, z - len + 0.008, z - len, col, 0, y, 20);
    for (let i = 0; i < 3; i++) k.box(P, R * 0.7, 0.0012, 0.006, m.hole, 0, y + R + 0.0001, z - 0.014 - i * 0.012);
    for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) k.box(P, 0.0012, R * 0.9, 0.007, m.hole, sx * (R + 0.0001), y, z - 0.02 - i * 0.014);
    tip = z - len;
  } else if (has(id, 'brake')) {
    const len = a?.model?.len ?? 0.07, W = a?.model?.size ?? 0.03, H = W * 0.82;
    k.box(P, W, H, 0.018, col, 0, y, z - 0.008, 0.003);
    k.box(P, W, H, 0.009, col, 0, y, z - 0.034, 0.002);
    k.box(P, W, H, 0.012, col, 0, y, z - len + 0.006, 0.003);
    k.box(P, W * 0.62, 0.0045, len, col, 0, y + H / 2 - 0.0022, z - len / 2, 0.0012);
    k.box(P, W * 0.62, 0.0045, len, col, 0, y - H / 2 + 0.0022, z - len / 2, 0.0012);
    k.tubeZ(P, r * 0.85, r * 0.85, z - 0.016, z - len + 0.012, m.hole, 0, y, 12);
    for (let i = 0; i < 2; i++) k.box(P, 0.0012, 0.002, 0.006, m.hole, 0, y + H / 2 + 0.0001, z - 0.006 - i * 0.008);
    tip = z - len;
  } else if (has(id, 'choke')) {
    const len = a?.model?.len ?? 0.05, R = Math.max(r * 1.22, (a?.model?.size ?? 0.03) / 2);
    k.tubeZ(P, R, R, z + 0.002, z - len, col, 0, y, 20);
    for (let i = 0; i < 6; i++) {
      const an = i * Math.PI / 3;
      const s = k.box(P, 0.0012, 0.004, 0.018, m.hole, Math.cos(an) * (R + 0.0001), y + Math.sin(an) * (R + 0.0001), z - len + 0.014);
      s.rotation.z = an;
    }
    k.tubeZ(P, R * 1.04, R * 1.04, z - 0.006, z - 0.012, m.accent, 0, y, 20);
    tip = z - len;
  } else if (!L.pistol) {
    // bare crown / thread protector
    k.tubeZ(P, r * 1.08, r * 1.08, z + 0.002, z - 0.012, m.dark, 0, y, 16);
    tip = z - 0.012;
  }
  // bore
  k.mesh(P, circleGeo(Math.min(r * 0.62, 0.007), 14), m.hole, 0, y, tip - 0.0004, 0, Math.PI, 0);
  const mz = new THREE.Object3D(); mz.name = 'muzzle'; mz.position.set(0, y, tip - 0.003);
  P.add(mz);
  c.ud.muzzle = mz;
  c.ud.suppressed = !!a?.suppressed;
}

// ───────────────────────── sights & optics ─────────────────────────

type OpticType = 'iron' | 'reflex' | 'tube' | 'holo' | 'prism' | 'acog' | 'scope';

export function opticType(c: GunCtx): OpticType {
  const a = c.att.optic;
  if (!a || a.reticle === 'iron' || (!a.reticle && (a.zoom ?? 1) <= 1)) return 'iron';
  if (c.L.pistol) return 'reflex';
  const zoom = a.zoom ?? 1;
  if (a.reticle === 'holo') return 'holo';
  if (a.reticle === 'dot' && zoom < 1.4) return (a.model?.len ?? 0.06) <= 0.06 ? 'reflex' : 'tube';
  if (zoom < 3) return 'prism';
  if (has(a.id, 'acog') || (zoom < 5 && (a.model?.len ?? 0.15) <= 0.15)) return 'acog';
  return 'scope';
}

function retColor(c: GunCtx): number {
  const id = c.att.optic?.id ?? '';
  return has(id, 'green') ? 0x4dff6a : 0xff2a1c;
}

/** additive reticle sprite plane facing the eye (+Z) */
function reticlePlane(c: GunCtx, P: THREE.Object3D, kind: string, size: number, x: number, y: number, z: number, color = retColor(c)): void {
  const mat = M.additive(color, M.reticleTex(kind), 'ret:' + kind);
  const mesh = c.k.mesh(P, planeGeo(size, size), mat, x, y, z);
  mesh.renderOrder = 12;
  mesh.userData.keep = true;
}
function glassPlane(c: GunCtx, P: THREE.Object3D, w: number, h: number, x: number, y: number, z: number, tint = 0x2a4a66, op = 0.28): void {
  const mesh = c.k.mesh(P, planeGeo(w, h), M.glass(tint, op), x, y, z);
  mesh.renderOrder = 8;
}
function glassDisc(c: GunCtx, P: THREE.Object3D, r: number, y: number, z: number, tint = 0x2a4a66, op = 0.28): void {
  const mesh = c.k.mesh(P, circleGeo(r, 24), M.glass(tint, op), 0, y, z);
  mesh.renderOrder = 8;
}

/** picatinny clamp block under an optic */
function clamp(c: GunCtx, P: THREE.Object3D, b: number, z: number, w = 0.03, d = 0.02, h = 0.008): void {
  c.k.box(P, w, h, d, c.m.dark, 0, b + h / 2, z, 0.0015);
  c.k.tubeX(P, 0.0045, 0.006, c.m.dark, w / 2 + 0.002, b + h * 0.45, z, 10);
}

export function buildOptic(c: GunCtx): void {
  const L = c.L, k = c.k, m = c.m;
  const a = c.att.optic;
  const type = opticType(c);
  const og = new THREE.Group(); og.name = 'optic';
  c.root.add(og);
  const b = L.railY, oz = L.opticZ;
  let sightY = b + 0.028, sightZ = L.rearIronZ, eye = 0.085;
  const zoom = a?.zoom ?? 1;
  const reticle = a?.reticle ?? 'iron';
  const housing = a?.model?.color ? M.metal(a.model.color, 0.5, 0.45) : m.dark;
  let span: [number, number] = [oz, oz];

  if (type === 'iron') {
    const r = irons(c, og);
    sightY = r.y; sightZ = r.z; eye = r.eye;
  } else if (type === 'reflex') {
    const baseTop = L.pistol ? b : b + 0.012;
    if (!L.pistol) { k.box(og, 0.024, 0.012, 0.032, m.dark, 0, b + 0.006, oz, 0.002); clamp(c, og, b, oz, 0.028, 0.03, 0.004); }
    const wy = baseTop + 0.019;
    k.box(og, 0.024, 0.008, 0.042, housing, 0, baseTop + 0.004, oz, 0.0025);
    k.front(og, rrect(0, wy, 0.027, 0.022, 0.006), 0.007, housing, oz - 0.0125, 0.001, [rrect(0, wy, 0.021, 0.016, 0.004)]);
    for (const sx of [-1, 1]) {
      const cheek = k.box(og, 0.003, 0.01, 0.022, housing, sx * 0.0115, baseTop + 0.011, oz - 0.002, 0.001);
      cheek.rotation.x = 0.35;
    }
    k.box(og, 0.012, 0.005, 0.01, housing, 0, baseTop + 0.0105, oz + 0.012, 0.0015);
    for (const sx of [-1, 1]) k.box(og, 0.002, 0.004, 0.006, m.rubber, sx * 0.0125, baseTop + 0.004, oz + 0.008, 0.0006);
    glassPlane(c, og, 0.021, 0.016, 0, wy, oz - 0.0126, 0x6a3a20, 0.18);
    reticlePlane(c, og, 'dot', 0.012, 0, wy, oz - 0.0114);
    sightY = wy; sightZ = oz + 0.021; eye = L.pistol ? 0.22 : 0.13;
    span = [oz - 0.022, oz + 0.022];
  } else if (type === 'tube') {
    k.box(og, 0.026, 0.016, 0.034, m.dark, 0, b + 0.008, oz, 0.002);
    k.box(og, 0.006, 0.01, 0.018, m.dark, 0.016, b + 0.007, oz, 0.002);
    const ty = b + 0.016 + 0.0168;
    k.mesh(og, hollowZ(0.0172, 0.0146, oz - 0.036, oz + 0.036), housing, 0, ty, 0);
    k.mesh(og, hollowZ(0.0184, 0.0148, oz - 0.04, oz - 0.03), m.rubber, 0, ty, 0);
    k.mesh(og, hollowZ(0.0184, 0.0148, oz + 0.03, oz + 0.04), m.rubber, 0, ty, 0);
    k.front(og, rrect(0, ty, 0.028, 0.026, 0.006), 0.026, housing, oz + 0.002, 0.001, [circlePts(0, ty, 0.0148, 20)]);
    k.tubeY(og, 0.0068, 0.0068, 0.009, housing, 0, ty + 0.0175, oz + 0.002, 14);
    k.tubeX(og, 0.0068, 0.009, housing, 0.0185, ty, oz + 0.002, 14);
    k.tubeX(og, 0.0075, 0.01, m.accent, -0.019, ty, oz + 0.002, 14);
    glassDisc(c, og, 0.0146, ty, oz - 0.031, 0x5a3a26, 0.22);
    reticlePlane(c, og, 'dot', 0.011, 0, ty, oz - 0.0295);
    glassDisc(c, og, 0.0146, ty, oz + 0.033, 0x2a4a66, 0.12);
    // flipped-up front lens cap
    const cap = k.mesh(og, new THREE.CylinderGeometry(0.0175, 0.0175, 0.003, 18), m.rubber, 0, ty + 0.03, oz - 0.04);
    cap.rotation.x = 0.25;
    sightY = ty; sightZ = oz + 0.04; eye = 0.11;
    span = [oz - 0.04, oz + 0.04];
  } else if (type === 'holo') {
    clamp(c, og, b, oz + 0.01, 0.034, 0.04, 0.004);
    k.box(og, 0.033, 0.014, 0.088, m.polyDark, 0, b + 0.007, oz, 0.003);
    const wy = b + 0.014 + 0.0165;
    k.front(og, rrect(0, wy, 0.036, 0.033, 0.006), 0.05, housing, oz - 0.016, 0.0015, [rrect(0, wy, 0.028, 0.024, 0.003)]);
    k.front(og, rrect(0, wy, 0.034, 0.031, 0.005), 0.006, housing, oz + 0.036, 0.001, [rrect(0, wy, 0.028, 0.024, 0.003)]);
    for (const sx of [-1, 1]) k.box(og, 0.007, 0.005, 0.004, m.rubber, sx * 0.008, b + 0.008, oz + 0.045, 0.001);
    k.box(og, 0.008, 0.012, 0.02, m.dark, 0.02, b + 0.006, oz + 0.012, 0.002);
    k.tubeX(og, 0.004, 0.004, m.accent, -0.0185, b + 0.008, oz - 0.02, 8);
    glassPlane(c, og, 0.028, 0.024, 0, wy, oz - 0.04, 0x5a4a2a, 0.2);
    glassPlane(c, og, 0.028, 0.024, 0, wy, oz + 0.035, 0x2a4a66, 0.1);
    reticlePlane(c, og, 'holo', 0.022, 0, wy, oz - 0.0385);
    sightY = wy; sightZ = oz + 0.044; eye = 0.11;
    span = [oz - 0.044, oz + 0.044];
  } else if (type === 'prism') {
    const len = (a?.model?.len ?? 0.1) / 0.1;
    const by = b + 0.008 + 0.017;
    clamp(c, og, b, oz, 0.03, 0.05, 0.008);
    k.front(og, rrect(0, by, 0.034, 0.034, 0.006), 0.055, housing, oz, 0.0015, [circlePts(0, by, 0.0125, 20)]);
    const o0 = oz - 0.027 - 0.033 * len;
    k.mesh(og, shellZ([[0.0178, o0], [0.0178, oz - 0.025]], [[0.0153, o0], [0.0153, oz - 0.025]]), housing, 0, by, 0);
    k.mesh(og, shellZ([[0.0166, oz + 0.026], [0.0172, oz + 0.048]], [[0.0134, oz + 0.026], [0.0136, oz + 0.048]]), housing, 0, by, 0);
    k.mesh(og, hollowZ(0.0182, 0.0139, oz + 0.043, oz + 0.053), m.rubber, 0, by, 0);
    k.tubeY(og, 0.0068, 0.0068, 0.008, m.accent, 0.005, by + 0.021, oz - 0.006, 14);
    k.tubeX(og, 0.0065, 0.008, housing, 0.021, by - 0.004, oz + 0.004, 14);
    glassDisc(c, og, 0.0153, by, o0 + 0.004, 0x2a4a66, 0.3);
    glassDisc(c, og, 0.0134, by, oz + 0.046, 0x2a4a66, 0.12);
    reticlePlane(c, og, reticle === 'dot' ? 'dot' : reticle === 'cross' ? 'cross' : 'chevron', 0.02, 0, by, oz + 0.0285);
    sightY = by; sightZ = oz + 0.053; eye = 0.085;
    span = [o0, oz + 0.053];
  } else if (type === 'acog') {
    const by = b + 0.03;
    clamp(c, og, b, oz, 0.032, 0.06, 0.01);
    for (const z of [oz - 0.018, oz + 0.018]) k.tubeX(og, 0.0055, 0.012, m.steel, -0.022, b + 0.005, z, 10);
    k.front(og, [[-0.018, b + 0.01], [0.018, b + 0.01], [0.0145, b + 0.049], [-0.0145, b + 0.049]], 0.08, housing, oz, 0.002, [circlePts(0, by, 0.0122, 20)]);
    k.mesh(og, shellZ([[0.0215, oz - 0.088], [0.0215, oz - 0.048], [0.0175, oz - 0.04]], [[0.0188, oz - 0.088], [0.0188, oz - 0.048], [0.0125, oz - 0.04]]), housing, 0, by, 0);
    k.mesh(og, hollowZ(0.0222, 0.0188, oz - 0.09, oz - 0.082), m.rubber, 0, by, 0);
    k.mesh(og, shellZ([[0.0152, oz + 0.04], [0.0158, oz + 0.068]], [[0.0124, oz + 0.04], [0.0126, oz + 0.068]]), housing, 0, by, 0);
    k.box(og, 0.006, 0.003, 0.05, M.glow(0xff3b2b, 1.1), 0, b + 0.0505, oz - 0.005, 0.001);
    glassDisc(c, og, 0.0188, by, oz - 0.084, 0x0d1a2a, 0.7);
    glassDisc(c, og, 0.0124, by, oz + 0.066, 0x2a4a66, 0.14);
    reticlePlane(c, og, 'chevron', 0.018, 0, by, oz + 0.041, 0xff3b2b);
    sightY = by; sightZ = oz + 0.068; eye = 0.075;
    span = [oz - 0.09, oz + 0.068];
  } else {
    // long scope
    const len = Math.max(0.18, a?.model?.len ?? 0.3), size = Math.max(0.04, a?.model?.size ?? 0.06);
    const objR = size / 2;
    const ty = b + objR + 0.0065;
    const tubeLen = len * 0.5, tz0 = oz - tubeLen / 2, tz1 = oz + tubeLen / 2;
    const bell = len * 0.22;
    const ob0 = tz0 - bell, ob1 = tz0 - bell * 0.45;
    k.mesh(og, hollowZ(0.015, 0.0135, tz0, tz1, 28), housing, 0, ty, 0);
    k.mesh(og, shellZ([[objR, ob0], [objR, ob1], [0.0152, tz0 + 0.002]], [[objR - 0.0026, ob0], [objR - 0.0026, ob1], [0.0136, tz0 + 0.002]], 30), housing, 0, ty, 0);
    k.mesh(og, hollowZ(objR + 0.0008, objR - 0.002, ob0 - 0.003, ob0 + 0.008, 30), m.rubber, 0, ty, 0);
    if (zoom >= 8) k.mesh(og, hollowZ(objR + 0.0003, objR - 0.0022, ob0 - 0.05, ob0 - 0.002, 30), housing, 0, ty, 0);
    k.mesh(og, shellZ([[0.0152, tz1 - 0.002], [0.019, tz1 + 0.02], [0.0195, tz1 + 0.066]], [[0.0136, tz1 - 0.002], [0.0168, tz1 + 0.02], [0.0168, tz1 + 0.066]], 28), housing, 0, ty, 0);
    k.mesh(og, hollowZ(0.0208, 0.0168, tz1 + 0.062, tz1 + 0.075, 28), m.rubber, 0, ty, 0);
    for (let i = 0; i < 5; i++) k.mesh(og, hollowZ(0.0201, 0.0168, tz1 + 0.026 + i * 0.005, tz1 + 0.028 + i * 0.005, 24), m.dark, 0, ty, 0);
    k.box(og, 0.003, 0.004, 0.008, m.accent, 0, ty + 0.0198, tz1 + 0.032, 0.001);     // power lever
    // turret saddle + turrets
    k.front(og, rrect(0, ty, 0.034, 0.034, 0.007), 0.05, housing, oz, 0.0015, [circlePts(0, ty, 0.0137, 22)]);
    const knurl = (x: number, y: number, z: number, axis: 'y' | 'x', R: number, h: number) => {
      for (let i = 0; i < 14; i++) {
        const an = i * Math.PI * 2 / 14;
        const bx = axis === 'y'
          ? k.box(og, 0.0016, h * 0.8, 0.0016, m.dark, x + Math.cos(an) * R, y, z + Math.sin(an) * R)
          : k.box(og, h * 0.8, 0.0016, 0.0016, m.dark, x, y + Math.cos(an) * R, z + Math.sin(an) * R);
        void bx;
      }
    };
    k.tubeY(og, 0.0122, 0.0122, 0.02, housing, 0, ty + 0.017 + 0.01, oz, 20);
    k.tubeY(og, 0.0124, 0.0124, 0.003, m.accent, 0, ty + 0.017 + 0.0185, oz, 20);
    knurl(0, ty + 0.017 + 0.009, oz, 'y', 0.0122, 0.012);
    k.tubeX(og, 0.0112, 0.018, housing, 0.017 + 0.009, ty, oz, 20);
    knurl(0.017 + 0.009, ty, oz, 'x', 0.0112, 0.01);
    k.tubeX(og, 0.0115, 0.013, housing, -0.017 - 0.0065, ty, oz, 20);
    k.tubeX(og, 0.0075, 0.004, m.accent, -0.017 - 0.015, ty, oz, 14);
    // rings
    for (const rz of [oz - tubeLen * 0.36, oz + tubeLen * 0.36]) {
      k.mesh(og, hollowZ(0.0195, 0.0151, rz - 0.0065, rz + 0.0065, 24), m.dark, 0, ty, 0);
      const hb = ty - 0.0185 - b;
      if (hb > 0.002) k.box(og, 0.014, hb, 0.013, m.dark, 0, b + hb / 2 + 0.001, rz, 0.0015);
      clamp(c, og, b, rz, 0.03, 0.02, 0.006);
      for (const sx of [-1, 1]) k.tubeY(og, 0.0022, 0.0022, 0.005, m.steel, sx * 0.012, ty + 0.016, rz, 8);
    }
    glassDisc(c, og, objR - 0.0026, ty, ob0 + 0.004, 0x0b1626, 0.88);
    glassDisc(c, og, 0.0168, ty, tz1 + 0.064, 0x2a4a66, 0.16);
    sightY = ty; sightZ = tz1 + 0.075; eye = 0.07;
    span = [zoom >= 8 ? ob0 - 0.05 : ob0, tz1 + 0.075];
  }

  // folded backup irons when an optic is fitted on a rail gun
  if (type !== 'iron' && !L.pistol && c.spec.body !== 'shotgun' && c.spec.body !== 'sniper') {
    const fz = L.frontIronZ, rz = L.rearIronZ;
    if (fz < span[0] - 0.01) { k.box(c.root, 0.022, 0.008, 0.02, m.dark, 0, b + 0.004, fz, 0.002); k.box(c.root, 0.014, 0.003, 0.016, m.dark, 0, b + 0.0095, fz + 0.002, 0.001); }
    if (rz > span[1] + 0.012 || rz < span[0] - 0.012) { k.box(c.root, 0.022, 0.009, 0.024, m.dark, 0, b + 0.0045, rz, 0.002); k.box(c.root, 0.016, 0.003, 0.016, m.dark, 0, b + 0.0105, rz - 0.002, 0.001); }
  }

  // sight anchor
  const so = new THREE.Object3D(); so.name = 'sight'; so.position.set(0, sightY, sightZ);
  og.add(so);
  c.ud.sight = so;
  c.ud.sightPos = new THREE.Vector3(0, sightY, sightZ);
  c.ud.eyeDist = eye;
  c.ud.zoom = zoom;
  c.ud.reticle = reticle;
  c.ud.opticType = type;

  // mount on moving parts where appropriate
  const host = (L.pistol ? c.slide : (c.ud.cover as THREE.Object3D | undefined)) ?? null;
  if (host) { c.root.updateMatrixWorld(true); host.attach(og); }
}

/** iron sights (rear aperture + front post). Returns sight line height, rear z, eye distance */
function irons(c: GunCtx, og: THREE.Group): { y: number; z: number; eye: number } {
  const L = c.L, k = c.k, m = c.m;
  if (L.pistol) return { y: (c.ud.ironSightY as number) ?? 0.056, z: L.rearIronZ, eye: 0.24 };
  const b = L.railY;
  const shot = c.spec.body === 'shotgun';
  const sy = b + (shot ? 0.022 : 0.028);
  const zr = L.rearIronZ;
  // rear: flip-up aperture
  k.box(og, 0.024, 0.007, 0.022, m.dark, 0, b + 0.0035, zr, 0.0015);
  const ear = sy + 0.009 - b;
  for (const sx of [-1, 1]) k.box(og, 0.0038, ear, 0.012, m.dark, sx * 0.0098, b + ear / 2, zr, 0.001);
  const ar = shot ? 0.0058 : 0.0042, at = shot ? 0.0022 : 0.0016;
  k.mesh(og, torusGeo(ar, at, 8, 22), m.dark, 0, sy, zr);
  const fr = ar + at;
  k.box(og, 0.012, Math.max(0.002, sy - fr - b - 0.006), 0.003, m.dark, 0, b + 0.006 + (sy - fr - b - 0.006) / 2, zr);
  k.box(og, fr * 2 + 0.004, 0.0025, 0.003, m.dark, 0, sy + fr + 0.001, zr);
  for (const sx of [-1, 1]) k.box(og, 0.0026, fr * 2 + 0.002, 0.003, m.dark, sx * (fr + 0.0006), sy, zr);
  k.tubeX(og, 0.0042, 0.005, m.dark, 0.0145, b + 0.008, zr + 0.004, 10);
  // front post
  const zf = L.frontIronZ;
  if (L.frontOnBarrel) {
    const top = L.boreY + L.barR + 0.002;
    if (c.spec.body === 'lmg') {
      k.box(c.root, 0.016, 0.006, 0.014, m.dark, 0, top + 0.003, zf, 0.001);
      for (const sx of [-1, 1]) {
        const e = k.box(c.root, 0.003, sy + 0.006 - top, 0.01, m.dark, sx * 0.0085, (top + sy + 0.006) / 2, zf, 0.001);
        e.rotation.z = -sx * 0.06;
      }
      k.box(c.root, 0.0024, sy - top - 0.0005, 0.0026, m.dark, 0, (top + sy - 0.0005) / 2, zf);
    } else {
      k.box(c.root, 0.006, sy - top - 0.002, 0.008, m.dark, 0, (top + sy - 0.002) / 2, zf, 0.001);
      k.tubeZ(c.root, 0.0013, 0.0013, zf - 0.004, zf + 0.004, m.fibre, 0, sy - 0.0012, 8);
    }
  } else {
    k.box(c.root, 0.024, 0.007, 0.02, m.dark, 0, b + 0.0035, zf, 0.0015);
    for (const sx of [-1, 1]) {
      const e = k.box(c.root, 0.0034, sy + 0.007 - b, 0.012, m.dark, sx * 0.0095, (b + sy + 0.007) / 2, zf, 0.001);
      e.rotation.z = -sx * 0.12;
    }
    k.box(c.root, 0.0022, sy - b - 0.0045, 0.0024, m.dark, 0, (b + 0.004 + sy - 0.0005) / 2, zf);
  }
  return { y: sy, z: zr, eye: shot ? 0.1 : 0.085 };
}

// ───────────────────────── underbarrel ─────────────────────────

export function buildUnder(c: GunCtx): void {
  const a = c.att.underbarrel; if (!a) return;
  const id = a.id;
  if (has(id, 'none')) return;
  const L = c.L, k = c.k, m = c.m;
  const P = (c.ud.leftParent as THREE.Object3D | undefined) ?? c.root;
  const col = a.model?.color ? M.polymer(a.model.color, 0.75) : m.polyDark;
  const len = a.model?.len ?? 0.07;
  const z = L.ugZ, y = L.ugY;
  const railStub = (z0: number, z1: number) => { if (L.hasHandguard && c.spec.body !== 'shotgun' || c.ud.cover) k.rail(P, z0, z1, y - 0.0005, m.dark, m.hole, 'bottom'); };
  if (a.laser) {
    if (L.pistol) {
      k.box(P, 0.022, 0.02, 0.045, M.metal(0x2a2c30, 0.5, 0.4), 0, y - 0.011, z, 0.003);
      k.mesh(P, circleGeo(0.0028, 12), M.glow(0xff2010, 1.6), -0.005, y - 0.012, z - 0.0228, 0, Math.PI, 0);
      k.mesh(P, circleGeo(0.0028, 12), m.hole, 0.005, y - 0.012, z - 0.0228, 0, Math.PI, 0);
      addLaser(c, P, -0.005, y - 0.012, z - 0.024);
    } else {
      const x = L.sideX + 0.0125, zl = L.sideZ + len / 2;
      k.rail(P, zl + len / 2 - 0.004, zl - len / 2 + 0.004, L.sideX + 0.0005, m.dark, m.hole, 'right', 0, L.sideY);
      k.box(P, 0.022, 0.03, len, M.metal(a.model?.color ?? 0x2a2c30, 0.5, 0.4), x, L.sideY, zl, 0.003);
      k.box(P, 0.006, 0.006, 0.014, m.rubber, x + 0.011, L.sideY + 0.004, zl + 0.008, 0.002);
      k.mesh(P, circleGeo(0.0032, 12), M.glow(0xff2010, 1.6), x - 0.004, L.sideY + 0.007, zl - len / 2 - 0.0004, 0, Math.PI, 0);
      k.mesh(P, circleGeo(0.0042, 12), M.glass(0x101010, 0.9), x + 0.003, L.sideY - 0.006, zl - len / 2 - 0.0004, 0, Math.PI, 0);
      addLaser(c, P, x - 0.004, L.sideY + 0.007, zl - len / 2 - 0.002);
    }
    return;
  }
  if (a.flashlight) {
    const lensMat = M.glow(0xe8f2ff, 1.25);
    if (L.pistol) {
      k.box(P, 0.024, 0.022, 0.05, M.metal(0x2a2c30, 0.5, 0.4), 0, y - 0.012, z, 0.004);
      k.mesh(P, circleGeo(0.009, 16), lensMat, 0, y - 0.012, z - 0.0252, 0, Math.PI, 0);
    } else {
      const x = L.sideX + 0.0155, y2 = L.sideY - 0.003, z0 = L.sideZ;
      k.rail(P, z0 + len - 0.01, z0 + 0.012, L.sideX + 0.0005, m.dark, m.hole, 'right', 0, L.sideY);
      k.box(P, 0.012, 0.016, 0.02, m.dark, L.sideX + 0.006, y2, z0 + len * 0.5, 0.002);
      k.tubeZ(P, 0.0115, 0.0115, z0, z0 + len, M.metal(a.model?.color ?? 0x2a2c30, 0.45, 0.6), x, y2, 18);
      k.tubeZ(P, 0.0138, 0.0124, z0 - 0.014, z0 + 0.002, m.dark, x, y2, 18);
      k.tubeZ(P, 0.0065, 0.0065, z0 + len, z0 + len + 0.008, m.rubber, x, y2, 12);
      for (let i = 0; i < 4; i++) k.tubeZ(P, 0.0119, 0.0119, z0 + 0.012 + i * 0.008, z0 + 0.0145 + i * 0.008, m.dark, x, y2, 18);
      k.mesh(P, circleGeo(0.0112, 18), lensMat, x, y2, z0 - 0.0142, 0, Math.PI, 0);
      const lo = new THREE.Object3D(); lo.name = 'light'; lo.position.set(x, y2, z0 - 0.016); P.add(lo); c.ud.light = lo;
    }
    return;
  }
  if (a.bipod) {
    railStub(z - 0.02, z + 0.02);
    k.box(P, 0.03, 0.014, 0.028, m.dark, 0, y - 0.008, z, 0.003);
    k.tubeX(P, 0.005, 0.036, m.steel, 0, y - 0.013, z + 0.006, 10);
    const ll = Math.max(0.1, len);
    for (const sx of [-1, 1]) {
      const leg = k.group(P, sx * 0.0105, y - 0.016, z + 0.006);
      leg.rotation.y = -sx * 0.06;
      k.tubeZ(leg, 0.0046, 0.0046, 0, ll * 0.55, m.dark, 0, 0, 10);
      k.tubeZ(leg, 0.0036, 0.0036, ll * 0.5, ll, m.steel, 0, 0, 10);
      k.tubeZ(leg, 0.0058, 0.0058, ll * 0.5, ll * 0.56, m.dark, 0, 0, 10);
      k.box(leg, 0.009, 0.01, 0.014, m.rubber, 0, -0.002, ll + 0.006, 0.003);
    }
    return;
  }
  if (has(id, 'vgrip', 'vert')) {
    railStub(z - 0.018, z + 0.018);
    const gl = Math.max(0.05, len);
    k.box(P, 0.022, 0.01, 0.034, col, 0, y - 0.005, z, 0.003);
    k.tubeY(P, 0.0158, 0.0152, gl, col, 0, y - 0.008 - gl / 2, z, 16);
    for (let i = 0; i < 4; i++) k.tubeY(P, 0.0163, 0.0163, 0.003, col, 0, y - 0.022 - i * (gl - 0.025) / 3.5, z, 16);
    k.tubeY(P, 0.0172, 0.0168, 0.006, m.rubber, 0, y - 0.008 - gl, z, 16);
    L.leftHand = { pos: [-0.031, y - 0.008 - gl * 0.42, z + 0.016], f: [0, 0, -1], n: [1, 0, 0], pose: 'vgrip' };
    return;
  }
  if (has(id, 'stub')) {
    railStub(z - 0.018, z + 0.018);
    if (L.pistol) k.rail(P, z + 0.016, z - 0.016, y, m.dark, m.hole, 'bottom');
    const gl = Math.max(0.035, len);
    k.box(P, 0.024, 0.01, 0.034, col, 0, y - 0.005, z, 0.003);
    k.tubeY(P, 0.0175, 0.0185, gl, col, 0, y - 0.008 - gl / 2, z, 16);
    k.sphere(P, 0.0185, col, 0, y - 0.008 - gl, z, 1, 0.45, 1);
    L.leftHand = { pos: [-0.032, y - 0.006 - gl * 0.5, z + 0.016], f: [0, 0, -1], n: [1, 0, 0], pose: 'vgrip' };
    return;
  }
  if (has(id, 'agrip', 'angle')) {
    railStub(z - 0.03, z + 0.035);
    const s = len / 0.07;
    k.side(P, [[z - 0.035 * s, y], [z + 0.04 * s, y], [z + 0.034 * s, y - 0.012], [z - 0.026 * s, y - 0.034], [z - 0.038 * s, y - 0.03]], 0.026, col, 0, 0.004);
    L.leftHand = supportHand(L.hgCY - 0.004, L.hgHalfW, L.hgHalfH + 0.004, z + 0.032 * s);
    L.leftHand.n = [0.38, 0.85, -0.36];
    return;
  }
  if (has(id, 'hand', 'stop')) {
    railStub(z - 0.016, z + 0.016);
    k.side(P, [[z - 0.012, y], [z + 0.014, y], [z + 0.002, y - 0.019], [z - 0.014, y - 0.017]], 0.022, col, 0, 0.003);
    L.leftHand = supportHand(L.hgCY, L.hgHalfW, L.hgHalfH, z + 0.042);
    return;
  }
}

function addLaser(c: GunCtx, P: THREE.Object3D, x: number, y: number, z: number): void {
  const o = new THREE.Object3D(); o.name = 'laser'; o.position.set(x, y, z); P.add(o); c.ud.laser = o;
}

export { handAnchor };
