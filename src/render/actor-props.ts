// 투사체(로켓·미사일·포탄·유탄·투척물)와 설치물(상자·지뢰·클레이모어·폭약·비컨·감지기·방벽·드론) 모델.
import * as THREE from 'three';
import type { Game, Placed, PlacedKind, Projectile, Quality, Side } from '../types';
import { FACTIONS, GADGETS } from '../defs';
import { GeoBuilder, inView, type ActorCtx } from './actor-geo';
import { IPart } from './actor-inst';

const OD = 0x4f5a3c, OD2 = 0x3c4430, BLK = 0x1b1c1d, STEEL = 0x45484b, TAN = 0xb39a68, WHITE = 0xeeeeea, RED = 0xc01e1e, YEL = 0xd8b030;

// ───────── 투사체 기하 (앞 -Z) ─────────
function rocketGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylZ(0.045, 0.8, 0, 0, 0, 0xcfd0c8, 10);
  b.cylZ(0.045, 0.22, 0, 0, -0.51, 0xb8b8b0, 10, 0.012);           // 탄두
  b.cylZ(0.047, 0.04, 0, 0, -0.3, 0x9a9a92, 10);
  b.cylZ(0.035, 0.08, 0, 0, 0.43, 0x333333, 8);                     // 노즐
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.add(new THREE.BoxGeometry(0.004, 0.09, 0.14), new THREE.Matrix4().makeRotationZ(a).multiply(new THREE.Matrix4().makeTranslation(0, 0.075, 0.3)), 0x8c8c86);
  }
  return b.build();
}
function flameGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.ConeGeometry(0.06, 0.7, 8, 1, true), new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, 0, 0.8), 0xffb050);
  b.sphere(0.075, 0, 0, 0.48, 0xfff0c0, 1, 1, 1.4, 8, 6);
  return b.build();
}
function shellGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylZ(0.035, 0.55, 0, 0, 0, 0xffd080, 6, 0.02);
  b.sphere(0.05, 0, 0, -0.2, 0xfff2c8, 1, 1, 1.5, 6, 5);
  return b.build();
}
function uglGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylZ(0.02, 0.07, 0, 0, 0.01, 0xb08a3a, 8);
  b.sphere(0.02, 0, 0, -0.025, 0x4f5a3c, 1, 1, 1.3, 8, 5);
  return b.build();
}
function thrownGeo(kind: string): THREE.BufferGeometry {
  const b = new GeoBuilder();
  switch (kind) {
    case 'smoke':
      b.cyl(0.032, 0.032, 0.13, 0, 0, 0, 0x7a8678, 0, 0, 0, 10);
      b.cyl(0.033, 0.033, 0.02, 0, 0.03, 0, 0xd0d0c8, 0, 0, 0, 10);
      b.box(0.012, 0.09, 0.02, 0.035, 0.01, 0, STEEL);
      break;
    case 'flash':
      b.cyl(0.028, 0.028, 0.12, 0, 0, 0, 0x303234, 0, 0, 0, 10);
      for (let i = 0; i < 4; i++) b.box(0.06, 0.014, 0.06, 0, -0.04 + i * 0.027, 0, 0x101010);
      b.box(0.012, 0.08, 0.02, 0.03, 0.01, 0, STEEL);
      break;
    case 'incendiary':
      b.cyl(0.033, 0.033, 0.13, 0, 0, 0, 0x8a2a1c, 0, 0, 0, 10);
      b.cyl(0.034, 0.034, 0.015, 0, -0.02, 0, YEL, 0, 0, 0, 10);
      b.box(0.012, 0.09, 0.02, 0.036, 0.01, 0, STEEL);
      break;
    case 'impact':
      b.sphere(0.036, 0, 0, 0, 0x5c6440, 1, 1.1, 1, 10, 8);
      b.cyl(0.02, 0.02, 0.03, 0, 0.045, 0, 0x2a2a2a, 0, 0, 0, 8);
      break;
    case 'charge':
      b.box(0.16, 0.05, 0.1, 0, 0, 0, TAN);
      b.box(0.165, 0.052, 0.02, 0, 0, 0, BLK);
      b.box(0.03, 0.02, 0.03, 0.05, 0.035, 0, 0x202020);
      break;
    case 'sensor':
      b.cyl(0.04, 0.04, 0.12, 0, 0.0, 0, 0x5f6466, 0, 0, 0, 10);
      b.sphere(0.03, 0, 0.07, 0, 0x2e3133, 1, 0.8, 1, 8, 5);
      break;
    default:
      b.sphere(0.042, 0, 0, 0, 0x4f5a3c, 1, 1.15, 1, 10, 8);
      b.cyl(0.016, 0.016, 0.03, 0, 0.05, 0, 0x5a5c58, 0, 0, 0, 8);
      b.box(0.014, 0.09, 0.022, 0.03, 0.02, 0, 0x7a7c78, 0, 0, -0.15);
  }
  return b.build();
}
const THROWN = ['frag', 'smoke', 'flash', 'incendiary', 'impact', 'charge', 'sensor'];

