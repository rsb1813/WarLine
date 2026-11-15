// 봇 두뇌: 팀 지휘(분대별 거점 목표), 인지(시야각·시선·연막·표시), 조준(반응 지연, 줄어드는 오차, 앞지름),
// 사격(점사·단발), 이동(A* 경로, 막힘 풀기, 엄폐), 병과 행동(소생·의료·탄약·수리·로켓·비컨·유탄),
// 차량(탑승, 운전, 포수, 헬기 순회). 봇은 사람과 똑같이 s.ctl 만 채운다.
import type { Controls, Game, GadgetKind, Soldier, Team, Vec3, Vehicle } from '../types';
import { DIFFS, VEHICLES, VWEAPONS } from '../defs';
import { heightAt, lineOfSight } from '../world';
import { rand } from '../sim/game';
import { smokeBlocks } from '../sim/damage';
import { seatAimDir, seatWorldPos } from '../sim/vehicles';
import { eyePos, headCenter } from '../sim/body';
import { angleDiff, clamp, damp, DEG, dirFrom, forwardXZ, pitchTo, rightXZ, wrapAngle, yawTo } from '../math';
import { cellOf, coverSpots, createNav, findCover, findPath, lineWalkable, nearestOpen, navFrame, cellX, cellZ } from './nav';
import type { Nav } from './nav';

// ───────────────────────── 상태 ─────────────────────────

interface Order { flag: number; defend: boolean }
interface TeamCmd { next: number; orders: Map<number, Order>; leaders: Map<number, number> }
interface VMind {
  claimBy: number; claimUntil: number;
  path: number[]; pi: number; pgx: number; pgz: number; pathT: number; partial: boolean;
  stuckT: number; revUntil: number; lastSpeedT: number;
  standoff: number; alt: number;
  route: number[]; ri: number; routeT: number;
  attackUntil: number; attackCd: number;
  hpHist: number; hpT: number; boardT: number;
}
interface AIState {
  nav: Nav;
  teams: [TeamCmd, TeamCmd];
  cover: Map<number, { pts: number[]; t: number; ver: number }>;
  pcache: Map<number, { pts: number[]; t: number }>;
  revClaim: Map<number, { by: number; until: number }>;
  vm: WeakMap<Vehicle, VMind>;
  thinkBudget: number;
}
const STATE = new WeakMap<Game, AIState>();

type Task = 'obj' | 'hold' | 'revive' | 'repair' | 'board' | 'retreat';
interface Use {
  slot: 0 | 1 | 2; kind: GadgetKind; until: number;
  aim: Vec3 | null; pitch: number | null; vel: number; grav: number;
  hold: boolean; ads: boolean; thrown: boolean; uses0: number; pressT: number; fired: boolean; targetV: number;
}
interface Mind {
  think: number; prev: string; inVeh: number;
  // 표적
  tgt: number; tgtV: number; vis: boolean; seenT: number; lk: Vec3; acqT: number; reactT: number;
  errY: number; errP: number; errTY: number; errTP: number;
  nVis: number; cluster: number; known: number; threatYaw: number; alertUntil: number;
  visV: number; visVD: number;
  // 조준
  yaw: number; pitch: number;
  // 사격
  burstT: number; pauseT: number; pulseT: number; firePrev: boolean;
  // 이동
  path: number[]; pi: number; pgx: number; pgz: number; pathT: number; partial: boolean; repath: boolean;
  goalX: number; goalZ: number;
  stuckT: number; spX: number; spZ: number; unstuckUntil: number; unstuckDir: number; stuckN: number;
  strafe: number; strafeT: number;
  // 행동
  task: Task; holdX: number; holdZ: number; holdUntil: number; hasHold: boolean; holdFlag: number;
  retreatUntil: number; retreatT: number;
  reviveId: number; repairV: number; vehId: number; vehUntil: number; enterT: number;
  nadeT: number; uglT: number; spotT: number; bagT: number; ammoT: number; sensorT: number; droneT: number; stimT: number;
  beacon: boolean; mine: boolean; clay: boolean; coverPlaced: boolean;
  use: Use | null; pistolT: number; crouchUntil: number; spawnT: number; idx: number;
}

const rnd = (g: Game): number => rand(g);
const gauss = (g: Game): number => (rnd(g) + rnd(g) + rnd(g) - 1.5) * 2;
const hyp = Math.hypot;
const tmpV = (): Vec3 => ({ x: 0, y: 0, z: 0 });

