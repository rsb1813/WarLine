// render-viewmodel: shared gun-building context and reusable parts (grip, trigger guard, magazines, stocks).
// Conventions: metres, muzzle toward -Z, origin at the pistol grip (where the firing hand sits), +Y up, +X right.
import * as THREE from 'three';
import type { AttachmentDef, GunModelSpec, SlotId, WeaponDef } from '../types';
import { Kit, rrect, circlePts, cylGeo, torusGeo } from './vm-geo';
import * as M from './vm-mats';

export type V3 = [number, number, number];

export interface GunMats {
  rec: THREE.Material;       // anodised receiver metal (body colour)
  steel: THREE.Material;     // barrel / small steel parts
  dark: THREE.Material;      // black oxide parts
  poly: THREE.Material;      // polymer furniture (body colour)
  polyDark: THREE.Material;  // near-black polymer (mags, pads)
  accent: THREE.Material;    // anodised accent colour parts
  accentDark: THREE.Material; // muted accent for large surfaces (chassis)
  accentPoly: THREE.Material;
  grip: THREE.Material;      // stippled grip polymer
  rubber: THREE.Material;
  hole: THREE.Material;
  brass: THREE.Material;
  copper: THREE.Material;
  white: THREE.Material;     // sight dots
  fibre: THREE.Material;     // glowing sight fibre
}

export function gunMats(spec: GunModelSpec): GunMats {
  const c = spec.color;
  return {
    rec: M.metal(M.shade(c, 1.05), 0.48, 0.6),
    steel: M.metal(0x1d1e20, 0.36, 0.82),
    dark: M.metal(0x121315, 0.5, 0.55),
    poly: M.polymer(M.shade(c, 0.92), 0.82),
    polyDark: M.polymer(0x1c1d1e, 0.78),
    accent: M.metal(spec.accent, 0.42, 0.55),
    accentDark: M.metal(M.shade(spec.accent, 0.45), 0.5, 0.55),
    accentPoly: M.polymer(spec.accent, 0.75),
    grip: M.stippled(M.shade(c, 0.85)),
    rubber: M.rubber(0x141414),
    hole: M.hole(),
    brass: M.brass(),
    copper: M.copper(),
    white: M.glow(0xe8e8e0, 0.9),
    fibre: M.glow(0x9cff3a, 1.4),
  };
}

/** a hand placement: palm centre, finger direction, palm normal (direction the palm faces), finger pose */
export interface HandSpec { pos: V3; f: V3; n: V3; pose: string }

const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3(), _mb = new THREE.Matrix4();

/** Object3D whose local frame is the hand frame: -Z = fingers, -Y = palm normal, X = Y × Z */
export function handAnchor(parent: THREE.Object3D, h: HandSpec, name: string): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(h.pos[0], h.pos[1], h.pos[2]);
  _Z.set(h.f[0], h.f[1], h.f[2]).normalize().negate();
  _Y.set(h.n[0], h.n[1], h.n[2]).normalize().negate();
  _Y.addScaledVector(_Z, -_Y.dot(_Z)).normalize();
  _X.crossVectors(_Y, _Z);
  _mb.makeBasis(_X, _Y, _Z);
  o.quaternion.setFromRotationMatrix(_mb);
  o.userData.pose = h.pose;
  parent.add(o);
  return o;
}

/** layout numbers a body builder publishes for the attachment builders */
export interface Lay {
  boreY: number;
  railY: number; railF: number; railB: number;
  opticZ: number;
  rearIronZ: number; frontIronZ: number;
  /** front iron sits on the barrel (shotgun bead / pistol) instead of the rail */
  frontOnBarrel: boolean;
  barZ0: number; barLen: number; barR: number; muzzleZ: number;
  ugZ: number; ugY: number; ugMinZ: number; ugMaxZ: number; hasHandguard: boolean;
  sideX: number; sideY: number; sideZ: number;
  hgHalfW: number; hgHalfH: number; hgCY: number;
  leftHand: HandSpec;
  magThick: number;
  pistol: boolean;
}