// ───────── 설치물 기하 (바닥 원점, 앞 -Z) ─────────
function placedGeo(kind: PlacedKind): THREE.BufferGeometry {
  const b = new GeoBuilder();
  switch (kind) {
    case 'medbag':
      b.box(0.44, 0.22, 0.3, 0, 0.11, 0, 0x55603f);
      b.box(0.45, 0.02, 0.31, 0, 0.2, 0, 0x3f472f);
      b.cyl(0.075, 0.075, 0.006, 0, 0.223, 0, WHITE, 0, 0, 0, 14);
      b.box(0.1, 0.008, 0.03, 0, 0.227, 0, RED);
      b.box(0.03, 0.008, 0.1, 0, 0.227, 0, RED);
      for (const sd of [-1, 1]) {
        b.box(0.004, 0.11, 0.11, sd * 0.222, 0.11, 0, WHITE);
        b.box(0.006, 0.075, 0.022, sd * 0.223, 0.11, 0, RED);
        b.box(0.006, 0.022, 0.075, sd * 0.223, 0.11, 0, RED);
      }
      b.box(0.16, 0.03, 0.03, 0, 0.245, 0, BLK);
      break;
    case 'ammobag':
      b.box(0.46, 0.26, 0.28, 0, 0.13, 0, 0x5e6640);
      b.box(0.47, 0.03, 0.29, 0, 0.245, 0, 0x454c30);
      b.box(0.47, 0.04, 0.29, 0, 0.09, 0, YEL);
      for (let i = 0; i < 4; i++) {                                     // 탄 그림
        b.box(0.018, 0.07, 0.004, -0.06 + i * 0.04, 0.17, -0.142, YEL);
        b.box(0.012, 0.02, 0.004, -0.06 + i * 0.04, 0.215, -0.142, 0xb07a30);
      }
      b.box(0.18, 0.03, 0.03, 0, 0.275, 0, BLK);
      b.box(0.03, 0.06, 0.03, -0.08, 0.26, 0, BLK);
      b.box(0.03, 0.06, 0.03, 0.08, 0.26, 0, BLK);
      break;
    case 'atmine':
      b.cyl(0.17, 0.18, 0.08, 0, 0.03, 0, OD2, 0, 0, 0, 16);
      b.cyl(0.08, 0.08, 0.025, 0, 0.08, 0, 0x2e3324, 0, 0, 0, 12);
      b.cyl(0.172, 0.172, 0.01, 0, 0.065, 0, 0x6a6a5a, 0, 0, 0, 16);
      b.box(0.08, 0.02, 0.03, 0.12, 0.075, 0, BLK);
      break;
    case 'claymore':
      for (let i = -1; i <= 1; i++) b.box(0.08, 0.09, 0.035, i * 0.075, 0.14, Math.abs(i) * 0.012, OD, 0, i * 0.3, 0);
      b.box(0.2, 0.012, 0.03, 0, 0.192, 0.0, 0x8a8f6a);
      b.box(0.14, 0.01, 0.002, 0, 0.16, -0.021, 0x9aa080);            // 앞 글씨 띠
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.008, 0.12, 0.008, sx * 0.07, 0.05, sz * 0.03, STEEL, sz * 0.35, 0, sx * 0.25);
      b.cyl(0.006, 0.006, 0.05, 0.03, 0.21, 0, BLK, 0, 0, 0, 4);
      break;
    case 'breach':
      b.box(0.2, 0.12, 0.06, 0, 0.06, 0, TAN);
      b.box(0.205, 0.03, 0.065, 0, 0.04, 0, BLK);
      b.box(0.205, 0.03, 0.065, 0, 0.09, 0, BLK);
      b.box(0.05, 0.04, 0.03, 0.05, 0.07, -0.04, 0x202020);
      break;
    case 'beacon':
      b.cyl(0.13, 0.15, 0.06, 0, 0.03, 0, 0x2f3336, 0, 0, 0, 12);
      b.box(0.13, 0.24, 0.1, 0, 0.18, 0, 0x45494c);
      b.box(0.1, 0.06, 0.012, 0, 0.22, -0.052, 0x1a2a20);
      b.cyl(0.006, 0.006, 0.45, 0.04, 0.5, 0, BLK, 0, 0, 0, 4);
      b.cyl(0.02, 0.02, 0.03, -0.03, 0.315, 0, 0x222222, 0, 0, 0, 8);
      break;
    case 'sensor':
      b.add(new THREE.ConeGeometry(0.02, 0.12, 6), new THREE.Matrix4().makeRotationX(Math.PI).setPosition(0, 0.0, 0), STEEL);
      b.cyl(0.045, 0.05, 0.14, 0, 0.11, 0, 0x5f6466, 0, 0, 0, 10);
      b.sphere(0.04, 0, 0.19, 0, 0x2e3133, 1, 0.7, 1, 10, 6);
      b.cyl(0.004, 0.004, 0.18, 0.025, 0.28, 0, BLK, 0, 0, 0, 4);
      break;
    case 'cover':
      // 폭 1 m 기준 (x 로 늘린다): 앞판 + 가로 골
      b.box(1, 1.12, 0.12, 0, 0.62, -0.09, 0x6a6f66);
      for (let i = 0; i < 4; i++) b.box(1, 0.05, 0.03, 0, 0.25 + i * 0.27, -0.165, 0x52564f);
      b.box(1, 0.06, 0.3, 0, 0.03, 0, 0x4a4e48);
      b.box(1, 0.04, 0.13, 0, 1.2, -0.09, 0x575b54);
      break;
    case 'drone':
      b.box(0.2, 0.07, 0.24, 0, 0, 0, 0x2e3134);
      b.box(0.14, 0.04, 0.12, 0, 0.05, 0.02, 0x3a3e41);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.box(0.24, 0.025, 0.03, sx * 0.14, 0.01, sz * 0.14, 0x26282a, 0, sx * sz * Math.PI / 4, 0);
        b.cyl(0.028, 0.028, 0.05, sx * 0.23, 0.03, sz * 0.23, 0x1a1a1a, 0, 0, 0, 8);
        b.box(0.012, 0.09, 0.012, sx * 0.23, -0.05, sz * 0.23, 0x1a1a1a);
      }
      b.sphere(0.035, 0, -0.05, -0.1, 0x111111, 1, 1, 1, 8, 6);       // 카메라
      b.box(0.08, 0.02, 0.005, 0, -0.05, -0.135, 0x3060a0);
      break;
    default:
      b.box(0.1, 0.1, 0.1, 0, 0.05, 0, 0x777777);
  }
  return b.build();
}

