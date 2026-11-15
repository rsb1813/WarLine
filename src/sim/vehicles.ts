// ═══════════════════════════════════════════════════════════════════════════
// sim-vehicles — 차량 생성, 탑승·하차·좌석 이동, 지상 운전, 헬기 비행, 포탑, 좌석 무기,
// 대응책(연막·플레어), 화재·공병 자가 수리, 파괴·잔해·재생성, 차량 충돌·들이받기, 차량 광선 판정(OBB).
//
// 차체 로컬 좌표: x 오른쪽, y 위, -z 앞 (SeatDef.offset 과 같음). 원점 = v.pos = 차체 바닥 가운데.
// 월드 = v.pos + Ry(yaw)·Rx(pitch)·Rz(roll)·local  — Three.js `rotation.set(pitch, yaw, roll, 'YXZ')` 와 같다.
//   pitch + = 앞이 들림, roll + = 오른쪽이 들림. 포탑은 차체 안에서 Ry(tYaw)·Rx(tPitch), 포신은 로컬 -z.
// seatWorldPos 는 그 좌석 탑승자의 눈 위치(카메라 자리)다.
// ═══════════════════════════════════════════════════════════════════════════
import type { Box, Controls, Game, Projectile, ProjKind, Soldier, Team, Vec3, Vehicle, VehicleDef, VehicleType, VWeaponDef, World } from '../types';
import { clamp, copy, damp, DEG, dirFrom, distXZ, forwardXZ, rayAABB, rightXZ, spreadDir, v3, wrapAngle, yawTo } from '../math';
import { BODY } from './body';
import { SIZES, VEHICLES, VWEAPONS } from '../defs';
import { boxesNear, damageBox, floorAt, groundTypeAt, heightAt, inWater, raycast } from '../world';
import { emit, rand } from './game';
import { applyBreak, damageSoldier, damageVehicle, explode, killSoldier } from './damage';

// ───────────────────────── 상수 ─────────────────────────

const ENTER_PAD = 2.2;          // 차체 반 길이 + 이만큼 안에서 탑승
const REVIVE_PRIORITY_R = 1.8;  // 쓰러진 아군이 이 안에 있으면 탑승보다 소생 우선
const EXIT_GRACE = 0.5;         // 내린 뒤 다시 타기까지 s
const CLIMB_TRACKED = 1.2;      // 넘어갈 수 있는 턱 높이
const CLIMB_WHEELED = 0.9;
const GRAVITY = 18;
const HELI_VY = 8;
const HELI_MAX_ALT = 150;
const HELI_GUN_YAW = 2.0;       // 헬기 기수 기관포 좌우 한계 rad
const MUZZLE: Record<VWeaponDef['kind'], number> = { cannon: 4.2, autocannon: 2.6, mg: 0.9, rockets: 1.2, atgm: 0.9 };
const MASS: Record<VehicleType, number> = { mbt: 4, ifv: 3, ltv: 1.5, heli: 1.2 };
/** 지면 종류별 속도 배율 (0 눈, 1 풀, 2 진흙, 3 아스팔트, 4 콘크리트, 5 자갈) */
const GROUND_MUL = [0.85, 0.92, 0.78, 1, 1, 0.95];

// ───────────────────────── 내부 상태 ─────────────────────────

interface VState {
  homeTeam: Team;
  wasAlive: boolean;
  /** 지난 스텝 끝의 hp (바깥 피해 감지) */
  hpSeen: number;
  hurtAt: number;
  emptyT: number;
  landed: boolean;
  /** 지상 차량 낙하 속도 */
  vy: number;
  /** 포탑을 잡고 있는 좌석 (-1 = 포탑 없음) */
  turretSeat: number;
  aimYaw: number[]; aimPitch: number[];
  overheat: boolean[]; shots: number[]; pod: number[];
}

const STATES = new WeakMap<Vehicle, VState>();
const lastExit = new WeakMap<Soldier, number>();
const lastEnter = new WeakMap<Soldier, number>();
const lastRam = new WeakMap<Soldier, number>();
const eventCursor = new WeakMap<Game, number>();

function stateOf(v: Vehicle): VState {
  let st = STATES.get(v);
  if (!st) {
    const n = v.seats.length;
    const h = v.ai && typeof v.ai === 'object' ? v.ai.homeTeam : undefined;
    st = {
      homeTeam: h === 0 || h === 1 ? h : v.team,
      wasAlive: v.alive, hpSeen: v.hp, hurtAt: -1e9, emptyT: 0, landed: true, vy: 0, turretSeat: -1,
      aimYaw: new Array<number>(n).fill(v.yaw), aimPitch: new Array<number>(n).fill(0),
      overheat: new Array<boolean>(n).fill(false), shots: new Array<number>(n).fill(0), pod: new Array<number>(n).fill(1),
    };
    STATES.set(v, st);
  }
  return st;
}

// ───────────────────────── 회전 도우미 ─────────────────────────

/** 차체 회전 행렬의 열: 로컬 +x(오른쪽), +y(위), +z(뒤) 의 월드 방향 */
interface Basis { rx: number; ry: number; rz: number; ux: number; uy: number; uz: number; bx: number; by: number; bz: number }
const mkBasis = (): Basis => ({ rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, bx: 0, by: 0, bz: 1 });
const SB = mkBasis(), FB = mkBasis(), HB = mkBasis();

function basis(v: Vehicle, o: Basis): Basis {
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
  const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
  const cr = Math.cos(v.roll), sr = Math.sin(v.roll);
  o.rx = cy * cr + sy * sp * sr; o.ry = cp * sr; o.rz = -sy * cr + cy * sp * sr;
  o.ux = -cy * sr + sy * sp * cr; o.uy = cp * cr; o.uz = sy * sr + cy * sp * cr;
  o.bx = sy * cp; o.by = -sp; o.bz = cy * cp;
  return o;
}

const toWorldDir = (b: Basis, x: number, y: number, z: number): Vec3 => ({
  x: b.rx * x + b.ux * y + b.bx * z,
  y: b.ry * x + b.uy * y + b.by * z,
  z: b.rz * x + b.uz * y + b.bz * z,
});

/** 2D 분리축: 회전한 사각형 A 를 B 밖으로 밀어낼 최소 이동 → PUSH. 겹치지 않으면 false */
const PUSH = { x: 0, z: 0 };
function sat(ax: number, az: number, ahw: number, ahl: number, ayaw: number,
  bx: number, bz: number, bhw: number, bhl: number, byaw: number): boolean {
  const arx = Math.cos(ayaw), arz = -Math.sin(ayaw), afx = -Math.sin(ayaw), afz = -Math.cos(ayaw);
  const brx = Math.cos(byaw), brz = -Math.sin(byaw), bfx = -Math.sin(byaw), bfz = -Math.cos(byaw);
  const dx = bx - ax, dz = bz - az;
  let best = Infinity, nx = 0, nz = 0;
  for (let k = 0; k < 4; k++) {
    const ux = k === 0 ? arx : k === 1 ? afx : k === 2 ? brx : bfx;
    const uz = k === 0 ? arz : k === 1 ? afz : k === 2 ? brz : bfz;
    const ra = ahw * Math.abs(arx * ux + arz * uz) + ahl * Math.abs(afx * ux + afz * uz);
    const rb = bhw * Math.abs(brx * ux + brz * uz) + bhl * Math.abs(bfx * ux + bfz * uz);
    const d = dx * ux + dz * uz;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return false;
    if (o < best) { best = o; const sg = d > 0 ? -1 : 1; nx = ux * sg; nz = uz * sg; }
  }
  PUSH.x = nx * best; PUSH.z = nz * best;
  return true;
}

// ───────────────────────── 지면 도우미 ─────────────────────────

/** (x,z) 에서 refY+climb 이하의 가장 높은 디딤면 (지형·바닥·상자 윗면) */
function surfaceH(w: World, x: number, z: number, refY: number, climb: number): number {
  const t = heightAt(w, x, z);
  const f = floorAt(w, x, Math.max(refY, t) + climb - 0.5, z, 0.4);
  return f > t ? f : t;
}

function waterDepth(w: World, x: number, z: number): number {
  if (!(w.water > -1e8) || !inWater(w, x, z)) return 0;
  return w.water - heightAt(w, x, z);
}

