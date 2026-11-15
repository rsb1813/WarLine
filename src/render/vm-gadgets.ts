// render-viewmodel: procedural gadget models (launchers, tools, deployables, grenades).
// Same conventions as guns: metres, forward = -Z, origin at the grip (launchers/tools) or the item centre.
import * as THREE from 'three';
import type { AttachmentDef, GadgetKind, GunModelSpec, SlotId, WeaponDef } from '../types';
import { Kit, rrect, hollowZ, planeGeo, circleGeo, torusGeo, cylGeo } from './vm-geo';
import { GunCtx, gunMats, handAnchor, HandSpec, Lay, pistolGrip, triggerGuard } from './vm-gunparts';
import * as M from './vm-mats';

const OLIVE = 0x4c5139;

function mini(root: THREE.Group, color: number, accent: number): GunCtx {
  const spec: GunModelSpec = { body: 'rifle', length: 0.5, barrel: 0.3, mag: 'box', color, accent, rail: true };
  return {
    k: new Kit(root), root, def: { id: 'gadget', mag: 1, modes: ['semi'], slots: {} } as unknown as WeaponDef, spec, m: gunMats(spec),
    att: {} as Record<SlotId, AttachmentDef | null>, L: {} as Lay, ud: {}, slide: null,
  };
}

function anchor(root: THREE.Object3D, name: string, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); root.add(o); return o;
}
function sightAt(g: THREE.Group, x: number, y: number, z: number, eye: number, zoom = 1, reticle = 'iron'): void {
  g.userData.sight = anchor(g, 'sight', x, y, z);
  g.userData.sightPos = new THREE.Vector3(x, y, z);
  g.userData.eyeDist = eye;
  g.userData.zoom = zoom;
  g.userData.reticle = reticle;
}
function hands(g: THREE.Group, r: HandSpec | null, l: HandSpec | null, rp: THREE.Object3D = g, lp: THREE.Object3D = g): void {
  if (r) g.userData.rightHand = handAnchor(rp, r, 'rightHand');
  if (l) g.userData.leftHand = handAnchor(lp, l, 'leftHand');
}
function retPlane(k: Kit, P: THREE.Object3D, kind: string, size: number, x: number, y: number, z: number, color: number): void {
  const mesh = k.mesh(P, planeGeo(size, size), M.additive(color, M.reticleTex(kind), 'ret:' + kind), x, y, z);
  mesh.renderOrder = 12; mesh.userData.keep = true;
}
function ownGlow(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false });
}
function cylX(r: number, len: number, seg = 18): THREE.BufferGeometry {
  const g = cylGeo(r, r, len, seg).clone(); g.rotateZ(Math.PI / 2); return g;
}

// ───────────────────────── shoulder launchers ─────────────────────────

function rocket(g: THREE.Group): void {
  const c = mini(g, OLIVE, 0x8a2a1e), k = c.k, m = c.m;
  const tube = M.polymer(0x4a5038, 0.7), ty = 0.088, R = 0.043;
  k.tubeZ(g, R, R, -0.6, 0.34, tube, 0, ty, 28);
  for (const z of [-0.58, -0.3, 0.06, 0.3]) k.tubeZ(g, R + 0.003, R + 0.003, z - 0.012, z + 0.012, m.polyDark, 0, ty, 28);
  k.mesh(g, hollowZ(R + 0.004, R - 0.004, -0.62, -0.59, 28), m.polyDark, 0, ty, 0);
  // rear venturi
  k.mesh(g, hollowZ(0.05, 0.046, 0.34, 0.42, 28), m.dark, 0, ty, 0);
  k.mesh(g, circleGeo(0.046, 24), m.hole, 0, ty, 0.36);
  // shoulder pad + cheek rest
  k.tubeZ(g, R + 0.012, R + 0.012, 0.1, 0.22, m.rubber, 0, ty, 24);
  k.box(g, 0.03, 0.02, 0.1, m.rubber, -0.035, ty + 0.03, 0.16, 0.008);
  // grip assembly
  k.span(g, 0.03, 0.006, ty - R + 0.004, -0.06, 0.07, m.polyDark, 0, 0.004);
  triggerGuard(c, g, -0.064, -0.004, 0.006, 0.028, m.polyDark);
  const rh = pistolGrip(c, g, { z0: -0.006, top: 0.006, thick: 0.03 });
  // front vertical grip
  k.span(g, 0.024, ty - R - 0.012, ty - R + 0.004, -0.3, -0.25, m.polyDark, 0, 0.003);
  k.tubeY(g, 0.016, 0.015, 0.075, m.polyDark, 0, ty - R - 0.048, -0.275, 16);
  // optic on left mount
  const ox = -0.058, oy = ty + 0.06, oz = -0.14;
  k.box(g, 0.035, 0.012, 0.04, m.dark, -0.034, ty + 0.03, oz, 0.003, 0, 0, 0.6);
  k.front(g, rrect(ox, oy, 0.042, 0.036, 0.007), 0.05, m.dark, oz - 0.01, 0.0015, [rrect(ox, oy, 0.032, 0.026, 0.004)]);
  k.box(g, 0.04, 0.012, 0.07, m.dark, ox, oy - 0.023, oz, 0.003);
  k.mesh(g, planeGeo(0.032, 0.026), M.glass(0x6a3a20, 0.2), ox, oy, oz - 0.034).renderOrder = 8;
  retPlane(k, g, 'chevron', 0.026, ox, oy, oz - 0.033, 0xff5a20);
  // warhead (removed while reloading)
  const wh = k.group(g, 0, ty, 0, true, 'warhead');
  const body = M.polymer(0x6d6a48, 0.6);
  k.tubeZ(wh, 0.018, 0.018, -0.62, -0.66, m.dark, 0, 0, 16);
  k.lathe(wh, [[0.0001, -0.885], [0.01, -0.878], [0.032, -0.83], [0.044, -0.77], [0.045, -0.71], [0.03, -0.665], [0.018, -0.655]], body, 0, 0, 0, 24);
  k.tubeZ(wh, 0.0455, 0.0455, -0.76, -0.75, M.polymer(0xa02a1e, 0.6), 0, 0, 24);
  k.tubeZ(wh, 0.008, 0.002, -0.88, -0.9, m.copper, 0, 0, 10);
  g.userData.warhead = wh;
  g.userData.mag = wh;
  g.userData.muzzle = anchor(g, 'muzzle', 0, ty, -0.62);
  sightAt(g, ox, oy, oz + 0.03, 0.12, 1, 'chevron');
  hands(g, rh, { pos: [-0.031, ty - R - 0.04, -0.258], f: [0, 0, -1], n: [1, 0, 0], pose: 'vgrip' });
  g.userData.hold = 'shoulder';
}

