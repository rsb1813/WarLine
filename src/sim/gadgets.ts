// sim-gadgets: 장비 꺼내기·사용, 설치물 효과, 투척물 터짐.
import type {
  Game, GadgetDef, GadgetKind, GadgetPick, GadgetState, Placed, PlacedKind, Projectile, ProjKind, Soldier, Team, Vec3, Vehicle,
} from '../types';
import {
  add, addScaled, clamp, copy, DEG, dirFrom, dist, distXZ, dot, forwardXZ, len, lerp, norm, rightXZ, scale, spreadDir, sub, v3,
} from '../math';
import { eyePos } from './body';
import { GADGETS, VEHICLES } from '../defs';
import { floorAt, lineOfSight, raycast } from '../world';
import { award, emit, rand } from './game';
import { damageSoldier, damageVehicle, explode, reviveSoldier, smokeBlocks, spotSoldier } from './damage';
import { vehicleHit } from './vehicles';

// ───────────────────────── 상수 ─────────────────────────

/** 투척 칸으로 바로 던지는 종류 */
const THROWN_KINDS = new Set<GadgetKind>(['frag', 'smoke', 'flash', 'incendiary', 'impact']);
/** 쓸 횟수를 줄이지 않는 도구 */
const TOOL_KINDS = new Set<GadgetKind>(['repair', 'defib']);
/** 앞에 내려놓는 설치물 */
const PLACE_KINDS: Partial<Record<GadgetKind, PlacedKind>> = {
  atmine: 'atmine', claymore: 'claymore', medbag: 'medbag', ammobag: 'ammobag', beacon: 'beacon', sensor: 'sensor', cover: 'cover',
};
/** 주인마다 같은 종류 설치 한도 (넘으면 가장 오래된 것을 없앰) */
const LIMIT: Partial<Record<PlacedKind, number>> = {
  atmine: 3, claymore: 2, beacon: 1, medbag: 1, ammobag: 1, cover: 2, sensor: 2, drone: 1,
};
const PLACE_HP: Record<PlacedKind, number> = {
  medbag: 120, ammobag: 120, atmine: 60, claymore: 40, breach: 40, beacon: 150, sensor: 40, cover: 600, drone: 60, fire: 1e6,
};
/** 앞으로 내려놓는 거리 m */
const PLACE_DIST: Partial<Record<PlacedKind, number>> = {
  medbag: 0.9, ammobag: 0.9, atmine: 1.4, claymore: 0.9, beacon: 1.0, sensor: 0.9, cover: 1.6,
};
/** 바닥이 무너지면 같이 떨어지는 설치물 */
const SETTLE_KINDS = new Set<PlacedKind>(['medbag', 'ammobag', 'atmine', 'claymore', 'beacon', 'cover', 'fire']);
/** 꺼내는 시간 s */
const DRAW: Partial<Record<GadgetKind, number>> = {
  rocket: 0.8, aa: 0.9, repair: 0.4, ugl: 0.45, stim: 0.3, defib: 0.4, drone: 0.5,
};
const ARM_TIME = 1.5;
const AA_ACQUIRE_COS = Math.cos(5 * DEG);
const AA_KEEP_COS = Math.cos(9 * DEG);
const CLAY_TRIGGER_COS = Math.cos(35 * DEG);
const CLAY_BLAST_COS = Math.cos(50 * DEG);
const DRONE_ALT = 25;

// ───────────────────────── 내부 상태 ─────────────────────────

interface SExtra {
  /** 한 번 쓴 뒤 방아쇠를 놓을 때까지 기다림 */
  needRelease: boolean;
  /** 꺼내기 남은 시간 */
  draw: number;
  lockV: number; lockDone: boolean;
  repairAcc: number; torchDmg: number; torchFx: number;
}
const sxMap = new WeakMap<Soldier, SExtra>();
function sext(s: Soldier): SExtra {
  let e = sxMap.get(s);
  if (!e) {
    e = { needRelease: false, draw: 0, lockV: -1, lockDone: false, repairAcc: 0, torchDmg: 0, torchFx: 0 };
    sxMap.set(s, e);
  }
  return e;
}

interface PExtra {
  /** 이 설치물을 만든 장비 id (사살 기록용) */
  gid: string;
  age: number; tick: number; settle: number;
  /** 누적량 (회복량 등), 틱 수 */
  acc: number; n: number;
  /** 차량에 붙은 위치 (차량 기준) */
  ox: number; oy: number; oz: number;
  /** 드론 목표 지점 */
  tx: number; tz: number;
}
const pxMap = new WeakMap<Placed, PExtra>();
function newPExtra(gid: string): PExtra {
  return { gid, age: 0, tick: 0, settle: 0, acc: 0, n: 0, ox: 0, oy: 0, oz: 0, tx: 0, tz: 0 };
}
function pext(p: Placed): PExtra {
  let e = pxMap.get(p);
  if (!e) {
    e = newPExtra(gidFor(p.kind));
    e.tx = p.pos.x; e.tz = p.pos.z;
    pxMap.set(p, e);
  }
  return e;
}

const kindGid = new Map<string, string>();
function gidFor(kind: PlacedKind): string {
  const gk = kind === 'fire' ? 'incendiary' : kind;
  let id = kindGid.get(gk);
  if (id === undefined) {
    id = gk;
    for (const k in GADGETS) if (GADGETS[k].kind === gk) { id = k; break; }
    kindGid.set(gk, id);
  }
  return id;
}

const purgeT = new WeakMap<Game, number>();

// ───────────────────────── 도우미 ─────────────────────────

function variantParams(def: GadgetDef | undefined, variant: string): Record<string, number> {
  if (!def) return {};
  const v = def.variants.find((x) => x.id === variant) ?? def.variants[0];
  return v ? v.params : {};
}

function every(ex: PExtra, dt: number, period: number): boolean {
  ex.tick += dt;
  if (ex.tick >= period) { ex.tick -= period; return true; }
  return false;
}

/** 눈에서 off 만큼 앞 (벽 안으로 들어가지 않게) */
function muzzle(g: Game, eye: Vec3, dir: Vec3, off: number): Vec3 {
  const h = raycast(g.world, eye, dir, off);
  return addScaled(eye, dir, h ? Math.max(0, h.t - 0.1) : off);
}

function aimK(s: Soldier): number {
  return s.ctl.ads ? Math.max(s.ads, 0.5) : s.ads;
}

