// 보병 무기: 정조준, 교체, 재장전, 사격 방식, 반동·퍼짐, 탄 생성. 그리고 모든 투사체의 비행과 충돌.
import type { Box, ClassId, Game, Placed, Projectile, ProjKind, Soldier, Vec3, Vehicle, WeaponPick, WeaponState } from '../types';
import { DEG, lerp, rayAABB, smoothstep, spreadDir } from '../math';
import { aimDir, raySoldier } from './body';
import { computeStats, GADGETS, VEHICLES } from '../defs';
import { damageBox, raycast } from '../world';
import { emit, rand } from './game';
import { applyBreak, damageSoldier, damageVehicle, explode } from './damage';
import { vehicleHit } from './vehicles';
import { detonateThrown } from './gadgets';

/** 달리기를 멈추고 첫 발까지 */
const SPRINT_TO_FIRE = 0.12;
/** 단발 무기: 아직 못 쏠 때 누른 방아쇠를 기억하는 시간 */
const PRESS_BUFFER = 0.18;
const BLOOM_DECAY = 8;
const GRAV = 9.81;
const BULLET_LIFE = 3;
const PELLET_LIFE = 1.2;
const UGL_ARM = 6;
const UGL_DUD_DMG = 30;
const HOMING = 2.5;
const BOUNCE_E = 0.35;
const BOUNCE_FRICTION = 0.72;
const GADGET_ADS_TIME = 0.35;

// ───────────────────────── 무기 상태 ─────────────────────────

export function makeWeaponState(pick: WeaponPick, cls: ClassId): WeaponState {
  const st = computeStats(pick.id, pick.att, cls);
  return {
    id: pick.id, att: { ...pick.att }, st,
    mag: st.mag, reserve: st.reserve,
    reloadT: 0, reloadTotal: 0, fireT: 0,
    burstLeft: 0, mode: st.modes[0] ?? 'semi',
    bloom: 0, kickP: 0, kickY: 0, shots: 0, triggerHeld: false,
  };
}

/** 병사마다 sim 내부 보조 상태 (타입에 없는 것) */
interface WAux { sinceShot: number; sprintCool: number; queued: number; dryLatch: boolean; tracerN: number }
const wauxMap = new WeakMap<Soldier, WAux>();
function wauxOf(s: Soldier): WAux {
  let a = wauxMap.get(s);
  if (!a) { a = { sinceShot: 10, sprintCool: 0, queued: 0, dryLatch: false, tracerN: (s.id * 7) & 3 }; wauxMap.set(s, a); }
  return a;
}

/** 눈 위치에서 조준 방향으로 0.3m (허리 사격이면 약간 아래·오른쪽) */
export function fireOrigin(s: Soldier): Vec3 {
  const d = aimDir(s);
  const hip = 1 - Math.min(1, Math.max(0, s.ads));
  const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  return {
    x: s.pos.x + d.x * 0.3 + rx * 0.06 * hip,
    y: s.pos.y + s.eyeH + d.y * 0.3 - 0.07 * hip,
    z: s.pos.z + d.z * 0.3 + rz * 0.06 * hip,
  };
}

/** 지금 쏘면 퍼지는 원뿔 반각 (도). HUD 조준선에도 쓸 수 있다 */
export function soldierSpread(s: Soldier): number {
  const w = s.weapons[s.cur];
  if (!w) return 0;
  const st = w.st;
  const t = smoothstep(0.3, 0.9, s.ads);
  const hip = st.hipSpread * (st.laser ? 0.65 : 1);
  let sp = lerp(hip, st.adsSpread, t) + w.bloom * lerp(1, 0.35, t);
  sp += (st.moveSpread * Math.hypot(s.vel.x, s.vel.z)) / 5;
  if (!s.onGround) sp += 3;
  if (s.stance === 'prone') sp *= 0.6;
  else if (s.stance === 'crouch') sp *= 0.8;
  return sp > 0 ? sp : 0;
}