function heliGround(w: World, v: Vehicle, def: VehicleDef, refY: number): number {
  const f = forwardXZ(v.yaw), k = def.size.z * 0.3;
  const x = clamp(v.pos.x, 0, w.size), z = clamp(v.pos.z, 0, w.size);
  let h = surfaceH(w, x, z, refY, 0.6);
  h = Math.max(h, surfaceH(w, x + f.x * k, z + f.z * k, refY, 0.6), surfaceH(w, x - f.x * k, z - f.z * k, refY, 0.6));
  if (w.water > -1e8 && inWater(w, x, z)) h = Math.max(h, w.water);
  return h;
}

/** 지도 안으로. 밖으로 밀렸으면 true */
function clampMap(w: World, v: Vehicle, m: number): boolean {
  const lo = m, hi = w.size - m;
  let hit = false;
  if (v.pos.x < lo) { v.pos.x = lo; if (v.vel.x < 0) v.vel.x = 0; hit = true; }
  if (v.pos.x > hi) { v.pos.x = hi; if (v.vel.x > 0) v.vel.x = 0; hit = true; }
  if (v.pos.z < lo) { v.pos.z = lo; if (v.vel.z < 0) v.vel.z = 0; hit = true; }
  if (v.pos.z > hi) { v.pos.z = hi; if (v.vel.z > 0) v.vel.z = 0; hit = true; }
  return hit;
}

/** 지상 차량을 네 모서리 지면 높이에 맞춘다 (y, pitch, roll) */
function settleGround(g: Game, v: Vehicle, def: VehicleDef, st: VState, dt: number, snap: boolean): void {
  const w = g.world;
  const climb = v.type === 'ltv' ? CLIMB_WHEELED : CLIMB_TRACKED;
  const hw = def.size.x * 0.42, hl = def.size.z * 0.42;
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const px = v.pos.x, pz = v.pos.z, ry = v.pos.y;
  // 로컬 (lx, lz) → 월드 (px + lx*c + lz*s, pz - lx*s + lz*c). 앞 = -z
  const fl = surfaceH(w, px - hw * c - hl * s, pz + hw * s - hl * c, ry, climb);
  const fr = surfaceH(w, px + hw * c - hl * s, pz - hw * s - hl * c, ry, climb);
  const bl = surfaceH(w, px - hw * c + hl * s, pz + hw * s + hl * c, ry, climb);
  const br = surfaceH(w, px + hw * c + hl * s, pz - hw * s + hl * c, ry, climb);
  const ty = (fl + fr + bl + br) * 0.25;
  const pT = Math.atan2((fl + fr - bl - br) * 0.5, 2 * hl);
  const rT = Math.atan2((fr + br - fl - bl) * 0.5, 2 * hw);
  if (snap) { v.pos.y = ty; v.pitch = pT; v.roll = rT; st.vy = 0; v.vel.y = 0; return; }
  const k = damp(10, dt);
  v.pitch += (pT - v.pitch) * k;
  v.roll += (rT - v.roll) * k;
  const oy = v.pos.y, gap = oy - ty;
  if (gap > 0.35 || st.vy < -1) {
    st.vy -= GRAVITY * dt;
    v.pos.y = oy + st.vy * dt;
    if (v.pos.y <= ty) {
      v.pos.y = ty;
      if (st.vy < -12) selfDamage(g, v, (-st.vy - 12) * v.maxHp * 0.03, '추락');
      st.vy = 0;
    }
  } else if (gap > 0) { v.pos.y = ty; st.vy = 0; }
  else { v.pos.y = Math.max(ty - 0.3, oy + (ty - oy) * damp(20, dt)); st.vy = 0; }
  v.vel.y = (v.pos.y - oy) / dt;
}

// ───────────────────────── 자해·파괴 ─────────────────────────

/** 충돌·추락·화재처럼 공격자 없는 피해. 치명적이면 sim-core 의 damageVehicle 로 파괴를 맡긴다 */
function selfDamage(g: Game, v: Vehicle, dmg: number, weapon: string): void {
  if (!v.alive || !(dmg > 0)) return;
  if (v.hp - dmg > 0) { v.hp -= dmg; return; }
  const by = v.lastHurtBy >= 0 ? v.lastHurtBy : -1;
  damageVehicle(g, v, v.maxHp * 20 + dmg, by, weapon, null, 'explosive');
  if (v.alive) {
    // 안전장치: 아군 피해 무시 규칙 등으로 안 죽었으면 여기서 파괴
    v.hp = 0; v.alive = false;
    for (const sid of v.seats.slice()) {
      const s = sid >= 0 ? g.soldiers[sid] : undefined;
      if (s && s.vehicle === v.id && s.state !== 'dead') killSoldier(g, s, by, weapon, false);
    }
    const def = VEHICLES[v.type];
    const h = def ? def.size.y * 0.5 : 1;
    explode(g, { x: v.pos.x, y: v.pos.y + h, z: v.pos.z }, 6, 90, by, v.team, weapon, { dmgVehicle: 0, wallDmg: 150, kind: 'vehicle' });
    emit(g, { k: 'vdestroyed', v: v.id, by });
  }
}

// ───────────────────────── 생성·재생성 ─────────────────────────

function makeWpn(def: VehicleDef): Vehicle['wpn'] {
  return def.seats.map((sd) => {
    const wd = sd.weapon ? VWEAPONS[sd.weapon] : undefined;
    return { mag: wd ? wd.mag : 0, reloadT: 0, fireT: 0, heat: 0 };
  });
}

function placeAtSpawn(g: Game, v: Vehicle, def: VehicleDef, st: VState): void {
  v.pos.x = v.spawn.pos.x; v.pos.y = v.spawn.pos.y; v.pos.z = v.spawn.pos.z;
  v.yaw = v.spawn.yaw; v.pitch = 0; v.roll = 0;
  v.vel.x = 0; v.vel.y = 0; v.vel.z = 0; v.speed = 0;
  clampMap(g.world, v, 2);
  if (def.air) { v.pos.y = heliGround(g.world, v, def, v.pos.y); st.landed = true; }
  else settleGround(g, v, def, st, 1 / 60, true);
}

export function createVehicles(g: Game): void {
  if (!g.vehicles) g.vehicles = [];
  const w = g.world;
  const sz = SIZES[g.opts.size];
  const list: VehicleType[] = sz ? sz.vehicles : [];
  const center = v3(w.size / 2, 0, w.size / 2);
  for (const team of [0, 1] as Team[]) {
    const ground = w.vehicleSpawns.filter((p) => p.team === team && !p.air);
    const air = w.vehicleSpawns.filter((p) => p.team === team && p.air);
    let gi = 0, ai = 0, extra = 0;
    for (const type of list) {
      const def = VEHICLES[type];
      if (!def) continue;
      const pad = def.air ? air[ai++] : ground[gi++];
      let pos: Vec3, yaw: number;
      if (pad) { pos = copy(pad.pos); yaw = pad.yaw; }
      else {
        // 자리가 모자라면 본부 둘레에
        const base = (w.hq && w.hq[team]) || center;
        const k = extra++;
        const ang = k * 1.1 + team * Math.PI, r = 18 + 5 * k;
        pos = v3(clamp(base.x + Math.cos(ang) * r, 8, w.size - 8), base.y, clamp(base.z + Math.sin(ang) * r, 8, w.size - 8));
        pos.y = heightAt(w, pos.x, pos.z);
        yaw = yawTo(pos, center);
      }
      const v: Vehicle = {
        id: g.vehicles.length, type, team, alive: true,
        pos: copy(pos), vel: v3(), yaw, pitch: 0, roll: 0, tYaw: 0, tPitch: 0, speed: 0,
        hp: def.hp, maxHp: def.hp,
        seats: new Array<number>(def.seats.length).fill(-1),
        wpn: makeWpn(def),
        respawnT: 0, wreckT: 0,
        spawn: { pos: copy(pos), yaw },
        counterCd: 0, counterT: 0, burning: false, lastHurtBy: -1, spotT: 0, lockWarn: 0,
        ai: { homeTeam: team },
      };
      g.vehicles.push(v);
      const st = stateOf(v);
      st.homeTeam = team;
      placeAtSpawn(g, v, def, st);
    }
  }
}