function aa(g: THREE.Group): void {
  const c = mini(g, OLIVE, 0x8a2a1e), k = c.k, m = c.m;
  const tube = M.polymer(0x5a5e45, 0.75), ty = 0.1, R = 0.055;
  k.tubeZ(g, R, R, -0.72, 0.42, tube, 0, ty, 28);
  for (const z of [-0.6, -0.2, 0.2]) k.tubeZ(g, R + 0.003, R + 0.003, z - 0.01, z + 0.01, m.polyDark, 0, ty, 28);
  k.mesh(g, hollowZ(R + 0.004, R - 0.004, 0.42, 0.46, 28), m.polyDark, 0, ty, 0);
  k.mesh(g, circleGeo(R - 0.004, 24), m.hole, 0, ty, 0.44);
  // seeker dome
  k.tubeZ(g, R + 0.005, R + 0.005, -0.74, -0.71, m.polyDark, 0, ty, 28);
  const dome = k.sphere(g, R * 0.95, M.glass(0x3a2a1a, 0.75), 0, ty, -0.74, 1, 1, 0.6);
  dome.renderOrder = 8;
  // gripstock, BCU, grip
  k.span(g, 0.036, 0.006, ty - R + 0.006, -0.1, 0.12, m.polyDark, 0, 0.005);
  k.tubeZ(g, 0.024, 0.024, -0.3, -0.12, m.polyDark, 0, ty - R - 0.02, 16);
  k.mesh(g, cylX(0.026, 0.04), m.accent, 0, ty - R - 0.02, -0.31);
  triggerGuard(c, g, -0.064, -0.004, 0.006, 0.028, m.polyDark);
  const rh = pistolGrip(c, g, { z0: -0.006, top: 0.006, thick: 0.03 });
  // IFF antenna grid (left, folded up)
  const ag = k.group(g, -0.09, ty + 0.03, -0.18);
  ag.rotation.z = 0.35;
  k.span(ag, 0.006, -0.06, 0.06, -0.06, 0.06, m.dark, 0, 0.002);
  for (let i = -2; i <= 2; i++) k.box(ag, 0.008, 0.11, 0.003, m.steel, 0, 0, i * 0.024);
  k.box(g, 0.05, 0.01, 0.02, m.dark, -0.065, ty + 0.025, -0.18, 0.002);
  // open frame sight on the left with lock LED
  const ox = -0.075, oy = ty + 0.045, oz = -0.08;
  k.box(g, 0.04, 0.01, 0.12, m.dark, -0.055, ty + 0.012, oz, 0.003, 0, 0, 0.5);
  k.mesh(g, torusGeo(0.022, 0.0022, 6, 28), m.dark, ox, oy, oz - 0.05);
  k.box(g, 0.0025, 0.044, 0.003, m.dark, ox, oy, oz - 0.05);
  k.box(g, 0.044, 0.0025, 0.003, m.dark, ox, oy, oz - 0.05);
  k.mesh(g, torusGeo(0.0045, 0.0018, 6, 16), m.dark, ox, oy, oz + 0.05);
  k.box(g, 0.003, 0.03, 0.004, m.dark, ox, oy - 0.02, oz + 0.05);
  const led = k.mesh(g, circleGeo(0.003, 10), ownGlow(0xff3020), ox + 0.03, oy - 0.02, oz + 0.05);
  led.userData.keep = true;
  g.userData.lockLight = led;
  g.userData.mag = anchor(g, 'mag', 0, ty, 0);
  g.userData.muzzle = anchor(g, 'muzzle', 0, ty, -0.76);
  sightAt(g, ox, oy, oz + 0.05, 0.12, 1, 'holo');
  hands(g, rh, { pos: [-0.012, ty - R - 0.048, -0.2], f: [0.6, 0, -0.8], n: [0.35, 0.94, 0], pose: 'wrap' });
  g.userData.hold = 'shoulder';
}