function newProj(g: Game, s: Soldier, kind: ProjKind, gs: GadgetState, pos: Vec3, vel: Vec3): Projectile {
  return {
    id: g.nextId++, kind, alive: true, pos: copy(pos), prev: copy(pos), vel,
    owner: s.id, team: s.team, weapon: gs.id, variant: gs.variant,
    dmg: 0, dmgFar: 0, rangeNear: 9999, rangeFar: 10000, headMul: 1,
    dist: 0, life: 8, gravity: 1, radius: 0, dmgVehicle: 0, wallDmg: 0,
    tracer: false, fuse: 0, bounce: false, target: -1, ammoKind: 'explosive',
  };
}

function spawnPlaced(g: Game, kind: PlacedKind, owner: number, team: Team, pos: Vec3, yaw: number, params: Record<string, number>, gid: string): Placed {
  const life = kind === 'drone' ? (params.duration ?? 30) : (params.life ?? (kind === 'fire' ? 8 : 600));
  const hp = kind === 'cover' ? (params.hp ?? PLACE_HP.cover) : PLACE_HP[kind];
  const p: Placed = {
    id: g.nextId++, kind, alive: true, team, owner, pos: copy(pos), yaw, vel: v3(),
    life, hp, params: { ...params }, attached: -1,
  };
  const ex = newPExtra(gid);
  ex.tx = pos.x; ex.tz = pos.z;
  pxMap.set(p, ex);
  g.placed.push(p);
  emit(g, { k: 'placed', p: p.id });
  return p;
}

/** 같은 주인·종류가 한도 이상이면 오래된 것부터 없앤다 (하나 더 놓을 자리 만들기) */
function enforceLimit(g: Game, owner: number, kind: PlacedKind): void {
  const lim = LIMIT[kind];
  if (lim === undefined) return;
  const mine = g.placed.filter((p) => p.alive && p.owner === owner && p.kind === kind).sort((a, b) => a.id - b.id);
  for (let i = 0; i <= mine.length - lim; i++) mine[i].alive = false;
}

/** 차량 기준 좌표: x 오른쪽, y 위, z 앞 */
function vehicleLocal(v: Vehicle, p: Vec3): Vec3 {
  const dx = p.x - v.pos.x, dy = p.y - v.pos.y, dz = p.z - v.pos.z;
  const r = rightXZ(v.yaw), f = forwardXZ(v.yaw);
  return { x: dx * r.x + dz * r.z, y: dy, z: dx * f.x + dz * f.z };
}
function vehicleWorld(v: Vehicle, l: Vec3): Vec3 {
  const r = rightXZ(v.yaw), f = forwardXZ(v.yaw);
  return { x: v.pos.x + r.x * l.x + f.x * l.z, y: v.pos.y + l.y, z: v.pos.z + r.z * l.x + f.z * l.z };
}
/** 점에서 차량 상자 겉면까지 거리 (기울기 무시, 원점이 바닥이든 가운데든 덮도록 세로는 넉넉히) */
function vehicleGap(v: Vehicle, p: Vec3): number {
  const vd = VEHICLES[v.type];
  const sz = vd ? vd.size : { x: 3, y: 2.5, z: 6 };
  const l = vehicleLocal(v, p);
  const ex = Math.max(0, Math.abs(l.x) - sz.x / 2);
  const ez = Math.max(0, Math.abs(l.z) - sz.z / 2);
  const lo = -sz.y / 2, hi = sz.y;
  const ey = l.y < lo ? lo - l.y : l.y > hi ? l.y - hi : 0;
  return Math.hypot(ex, ey, ez);
}

function chestOf(t: Soldier): Vec3 {
  return { x: t.pos.x, y: t.pos.y + Math.max(0.3, t.eyeH - 0.6), z: t.pos.z };
}

function clearLock(s: Soldier, ex: SExtra): void {
  ex.lockV = -1;
  ex.lockDone = false;
  for (const gs of s.gadgets) if (gs.kind === 'aa') gs.active = 0;
}

function toWeapon(g: Game, s: Soldier, ex: SExtra): void {
  clearLock(s, ex);
  ex.draw = 0;
  if (s.held !== 'gadget') return;
  s.held = 'weapon';
  const w = s.weapons[s.cur];
  s.swapT = w && w.st ? w.st.swap * 0.8 : 0.5;
  emit(g, { k: 'swap', s: s.id });
}

function noUses(g: Game, s: Soldier, def: GadgetDef): void {
  if (s.id === g.player) emit(g, { k: 'msg', text: `${def.name}: 남은 수량 없음`, tone: 'bad' });
}

function hasBreach(g: Game, owner: number): boolean {
  for (const p of g.placed) if (p.alive && p.kind === 'breach' && p.owner === owner) return true;
  return false;
}

// ───────────────────────── 상태 만들기 ─────────────────────────

export function makeGadgetState(pick: GadgetPick): GadgetState {
  const def: GadgetDef | undefined = GADGETS[pick.id];
  if (!def) return { id: pick.id, variant: pick.variant, kind: 'frag', uses: 0, maxUses: 0, cd: 0, params: {}, active: 0 };
  const variant = def.variants.find((v) => v.id === pick.variant) ?? def.variants[0];
  return {
    id: pick.id,
    variant: variant ? variant.id : pick.variant,
    kind: def.kind,
    uses: def.uses, maxUses: def.uses,
    cd: 0,
    params: { ...(variant ? variant.params : {}) },
    active: 0,
  };
}

// ───────────────────────── 병사별 갱신 ─────────────────────────