export type AttMap = Record<SlotId, AttachmentDef | null>;

export interface GunCtx {
  k: Kit; root: THREE.Group; def: WeaponDef; spec: GunModelSpec; m: GunMats; att: AttMap;
  L: Lay;
  /** objects published to userData */
  ud: Record<string, unknown>;
  /** slide group (pistol) where slide-mounted optics go */
  slide: THREE.Group | null;
}

export function attId(c: GunCtx, slot: SlotId): string { return c.att[slot]?.id ?? ''; }
export function has(id: string, ...keys: string[]): boolean { return keys.some(k => id.includes(k)); }

// ───────────────────────── grip & trigger ─────────────────────────

/** pistol grip profile; returns the firing-hand placement */
export function pistolGrip(c: GunCtx, parent: THREE.Object3D, o: { tilt?: number; h?: number; thick?: number; depth?: number; z0?: number; top?: number; mat?: THREE.Material } = {}): HandSpec {
  const tilt = o.tilt ?? 0.31, h = o.h ?? 0.105, th = o.thick ?? 0.028, d = o.depth ?? 0.044;
  const z0 = o.z0 ?? -0.006, top = o.top ?? 0.006;
  const t = Math.tan(tilt), tf = t * 0.86;
  const pts: [number, number][] = [];
  pts.push([z0, top]);
  pts.push([z0 + d + 0.004, top]);
  pts.push([z0 + d + 0.011, top - 0.008]);             // beavertail
  pts.push([z0 + d + 0.004, top - 0.015]);
  pts.push([z0 + d + 0.003 + (h - 0.02) * t, top - h + 0.008]);
  pts.push([z0 + d - 0.002 + (h - 0.012) * t, top - h]);
  const bf: [number, number] = [z0 + h * tf + 0.01, top - h - 0.002];
  pts.push(bf);
  // front edge with finger grooves, from bottom to top
  const n = 7;
  for (let i = 1; i < n; i++) {
    const s = i / n;
    const z = bf[0] + (z0 - bf[0]) * s, y = bf[1] + (top - bf[1]) * s;
    const bump = i % 2 === 1 ? -0.0028 : 0.0012;
    pts.push([z + bump, y]);
  }
  c.k.side(parent, pts, th, o.mat ?? c.m.grip, 0, 0.0035);
  // grip backstrap panel / base cap
  c.k.box(parent, th + 0.002, 0.006, d * 0.95, c.m.polyDark, 0, top - h + 0.001, z0 + d * 0.5 + h * t * 0.92, 0.002, -tilt * 0.05);
  const yh = top - 0.05;
  const zc = z0 + d * 0.5 + (top - yh) * t * 0.93;
  const a = tilt * 0.45;
  return { pos: [th / 2 + 0.0135, yh + 0.004, zc + 0.017], f: [0, -Math.sin(a), -Math.cos(a)], n: [-1, 0, 0.05], pose: 'grip' };
}

/** trigger guard loop + trigger blade between z0 (front) and z1 (rear) under y = top */
export function triggerGuard(c: GunCtx, parent: THREE.Object3D, z0: number, z1: number, top: number, depth = 0.026, mat?: THREE.Material): void {
  const w = z1 - z0, cz = (z0 + z1) / 2;
  const outer = rrect(cz, top - depth / 2, w, depth, 0.008);
  const inner = rrect(cz + 0.002, top - depth / 2 + 0.002, w - 0.008, depth - 0.008, 0.006).reverse();
  c.k.side(parent, outer, 0.009, mat ?? c.m.poly, 0, 0.0015, [inner]);
  // trigger blade (curved via 3 segments)
  const tz = z0 + w * 0.42;
  const tg = c.k.group(parent, 0, top - 0.002, tz);
  c.k.box(tg, 0.0055, 0.008, 0.005, c.m.dark, 0, -0.004, 0, 0.001, 0.15);
  c.k.box(tg, 0.0055, 0.008, 0.0048, c.m.dark, 0, -0.0115, -0.0015, 0.001, -0.15);
  c.k.box(tg, 0.0055, 0.006, 0.0045, c.m.dark, 0, -0.0175, 0.0005, 0.001, -0.5);
}