export function updateWeapons(g: Game, s: Soldier, dt: number): void {
  if (s.state !== 'alive' || s.vehicle >= 0) return;
  const ctl = s.ctl;
  const a = wauxOf(s);
  if (s.swapT > 0) s.swapT = Math.max(0, s.swapT - dt);
  if (s.sprinting) a.sprintCool = SPRINT_TO_FIRE;
  else if (a.sprintCool > 0) a.sprintCool = Math.max(0, a.sprintCool - dt);
  a.sinceShot += dt;
  if (a.queued > 0) a.queued -= dt;

  let w = s.weapons[s.cur];
  if (!w) return;

  // ── 장비를 들고 있을 때: 무기 칸 고르기로 돌아오기만 ──
  if (s.held === 'gadget') {
    if (w.reloadT > 0) w.reloadT = 0;
    w.burstLeft = 0; a.queued = 0;
    w.triggerHeld = ctl.fire;
    if (w.fireT > 0) w.fireT = Math.max(0, w.fireT - dt);
    // 조준하는 장비(로켓·대공·유탄)는 정조준 가능, 나머지는 내린다
    const gk = s.gadgets[s.heldGadget]?.kind;
    const aimable = gk === 'rocket' || gk === 'aa' || gk === 'ugl';
    if (aimable && s.ctl.ads && !s.sprinting && s.swapT <= 0) s.ads = Math.min(1, s.ads + dt / GADGET_ADS_TIME);
    else s.ads = Math.max(0, s.ads - (dt * 2) / GADGET_ADS_TIME);
    recover(w, a, dt, false);
    s.anim.reloadT = 0;
    if (ctl.switchTo === 0 || ctl.switchTo === 1) {
      const to = ctl.switchTo;
      ctl.switchTo = -1;
      const nw = s.weapons[to];
      if (nw) {
        s.cur = to; s.held = 'weapon';
        s.swapT = nw.st.swap;
        nw.reloadT = 0; nw.burstLeft = 0; nw.triggerHeld = ctl.fire;
        emit(g, { k: 'swap', s: s.id });
      }
    }
    return;
  }

  // ── 무기 바꾸기 ──
  if (ctl.switchTo === 0 || ctl.switchTo === 1) {
    const to = ctl.switchTo;
    ctl.switchTo = -1;
    const nw = s.weapons[to];
    if (to !== s.cur && nw) {
      w.reloadT = 0; w.burstLeft = 0;
      s.cur = to; w = nw;
      s.swapT = w.st.swap;
      w.reloadT = 0; w.burstLeft = 0; w.triggerHeld = ctl.fire;
      a.queued = 0;
      emit(g, { k: 'swap', s: s.id });
    }
  }
  const st = w.st;

  // ── 사격 방식 ──
  if (ctl.fireMode) {
    ctl.fireMode = false;
    if (st.modes.length > 1) {
      const i = st.modes.indexOf(w.mode);
      w.mode = st.modes[(i + 1) % st.modes.length];
      w.burstLeft = 0;
    }
  }

  // ── 재장전 ──
  if (ctl.reload) { ctl.reload = false; startReload(g, s, w); }
  if (w.reloadT > 0) {
    w.reloadT -= dt;
    if (w.reloadT <= 0) finishReload(w);
  }

  // ── 방아쇠 ──
  const pull = ctl.fire;
  const press = pull && !w.triggerHeld;
  w.triggerHeld = pull;
  if (!pull) a.dryLatch = false;
  if (pull && s.sprinting) {
    // 사격은 달리기를 끊는다
    s.sprinting = false; ctl.sprint = false;
    a.sprintCool = Math.max(a.sprintCool, SPRINT_TO_FIRE);
  }

  // ── 정조준 ──
  const adsRate = 1 / Math.max(0.05, st.adsTime);
  if (ctl.ads && !s.sprinting && s.swapT <= 0) s.ads = Math.min(1, s.ads + adsRate * (w.reloadT > 0 ? 0.6 : 1) * dt);
  else s.ads = Math.max(0, s.ads - adsRate * 2 * dt);

  // ── 사격 ──
  const interval = 60 / Math.max(1, st.rpm);
  w.fireT -= dt;
  const ready = s.swapT <= 0 && w.reloadT <= 0 && !s.sprinting && a.sprintCool <= 0;
  if (press) a.queued = PRESS_BUFFER;
  let want: boolean;
  if (w.mode === 'auto') want = pull;
  else if (w.mode === 'burst') {
    if (w.burstLeft <= 0 && a.queued > 0 && ready && w.fireT <= 0 && w.mag > 0) {
      w.burstLeft = Math.max(1, st.burst || 3);
      a.queued = 0;
    }
    want = w.burstLeft > 0;
  } else want = a.queued > 0;

  if (want && w.mag <= 0) {
    if (w.reloadT <= 0) {
      if (w.reserve > 0) startReload(g, s, w);
      else if (!a.dryLatch && pull) { emit(g, { k: 'dry', s: s.id }); a.dryLatch = true; }
    }
    w.burstLeft = 0; a.queued = 0; want = false;
  }

  let fired = false;
  if (want && ready) {
    let n = 0;
    while (w.fireT <= 0 && w.mag > 0 && n < 4) {
      shoot(g, s, w, a);
      fired = true; n++;
      if (w.mode === 'bolt') w.fireT += Math.max(interval, 0.9);
      else if (w.mode === 'pump') w.fireT += Math.max(interval, 0.7);
      else w.fireT += interval;
      if (w.mode === 'burst') {
        w.burstLeft--;
        if (w.burstLeft <= 0) { w.fireT += interval * 1.5; break; }
      } else if (w.mode !== 'auto') { a.queued = 0; break; }
    }
    if (w.mag <= 0) w.burstLeft = 0;
  }
  if (!fired && !(want && ready) && w.fireT < 0) w.fireT = 0;

  // 다 쏘면 자동 재장전
  if (w.mag <= 0 && w.reserve > 0 && w.reloadT <= 0 && s.swapT <= 0 && w.fireT <= 0) startReload(g, s, w);

  if (!pull && a.sinceShot > 0.25) w.shots = 0;
  recover(w, a, dt, fired || (pull && a.sinceShot < interval + 0.05));
  s.anim.reloadT = w.reloadT > 0 ? w.reloadT : 0;
}

