// render-fx: 전투 효과. 이벤트(총구 섬광, 예광탄, 탄착, 피격, 폭발, 파괴, 붕괴, 차량 파괴)와
// 매 프레임 지속 효과(연막 구름, 불타는 차량·화염, 로켓 연기 꼬리, 카메라 둘레 눈발)를 그린다.
// 그리기 호출: 데칼 1, 알파 파티클 1, 가산 파티클 1, 파편 1, 눈 1. 점광원은 품질에 따라 1~4개를 돌려 쓴다.
import * as THREE from 'three';
import type { Game, GameEvent, Quality, Smoke, Vec3, VehicleType, World } from '../types';
import { clamp, forwardXZ, rightXZ, rng, smoothstep } from '../math';
import { VEHICLES, VWEAPONS, WEAPONS } from '../defs';
import { heightAt } from '../world';
import { F, makeAtlas } from './fx-textures';
import { ParticlePool } from './fx-particles';
import { Decals } from './fx-decals';
import { Debris } from './fx-debris';
import { LightPool } from './fx-lights';
import { Snow } from './fx-snow';
import {
  FxCtx, blackSmoke, blood, boxBreak, cannonBlast, collapse, debrisTrail, ember, explosion, fireSmoke, flares,
  groundDustColor, groundFlame, impact, launchBlast, launchPuff, lodOf, muzzle, rocketPuff, rr, smallDust, smokeBurst,
  smokeLaunch, smokeWisp, teamTracer, tracer, vehicleBurst, vehicleFlame, vehicleSparks,
} from './fx-recipes';

type Ev<K extends GameEvent['k']> = Extract<GameEvent, { k: K }>;

const CAP: Record<Quality, number> = { low: 600, medium: 1500, high: 3000 };
const QK: Record<Quality, number> = { low: 0.4, medium: 0.7, high: 1 };
const DECALS: Record<Quality, number> = { low: 150, medium: 300, high: 500 };
const DEBRIS: Record<Quality, number> = { low: 60, medium: 150, high: 300 };
const LIGHTS: Record<Quality, number> = { low: 1, medium: 3, high: 4 };
const SNOW: Record<Quality, number> = { low: 600, medium: 1600, high: 3500 };
const SMOKE_PUFFS: Record<Quality, number> = { low: 7, medium: 9, high: 12 };
const DEFAULT_SIZE: Vec3 = { x: 3.2, y: 2.4, z: 6.5 };