export function updateGadgets(g: Game, s: Soldier, dt: number): void {
  const ex = sext(s);
  for (const gs of s.gadgets) if (gs.cd > 0) gs.cd = Math.max(0, gs.cd - dt);
  if (s.anim.throwT > 0) s.anim.throwT = Math.max(0, s.anim.throwT - dt);
  // stimT, blindT 는 sim/game.ts 가 줄인다 (여기서 또 줄이면 두 배로 빨리 끝남)
  if (ex.draw > 0) ex.draw = Math.max(0, ex.draw - dt);

  let torch: GadgetState | null = null;
  if (s.state !== 'alive' || s.vehicle >= 0) {
    if (s.ctl.gadget >= 0) s.ctl.gadget = -1;
    if (ex.lockV >= 0 || ex.lockDone) clearLock(s, ex);
    ex.needRelease = false;
  } else {
    const gi = s.ctl.gadget;
    if (gi !== -1) {
      s.ctl.gadget = -1;
      pressGadget(g, s, gi, ex);
    }
    if (s.held === 'gadget') {
      const gs = s.gadgets[s.heldGadget];
      const def: GadgetDef | undefined = gs ? GADGETS[gs.id] : undefined;
      if (!gs || !def) toWeapon(g, s, ex);
      else torch = useHeld(g, s, gs, def, ex, dt);
    } else if (ex.lockV >= 0) clearLock(s, ex);
  }

  // 수리 토치는 쓰지 않을 때 식는다
  for (const gs of s.gadgets) if (gs.kind === 'repair' && gs !== torch && gs.active > 0) gs.active = Math.max(0, gs.active - dt * 1.5);
  if (!s.ctl.fire) ex.needRelease = false;
}

/** 장비 키를 눌렀을 때 */
function pressGadget(g: Game, s: Soldier, i: 0 | 1 | 2, ex: SExtra): void {
  const gs = s.gadgets[i];
  if (!gs) return;
  const def: GadgetDef | undefined = GADGETS[gs.id];
  if (!def) return;

  if (gs.kind === 'breach') {
    if (hasBreach(g, s.id)) { detonateBreach(g, s); return; }
    if (gs.uses > 0 && gs.cd <= 0) throwItem(g, s, gs, def, true);
    else if (gs.uses <= 0) noUses(g, s, def);
    return;
  }
  if (i === 2 || def.slot === 'throwable' || THROWN_KINDS.has(gs.kind)) {
    if (gs.uses > 0 && gs.cd <= 0) throwItem(g, s, gs, def, false);
    else if (gs.uses <= 0) noUses(g, s, def);
    return;
  }
  if (s.held === 'gadget' && s.heldGadget === i) { toWeapon(g, s, ex); return; }
  if (!TOOL_KINDS.has(gs.kind) && gs.uses <= 0) { noUses(g, s, def); return; }

  clearLock(s, ex);
  s.held = 'gadget';
  s.heldGadget = i;
  ex.draw = DRAW[gs.kind] ?? 0.35;
  s.swapT = ex.draw;
  // 사람은 방아쇠를 한 번 놓아야 쓴다 (총 쏘다가 바꿔 들었을 때 바로 발사 방지). 봇은 누르고 있으면 꺼내자마자 쓴다
  ex.needRelease = s.isPlayer && s.ctl.fire;
  emit(g, { k: 'swap', s: s.id });
}

/** 들고 있는 장비 사용. 수리 중이면 그 장비를 돌려준다 (과열 냉각 제외용) */
function useHeld(g: Game, s: Soldier, gs: GadgetState, def: GadgetDef, ex: SExtra, dt: number): GadgetState | null {
  const tool = TOOL_KINDS.has(gs.kind);
  if (!tool && gs.uses <= 0 && gs.cd <= 0) { toWeapon(g, s, ex); return null; }
  const ready = ex.draw <= 0 && gs.cd <= 0 && (tool || gs.uses > 0);
  const trig = s.ctl.fire && !ex.needRelease;
  const once = (): void => { ex.needRelease = true; };

  switch (gs.kind) {
    case 'rocket':
      if (ready && trig) { fireRocket(g, s, gs, def); once(); }
      return null;
    case 'aa':
      updateLock(g, s, gs, ex, dt);
      if (ready && trig) { fireMissile(g, s, gs, def, ex); once(); }
      return null;
    case 'ugl':
      if (ready && trig) { fireUgl(g, s, gs, def); once(); }
      return null;
    case 'repair':
      if (ready && s.ctl.fire) { repairTick(g, s, gs, ex, dt); return gs; }
      return null;
    case 'stim':
      if (ready && trig) {
        once();
        s.hp = Math.min(s.maxHp, s.hp + (gs.params.heal ?? s.maxHp));
        s.stimT = gs.params.duration ?? 8;
        gs.uses--;
        gs.cd = def.cooldown;
        emit(g, { k: 'heal', s: s.id });
        emit(g, { k: 'gadget', s: s.id, gadget: gs.id, pos: eyePos(s) });
        toWeapon(g, s, ex);
      }
      return null;
    case 'defib':
      if (ready && trig) { useDefib(g, s, gs, def); once(); }
      return null;
    case 'drone':
      if (ready && trig) { once(); launchDrone(g, s, gs, def); toWeapon(g, s, ex); }
      return null;
    default: {
      const pk = PLACE_KINDS[gs.kind];
      if (pk) {
        if (ready && trig) { once(); placeItem(g, s, gs, def, pk); toWeapon(g, s, ex); }
      } else {
        // 투척물·접착 폭약은 들지 않는다
        toWeapon(g, s, ex);
      }
      return null;
    }
  }
}

// ───────────────────────── 종류별 사용 ─────────────────────────

function throwItem(g: Game, s: Soldier, gs: GadgetState, def: GadgetDef, sticky: boolean): void {
  const eye = eyePos(s);
  const dir = dirFrom(s.yaw, s.pitch + (sticky ? 0.06 : 0.12));
  const speed = gs.params.velocity ?? (sticky ? 14 : 18);
  const fuse = sticky ? 0 : (gs.params.fuse ?? (gs.kind === 'impact' ? 0 : 2.5));
  const p = newProj(g, s, 'thrown', gs, muzzle(g, eye, dir, 0.35), add(scale(dir, speed), s.vel));
  p.gravity = 1;
  p.fuse = fuse;
  p.bounce = !sticky && fuse > 0;
  p.life = Math.max(8, fuse + 6);
  if (gs.kind === 'frag' || gs.kind === 'impact' || gs.kind === 'breach') {
    p.radius = gs.params.radius ?? (gs.kind === 'breach' ? 4.5 : 6);
    p.dmg = p.dmgFar = gs.params.dmg ?? (gs.kind === 'breach' ? 120 : 100);
    p.wallDmg = gs.params.wallDmg ?? 60;
    p.dmgVehicle = gs.params.dmgVehicle ?? Math.round(p.dmg * 0.3);
  }
  g.projectiles.push(p);
  gs.uses--;
  gs.cd = Math.max(def.cooldown, 0.8);
  s.anim.throwT = 0.6;
  emit(g, { k: 'throw', s: s.id, gadget: gs.id });
}