function startReload(g: Game, s: Soldier, w: WeaponState): void {
  if (w.reloadT > 0 || w.reserve <= 0 || w.mag >= w.st.mag || s.swapT > 0) return;
  const empty = w.mag <= 0;
  w.reloadT = w.reloadTotal = Math.max(0.1, empty ? w.st.reloadEmpty : w.st.reload);
  w.burstLeft = 0;
  emit(g, { k: 'reload', s: s.id, empty });
}

function finishReload(w: WeaponState): void {
  const take = Math.min(Math.max(0, w.st.mag - w.mag), w.reserve);
  w.mag += take;
  w.reserve -= take;
  w.reloadT = 0;
}

/** 반동 회복·퍼짐 감소. 쏘는 중에는 아주 조금만 */
function recover(w: WeaponState, a: WAux, dt: number, firing: boolean): void {
  const m = Math.hypot(w.kickP, w.kickY);
  if (m > 1e-6) {
    let rate = w.st.recoilRecover * DEG;
    if (firing) rate *= 0.2;
    else if (a.sinceShot < 0.1) rate *= 0.5;
    const dec = (rate + (firing ? 0 : m * 3)) * dt;
    const k = m > dec ? (m - dec) / m : 0;
    w.kickP *= k; w.kickY *= k;
  } else { w.kickP = 0; w.kickY = 0; }
  if (a.sinceShot > 0.1 && w.bloom > 0) w.bloom = Math.max(0, w.bloom - BLOOM_DECAY * dt);
}

function shoot(g: Game, s: Soldier, w: WeaponState, a: WAux): void {
  const st = w.st;
  w.mag--;
  w.shots++;
  a.sinceShot = 0;

  const spread = soldierSpread(s);
  const aim = aimDir(s);
  const origin = fireOrigin(s);
  const pellets = Math.max(1, Math.round(st.pellets || 1));
  const kind: ProjKind = pellets > 1 ? 'pellet' : 'bullet';
  const tracer = st.ammoKind === 'tracer' || (a.tracerN++ & 3) === 0;
  const rnd = (): number => rand(g);
  const half = (pellets > 1 ? Math.max(spread, 1.5) : spread) * DEG;
  let first = aim;
  for (let k = 0; k < pellets; k++) {
    const d = spreadDir(aim, half, rnd);
    if (k === 0) first = d;
    spawnBullet(g, s, w, d, kind, tracer && k === 0, origin);
  }

  // 퍼짐 누적, 반동
  w.bloom = Math.min(st.spreadMax, w.bloom + st.spreadPerShot);
  let m = s.ads > 0.5 ? 1 : 1.2;
  if (s.stance === 'prone') m *= st.bipod ? 0.35 : 0.65;
  else if (s.stance === 'crouch') m *= st.bipod ? 0.55 : 0.85;
  w.kickP = Math.min(0.6, w.kickP + st.recoilV * (w.shots === 1 ? st.firstShot : 1) * DEG * m);
  w.kickY += (rand(g) * 2 - 1) * st.recoilH * DEG * m;

  emit(g, { k: 'shot', s: s.id, weapon: w.id, pos: origin, dir: first, suppressed: st.suppressed, tracer });
  s.anim.fireT = 0.1;
  if (!st.suppressed) s.spotT = Math.max(s.spotT, 1.2);
}

