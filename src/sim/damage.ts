// sim-core: 피해·쓰러짐·사망·폭발·차량 피해·소생·연막 판정·표시·세계 파괴 반영
import type { BreakResult, Game, Placed, Soldier, Team, Vec3, Vehicle } from '../types';
import { DIFFS, VEHICLES } from '../defs';
import { blastWorld, lineOfSight } from '../world';
import { clamp, forwardXZ, rightXZ, yawTo } from '../math';
import { headCenter } from './body';
import { exitVehicle } from './vehicles';
import { award, core, emit, occupied, rand, vehicleTeam } from './core-util';

/** 쓰러진 뒤 출혈 시간 s */
export const DOWN_TIME = 15;

// ───────────────────────── 병사 피해 ─────────────────────────

export function damageSoldier(g: Game, t: Soldier, dmg: number, by: number, weapon: string, head: boolean, from: Vec3 | null): void {
  hurt(g, t, dmg, by, weapon, head, from, false);
}

/** 내부 피해 처리. blast = 폭발·붕괴 피해 (자해 50%, 큰 초과 피해는 즉사, 쓰러진 병사 마무리) */
export function hurt(g: Game, t: Soldier, dmg: number, by: number, weapon: string, head: boolean, from: Vec3 | null, blast: boolean): void {
  if (g.over || t.state === 'dead' || !(dmg > 0)) return;
  const atk = by >= 0 ? g.soldiers[by] : undefined;
  const self = !!atk && atk.id === t.id;
  // 아군 사격 없음 (자기 폭발은 허용)
  if (atk && !self && atk.team === t.team) return;
  if (t.state === 'down') {
    // 쓰러진 병사는 큰 피해에만 마무리된다
    if ((blast && dmg >= 40) || dmg >= 100) finalizeDown(g, t);
    return;
  }
  if (t.protect > 0) return;
  if (self && blast) dmg *= 0.5;
  const diff = DIFFS[g.opts.diff];
  if (diff) {
    if (t.isPlayer) dmg *= diff.dmgTaken;
    if (atk && !self && atk.isPlayer) dmg *= diff.dmgDealt;
  }
  if (!(dmg > 0)) return;

  const before = t.hp;
  t.hp -= dmg;
  if (atk && !self) t.dmgFrom[atk.id] = (t.dmgFrom[atk.id] || 0) + Math.min(dmg, Math.max(0, before));
  t.lastHurtT = g.time;
  t.lastHurtBy = by;
  if (blast && from) t.lastHurtYaw = yawTo(t.pos, from);
  else if (atk && !self) t.lastHurtYaw = yawTo(t.pos, atk.pos);
  else if (from) t.lastHurtYaw = yawTo(t.pos, from);
  t.anim.hitT = 0.3;

  const kill = t.hp <= 0;
  const hp: Vec3 = head ? headCenter(t) : { x: t.pos.x, y: t.pos.y + (t.stance === 'prone' ? 0.3 : t.eyeH * 0.72), z: t.pos.z };
  emit(g, { k: 'hit', target: t.id, by, dmg, head, pos: hp, kill });
  if (!kill) return;

  const instant = (head && dmg >= 80) || (blast && t.hp < -50) || t.vehicle >= 0;
  if (instant) killSoldier(g, t, by, weapon, head);
  else goDown(g, t, by, weapon, head);
}

/** 강제로 차량에서 내림 (exitVehicle 이 거부해도 좌석을 비운다) */
function forceExit(g: Game, t: Soldier): void {
  if (t.vehicle < 0) return;
  const v = g.vehicles[t.vehicle];
  exitVehicle(g, t);
  if (t.vehicle >= 0) {
    if (v) { const i = v.seats.indexOf(t.id); if (i >= 0) v.seats[i] = -1; }
    t.vehicle = -1;
    t.seat = -1;
  }
}

function goDown(g: Game, t: Soldier, by: number, weapon: string, head: boolean): void {
  forceExit(g, t);
  t.state = 'down';
  t.hp = 0;
  t.downT = DOWN_TIME;
  t.sprinting = false;
  t.sliding = 0;
  t.ads = 0;
  t.vel.x *= 0.3;
  t.vel.z *= 0.3;
  t.reviving = -1;
  t.reviveProg = 0;
  t.ctl.fire = false;
  t.ctl.ads = false;
  const c = core(g);
  c.downBy[t.id] = by;
  c.downWeapon[t.id] = weapon;
  c.downHead[t.id] = head ? 1 : 0;
  c.handRevive[t.id] = 0;
  emit(g, { k: 'down', s: t.id, by, weapon, head });
  creditKill(g, t, by, head);
}