function fireRocket(g: Game, s: Soldier, gs: GadgetState, def: GadgetDef): void {
  const eye = eyePos(s);
  const hs = Math.hypot(s.vel.x, s.vel.z);
  const spread = (lerp(3.5, 0.35, aimK(s)) + Math.min(2, hs * 0.3)) * DEG;
  const dir = spreadDir(dirFrom(s.yaw, s.pitch), spread, () => rand(g));
  const o = muzzle(g, eye, dir, 0.6);
  const p = newProj(g, s, 'rocket', gs, o, scale(dir, gs.params.velocity ?? 80));
  p.gravity = 0.25;
  p.life = 7;
  p.radius = gs.params.radius ?? 3.5;
  p.dmg = p.dmgFar = gs.params.dmgInfantry ?? 100;
  p.dmgVehicle = gs.params.dmgVehicle ?? 450;
  p.wallDmg = gs.params.wallDmg ?? 300;
  g.projectiles.push(p);
  gs.uses--;
  gs.cd = Math.max(def.cooldown, 1.2);
  s.anim.fireT = 0.35;
  s.spotT = Math.max(s.spotT, 1.5);
  emit(g, { k: 'gadget', s: s.id, gadget: gs.id, pos: o });
}

function fireUgl(g: Game, s: Soldier, gs: GadgetState, def: GadgetDef): void {
  const smoke = (gs.params.smoke ?? 0) > 0;
  const eye = eyePos(s);
  const dir = spreadDir(dirFrom(s.yaw, s.pitch), lerp(2, 0.5, aimK(s)) * DEG, () => rand(g));
  const o = muzzle(g, eye, dir, 0.5);
  const p = newProj(g, s, 'ugl', gs, o, scale(dir, gs.params.velocity ?? 75));
  p.gravity = 1;
  p.life = 8;
  if (!smoke) {
    p.radius = gs.params.radius ?? 3.5;
    p.dmg = p.dmgFar = gs.params.dmg ?? 90;
    p.dmgVehicle = gs.params.dmgVehicle ?? 120;
    p.wallDmg = gs.params.wallDmg ?? 120;
  }
  g.projectiles.push(p);
  gs.uses--;
  gs.cd = Math.max(def.cooldown, 1.5);
  s.anim.fireT = 0.3;
  s.spotT = Math.max(s.spotT, 1.2);
  emit(g, { k: 'gadget', s: s.id, gadget: gs.id, pos: o });
}

/** 대공: 정조준 중 시선 5° 안의 적 항공기를 조준 고정 */
function updateLock(g: Game, s: Soldier, gs: GadgetState, ex: SExtra, dt: number): void {
  if (!s.ctl.ads || ex.draw > 0 || gs.uses <= 0) {
    if (ex.lockV >= 0 || gs.active > 0) clearLock(s, ex);
    return;
  }
  const eye = eyePos(s);
  const dir = dirFrom(s.yaw, s.pitch);
  const range = gs.params.range ?? 450;
  const lockCos = (v: Vehicle): number => {
    if (!v.alive || v.team === s.team || v.counterT > 0) return -2;
    const vd = VEHICLES[v.type];
    if (!vd || !vd.air) return -2;
    const to = sub(v.pos, eye);
    const d = len(to);
    if (d > range || d < 5) return -2;
    return dot(to, dir) / d;
  };
  const seen = (v: Vehicle): boolean => lineOfSight(g.world, eye, v.pos) && !smokeBlocks(g, eye, v.pos);

  let tv: Vehicle | undefined = ex.lockV >= 0 ? g.vehicles[ex.lockV] : undefined;
  if (tv && !(lockCos(tv) >= AA_KEEP_COS && seen(tv))) {
    tv = undefined;
    clearLock(s, ex);
  }
  if (!tv) {
    let best: Vehicle | undefined;
    let bc = AA_ACQUIRE_COS;
    for (const v of g.vehicles) {
      const c = lockCos(v);
      if (c > bc && seen(v)) { bc = c; best = v; }
    }
    if (best) {
      tv = best;
      ex.lockV = best.id;
      ex.lockDone = false;
      gs.active = 0;
      emit(g, { k: 'lock', v: best.id, by: s.id, done: false });
    }
  }
  if (!tv) return;
  gs.active = Math.min(1, gs.active + dt / Math.max(0.1, gs.params.lockTime ?? 2));
  if (gs.active >= 1 && !ex.lockDone) {
    ex.lockDone = true;
    emit(g, { k: 'lock', v: tv.id, by: s.id, done: true });
  }
  tv.lockWarn = Math.max(tv.lockWarn, gs.active);
}

function fireMissile(g: Game, s: Soldier, gs: GadgetState, def: GadgetDef, ex: SExtra): void {
  const locked = ex.lockV >= 0 && ex.lockDone && gs.active >= 1;
  const eye = eyePos(s);
  const dir = locked ? dirFrom(s.yaw, s.pitch + 0.05) : spreadDir(dirFrom(s.yaw, s.pitch), lerp(2.5, 0.5, aimK(s)) * DEG, () => rand(g));
  const o = muzzle(g, eye, dir, 0.7);
  const p = newProj(g, s, 'missile', gs, o, scale(dir, gs.params.velocity ?? 60));
  p.gravity = locked ? 0 : 0.15;
  p.life = 9;
  p.radius = 3;
  p.dmg = p.dmgFar = gs.params.dmg ?? 40;
  p.dmgVehicle = gs.params.dmgVehicle ?? 350;
  p.wallDmg = gs.params.wallDmg ?? 60;
  p.target = locked ? ex.lockV : -1;
  g.projectiles.push(p);
  gs.uses--;
  gs.cd = Math.max(def.cooldown, 1.5);
  s.anim.fireT = 0.35;
  s.spotT = Math.max(s.spotT, 1.5);
  clearLock(s, ex);
  emit(g, { k: 'gadget', s: s.id, gadget: gs.id, pos: o });
}