// ───────────────────────── magazines ─────────────────────────

export type MagStyle = 'std' | 'ext' | 'drum' | 'fast' | 'light';
export function magStyle(c: GunCtx): { style: MagStyle; len: number; size: number } {
  const a = c.att.magazine;
  const id = a?.id ?? '';
  const add = a?.mods.magAdd ?? 0;
  let style: MagStyle = 'std';
  if (has(id, 'drum')) style = 'drum';
  else if (has(id, 'fast', 'dual', 'coupl')) style = 'fast';
  else if (has(id, 'light', 'small', 'short')) style = 'light';
  else if (has(id, 'ext')) style = 'ext';
  else if (add > 0) style = add >= c.def.mag * 0.8 ? 'drum' : 'ext';
  else if (add < 0) style = 'light';
  const len = a?.model?.len ?? (style === 'ext' ? 1.35 : style === 'light' ? 0.72 : 1);
  const size = a?.model?.size ?? 1;
  return { style, len, size };
}

export interface BoxMagOpts {
  /** total length from the top (inside the well) to the floorplate */
  len: number;
  depth: number; thick: number;
  /** total bend in radians (positive bends forward, -Z) */
  curve: number;
  mat?: THREE.Material;
  ribs?: boolean;
  plate?: THREE.Material;
}

/** single box/curved magazine, top centre at the group's origin, hanging down. Returns the y of the floorplate centre. */
export function boxMag(c: GunCtx, g: THREE.Object3D, o: BoxMagOpts, x = 0): { bottom: [number, number]; ang: number } {
  const N = 10;
  const back: [number, number][] = [], front: [number, number][] = [];
  const R = o.curve > 0.001 ? o.len / o.curve : 0;
  let last: [number, number] = [0, -o.len], ang = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const th = o.curve * t;
    const cz = R ? -R * (1 - Math.cos(th)) : 0;
    const cy = R ? -R * Math.sin(th) : -o.len * t;
    const w = o.depth * (1 + 0.06 * t);
    const nz = Math.cos(th), ny = -Math.sin(th);
    back.push([cz + nz * w / 2, cy + ny * w / 2]);
    front.push([cz - nz * w / 2, cy - ny * w / 2]);
    if (i === N) { last = [cz, cy]; ang = th; }
  }
  const pts = [...back, ...front.reverse()];
  const mat = o.mat ?? c.m.polyDark;
  c.k.side(g, pts, o.thick, mat, x, 0.0022);
  // floorplate
  const plate = c.k.box(g, o.thick + 0.004, 0.009, o.depth * 1.12, o.plate ?? mat, x, last[1] - 0.002, last[0], 0.0025);
  plate.rotation.x = ang;
  // side ribs / witness ridges
  if (o.ribs !== false) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const t = 0.3 + i * 0.2;
        const th = o.curve * t;
        const cz = R ? -R * (1 - Math.cos(th)) : 0;
        const cy = R ? -R * Math.sin(th) : -o.len * t;
        const r = c.k.box(g, 0.002, o.len * 0.14, o.depth * 0.5, mat, x + side * (o.thick / 2 + 0.0006), cy, cz + o.depth * 0.08, 0.0008);
        r.rotation.x = th;
      }
    }
  }
  return { bottom: last, ang };
}

/**
 * Build the detachable magazine for box-mag bodies at (z, top). Returns the mag group (dynamic) with a hand anchor.
 * base: caliber-based geometry (len for the standard mag).
 */