function newMind(g: Game, s: Soldier): Mind {
  return {
    think: rnd(g) * 0.3, prev: s.state, inVeh: s.vehicle,
    tgt: -1, tgtV: -1, vis: false, seenT: -99, lk: tmpV(), acqT: 0, reactT: 0,
    errY: 0, errP: 0, errTY: 0, errTP: 0,
    nVis: 0, cluster: 0, known: -1, threatYaw: 0, alertUntil: 0, visV: -1, visVD: 1e9,
    yaw: s.yaw, pitch: s.pitch,
    burstT: 0, pauseT: 0, pulseT: 0, firePrev: false,
    path: [], pi: 0, pgx: 1e9, pgz: 1e9, pathT: -99, partial: false, repath: false,
    goalX: s.pos.x, goalZ: s.pos.z,
    stuckT: 0, spX: s.pos.x, spZ: s.pos.z, unstuckUntil: 0, unstuckDir: 1, stuckN: 0,
    strafe: rnd(g) < 0.5 ? -1 : 1, strafeT: 0,
    task: 'obj', holdX: 0, holdZ: 0, holdUntil: 0, hasHold: false, holdFlag: -1,
    retreatUntil: 0, retreatT: 0,
    reviveId: -1, repairV: -1, vehId: -1, vehUntil: 0, enterT: 0,
    nadeT: g.time + 8 + rnd(g) * 12, uglT: g.time + 5 + rnd(g) * 8, spotT: g.time + rnd(g) * 3, bagT: g.time + 10 + rnd(g) * 10,
    ammoT: g.time + 20 + rnd(g) * 20, sensorT: g.time + 15 + rnd(g) * 15, droneT: g.time + 25 + rnd(g) * 20, stimT: 0,
    beacon: false, mine: false, clay: false, coverPlaced: false,
    use: null, pistolT: 0, crouchUntil: 0, spawnT: g.time, idx: s.id,
  };
}

function resetLife(g: Game, s: Soldier, m: Mind): void {
  m.tgt = -1; m.tgtV = -1; m.vis = false; m.seenT = -99; m.known = -1; m.visV = -1;
  m.yaw = s.yaw; m.pitch = s.pitch; m.errY = m.errP = m.errTY = m.errTP = 0;
  m.path = []; m.pi = 0; m.pgx = 1e9; m.pgz = 1e9; m.repath = false;
  m.stuckT = 0; m.spX = s.pos.x; m.spZ = s.pos.z; m.unstuckUntil = 0; m.stuckN = 0;
  m.task = 'obj'; m.hasHold = false; m.retreatUntil = 0; m.reviveId = -1; m.repairV = -1; m.vehId = -1;
  m.use = null; m.burstT = 0; m.pauseT = 0; m.firePrev = false; m.spawnT = g.time;
  m.beacon = false; m.mine = false; m.clay = false; m.coverPlaced = false;
  m.inVeh = s.vehicle;
}

function clearEdges(c: Controls): void {
  c.jump = false; c.reload = false; c.switchTo = -1; c.gadget = -1; c.spot = false;
  c.seat = -1; c.exit = false; c.fireMode = false; c.counter = false;
}
function neutral(c: Controls): void {
  clearEdges(c);
  c.mx = 0; c.mz = 0; c.fire = false; c.ads = false; c.sprint = false; c.interact = false; c.lift = 0;
}

const TOOLS: GadgetKind[] = ['repair', 'defib'];
const THROWN: GadgetKind[] = ['frag', 'smoke', 'flash', 'incendiary', 'impact'];
/** 그 종류 장비 칸 (ready=true 면 지금 쓸 수 있는 것만) */
function slotOf(s: Soldier, kinds: GadgetKind[], ready = true): -1 | 0 | 1 | 2 {
  for (let i = 0; i < 3; i++) {
    const gs = s.gadgets[i];
    if (!gs || kinds.indexOf(gs.kind) < 0) continue;
    if (!ready) return i as 0 | 1 | 2;
    if (gs.cd <= 0 && (gs.uses > 0 || TOOLS.indexOf(gs.kind) >= 0)) return i as 0 | 1 | 2;
  }
  return -1;
}

const vehDef = (v: Vehicle) => VEHICLES[v.type];
const occupied = (v: Vehicle): boolean => { for (let i = 0; i < v.seats.length; i++) if (v.seats[i] >= 0) return true; return false; };
const chestOf = (o: Soldier, out: Vec3): Vec3 => {
  out.x = o.pos.x; out.z = o.pos.z;
  out.y = o.state === 'down' || o.stance === 'prone' ? o.pos.y + 0.25 : o.pos.y + o.eyeH * 0.72;
  return out;
};