/** 수리 토치: 앞의 아군 차량 회복 (적 차량이면 조금 깎음), 과열 */
function repairTick(g: Game, s: Soldier, gs: GadgetState, ex: SExtra, dt: number): void {
  const range = gs.params.range ?? 3;
  const rate = gs.params.rate ?? 60;
  const heat = gs.params.heat ?? 6;
  gs.active += dt;
  const eye = eyePos(s);
  const dir = dirFrom(s.yaw, s.pitch);

  let v: Vehicle | null = null;
  let at: Vec3 = addScaled(eye, dir, range);
  const h = vehicleHit(g, eye, dir, range + 0.5, -1);
  if (h && h.v.alive) { v = h.v; at = h.point; }
  else {
    const fwd = forwardXZ(s.yaw);
    let bestGap = range;
    for (const c of g.vehicles) {
      if (!c.alive) continue;
      const gap = vehicleGap(c, eye);
      if (gap > bestGap) continue;
      const dx = c.pos.x - eye.x, dz = c.pos.z - eye.z, dl = Math.hypot(dx, dz) || 1;
      if ((dx * fwd.x + dz * fwd.z) / dl < 0.5 && gap > 0.6) continue;
      bestGap = gap;
      v = c;
      at = addScaled(eye, dir, Math.min(range, gap + 0.2));
    }
  }

  if (v) {
    if (v.team === s.team) {
      if (v.hp < v.maxHp) {
        const amt = Math.min(rate * dt, v.maxHp - v.hp);
        v.hp += amt;
        ex.repairAcc += amt;
        while (ex.repairAcc >= 100) { ex.repairAcc -= 100; award(g, s.id, 20, '수리'); }
      }
    } else {
      ex.torchDmg += rate * 0.35 * dt;
      if (ex.torchDmg >= 8) { damageVehicle(g, v, ex.torchDmg, s.id, gs.id, at, 'bullet'); ex.torchDmg = 0; }
    }
  }
  ex.torchFx -= dt;
  if (ex.torchFx <= 0) { ex.torchFx = 0.3; emit(g, { k: 'gadget', s: s.id, gadget: gs.id, pos: at }); }
  s.anim.fireT = Math.max(s.anim.fireT, 0.1);

  if (gs.active >= heat) {
    gs.active = 0;
    gs.cd = 3;
    if (s.id === g.player) emit(g, { k: 'msg', text: '수리 토치 과열', tone: 'bad' });
  }
}

/** 제세동기: 앞의 쓰러진 아군 즉시 소생, 아니면 바로 앞 적에게 큰 피해 */
function useDefib(g: Game, s: Soldier, gs: GadgetState, def: GadgetDef): void {
  const eye = eyePos(s);
  const fwd = forwardXZ(s.yaw);
  const range = gs.params.range ?? 2;
  gs.cd = Math.max(1, def.cooldown);
  s.anim.fireT = 0.4;

  let mate: Soldier | null = null;
  let md = range + 0.6;
  for (const t of g.soldiers) {
    if (t === s || t.team !== s.team || t.state !== 'down') continue;
    if (Math.abs(t.pos.y - s.pos.y) > 1.6) continue;
    const d = distXZ(t.pos, s.pos);
    if (d > md) continue;
    const dx = (t.pos.x - s.pos.x) / (d || 1), dz = (t.pos.z - s.pos.z) / (d || 1);
    if (d > 0.9 && dx * fwd.x + dz * fwd.z < 0.35) continue;
    if (d > 1.0 && !lineOfSight(g.world, eye, { x: t.pos.x, y: t.pos.y + 0.5, z: t.pos.z })) continue;
    md = d;
    mate = t;
  }
  if (mate) {
    reviveSoldier(g, mate, s.id, gs.params.hp ?? 100);
    award(g, s.id, 120, '제세동 소생');
    emit(g, { k: 'gadget', s: s.id, gadget: gs.id, pos: copy(mate.pos) });
    return;
  }

  let foe: Soldier | null = null;
  let fd = 1.6;
  for (const t of g.soldiers) {
    if (t.team === s.team || t.state !== 'alive' || t.vehicle >= 0) continue;
    if (Math.abs(t.pos.y - s.pos.y) > 1.6) continue;
    const d = distXZ(t.pos, s.pos);
    if (d > fd) continue;
    const dx = (t.pos.x - s.pos.x) / (d || 1), dz = (t.pos.z - s.pos.z) / (d || 1);
    if (d > 0.6 && dx * fwd.x + dz * fwd.z < 0.6) continue;
    if (!lineOfSight(g.world, eye, chestOf(t))) continue;
    fd = d;
    foe = t;
  }
  if (foe) damageSoldier(g, foe, 200, s.id, '제세동기', false, eye);
  emit(g, { k: 'gadget', s: s.id, gadget: gs.id, pos: addScaled(eye, fwd, 0.8) });
}

/** 정찰 드론: 눈 위 2m 에서 조준 방향 60~120m 지점으로 날아가 머문다 */
function launchDrone(g: Game, s: Soldier, gs: GadgetState, def: GadgetDef): void {
  const w = g.world;
  const eye = eyePos(s);
  const dir = dirFrom(s.yaw, s.pitch);
  const hf = Math.hypot(dir.x, dir.z);
  const f = hf > 0.05 ? { x: dir.x / hf, y: 0, z: dir.z / hf } : forwardXZ(s.yaw);
  const hit = raycast(w, eye, dir, 120);
  const hd = clamp(hit ? hit.t * hf : 120, 60, 120);
  const tx = clamp(eye.x + f.x * hd, 2, w.size - 2);
  const tz = clamp(eye.z + f.z * hd, 2, w.size - 2);
  const start = { x: eye.x, y: eye.y + 2, z: eye.z };

  enforceLimit(g, s.id, 'drone');
  const p = spawnPlaced(g, 'drone', s.id, s.team, start, s.yaw, gs.params, gs.id);
  const ex = pext(p);
  ex.tx = tx;
  ex.tz = tz;
  const sp = gs.params.speed ?? 14;
  p.vel = scale(norm({ x: tx - start.x, y: DRONE_ALT * 0.5, z: tz - start.z }), sp);
  gs.uses--;
  gs.cd = def.cooldown;
  emit(g, { k: 'gadget', s: s.id, gadget: gs.id, pos: start });
}

