// render-viewmodel: procedural geometry kit + static mesh merging.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const geoCache = new Map<string, THREE.BufferGeometry>();
function cg(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function boxGeo(w: number, h: number, d: number, r = 0): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  if (rr > 0.0004) return cg(`rb:${r4(w)}:${r4(h)}:${r4(d)}:${r4(rr)}`, () => new RoundedBoxGeometry(w, h, d, 2, rr));
  return cg(`b:${r4(w)}:${r4(h)}:${r4(d)}`, () => new THREE.BoxGeometry(w, h, d));
}
/** cylinder along +Y (three default) */
export function cylGeo(rt: number, rb: number, h: number, seg = 16, open = false): THREE.BufferGeometry {
  return cg(`c:${r4(rt)}:${r4(rb)}:${r4(h)}:${seg}:${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
}
export function sphereGeo(r: number, ws = 14, hs = 10): THREE.BufferGeometry {
  return cg(`s:${r4(r)}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
}
export function torusGeo(r: number, tube: number, rs = 8, ts = 20, arc = Math.PI * 2): THREE.BufferGeometry {
  return cg(`t:${r4(r)}:${r4(tube)}:${rs}:${ts}:${r4(arc)}`, () => new THREE.TorusGeometry(r, tube, rs, ts, arc));
}
export function planeGeo(w: number, h: number): THREE.BufferGeometry {
  return cg(`p:${r4(w)}:${r4(h)}`, () => new THREE.PlaneGeometry(w, h));
}
export function circleGeo(r: number, seg = 20): THREE.BufferGeometry {
  return cg(`ci:${r4(r)}:${seg}`, () => new THREE.CircleGeometry(r, seg));
}
/** capsule along +Y, total height h */
export function capsuleGeo(r: number, h: number, seg = 10): THREE.BufferGeometry {
  return cg(`cap:${r4(r)}:${r4(h)}:${seg}`, () => new THREE.CapsuleGeometry(r, Math.max(0.0001, h - 2 * r), 4, seg));
}

/**
 * Side-profile extrusion. pts are [z, y] (gun coordinates: z back +, y up). Extruded across X, centred on x = 0.
 * holes: optional inner polygons (same coordinate space).
 */
export function sideGeo(pts: [number, number][], thick: number, bevel = 0.0015, holes: [number, number][][] = [], curveSeg = 1): THREE.BufferGeometry {
  const key = `side:${pts.map(p => r4(p[0]) + ',' + r4(p[1])).join(';')}:${r4(thick)}:${r4(bevel)}:${holes.map(h => h.map(p => r4(p[0]) + ',' + r4(p[1])).join(';')).join('|')}`;
  return cg(key, () => {
    const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
    for (const h of holes) sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
    const b = Math.min(bevel, thick * 0.45);
    const depth = Math.max(0.0005, thick - 2 * b);
    const g = new THREE.ExtrudeGeometry(sh, {
      depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.9, bevelSegments: 2, curveSegments: curveSeg,
    });
    // shape (u=z, v=y), extrusion along +Z → rotate so extrusion runs along X and u maps to z.
    g.rotateY(-Math.PI / 2);
    // after rotation: x = -depthCoord, so geometry spans x in [-depth - b, b]; centre it
    g.translate(depth / 2, 0, 0);
    g.computeVertexNormals();
    return g;
  });
}

/** front-profile extrusion: pts are [x, y], extruded along Z (length d), centred on z = 0 */
export function frontGeo(pts: [number, number][], d: number, bevel = 0.001, holes: [number, number][][] = []): THREE.BufferGeometry {
  const key = `front:${pts.map(p => r4(p[0]) + ',' + r4(p[1])).join(';')}:${r4(d)}:${r4(bevel)}:${holes.map(h => h.map(p => r4(p[0]) + ',' + r4(p[1])).join(';')).join('|')}`;
  return cg(key, () => {
    const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
    for (const h of holes) sh.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))));
    const b = Math.min(bevel, d * 0.45);
    const depth = Math.max(0.0005, d - 2 * b);
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.9, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    g.computeVertexNormals();
    return g;
  });
}

/** lathe around the Z axis: pts are [r, z] */
export function latheZ(pts: [number, number][], seg = 20): THREE.BufferGeometry {
  return cg(`lz:${pts.map(p => r4(p[0]) + ',' + r4(p[1])).join(';')}:${seg}`, () => {
    // LatheGeometry revolves around Y with points (x=r, y=h); then rotate Y→Z
    const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(Math.max(0.00001, p[0]), -p[1])), seg);
    g.rotateX(-Math.PI / 2);
    // y = -z  -> after rotateX(-90): (x, y, z) → (x, z, -y)... map so that input z is world z
    return g;
  });
}