export function buildMag(c: GunCtx, z: number, top: number, base: { len: number; depth: number; thick: number; curve: number }): THREE.Group {
  const g = c.k.group(c.root, 0, top, z, true, 'mag');
  const ms = magStyle(c);
  const len = base.len * (ms.style === 'drum' ? 0.42 : ms.len);
  const plateMat = ms.style === 'fast' ? c.m.accentPoly : c.m.polyDark;
  const main = boxMag(c, g, { len, depth: base.depth, thick: base.thick, curve: ms.style === 'drum' ? 0 : base.curve, plate: plateMat });
  if (ms.style === 'drum') {
    const r = 0.052 * Math.min(1.25, Math.max(0.8, ms.size / 1.45));
    const cy = main.bottom[1] - r * 0.72, cz = main.bottom[0] - 0.004;
    const dg = c.k.group(g, 0, cy, cz);
    // drum body: two shells with a seam, rim and winding key
    c.k.mesh(dg, cylGeoX(r, 0.05), c.m.polyDark, 0, 0, 0);
    c.k.mesh(dg, cylGeoX(r * 1.03, 0.008), c.m.polyDark, 0, 0, 0);
    c.k.mesh(dg, cylGeoX(r * 0.55, 0.054), c.m.rubber, 0, 0, 0);
    c.k.mesh(dg, cylGeoX(r * 0.2, 0.06), c.m.accent, 0, 0, 0);
    c.k.box(dg, 0.006, 0.006, r * 0.8, c.m.accent, 0.031, 0, 0, 0.001);     // winding key
    // round-count window
    c.k.box(dg, 0.052, 0.01, r * 0.6, c.m.brass, 0, r * 0.62, -r * 0.35, 0.002, -0.7);
    c.k.box(g, base.thick + 0.003, 0.03, base.depth * 0.9, c.m.polyDark, 0, main.bottom[1] - 0.004, main.bottom[0], 0.003);
  } else if (ms.style === 'fast') {
    // second mag coupled on the right, plus clamp blocks and a pull loop
    boxMag(c, g, { len, depth: base.depth, thick: base.thick, curve: base.curve, plate: plateMat }, base.thick + 0.006);
    for (const t of [0.42, 0.78]) {
      const th = base.curve * t;
      const R = base.curve > 0.001 ? len / base.curve : 0;
      const cz = R ? -R * (1 - Math.cos(th)) : 0, cy = R ? -R * Math.sin(th) : -len * t;
      const cl = c.k.box(c.k.group(g, 0, 0, 0), base.thick * 2 + 0.012, 0.014, base.depth * 0.95, c.m.dark, (base.thick + 0.006) / 2, cy, cz, 0.002);
      cl.rotation.x = th;
    }
    const loop = c.k.mesh(g, M_torus(0.012, 0.0025), c.m.accentPoly, 0, main.bottom[1] - 0.014, main.bottom[0]);
    loop.rotation.y = Math.PI / 2;
  } else if (ms.style === 'ext') {
    // extended baseplate bumper
    const b = c.k.box(g, base.thick + 0.006, 0.014, base.depth * 1.18, c.m.accentPoly, 0, main.bottom[1] - 0.008, main.bottom[0], 0.004);
    b.rotation.x = main.ang;
  }
  // hand anchor: left hand grabbing the mag body from the left/front
  const hy = -Math.min(len, 0.12) * 0.62 - 0.02;
  handAnchor(g, { pos: [-base.thick / 2 - 0.014, hy, 0.006], f: [0.15, -0.2, -1], n: [1, 0, 0.15], pose: 'wrap' }, 'magHand');
  c.ud.mag = g;
  return g;
}

// tiny geometry helpers local to parts
function cylGeoX(r: number, len: number): THREE.BufferGeometry {
  const g = cylGeo(r, r, len, 22).clone();
  g.rotateZ(Math.PI / 2);
  return g;
}
function M_torus(r: number, t: number): THREE.BufferGeometry { return torusGeo(r, t, 6, 16); }