function spawnBullet(g: Game, s: Soldier, w: WeaponState, d: Vec3, kind: ProjKind, tracer: boolean, o: Vec3): void {
  const st = w.st, v = st.velocity;
  g.projectiles.push({
    id: g.nextId++, kind, alive: true,
    pos: { x: o.x, y: o.y, z: o.z }, prev: { x: o.x, y: o.y, z: o.z }, vel: { x: d.x * v, y: d.y * v, z: d.z * v },
    owner: s.id, team: s.team, weapon: w.id, variant: '',
    dmg: st.dmgNear, dmgFar: st.dmgFar, rangeNear: st.rangeNear, rangeFar: st.rangeFar, headMul: st.headMul,
    dist: 0, life: kind === 'pellet' ? PELLET_LIFE : BULLET_LIFE, gravity: 1,
    radius: 0, dmgVehicle: 0, wallDmg: 0,
    tracer, fuse: 0, bounce: false, target: -1, ammoKind: st.ammoKind,
  });
}

// ───────────────────────── 투사체 ─────────────────────────

const HIT_WORLD = 1, HIT_SOLDIER = 2, HIT_VEHICLE = 3, HIT_COVER = 4;
/** 가장 가까운 충돌 (재사용) */
const H = {
  type: 0, t: 0, box: -1, mat: 'dirt' as string, nx: 0, ny: 1, nz: 0,
  sol: null as Soldier | null, head: false, veh: null as Vehicle | null, cover: null as Placed | null,
};
/** 지금 검사 중인 선분의 시작점과 단위 방향 (재사용) */
const O: Vec3 = { x: 0, y: 0, z: 0 };
const D: Vec3 = { x: 0, y: 0, z: 1 };
const LO: Vec3 = { x: 0, y: 0, z: 0 };
const LD: Vec3 = { x: 0, y: 0, z: 0 };
const CMIN: Vec3 = { x: 0, y: -0.05, z: -0.15 };
const CMAX: Vec3 = { x: 0, y: 1.2, z: 0.15 };

/** 이번 스텝에 맞을 수 있는 병사, 방벽 */
const cands: Soldier[] = [];
const covers: Placed[] = [];
/** 첫 스텝을 지난 투사체 (첫 스텝은 쏜 사람 눈에서부터 검사해 벽 너머 생성 방지) */
const begun = new WeakSet<Projectile>();
const smokeCache = new Map<string, boolean>();

const MAT_MUL: Record<string, number> = { glass: 10, wood: 0.5, brick: 0.12, concrete: 0.06, metal: 0.04, rock: 0.02, sand: 0.05, foliage: 0.6 };

export function updateProjectiles(g: Game, dt: number): void {
  const ps = g.projectiles;
  if (ps.length === 0) return;

  cands.length = 0;
  for (let i = 0; i < g.soldiers.length; i++) {
    const t = g.soldiers[i];
    if (t.state === 'dead') continue;
    if (t.vehicle >= 0 && !exposedSeat(g, t)) continue;
    cands.push(t);
  }
  covers.length = 0;
  for (let i = 0; i < g.placed.length; i++) {
    const c = g.placed[i];
    if (c.alive && c.kind === 'cover') covers.push(c);
  }

  const n = ps.length;
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    if (p.alive) stepProjectile(g, p, dt);
  }
  // 죽은 투사체를 한 번에 걷어 낸다 (이번 스텝에 새로 생긴 것도 유지)
  let j = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.alive) { if (i !== j) ps[j] = p; j++; }
  }
  ps.length = j;
}

function exposedSeat(g: Game, t: Soldier): boolean {
  const v = g.vehicles[t.vehicle];
  if (!v || !v.alive) return false;
  const def = VEHICLES[v.type];
  const seat = def ? def.seats[t.seat] : undefined;
  return !!seat && seat.exposed;
}

const isBulletLike = (p: Projectile): boolean =>
  p.kind === 'bullet' || p.kind === 'pellet' || (p.kind === 'shell' && p.radius <= 0);