function respawnVehicle(g: Game, v: Vehicle): void {
  const def = VEHICLES[v.type];
  if (!def) return;
  const st = stateOf(v);
  for (const sid of v.seats.slice()) {
    const s = sid >= 0 ? g.soldiers[sid] : undefined;
    if (s && s.vehicle === v.id) exitVehicle(g, s);
  }
  v.team = st.homeTeam; v.alive = true; v.maxHp = def.hp; v.hp = def.hp;
  v.seats = new Array<number>(def.seats.length).fill(-1);
  v.wpn = makeWpn(def);
  v.tYaw = 0; v.tPitch = 0; v.respawnT = 0; v.wreckT = 0;
  v.counterCd = 0; v.counterT = 0; v.burning = false; v.lastHurtBy = -1; v.spotT = 0; v.lockWarn = 0;
  placeAtSpawn(g, v, def, st);
  st.wasAlive = true; st.hpSeen = v.hp; st.hurtAt = -1e9; st.emptyT = 0; st.vy = 0;
  st.overheat.fill(false); st.shots.fill(0);
  if (v.ai && typeof v.ai === 'object') v.ai.homeTeam = st.homeTeam; else v.ai = { homeTeam: st.homeTeam };
}

// ───────────────────────── 좌석 위치·조준 ─────────────────────────

export function seatWorldPos(v: Vehicle, seat: number): Vec3 {
  const def = VEHICLES[v.type];
  const sd = def ? def.seats[seat] : undefined;
  const o = sd ? sd.offset : { x: 0, y: def ? def.size.y : 2, z: 0 };
  const b = basis(v, SB);
  return {
    x: v.pos.x + b.rx * o.x + b.ux * o.y + b.bx * o.z,
    y: v.pos.y + b.ry * o.x + b.uy * o.y + b.by * o.z,
    z: v.pos.z + b.rz * o.x + b.uz * o.y + b.bz * o.z,
  };
}

export function seatAimDir(v: Vehicle, seat: number): Vec3 {
  const def = VEHICLES[v.type];
  const sd = def ? def.seats[seat] : undefined;
  const st = stateOf(v);
  if (sd && sd.turret && (st.turretSeat < 0 || st.turretSeat === seat)) {
    const ld = dirFrom(v.tYaw, v.tPitch);
    return toWorldDir(basis(v, SB), ld.x, ld.y, ld.z);
  }
  if (sd && sd.weapon && seat === 0) return toWorldDir(basis(v, SB), 0, 0, -1); // 고정 무기 (헬기 조종석 로켓 등)
  const y = st.aimYaw[seat], p = st.aimPitch[seat];
  return dirFrom(y !== undefined ? y : v.yaw, p !== undefined ? p : 0);
}

function pitchLimits(t: VehicleType): [number, number] {
  if (t === 'heli') return [-1.0, 0.2];
  if (t === 'ltv') return [-0.3, 0.6];
  return [-0.15, 0.4];
}

/** 포수 시선(월드)을 차체 로컬로 바꿔 포탑을 turretTurn 속도로 따라가게 */
function aimTurret(v: Vehicle, def: VehicleDef, c: Controls, dt: number): void {
  const b = basis(v, SB);
  const d = dirFrom(c.yaw, clamp(c.pitch, -1.45, 1.45));
  const lx = d.x * b.rx + d.y * b.ry + d.z * b.rz;
  const ly = d.x * b.ux + d.y * b.uy + d.z * b.uz;
  const lz = d.x * b.bx + d.y * b.by + d.z * b.bz;
  let ty = Math.atan2(-lx, -lz);
  const [lo, hi] = pitchLimits(v.type);
  const tp = clamp(Math.asin(clamp(ly, -1, 1)), lo, hi);
  const rate = Math.max(0.1, def.turretTurn) * dt;
  if (v.type === 'heli') {
    ty = clamp(ty, -HELI_GUN_YAW, HELI_GUN_YAW);
    v.tYaw = clamp(v.tYaw + clamp(ty - v.tYaw, -rate, rate), -HELI_GUN_YAW, HELI_GUN_YAW);
  } else {
    v.tYaw = wrapAngle(v.tYaw + clamp(wrapAngle(ty - v.tYaw), -rate, rate));
  }
  const pr = Math.max(0.6, def.turretTurn) * 0.8 * dt;
  v.tPitch = clamp(v.tPitch + clamp(tp - v.tPitch, -pr, pr), lo, hi);
}

// ───────────────────────── 탑승·하차 ─────────────────────────

function occupantOf(g: Game, v: Vehicle, seat: number): Soldier | null {
  const sid = v.seats[seat];
  if (sid === undefined || sid < 0) return null;
  const s = g.soldiers[sid];
  return s && s.vehicle === v.id && s.seat === seat ? s : null;
}

function hasOccupant(v: Vehicle): boolean {
  for (const id of v.seats) if (id >= 0) return true;
  return false;
}

function freeSeat(v: Vehicle): number {
  if (v.seats[0] === -1) return 0;
  return v.seats.indexOf(-1);
}

function canBoard(v: Vehicle, s: Soldier): boolean {
  if (!v.alive || freeSeat(v) < 0) return false;
  return !(hasOccupant(v) && v.team !== s.team);
}

/** 카메라·시선을 그 좌석의 정면으로 맞춘다 */
function alignView(v: Vehicle, def: VehicleDef, s: Soldier, seat: number): void {
  const sd = def.seats[seat];
  const yaw = wrapAngle(v.yaw + (sd && sd.turret ? v.tYaw : 0));
  s.yaw = yaw; s.ctl.yaw = yaw; s.pitch = 0; s.ctl.pitch = 0;
  const st = stateOf(v);
  st.aimYaw[seat] = yaw; st.aimPitch[seat] = 0;
}

function syncSeat(v: Vehicle, seat: number, s: Soldier): void {
  const p = seatWorldPos(v, seat);
  s.pos.x = p.x; s.pos.y = p.y - s.eyeH; s.pos.z = p.z;
  s.vel.x = v.vel.x; s.vel.y = v.vel.y; s.vel.z = v.vel.z;
  s.yaw = s.ctl.yaw; s.pitch = clamp(s.ctl.pitch, -1.45, 1.45);
  s.onGround = true; s.sprinting = false; s.sliding = 0;
}

/** 탑승 시 interact 로 탈 차량 (차체 반 길이 + 2.2m 안, 탈 수 있는 것 중 가장 가까운 것) */
export function enterableVehicle(g: Game, s: Soldier): Vehicle | null {
  let best: Vehicle | null = null, bestScore = Infinity;
  for (const v of g.vehicles) {
    if (!v.alive) continue;
    const def = VEHICLES[v.type];
    if (!def) continue;
    const half = Math.max(def.size.x, def.size.z) * 0.5;
    const d = distXZ(s.pos, v.pos);
    if (d > ENTER_PAD + half) continue;
    if (Math.abs(v.pos.y + def.size.y * 0.5 - (s.pos.y + 1)) >= 4) continue;
    if (!canBoard(v, s)) continue;
    const score = d - half;
    if (score < bestScore) { bestScore = score; best = v; }
  }
  return best;
}

export function enterVehicle(g: Game, s: Soldier, v: Vehicle, seat: number): boolean {
  if (!v || !v.alive || s.state !== 'alive' || s.vehicle >= 0) return false;
  if (seat < 0 || seat >= v.seats.length || v.seats[seat] !== -1) return false;
  const def = VEHICLES[v.type];
  if (!def) return false;
  const occupied = hasOccupant(v);
  if (occupied && v.team !== s.team) return false;
  if (!occupied && v.team !== s.team) v.team = s.team; // 빈 적 차량 탈취
  v.seats[seat] = s.id;
  s.vehicle = v.id; s.seat = seat;
  s.ads = 0; s.held = 'weapon'; s.sprinting = false; s.sliding = 0;
  s.reviving = -1; s.reviveProg = 0;
  s.interactPressed = false;
  s.ctl.exit = false; s.ctl.seat = -1; s.ctl.counter = false;
  const st = stateOf(v);
  st.emptyT = 0;
  alignView(v, def, s, seat);
  syncSeat(v, seat, s);
  lastEnter.set(s, g.time);
  emit(g, { k: 'venter', s: s.id, v: v.id, seat });
  return true;
}

function bodyBlocked(w: World, x: number, y: number, z: number): boolean {
  let hit = false;
  const r = BODY.radius;
  boxesNear(w, x, z, r + 0.3, (b: Box) => {
    if (hit || !b.alive || !b.solid) return;
    if (b.max.y <= y + 0.35 || b.min.y >= y + 1.75) return;
    const cx = clamp(x, b.min.x, b.max.x), cz = clamp(z, b.min.z, b.max.z);
    if ((cx - x) ** 2 + (cz - z) ** 2 < r * r) hit = true;
  });
  return hit;
}