// ───────────────────────── stocks ─────────────────────────

export type StockStyle = 'std' | 'light' | 'heavy' | 'fold' | 'cheek' | 'none' | 'brace';
export function stockStyle(c: GunCtx): { style: StockStyle; len: number; size: number } {
  const a = c.att.stock; const id = a?.id ?? '';
  let style: StockStyle = 'std';
  if (has(id, 'none')) style = 'none';
  else if (has(id, 'brace')) style = 'brace';
  else if (has(id, 'fold')) style = 'fold';
  else if (has(id, 'light', 'skel')) style = 'light';
  else if (has(id, 'heavy')) style = 'heavy';
  else if (has(id, 'cheek')) style = 'cheek';
  return { style, len: a?.model?.len && style !== 'fold' ? Math.min(1.25, Math.max(0.6, a.model.len)) : 1, size: a?.model?.size ?? 1 };
}

/**
 * AR-family stock on a buffer tube.
 * z0: rear of receiver; y: buffer tube axis; kind: rifle | smg | lmg | dmr
 */
export function buildStock(c: GunCtx, z0: number, y: number, kind: 'rifle' | 'smg' | 'lmg' | 'dmr', sideHalf: number): void {
  const k = c.k, m = c.m, P = c.root;
  const st = stockStyle(c);
  const lenK = st.len;
  if (st.style === 'none') { k.box(P, 0.02, 0.03, 0.012, m.dark, 0, y, z0 + 0.004, 0.003); return; }

  if (st.style === 'fold') {
    // hinge block + folded skeleton stock along the left side, butt toward the muzzle
    k.span(P, sideHalf * 2 + 0.006, y - 0.02, y + 0.018, z0 - 0.002, z0 + 0.024, m.dark, 0, 0.004);
    k.tubeY(P, 0.005, 0.005, 0.045, m.steel, -sideHalf - 0.006, y, z0 + 0.016);
    const fg = k.group(P, -sideHalf - 0.012, 0, z0 + 0.012);
    fg.rotation.y = Math.PI;
    skeletonStock(c, fg, 0, y, 0.2, 0.012);
    return;
  }

  // buffer tube with castle nut & end plate
  const tubeLen = kind === 'smg' ? 0.15 : kind === 'lmg' ? 0.0 : 0.2 * Math.max(0.85, lenK);
  if (kind !== 'lmg') {
    k.tubeZ(P, 0.0155, 0.0155, z0 - 0.004, z0 + tubeLen, m.rec, 0, y, 20);
    k.tubeZ(P, 0.019, 0.019, z0 - 0.002, z0 + 0.008, m.dark, 0, y, 8);
    k.box(P, 0.03, 0.04, 0.004, m.dark, 0, y - 0.004, z0 + 0.002, 0.002);
    // tube adjustment holes on the bottom
    for (let i = 0; i < 5; i++) k.box(P, 0.004, 0.002, 0.004, m.hole, 0, y - 0.0156, z0 + 0.05 + i * 0.024);
  }

  if (kind === 'smg' && st.style === 'std') {
    // collapsible wire stock: two rods + butt plate
    const zb = z0 + 0.2 * lenK;
    for (const sx of [-1, 1]) k.tubeZ(P, 0.0042, 0.0042, z0 - 0.01, zb, m.steel, sx * 0.0135, y + 0.012, 10);
    k.span(P, 0.034, y - 0.006, y + 0.026, z0 - 0.012, z0 + 0.004, m.dark, 0, 0.003);
    k.side(P, [[zb - 0.006, y + 0.028], [zb + 0.012, y + 0.03], [zb + 0.014, y - 0.075], [zb - 0.002, y - 0.078], [zb - 0.008, y - 0.04]], 0.036, m.poly, 0, 0.004);
    k.side(P, [[zb + 0.012, y + 0.031], [zb + 0.022, y + 0.029], [zb + 0.024, y - 0.076], [zb + 0.013, y - 0.078]], 0.038, m.rubber, 0, 0.003);
    return;
  }
  if (st.style === 'light') { skeletonStock(c, P, z0 + 0.06, y, 0.17 * lenK, 0.016); return; }

  const heavy = st.style === 'heavy';
  const cheek = st.style === 'cheek' || (kind === 'dmr' && st.style === 'std');
  const sb = kind === 'lmg' ? z0 : z0 + 0.075;
  const se = kind === 'lmg' ? z0 + 0.27 * lenK : z0 + 0.075 + (heavy ? 0.17 : 0.15) * lenK;
  const ty = y + (heavy ? 0.03 : 0.026), toe = y - (heavy ? 0.11 : kind === 'lmg' ? 0.1 : 0.098);
  const th = (heavy ? 0.046 : kind === 'lmg' ? 0.044 : 0.04) * Math.min(1.2, st.size);
  let pts: [number, number][];
  if (kind === 'lmg') {
    pts = [[sb, ty - 0.004], [se - 0.012, ty + 0.004], [se, ty + 0.002], [se, toe], [se - 0.014, toe],
      [se - 0.1, y - 0.045], [sb + 0.06, y - 0.05], [sb + 0.02, y - 0.055], [sb, y - 0.04]];
  } else if (heavy) {
    pts = [[sb - 0.015, ty - 0.002], [sb + 0.02, ty + 0.002], [se - 0.008, ty + 0.006], [se, ty + 0.004], [se, toe - 0.006], [se - 0.05, toe - 0.006],
      [sb + 0.03, y - 0.042], [sb - 0.015, y - 0.026]];
  } else {
    pts = [[sb, ty - 0.004], [sb + 0.02, ty], [se - 0.01, ty + 0.004], [se, ty + 0.002], [se, toe], [se - 0.012, toe],
      [se - 0.07, y - 0.03], [sb + 0.035, y - 0.022], [sb, y - 0.016]];
  }
  k.side(P, pts, th, m.poly, 0, 0.006);
  // butt pad
  k.side(P, [[se - 0.002, ty + 0.004], [se + (heavy ? 0.022 : 0.013), ty + 0.002], [se + (heavy ? 0.024 : 0.015), toe + 0.002], [se - 0.002, toe - 0.002]], th + 0.003, m.rubber, 0, 0.003);
  if (kind !== 'lmg' && !heavy) {
    // SOPMOD-ish battery tubes on both sides
    for (const sx of [-1, 1]) k.tubeZ(P, 0.0105, 0.0105, sb + 0.025, se - 0.03, m.poly, sx * (th / 2 - 0.002), y + 0.002, 12);
    k.box(P, 0.01, 0.006, 0.03, m.dark, 0, y - 0.022, sb + 0.03, 0.002, 0.3);   // adjustment lever
  }
  if (kind === 'lmg') {
    // grip hollow + sling swivel
    k.box(P, th + 0.002, 0.012, 0.06, m.polyDark, 0, y - 0.03, sb + 0.08, 0.004);
  }
  if (cheek || heavy) {
    const rz0 = sb + 0.03, rz1 = se - 0.03, ry = ty + 0.004;
    k.span(P, th * 0.85, ry - 0.004, ry + (cheek ? 0.022 : 0.015), rz0, rz1, cheek ? m.accentPoly : m.poly, 0, 0.005);
    for (const sx of [-1, 1]) k.tubeY(P, 0.003, 0.003, 0.02, m.steel, sx * 0.008, ry - 0.004, rz0 + 0.02);
  }
  // sling QD socket
  k.tubeX(P, 0.005, th + 0.004, m.steel, 0, y - 0.006, se - 0.03);
}