function vmind(st: AIState, g: Game, v: Vehicle): VMind {
  let vm = st.vm.get(v);
  if (!vm) {
    const def = vehDef(v);
    vm = {
      claimBy: -1, claimUntil: 0,
      path: [], pi: 0, pgx: 1e9, pgz: 1e9, pathT: -99, partial: false,
      stuckT: 0, revUntil: 0, lastSpeedT: 0,
      standoff: v.type === 'ltv' ? 6 + rnd(g) * 6 : v.type === 'ifv' ? 24 + rnd(g) * 12 : 34 + rnd(g) * 22,
      alt: 45 + rnd(g) * 22,
      route: [], ri: 0, routeT: -99,
      attackUntil: 0, attackCd: 0,
      hpHist: def ? v.hp : 0, hpT: 0, boardT: 0,
    };
    st.vm.set(v, vm);
  }
  return vm;
}

// ───────────────────────── 초기화 ─────────────────────────

export function initBots(g: Game): void {
  const nav = createNav(g.world);
  const mk = (): TeamCmd => ({ next: 0, orders: new Map(), leaders: new Map() });
  const st: AIState = {
    nav, teams: [mk(), mk()], cover: new Map(), pcache: new Map(), revClaim: new Map(),
    vm: new WeakMap(), thinkBudget: 0,
  };
  STATE.set(g, st);
  for (const s of g.soldiers) if (!s.isPlayer) s.ai = newMind(g, s);
  commander(g, st, 0);
  commander(g, st, 1);
}

// ───────────────────────── 팀 지휘 ─────────────────────────