/** 앞 바닥에 설치 */
function placeItem(g: Game, s: Soldier, gs: GadgetState, def: GadgetDef, kind: PlacedKind): void {
  const w = g.world;
  const fwd = forwardXZ(s.yaw);
  let d = PLACE_DIST[kind] ?? 1;
  const o = { x: s.pos.x, y: s.pos.y + 0.6, z: s.pos.z };
  const hit = raycast(w, o, fwd, d + 0.3);
  if (hit) d = Math.max(0.15, hit.t - 0.35);
  const x = clamp(s.pos.x + fwd.x * d, 1, w.size - 1);
  const z = clamp(s.pos.z + fwd.z * d, 1, w.size - 1);
  const y = floorAt(w, x, s.pos.y + 0.6, z, 0.15);

  enforceLimit(g, s.id, kind);
  const p = spawnPlaced(g, kind, s.id, s.team, { x, y, z }, s.yaw, gs.params, gs.id);
  gs.uses--;
  gs.cd = def.cooldown;
  emit(g, { k: 'gadget', s: s.id, gadget: gs.id, pos: copy(p.pos) });
}

// ───────────────────────── 설치물 갱신 ─────────────────────────

export function updatePlaced(g: Game, dt: number): void {
  const list = g.placed;
  let anyDead = false;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p.alive) { anyDead = true; continue; }
    p.life -= dt;
    if (p.life <= 0 || p.hp <= 0) { p.alive = false; anyDead = true; continue; }
    const ex = pext(p);
    ex.age += dt;

    switch (p.kind) {
      case 'medbag': if (every(ex, dt, 1)) medTick(g, p, ex); break;
      case 'ammobag': if (every(ex, dt, 1)) ammoTick(g, p, ex); break;
      case 'atmine': mineTick(g, p, ex); break;
      case 'claymore': claymoreTick(g, p, ex); break;
      case 'breach': breachFollow(g, p, ex); break;
      case 'sensor': if (every(ex, dt, 1)) sensorTick(g, p); break;
      case 'drone': droneTick(g, p, ex, dt); break;
      case 'fire': if (every(ex, dt, 0.25)) fireTick(g, p, ex); break;
      case 'beacon': case 'cover': break;
    }
    if (!p.alive) { anyDead = true; continue; }

    // 밑바닥이 부서지면 떨어진다
    if (SETTLE_KINDS.has(p.kind) && p.attached < 0) {
      ex.settle += dt;
      if (ex.settle >= 1) {
        ex.settle = 0;
        const y = floorAt(g.world, p.pos.x, p.pos.y + 0.05, p.pos.z, 0.15);
        if (y < p.pos.y - 0.05) p.pos.y = y;
      }
    }
  }

  const t = (purgeT.get(g) ?? 0) + dt;
  if (t >= 2) {
    purgeT.set(g, 0);
    if (anyDead) {
      let j = 0;
      for (let i = 0; i < list.length; i++) if (list[i].alive) list[j++] = list[i];
      list.length = j;
    }
  } else purgeT.set(g, t);
}

function medTick(g: Game, p: Placed, ex: PExtra): void {
  const r = p.params.radius ?? 4;
  const hps = p.params.healPerSec ?? 12;
  for (const t of g.soldiers) {
    if (t.state !== 'alive' || t.team !== p.team || t.vehicle >= 0 || t.hp >= t.maxHp) continue;
    if (Math.abs(t.pos.y - p.pos.y) > 2.5 || distXZ(t.pos, p.pos) > r) continue;
    const h = Math.min(hps, t.maxHp - t.hp);
    t.hp += h;
    if (t.id === g.player) emit(g, { k: 'heal', s: t.id });
    if (t.id !== p.owner) {
      ex.acc += h;
      while (ex.acc >= 50) { ex.acc -= 50; award(g, p.owner, 10, '치료'); }
    }
  }
}

function ammoTick(g: Game, p: Placed, ex: PExtra): void {
  ex.n++;
  const r = p.params.radius ?? 4;
  const mps = p.params.magsPerSec ?? 0.5;
  const gadgetTurn = ex.n % 3 === 0;
  for (const t of g.soldiers) {
    if (t.state !== 'alive' || t.team !== p.team || t.vehicle >= 0) continue;
    if (Math.abs(t.pos.y - p.pos.y) > 2.5 || distXZ(t.pos, p.pos) > r) continue;
    let got = false;
    for (const ws of t.weapons) {
      if (!ws || !ws.st) continue;
      const max = ws.st.reserve;
      if (ws.reserve < max) {
        ws.reserve = Math.min(max, ws.reserve + Math.max(1, Math.ceil(mps * ws.st.mag)));
        got = true;
      }
    }
    if (gadgetTurn) {
      for (const gs of t.gadgets) {
        if (gs.kind !== 'ammobag' && gs.uses < gs.maxUses) { gs.uses++; got = true; }
      }
    }
    if (!got) continue;
    if (t.id === g.player) emit(g, { k: 'resupply', s: t.id });
    if (t.id !== p.owner && gadgetTurn) award(g, p.owner, 10, '보급');
  }
}

/** 대전차 지뢰: 적 지상 차량이 올라오면 터짐 */
function mineTick(g: Game, p: Placed, ex: PExtra): void {
  if (ex.age < ARM_TIME) return;
  for (const v of g.vehicles) {
    if (!v.alive || v.team === p.team) continue;
    const vd = VEHICLES[v.type];
    if (!vd || vd.air) continue;
    if (Math.abs(v.pos.y - p.pos.y) > 3) continue;
    if (distXZ(v.pos, p.pos) > 2.5 && vehicleGap(v, p.pos) > 0.4) continue;
    p.alive = false;
    const at = { x: p.pos.x, y: p.pos.y + 0.3, z: p.pos.z };
    damageVehicle(g, v, p.params.dmgVehicle ?? 600, p.owner, ex.gid, at, 'explosive');
    explode(g, at, p.params.radius ?? 3.5, p.params.dmg ?? 60, p.owner, p.team, ex.gid,
      { dmgVehicle: 0, wallDmg: p.params.wallDmg ?? 80, kind: 'mine' });
    return;
  }
}