/** skeleton stock plate (light). z0 = start, y = tube axis */
export function skeletonStock(c: GunCtx, P: THREE.Object3D, z0: number, y: number, len: number, th: number): void {
  const k = c.k, m = c.m;
  const se = z0 + len, ty = y + 0.026, toe = y - 0.092;
  const outer: [number, number][] = [[z0, ty - 0.004], [se - 0.006, ty + 0.002], [se, ty], [se, toe], [se - 0.02, toe], [z0 + 0.012, y - 0.02], [z0, y - 0.018]];
  const hole: [number, number][] = [[z0 + 0.03, ty - 0.012], [se - 0.016, ty - 0.01], [se - 0.016, toe + 0.016], [se - 0.03, toe + 0.016], [z0 + 0.035, y - 0.006]].reverse() as [number, number][];
  k.side(P, outer, th, m.poly, 0, 0.003, [hole]);
  k.side(P, [[se - 0.002, ty + 0.002], [se + 0.01, ty + 0.001], [se + 0.011, toe + 0.002], [se - 0.002, toe]], th + 0.006, m.rubber, 0, 0.003);
  k.tubeZ(P, 0.0175, 0.0175, z0 - 0.004, z0 + 0.04, m.poly, 0, y, 14);
}

// ───────────────────────── misc details ─────────────────────────