// ───────────────────────── handheld tools ─────────────────────────

function ugl(g: THREE.Group): void {
  const c = mini(g, 0x2f3134, 0x6c7a5a), k = c.k, m = c.m;
  const by = 0.07;
  k.mesh(g, hollowZ(0.026, 0.0205, -0.3, -0.03, 24), m.rec, 0, by, 0);
  for (let i = 0; i < 6; i++) k.box(g, 0.0014, 0.012, 0.03, m.hole, 0.0262, by, -0.27 + i * 0.04);
  k.span(g, 0.044, by - 0.03, by + 0.026, -0.04, 0.07, m.poly, 0, 0.006);
  k.span(g, 0.03, 0.006, by - 0.028, -0.07, 0.07, m.poly, 0, 0.004);
  triggerGuard(c, g, -0.07, -0.004, 0.004, 0.032, m.poly);
  const rh = pistolGrip(c, g, { z0: -0.006, top: 0.006, thick: 0.03 });
  // folding stock (folded) + leaf sight
  k.span(g, 0.012, by - 0.02, by + 0.02, 0.07, 0.22, m.polyDark, -0.018, 0.004);
  k.rail(g, 0.06, -0.03, by + 0.033, m.dark, m.hole);
  const sy = by + 0.06;
  k.box(g, 0.004, sy - by - 0.026, 0.008, m.dark, -0.03, (by + 0.026 + sy) / 2, 0.02);
  k.box(g, 0.02, 0.006, 0.003, m.dark, -0.024, sy + 0.004, 0.02);
  k.box(g, 0.003, 0.03, 0.003, m.dark, 0, by + 0.04, -0.26);
  k.mesh(g, torusGeo(0.005, 0.0016, 6, 16), m.dark, 0, sy, 0.03);
  k.box(g, 0.003, sy - by - 0.032, 0.003, m.dark, 0, (by + 0.03 + sy - 0.006) / 2, 0.03);
  k.box(g, 0.0025, sy - by - 0.026, 0.0025, m.dark, 0, (by + 0.026 + sy) / 2 - 0.0005, -0.28);
  // round in the breech
  const rd = k.group(g, 0, by, -0.02, true, 'round');
  k.tubeZ(rd, 0.02, 0.02, -0.05, 0.005, M.polymer(0x8c8a48, 0.5), 0, 0, 18);
  k.tubeZ(rd, 0.0205, 0.0205, 0.005, 0.02, m.brass, 0, 0, 18);
  g.userData.mag = rd;
  g.userData.muzzle = anchor(g, 'muzzle', 0, by, -0.305);
  sightAt(g, 0, sy, 0.03, 0.12, 1, 'iron');
  hands(g, rh, { pos: [-0.034, by - 0.03, -0.2], f: [0.55, -0.27, -0.8], n: [0.45, 0.89, 0], pose: 'wrap' });
  g.userData.hold = 'rifle';
}

function repair(g: THREE.Group): void {
  const c = mini(g, 0x3a3d40, 0xd6a21e), k = c.k, m = c.m;
  const by = 0.07;
  const can = M.metal(0xc8a024, 0.45, 0.3);
  k.tubeZ(g, 0.034, 0.034, -0.06, 0.1, can, 0, by, 22);
  k.sphere(g, 0.034, can, 0, by, 0.1, 1, 1, 0.5);
  for (const z of [-0.03, 0.06]) k.tubeZ(g, 0.0355, 0.0355, z - 0.006, z + 0.006, m.dark, 0, by, 22);
  k.tubeZ(g, 0.03, 0.022, -0.1, -0.06, m.dark, 0, by, 18);
  k.tubeZ(g, 0.012, 0.009, -0.24, -0.1, m.steel, 0, by, 14);
  for (let i = 0; i < 6; i++) k.tubeZ(g, 0.016, 0.016, -0.15 - i * 0.012, -0.155 - i * 0.012, m.dark, 0, by, 16);
  k.tubeZ(g, 0.0095, 0.0075, -0.27, -0.24, m.copper, 0, by, 14);
  const tipMat = ownGlow(0x2a3a55);
  const tip = k.mesh(g, circleGeo(0.0062, 12), tipMat, 0, by, -0.2704, 0, Math.PI, 0);
  tip.userData.keep = true;
  g.userData.tip = tip;
  // gauge
  k.tubeY(g, 0.012, 0.012, 0.012, m.dark, 0.0, by + 0.04, 0.03, 16);
  k.mesh(g, circleGeo(0.0105, 16), M.polymer(0xe6e2d2, 0.6), 0, by + 0.0465, 0.03, -Math.PI / 2, 0, 0);
  k.box(g, 0.001, 0.0008, 0.008, M.glow(0xc02010, 1), 0, by + 0.0472, 0.028, 0, 0.6, 0);
  // hose
  const hose = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.03, by - 0.01, 0.08), new THREE.Vector3(0.06, by - 0.03, 0.0), new THREE.Vector3(0.04, by - 0.02, -0.09), new THREE.Vector3(0.012, by, -0.11),
  ]), 16, 0.0055, 8);
  k.mesh(g, hose, m.rubber);
  // handles
  k.span(g, 0.03, 0.006, by - 0.03, -0.07, 0.06, m.polyDark, 0, 0.004);
  triggerGuard(c, g, -0.064, -0.004, 0.006, 0.026, m.polyDark);
  const rh = pistolGrip(c, g, { z0: -0.006, top: 0.006, thick: 0.03 });
  k.tubeY(g, 0.015, 0.015, 0.07, m.polyDark, 0, by - 0.05, -0.13, 14);
  k.box(g, 0.02, 0.02, 0.03, m.dark, 0, by - 0.018, -0.13, 0.003);
  for (let i = 0; i < 3; i++) k.box(g, 0.036, 0.004, 0.01, m.accentPoly, 0, by + 0.0345, -0.02 + i * 0.03, 0.001);
  g.userData.muzzle = anchor(g, 'muzzle', 0, by, -0.272);
  g.userData.mag = anchor(g, 'mag', 0, by, 0);
  sightAt(g, 0, by + 0.07, 0.05, 0.16, 1, 'iron');
  hands(g, rh, { pos: [-0.031, by - 0.055, -0.115], f: [0, 0, -1], n: [1, 0, 0], pose: 'vgrip' });
  g.userData.hold = 'tool';
}