/** 클레이모어: 앞 70° 부채꼴 range 안에 적 보병이 보이면 앞쪽으로 터짐 */
function claymoreTick(g: Game, p: Placed, ex: PExtra): void {
  if (ex.age < ARM_TIME) return;
  const w = g.world;
  const fwd = forwardXZ(p.yaw);
  const range = p.params.range ?? 4;
  const o = { x: p.pos.x, y: p.pos.y + 0.35, z: p.pos.z };
  let trig = false;
  for (const t of g.soldiers) {
    if (t.state !== 'alive' || t.team === p.team || t.vehicle >= 0) continue;
    const c = chestOf(t);
    const d = dist(o, c);
    if (d > range) continue;
    const dx = c.x - o.x, dz = c.z - o.z, dl = Math.hypot(dx, dz) || 1;
    if (d > 0.6 && (dx * fwd.x + dz * fwd.z) / dl < CLAY_TRIGGER_COS) continue;
    if (!lineOfSight(w, o, c)) continue;
    trig = true;
    break;
  }
  if (!trig) return;

  p.alive = false;
  const r = Math.max(range, p.params.radius ?? 8);
  const dmg = p.params.dmg ?? 130;
  for (const t of g.soldiers) {
    if (t.state !== 'alive' || t.team === p.team || t.vehicle >= 0) continue;
    const c = chestOf(t);
    const d = dist(o, c);
    if (d > r) continue;
    const dx = c.x - o.x, dz = c.z - o.z, dl = Math.hypot(dx, dz) || 1;
    if (d > 1 && (dx * fwd.x + dz * fwd.z) / dl < CLAY_BLAST_COS) continue;
    if (!lineOfSight(w, o, c)) continue;
    const k = d <= 2 ? 1 : 1 - 0.75 * clamp((d - 2) / Math.max(0.1, r - 2), 0, 1);
    damageSoldier(g, t, dmg * k, p.owner, ex.gid, false, o);
  }
  emit(g, { k: 'explosion', pos: o, r: 2.5, kind: 'mine' });
}

/** 접착 폭약: 차량에 붙었으면 따라간다 */
function breachFollow(g: Game, p: Placed, ex: PExtra): void {
  if (p.attached < 0) return;
  const v = g.vehicles[p.attached];
  if (!v || !v.alive) {
    p.attached = -1;
    p.pos.y = floorAt(g.world, p.pos.x, p.pos.y + 0.3, p.pos.z, 0.1);
    return;
  }
  const np = vehicleWorld(v, { x: ex.ox, y: ex.oy, z: ex.oz });
  p.pos.x = np.x; p.pos.y = np.y; p.pos.z = np.z;
  p.yaw = v.yaw;
}

/** 동작 감지기: 반경 안 적 표시 */
function sensorTick(g: Game, p: Placed): void {
  const r = p.params.radius ?? 20;
  for (const t of g.soldiers) {
    if (t.state !== 'alive' || t.team === p.team || t.vehicle >= 0) continue;
    if (dist(t.pos, p.pos) > r) continue;
    spotSoldier(g, t, p.owner, 2);
  }
  for (const v of g.vehicles) {
    if (!v.alive || v.team === p.team) continue;
    if (dist(v.pos, p.pos) > r) continue;
    v.spotT = Math.max(v.spotT, 2);
  }
}

/** 정찰 드론: 목표 위 25m 로 날아가 머물며 0.5초마다 보이는 적 표시 */
function droneTick(g: Game, p: Placed, ex: PExtra, dt: number): void {
  const w = g.world;
  const sp = p.params.speed ?? 14;
  const gy = floorAt(w, p.pos.x, 400, p.pos.z, 1.5);
  const ty = gy + DRONE_ALT;
  const dx = ex.tx - p.pos.x, dz = ex.tz - p.pos.z, hd = Math.hypot(dx, dz);
  let vx = 0, vz = 0;
  if (hd > 0.5) {
    const step = Math.min(sp, hd / Math.max(dt, 1e-3));
    vx = (dx / hd) * step;
    vz = (dz / hd) * step;
  }
  const vy = clamp((ty - p.pos.y) * 1.5, -6, 8);
  p.vel.x = vx; p.vel.y = vy; p.vel.z = vz;
  p.pos.x = clamp(p.pos.x + vx * dt, 1, w.size - 1);
  p.pos.y += vy * dt;
  p.pos.z = clamp(p.pos.z + vz * dt, 1, w.size - 1);
  if (p.pos.y < gy + 2) p.pos.y = gy + 2;
  if (hd > 0.5) p.yaw = Math.atan2(-dx, -dz);

  if (!every(ex, dt, 0.5)) return;
  const r = p.params.spotRadius ?? 45;
  for (const t of g.soldiers) {
    if (t.state !== 'alive' || t.team === p.team || t.vehicle >= 0) continue;
    if (distXZ(t.pos, p.pos) > r) continue;
    const e = eyePos(t);
    if (!lineOfSight(w, p.pos, e) || smokeBlocks(g, p.pos, e)) continue;
    spotSoldier(g, t, p.owner, 3);
  }
  for (const v of g.vehicles) {
    if (!v.alive || v.team === p.team) continue;
    if (distXZ(v.pos, p.pos) > r * 1.2) continue;
    const c = { x: v.pos.x, y: v.pos.y + 1.5, z: v.pos.z };
    if (!lineOfSight(w, p.pos, c)) continue;
    if (v.spotT < 0.5) emit(g, { k: 'spot', target: v.id, by: p.owner, vehicle: true });
    v.spotT = Math.max(v.spotT, 3);
  }
}

/** 화염: 반경 안 적 보병 지속 피해 */
function fireTick(g: Game, p: Placed, ex: PExtra): void {
  const r = p.params.radius ?? 4.5;
  const dps = p.params.dps ?? 25;
  for (const t of g.soldiers) {
    if (t.state !== 'alive' || t.team === p.team || t.vehicle >= 0) continue;
    if (Math.abs(t.pos.y - p.pos.y) > 2.2 || distXZ(t.pos, p.pos) > r) continue;
    damageSoldier(g, t, dps * 0.25, p.owner, ex.gid, false, p.pos);
  }
}

// ───────────────────────── 터뜨리기 ─────────────────────────

export function detonateBreach(g: Game, s: Soldier): void {
  for (const p of g.placed) {
    if (!p.alive || p.kind !== 'breach' || p.owner !== s.id) continue;
    p.alive = false;
    const ex = pext(p);
    const prm = p.params;
    const at = copy(p.pos);
    const r = prm.radius ?? 4.5;
    const dmg = prm.dmg ?? 120;
    const wall = prm.wallDmg ?? 500;
    const dv = prm.dmgVehicle ?? 500;
    const v = p.attached >= 0 ? g.vehicles[p.attached] : undefined;
    if (v && v.alive) {
      // 붙은 차량에는 감쇠 없이 전부
      damageVehicle(g, v, dv, p.owner, ex.gid, at, 'explosive');
      explode(g, at, r, dmg, p.owner, p.team, ex.gid, { dmgVehicle: 0, wallDmg: wall, kind: 'c4' });
    } else {
      explode(g, at, r, dmg, p.owner, p.team, ex.gid, { dmgVehicle: dv, wallDmg: wall, kind: 'c4' });
    }
  }
}