/** M-LOK style slots on a handguard with section (hw, hh) centred at (0, cy) between z0 (front) and z1 (rear) */
export function mlokSlots(c: GunCtx, P: THREE.Object3D, z0: number, z1: number, cy: number, hw: number, hh: number, bottom = true): void {
  const len = Math.abs(z1 - z0);
  const n = Math.max(1, Math.floor((len - 0.02) / 0.042));
  const step = (len - 0.02) / n;
  for (let i = 0; i < n; i++) {
    const z = Math.min(z0, z1) + 0.01 + step * (i + 0.5);
    for (const sx of [-1, 1]) {
      c.k.box(P, 0.0012, 0.0072, step * 0.62, c.m.hole, sx * (hw + 0.0002), cy - hh * 0.12, z, 0);
    }
    if (bottom) c.k.box(P, 0.0072, 0.0012, step * 0.62, c.m.hole, 0, cy - hh - 0.0002, z, 0);
  }
  // lightening cuts on the upper bevels
  const n2 = Math.max(1, Math.floor(len / 0.05));
  for (let i = 0; i < n2; i++) {
    const z = Math.min(z0, z1) + (i + 0.5) * (len / n2);
    for (const sx of [-1, 1]) {
      const b = c.k.box(P, 0.001, 0.006, 0.016, c.m.hole, sx * (hw - 0.004), cy + hh * 0.66, z);
      b.rotation.z = sx * 0.75;
    }
  }
}

/** handguard tube: rounded-rect front profile extruded from zFront to zBack */
export function handguard(c: GunCtx, P: THREE.Object3D, zFront: number, zBack: number, cy: number, w: number, h: number, mat: THREE.Material, r = 0.012): void {
  const len = zBack - zFront;
  c.k.front(P, rrect(0, cy, w, h, r, 3), len, mat, (zFront + zBack) / 2, 0.0015);
  // front end cap ring (accent)
  const ring = rrect(0, cy, w + 0.002, h + 0.002, r + 0.001, 3);
  c.k.front(P, ring, 0.006, c.m.accent, zFront + 0.002, 0.001, [circlePts(0, c.L.boreY, c.L.barR * 1.25, 14).reverse()]);
}

/** sling / QD swivel loop */
export function qdLoop(c: GunCtx, P: THREE.Object3D, x: number, y: number, z: number): void {
  c.k.tubeX(P, 0.0055, 0.006, c.m.steel, x, y, z, 10);
  const t = c.k.mesh(P, torusGeo(0.0075, 0.0016, 5, 12), c.m.steel, x + Math.sign(x) * 0.006, y - 0.004, z);
  t.rotation.y = Math.PI / 2;
}