/** 내린 병사를 차체 옆(좌석 쪽 먼저)에 세운다 */
function placeOutside(g: Game, v: Vehicle, s: Soldier, seat: number): void {
  const w = g.world;
  const def = VEHICLES[v.type];
  const hw = def ? def.size.x * 0.5 : 1.5, hl = def ? def.size.z * 0.5 : 2.5;
  const sd = def ? def.seats[seat] : undefined;
  const side = sd && sd.offset.x > 0.05 ? 1 : -1;
  const sz = sd ? clamp(sd.offset.z, -hl * 0.8, hl * 0.8) : 0;
  const gap = hw + 0.8;
  const cand: [number, number][] = [[side * gap, sz], [-side * gap, sz], [0, hl + 1.0], [0, -(hl + 1.0)], [side * gap, hl + 1.0], [-side * gap, hl + 1.0]];
  const airborne = !!def && def.air && v.pos.y - heliGround(w, v, def, v.pos.y) > 2.5;
  const c = Math.cos(v.yaw), sn = Math.sin(v.yaw);
  let px = v.pos.x, py = v.pos.y + (def ? def.size.y : 2) + 0.05, pz = v.pos.z;
  for (const [lx, lz] of cand) {
    const x = v.pos.x + lx * c + lz * sn, z = v.pos.z - lx * sn + lz * c;
    if (x < 1 || z < 1 || x > w.size - 1 || z > w.size - 1) continue;
    const y = airborne ? v.pos.y : surfaceH(w, x, z, v.pos.y, 1.5);
    if (bodyBlocked(w, x, y, z)) continue;
    px = x; py = y; pz = z;
    break;
  }
  s.pos.x = px; s.pos.y = py; s.pos.z = pz;
  if (airborne) { s.vel.x = v.vel.x; s.vel.y = v.vel.y; s.vel.z = v.vel.z; }
  else { s.vel.x = 0; s.vel.y = 0; s.vel.z = 0; }
  s.onGround = !airborne;
  s.yaw = s.ctl.yaw; s.pitch = clamp(s.ctl.pitch, -1.45, 1.45);
}

export function exitVehicle(g: Game, s: Soldier): void {
  const vid = s.vehicle;
  if (vid < 0) return;
  const seat = s.seat;
  s.vehicle = -1; s.seat = -1;
  const v = g.vehicles[vid];
  if (!v) return;
  for (let i = 0; i < v.seats.length; i++) if (v.seats[i] === s.id) v.seats[i] = -1;
  placeOutside(g, v, s, seat);
  s.ctl.exit = false; s.ctl.seat = -1; s.ctl.counter = false;
  lastExit.set(s, g.time);
  emit(g, { k: 'vexit', s: s.id, v: v.id });
}

export function nearestVehicle(g: Game, s: Soldier, maxD: number): Vehicle | null {
  let best: Vehicle | null = null, bd = maxD;
  for (const v of g.vehicles) {
    if (!v.alive) continue;
    const def = VEHICLES[v.type];
    const h = def ? def.size.y : 2;
    const d = distXZ(s.pos, v.pos);
    if (d > bd) continue;
    if (Math.abs(v.pos.y + h * 0.5 - (s.pos.y + 1)) >= 4) continue;
    best = v; bd = d;
  }
  return best;
}

function downedMateNear(g: Game, s: Soldier): boolean {
  const r2 = REVIVE_PRIORITY_R * REVIVE_PRIORITY_R;
  for (const o of g.soldiers) {
    if (o === s || o.team !== s.team || o.state !== 'down' || o.vehicle >= 0) continue;
    const dx = o.pos.x - s.pos.x, dy = o.pos.y - s.pos.y, dz = o.pos.z - s.pos.z;
    if (dx * dx + dy * dy + dz * dz < r2) return true;
  }
  return false;
}

function handleEntering(g: Game): void {
  for (const s of g.soldiers) {
    if (s.vehicle >= 0) continue;
    const c = s.ctl;
    // 차 밖에서는 차량 엣지가 의미 없다: 묵은 엣지가 탑승 직후 터지지 않게 비운다
    c.exit = false; c.seat = -1; c.counter = false;
    if (!s.interactPressed || s.state !== 'alive') continue;
    const le = lastExit.get(s);
    if (le !== undefined && g.time - le < EXIT_GRACE) continue;
    if (downedMateNear(g, s)) continue;
    const v = enterableVehicle(g, s);
    if (!v) continue;
    const seat = freeSeat(v);
    if (seat >= 0) enterVehicle(g, s, v, seat);
  }
}

/** 좌석과 병사 상태가 어긋난 것 정리 (죽음·쓰러짐·차량 파괴) */
function validateSeats(g: Game, v: Vehicle): void {
  for (let i = 0; i < v.seats.length; i++) {
    const sid = v.seats[i];
    if (sid < 0) continue;
    const s = g.soldiers[sid];
    if (!s || s.vehicle !== v.id || s.seat !== i) { v.seats[i] = -1; continue; }
    if (s.state === 'dead') { v.seats[i] = -1; s.vehicle = -1; s.seat = -1; continue; }
    if (s.state === 'down' || !v.alive) exitVehicle(g, s);
  }
}

function tryCounter(g: Game, v: Vehicle, def: VehicleDef): void {
  if (v.counterCd > 0 || !v.alive) return;
  v.counterCd = 20;
  if (def.air || def.counter === 'flare') {
    v.counterT = 3;
  } else {
    v.counterT = 2;
    const yaw = v.yaw + v.tYaw;
    for (let k = -1; k <= 1; k++) {
      const d = forwardXZ(yaw + k * 0.9);
      g.smokes.push({ pos: { x: v.pos.x + d.x * 7, y: v.pos.y + 1.2, z: v.pos.z + d.z * 7 }, r: 8, life: 15, max: 15 });
    }
  }
  emit(g, { k: 'counter', v: v.id });
}

function occupantControls(g: Game, v: Vehicle, def: VehicleDef, st: VState): void {
  const n = v.seats.length;
  for (let i = 0; i < n; i++) {
    const s = occupantOf(g, v, i);
    if (!s) continue;
    const c = s.ctl;
    st.aimYaw[i] = c.yaw; st.aimPitch[i] = clamp(c.pitch, -1.45, 1.45);
    const ent = lastEnter.get(s);
    const pressExit = s.interactPressed && (ent === undefined || g.time - ent > 0.6);
    if (c.exit || pressExit) {
      s.interactPressed = false;
      exitVehicle(g, s);
      continue;
    }
    if (c.counter) { c.counter = false; if (i <= 1) tryCounter(g, v, def); }
    if (c.seat >= 0) {
      const to = c.seat;
      c.seat = -1;
      if (to < n && to !== i && v.seats[to] === -1) {
        v.seats[i] = -1; v.seats[to] = s.id; s.seat = to;
        alignView(v, def, s, to);
        emit(g, { k: 'venter', s: s.id, v: v.id, seat: to });
      }
    }
  }
}

// ───────────────────────── 지상 운전 ─────────────────────────

const tmpBoxes: Box[] = [];

function isWeak(b: Box, t: VehicleType): boolean {
  if (!b.destructible) return false;
  switch (b.kind) {
    case 'fence': case 'window': case 'tree': case 'sandbag': case 'prop': case 'cover': return true;
    case 'rubble': return t !== 'ltv';
    case 'wall':
      if (b.mat === 'wood' || b.mat === 'glass' || b.mat === 'foliage') return true;
      if (t === 'mbt') return b.hp < 400;
      if (t === 'ifv') return b.hp < 250;
      return false;
    default: return false;
  }
}