function stepProjectile(g: Game, p: Projectile, dt: number): void {
  const w = g.world;
  p.life -= dt;
  const fused = p.kind === 'thrown' && p.fuse > 0;
  if (p.life <= 0 && !(fused && p.life > -30)) { p.alive = false; return; }

  if (p.kind === 'missile' && p.target >= 0) homeMissile(g, p, dt);
  p.vel.y -= GRAV * p.gravity * dt;

  let ox = p.pos.x, oy = p.pos.y, oz = p.pos.z;
  const own = p.owner >= 0 ? g.soldiers[p.owner] : undefined;
  if (!begun.has(p)) {
    begun.add(p);
    if (own && own.vehicle < 0 && own.state !== 'dead') { ox = own.pos.x; oy = own.pos.y + own.eyeH; oz = own.pos.z; }
  }
  const ex = p.pos.x + p.vel.x * dt, ey = p.pos.y + p.vel.y * dt, ez = p.pos.z + p.vel.z * dt;
  p.prev.x = ox; p.prev.y = oy; p.prev.z = oz;
  let dx = ex - ox, dy = ey - oy, dz = ez - oz;
  const seg = Math.sqrt(dx * dx + dy * dy + dz * dz);

  let stopped = false;
  if (seg > 1e-6) {
    dx /= seg; dy /= seg; dz /= seg;
    O.x = ox; O.y = oy; O.z = oz;
    D.x = dx; D.y = dy; D.z = dz;
    const ownerVeh = own ? own.vehicle : -1;
    const bulletLike = isBulletLike(p);
    const hitSoldiers = p.kind !== 'thrown' || p.fuse <= 0;
    let traveled = 0, remain = seg;
    for (let pass = 0; pass < 5 && remain > 1e-4; pass++) {
      if (!nearestHit(g, p, remain, ownerVeh, hitSoldiers)) break;
      const t = H.t;
      const hx = O.x + D.x * t, hy = O.y + D.y * t, hz = O.z + D.z * t;
      const at = p.dist + traveled + t;
      if (bulletLike) {
        const adv = bulletHit(g, p, hx, hy, hz, at);
        if (adv < 0) {
          p.pos.x = hx; p.pos.y = hy; p.pos.z = hz;
          p.dist += traveled + t;
          p.alive = false; stopped = true;
          break;
        }
        // 관통: 상자 너머에서 계속
        O.x += D.x * adv; O.y += D.y * adv; O.z += D.z * adv;
        traveled += adv; remain -= adv;
        continue;
      }
      p.dist += traveled + t;
      if (p.kind === 'thrown') thrownHit(g, p, hx, hy, hz);
      else explosiveHit(g, p, hx, hy, hz, at);
      stopped = true;
      break;
    }
  }
  if (!stopped) {
    p.pos.x = ex; p.pos.y = ey; p.pos.z = ez;
    p.dist += seg;
  }
  if (!p.alive) return;

  const pp = p.pos;
  if (pp.x < -5 || pp.z < -5 || pp.x > w.size + 5 || pp.z > w.size + 5 || pp.y < -200 || pp.y > 3000) { p.alive = false; return; }

  if (fused) {
    p.fuse -= dt;
    if (p.fuse <= 0) {
      p.alive = false;
      detonateThrown(g, p, { x: pp.x, y: pp.y, z: pp.z });
    }
  }
}

/** O 에서 D 로 maxT 안의 가장 가까운 충돌을 H 에 채운다 */
function nearestHit(g: Game, p: Projectile, maxT: number, ownerVeh: number, hitSoldiers: boolean): boolean {
  let best = maxT;
  H.type = 0;
  const rh = raycast(g.world, O, D, maxT);
  if (rh && rh.t <= best) {
    best = rh.t;
    H.type = HIT_WORLD; H.t = rh.t; H.box = rh.box; H.mat = rh.mat;
    H.nx = rh.normal.x; H.ny = rh.normal.y; H.nz = rh.normal.z;
  }
  // 선분 경계 상자 (거친 판정)
  const ex = O.x + D.x * best, ey = O.y + D.y * best, ez = O.z + D.z * best;
  const minX = Math.min(O.x, ex), maxX = Math.max(O.x, ex);
  const minY = Math.min(O.y, ey), maxY = Math.max(O.y, ey);
  const minZ = Math.min(O.z, ez), maxZ = Math.max(O.z, ez);

  if (hitSoldiers) {
    for (let i = 0; i < cands.length; i++) {
      const t = cands[i];
      if (t.id === p.owner || t.team === p.team || t.state === 'dead') continue;
      const tp = t.pos;
      if (tp.x < minX - 1 || tp.x > maxX + 1 || tp.z < minZ - 1 || tp.z > maxZ + 1 || tp.y < minY - 2 || tp.y > maxY + 0.4) continue;
      const r = raySoldier(t, O, D, best);
      if (r && r.t < best) {
        best = r.t;
        H.type = HIT_SOLDIER; H.t = r.t; H.sol = t; H.head = r.head;
      }
    }
  }

  if (g.vehicles.length > 0) {
    const vh = vehicleHit(g, O, D, best, ownerVeh);
    if (vh && vh.t < best) {
      best = vh.t;
      H.type = HIT_VEHICLE; H.t = vh.t; H.veh = vh.v;
    }
  }

  for (let i = 0; i < covers.length; i++) {
    const c = covers[i];
    if (!c.alive) continue;
    const hw = (c.params.width || 2) * 0.5;
    const rr = hw + 0.3;
    const cp = c.pos;
    if (cp.x < minX - rr || cp.x > maxX + rr || cp.z < minZ - rr || cp.z > maxZ + rr || cp.y > maxY + 0.2 || cp.y < minY - 1.4) continue;
    // 방벽 좌표계: x = 오른쪽(폭), y = 위, z = 앞(두께)
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    const rx = O.x - cp.x, ry = O.y - cp.y, rz = O.z - cp.z;
    LO.x = rx * cy - rz * sy; LO.y = ry; LO.z = -rx * sy - rz * cy;
    LD.x = D.x * cy - D.z * sy; LD.y = D.y; LD.z = -D.x * sy - D.z * cy;
    CMIN.x = -hw; CMAX.x = hw;
    const r = rayAABB(LO, LD, CMIN, CMAX, best);
    if (r && r.t > 1e-6 && r.t < best) {
      best = r.t;
      H.type = HIT_COVER; H.t = r.t; H.cover = c;
      H.nx = cy * r.nx - sy * r.nz; H.ny = r.ny; H.nz = -sy * r.nx - cy * r.nz;
    }
  }
  return H.type !== 0;
}