function postGeo(w: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const sd of [-1, 1]) {
    const x = sd * (w / 2 + 0.03);
    b.box(0.08, 1.22, 0.16, x, 0.61, -0.08, 0x3e423d);
    b.box(0.06, 0.05, 0.36, x, 0.025, 0.02, 0x2f322e);
    b.box(0.04, 0.9, 0.04, x, 0.45, 0.1, 0x3e423d, -0.35, 0, 0);       // 뒤 받침대
  }
  b.box(w, 0.035, 0.035, 0, 0.6, 0.12, 0x3e423d, 0, 0, 0);
  return b.build();
}

function propBladeGeo(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.box(0.2, 0.006, 0.025, 0, 0, 0, 0x1c1c1c);
  b.cyl(0.08, 0.08, 0.002, 0, 0.002, 0, 0x404040, 0, 0, 0, 12);
  return b.build();
}

interface PItem {
  kind: PlacedKind; group: THREE.Group; seen: number;
  led: THREE.Mesh | null; props: THREE.Object3D[]; panel: THREE.Mesh | null; posts: THREE.Mesh | null; postW: number;
  meshes: THREE.Mesh[];
}

export class PropsLayer {
  private mat: THREE.MeshStandardMaterial;
  private glow: THREE.MeshBasicMaterial;
  private parts = new Map<string, IPart>();
  private allParts: IPart[] = [];
  private pgeo = new Map<PlacedKind, THREE.BufferGeometry>();
  private postGeos = new Map<number, THREE.BufferGeometry>();
  private bladeGeo: THREE.BufferGeometry;
  private ledGeo: THREE.BufferGeometry;
  private ledMats = new Map<number, THREE.MeshBasicMaterial>();
  private items = new Map<number, PItem>();
  private pool = new Map<PlacedKind, PItem[]>();
  private quality: Quality;
  private _q = new THREE.Quaternion();
  private _q2 = new THREE.Quaternion();
  private _v = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  private _s = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _c = new THREE.Color();
  private fwd = new THREE.Vector3(0, 0, -1);