/** 사살 점수·도움 점수. 한 생애에 한 번만 (쓰러질 때 또는 즉사할 때) */
function creditKill(g: Game, t: Soldier, by: number, head: boolean): void {
  const c = core(g);
  const k = by >= 0 ? g.soldiers[by] : undefined;
  if (k && k.id !== t.id && k.team !== t.team) {
    k.kills++;
    award(g, k.id, 100, '적 처치');
    if (head) { k.heads++; award(g, k.id, 25, '헤드샷'); }
    const fk = c.inFlag[k.id], fv = c.inFlag[t.id];
    const fA = fk >= 0 ? g.flags[fk] : undefined, fB = fv >= 0 ? g.flags[fv] : undefined;
    if ((fA && fA.owner === k.team) || (fB && fB.owner === k.team)) award(g, k.id, 20, '거점 방어');
    const sp = c.spottedBy[t.id];
    if (sp >= 0 && sp !== k.id && t.spotT > 0) {
      const ss = g.soldiers[sp];
      if (ss && ss.team === k.team) award(g, sp, 20, '표시 지원');
    }
  }
  for (const key in t.dmgFrom) {
    const id = +key;
    if (id === by || id === t.id) continue;
    const a = g.soldiers[id];
    const d = t.dmgFrom[id];
    if (!a || a.team === t.team || !(d >= 20)) continue;
    a.assists++;
    award(g, id, Math.min(90, Math.round(d)), '처치 지원');
  }
}

export function killSoldier(g: Game, t: Soldier, by: number, weapon: string, head: boolean): void {
  if (t.state === 'dead') return;
  const c = core(g);
  let eBy = by, eW = weapon, eH = head;
  if (t.state === 'down') {
    // 쓰러질 때 이미 사살 처리함: 기록만 쓰러뜨린 사람으로
    eBy = c.downBy[t.id];
    eW = c.downWeapon[t.id] || weapon;
    eH = c.downHead[t.id] === 1;
  } else {
    creditKill(g, t, by, head);
  }
  forceExit(g, t);
  t.state = 'dead';
  t.hp = 0;
  t.downT = 0;
  t.deadT = 0;
  t.deaths++;
  t.respawnT = t.isPlayer ? 8 : 10 + rand(g) * 4;
  t.protect = 0;
  t.ads = 0;
  t.sprinting = false;
  t.sliding = 0;
  t.reviving = -1;
  t.reviveProg = 0;
  t.spotT = 0;
  t.ctl.fire = false;
  t.ctl.ads = false;
  c.spottedBy[t.id] = -1;
  c.handRevive[t.id] = 0;
  c.downBy[t.id] = -1;
  g.tickets[t.team] = Math.max(0, g.tickets[t.team] - 1);
  emit(g, { k: 'kill', s: t.id, by: eBy, weapon: eW, head: eH });
  if (t.isPlayer) g.playerNeedsDeploy = true;
}

/** 쓰러진 병사를 최종 사망으로 (출혈·포기·마무리) */
export function finalizeDown(g: Game, t: Soldier): void {
  if (t.state !== 'down') return;
  const c = core(g);
  killSoldier(g, t, c.downBy[t.id], c.downWeapon[t.id], c.downHead[t.id] === 1);
}

export function reviveSoldier(g: Game, t: Soldier, by: number, hp: number): void {
  if (t.state !== 'down') return;
  const c = core(g);
  t.state = 'alive';
  t.hp = clamp(hp, 1, t.maxHp);
  t.downT = 0;
  t.dmgFrom = {};
  t.reviving = -1;
  t.reviveProg = 0;
  t.lastHurtT = g.time;
  t.vel.x = 0; t.vel.z = 0;
  c.downBy[t.id] = -1;
  c.downWeapon[t.id] = '';
  c.downHead[t.id] = 0;
  emit(g, { k: 'revive', s: t.id, by });
  // 점수는 부른 쪽이 준다 (손 소생: sim-core, 제세동기: sim-gadgets)
  const r = by >= 0 ? g.soldiers[by] : undefined;
  if (r && r.id !== t.id) r.revives++;
}

// ───────────────────────── 폭발 ─────────────────────────