function stim(g: THREE.Group): void {
  const k = new Kit(g);
  const body = M.polymer(0xd8d2c0, 0.55);
  k.tubeZ(g, 0.0115, 0.0115, -0.05, 0.05, body, 0, 0, 18);
  k.tubeZ(g, 0.0118, 0.0118, -0.02, 0.02, M.glass(0x4aff6a, 0.55), 0, 0, 18);
  k.tubeZ(g, 0.0075, 0.0075, -0.019, 0.019, M.glow(0x2aa040, 1.1), 0, 0, 12);
  k.tubeZ(g, 0.0125, 0.0125, 0.05, 0.075, M.polymer(0xe0601a, 0.5), 0, 0, 18);
  k.tubeZ(g, 0.0115, 0.009, -0.075, -0.05, M.polymer(0xe8c020, 0.5), 0, 0, 18);
  for (let i = 0; i < 3; i++) k.tubeZ(g, 0.0118, 0.0118, -0.07 + i * 0.008, -0.066 + i * 0.008, M.polymer(0x151515, 0.6), 0, 0, 18);
  k.box(g, 0.003, 0.004, 0.06, M.polymer(0xb0161a, 0.5), 0, 0.0115, 0.0, 0.001);
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -0.076);
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  sightAt(g, 0, 0.08, 0.1, 0.2);
  hands(g, { pos: [0.0, -0.026, 0.012], f: [-1, 0, 0], n: [0, 1, 0], pose: 'fist' }, null);
  g.userData.hold = 'pen';
}

function defib(g: THREE.Group): void {
  const k = new Kit(g), m = gunMats({ body: 'rifle', length: 0.5, barrel: 0.3, mag: 'box', color: 0x2b2d30, accent: 0xd6a21e, rail: false });
  const handleMat = M.polymer(0x2a2c2e, 0.7), padMat = M.polymer(0xd8a020, 0.6);
  const mk = (sx: number): THREE.Group => {
    const p = k.group(g, sx * 0.085, 0, 0, true, sx < 0 ? 'paddleL' : 'paddleR');
    k.tubeZ(p, 0.016, 0.017, -0.002, 0.09, handleMat, 0, 0, 16);
    for (let i = 0; i < 4; i++) k.tubeZ(p, 0.0175, 0.0175, 0.02 + i * 0.016, 0.024 + i * 0.016, M.polymer(0x111111, 0.8), 0, 0, 16);
    k.box(p, 0.078, 0.064, 0.016, padMat, 0, 0, -0.008, 0.008);
    k.box(p, 0.068, 0.054, 0.003, M.metal(0xb8bcc0, 0.3, 0.9), 0, 0, -0.0175, 0.002);
    k.tubeY(p, 0.006, 0.006, 0.006, M.glow(0xd02018, 1.0), 0, 0.017, 0.07, 10);
    const cable = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0.09), new THREE.Vector3(0, -0.02, 0.13), new THREE.Vector3(-sx * 0.02, -0.12, 0.14), new THREE.Vector3(-sx * 0.05, -0.3, 0.1),
    ]), 14, 0.004, 6);
    k.mesh(p, cable, m.rubber);
    return p;
  };
  const pl = mk(-1), pr = mk(1);
  g.userData.paddleL = pl; g.userData.paddleR = pr;
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -0.02);
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  sightAt(g, 0, 0.1, 0.1, 0.2);
  hands(g, { pos: [0, -0.03, 0.055], f: [-1, 0, 0], n: [0, 1, 0], pose: 'fist' }, { pos: [0, -0.03, 0.055], f: [1, 0, 0], n: [0, 1, 0], pose: 'fist' }, pr, pl);
  g.userData.hold = 'paddles';
}