  constructor(private scene: THREE.Scene, quality: Quality) {
    this.quality = quality;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const mk = (name: string, geo: THREE.BufferGeometry, glow = false): void => {
      const p = new IPart(scene, geo, glow ? this.glow : this.mat, 48);
      this.parts.set(name, p);
      this.allParts.push(p);
    };
    mk('rocket', rocketGeo());
    mk('flame', flameGeo(), true);
    mk('shell', shellGeo(), true);
    mk('ugl', uglGeo());
    for (const k of THROWN) mk('t_' + k, thrownGeo(k));
    this.bladeGeo = propBladeGeo();
    this.ledGeo = new THREE.SphereGeometry(0.018, 8, 6);
    this.setQuality(quality);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    for (const p of this.allParts) p.setShadow(q === 'high' && p !== this.parts.get('flame') && p !== this.parts.get('shell'), false);
    for (const it of this.items.values()) this.shadowItem(it);
  }

  private shadowItem(it: PItem): void {
    const cast = this.quality === 'high' || (this.quality === 'medium' && it.kind === 'cover');
    for (const m of it.meshes) { m.castShadow = cast; m.receiveShadow = this.quality === 'high'; }
  }

  private ledMat(hex: number): THREE.MeshBasicMaterial {
    let m = this.ledMats.get(hex);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: hex, toneMapped: false }); this.ledMats.set(hex, m); }
    return m;
  }

  update(g: Game, ctx: ActorCtx): void {
    this.projectiles(g, ctx);
    this.placed(g, ctx);
  }

  // ───────── 투사체 ─────────
  private projectiles(g: Game, ctx: ActorCtx): void {
    for (const p of this.allParts) p.begin();
    const maxD2 = 500 * 500;
    for (const p of g.projectiles) {
      if (!p.alive || p.kind === 'bullet' || p.kind === 'pellet') continue;
      const dx = p.pos.x - ctx.cam.x, dy = p.pos.y - ctx.cam.y, dz = p.pos.z - ctx.cam.z;
      if (dx * dx + dy * dy + dz * dz > maxD2) continue;
      if (!inView(ctx, p.pos.x, p.pos.y, p.pos.z, 1.2)) continue;
      this.projectile(g, p, ctx);
    }
    for (const p of this.allParts) p.end();
  }

  private aim(p: Projectile): THREE.Quaternion {
    const v = this._v.set(p.vel.x, p.vel.y, p.vel.z);
    const l = v.length();
    if (l < 1e-4) return this._q.identity();
    v.multiplyScalar(1 / l);
    return this._q.setFromUnitVectors(this.fwd, v);
  }

  private projectile(g: Game, p: Projectile, ctx: ActorCtx): void {
    const pos = this._v2.set(p.pos.x, p.pos.y, p.pos.z);
    switch (p.kind) {
      case 'rocket': case 'missile': {
        const q = this.aim(p);
        this._m.compose(pos, q, this._s.set(1, 1, 1));
        if (p.kind === 'missile') this.parts.get('rocket')!.matrix(this._m, 1, 1, 1);
        else this.parts.get('rocket')!.matrix(this._m, 0.62, 0.68, 0.5);
        const fl = 0.75 + Math.sin(ctx.t * 61 + p.id * 3.1) * 0.2 + Math.sin(ctx.t * 37 + p.id) * 0.1;
        this._m.compose(pos, q, this._s.set(fl, fl, 0.7 + fl * 0.5));
        this.parts.get('flame')!.matrix(this._m, 1, 0.75, 0.45);
        break;
      }
      case 'shell': {
        const q = this.aim(p);
        const big = p.radius >= 3 ? 1.6 : 0.9;
        this._m.compose(pos, q, this._s.set(big, big, big * 1.4));
        this.parts.get('shell')!.matrix(this._m, 1, 0.8, 0.5);
        break;
      }
      case 'ugl': {
        const q = this.aim(p);
        this._m.compose(pos, q, this._s.set(1, 1, 1));
        this.parts.get('ugl')!.matrix(this._m, 1, 1, 1);
        break;
      }
      case 'thrown': {
        const def = GADGETS[p.weapon];
        const kind = def ? def.kind : p.weapon;
        const shape = kind === 'breach' ? 'charge' : THROWN.includes(kind) ? kind : 'frag';
        const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
        let q: THREE.Quaternion;
        if (sp > 0.6) {
          // 날아가며 굴러 돈다
          this._v.set(p.vel.z, 0, -p.vel.x);
          if (this._v.lengthSq() < 1e-6) this._v.set(1, 0, 0);
          this._v.normalize();
          q = this._q.setFromAxisAngle(this._v, ctx.t * 11 + p.id);
        } else {
          q = this._q.setFromAxisAngle(this._v.set(0, 0, 1), shape === 'smoke' || shape === 'flash' || shape === 'incendiary' ? Math.PI / 2 : 0);
          this._q2.setFromAxisAngle(this._v.set(0, 1, 0), p.id * 1.7);
          q.premultiply(this._q2);
          if (shape !== 'charge' && shape !== 'sensor') pos.y += 0.035;
        }
        this._m.compose(pos, q, this._s.set(1, 1, 1));
        this.parts.get('t_' + shape)!.matrix(this._m, 1, 1, 1);
        break;
      }
      default:
        break;
    }
    void g;
  }

  // ───────── 설치물 ─────────
  private placed(g: Game, ctx: ActorCtx): void {
    const frame = ctx.frame;
    const maxD2 = 260 * 260;
    for (const p of g.placed) {
      if (!p.alive || p.kind === 'fire') continue;
      const dx = p.pos.x - ctx.cam.x, dy = p.pos.y - ctx.cam.y, dz = p.pos.z - ctx.cam.z;
      const far = dx * dx + dy * dy + dz * dz > maxD2;
      let it = this.items.get(p.id);
      if (far) { if (it) it.group.visible = false; if (it) it.seen = frame; continue; }
      if (!it || it.kind !== p.kind) {
        if (it) this.releaseItem(p.id, it);
        it = this.acquire(p.kind);
        this.items.set(p.id, it);
      }
      it.seen = frame;
      const r = p.kind === 'cover' ? (p.params.width ?? 2.4) * 0.6 + 0.5 : 0.6;
      if (!inView(ctx, p.pos.x, p.pos.y + 0.4, p.pos.z, r)) { it.group.visible = false; continue; }
      it.group.visible = true;
      this.pose(g, p, it, ctx);
    }
    for (const [id, it] of this.items) if (it.seen !== frame) this.releaseItem(id, it);
  }

  private acquire(kind: PlacedKind): PItem {
    const list = this.pool.get(kind);
    if (list && list.length) {
      const it = list.pop()!;
      this.scene.add(it.group);
      return it;
    }
    let geo = this.pgeo.get(kind);
    if (!geo) { geo = placedGeo(kind); this.pgeo.set(kind, geo); }
    const group = new THREE.Group();
    const body = new THREE.Mesh(geo, this.mat);
    group.add(body);
    const it: PItem = { kind, group, seen: 0, led: null, props: [], panel: null, posts: null, postW: 0, meshes: [body] };
    if (kind === 'cover') it.panel = body;
    const led = (x: number, y: number, z: number, hex: number): void => {
      const m = new THREE.Mesh(this.ledGeo, this.ledMat(hex));
      m.position.set(x, y, z);
      group.add(m);
      it.led = m;
    };
    if (kind === 'beacon') led(-0.03, 0.34, 0, 0xffffff);
    else if (kind === 'sensor') led(0, 0.23, -0.03, 0x40ff60);
    else if (kind === 'breach') led(0.05, 0.1, -0.05, 0xff2a20);
    else if (kind === 'drone') {
      led(0, -0.02, 0.13, 0xffffff);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const pr = new THREE.Mesh(this.bladeGeo, this.mat);
        pr.position.set(sx * 0.23, 0.06, sz * 0.23);
        group.add(pr);
        it.props.push(pr);
      }
    } else if (kind === 'claymore') led(0.03, 0.235, 0, 0x30ff40);
    this.shadowItem(it);
    this.scene.add(group);
    return it;
  }

  private releaseItem(id: number, it: PItem): void {
    this.items.delete(id);
    this.scene.remove(it.group);
    let list = this.pool.get(it.kind);
    if (!list) { list = []; this.pool.set(it.kind, list); }
    list.push(it);
  }

  private pose(g: Game, p: Placed, it: PItem, ctx: ActorCtx): void {
    const grp = it.group;
    const t = ctx.t + p.id * 0.37;
    grp.position.set(p.pos.x, p.pos.y, p.pos.z);
    grp.rotation.set(0, p.yaw, 0);
    const side: Side = g.sides[p.team] ?? 'us';
    const team = FACTIONS[side] ? FACTIONS[side].color : 0xffffff;
    switch (p.kind) {
      case 'beacon':
        if (it.led) {
          it.led.visible = (t % 1.2) < 0.18;
          it.led.material = this.ledMat(team);
        }
        break;
      case 'sensor':
        if (it.led) it.led.visible = Math.sin(t * 3) > 0.2;
        break;
      case 'breach':
        if (it.led) it.led.visible = (t * 2) % 1 < 0.25;
        break;
      case 'claymore':
        if (it.led) it.led.visible = (t % 2) < 0.1;
        break;
      case 'atmine':
        grp.position.y -= 0.02;
        break;
      case 'cover': {
        const w = Math.max(0.6, p.params.width ?? 2.4);
        if (it.panel) it.panel.scale.set(w, 1, 1);
        const key = Math.round(w * 20);
        if (it.postW !== key) {
          let pg = this.postGeos.get(key);
          if (!pg) { pg = postGeo(key / 20); this.postGeos.set(key, pg); }
          if (!it.posts) {
            it.posts = new THREE.Mesh(pg, this.mat);
            grp.add(it.posts);
            it.meshes.push(it.posts);
            this.shadowItem(it);
          } else it.posts.geometry = pg;
          it.postW = key;
        }
        break;
      }
      case 'drone': {
        grp.position.y += Math.sin(t * 2.1) * 0.08;
        // 이동 방향으로 기울기 (몸 기준 앞뒤·좌우 속도)
        const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
        const vf = -p.vel.x * sy - p.vel.z * cy, vr = p.vel.x * cy - p.vel.z * sy;
        const pitch = Math.max(-0.35, Math.min(0.35, -vf * 0.03));
        const roll = Math.max(-0.35, Math.min(0.35, -vr * 0.03));
        grp.rotation.set(pitch + Math.sin(t * 1.3) * 0.03, p.yaw, roll + Math.sin(t * 1.7) * 0.03, 'YXZ');
        for (let i = 0; i < it.props.length; i++) it.props[i].rotation.y = t * (i % 2 ? 60 : -60);
        if (it.led) { it.led.visible = (t % 0.8) < 0.1; it.led.material = this.ledMat(team); }
        break;
      }
      default:
        break;
    }
  }

  dispose(): void {
    for (const p of this.allParts) { p.dispose(); p.geo.dispose(); }
    for (const it of this.items.values()) this.scene.remove(it.group);
    for (const list of this.pool.values()) for (const it of list) this.scene.remove(it.group);
    for (const g of this.pgeo.values()) g.dispose();
    for (const g of this.postGeos.values()) g.dispose();
    for (const m of this.ledMats.values()) m.dispose();
    this.bladeGeo.dispose(); this.ledGeo.dispose();
    this.mat.dispose(); this.glow.dispose();
    this.items.clear(); this.pool.clear(); this.pgeo.clear(); this.postGeos.clear();
    void this._c;
  }
}