/** 차량 상자(OBB)에서 점까지의 거리 */
function vehicleDist(v: Vehicle, p: Vec3): number {
  const def = VEHICLES[v.type];
  const sx = def ? def.size.x : 3, sy = def ? def.size.y : 2.5, sz = def ? def.size.z : 6;
  const dx = p.x - v.pos.x, dz = p.z - v.pos.z;
  const fw = forwardXZ(v.yaw), rt = rightXZ(v.yaw);
  const lx = dx * rt.x + dz * rt.z, lz = dx * fw.x + dz * fw.z;
  const ex = Math.max(0, Math.abs(lx) - sx * 0.5);
  const ez = Math.max(0, Math.abs(lz) - sz * 0.5);
  const bottom = v.pos.y - sy * 0.5, top = v.pos.y + sy;
  const ey = Math.max(0, bottom - p.y, p.y - top);
  return Math.sqrt(ex * ex + ey * ey + ez * ez);
}

export function explode(
  g: Game, pos: Vec3, r: number, dmg: number, by: number, team: Team, weapon: string,
  o: { dmgVehicle: number; wallDmg: number; kind: 'grenade' | 'rocket' | 'shell' | 'vehicle' | 'mine' | 'c4' | 'ugl' },
): void {
  const at: Vec3 = { x: pos.x, y: pos.y, z: pos.z };
  emit(g, { k: 'explosion', pos: at, r, kind: o.kind });
  if (!(r > 0)) return;
  const w = g.world;
  const up: Vec3 = { x: at.x, y: at.y + 0.3, z: at.z };
  const reach = r + 1;

  // 보병
  if (dmg > 0) {
    const ss = g.soldiers;
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      if (s.state === 'dead') continue;
      if (by >= 0 && s.team === team && s.id !== by) continue;
      const dx = s.pos.x - at.x, dz = s.pos.z - at.z;
      if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
      if (s.vehicle >= 0) {
        // 차 안은 드러난 좌석만 맞는다
        const v = g.vehicles[s.vehicle];
        const seat = v ? VEHICLES[v.type]?.seats[s.seat] : undefined;
        if (!seat || !seat.exposed) continue;
      }
      const low = s.state === 'down' || s.stance === 'prone';
      const cy = s.pos.y + (low ? 0.3 : Math.min(1.0, s.eyeH * 0.6));
      const dy = cy - at.y;
      const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - 0.3);
      if (d >= r) continue;
      let f = Math.pow(1 - d / r, 1.2);
      if (!lineOfSight(w, up, { x: s.pos.x, y: cy, z: s.pos.z })) f *= 0.3;
      if (s.stance === 'prone' && s.state === 'alive') f *= 0.8;
      hurt(g, s, dmg * f, by, weapon, false, at, true);
    }
  }

  // 차량
  if (o.dmgVehicle > 0) {
    const vs = g.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (!v.alive) continue;
      if (by >= 0 && vehicleTeam(g, v) === team) continue;
      const dx = v.pos.x - at.x, dz = v.pos.z - at.z;
      const lim = reach + 8;
      if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
      const d = vehicleDist(v, at);
      if (d >= r) continue;
      const f = clamp(1 - d / r, 0, 1);
      damageVehicle(g, v, o.dmgVehicle * f, by, weapon, at, 'explosive');
    }
  }

  // 설치물: 지뢰·클레이모어는 연쇄 폭발, 나머지는 hp
  const pl = g.placed;
  const np = pl.length;
  for (let i = 0; i < np; i++) {
    const p = pl[i];
    if (!p.alive || p.kind === 'fire') continue;
    if (by >= 0 && p.team === team) continue;
    const dx = p.pos.x - at.x, dy = p.pos.y - at.y, dz = p.pos.z - at.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) continue;
    const f = Math.pow(1 - Math.sqrt(d2) / r, 1.2);
    if (p.kind === 'atmine' || p.kind === 'claymore') {
      if (f > 0.2) chainDetonate(g, p);
    } else if (p.kind === 'breach') {
      if (f > 0.3) p.alive = false;
    } else if (p.hp > 0) {
      p.hp -= Math.max(dmg, o.wallDmg) * f;
      if (p.hp <= 0) p.alive = false;
    }
  }

  // 세계 파괴
  if (o.wallDmg > 0) {
    const c = core(g);
    const pb = c.breakBy, pt = c.breakTeam;
    c.breakBy = by;
    c.breakTeam = by >= 0 ? team : -1;
    applyBreak(g, blastWorld(w, at, r * 0.8, o.wallDmg));
    c.breakBy = pb;
    c.breakTeam = pt;
  }
}