function groundBoxCollide(g: Game, v: Vehicle, def: VehicleDef, dt: number): void {
  const w = g.world;
  const hw = def.size.x * 0.5, hl = def.size.z * 0.5;
  const tracked = v.type !== 'ltv';
  const climb = tracked ? CLIMB_TRACKED : CLIMB_WHEELED;
  tmpBoxes.length = 0;
  boxesNear(w, v.pos.x, v.pos.z, Math.hypot(hw, hl) + 1, (b: Box) => { if (b.alive && b.solid) tmpBoxes.push(b); });
  let slowed = false;
  for (let k = 0; k < tmpBoxes.length; k++) {
    const b = tmpBoxes[k];
    if (!b.alive) continue;
    const bottom = v.pos.y;
    if (b.max.y <= bottom + 0.3 || b.min.y >= bottom + def.size.y) continue;
    const bx = (b.min.x + b.max.x) * 0.5, bz = (b.min.z + b.max.z) * 0.5;
    if (!sat(v.pos.x, v.pos.z, hw, hl, v.yaw, bx, bz, (b.max.x - b.min.x) * 0.5, (b.max.z - b.min.z) * 0.5, 0)) continue;
    const low = b.max.y - bottom <= climb;
    const weak = isWeak(b, v.type);
    const spd = Math.abs(v.speed);
    if (weak && spd > 3) {
      // 들이받아 부숨
      applyBreak(g, damageBox(w, b.id, b.hp + 1));
      if (!slowed) { v.speed *= 0.7; slowed = true; }
      continue;
    }
    if (low) continue; // 넘어간다 (높이는 settleGround 가 floorAt 으로)
    if (weak && tracked) {
      // 천천히 밀어붙이면 조금씩 부서짐
      applyBreak(g, damageBox(w, b.id, (v.type === 'mbt' ? 600 : 350) * dt));
      if (!b.alive) continue;
    }
    const px = PUSH.x, pz = PUSH.z;
    v.pos.x += px; v.pos.z += pz;
    const pl = Math.hypot(px, pz) || 1;
    const f = forwardXZ(v.yaw);
    const into = -((f.x * px + f.z * pz) / pl) * (v.speed >= 0 ? 1 : -1);
    if (into > 0) {
      const impact = spd * into;
      if (impact > 9) selfDamage(g, v, (impact - 9) * def.hp * 0.012, '충돌');
      v.speed *= clamp(1 - into, 0, 1);
    }
  }
  tmpBoxes.length = 0;
}

function driveGround(g: Game, v: Vehicle, def: VehicleDef, st: VState, driver: Soldier | null, dt: number): void {
  const w = g.world;
  const tracked = v.type !== 'ltv';
  const thr = driver ? clamp(driver.ctl.mz, -1, 1) : 0;
  const steer = driver ? clamp(driver.ctl.mx, -1, 1) : 0;
  const hl = def.size.z * 0.5;

  // 지면·경사
  let surf = GROUND_MUL[groundTypeAt(w, v.pos.x, v.pos.z)] ?? 1;
  if (tracked) surf = 1 - (1 - surf) * 0.5;
  const moveSign = Math.abs(v.speed) > 0.5 ? Math.sign(v.speed) : thr !== 0 ? Math.sign(thr) : 0;
  let slope = 0;
  if (moveSign !== 0) {
    const f0 = forwardXZ(v.yaw), ahead = hl + 1.5;
    const ha = surfaceH(w, v.pos.x + f0.x * ahead * moveSign, v.pos.z + f0.z * ahead * moveSign, v.pos.y, tracked ? CLIMB_TRACKED : CLIMB_WHEELED);
    slope = Math.atan2(ha - v.pos.y, ahead);
  }
  const steep = slope > 35 * DEG;
  const slopeMul = slope <= 20 * DEG ? 1 : steep ? 0 : 1 - (slope - 20 * DEG) / (15 * DEG) * 0.65;

  // 목표 속도
  let target = thr >= 0 ? thr * def.speed : thr * def.reverse;
  if (tracked) target *= 1 - 0.25 * Math.abs(steer);
  target *= surf;
  if (Math.sign(target) === moveSign) target *= slopeMul;
  if (waterDepth(w, v.pos.x, v.pos.z) > 0.3) target *= 0.55;
  let rate: number;
  if (Math.abs(thr) < 0.01) rate = def.accel * 0.45;                                     // 굴러가며 서서히
  else if (v.speed * target < 0 || Math.abs(target) < Math.abs(v.speed)) rate = def.accel * 2.2; // 제동
  else rate = def.accel;
  if (steep) rate = Math.max(rate, def.accel * 2.5);
  v.speed += clamp(target - v.speed, -rate * dt, rate * dt);

  // 조향: 궤도는 제자리 선회, 바퀴는 속도에 비례 (후진하면 반대)
  const yr = tracked
    ? -steer * def.turn * (1 - 0.3 * Math.min(1, Math.abs(v.speed) / Math.max(1, def.speed)))
    : -steer * def.turn * clamp(v.speed / 5, -1, 1);
  v.yaw = wrapAngle(v.yaw + yr * dt);

  // 이동
  const F = forwardXZ(v.yaw);
  const ox = v.pos.x, oz = v.pos.z;
  if (!(steep && slope > 45 * DEG)) {
    v.pos.x += F.x * v.speed * dt;
    v.pos.z += F.z * v.speed * dt;
  } else v.speed = 0;

  // 깊은 물에는 못 들어감
  if (Math.abs(v.speed) > 0.01 && w.water > -1e8) {
    const sg = v.speed >= 0 ? 1 : -1;
    const dNew = waterDepth(w, v.pos.x + F.x * hl * sg, v.pos.z + F.z * hl * sg);
    if (dNew > 1.0) {
      const dOld = waterDepth(w, ox + F.x * hl * sg, oz + F.z * hl * sg);
      if (dNew >= dOld - 1e-3) {
        v.pos.x = ox - F.x * 0.05 * sg; v.pos.z = oz - F.z * 0.05 * sg;
        v.speed = 0;
      }
    }
  }

  groundBoxCollide(g, v, def, dt);
  if (clampMap(w, v, Math.max(2, def.size.x * 0.5))) v.speed *= 0.5;
  settleGround(g, v, def, st, dt, false);
  v.vel.x = (v.pos.x - ox) / dt;
  v.vel.z = (v.pos.z - oz) / dt;
}

// ───────────────────────── 헬기 비행 ─────────────────────────

function heliBoxCollide(g: Game, v: Vehicle, def: VehicleDef): void {
  const w = g.world;
  if (v.pos.y - heightAt(w, v.pos.x, v.pos.z) > 60) return;
  const hw = def.size.x * 0.5, hl = def.size.z * 0.5;
  tmpBoxes.length = 0;
  boxesNear(w, v.pos.x, v.pos.z, Math.hypot(hw, hl) + 1, (b: Box) => {
    if (b.alive && b.solid && b.max.y > v.pos.y + 0.6 && b.min.y < v.pos.y + def.size.y) tmpBoxes.push(b);
  });
  for (let k = 0; k < tmpBoxes.length; k++) {
    const b = tmpBoxes[k];
    const bx = (b.min.x + b.max.x) * 0.5, bz = (b.min.z + b.max.z) * 0.5;
    if (!sat(v.pos.x, v.pos.z, hw, hl, v.yaw, bx, bz, (b.max.x - b.min.x) * 0.5, (b.max.z - b.min.z) * 0.5, 0)) continue;
    const px = PUSH.x, pz = PUSH.z;
    v.pos.x += px; v.pos.z += pz;
    const pl = Math.hypot(px, pz) || 1;
    const nx = px / pl, nz = pz / pl;
    const vn = v.vel.x * nx + v.vel.z * nz;
    if (vn < 0) {
      if (-vn > 10) selfDamage(g, v, (-vn - 10) * v.maxHp * 0.04, '충돌');
      v.vel.x -= nx * vn * 1.3; v.vel.z -= nz * vn * 1.3;
    }
  }
  tmpBoxes.length = 0;
}