/** rounded rectangle polygon (for profiles) */
export function rrect(cx: number, cy: number, w: number, h: number, r: number, seg = 3): [number, number][] {
  const out: [number, number][] = [];
  const hw = w / 2, hh = h / 2; r = Math.min(r, hw, hh);
  const corners: [number, number, number][] = [
    [cx + hw - r, cy + hh - r, 0], [cx - hw + r, cy + hh - r, Math.PI / 2],
    [cx - hw + r, cy - hh + r, Math.PI], [cx + hw - r, cy - hh + r, Math.PI * 1.5],
  ];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
  }
  return out;
}

/** polygon approximating a circle */
export function circlePts(cx: number, cy: number, r: number, n = 16, a0 = 0): [number, number][] {
  const o: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return o;
}

// ───────────────────────── kit ─────────────────────────

export type Parent = THREE.Object3D;
const _e = new THREE.Euler();

export class Kit {
  constructor(public root: THREE.Group) {}

  mesh(parent: Parent, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.copy(_e.set(rx, ry, rz));
    parent.add(m);
    return m;
  }
  /** axis-aligned (optionally rounded) box centred at x,y,z */
  box(parent: Parent, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, r = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    return this.mesh(parent, boxGeo(w, h, d, r), mat, x, y, z, rx, ry, rz);
  }
  /** box spanning y0..y1 and z0..z1 (common for gun parts) */
  span(parent: Parent, w: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material, x = 0, r = 0): THREE.Mesh {
    return this.box(parent, w, Math.abs(y1 - y0), Math.abs(z1 - z0), mat, x, (y0 + y1) / 2, (z0 + z1) / 2, r);
  }
  /** cylinder along Z from z0 to z1 at (x, y) */
  tubeZ(parent: Parent, r0: number, r1: number, z0: number, z1: number, mat: THREE.Material, x = 0, y = 0, seg = 18, open = false): THREE.Mesh {
    // cylinder geometry: top (rt) at +Y; rotateX(-90°) maps +Y to -Z. We want radius r0 at z0 and r1 at z1.
    const zMin = Math.min(z0, z1), zMax = Math.max(z0, z1);
    const rAtMin = z0 <= z1 ? r0 : r1, rAtMax = z0 <= z1 ? r1 : r0;
    return this.mesh(parent, cylGeo(rAtMin, rAtMax, zMax - zMin, seg, open), mat, x, y, (zMin + zMax) / 2, -Math.PI / 2, 0, 0);
  }
  /** cylinder along X centred at x,y,z */
  tubeX(parent: Parent, r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, seg = 16): THREE.Mesh {
    return this.mesh(parent, cylGeo(r, r, len, seg), mat, x, y, z, 0, 0, Math.PI / 2);
  }
  /** cylinder along Y centred at x,y,z */
  tubeY(parent: Parent, rt: number, rb: number, len: number, mat: THREE.Material, x: number, y: number, z: number, seg = 16): THREE.Mesh {
    return this.mesh(parent, cylGeo(rt, rb, len, seg), mat, x, y, z);
  }
  side(parent: Parent, pts: [number, number][], thick: number, mat: THREE.Material, x = 0, bevel = 0.0015, holes: [number, number][][] = []): THREE.Mesh {
    return this.mesh(parent, sideGeo(pts, thick, bevel, holes), mat, x, 0, 0);
  }
  front(parent: Parent, pts: [number, number][], d: number, mat: THREE.Material, z: number, bevel = 0.001, holes: [number, number][][] = []): THREE.Mesh {
    return this.mesh(parent, frontGeo(pts, d, bevel, holes), mat, 0, 0, z);
  }
  lathe(parent: Parent, pts: [number, number][], mat: THREE.Material, x = 0, y = 0, z = 0, seg = 20): THREE.Mesh {
    return this.mesh(parent, latheZ(pts, seg), mat, x, y, z);
  }
  sphere(parent: Parent, r: number, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.Mesh {
    const m = this.mesh(parent, sphereGeo(r), mat, x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  }
  group(parent: Parent, x = 0, y = 0, z = 0, dyn = false, name = ''): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (dyn) g.userData.dyn = true;
    if (name) g.name = name;
    parent.add(g);
    return g;
  }
  anchor(parent: Parent, x: number, y: number, z: number, name = ''): THREE.Object3D {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    if (name) o.name = name;
    parent.add(o);
    return o;
  }
  /** picatinny-style rail from z0 to z1 with cross slots. top = y of rail top. axis: 'top' | 'left' | 'right' | 'bottom' */
  rail(parent: Parent, z0: number, z1: number, top: number, mat: THREE.Material, slotMat: THREE.Material, where: 'top' | 'left' | 'right' | 'bottom' = 'top', cx = 0, cy = 0): void {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    const n = Math.max(1, Math.floor(len / 0.01));
    const g = this.group(parent, 0, 0, 0);
    // build as a top rail at origin then rotate group
    const H = 0.0065, W = 0.0215;
    this.box(g, W * 0.72, H * 0.55, len, mat, 0, -H * 0.72, zc);                 // web
    this.box(g, W, H * 0.45, len, mat, 0, -H * 0.27, zc, 0.0006);                 // head
    for (let i = 0; i < n; i++) {
      const z = Math.min(z0, z1) + (i + 0.5) * (len / n);
      this.box(g, W + 0.0004, H * 0.2, 0.0045, slotMat, 0, -H * 0.12 + 0.0002, z);
    }
    if (where === 'top') { g.position.set(cx, top, 0); }
    else if (where === 'bottom') { g.rotation.z = Math.PI; g.position.set(cx, top, 0); }
    else if (where === 'right') { g.rotation.z = -Math.PI / 2; g.position.set(top, cy, 0); }
    else { g.rotation.z = Math.PI / 2; g.position.set(-top, cy, 0); }
  }
}

// ───────────────────────── baking ─────────────────────────

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

function prep(geo: THREE.BufferGeometry, mat: THREE.Matrix4): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.uv) {
    const n = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  g.applyMatrix4(mat);
  if (mat.determinant() < 0) {
    // mirrored: flip triangle winding to keep faces outward
    const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 3) {
      for (const a of [pos, nor, uv]) {
        const s = a.itemSize;
        for (let k = 0; k < s; k++) {
          const t = a.array[(i + 1) * s + k];
          (a.array as Float32Array)[(i + 1) * s + k] = a.array[(i + 2) * s + k];
          (a.array as Float32Array)[(i + 2) * s + k] = t;
        }
      }
    }
  }
  g.morphAttributes = {};
  return g;
}