function commander(g: Game, st: AIState, team: Team): void {
  const tc = st.teams[team];
  tc.next = g.time + 5;
  const flags = g.flags;
  if (!flags.length) return;
  const enemy = (1 - team) as Team;
  // 분대 중심
  const sq = new Map<number, { x: number; z: number; n: number; leader: number }>();
  let fx = 0, fz = 0, fn = 0;
  for (const s of g.soldiers) {
    if (s.team !== team) continue;
    let e = sq.get(s.squad);
    if (!e) { e = { x: 0, z: 0, n: 0, leader: -1 }; sq.set(s.squad, e); }
    if (s.state !== 'alive') continue;
    const p = s.vehicle >= 0 && g.vehicles[s.vehicle] ? g.vehicles[s.vehicle].pos : s.pos;
    e.x += p.x; e.z += p.z; e.n++;
    fx += p.x; fz += p.z; fn++;
    if (!s.isPlayer && s.vehicle < 0 && (e.leader < 0 || s.id < e.leader)) e.leader = s.id;
  }
  const hq = g.world.hq[team];
  if (fn > 0) { fx /= fn; fz /= fn; } else { fx = hq.x; fz = hq.z; }
  // 아군 앞선: 아군 거점 중 적 본부에 가장 가까운 것, 없으면 병사 중심
  const ehq = g.world.hq[enemy];
  let frontX = fx, frontZ = fz, bestE = Infinity;
  for (const f of flags) if (f.owner === team) {
    const d = hyp(f.pos.x - ehq.x, f.pos.z - ehq.z);
    if (d < bestE) { bestE = d; frontX = f.pos.x; frontZ = f.pos.z; }
  }
  if (bestE === Infinity) { frontX = (fx + hq.x) / 2; frontZ = (fz + hq.z) / 2; }

  const atk: number[] = [], need: number[] = [];
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    const d = hyp(f.pos.x - frontX, f.pos.z - frontZ);
    if (f.owner === team) {
      atk.push(-1e9);
      const losing = f.contested || f.n[enemy] > 0 || Math.abs(f.prog) < 0.9;
      need.push((losing ? 1 : 0) + (f.n[enemy] > f.n[team] ? 0.5 : 0) - d / 600);
    } else {
      atk.push((f.owner === enemy ? 1.0 : 1.3) - d / 260 + (f.n[team] > 0 ? 0.25 : 0) - Math.max(0, f.n[enemy] - f.n[team]) * 0.04);
      need.push(-1e9);
    }
  }
  const squads = [...sq.keys()].sort((a, b) => a - b);
  const assigned = new Array(flags.length).fill(0);
  const orders = new Map<number, Order>();
  const S = squads.length;
  // 방어: 위협받는 아군 거점
  const defFlags = flags.map((_, i) => i).filter((i) => need[i] > 0.2).sort((a, b) => need[b] - need[a]);
  const allOwned = atk.every((a) => a < -1e8);
  let nDef = allOwned ? S : Math.min(defFlags.length, Math.max(defFlags.length ? 1 : 0, Math.round(S * 0.25)));
  const free = new Set(squads);
  if (allOwned) {
    // 다 가졌으면 적 본부 쪽 거점부터 지킨다
    const order = flags.map((_, i) => i).sort((a, b) => hyp(flags[a].pos.x - ehq.x, flags[a].pos.z - ehq.z) - hyp(flags[b].pos.x - ehq.x, flags[b].pos.z - ehq.z));
    let k = 0;
    for (const q of squads) { orders.set(q, { flag: order[k % order.length], defend: true }); k++; }
    free.clear();
    nDef = 0;
  }
  for (let k = 0; k < defFlags.length && nDef > 0; k++, nDef--) {
    const fi = defFlags[k], f = flags[fi];
    let best = -1, bd = Infinity;
    for (const q of free) {
      const e = sq.get(q)!;
      if (e.n === 0) continue;
      const prev = tc.orders.get(q);
      const d = hyp(e.x / e.n - f.pos.x, e.z / e.n - f.pos.z) - (prev && prev.flag === fi ? 80 : 0);
      if (d < bd) { bd = d; best = q; }
    }
    if (best >= 0) { orders.set(best, { flag: fi, defend: true }); free.delete(best); assigned[fi]++; }
  }
  for (const q of squads) {
    if (!free.has(q)) continue;
    const e = sq.get(q)!;
    const cx = e.n ? e.x / e.n : hq.x, cz = e.n ? e.z / e.n : hq.z;
    const prev = tc.orders.get(q);
    let best = -1, bs = -Infinity;
    for (let i = 0; i < flags.length; i++) {
      if (atk[i] < -1e8) continue;
      const sc = atk[i] - assigned[i] * 0.45 + (prev && prev.flag === i && !prev.defend ? 0.3 : 0) - hyp(cx - flags[i].pos.x, cz - flags[i].pos.z) / 380;
      if (sc > bs) { bs = sc; best = i; }
    }
    if (best < 0) best = defFlags.length ? defFlags[0] : 0;
    orders.set(q, { flag: best, defend: flags[best].owner === team });
    assigned[best]++;
  }
  tc.orders = orders;
  tc.leaders.clear();
  for (const [q, e] of sq) tc.leaders.set(q, e.leader);
}

function orderOf(g: Game, st: AIState, s: Soldier): Order {
  const tc = st.teams[s.team];
  let o = tc.orders.get(s.squad);
  if (!o) { o = { flag: 0, defend: false }; tc.orders.set(s.squad, o); tc.next = Math.min(tc.next, g.time + 0.5); }
  const f = g.flags[o.flag];
  // 공격 목표를 이미 가졌으면 지휘를 앞당긴다
  if (f && !o.defend && f.owner === s.team && !f.contested && Math.abs(f.prog) > 0.99) tc.next = Math.min(tc.next, g.time + 0.7);
  return o;
}

function leaderOf(g: Game, st: AIState, s: Soldier): Soldier | null {
  const tc = st.teams[s.team];
  let id = tc.leaders.get(s.squad);
  let l = id !== undefined && id >= 0 ? g.soldiers[id] : undefined;
  if (!l || l.state !== 'alive' || l.vehicle >= 0) {
    id = -1;
    for (const o of g.soldiers) if (o.team === s.team && o.squad === s.squad && !o.isPlayer && o.state === 'alive' && o.vehicle < 0) { id = o.id; break; }
    tc.leaders.set(s.squad, id);
    l = id >= 0 ? g.soldiers[id] : undefined;
  }
  return l ?? null;
}

function flagCover(g: Game, st: AIState, fi: number): number[] {
  const f = g.flags[fi];
  let e = st.cover.get(fi);
  if (!e || (e.ver !== st.nav.version && g.time - e.t > 15)) {
    e = { pts: coverSpots(st.nav, f.pos.x, f.pos.z, Math.max(6, f.r * 0.85), 40, () => rnd(g)), t: g.time, ver: st.nav.version };
    st.cover.set(fi, e);
  }
  return e.pts;
}