function dmgAt(p: Projectile, d: number): number {
  if (d <= p.rangeNear) return p.dmg;
  if (d >= p.rangeFar || p.rangeFar <= p.rangeNear) return p.dmgFar;
  return lerp(p.dmg, p.dmgFar, (d - p.rangeNear) / (p.rangeFar - p.rangeNear));
}

function impact(g: Game, x: number, y: number, z: number, nx: number, ny: number, nz: number, mat: string, big: boolean): void {
  emit(g, { k: 'impact', pos: { x, y, z }, normal: { x: nx, y: ny, z: nz }, mat, big });
}

function boxById(g: Game, id: number): Box | undefined {
  const bs = g.world.boxes;
  const b = bs[id];
  if (b && b.id === id) return b;
  for (let i = 0; i < bs.length; i++) if (bs[i].id === id) return bs[i];
  return undefined;
}

/** O 에서 D 로 상자를 빠져나가는 t */
function boxExitT(b: Box): number {
  let te = Infinity;
  if (D.x > 1e-9) te = Math.min(te, (b.max.x - O.x) / D.x); else if (D.x < -1e-9) te = Math.min(te, (b.min.x - O.x) / D.x);
  if (D.y > 1e-9) te = Math.min(te, (b.max.y - O.y) / D.y); else if (D.y < -1e-9) te = Math.min(te, (b.min.y - O.y) / D.y);
  if (D.z > 1e-9) te = Math.min(te, (b.max.z - O.z) / D.z); else if (D.z < -1e-9) te = Math.min(te, (b.min.z - O.z) / D.z);
  return te === Infinity ? 0 : te;
}