function flyHeli(g: Game, v: Vehicle, def: VehicleDef, st: VState, pilot: Soldier | null, dt: number): void {
  const w = g.world;
  const c = pilot ? pilot.ctl : null;
  const lift = c ? clamp(c.lift, -1, 1) : 0;
  const mz = c ? clamp(c.mz, -1, 1) : 0, mx = c ? clamp(c.mx, -1, 1) : 0;
  const g0 = heliGround(w, v, def, v.pos.y);
  const alt = v.pos.y - g0;
  const grounded = st.landed && alt < 0.3;

  // 기수는 조종사 시선(yaw)을 따라
  if (c && (!grounded || lift > 0)) {
    v.yaw = wrapAngle(v.yaw + clamp(wrapAngle(c.yaw - v.yaw), -def.turn * dt, def.turn * dt));
  }
  // 기울기: 앞으로 = 기수 숙임(pitch -), 오른쪽 = 오른쪽 내려감(roll -)
  let pT = 0, rT = 0;
  if (c && !(grounded && lift <= 0)) { pT = -mz * 0.35; rT = -mx * 0.4; }
  v.pitch += (pT - v.pitch) * damp(2.5, dt);
  v.roll += (rT - v.roll) * damp(3, dt);

  // 수직: 조종사 없으면 천천히 내려앉음
  let vyT: number;
  if (c) {
    vyT = Math.abs(lift) < 0.05 ? -0.25 : lift * HELI_VY;
    if (vyT < -3.5 && alt < 8) vyT = -3.5; // 땅 가까이선 자동으로 하강 속도 줄임
  } else vyT = -3;
  v.vel.y += clamp(vyT - v.vel.y, -10 * dt, 10 * dt);

  // 수평: 기울기만큼 가속
  const f = forwardXZ(v.yaw), r = rightXZ(v.yaw);
  let fk = clamp(-v.pitch / 0.35, -1, 1);
  if (fk < 0) fk *= 0.4;
  const sk = clamp(-v.roll / 0.4, -1, 1);
  let tx = (f.x * fk + r.x * sk * 0.6) * def.speed, tz = (f.z * fk + r.z * sk * 0.6) * def.speed;
  if (grounded || !c) { tx = 0; tz = 0; }
  const ddx = tx - v.vel.x, ddz = tz - v.vel.z, dl = Math.hypot(ddx, ddz);
  const acc = (grounded ? 20 : c ? Math.max(1, def.accel) : 3) * dt;
  if (dl > acc) { v.vel.x += (ddx / dl) * acc; v.vel.z += (ddz / dl) * acc; }
  else { v.vel.x = tx; v.vel.z = tz; }

  const oy = v.pos.y, ovy = v.vel.y;
  v.pos.x += v.vel.x * dt; v.pos.y += v.vel.y * dt; v.pos.z += v.vel.z * dt;
  heliBoxCollide(g, v, def);
  if (!v.alive) return;
  clampMap(w, v, 2);

  // 착지·추락
  const gnd = heliGround(w, v, def, Math.max(oy, v.pos.y));
  if (v.pos.y <= gnd) {
    const impactV = -ovy, horiz = Math.hypot(v.vel.x, v.vel.z);
    if (!st.landed && (impactV > 7 || horiz > 15)) {
      const ex = Math.max(impactV - 7, horiz - 15);
      selfDamage(g, v, v.maxHp * clamp(0.3 + ex * 0.07, 0.3, 2), '추락');
      v.vel.x *= 0.3; v.vel.z *= 0.3;
    }
    v.pos.y = gnd;
    if (v.vel.y < 0) v.vel.y = 0;
    st.landed = true;
    const k = Math.max(0, 1 - 5 * dt);
    v.vel.x *= k; v.vel.z *= k;
  } else if (v.pos.y > gnd + 0.25) st.landed = false;
  if (!v.alive) return;

  // 물에 닿으면 침수
  if (w.water > -1e8 && v.pos.y <= w.water + 0.3 && inWater(w, v.pos.x, v.pos.z)) selfDamage(g, v, v.maxHp * 0.35 * dt, '추락');
  // 최고 고도
  const top = heightAt(w, v.pos.x, v.pos.z) + HELI_MAX_ALT;
  if (v.pos.y > top) { v.pos.y = top; if (v.vel.y > 0) v.vel.y = 0; }
  // 조종사 없이 떠 있으면 hp 가 샌다
  if (!c && v.pos.y - gnd > 1.5) selfDamage(g, v, v.maxHp * 0.02 * dt, '추락');
  v.speed = v.vel.x * f.x + v.vel.z * f.z;
}

// ───────────────────────── 잔해 ─────────────────────────

function updateWreck(g: Game, v: Vehicle, def: VehicleDef, st: VState, dt: number): void {
  if (st.wasAlive) {
    st.wasAlive = false;
    v.wreckT = 0;
    if (!(v.respawnT > 0)) v.respawnT = def.respawn;
    v.speed = 0; v.counterT = 0; v.lockWarn = 0; v.burning = false;
    st.landed = false;
  }
  validateSeats(g, v);
  v.wreckT += dt;
  v.respawnT -= dt;
  if (def.air) {
    const gnd = heliGround(g.world, v, def, v.pos.y);
    if (v.pos.y > gnd + 0.02) {
      v.vel.y -= GRAVITY * dt;
      const k = Math.max(0, 1 - 0.6 * dt);
      v.vel.x *= k; v.vel.z *= k;
      v.pos.x += v.vel.x * dt; v.pos.y += v.vel.y * dt; v.pos.z += v.vel.z * dt;
      clampMap(g.world, v, 2);
      v.roll += (0.5 - v.roll) * damp(1.5, dt);
      v.pitch += (-0.25 - v.pitch) * damp(1.5, dt);
      v.yaw = wrapAngle(v.yaw + 1.6 * dt);
      if (v.pos.y <= gnd) { v.pos.y = gnd; v.vel.x = 0; v.vel.y = 0; v.vel.z = 0; }
    } else { v.pos.y = gnd; v.vel.x = 0; v.vel.y = 0; v.vel.z = 0; }
  } else { v.vel.x = 0; v.vel.y = 0; v.vel.z = 0; }
  if (v.respawnT <= 0) respawnVehicle(g, v);
}

// ───────────────────────── 차량끼리, 병사와 ─────────────────────────

function ramDamage(g: Game, victim: Vehicle, other: Vehicle, dmg: number): void {
  const od = other.seats[0];
  const os = od !== undefined && od >= 0 ? g.soldiers[od] : undefined;
  if (os && os.team !== victim.team) victim.lastHurtBy = os.id;
  selfDamage(g, victim, dmg, '차량 충돌');
}

/** 상대 쪽(n)으로 가던 속도를 잃는다 */
function bleed(v: Vehicle, nx: number, nz: number): void {
  if (!v.alive) return;
  const def = VEHICLES[v.type];
  if (def && def.air) {
    const vn = v.vel.x * nx + v.vel.z * nz;
    if (vn > 0) { v.vel.x -= nx * vn; v.vel.z -= nz * vn; }
  } else {
    const f = forwardXZ(v.yaw);
    const into = (f.x * nx + f.z * nz) * (v.speed >= 0 ? 1 : -1);
    if (into > 0) v.speed *= 1 - into * 0.85;
  }
}

function collideVehicles(g: Game): void {
  const vs = g.vehicles;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const da = VEHICLES[a.type];
    if (!da) continue;
    const ra = Math.hypot(da.size.x, da.size.z) * 0.5;
    for (let j = i + 1; j < vs.length; j++) {
      const b = vs[j];
      if (!a.alive && !b.alive) continue;
      const db = VEHICLES[b.type];
      if (!db) continue;
      const rb = Math.hypot(db.size.x, db.size.z) * 0.5;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      if (dx * dx + dz * dz >= (ra + rb) * (ra + rb)) continue;
      if (a.pos.y + da.size.y < b.pos.y + 0.3 || b.pos.y + db.size.y < a.pos.y + 0.3) continue;
      if (!sat(a.pos.x, a.pos.z, da.size.x * 0.5, da.size.z * 0.5, a.yaw, b.pos.x, b.pos.z, db.size.x * 0.5, db.size.z * 0.5, b.yaw)) continue;
      const ia = a.alive ? 1 / MASS[a.type] : 0, ib = b.alive ? 1 / MASS[b.type] : 0;
      const sum = ia + ib;
      if (sum <= 0) continue;
      const px = PUSH.x, pz = PUSH.z;
      a.pos.x += (px * ia) / sum; a.pos.z += (pz * ia) / sum;
      b.pos.x -= (px * ib) / sum; b.pos.z -= (pz * ib) / sum;
      const pl = Math.hypot(px, pz) || 1;
      const nx = -px / pl, nz = -pz / pl; // a → b
      const vn = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
      if (vn <= 0.5) continue;
      if (vn > 8 && a.alive && b.alive) {
        const ma = MASS[a.type], mb = MASS[b.type];
        const base = (vn - 8) * 18;
        ramDamage(g, a, b, (base * mb) / (ma + mb));
        ramDamage(g, b, a, (base * ma) / (ma + mb));
      }
      if (ia > 0) bleed(a, nx, nz);
      if (ib > 0) bleed(b, -nx, -nz);
    }
  }
}