// ───────────────────────── deployables ─────────────────────────

function sideHands(g: THREE.Group, hw: number, y: number, z: number, down = 0.6): void {
  hands(g,
    { pos: [hw + 0.014, y, z], f: [0, -down, -Math.sqrt(1 - down * down)], n: [-1, 0, 0], pose: 'flat' },
    { pos: [-hw - 0.014, y, z], f: [0, -down, -Math.sqrt(1 - down * down)], n: [1, 0, 0], pose: 'flat' });
}

function atmine(g: THREE.Group): void {
  const k = new Kit(g), body = M.polymer(0x4e5638, 0.75), dark = M.polymer(0x23261d, 0.8);
  const R = 0.15;
  k.tubeY(g, R, R * 1.02, 0.07, body, 0, 0, 0, 36);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    k.box(g, 0.01, 0.05, 0.006, body, Math.cos(a) * (R + 0.002), -0.004, Math.sin(a) * (R + 0.002), 0, 0, -a, 0);
  }
  k.tubeY(g, R * 0.85, R * 0.85, 0.008, dark, 0, 0.039, 0, 36);
  k.tubeY(g, 0.05, 0.055, 0.016, M.polymer(0x3a3f2c, 0.7), 0, 0.048, 0, 28);
  k.tubeY(g, 0.018, 0.018, 0.012, M.polymer(0xb0201a, 0.6), 0, 0.06, 0, 16);
  const h = k.mesh(g, torusGeo(0.04, 0.006, 6, 18, Math.PI), dark, 0, 0.0, R + 0.002);
  h.rotation.x = Math.PI / 2;
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -R);
  sightAt(g, 0, 0.2, 0.2, 0.3);
  sideHands(g, R, 0.0, 0.03, 0.7);
  g.userData.hold = 'item';
  g.userData.itemPos = [0.02, -0.22, -0.42];
}

function bag(g: THREE.Group, med: boolean): void {
  const k = new Kit(g);
  const fab = M.fabric(med ? 0x5c6046 : 0x4c5236), dark = M.fabric(0x262820);
  const w = med ? 0.2 : 0.22, h = med ? 0.12 : 0.13, d = med ? 0.13 : 0.15;
  k.box(g, w, h, d, fab, 0, 0, 0, 0.022);
  k.box(g, w + 0.004, 0.01, d * 0.7, dark, 0, h * 0.18, 0, 0.003);
  for (const sx of [-1, 1]) k.box(g, 0.02, h + 0.006, d + 0.006, dark, sx * w * 0.3, 0, 0, 0.004);
  k.box(g, w * 0.92, 0.002, 0.004, M.polymer(0x111111, 0.6), 0, h / 2 + 0.0005, -d * 0.2);
  const decal = M.decal(med ? 'med' : 'ammo');
  k.mesh(g, planeGeo(0.06, 0.06), decal, 0, 0.005, -d / 2 - 0.0015, 0, Math.PI, 0);
  k.mesh(g, planeGeo(0.05, 0.05), decal, 0, h / 2 + 0.0015, 0.02, -Math.PI / 2, 0, 0);
  const hd = k.mesh(g, torusGeo(0.035, 0.006, 6, 16, Math.PI), dark, 0, h / 2, 0.0);
  hd.rotation.y = Math.PI / 2;
  for (const sx of [-1, 1]) k.box(g, 0.022, 0.016, 0.006, M.polymer(0x151515, 0.6), sx * w * 0.3, h * 0.05, -d / 2 - 0.004, 0.002);
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -d / 2);
  sightAt(g, 0, 0.2, 0.2, 0.3);
  sideHands(g, w / 2, -0.005, 0.02, 0.5);
  g.userData.hold = 'item';
  g.userData.itemPos = [0.03, -0.21, -0.4];
}

function cover(g: THREE.Group): void {
  const k = new Kit(g), body = M.polymer(0x5a5f4a, 0.8), dark = M.polymer(0x262822, 0.8);
  const w = 0.34, h = 0.36, d = 0.05;
  k.box(g, w, h, d, body, 0, 0, 0, 0.01);
  for (let i = 0; i < 4; i++) k.box(g, w - 0.03, 0.012, d + 0.006, dark, 0, -h / 2 + 0.05 + i * 0.087, 0, 0.003);
  k.box(g, w + 0.002, 0.02, 0.02, M.polymer(0xd6a21e, 0.6), 0, h / 2 - 0.02, -d / 2, 0.003);
  for (const sx of [-1, 1]) k.box(g, 0.012, h * 0.85, 0.02, dark, sx * (w / 2 - 0.03), 0, d / 2 + 0.008, 0.003);
  k.box(g, 0.12, 0.022, 0.02, dark, 0, 0.05, d / 2 + 0.02, 0.006);
  k.box(g, 0.06, 0.02, 0.008, M.glow(0x30c0ff, 0.5), w * 0.3, h * 0.38, -d / 2 - 0.002, 0.002);
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -d / 2);
  sightAt(g, 0, 0.3, 0.2, 0.3);
  sideHands(g, w / 2, 0.02, 0.0, 0.2);
  g.userData.hold = 'item';
  g.userData.itemPos = [0.03, -0.3, -0.46];
}