export function detonateThrown(g: Game, p: Projectile, at: Vec3): void {
  p.alive = false;
  const w = g.world;
  const def: GadgetDef | undefined = GADGETS[p.weapon];
  const params = variantParams(def, p.variant);
  let kind: GadgetKind = def ? def.kind : 'frag';
  if (kind === 'ugl' && ((params.smoke ?? 0) > 0 || p.variant.indexOf('smoke') >= 0)) kind = 'smoke';

  // 벽·바닥에 박히지 않게 날아온 쪽으로 조금 되돌림
  const sp = len(p.vel);
  const pos = sp > 0.01 ? addScaled(at, p.vel, -0.08 / sp) : copy(at);
  const yaw = sp > 0.01 ? Math.atan2(-p.vel.x, -p.vel.z) : 0;

  switch (kind) {
    case 'smoke': {
      const fy = floorAt(w, pos.x, pos.y + 0.3, pos.z, 0.3);
      const life = params.life ?? 20;
      g.smokes.push({ pos: { x: pos.x, y: fy + 1.6, z: pos.z }, r: params.radius ?? 9, life, max: life });
      emit(g, { k: 'gadget', s: p.owner, gadget: p.weapon, pos });
      return;
    }
    case 'flash':
      flashAt(g, p, pos, params);
      return;
    case 'incendiary': {
      const fy = floorAt(w, pos.x, pos.y + 0.3, pos.z, 0.3);
      const fp = { x: pos.x, y: fy, z: pos.z };
      const r = params.radius ?? 4.5;
      const life = params.life ?? 8;
      spawnPlaced(g, 'fire', p.owner, p.team, fp, 0, { ...params, dps: params.dps ?? 25, radius: r, life }, p.weapon);
      g.smokes.push({ pos: { x: fp.x, y: fp.y + 1.2, z: fp.z }, r: r * 0.55, life, max: life });
      emit(g, { k: 'explosion', pos: fp, r: 1.5, kind: 'grenade' });
      return;
    }
    case 'breach': {
      const bp = spawnPlaced(g, 'breach', p.owner, p.team, pos, yaw, params, p.weapon);
      let best: Vehicle | null = null;
      let bg = 1e9;
      for (const v of g.vehicles) {
        if (!v.alive) continue;
        const gap = vehicleGap(v, pos);
        if (gap > 1.0 && dist(v.pos, pos) > 3) continue;
        if (gap < bg) { bg = gap; best = v; }
      }
      if (best) {
        bp.attached = best.id;
        const ex = pext(bp);
        const l = vehicleLocal(best, pos);
        ex.ox = l.x; ex.oy = l.y; ex.oz = l.z;
      }
      return;
    }
    case 'sensor':
      enforceLimit(g, p.owner, 'sensor');
      spawnPlaced(g, 'sensor', p.owner, p.team, pos, yaw, params, p.weapon);
      return;
    case 'medbag': case 'ammobag': case 'atmine': case 'claymore': case 'beacon': case 'cover': {
      const fy = floorAt(w, pos.x, pos.y + 0.3, pos.z, 0.15);
      const pk = PLACE_KINDS[kind] as PlacedKind;
      enforceLimit(g, p.owner, pk);
      spawnPlaced(g, pk, p.owner, p.team, { x: pos.x, y: fy, z: pos.z }, yaw, params, p.weapon);
      return;
    }
    case 'ugl':
      explode(g, pos, p.radius > 0 ? p.radius : (params.radius ?? 3.5), p.dmg > 0 ? p.dmg : (params.dmg ?? 90), p.owner, p.team, p.weapon,
        { dmgVehicle: p.dmgVehicle > 0 ? p.dmgVehicle : (params.dmgVehicle ?? 120), wallDmg: p.wallDmg > 0 ? p.wallDmg : (params.wallDmg ?? 120), kind: 'ugl' });
      return;
    case 'rocket': case 'aa':
      explode(g, pos, p.radius > 0 ? p.radius : 3, p.dmg > 0 ? p.dmg : 80, p.owner, p.team, p.weapon,
        { dmgVehicle: p.dmgVehicle > 0 ? p.dmgVehicle : 300, wallDmg: p.wallDmg > 0 ? p.wallDmg : 200, kind: 'rocket' });
      return;
    default: {
      // frag, impact 등 폭발 투척물
      const dmg = p.dmg > 0 ? p.dmg : (params.dmg ?? 100);
      explode(g, pos, p.radius > 0 ? p.radius : (params.radius ?? 6), dmg, p.owner, p.team, p.weapon,
        { dmgVehicle: p.dmgVehicle > 0 ? p.dmgVehicle : (params.dmgVehicle ?? Math.round(dmg * 0.3)), wallDmg: p.wallDmg > 0 ? p.wallDmg : (params.wallDmg ?? 60), kind: 'grenade' });
      return;
    }
  }
}

/** 섬광: 범위 안에서 그쪽을 보고 있는 적(그리고 던진 사람)의 눈을 멀게 한다 */
function flashAt(g: Game, p: Projectile, pos: Vec3, params: Record<string, number>): void {
  const r = params.radius ?? 12;
  const blind = params.blind ?? 4;
  const src = { x: pos.x, y: pos.y + 0.25, z: pos.z };
  for (const t of g.soldiers) {
    if (t.state !== 'alive' || t.vehicle >= 0) continue;
    if (t.team === p.team && t.id !== p.owner) continue;
    const e = eyePos(t);
    const d = dist(e, src);
    if (d > r) continue;
    const to = scale(sub(src, e), 1 / (d || 1));
    const face = dot(dirFrom(t.yaw, t.pitch), to);
    if (face <= 0.2 && d > 2.5) continue;
    if (!lineOfSight(g.world, src, e)) continue;
    const k = clamp(1 - d / r, 0.2, 1) * (face > 0.2 ? 0.55 + 0.45 * face : 0.5);
    t.blindT = Math.max(t.blindT, blind * k);
  }
  emit(g, { k: 'explosion', pos: src, r: 1.2, kind: 'grenade' });
}