/** 차체 안에 들어온 병사 밀어내기, 빠르게 달리는 차량에 치인 적 피해 */
function soldierContacts(g: Game, v: Vehicle, def: VehicleDef, dt: number): void {
  const hw = def.size.x * 0.5, hl = def.size.z * 0.5;
  const R = Math.hypot(hw, hl) + 1;
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const fast = v.alive && !def.air && Math.abs(v.speed) > 4;
  let by = -1;
  if (fast) for (const id of v.seats) if (id >= 0) { by = id; break; }
  const pad = BODY.radius + 0.05;
  const ex = hw + pad, ez = hl + pad;
  for (const so of g.soldiers) {
    if (so.vehicle >= 0 || so.state === 'dead') continue;
    const dx = so.pos.x - v.pos.x, dz = so.pos.z - v.pos.z;
    if (dx > R || dx < -R || dz > R || dz < -R) continue;
    if (so.pos.y > v.pos.y + def.size.y - 0.4 || so.pos.y + 1.5 < v.pos.y) continue;
    let lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) >= ex + 0.3 || Math.abs(lz) >= ez + 0.3) continue;
    if (fast && by >= 0 && so.team !== v.team) {
      const lr = lastRam.get(so);
      if (lr === undefined || g.time - lr > 0.5) {
        lastRam.set(so, g.time);
        damageSoldier(g, so, Math.abs(v.speed) * 12, by, '차량 충돌', false, copy(v.pos));
      }
    }
    if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) continue;
    const penX = ex - Math.abs(lx), penZ = ez - Math.abs(lz);
    if (penX < penZ) lx = (lx >= 0 ? 1 : -1) * ex;
    else {
      lz = (lz >= 0 ? 1 : -1) * ez;
      if (Math.abs(v.speed) > 1) lx += (lx >= 0 ? 1 : -1) * 4 * dt; // 앞뒤에 선 사람은 옆으로 비켜나게
    }
    so.pos.x = v.pos.x + lx * c + lz * s;
    so.pos.z = v.pos.z - lx * s + lz * c;
  }
}

// ───────────────────────── 좌석 무기 ─────────────────────────

function fireSeat(g: Game, v: Vehicle, def: VehicleDef, st: VState, i: number, s: Soldier, wd: VWeaponDef): void {
  const sd = def.seats[i];
  const eye = seatWorldPos(v, i);
  const aim = seatAimDir(v, i);
  const b = basis(v, FB);
  let side = 0, down = 0;
  if (!sd.turret && i === 0) {
    down = -0.5;
    if (wd.kind === 'rockets' || wd.kind === 'atgm') { st.pod[i] = -st.pod[i]; side = st.pod[i] * Math.min(1.3, def.size.x * 0.4); }
  }
  const L = MUZZLE[wd.kind] ?? 1;
  let ox = eye.x + aim.x * L + b.rx * side + b.ux * down;
  let oy = eye.y + aim.y * L + b.ry * side + b.uy * down;
  let oz = eye.z + aim.z * L + b.rz * side + b.uz * down;
  // 포구가 벽·지형 속이면 그 앞에서 쏜다
  const ddx = ox - eye.x, ddy = oy - eye.y, ddz = oz - eye.z, dl = Math.hypot(ddx, ddy, ddz);
  if (dl > 0.05) {
    const hit = raycast(g.world, eye, { x: ddx / dl, y: ddy / dl, z: ddz / dl }, dl);
    if (hit) {
      const t = Math.max(0, hit.t - 0.05) / dl;
      ox = eye.x + ddx * t; oy = eye.y + ddy * t; oz = eye.z + ddz * t;
    }
  }
  const dir = wd.spread > 0 ? spreadDir(aim, wd.spread * DEG, () => rand(g)) : aim;
  const vel = Math.max(1, wd.velocity);
  let kind: ProjKind = 'shell', radius = wd.radius, gravity = 0.4, life = 6, tracer = true, ammoKind = 'ap';
  let headMul = 1, rangeNear = 5000, rangeFar = 10000, dmgFar = wd.dmg;
  switch (wd.kind) {
    case 'cannon':
      kind = 'shell'; gravity = 0.4; life = clamp(1500 / vel, 2, 8); tracer = true; ammoKind = 'ap';
      break;
    case 'autocannon':
      kind = 'shell'; radius = wd.radius > 0 ? Math.min(wd.radius, 1.5) : 1.5; gravity = 0.4; life = clamp(1200 / vel, 1.5, 6); tracer = true; ammoKind = 'ap';
      break;
    case 'mg':
      kind = 'bullet'; radius = 0; gravity = 1; life = clamp(1000 / vel, 1, 3);
      st.shots[i] = (st.shots[i] || 0) + 1; tracer = st.shots[i] % 3 === 0; ammoKind = 'fmj';
      headMul = 1.5; rangeNear = 60; rangeFar = 200; dmgFar = wd.dmg * 0.7;
      break;
    case 'rockets':
      kind = 'rocket'; gravity = 0.15; life = clamp(900 / vel, 2, 7); tracer = false; ammoKind = 'he';
      break;
    case 'atgm':
      kind = 'missile'; gravity = 0; life = clamp(1200 / vel, 3, 10); tracer = false; ammoKind = 'heat';
      break;
  }
  const p: Projectile = {
    id: g.nextId++, kind, alive: true,
    pos: { x: ox, y: oy, z: oz }, prev: { x: ox, y: oy, z: oz },
    vel: { x: dir.x * vel + v.vel.x, y: dir.y * vel + v.vel.y, z: dir.z * vel + v.vel.z },
    owner: s.id, team: s.team,
    weapon: wd.id, variant: '',
    dmg: wd.dmg, dmgFar, rangeNear, rangeFar, headMul,
    dist: 0, life, gravity,
    radius, dmgVehicle: wd.dmgVehicle, wallDmg: wd.wallDmg,
    tracer, fuse: 0, bounce: false, target: -1, ammoKind,
  };
  g.projectiles.push(p);
  v.spotT = Math.max(v.spotT, wd.kind === 'mg' ? 1.5 : 3);
  emit(g, { k: 'vshot', v: v.id, seat: i, weapon: wd.id, pos: { x: ox, y: oy, z: oz }, dir: { x: dir.x, y: dir.y, z: dir.z } });
}

function updateSeatWeapons(g: Game, v: Vehicle, def: VehicleDef, st: VState, dt: number): void {
  const n = Math.min(def.seats.length, v.seats.length);
  let firstT = -1, ctrl = -1;
  for (let i = 0; i < n; i++) {
    if (!def.seats[i].turret) continue;
    if (firstT < 0) firstT = i;
    if (ctrl < 0 && occupantOf(g, v, i)) ctrl = i;
  }
  st.turretSeat = ctrl >= 0 ? ctrl : firstT;
  if (ctrl >= 0) aimTurret(v, def, g.soldiers[v.seats[ctrl]].ctl, dt);

  for (let i = 0; i < n; i++) {
    const sd = def.seats[i];
    const w = v.wpn[i];
    if (!w || !sd.weapon) continue;
    const wd = VWEAPONS[sd.weapon];
    if (!wd) continue;
    const unlimited = !(wd.mag > 0);
    if (w.fireT > 0) w.fireT -= dt;
    if (w.reloadT > 0) { w.reloadT -= dt; if (w.reloadT <= 0) { w.reloadT = 0; w.mag = wd.mag; } }
    const s = occupantOf(g, v, i);
    if (s && s.ctl.reload) {
      s.ctl.reload = false;
      if (!unlimited && w.reloadT <= 0 && w.mag < wd.mag) w.reloadT = Math.max(0.1, wd.reload);
    }
    const want = !!s && s.ctl.fire && s.state === 'alive';
    const canShoot = want && !st.overheat[i] && w.reloadT <= 0 && (unlimited || w.mag > 0);
    if (canShoot && s) {
      const interval = 60 / Math.max(1, wd.rpm);
      let shots = 0;
      while (w.fireT <= 0 && w.reloadT <= 0 && (unlimited || w.mag > 0) && shots < 4) {
        fireSeat(g, v, def, st, i, s, wd);
        shots++;
        w.fireT += interval;
        if (!unlimited) {
          w.mag--;
          if (w.mag <= 0) { w.mag = 0; w.reloadT = Math.max(0.1, wd.reload); break; } // 빈 탄창 자동 재장전
        }
      }
    }
    if (w.fireT < 0) w.fireT = 0;
    if (wd.kind === 'mg') {
      // 4초 연사하면 과열 → 2.5초 못 쏨
      if (canShoot) {
        w.heat += dt / 4;
        if (w.heat >= 1) { w.heat = 1; st.overheat[i] = true; }
      } else {
        w.heat -= dt / (st.overheat[i] ? 2.5 : 3);
        if (w.heat <= 0) { w.heat = 0; st.overheat[i] = false; }
      }
    }
  }
}