function drone(g: THREE.Group): void {
  const k = new Kit(g), body = M.polymer(0x3a3e40, 0.6), dark = M.polymer(0x18191a, 0.7);
  k.box(g, 0.08, 0.03, 0.11, body, 0, 0, 0, 0.012);
  k.box(g, 0.06, 0.012, 0.07, dark, 0, 0.02, 0.01, 0.005);
  k.box(g, 0.05, 0.008, 0.03, M.polymer(0xd6a21e, 0.6), 0, 0.017, -0.035, 0.003);
  const rotors: THREE.Group[] = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const arm = k.box(g, 0.012, 0.01, 0.11, body, sx * 0.045, 0.004, sz * 0.045, 0.003);
    arm.rotation.y = Math.atan2(sx, sz);
    const mx = sx * 0.085, mz = sz * 0.085;
    k.tubeY(g, 0.013, 0.014, 0.022, dark, mx, 0.012, mz, 14);
    k.mesh(g, hollowZ(0.06, 0.056, -0.008, 0.008, 28).clone().rotateX(Math.PI / 2), M.polymer(0x262829, 0.6), mx, 0.022, mz);
    const r = k.group(g, mx, 0.026, mz, true, 'rotor');
    k.box(r, 0.1, 0.0016, 0.012, dark, 0, 0, 0, 0.0006);
    k.box(r, 0.012, 0.0016, 0.1, dark, 0, 0, 0, 0.0006);
    k.tubeY(r, 0.005, 0.005, 0.006, M.polymer(0x666a6e, 0.4), 0, 0.002, 0, 10);
    rotors.push(r);
    k.mesh(g, circleGeo(0.0035, 10), M.glow(sz < 0 ? 0xff3020 : 0x30ff60, 1.2), mx, -0.0005, mz, Math.PI / 2, 0, 0);
  }
  k.sphere(g, 0.018, dark, 0, -0.022, -0.04);
  k.mesh(g, circleGeo(0.009, 14), M.glass(0x101820, 0.9), 0, -0.024, -0.0575, 0, Math.PI, 0);
  for (const sx of [-1, 1]) k.box(g, 0.004, 0.03, 0.08, dark, sx * 0.03, -0.028, 0, 0.0015);
  g.userData.rotors = rotors;
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -0.06);
  sightAt(g, 0, 0.2, 0.2, 0.3);
  sideHands(g, 0.045, -0.012, 0.0, 0.45);
  g.userData.hold = 'item';
  g.userData.itemPos = [0.02, -0.17, -0.38];
}

function sensor(g: THREE.Group): void {
  const k = new Kit(g), body = M.polymer(0x3e4233, 0.7), dark = M.polymer(0x1b1c1a, 0.7);
  k.tubeY(g, 0.024, 0.026, 0.08, body, 0, 0, 0, 18);
  k.sphere(g, 0.023, M.glass(0x1a1010, 0.85), 0, 0.04, 0, 1, 0.8, 1).renderOrder = 8;
  k.tubeY(g, 0.027, 0.027, 0.01, dark, 0, 0.036, 0, 18);
  k.tubeY(g, 0.002, 0.002, 0.09, M.metal(0x222222, 0.4, 0.8), 0.015, 0.09, 0, 6);
  k.mesh(g, new THREE.ConeGeometry(0.012, 0.07, 10), M.metal(0x555a5e, 0.4, 0.8), 0, -0.075, 0, Math.PI, 0, 0);
  k.tubeY(g, 0.02, 0.02, 0.008, dark, 0, -0.038, 0, 16);
  const led = k.mesh(g, circleGeo(0.003, 10), ownGlow(0xff2a20), 0, 0.012, -0.0262, 0, Math.PI, 0);
  led.userData.keep = true;
  g.userData.led = led;
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -0.03);
  sightAt(g, 0, 0.2, 0.2, 0.3);
  hands(g, { pos: [0.039, -0.012, 0.012], f: [0, 0, -1], n: [-1, 0, 0], pose: 'vgrip' }, null);
  g.userData.hold = 'item1';
  g.userData.itemPos = [0.1, -0.15, -0.34];
}

function beacon(g: THREE.Group): void {
  const k = new Kit(g), body = M.polymer(0x3f4433, 0.75), dark = M.polymer(0x1c1d1b, 0.7);
  k.box(g, 0.1, 0.14, 0.06, body, 0, 0, 0, 0.012);
  k.box(g, 0.08, 0.05, 0.004, dark, 0, 0.02, -0.0305, 0.002);
  k.mesh(g, planeGeo(0.06, 0.03), M.glow(0x2a8a50, 0.6), 0, 0.02, -0.0328, 0, Math.PI, 0);
  k.tubeY(g, 0.016, 0.016, 0.02, dark, 0.02, 0.08, 0, 14);
  const lamp = k.mesh(g, new THREE.SphereGeometry(0.012, 12, 8), ownGlow(0x3080ff), 0.02, 0.095, 0);
  lamp.userData.keep = true;
  g.userData.led = lamp;
  k.tubeY(g, 0.0025, 0.0025, 0.2, M.metal(0x222222, 0.5, 0.7), -0.03, 0.17, 0.0, 6);
  k.tubeY(g, 0.006, 0.006, 0.02, dark, -0.03, 0.075, 0, 10);
  for (const sx of [-1, 1]) k.box(g, 0.01, 0.04, 0.01, dark, sx * 0.035, -0.09, 0, 0.002);
  k.mesh(g, torusGeo(0.03, 0.005, 6, 16, Math.PI), dark, 0, 0.07, 0.033);
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -0.03);
  sightAt(g, 0, 0.2, 0.2, 0.3);
  sideHands(g, 0.05, -0.02, 0.0, 0.35);
  g.userData.hold = 'item';
  g.userData.itemPos = [0.03, -0.2, -0.38];
}