function chainDetonate(g: Game, p: Placed): void {
  if (!p.alive) return;
  p.alive = false;
  const pos: Vec3 = { x: p.pos.x, y: p.pos.y + 0.1, z: p.pos.z };
  if (p.kind === 'atmine') {
    explode(g, pos, p.params.radius || 4, p.params.dmgInfantry || 70, p.owner, p.team, '대전차 지뢰',
      { dmgVehicle: p.params.dmgVehicle || 600, wallDmg: 80, kind: 'mine' });
  } else {
    explode(g, pos, Math.max(2.5, (p.params.radius || 3) * 0.8), p.params.dmg || 90, p.owner, p.team, '클레이모어',
      { dmgVehicle: 20, wallDmg: 30, kind: 'mine' });
  }
}

// ───────────────────────── 차량 피해 ─────────────────────────

export function damageVehicle(g: Game, v: Vehicle, dmg: number, by: number, weapon: string, hit: Vec3 | null, kind: 'bullet' | 'ap' | 'explosive'): void {
  if (g.over || !v.alive || !(dmg > 0)) return;
  const def = VEHICLES[v.type];
  const vt = vehicleTeam(g, v);
  const atk = by >= 0 ? g.soldiers[by] : undefined;
  if (atk && atk.team === vt) return;

  // 맞은 면
  let armor = 1;
  if (def) {
    const A = def.armor;
    if (hit) {
      const dx = hit.x - v.pos.x, dz = hit.z - v.pos.z;
      const fw = forwardXZ(v.yaw), rt = rightXZ(v.yaw);
      const fn = (dx * fw.x + dz * fw.z) / Math.max(0.5, def.size.z * 0.5);
      const rn = (dx * rt.x + dz * rt.z) / Math.max(0.5, def.size.x * 0.5);
      const inside = Math.abs(fn) < 0.95 && Math.abs(rn) < 0.95;
      const atkAir = !!atk && atk.vehicle >= 0 && !!g.vehicles[atk.vehicle] && !!VEHICLES[g.vehicles[atk.vehicle].type]?.air;
      if (inside && (kind === 'explosive' || atkAir) && hit.y > v.pos.y + def.size.y * 0.7) armor = A.top;
      else if (inside && kind === 'explosive' && hit.y < v.pos.y + 0.3 && !def.air) armor = Math.max(A.side, A.rear); // 차체 밑
      else if (Math.abs(fn) >= Math.abs(rn)) armor = fn > 0 ? A.front : A.rear;
      else armor = A.side;
    } else armor = A.side;
  }
  let mul = 1;
  if (kind !== 'explosive') {
    const base = v.type === 'mbt' || v.type === 'ifv' ? 0.05 : v.type === 'ltv' ? 0.3 : 0.25;
    mul = kind === 'ap' ? base * 3 : base;
  }
  let d = dmg * armor * mul;
  const diff = DIFFS[g.opts.diff];
  if (diff) {
    if (atk && atk.isPlayer) d *= diff.dmgDealt;
    if (v.seats.indexOf(g.player) >= 0) d *= diff.dmgTaken;
  }
  if (!(d > 0)) return;
  v.hp -= d;
  if (by >= 0) v.lastHurtBy = by;
  const kill = v.hp <= 0;
  const hp: Vec3 = hit ? { x: hit.x, y: hit.y, z: hit.z } : { x: v.pos.x, y: v.pos.y + 1, z: v.pos.z };
  emit(g, { k: 'vhit', v: v.id, by, dmg: d, pos: hp, kill });
  if (!kill) {
    if (v.hp < v.maxHp * 0.15) v.burning = true;
    return;
  }
  destroyVehicle(g, v, by >= 0 ? by : v.lastHurtBy, vt);
}

function destroyVehicle(g: Game, v: Vehicle, killer: number, vt: Team): void {
  const def = VEHICLES[v.type];
  v.alive = false;
  v.hp = 0;
  v.wreckT = 0;
  v.respawnT = def ? def.respawn : 60;
  v.burning = true;
  v.speed = 0;
  v.vel.x *= 0.3;
  v.vel.z *= 0.3;
  v.lockWarn = 0;
  const kS = killer >= 0 ? g.soldiers[killer] : undefined;
  const valid = !!kS && kS.team !== vt;
  const kid = valid && kS ? kS.id : -1;
  if (occupied(v)) {
    const ids = v.seats.slice();
    for (const id of ids) {
      if (id < 0) continue;
      const s = g.soldiers[id];
      if (s && s.state !== 'dead') killSoldier(g, s, kid, '차량 파괴', false);
    }
  }
  for (let i = 0; i < v.seats.length; i++) v.seats[i] = -1;
  if (valid && kS) {
    kS.vkills++;
    award(g, kS.id, 300, '차량 파괴');
  }
  emit(g, { k: 'vdestroyed', v: v.id, by: kid });
  const c: Vec3 = { x: v.pos.x, y: v.pos.y + (def && !def.air ? def.size.y * 0.5 : 0), z: v.pos.z };
  explode(g, c, 7, 75, kid, valid && kS ? kS.team : vt, '차량 폭발', { dmgVehicle: 60, wallDmg: 50, kind: 'vehicle' });
}