/** 대전차 유도탄(target -1): 포수가 겨누는 선을 따라가게 (반자동 시선 유도) */
function steerMissiles(g: Game, dt: number): void {
  for (const p of g.projectiles) {
    if (!p.alive || p.kind !== 'missile' || p.target >= 0) continue;
    const o = g.soldiers[p.owner];
    if (!o || o.vehicle < 0 || o.state !== 'alive') continue;
    const v = g.vehicles[o.vehicle];
    if (!v || !v.alive) continue;
    const def = VEHICLES[v.type];
    const sd = def ? def.seats[o.seat] : undefined;
    if (!sd || sd.weapon !== p.weapon) continue;
    const wd = VWEAPONS[p.weapon];
    if (!wd || wd.kind !== 'atgm') continue;
    const eye = seatWorldPos(v, o.seat), aim = seatAimDir(v, o.seat);
    const along = (p.pos.x - eye.x) * aim.x + (p.pos.y - eye.y) * aim.y + (p.pos.z - eye.z) * aim.z;
    const L = Math.max(0, along) + 30;
    let dx = eye.x + aim.x * L - p.pos.x, dy = eye.y + aim.y * L - p.pos.y, dz = eye.z + aim.z * L - p.pos.z;
    const dl = Math.hypot(dx, dy, dz);
    const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
    if (dl < 1e-6 || sp < 1e-6) continue;
    dx /= dl; dy /= dl; dz /= dl;
    const cx = p.vel.x / sp, cy = p.vel.y / sp, cz = p.vel.z / sp;
    const ang = Math.acos(clamp(cx * dx + cy * dy + cz * dz, -1, 1));
    if (ang < 1e-4) continue;
    const t = Math.min(1, (2.5 * dt) / ang);
    let nx = cx + (dx - cx) * t, ny = cy + (dy - cy) * t, nz = cz + (dz - cz) * t;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    p.vel.x = nx * sp; p.vel.y = ny * sp; p.vel.z = nz * sp;
  }
}

/** 나를 노리는 유도탄·조준 고정 → lockWarn */
function threatScan(g: Game): void {
  for (const p of g.projectiles) {
    if (!p.alive || p.target < 0) continue;
    const tv = g.vehicles[p.target];
    if (tv && tv.alive) tv.lockWarn = 1;
  }
  const ev = g.events;
  if (!ev) return;
  let i = eventCursor.get(g) ?? 0;
  if (i > ev.length) i = 0;
  for (; i < ev.length; i++) {
    const e = ev[i];
    if (e.k !== 'lock') continue;
    const tv = g.vehicles[e.v];
    if (tv && tv.alive) tv.lockWarn = Math.max(tv.lockWarn, e.done ? 1 : 0.5);
  }
  eventCursor.set(g, ev.length);
}

// ───────────────────────── 타이머 ─────────────────────────

function vehicleTimers(g: Game, v: Vehicle, def: VehicleDef, st: VState, dt: number): void {
  v.counterCd = Math.max(0, v.counterCd - dt);
  v.counterT = Math.max(0, v.counterT - dt);
  v.lockWarn = Math.max(0, v.lockWarn - dt * 1.2);
  v.spotT = Math.max(0, v.spotT - dt);
  // 공병 운전수: 6초 동안 안 맞으면 60%까지 스스로 고침
  const driver = occupantOf(g, v, 0);
  const repairing = !!driver && driver.cls === 'engineer' && g.time - st.hurtAt >= 6 && v.hp < v.maxHp * 0.6;
  if (repairing) v.hp = Math.min(v.maxHp * 0.6, v.hp + v.maxHp * 0.015 * dt);
  // 지상 차량이 깊은 물에 빠지면 침수
  if (!def.air && waterDepth(g.world, v.pos.x, v.pos.z) > 1.6) selfDamage(g, v, v.maxHp * 0.2 * dt, '침수');
  // 불붙음
  if (v.alive && v.hp < v.maxHp * 0.15) {
    v.burning = true;
    if (!repairing) selfDamage(g, v, v.maxHp * 0.015 * dt, '화재');
  } else v.burning = false;
  if (!v.alive) return;
  // 멀리 버려진 차량은 90초 뒤 본부에서 다시
  if (hasOccupant(v)) st.emptyT = 0;
  else {
    st.emptyT += dt;
    if (st.emptyT > 90 && distXZ(v.pos, v.spawn.pos) > 40) respawnVehicle(g, v);
  }
}

function syncOccupants(g: Game, v: Vehicle): void {
  for (let i = 0; i < v.seats.length; i++) {
    const s = occupantOf(g, v, i);
    if (s) syncSeat(v, i, s);
  }
}

// ───────────────────────── 매 스텝 ─────────────────────────

export function updateVehicles(g: Game, dt: number): void {
  if (!g.vehicles) g.vehicles = [];
  const vs = g.vehicles;
  handleEntering(g);
  for (const v of vs) {
    const def = VEHICLES[v.type];
    if (!def) continue;
    const st = stateOf(v);
    if (!v.alive) { updateWreck(g, v, def, st, dt); continue; }
    if (v.hp < st.hpSeen - 1e-3) st.hurtAt = g.time;
    st.wasAlive = true;
    validateSeats(g, v);
    occupantControls(g, v, def, st);
    const driver = occupantOf(g, v, 0);
    if (def.air) flyHeli(g, v, def, st, driver, dt);
    else driveGround(g, v, def, st, driver, dt);
  }
  collideVehicles(g);
  for (const v of vs) {
    const def = VEHICLES[v.type];
    if (!def) continue;
    const st = stateOf(v);
    soldierContacts(g, v, def, dt);
    if (v.alive) updateSeatWeapons(g, v, def, st, dt);
    if (v.alive) vehicleTimers(g, v, def, st, dt);
    if (v.alive) syncOccupants(g, v);
    st.hpSeen = v.hp;
  }
  steerMissiles(g, dt);
  threatScan(g);
}

// ───────────────────────── 광선 판정 ─────────────────────────

const LO = v3(), LD = v3(), BMIN = v3(), BMAX = v3();

export function vehicleHit(g: Game, o: Vec3, d: Vec3, maxT: number, ignore: number): { v: Vehicle; t: number; point: Vec3 } | null {
  const dd = d.x * d.x + d.y * d.y + d.z * d.z;
  if (dd < 1e-12 || !g.vehicles) return null;
  let best: Vehicle | null = null, bestT = maxT;
  for (const v of g.vehicles) {
    if (!v.alive || v.id === ignore) continue;
    const def = VEHICLES[v.type];
    if (!def) continue;
    const hx = def.size.x * 0.5, hy = def.size.y * 0.5, hz = def.size.z * 0.5;
    // 거친 판정: v.pos(바닥 가운데)에서 상자 어느 점이든 이 반지름 안
    const R = Math.hypot(hx, 2 * hy, hz);
    const px = v.pos.x - o.x, py = v.pos.y - o.y, pz = v.pos.z - o.z;
    const tc = clamp((px * d.x + py * d.y + pz * d.z) / dd, 0, bestT);
    const qx = d.x * tc - px, qy = d.y * tc - py, qz = d.z * tc - pz;
    if (qx * qx + qy * qy + qz * qz > R * R) continue;
    const b = basis(v, HB);
    const rx = o.x - (v.pos.x + b.ux * hy), ry = o.y - (v.pos.y + b.uy * hy), rz = o.z - (v.pos.z + b.uz * hy);
    LO.x = rx * b.rx + ry * b.ry + rz * b.rz; LO.y = rx * b.ux + ry * b.uy + rz * b.uz; LO.z = rx * b.bx + ry * b.by + rz * b.bz;
    LD.x = d.x * b.rx + d.y * b.ry + d.z * b.rz; LD.y = d.x * b.ux + d.y * b.uy + d.z * b.uz; LD.z = d.x * b.bx + d.y * b.by + d.z * b.bz;
    BMIN.x = -hx; BMIN.y = -hy; BMIN.z = -hz; BMAX.x = hx; BMAX.y = hy; BMAX.z = hz;
    const h = rayAABB(LO, LD, BMIN, BMAX, bestT);
    if (h && h.t <= bestT) { bestT = h.t; best = v; }
  }
  if (!best) return null;
  return { v: best, t: bestT, point: { x: o.x + d.x * bestT, y: o.y + d.y * bestT, z: o.z + d.z * bestT } };
}