/** 총탄이 상자에 맞음: 상자 피해, 탄착. 관통하면 남는 피해 배율, 아니면 0 */
function bulletVsBox(g: Game, p: Projectile, box: Box, dmg: number, hx: number, hy: number, hz: number): number {
  let pass = 0;
  if (box.mat === 'glass' || box.kind === 'window') pass = 0.9;
  else if (box.mat === 'foliage') pass = 0.85;
  else if (box.kind === 'fence') pass = p.ammoKind === 'ap' ? 0.9 : 0.8;
  else if (p.ammoKind === 'ap' && box.mat === 'wood' && box.kind !== 'tree') {
    const th = Math.min(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    if (th <= 0.45) pass = 0.7;
  }
  if (box.destructible && box.alive) {
    let mul = box.kind === 'tree' ? 0.3 : MAT_MUL[box.mat] ?? 0.05;
    if (p.ammoKind === 'ap') mul *= 1.5;
    let bd = dmg * mul;
    if (box.mat === 'glass') bd = Math.max(bd, box.hp + 1); // 유리는 언제나 깨진다
    if (bd > 0) {
      const r = damageBox(g.world, box.id, bd);
      if (r.broken.length > 0 || r.collapsed.length > 0) applyBreak(g, r);
    }
  }
  impact(g, hx, hy, hz, H.nx, H.ny, H.nz, H.mat, false);
  return pass;
}

/** 총탄 충돌 처리. 멈추면 -1, 관통하면 O 에서 다시 시작할 거리 */
function bulletHit(g: Game, p: Projectile, hx: number, hy: number, hz: number, at: number): number {
  switch (H.type) {
    case HIT_WORLD: {
      if (H.box < 0) { impact(g, hx, hy, hz, H.nx, H.ny, H.nz, H.box === -2 ? 'water' : H.mat, false); return -1; }
      const box = boxById(g, H.box);
      if (!box) { impact(g, hx, hy, hz, H.nx, H.ny, H.nz, H.mat, false); return -1; }
      const pass = bulletVsBox(g, p, box, dmgAt(p, at), hx, hy, hz);
      if (pass <= 0) return -1;
      p.dmg *= pass; p.dmgFar *= pass;
      return Math.max(H.t, boxExitT(box)) + 0.02;
    }
    case HIT_SOLDIER: {
      const t = H.sol!;
      let dmg = dmgAt(p, at);
      if (p.ammoKind === 'hp' && at <= p.rangeNear) dmg *= 1.15;
      if (H.head) dmg *= p.headMul;
      damageSoldier(g, t, dmg, p.owner, p.weapon, H.head, { x: p.prev.x, y: p.prev.y, z: p.prev.z });
      return -1;
    }
    case HIT_VEHICLE: {
      const v = H.veh!;
      impact(g, hx, hy, hz, -D.x, -D.y, -D.z, 'metal', false);
      if (v.team !== p.team) {
        const dmg = p.dmgVehicle > 0 ? p.dmgVehicle : dmgAt(p, at);
        damageVehicle(g, v, dmg, p.owner, p.weapon, { x: hx, y: hy, z: hz }, p.ammoKind === 'ap' || p.kind === 'shell' ? 'ap' : 'bullet');
      }
      return -1;
    }
    case HIT_COVER: {
      const c = H.cover!;
      c.hp -= dmgAt(p, at) * (p.ammoKind === 'ap' ? 1 : 0.5);
      const dead = c.hp <= 0;
      if (dead) c.alive = false;
      impact(g, hx, hy, hz, H.nx, H.ny, H.nz, 'metal', dead);
      return -1;
    }
  }
  return -1;
}

function isSmokeUgl(p: Projectile): boolean {
  const key = p.weapon + '|' + p.variant;
  let r = smokeCache.get(key);
  if (r === undefined) {
    const def = GADGETS[p.weapon];
    const v = def ? def.variants.find((x) => x.id === p.variant) : undefined;
    r = v ? (v.params.smoke ?? 0) > 0 : p.variant.indexOf('smoke') >= 0 || (p.radius <= 0 && p.dmg <= 0);
    smokeCache.set(key, r);
  }
  return r;
}

/** 로켓·미사일·포탄·유탄 */
function explosiveHit(g: Game, p: Projectile, hx: number, hy: number, hz: number, at: number): void {
  const bx = hx - D.x * 0.2, by = hy - D.y * 0.2, bz = hz - D.z * 0.2;
  p.pos.x = bx; p.pos.y = by; p.pos.z = bz;
  p.alive = false;
  if (p.kind === 'ugl') {
    if (isSmokeUgl(p)) { detonateThrown(g, p, { x: bx, y: by, z: bz }); return; }
    if (at < UGL_ARM) {
      // 장전 거리 전: 불발
      if (H.type === HIT_SOLDIER) damageSoldier(g, H.sol!, UGL_DUD_DMG, p.owner, p.weapon, false, { x: p.prev.x, y: p.prev.y, z: p.prev.z });
      else if (H.type === HIT_WORLD) impact(g, hx, hy, hz, H.nx, H.ny, H.nz, H.box === -2 ? 'water' : H.mat, false);
      else impact(g, hx, hy, hz, -D.x, -D.y, -D.z, 'metal', false);
      return;
    }
  }
  let dmgV = p.dmgVehicle;
  if (H.type === HIT_VEHICLE && p.kind !== 'ugl') {
    // 직격: 맞은 면 장갑으로 바로 피해, 폭발은 주변용
    const v = H.veh!;
    if (v.team !== p.team) damageVehicle(g, v, p.dmgVehicle, p.owner, p.weapon, { x: hx, y: hy, z: hz }, 'explosive');
    dmgV *= 0.15;
  } else if (H.type === HIT_COVER) {
    const c = H.cover!;
    c.hp -= Math.max(p.dmg, p.dmgVehicle) * 1.5;
    if (c.hp <= 0) c.alive = false;
  }
  const kind = p.kind === 'ugl' ? 'ugl' : p.kind === 'shell' ? 'shell' : 'rocket';
  explode(g, { x: bx, y: by, z: bz }, p.radius, p.dmg, p.owner, p.team, p.weapon, { dmgVehicle: dmgV, wallDmg: p.wallDmg, kind });
}

/** 투척물: 충격 신관이면 터지고, 아니면 튕기거나 붙는다 */
function thrownHit(g: Game, p: Projectile, hx: number, hy: number, hz: number): void {
  if (p.fuse <= 0 || H.type === HIT_SOLDIER) {
    p.pos.x = hx - D.x * 0.1; p.pos.y = hy - D.y * 0.1; p.pos.z = hz - D.z * 0.1;
    p.alive = false;
    detonateThrown(g, p, { x: p.pos.x, y: p.pos.y, z: p.pos.z });
    return;
  }
  const v = p.vel;
  if (H.type === HIT_WORLD && H.box === -2) {
    // 물에 빠짐: 가라앉아 바닥에 머문다 (신관은 계속 탄다)
    impact(g, hx, hy, hz, 0, 1, 0, 'water', false);
    p.pos.x = hx; p.pos.y = hy - 0.25; p.pos.z = hz;
    v.x *= 0.1; v.z *= 0.1; v.y = -1.5;
    p.bounce = false;
    return;
  }
  let nx: number, ny: number, nz: number;
  if (H.type === HIT_WORLD || H.type === HIT_COVER) { nx = H.nx; ny = H.ny; nz = H.nz; }
  else { nx = -D.x; ny = -D.y; nz = -D.z; }
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-6) { nx = -D.x; ny = -D.y; nz = -D.z; } else { nx /= nl; ny /= nl; nz /= nl; }
  p.pos.x = hx + nx * 0.03; p.pos.y = hy + ny * 0.03; p.pos.z = hz + nz * 0.03;
  if (!p.bounce) { v.x = 0; v.y = 0; v.z = 0; return; }
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn < 0) {
    // 법선 성분은 반발 계수로 되튀고, 접선 성분은 마찰로 줄어든다
    const tx = v.x - vn * nx, ty = v.y - vn * ny, tz = v.z - vn * nz;
    const rn = -vn * BOUNCE_E;
    v.x = tx * BOUNCE_FRICTION + nx * rn;
    v.y = ty * BOUNCE_FRICTION + ny * rn;
    v.z = tz * BOUNCE_FRICTION + nz * rn;
  }
  if (ny > 0.5 && Math.hypot(v.x, v.y, v.z) < 0.5) { v.x = 0; v.y = 0; v.z = 0; }
}