// ───────────────────────── 연막·표시 ─────────────────────────

export function smokeBlocks(g: Game, a: Vec3, b: Vec3): boolean {
  const sm = g.smokes;
  if (sm.length === 0) return false;
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const L2 = abx * abx + aby * aby + abz * abz;
  for (let i = 0; i < sm.length; i++) {
    const s = sm[i];
    if (s.life <= 0) continue;
    // 터진 직후 빠르게 퍼지고, 끝날 무렵 옅어진다
    const grow = s.max > 0 ? clamp((s.max - s.life) / 1.2 + 0.35, 0, 1) : 1;
    const fade = clamp(s.life / 2.5, 0, 1);
    const rr = s.r * 0.85 * grow * fade;
    if (rr <= 0.1) continue;
    let t = L2 > 1e-9 ? ((s.pos.x - a.x) * abx + (s.pos.y - a.y) * aby + (s.pos.z - a.z) * abz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = a.x + abx * t - s.pos.x, dy = a.y + aby * t - s.pos.y, dz = a.z + abz * t - s.pos.z;
    if (dx * dx + dy * dy + dz * dz < rr * rr) return true;
  }
  return false;
}

export function spotSoldier(g: Game, t: Soldier, by: number, secs: number): void {
  if (t.state === 'dead' || !(secs > 0)) return;
  const was = t.spotT > 0;
  if (secs > t.spotT) t.spotT = secs;
  if (by >= 0) core(g).spottedBy[t.id] = by;
  if (!was && by >= 0 && by === g.player) emit(g, { k: 'spot', target: t.id, by, vehicle: false });
}

// ───────────────────────── 세계 파괴 반영 ─────────────────────────

export function applyBreak(g: Game, r: BreakResult): void {
  if (!r) return;
  const w = g.world;
  const col = r.collapsed || [];
  const broken = r.broken || [];
  for (let i = 0; i < broken.length; i++) {
    const id = broken[i];
    const b = w.boxes[id];
    if (!b) continue;
    // 무너진 건물의 상자는 붕괴 이벤트 하나로 대신한다
    if (col.length && b.building >= 0 && col.indexOf(b.building) >= 0) continue;
    emit(g, {
      k: 'boxBroken', box: id, mat: b.mat,
      pos: { x: (b.min.x + b.max.x) * 0.5, y: (b.min.y + b.max.y) * 0.5, z: (b.min.z + b.max.z) * 0.5 },
    });
  }
  if (!col.length) return;
  const c = core(g);
  for (const bid of col) {
    const bd = w.buildings[bid];
    if (!bd) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity;
    for (const id of bd.boxes) {
      const b = w.boxes[id];
      if (!b || b.kind === 'rubble') continue;
      if (b.min.x < x0) x0 = b.min.x;
      if (b.max.x > x1) x1 = b.max.x;
      if (b.min.z < z0) z0 = b.min.z;
      if (b.max.z > z1) z1 = b.max.z;
      if (b.max.y > y1) y1 = b.max.y;
    }
    if (!(x1 > x0)) {
      // 상자 정보가 없으면 건물 치수로 (x, z 를 중심으로 본다)
      x0 = bd.x - bd.w / 2; x1 = bd.x + bd.w / 2; z0 = bd.z - bd.d / 2; z1 = bd.z + bd.d / 2;
      y1 = bd.y + bd.floors * bd.floorH;
    }
    const center: Vec3 = { x: (x0 + x1) * 0.5, y: bd.y + Math.max(1, (y1 - bd.y) * 0.5), z: (z0 + z1) * 0.5 };
    emit(g, { k: 'collapse', building: bid, pos: center });
    const ss = g.soldiers;
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      if (s.state === 'dead' || s.vehicle >= 0) continue;
      if (s.pos.x < x0 - 0.3 || s.pos.x > x1 + 0.3 || s.pos.z < z0 - 0.3 || s.pos.z > z1 + 0.3) continue;
      if (s.pos.y > y1 + 0.5 || s.pos.y < bd.y - 1.5) continue;
      const by = c.breakBy >= 0 && c.breakTeam >= 0 && s.team !== c.breakTeam ? c.breakBy : -1;
      hurt(g, s, 85, by, '붕괴', false, center, true);
    }
  }
}