function claymore(g: THREE.Group): void {
  const k = new Kit(g), body = M.polymer(0x4c5236, 0.75), dark = M.polymer(0x1f211b, 0.75);
  k.box(g, 0.1, 0.085, 0.035, body, 0, 0, 0, 0.006);
  for (const sx of [-1, 1]) {
    const wing = k.box(g, 0.07, 0.085, 0.035, body, sx * 0.075, 0, 0.012, 0.006);
    wing.rotation.y = -sx * 0.32;
  }
  k.box(g, 0.2, 0.012, 0.03, dark, 0, -0.03, 0.006, 0.003);
  k.box(g, 0.012, 0.012, 0.018, dark, 0, 0.049, 0.004, 0.002);
  for (const sx of [-1, 1]) k.tubeY(g, 0.006, 0.006, 0.012, M.polymer(0x8a7a58, 0.6), sx * 0.04, 0.048, 0.006, 10);
  for (const sx of [-1, 1]) for (const lz of [-1, 1]) {
    const leg = k.box(g, 0.004, 0.06, 0.004, M.metal(0x333333, 0.5, 0.7), sx * 0.07, -0.065, 0.012 + lz * 0.006, 0.001);
    leg.rotation.x = lz * 0.35;
  }
  // raised lettering strip on the convex face
  k.box(g, 0.08, 0.008, 0.002, M.polymer(0x9a9a80, 0.6), 0, 0.02, -0.0185, 0.001);
  k.box(g, 0.06, 0.006, 0.002, M.polymer(0x9a9a80, 0.6), 0, 0.004, -0.0185, 0.001);
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -0.03);
  sightAt(g, 0, 0.2, 0.2, 0.3);
  sideHands(g, 0.12, -0.01, 0.025, 0.4);
  g.userData.hold = 'item';
  g.userData.itemPos = [0.02, -0.2, -0.38];
}

function breach(g: THREE.Group): void {
  const k = new Kit(g), body = M.polymer(0x6a6646, 0.85), dark = M.polymer(0x1b1c1a, 0.7);
  k.box(g, 0.11, 0.03, 0.06, body, 0, 0, 0, 0.004);
  for (const sx of [-1, 1]) k.box(g, 0.014, 0.032, 0.062, M.polymer(0x2b2c24, 0.9), sx * 0.032, 0, 0, 0.002);
  k.box(g, 0.03, 0.02, 0.03, dark, 0.0, 0.024, 0.0, 0.004);
  k.tubeY(g, 0.002, 0.002, 0.06, M.metal(0x222222, 0.5, 0.7), 0.01, 0.06, 0.008, 6);
  const led = k.mesh(g, circleGeo(0.0025, 10), ownGlow(0xff2010), -0.006, 0.026, -0.0152, 0, Math.PI, 0);
  led.userData.keep = true; g.userData.led = led;
  const wire = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.012, 0.03, 0.01), new THREE.Vector3(-0.03, 0.04, 0.02), new THREE.Vector3(-0.045, 0.012, 0.01),
  ]), 8, 0.0015, 5);
  k.mesh(g, wire, M.polymer(0xb01a1a, 0.6));
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -0.03);
  sightAt(g, 0, 0.2, 0.2, 0.3);
  hands(g, { pos: [0.004, -0.03, 0.018], f: [-0.2, 0.2, -0.95], n: [-0.15, 0.95, -0.2], pose: 'grenade' }, null);
  g.userData.hold = 'throw';
}

// ───────────────────────── grenades ─────────────────────────

function fuze(k: Kit, g: THREE.Object3D, top: number, r: number): void {
  const steel = M.metal(0x6a6d70, 0.4, 0.8);
  k.tubeY(g, 0.0105, 0.0115, 0.02, steel, 0, top + 0.009, 0, 14);
  k.box(g, 0.012, 0.014, 0.012, steel, 0.009, top + 0.01, 0, 0.002);
  // spoon lever down the side (+X)
  const spoon = M.metal(0x7a7d70, 0.45, 0.7);
  k.box(g, 0.004, 0.012, 0.012, spoon, 0.0165, top + 0.012, 0, 0.001, 0, 0, -0.3);
  k.box(g, 0.003, r * 1.3, 0.011, spoon, r + 0.003, top - r * 0.55, 0, 0.001, 0, 0, 0.12);
  // pin ring
  const ring = k.mesh(g, torusGeo(0.012, 0.0016, 6, 18), M.metal(0xa8acb0, 0.3, 0.9), -0.012, top + 0.012, -0.004);
  ring.rotation.y = 0.6;
  k.tubeX(g, 0.0012, 0.02, M.metal(0xa8acb0, 0.3, 0.9), -0.002, top + 0.012, 0, 6);
}