/** 유도 미사일: 대상 차량 쪽으로 초당 HOMING rad 까지 꺾는다 (약간 앞을 겨눔) */
function homeMissile(g: Game, p: Projectile, dt: number): void {
  const v = g.vehicles[p.target];
  if (!v || !v.alive || v.counterT > 0) { p.target = -1; return; }
  const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
  if (sp < 1) return;
  const def = VEHICLES[v.type];
  let tx = v.pos.x - p.pos.x, ty = v.pos.y + (def ? def.size.y * 0.4 : 1) - p.pos.y, tz = v.pos.z - p.pos.z;
  const tgo = Math.min(3, Math.hypot(tx, ty, tz) / sp);
  tx += v.vel.x * tgo; ty += v.vel.y * tgo; tz += v.vel.z * tgo;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  const cx = p.vel.x / sp, cy = p.vel.y / sp, cz = p.vel.z / sp;
  const cosA = Math.max(-1, Math.min(1, cx * tx + cy * ty + cz * tz));
  const ang = Math.acos(cosA);
  const maxA = HOMING * dt;
  let nx: number, ny: number, nz: number;
  if (ang <= maxA || ang < 1e-5) { nx = tx; ny = ty; nz = tz; }
  else {
    const s = Math.sin(ang);
    if (s < 1e-5) { nx = cx; ny = cy; nz = cz; } // 정반대: 그대로
    else {
      const k1 = Math.sin(ang - maxA) / s, k2 = Math.sin(maxA) / s;
      nx = cx * k1 + tx * k2; ny = cy * k1 + ty * k2; nz = cz * k1 + tz * k2;
    }
  }
  const nl = Math.hypot(nx, ny, nz) || 1;
  p.vel.x = (nx / nl) * sp; p.vel.y = (ny / nl) * sp; p.vel.z = (nz / nl) * sp;
}