/**
 * Merge static meshes into one mesh per material. Groups flagged userData.dyn = true are kept as separate
 * containers (merged within themselves) so they can be animated. Meshes with userData.keep stay untouched.
 */
export function bake(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const containers: THREE.Object3D[] = [root];
  root.traverse(o => { if (o !== root && o.userData.dyn) containers.push(o); });
  for (const c of containers) {
    const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; order: number; meshes: THREE.Mesh[] }>();
    _inv.copy(c.matrixWorld).invert();
    const visit = (o: THREE.Object3D) => {
      for (const ch of o.children) {
        if (ch.userData.dyn) continue;
        if ((ch as THREE.Mesh).isMesh && !ch.userData.keep && !Array.isArray((ch as THREE.Mesh).material)) {
          const mesh = ch as THREE.Mesh;
          const mat = mesh.material as THREE.Material;
          let e = byMat.get(mat);
          if (!e) { e = { geos: [], order: mesh.renderOrder, meshes: [] }; byMat.set(mat, e); }
          _m.multiplyMatrices(_inv, mesh.matrixWorld);
          e.geos.push(prep(mesh.geometry, _m));
          e.meshes.push(mesh);
        }
        visit(ch);
      }
    };
    visit(c);
    for (const [mat, e] of byMat) {
      if (!e.geos.length) continue;
      const merged = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false);
      if (!merged) continue;
      if (e.geos.length > 1) for (const g of e.geos) g.dispose();
      merged.computeBoundingSphere();
      for (const m of e.meshes) m.parent?.remove(m);
      const mm = new THREE.Mesh(merged, mat);
      mm.renderOrder = e.order;
      mm.userData.baked = true;
      c.add(mm);
    }
  }
  // prune empty plain groups (keep anchors / named objects)
  const prune = (o: THREE.Object3D) => {
    for (const ch of [...o.children]) {
      prune(ch);
      if ((ch as THREE.Group).isGroup && !ch.name && !ch.userData.dyn && ch.children.length === 0) o.remove(ch);
    }
  };
  prune(root);
}

/** dispose geometries of baked meshes (materials are shared & cached) */
export function disposeModel(root: THREE.Object3D): void {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.userData.baked) m.geometry.dispose();
  });
}