function grenade(g: THREE.Group, kind: GadgetKind): void {
  const k = new Kit(g);
  let top = 0.04;
  if (kind === 'frag') {
    const body = M.polymer(0x4a5236, 0.6);
    k.sphere(g, 0.031, body, 0, 0, 0, 1, 1.15, 1);
    for (const y of [-0.016, 0.0, 0.016]) k.mesh(g, torusGeo(Math.sqrt(Math.max(0.0001, 0.031 * 0.031 - (y / 1.15) ** 2)) + 0.0004, 0.0012, 4, 26), M.polymer(0x2a2f20, 0.7), 0, y, 0, Math.PI / 2, 0, 0);
    k.tubeY(g, 0.011, 0.014, 0.008, M.polymer(0x2a2f20, 0.7), 0, 0.034, 0, 14);
    top = 0.038;
  } else if (kind === 'impact') {
    const body = M.polymer(0x3e4436, 0.6);
    k.sphere(g, 0.03, body, 0, 0, 0, 1, 1.05, 1);
    k.mesh(g, torusGeo(0.0305, 0.003, 6, 26), M.polymer(0xd8701a, 0.5), 0, 0, 0, Math.PI / 2, 0, 0);
    k.sphere(g, 0.014, M.polymer(0xd8701a, 0.5), 0, 0.03, 0, 1, 0.7, 1);
    top = 0.036;
  } else {
    const col = kind === 'smoke' ? 0x5d6556 : kind === 'flash' ? 0x2c2e30 : 0x3a2f2a;
    const band = kind === 'smoke' ? 0xd8d8d0 : kind === 'flash' ? 0x9aa0a6 : 0xb0261a;
    const h = kind === 'flash' ? 0.1 : 0.11, r = kind === 'flash' ? 0.025 : 0.03;
    k.tubeY(g, r, r, h, M.metal(col, 0.55, 0.3), 0, 0, 0, 20);
    k.tubeY(g, r + 0.0006, r + 0.0006, 0.016, M.polymer(band, 0.6), 0, h * 0.2, 0, 20);
    k.tubeY(g, r * 0.9, r, 0.008, M.metal(0x555a5e, 0.5, 0.7), 0, -h / 2 - 0.002, 0, 20);
    if (kind === 'flash') {
      for (let row = 0; row < 3; row++) for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2 + row * 0.4;
        const hb = k.box(g, 0.006, 0.01, 0.0015, M.hole(), Math.cos(a) * (r + 0.0002), -0.03 + row * 0.022, Math.sin(a) * (r + 0.0002));
        hb.rotation.y = -a + Math.PI / 2;
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2;
        k.tubeY(g, 0.003, 0.003, 0.0014, M.hole(), Math.cos(a) * r * 0.6, h / 2 + 0.0004, Math.sin(a) * r * 0.6, 8);
      }
    }
    top = h / 2;
  }
  fuze(k, g, top, kind === 'flash' ? 0.025 : 0.03);
  g.userData.mag = anchor(g, 'mag', 0, 0, 0);
  g.userData.muzzle = anchor(g, 'muzzle', 0, 0, -0.03);
  sightAt(g, 0, 0.2, 0.2, 0.3);
  hands(g, { pos: [0.006, -0.036, 0.02], f: [-0.25, 0.2, -0.95], n: [-0.2, 0.95, -0.25], pose: 'grenade' }, null);
  g.userData.hold = 'throw';
}

// ───────────────────────── entry ─────────────────────────

const KINDS: GadgetKind[] = ['rocket', 'aa', 'repair', 'atmine', 'ugl', 'stim', 'breach', 'medbag', 'ammobag', 'defib', 'cover', 'drone', 'sensor', 'beacon', 'claymore', 'frag', 'smoke', 'flash', 'incendiary', 'impact'];

export function buildGadgetGroup(kind: GadgetKind | string, id: string): THREE.Group {
  const g = new THREE.Group();
  g.name = 'gadget:' + id;
  const kd = (KINDS as string[]).includes(kind) ? (kind as GadgetKind) : 'frag';
  switch (kd) {
    case 'rocket': rocket(g); break;
    case 'aa': aa(g); break;
    case 'repair': repair(g); break;
    case 'atmine': atmine(g); break;
    case 'ugl': ugl(g); break;
    case 'stim': stim(g); break;
    case 'breach': breach(g); break;
    case 'medbag': bag(g, true); break;
    case 'ammobag': bag(g, false); break;
    case 'defib': defib(g); break;
    case 'cover': cover(g); break;
    case 'drone': drone(g); break;
    case 'sensor': sensor(g); break;
    case 'beacon': beacon(g); break;
    case 'claymore': claymore(g); break;
    default: grenade(g, kd); break;
  }
  g.userData.kind = kd;
  g.userData.gadget = true;
  return g;
}