/** 정수 해시 → 0..1 (연막 구름 배치용, 매 프레임 같은 값) */
function hh(s: number, j: number, k: number): number {
  let h = (s ^ Math.imul(j + 1, 374761393) ^ Math.imul(k + 7, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vsize(type: VehicleType): Vec3 {
  return VEHICLES[type]?.size ?? DEFAULT_SIZE;
}

interface Acc { f: number; s: number; seen: number }

export class Effects {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly quality: Quality;
  private readonly atlas: THREE.DataTexture;
  private readonly add: ParticlePool;
  private readonly alp: ParticlePool;
  private readonly decals: Decals;
  private readonly debris: Debris;
  private readonly lights: LightPool;
  private readonly fx: FxCtx;
  private snow: Snow | null = null;
  private world: World | null = null;
  private readonly light = new THREE.Color(1, 1, 1);
  private addK = 1;
  private windX = 0;
  private windZ = 0;
  private frame = 0;
  private readonly trails = new Map<number, { x: number; y: number; z: number; seen: number }>();
  private seenSmokes = new WeakSet<Smoke>();
  private readonly deadAt = new Map<number, number>();
  private readonly vAcc = new Map<number, Acc>();
  private readonly pAcc = new Map<number, Acc>();
  private fireD = Infinity;
  private readonly fireP = new THREE.Vector3();
  private fireI = 0;
  private fireLightT = 0;
  private mgCount = 0;
  private disposed = false;
  private readonly trailFn: (x: number, y: number, z: number, kind: number) => void;

  constructor(scene: THREE.Scene, camera: THREE.Camera, quality: Quality) {
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.atlas = makeAtlas(quality === 'low' ? 64 : 128);
    const cap = CAP[quality];
    const alpCap = Math.round(cap * 0.56);
    this.alp = new ParticlePool(this.atlas, alpCap, 12 * 20 + 8, false);
    this.add = new ParticlePool(this.atlas, cap - alpCap, 120, true);
    this.decals = new Decals(this.atlas, DECALS[quality]);
    this.debris = new Debris(DEBRIS[quality]);
    this.lights = new LightPool(scene, LIGHTS[quality]);
    this.fx = new FxCtx(this.add, this.alp, this.decals, this.debris, this.lights, QK[quality]);
    scene.add(this.decals.mesh, this.alp.mesh, this.add.mesh, this.debris.mesh);

    // 늘인 줄의 최소 굵기: 실제 그리는 카메라와 버퍼 높이로 픽셀 크기를 잰다
    const v2 = new THREE.Vector2();
    const setPx = (renderer: THREE.WebGLRenderer, _s: THREE.Scene, cam: THREE.Camera): void => {
      const pc = cam as THREE.PerspectiveCamera;
      if (!pc.isPerspectiveCamera) return;
      renderer.getDrawingBufferSize(v2);
      const t = Math.tan((pc.fov * Math.PI) / 360) / (pc.zoom || 1);
      const px = (2 * t) / Math.max(1, v2.y / renderer.getPixelRatio());
      this.add.setPx(px);
      this.alp.setPx(px);
    };
    this.add.mesh.onBeforeRender = setPx;
    this.alp.mesh.onBeforeRender = setPx;
    this.trailFn = (x, y, z, kind) => debrisTrail(this.fx, x, y, z, kind);
  }

  // ───────────────────────── 세계 ─────────────────────────

  private syncWorld(g: Game): void {
    if (g.world === this.world) return;
    this.reset();
    this.world = g.world;
    this.fx.world = g.world;
    const def = g.world.def;
    const r = rng((def.seed ^ 0x5f3a91) >>> 0);
    const ang = r() * Math.PI * 2, spd = 0.8 + r() * 1.6;
    this.windX = Math.cos(ang) * spd;
    this.windZ = Math.sin(ang) * spd;
    this.add.windX = this.alp.windX = this.windX;
    this.add.windZ = this.alp.windZ = this.windZ;
    if (def.time === 'dusk') { this.light.setRGB(0.78, 0.62, 0.52); this.addK = 1.15; this.fx.dim = true; }
    else if (def.time === 'overcast') { this.light.setRGB(0.82, 0.84, 0.88); this.addK = 1.05; this.fx.dim = true; }
    else { this.light.setRGB(1.0, 0.98, 0.95); this.addK = 0.95; this.fx.dim = false; }
    if (def.theme === 'snow') this.light.multiplyScalar(1.03);
    this.alp.setLight(this.light);
    this.fx.snowy = def.theme === 'snow' || def.theme === 'tundra';
    if (this.snow) { this.snow.dispose(); this.snow = null; }
    if (this.fx.snowy) {
      const n = Math.round(SNOW[this.quality] * (def.theme === 'snow' ? 1 : 0.45));
      this.snow = new Snow(n, 40, def.theme === 'snow' ? 0.9 : 0.7);
      this.scene.add(this.snow.points);
    }
  }

  private reset(): void {
    this.add.clear();
    this.alp.clear();
    this.decals.clear();
    this.debris.clear();
    this.fx.clearQueue();
    this.trails.clear();
    this.deadAt.clear();
    this.vAcc.clear();
    this.pAcc.clear();
    this.seenSmokes = new WeakSet<Smoke>();
  }

  // ───────────────────────── 이벤트 ─────────────────────────

  event(e: GameEvent, g: Game, viewer: number): void {
    if (this.disposed) return;
    this.syncWorld(g);
    const fx = this.fx;
    switch (e.k) {
      case 'shot': this.onShot(e, g, viewer); break;
      case 'vshot': this.onVShot(e, g, viewer); break;
      case 'impact': impact(fx, e.pos, e.normal, e.mat, e.big); break;
      case 'hit': if (e.target !== viewer) blood(fx, e.pos, e.head); break;
      case 'vhit': vehicleSparks(fx, e.pos, e.dmg >= 120); break;
      case 'explosion': explosion(fx, e.pos, e.r, e.kind); break;
      case 'boxBroken': {
        const b = g.world.boxes[e.box];
        if (b) this.decals.clearBox(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
        boxBreak(fx, e.pos, e.mat, b);
        break;
      }
      case 'collapse': {
        const b = g.world.buildings[e.building];
        const half = b ? Math.max(b.w, b.d) * 0.6 + 1 : 10;
        const y0 = b ? b.y - 1 : e.pos.y - 6;
        const h = b ? b.floors * b.floorH + 4 : 24;
        this.decals.clearBox(e.pos.x - half, y0, e.pos.z - half, e.pos.x + half, y0 + h, e.pos.z + half, 0);
        collapse(fx, e.pos, b);
        break;
      }
      case 'vdestroyed': {
        const v = g.vehicles[e.v];
        if (v) {
          this.deadAt.set(v.id, fx.time);
          vehicleBurst(fx, v.pos, vsize(v.type));
        }
        break;
      }
      case 'counter': {
        const v = g.vehicles[e.v];
        if (!v) break;
        if (v.type === 'heli' || VEHICLES[v.type]?.counter === 'flare') flares(fx, v.pos, v.yaw);
        else smokeLaunch(fx, v.pos, v.yaw, vsize(v.type));
        break;
      }
      case 'down': case 'kill': {
        const s = g.soldiers[e.s];
        if (s && s.vehicle < 0 && e.s !== viewer && fx.distTo(s.pos) < 40) smallDust(fx, s.pos, groundDustColor(fx, s.pos), 2, 0.9, 0.3);
        break;
      }
      case 'land': {
        if (!e.hard) break;
        const s = g.soldiers[e.s];
        if (s && fx.distTo(s.pos) < 40) smallDust(fx, s.pos, groundDustColor(fx, s.pos), 4, 0.8, 0.32);
        break;
      }
      case 'step': {
        if (e.sprint && fx.q >= 0.7 && (e.mat === 'snow' || e.mat === 'dirt' || e.mat === 'sand') && fx.distTo(e.pos) < 25) {
          smallDust(fx, e.pos, groundDustColor(fx, e.pos, e.mat), 1, 0.5, e.mat === 'snow' ? 0.3 : 0.2);
        }
        break;
      }
      default: break;
    }
  }

  private onShot(e: Ev<'shot'>, g: Game, viewer: number): void {
    const fx = this.fx;
    const own = e.s === viewer;
    const s = g.soldiers[e.s];
    const wd = WEAPONS[e.weapon];
    if (!own) {
      const yaw = s ? s.yaw : Math.atan2(-e.dir.x, -e.dir.z);
      const rt = rightXZ(yaw);
      const mp: Vec3 = { x: e.pos.x + e.dir.x * 0.5 + rt.x * 0.1, y: e.pos.y + e.dir.y * 0.5 - 0.1, z: e.pos.z + e.dir.z * 0.5 + rt.z * 0.1 };
      const d = fx.distTo(mp);
      const cat = wd?.cat;
      const sc = cat === 'sniper' || cat === 'dmr' ? 1.3 : cat === 'lmg' ? 1.15 : cat === 'shotgun' ? 1.35 : cat === 'pistol' ? 0.7 : cat === 'smg' ? 0.8 : 1;
      if (d < 700 && lodOf(fx, mp, true) > 0) {
        // 먼 섬광은 조금 크게 (화면에서 사라지지 않게)
        muzzle(fx, mp, e.dir, sc * (d > 80 ? 1 + (d - 80) / 250 : 1), e.suppressed, d < 150 ? 1 : 0);
        if (fx.dim && !e.suppressed && d < 45) this.lights.flash(mp.x, mp.y, mp.z, 0xffc27a, 14 * sc, 7, 0.05, 0);
      }
    }
    if (e.tracer) {
      const off = own ? 2 : 0.6;
      const from: Vec3 = { x: e.pos.x + e.dir.x * off, y: e.pos.y + e.dir.y * off, z: e.pos.z + e.dir.z * off };
      const speed = wd?.velocity ?? 800;
      const side = s ? g.sides[s.team] : 'us';
      tracer(fx, from, e.dir, speed, teamTracer(side), Math.min(speed * 0.75, 600));
    }
  }

  private onVShot(e: Ev<'vshot'>, g: Game, viewer: number): void {
    const fx = this.fx;
    const vw = VWEAPONS[e.weapon];
    const kind = vw?.kind ?? 'mg';
    const v = g.vehicles[e.v];
    const side = v ? g.sides[v.team] : 'us';
    const mine = !!v && v.seats.indexOf(viewer) >= 0;
    const speed = vw?.velocity ?? 900;
    const off = mine ? 2 : 0.3;
    const from: Vec3 = { x: e.pos.x + e.dir.x * off, y: e.pos.y + e.dir.y * off, z: e.pos.z + e.dir.z * off };
    switch (kind) {
      case 'cannon': {
        const gy = this.world ? heightAt(this.world, e.pos.x, e.pos.z) : null;
        cannonBlast(fx, e.pos, e.dir, gy, groundDustColor(fx, e.pos));
        break;
      }
      case 'autocannon': {
        muzzle(fx, e.pos, e.dir, 1.7, false, 1);
        this.lights.flash(e.pos.x, e.pos.y, e.pos.z, 0xffc27a, 60, 10, 0.06, 0);
        tracer(fx, from, e.dir, speed, teamTracer(side), Math.min(speed * 0.75, 700), 0.12);
        break;
      }
      case 'mg': {
        muzzle(fx, e.pos, e.dir, 1.0, false, 0.6);
        if (fx.dim && fx.distTo(e.pos) < 45) this.lights.flash(e.pos.x, e.pos.y, e.pos.z, 0xffc27a, 16, 7, 0.05, 0);
        if ((++this.mgCount & 1) === 0) tracer(fx, from, e.dir, speed, teamTracer(side), Math.min(speed * 0.75, 600));
        break;
      }
      default: launchBlast(fx, e.pos, e.dir);
    }
  }

  // ───────────────────────── 매 프레임 ─────────────────────────

  update(g: Game, dt: number): void {
    if (this.disposed) return;
    this.syncWorld(g);
    const fx = this.fx;
    dt = clamp(dt, 0, 0.1);
    fx.time += dt;
    this.frame++;
    this.camera.getWorldPosition(fx.cam);
    this.camera.getWorldDirection(fx.camDir);
    fx.runQueue();

    this.add.begin();
    this.alp.begin();
    this.fireD = Infinity;
    this.drawSmokes(g, dt);
    this.burnVehicles(g, dt);
    this.burnPlaced(g, dt);
    this.projectileFx(g);
    this.fireLight(dt);

    this.debris.update(dt, this.world, this.trailFn);
    this.alp.update(dt, 1);
    this.add.update(dt, this.addK);
    this.decals.update(fx.time);
    this.lights.update(dt);
    if (this.snow) this.snow.update(fx.time, fx.cam, this.windX * 1.4, this.windZ * 1.4, this.light);
  }

  /** 연막: 연막마다 크고 짙은 뭉치 여러 개가 천천히 돈다 (시뮬레이션 없이 매 프레임 계산). 카메라가 안에 있으면 눈앞을 가린다 */
  private drawSmokes(g: Game, dt: number): void {
    const fx = this.fx;
    const N = SMOKE_PUFFS[this.quality];
    const t = fx.time;
    let inside = 0;
    for (const s of g.smokes) {
      if (s.life <= 0) continue;
      const age = s.max > 0 ? s.max - s.life : 99;
      if (!this.seenSmokes.has(s)) {
        this.seenSmokes.add(s);
        if (age < 1.5) smokeBurst(fx, s.pos, s.r);
      }
      const grow = smoothstep(0, 3.2, age);
      const fade = clamp(s.life / 4, 0, 1);
      const R = s.r * (0.3 + 0.7 * grow);
      const A = 0.92 * fade * (0.55 + 0.45 * grow);
      const seed = Math.imul(Math.floor(s.pos.x * 13.1), 73856093) ^ Math.imul(Math.floor(s.pos.z * 7.7), 19349663);
      for (let j = 0; j < N; j++) {
        const h1 = hh(seed, j, 1), h2 = hh(seed, j, 2), h3 = hh(seed, j, 3), h4 = hh(seed, j, 4);
        const sg = j & 1 ? 1 : -1;
        const a = h1 * 6.2832 + j * 2.39996 + t * 0.05 * sg * (0.6 + h2);
        const rad = R * 0.62 * Math.sqrt((j + 0.5) / N);
        const x = s.pos.x + Math.cos(a) * rad;
        const z = s.pos.z + Math.sin(a) * rad;
        const y = s.pos.y + R * (0.3 + 0.4 * h3) + Math.sin(t * 0.45 + j * 1.7) * R * 0.04;
        const size = R * (1.15 + 0.35 * h4) * (0.93 + 0.07 * Math.sin(t * 0.33 + j * 2.1));
        const sh = 0.78 + 0.14 * h1;
        this.alp.pushExt(x, y, z, size, h2 * 6.2832 + t * 0.045 * sg, F.SMOKE + (j & 3), sh, sh, sh * 1.02, A);
      }
      const dx = fx.cam.x - s.pos.x, dy = fx.cam.y - (s.pos.y + R * 0.45), dz = fx.cam.z - s.pos.z;
      const k = smoothstep(R * 0.95, R * 0.45, Math.hypot(dx, dy * 1.3, dz)) * A;
      if (k > inside) inside = k;
      if (Math.random() < dt * 1.6 * fx.q * fade) smokeWisp(fx, s.pos, R, this.windX, this.windZ, fade);
    }
    if (inside > 0.01) {
      const d = fx.camDir;
      for (let k = 0; k < 2; k++) {
        const dd = 0.8 + k * 0.9;
        this.alp.pushExt(fx.cam.x + d.x * dd, fx.cam.y + d.y * dd, fx.cam.z + d.z * dd, 4.5 + k * 3, t * 0.05 * (k ? 1 : -1) + k,
          F.SMOKE + k, 0.8, 0.8, 0.82, Math.min(0.95, inside * (k ? 0.9 : 0.75)));
      }
    }
  }

  /** 불타는 차량(살아서 불붙음) / 잔해(파괴 후 30초): 불길 + 검은 연기 */
  private burnVehicles(g: Game, dt: number): void {
    const fx = this.fx;
    for (const v of g.vehicles) {
      let I: number;
      if (v.alive) {
        if (this.deadAt.has(v.id)) this.deadAt.delete(v.id);
        if (!v.burning) continue;
        I = 0.5;
      } else {
        let t0 = this.deadAt.get(v.id);
        if (t0 === undefined) { t0 = fx.time; this.deadAt.set(v.id, t0); }
        const wa = fx.time - t0;
        if (wa > 36) continue;
        I = wa < 30 ? 1 - (wa / 30) * 0.55 : (0.45 * (36 - wa)) / 6;
      }
      const d = fx.distTo(v.pos);
      if (d > 650) continue;
      const lod = d < 80 ? 1 : d < 200 ? 0.6 : 0.35;
      const size = vsize(v.type);
      const fw = forwardXZ(v.yaw), rt = rightXZ(v.yaw);
      const back = v.alive ? size.z * 0.3 : 0;
      const cx = v.pos.x - fw.x * back, cz = v.pos.z - fw.z * back;
      const top = v.pos.y + size.y * 0.55;
      const sc = clamp(size.x * 0.4, 0.8, 1.8) * (v.alive ? 0.75 : 1);
      let acc = this.vAcc.get(v.id);
      if (!acc) { acc = { f: 0, s: 0, seen: 0 }; this.vAcc.set(v.id, acc); }
      acc.f += (v.alive ? 9 : 16) * fx.q * lod * I * dt;
      acc.s += (v.alive ? 3.5 : 5.5) * fx.q * lod * Math.max(0.6, I) * dt;
      const sx = size.x * 0.3, sz = size.z * (v.alive ? 0.12 : 0.28);
      while (acc.f >= 1) {
        acc.f -= 1;
        const ox = rr(-1, 1) * sx, oz = rr(-1, 1) * sz;
        vehicleFlame(fx, cx + rt.x * ox + fw.x * oz, top + Math.random() * 0.3, cz + rt.z * ox + fw.z * oz, sc, Math.min(1, I + 0.3));
      }
      while (acc.s >= 1) {
        acc.s -= 1;
        blackSmoke(fx, cx + rt.x * rr(-1, 1) * sx * 0.5, top + 0.6, cz + rt.z * rr(-1, 1) * sx * 0.5, sc, v.alive ? 0.55 : 0.68);
      }
      if (Math.random() < dt * 2 * fx.q * lod * I) ember(fx, cx, top + 0.5, cz);
      if (d < this.fireD) { this.fireD = d; this.fireP.set(cx, top + 0.8, cz); this.fireI = I * sc; }
    }
  }

  /** 소이탄 화염 (Placed 'fire') */
  private burnPlaced(g: Game, dt: number): void {
    const fx = this.fx;
    const w = this.world;
    for (const p of g.placed) {
      if (!p.alive || p.kind !== 'fire') continue;
      const d = fx.distTo(p.pos);
      if (d > 450) continue;
      const rad = p.params.radius ?? 3;
      const lod = d < 60 ? 1 : d < 160 ? 0.6 : 0.35;
      const k = clamp(p.life / 2, 0.25, 1);
      const sz = clamp(rad / 3, 0.6, 2.2);
      let acc = this.pAcc.get(p.id);
      if (!acc) { acc = { f: 0, s: 0, seen: 0 }; this.pAcc.set(p.id, acc); }
      acc.seen = this.frame;
      acc.f += 9 * fx.q * lod * sz * k * dt;
      acc.s += 2.2 * fx.q * lod * sz * dt;
      const ty = w ? heightAt(w, p.pos.x, p.pos.z) : p.pos.y;
      const onTerrain = Math.abs(ty - p.pos.y) < 1;
      while (acc.f >= 1) {
        acc.f -= 1;
        const a = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * rad * 0.85;
        const x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r;
        const y = onTerrain && w ? heightAt(w, x, z) : p.pos.y;
        groundFlame(fx, x, y + 0.05, z, rr(0.8, 1.25), k);
      }
      while (acc.s >= 1) {
        acc.s -= 1;
        fireSmoke(fx, p.pos.x + rr(-0.5, 0.5) * rad, p.pos.y, p.pos.z + rr(-0.5, 0.5) * rad, 1);
      }
      if (Math.random() < dt * 1.5 * fx.q * lod) ember(fx, p.pos.x + rr(-1, 1) * rad * 0.5, p.pos.y + 0.6, p.pos.z + rr(-1, 1) * rad * 0.5);
      if (d < this.fireD) { this.fireD = d; this.fireP.set(p.pos.x, p.pos.y + 1, p.pos.z); this.fireI = k * sz * 0.8; }
    }
    if ((this.frame & 63) === 0) {
      for (const [id, a] of this.pAcc) if (this.frame - a.seen > 30) this.pAcc.delete(id);
    }
  }

  /** 가장 가까운 불의 깜빡이는 빛 */
  private fireLight(dt: number): void {
    this.fireLightT -= dt;
    if (this.fireD > 70 || this.lights.size < 2 || this.fireLightT > 0) return;
    this.fireLightT = 0.09;
    const p = this.fireP;
    this.lights.flash(p.x + rr(-0.3, 0.3), p.y + rr(0, 0.4), p.z + rr(-0.3, 0.3), 0xff8a3a, (45 + 30 * Math.random()) * this.fireI, 16, 0.16, 0.5);
  }

  /** 로켓·미사일·유탄 연기 꼬리와 배기 불빛, 포탄 빛 */
  private projectileFx(g: Game): void {
    const fx = this.fx;
    for (const p of g.projectiles) {
      if (!p.alive) continue;
      const k = p.kind;
      if (k !== 'rocket' && k !== 'missile' && k !== 'ugl' && k !== 'shell') continue;
      const vl = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
      const ux = p.vel.x / vl, uy = p.vel.y / vl, uz = p.vel.z / vl;
      const d = fx.distTo(p.pos);
      if (k === 'shell') {
        const L = clamp(vl * 0.006, 3, 8);
        this.add.pushExt(p.pos.x, p.pos.y, p.pos.z, 0.6, 0, F.GLOW, 4, 2.6, 1.3, 1);
        this.add.pushExt(p.pos.x, p.pos.y, p.pos.z, 0.11, 0, F.STREAK, 5, 3, 1.4, 1, 1, ux * L, uy * L, uz * L);
        continue;
      }
      let tr = this.trails.get(p.id);
      if (!tr) {
        tr = { x: p.prev.x, y: p.prev.y, z: p.prev.z, seen: 0 };
        this.trails.set(p.id, tr);
        if (k !== 'ugl' && p.dist < 25 && d < 500) launchPuff(fx, p.prev, p.vel);
      }
      tr.seen = this.frame;
      const dx = p.pos.x - tr.x, dy = p.pos.y - tr.y, dz = p.pos.z - tr.z;
      const L = Math.hypot(dx, dy, dz);
      if (d > 900 || L > 80) { tr.x = p.pos.x; tr.y = p.pos.y; tr.z = p.pos.z; }
      else {
        const sp = ((k === 'ugl' ? 1.5 : 0.9) * (1 + d / 90)) / Math.max(0.4, fx.q);
        if (L >= sp) {
          const n = Math.min(16, Math.floor(L / sp));
          for (let s = 1; s <= n; s++) {
            const f = (s * sp) / L;
            rocketPuff(fx, tr.x + dx * f, tr.y + dy * f, tr.z + dz * f, k);
          }
          const f = (n * sp) / L;
          tr.x += dx * f; tr.y += dy * f; tr.z += dz * f;
        }
      }
      if (k !== 'ugl') {
        const fl = 0.85 + 0.3 * Math.random();
        const bx = p.pos.x - ux * 0.3, by = p.pos.y - uy * 0.3, bz = p.pos.z - uz * 0.3;
        this.add.pushExt(bx, by, bz, k === 'missile' ? 1.1 : 1.4, fx.time * 9, F.GLOW, 5 * fl, 2.6 * fl, 0.9 * fl, 1);
        this.add.pushExt(bx, by, bz, 0.3, 0, F.STREAK, 6 * fl, 3 * fl, 1.2 * fl, 1, 1, ux * 2.2, uy * 2.2, uz * 2.2);
      }
    }
    for (const [id, tr] of this.trails) if (tr.seen !== this.frame) this.trails.delete(id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    this.add.dispose();
    this.alp.dispose();
    this.decals.dispose();
    this.debris.dispose();
    this.lights.dispose();
    if (this.snow) { this.snow.dispose(); this.snow = null; }
    this.atlas.dispose();
    this.world = null;
    this.fx.world = null;
  }
}
