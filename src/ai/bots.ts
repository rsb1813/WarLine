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
import { angleDiff, clamp, damp, DEG, dirFrom, forwardXZ, rightXZ, wrapAngle, yawTo } from '../math';
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
  arrived: boolean; following: boolean; headAim: boolean; scanYaw: number; scanT: number; smoked: boolean;
  vReactT: number; gunBurst: number; gunPause: number;
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
    arrived: false, following: false, headAim: false, scanYaw: s.yaw, scanT: 0, smoked: false,
    vReactT: 0, gunBurst: 0, gunPause: 0,
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
function slotOf(s: Soldier, kinds: GadgetKind[], ready = true): number {
  for (let i = 0; i < 3; i++) {
    const gs = s.gadgets[i];
    if (!gs || kinds.indexOf(gs.kind) < 0) continue;
    if (!ready) return i;
    if (gs.cd <= 0 && (gs.uses > 0 || TOOLS.indexOf(gs.kind) >= 0)) return i;
  }
  return -1;
}

const vehDef = (v: Vehicle) => VEHICLES[v.type];
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

// ───────────────────────── 인지 ─────────────────────────

const candId: number[] = [];
const candD: number[] = [];
const T1 = tmpV(), T2 = tmpV();

function occupantTeam(g: Game, v: Vehicle): number {
  for (let i = 0; i < v.seats.length; i++) { const id = v.seats[i]; if (id >= 0 && g.soldiers[id]) return g.soldiers[id].team; }
  return -1;
}
function hostileVehicle(g: Game, s: Soldier, v: Vehicle): boolean {
  if (!v.alive) return false;
  const t = occupantTeam(g, v);
  return t >= 0 && t !== s.team;
}
function viewOrigin(g: Game, s: Soldier): Vec3 {
  if (s.vehicle >= 0) {
    const v = g.vehicles[s.vehicle];
    if (v) { const p = seatWorldPos(v, s.seat); p.y += 0.25; return p; }
  }
  return eyePos(s);
}
const canSee = (g: Game, a: Vec3, b: Vec3): boolean => lineOfSight(g.world, a, b) && !smokeBlocks(g, a, b);

/** 적 병사의 겨눌 점 (차량 노출 좌석이면 좌석 위치) */
function targetPoint(g: Game, o: Soldier, head: boolean, out: Vec3): Vec3 {
  if (o.vehicle >= 0) {
    const v = g.vehicles[o.vehicle];
    if (v) { const p = seatWorldPos(v, o.seat); out.x = p.x; out.y = p.y + (head ? 0.55 : 0.25); out.z = p.z; return out; }
  }
  if (head) { const h = headCenter(o); out.x = h.x; out.y = h.y; out.z = h.z; return out; }
  return chestOf(o, out);
}

function perceive(g: Game, s: Soldier, m: Mind): void {
  const eye = viewOrigin(g, s);
  const hurt = g.time - s.lastHurtT < 2.5;
  const blind = s.blindT > 0.3;
  const inVeh = s.vehicle >= 0;
  const fy = inVeh ? s.ctl.yaw : s.yaw;
  const fx = -Math.sin(fy), fz = -Math.cos(fy);
  const fovCos = inVeh ? -2 : 0.5; // 차량 승무원은 사방을 본다 (잠망경)
  const maxD = inVeh ? 260 : 180;
  candId.length = 0; candD.length = 0;
  let known = -1, knownD = 70;
  const ss = g.soldiers;
  for (let i = 0; i < ss.length; i++) {
    const o = ss[i];
    if (o.team === s.team || o.state !== 'alive') continue;
    if (o.vehicle >= 0) {
      const v = g.vehicles[o.vehicle], def = v ? vehDef(v) : undefined;
      if (!v || !def || !def.seats[o.seat] || !def.seats[o.seat].exposed) continue;
    }
    const dx = o.pos.x - eye.x, dz = o.pos.z - eye.z, d2 = dx * dx + dz * dz;
    if (d2 > maxD * maxD) continue;
    const d = Math.sqrt(d2);
    if (o.spotT > 0 && d < knownD) { knownD = d; known = o.id; }
    if (blind && d > 5) continue;
    if (!(d < 12 || hurt || o.id === m.tgt || dx * fx + dz * fz > fovCos * d)) continue;
    // 가까운 순으로 8개까지
    let k = candD.length;
    if (k >= 8 && d >= candD[7]) continue;
    if (k < 8) { candD.push(d); candId.push(o.id); } else k = 7;
    while (k > 0 && candD[k - 1] > d) { candD[k] = candD[k - 1]; candId[k] = candId[k - 1]; k--; }
    candD[k] = d; candId[k] = o.id;
  }
  let best = -1, bestS = Infinity, bestD = 0, nVis = 0, rays = 0, headOnly = false;
  for (let k = 0; k < candId.length && rays < 6; k++) {
    const o = ss[candId[k]], d = candD[k];
    rays++;
    const c = targetPoint(g, o, false, T1);
    let vis = lineOfSight(g.world, eye, c), ho = false;
    if (!vis) { const h = targetPoint(g, o, true, T2); vis = lineOfSight(g.world, eye, h); ho = vis; }
    if (vis && smokeBlocks(g, eye, c)) vis = false;
    if (!vis) continue;
    nVis++;
    let sc = d;
    if (o.id === s.lastHurtBy && hurt) sc -= 40;
    if (o.id === m.tgt) sc -= 15;
    if (o.ctl.fire && Math.abs(angleDiff(o.yaw, yawTo(o.pos, s.pos))) < 0.2) sc -= 10;
    if (o.state === 'alive' && o.isPlayer) sc += 2; // 사람을 특별히 노리지 않는다
    if (sc < bestS) { bestS = sc; best = o.id; bestD = d; headOnly = ho; }
  }
  // 차량
  const prevV = m.visV;
  m.visV = -1; m.visVD = 1e9;
  const vmax = 300;
  for (const v of g.vehicles) {
    if (!hostileVehicle(g, s, v)) continue;
    const dx = v.pos.x - eye.x, dz = v.pos.z - eye.z, d = hyp(dx, dz);
    if (d > vmax || d > m.visVD) continue;
    const def = vehDef(v);
    if (!(d < 25 || hurt || inVeh || (def && def.air) || dx * fx + dz * fz > fovCos * d)) continue;
    T1.x = v.pos.x; T1.y = v.pos.y + (def ? def.size.y * 0.55 : 1.5); T1.z = v.pos.z;
    if (!canSee(g, eye, T1)) continue;
    m.visV = v.id; m.visVD = d;
  }
  // 표적 갱신
  const df = DIFFS[g.opts.diff] ?? DIFFS.normal;
  if (m.visV >= 0 && m.visV !== prevV) m.vReactT = g.time + df.react * (1 + 0.6 * rnd(g));
  if (best >= 0) {
    const o = ss[best];
    if (best !== m.tgt || g.time - m.seenT > 2.5) {
      m.acqT = g.time;
      m.reactT = g.time + df.react * (0.75 + 0.6 * rnd(g)) + (bestD > 80 ? 0.15 : 0) + (s.blindT > 0 ? 0.4 : 0);
      const big = df.aimErr * DEG * 2.2;
      m.errY = m.errTY = gauss(g) * big; m.errP = m.errTP = gauss(g) * big * 0.5;
      m.headAim = rnd(g) < (g.opts.diff === 'hard' ? 0.35 : g.opts.diff === 'normal' ? 0.1 : 0);
    }
    m.tgt = best; m.vis = true; m.seenT = g.time;
    targetPoint(g, o, headOnly, m.lk);
    m.threatYaw = yawTo(s.pos, o.pos);
    // 오차: 같은 표적을 오래 볼수록 줄어든다, 움직이면 늘어난다
    const on = g.time - m.acqT;
    const shrink = clamp(1.7 - on * 0.42, g.opts.diff === 'hard' ? 0.35 : 0.5, 1.7);
    const ts = hyp(o.vel.x, o.vel.z), ms = hyp(s.vel.x, s.vel.z);
    const moveK = 1 + Math.min(0.6, ts / 10) + (ms > 1.5 ? 0.35 : 0) + (s.blindT > 0 ? 1 : 0);
    const sig = df.aimErr * DEG * shrink * moveK;
    m.errTY = gauss(g) * sig; m.errTP = gauss(g) * sig * 0.55;
    // 주변 무리
    let cl = 0;
    for (let k = 0; k < candId.length; k++) {
      const q = ss[candId[k]];
      if (q !== o && (q.pos.x - o.pos.x) ** 2 + (q.pos.z - o.pos.z) ** 2 < 36) cl++;
    }
    m.cluster = cl;
  } else {
    m.vis = false; m.cluster = 0;
    if (m.tgt >= 0) {
      const o = ss[m.tgt];
      if (!o || o.state !== 'alive' || g.time - m.seenT > 6) m.tgt = -1;
    }
  }
  m.nVis = nVis;
  m.known = known;
  if (hurt && !m.vis) { m.threatYaw = s.lastHurtYaw; m.alertUntil = g.time + 2; }
}

// ───────────────────────── 조준·사격 ─────────────────────────

const AIM = { yaw: 0, pitch: 0, dist: 0 };
const turnRate = (g: Game): number => (g.opts.diff === 'easy' ? 5 : g.opts.diff === 'hard' ? 10 : 7.5);
const turnGain = (g: Game): number => (g.opts.diff === 'easy' ? 9 : g.opts.diff === 'hard' ? 17 : 13);
const leadSkill = (g: Game): number => (g.opts.diff === 'easy' ? 0.55 : g.opts.diff === 'hard' ? 1 : 0.85);
const recoilComp = (g: Game): number => (g.opts.diff === 'easy' ? 0.2 : g.opts.diff === 'hard' ? 0.75 : 0.5);

/** 저각 탄도 해: 수평 거리 dx, 높이 차 dy, 속도 v, 중력 gg */
function ballistic(dx: number, dy: number, v: number, gg: number): number | null {
  if (gg < 1e-3) return Math.atan2(dy, dx);
  const v2 = v * v, disc = v2 * v2 - gg * (gg * dx * dx + 2 * dy * v2);
  if (disc < 0) return null;
  return Math.atan((v2 - Math.sqrt(disc)) / (gg * Math.max(0.1, dx)));
}

/** from 에서 tp(속도 tv)를 맞히는 yaw/pitch (앞지름·낙차) → AIM */
function solve(from: Vec3, tp: Vec3, tv: Vec3 | null, vel: number, grav: number, lead: number): typeof AIM {
  let dx = tp.x - from.x, dy = tp.y - from.y, dz = tp.z - from.z;
  const v = Math.max(1, vel);
  if (tv && lead > 0) {
    let t = hyp(dx, dy, dz) / v;
    for (let k = 0; k < 2; k++) {
      const ex = dx + tv.x * t * lead, ez = dz + tv.z * t * lead, ey = dy + tv.y * t * lead * 0.5;
      t = hyp(ex, ey, ez) / v;
      if (k === 1) { dx = ex; dy = ey; dz = ez; }
    }
  }
  const d = hyp(dx, dz);
  AIM.yaw = Math.atan2(-dx, -dz);
  let p = Math.atan2(dy, d);
  if (grav > 0) { const b = ballistic(d, dy, v, 9.81 * grav); p = b !== null ? b : Math.max(p, 0.7); }
  AIM.pitch = p;
  AIM.dist = hyp(d, dy);
  return AIM;
}

function lookAt(g: Game, m: Mind, dYaw: number, dPitch: number, rateMul: number, dt: number): void {
  const ey = angleDiff(m.yaw, dYaw), ep = dPitch - m.pitch;
  const k = damp(turnGain(g), dt), mx = turnRate(g) * rateMul * dt;
  m.yaw = wrapAngle(m.yaw + clamp(ey * k, -mx, mx));
  m.pitch = clamp(m.pitch + clamp(ep * k, -mx * 0.8, mx * 0.8), -1.4, 1.4);
}

function applyLook(g: Game, s: Soldier, m: Mind, c: Controls): void {
  const w = s.weapons[s.cur];
  const comp = s.held === 'weapon' && w ? recoilComp(g) : 0;
  c.yaw = wrapAngle(m.yaw - (w ? w.kickY * comp : 0));
  c.pitch = clamp(m.pitch - (w ? w.kickP * comp : 0), -1.45, 1.45);
}

/** 총 쏘기: 연발은 점사, 단발류는 눌렀다 떼기 */
function gunFire(g: Game, s: Soldier, m: Mind, c: Controls, dist: number, onAim: boolean, dt: number): void {
  const w = s.weapons[s.cur];
  c.fire = false;
  if (!w || !onAim || g.time < m.reactT || s.held !== 'weapon' || w.mag <= 0 || w.reloadT > 0 || s.swapT > 0) { m.burstT = 0; m.firePrev = false; return; }
  const cat = w.st.cat;
  if (cat === 'shotgun' && dist > 40) return;
  if (cat === 'pistol' && dist > 75) return;
  if ((cat === 'sniper' || cat === 'dmr') && dist > 25 && s.ads < 0.85) return;
  if (dist > 22 && s.ads < 0.5 && cat !== 'shotgun') return; // 멀면 정조준부터
  const easy = g.opts.diff === 'easy';
  const interval = 60 / Math.max(1, w.st.rpm);
  if (w.mode === 'auto') {
    if (m.burstT > 0) {
      c.fire = true; m.burstT -= dt;
      if (m.burstT <= 0) m.pauseT = (0.2 + rnd(g) * 0.3) * (easy ? 1.7 : 1) * (dist > 40 ? 1.3 : 1);
    } else if (m.pauseT > 0) m.pauseT -= dt;
    else {
      const n = dist > 70 ? 1 + Math.floor(rnd(g) * 2) : dist > 35 ? 2 + Math.floor(rnd(g) * 3) : 3 + Math.floor(rnd(g) * 6);
      m.burstT = n * interval - dt * 0.5;
      c.fire = true;
    }
  } else {
    const gap = (w.mode === 'bolt' ? 0.2 : dist > 60 ? 0.34 : dist > 25 ? 0.2 : 0.11) * (easy ? 1.6 : 1);
    if (m.firePrev) { m.firePrev = false; m.pulseT = g.time + gap + rnd(g) * 0.1; }
    else if (g.time >= m.pulseT && w.fireT <= 0) { c.fire = true; m.firePrev = true; }
  }
}

// ───────────────────────── 이동·경로 ─────────────────────────

function moveDir(c: Controls, yaw: number, dx: number, dz: number, k: number): void {
  const l = hyp(dx, dz);
  if (l < 1e-4 || k <= 0) { c.mx = 0; c.mz = 0; return; }
  dx /= l; dz /= l;
  const f = forwardXZ(yaw), r = rightXZ(yaw);
  c.mz = clamp((dx * f.x + dz * f.z) * k, -1, 1);
  c.mx = clamp((dx * r.x + dz * r.z) * k, -1, 1);
}

function requestPath(g: Game, st: AIState, s: Soldier, m: Mind, gx: number, gz: number): void {
  const nav = st.nav;
  const key = cellOf(nav, gx, gz);
  const ce = st.pcache.get(key);
  m.pathT = g.time;
  if (ce && g.time - ce.t < 12) {
    let bi = -1, bd = 144;
    const np = ce.pts.length >> 1;
    for (let i = 0; i < np; i++) {
      const d2 = (ce.pts[i * 2] - s.pos.x) ** 2 + (ce.pts[i * 2 + 1] - s.pos.z) ** 2;
      if (d2 < bd) { bd = d2; bi = i; }
    }
    if (bi >= 0 && lineWalkable(nav, s.pos.x, s.pos.z, ce.pts[bi * 2], ce.pts[bi * 2 + 1])) {
      m.path = ce.pts.slice(bi * 2); m.pi = 0; m.pgx = gx; m.pgz = gz; m.partial = false; m.repath = false;
      return;
    }
  }
  const r = findPath(nav, s.pos.x, s.pos.z, gx, gz, false, 4000);
  if (!r) { m.pathT = g.time - 0.4; return; } // 이번 프레임 예산 소진: 곧 다시
  m.path = r.pts; m.pi = 0; m.pgx = gx; m.pgz = gz; m.partial = r.partial; m.repath = false;
  if (!r.partial && r.pts.length >= 6) {
    st.pcache.set(key, { pts: r.pts, t: g.time });
    if (st.pcache.size > 96) { const first = st.pcache.keys().next(); if (!first.done) st.pcache.delete(first.value); }
  }
}

/** 목표점 (gx, gz) 쪽 경로를 따라가는 다음 경유점을 W 에 넣고, 목표까지 남은 직선 거리를 돌려준다 */
const W = { x: 0, z: 0 };
function pathStep(g: Game, st: AIState, s: Soldier, m: Mind, gx: number, gz: number, think: boolean): number {
  const far = hyp(gx - s.pos.x, gz - s.pos.z);
  if (think) {
    const moved = hyp(gx - m.pgx, gz - m.pgz) > (far > 40 ? 6 : 2.5);
    const atEnd = m.pi * 2 >= m.path.length;
    if ((moved || m.repath || (atEnd && m.partial && far > 2) || m.path.length === 0) && (moved || g.time - m.pathT > 0.8)) {
      if (far < 2.5) { m.path = [gx, gz]; m.pi = 0; m.pgx = gx; m.pgz = gz; m.partial = false; m.repath = false; }
      else requestPath(g, st, s, m, gx, gz);
    }
  }
  while (m.pi * 2 < m.path.length) {
    const wx = m.path[m.pi * 2], wz = m.path[m.pi * 2 + 1];
    const last = (m.pi + 1) * 2 >= m.path.length;
    if (hyp(wx - s.pos.x, wz - s.pos.z) < (last ? 0.7 : 1.4)) { m.pi++; continue; }
    break;
  }
  if (m.pi * 2 < m.path.length) { W.x = m.path[m.pi * 2]; W.z = m.path[m.pi * 2 + 1]; }
  else if (m.partial || m.path.length === 0) { W.x = gx; W.z = gz; }
  else { W.x = gx; W.z = gz; }
  return far;
}

/** 막힘 감지: 2초에 0.5m 못 가면 점프·옆걸음 후 경로 다시 */
function stuckCheck(g: Game, s: Soldier, m: Mind, c: Controls, wantMove: boolean, dt: number): void {
  if (!wantMove) { m.stuckT = 0; m.spX = s.pos.x; m.spZ = s.pos.z; return; }
  m.stuckT += dt;
  if (m.stuckT < 2) return;
  const moved = hyp(s.pos.x - m.spX, s.pos.z - m.spZ);
  if (moved < 0.5) {
    m.unstuckUntil = g.time + 0.7 + rnd(g) * 0.5;
    m.unstuckDir = rnd(g) < 0.5 ? -1 : 1;
    c.jump = true;
    m.repath = true;
    m.stuckN++;
    if (m.stuckN >= 2 && m.pi * 2 < m.path.length) m.pi++;
    if (m.stuckN >= 4) { m.hasHold = false; m.stuckN = 0; }
  } else m.stuckN = 0;
  m.stuckT = 0; m.spX = s.pos.x; m.spZ = s.pos.z;
}

function friendNear(g: Game, s: Soldier, p: Vec3, r: number): boolean {
  const r2 = r * r;
  for (const o of g.soldiers) {
    if (o.team !== s.team || o.state === 'dead') continue;
    if ((o.pos.x - p.x) ** 2 + (o.pos.z - p.z) ** 2 < r2) return true;
  }
  return false;
}

// ───────────────────────── 장비 쓰기 ─────────────────────────

function startUse(g: Game, s: Soldier, m: Mind, slotN: number, aim: Vec3 | null,
  o: { pitch?: number; hold?: boolean; ads?: boolean; dur?: number; targetV?: number } = {}): void {
  const slot = slotN as 0 | 1 | 2;
  const gs = s.gadgets[slot];
  if (!gs) return;
  const k = gs.kind;
  const thrown = slot === 2 || THROWN.indexOf(k) >= 0;
  const vel = gs.params.velocity ?? (thrown ? 18 : k === 'rocket' ? 80 : k === 'ugl' ? 75 : 60);
  const grav = thrown ? 1 : k === 'rocket' ? 0.25 : k === 'ugl' ? 1 : k === 'aa' ? 0.15 : 0;
  m.use = {
    slot, kind: k, until: g.time + (o.dur ?? 4), aim: aim ? { x: aim.x, y: aim.y, z: aim.z } : null,
    pitch: o.pitch ?? null, vel, grav, hold: !!o.hold, ads: !!o.ads, thrown, uses0: gs.uses, pressT: 0, fired: false,
    targetV: o.targetV ?? -1,
  };
  m.burstT = 0;
}

function endUse(s: Soldier, m: Mind, c: Controls): void {
  m.use = null;
  c.fire = false; m.firePrev = false;
  if (s.held === 'gadget') c.switchTo = s.cur;
}

/** 진행 중인 장비 사용. 이번 틱 조준·사격을 맡았으면 true */
function runUse(g: Game, s: Soldier, m: Mind, c: Controls, dt: number): boolean {
  const u = m.use;
  if (!u) return false;
  const gs = s.gadgets[u.slot];
  if (!gs || gs.kind !== u.kind || g.time > u.until) { endUse(s, m, c); return false; }
  const eye = eyePos(s);
  let dy = m.yaw, dp = m.pitch;
  let tv: Vec3 | null = null;
  if (u.targetV >= 0) {
    const v = g.vehicles[u.targetV];
    if (!v || !v.alive) { endUse(s, m, c); return false; }
    const def = vehDef(v);
    u.aim = u.aim ?? tmpV();
    u.aim.x = v.pos.x; u.aim.y = v.pos.y + (def ? def.size.y * 0.45 : 1); u.aim.z = v.pos.z;
    tv = v.vel;
  }
  if (u.aim) {
    const a = solve(eye, u.aim, tv, u.vel, u.grav, u.kind === 'aa' ? 0.3 : leadSkill(g));
    dy = a.yaw; dp = u.thrown ? a.pitch - 0.12 : a.pitch;
  }
  if (u.pitch !== null) dp = u.pitch;
  lookAt(g, m, dy, dp, 1.2, dt);
  const err = Math.abs(angleDiff(m.yaw, dy)) + Math.abs(dp - m.pitch);
  c.ads = u.ads;
  c.sprint = false;
  if (u.thrown) {
    // 투척물은 장비 키를 누르는 순간 지금 시선으로 던진다
    c.fire = false;
    if (gs.uses < u.uses0) { m.use = null; return true; }
    if (err < 0.06 && g.time > u.pressT && s.swapT <= 0) { c.gadget = u.slot; u.pressT = g.time + 0.5; }
    return true;
  }
  if (s.held !== 'gadget' || s.heldGadget !== u.slot) {
    if (u.fired) { m.use = null; return false; }
    c.fire = false;
    if (g.time > u.pressT) { c.gadget = u.slot; u.pressT = g.time + 0.8; }
    return true;
  }
  const ready = s.swapT <= 0 && gs.cd <= 0;
  if (u.hold) {
    c.fire = ready && err < 0.2;
    return true;
  }
  if (u.fired || gs.uses < u.uses0 || (m.firePrev && gs.cd > 0)) {
    u.fired = true;
    endUse(s, m, c);
    return true;
  }
  const adsOk = !u.ads || s.ads > 0.75;
  const lockOk = u.kind !== 'aa' || gs.active >= 1;
  const tol = u.kind === 'rocket' ? 0.03 : u.kind === 'aa' ? 0.08 : 0.07;
  if (ready && adsOk && lockOk && err < tol) {
    if (!m.firePrev) { c.fire = true; m.firePrev = true; } else { c.fire = false; m.firePrev = false; }
  } else { c.fire = false; m.firePrev = false; }
  return true;
}

/** 생각할 때 병과별 장비 쓰기 결정 */
function classActs(g: Game, st: AIState, s: Soldier, m: Mind): void {
  if (m.use || s.vehicle >= 0) return;
  const t = m.tgt >= 0 ? g.soldiers[m.tgt] : null;
  const dT = t ? hyp(t.pos.x - s.pos.x, t.pos.z - s.pos.z) : 1e9;
  // 아드레날린
  if (s.hp < 45 && g.time > m.stimT) {
    m.stimT = g.time + 4;
    const k = slotOf(s, ['stim']);
    if (k >= 0) { startUse(g, s, m, k, null, { dur: 2 }); return; }
  }
  // 대전차·대공
  if (m.visV >= 0 && dT > 14) {
    const v = g.vehicles[m.visV], def = v ? vehDef(v) : undefined;
    if (v && def) {
      if (def.air) {
        const k = slotOf(s, ['aa']);
        if (k >= 0 && m.visVD < (s.gadgets[k].params.range ?? 420)) { startUse(g, s, m, k, null, { ads: true, dur: 6, targetV: v.id }); return; }
      } else {
        const k = slotOf(s, ['rocket']);
        if (k >= 0 && m.visVD < 130 && m.visVD > 7) { startUse(g, s, m, k, null, { ads: true, dur: 4, targetV: v.id }); return; }
      }
    }
  }
  // 수류탄: 엄폐 뒤 적이나 무리
  if (t && g.time > m.nadeT && dT > 8 && dT < 30) {
    const hidden = !m.vis && g.time - m.seenT < 3.5;
    if (hidden || (m.cluster >= 1 && rnd(g) < 0.6)) {
      const k = slotOf(s, ['frag', 'impact', 'incendiary', 'flash']);
      if (k >= 0 && !friendNear(g, s, m.lk, 7)) {
        const aim = { x: m.lk.x, y: m.lk.y - 1, z: m.lk.z };
        startUse(g, s, m, k, aim, { dur: 1.8 });
        m.nadeT = g.time + 16 + rnd(g) * 10;
        return;
      }
    }
    m.nadeT = g.time + 3;
  }
  // 유탄
  if (t && g.time > m.uglT && dT > 15 && dT < 90 && (m.cluster >= 1 || (!m.vis && g.time - m.seenT < 3))) {
    m.uglT = g.time + 9 + rnd(g) * 8;
    const k = slotOf(s, ['ugl']);
    if (k >= 0 && !friendNear(g, s, m.lk, 6)) {
      const aim = { x: m.lk.x, y: m.lk.y - 0.8, z: m.lk.z };
      startUse(g, s, m, k, aim, { dur: 2.5 });
      return;
    }
  }
  if (m.vis || g.time - m.seenT < 2) return;
  // 조용할 때
  const fwdDown = -0.55;
  if (s.cls === 'support') {
    if (g.time > m.bagT) {
      m.bagT = g.time + 8;
      let hurt = 0, n = 0;
      for (const o of g.soldiers) {
        if (o.team !== s.team || o.state !== 'alive' || o.vehicle >= 0) continue;
        if ((o.pos.x - s.pos.x) ** 2 + (o.pos.z - s.pos.z) ** 2 > 225) continue;
        n++; if (o.hp < o.maxHp * 0.7) hurt++;
      }
      if (hurt >= 1 && (hurt >= 2 || s.hp < s.maxHp * 0.7)) {
        const k = slotOf(s, ['medbag']);
        if (k >= 0) { startUse(g, s, m, k, null, { pitch: fwdDown, dur: 2.5 }); m.bagT = g.time + 25 + rnd(g) * 10; return; }
      }
      if (g.time > m.ammoT && n >= 2) {
        let low = 0;
        for (const o of g.soldiers) {
          if (o.team !== s.team || o.state !== 'alive' || o.vehicle >= 0) continue;
          if ((o.pos.x - s.pos.x) ** 2 + (o.pos.z - s.pos.z) ** 2 > 225) continue;
          const w = o.weapons[0];
          if (w && w.reserve < w.st.mag * 1.5) low++;
        }
        const k = slotOf(s, ['ammobag']);
        if (k >= 0 && (low >= 1 || rnd(g) < 0.2)) { startUse(g, s, m, k, null, { pitch: fwdDown, dur: 2.5 }); m.ammoT = g.time + 45 + rnd(g) * 20; return; }
        m.ammoT = g.time + 10;
      }
    }
    if (m.task === 'hold' && !m.coverPlaced && rnd(g) < 0.08) {
      const k = slotOf(s, ['cover']);
      if (k >= 0) { m.coverPlaced = true; startUse(g, s, m, k, null, { pitch: -0.35, dur: 2.5 }); return; }
    }
  } else if (s.cls === 'recon') {
    const o = orderOf(g, st, s), f = g.flags[o.flag];
    const dF = f ? hyp(f.pos.x - s.pos.x, f.pos.z - s.pos.z) : 1e9;
    if (!m.beacon && dF < 90 && dF > 25) {
      const k = slotOf(s, ['beacon']);
      if (k >= 0) { m.beacon = true; startUse(g, s, m, k, null, { pitch: fwdDown, dur: 2.5 }); return; }
      m.beacon = true;
    }
    if (f && g.time > m.droneT && dF < 160) {
      m.droneT = g.time + 40 + rnd(g) * 25;
      const k = slotOf(s, ['drone']);
      if (k >= 0) { startUse(g, s, m, k, { x: f.pos.x, y: f.pos.y + 1, z: f.pos.z }, { dur: 2.5 }); return; }
    }
    if (f && g.time > m.sensorT && dF < 35) {
      m.sensorT = g.time + 35 + rnd(g) * 20;
      const k = slotOf(s, ['sensor']);
      if (k >= 0) { startUse(g, s, m, k, { x: f.pos.x, y: f.pos.y, z: f.pos.z }, { dur: 2.5, pitch: dF < 20 ? fwdDown : undefined }); return; }
    }
    if (m.task === 'hold' && !m.clay) {
      const k = slotOf(s, ['claymore']);
      m.clay = true;
      if (k >= 0) { startUse(g, s, m, k, null, { pitch: fwdDown, dur: 2.5 }); return; }
    }
  } else if (s.cls === 'engineer') {
    const o = orderOf(g, st, s), f = g.flags[o.flag];
    if (!m.mine && o.defend && f && hyp(f.pos.x - s.pos.x, f.pos.z - s.pos.z) < f.r + 30 && rnd(g) < 0.15) {
      m.mine = true;
      const k = slotOf(s, ['atmine']);
      if (k >= 0) { startUse(g, s, m, k, null, { pitch: fwdDown, dur: 2.5 }); return; }
    }
  }
}

// ───────────────────────── 판단 (생각할 때) ─────────────────────────

function tryBoard(g: Game, st: AIState, s: Soldier, m: Mind): void {
  const hq = g.world.hq[s.team];
  if (hyp(s.pos.x - hq.x, s.pos.z - hq.z) > 90) return;
  if (s.team === 0 && g.time < 6) return; // 사람이 먼저 고를 틈
  const pl = g.soldiers[g.player];
  let best: Vehicle | null = null, bd = 70;
  for (const v of g.vehicles) {
    if (!v.alive || v.team !== s.team) continue;
    const def = vehDef(v);
    if (!def) continue;
    const d = hyp(v.pos.x - s.pos.x, v.pos.z - s.pos.z);
    if (d > bd) continue;
    const ot = occupantTeam(g, v);
    if (ot >= 0 && ot !== s.team) continue;
    const vm = vmind(st, g, v);
    if (v.seats[0] < 0) {
      if (vm.claimBy >= 0 && vm.claimBy !== s.id && vm.claimUntil > g.time) continue;
      if (pl && pl.team === s.team && pl.state === 'alive' && pl.vehicle < 0 && hyp(pl.pos.x - v.pos.x, pl.pos.z - v.pos.z) < 35) continue;
    } else {
      // 운전수가 있으면 출발 전이고 무기 좌석이 비었을 때만
      if (Math.abs(v.speed) > 1 || d > 35) continue;
      let freeGun = false;
      for (let i = 1; i < v.seats.length; i++) if (v.seats[i] < 0 && def.seats[i] && (def.seats[i].weapon || v.type === 'ltv' || v.type === 'ifv')) freeGun = true;
      if (!freeGun) continue;
    }
    best = v; bd = d;
  }
  if (!best || rnd(g) > 0.6) return;
  const vm = vmind(st, g, best);
  if (best.seats[0] < 0) { vm.claimBy = s.id; vm.claimUntil = g.time + 25; }
  m.task = 'board'; m.vehId = best.id; m.vehUntil = g.time + 25; m.hasHold = false;
}

function objectiveGoal(g: Game, st: AIState, s: Soldier, m: Mind): void {
  const nav = st.nav;
  const o = orderOf(g, st, s);
  const f = g.flags[o.flag];
  if (!f) { m.goalX = s.pos.x; m.goalZ = s.pos.z; m.task = 'hold'; return; }
  const dF = hyp(f.pos.x - s.pos.x, f.pos.z - s.pos.z);
  const size = g.world.size;
  // 정찰병 셋 중 둘은 거점 뒤 40~80m 에서 지원
  if (s.cls === 'recon' && m.idx % 3 !== 0) {
    if (!m.hasHold || m.holdFlag !== o.flag || g.time > m.holdUntil) {
      const hq = g.world.hq[s.team];
      const a = Math.atan2(hq.x - f.pos.x, hq.z - f.pos.z) + (rnd(g) - 0.5) * 1.4;
      const r = 42 + rnd(g) * 36;
      let x = clamp(f.pos.x + Math.sin(a) * r, 4, size - 4), z = clamp(f.pos.z + Math.cos(a) * r, 4, size - 4);
      const c = nearestOpen(nav, cellOf(nav, x, z), 6, false);
      if (c >= 0) { x = cellX(nav, c); z = cellZ(nav, c); }
      m.holdX = x; m.holdZ = z; m.hasHold = true; m.holdFlag = o.flag; m.holdUntil = g.time + 30 + rnd(g) * 30; m.arrived = false;
      m.scanYaw = yawTo({ x, y: 0, z }, f.pos);
    }
    m.goalX = m.holdX; m.goalZ = m.holdZ;
    m.task = hyp(m.holdX - s.pos.x, m.holdZ - s.pos.z) < 2 ? 'hold' : 'obj';
    return;
  }
  if (m.hasHold && m.holdFlag === o.flag && g.time < m.holdUntil) {
    m.goalX = m.holdX; m.goalZ = m.holdZ;
    if (hyp(m.holdX - s.pos.x, m.holdZ - s.pos.z) < 1.5) {
      if (!m.arrived) {
        m.arrived = true;
        m.holdUntil = g.time + (o.defend ? 14 + rnd(g) * 18 : 7 + rnd(g) * 10);
        // 밖(거점 중심 반대쪽)을 본다
        m.scanYaw = hyp(m.holdX - f.pos.x, m.holdZ - f.pos.z) > 2 ? yawTo(f.pos, { x: m.holdX, y: 0, z: m.holdZ }) : s.yaw;
      }
      m.task = 'hold';
    } else m.task = 'obj';
    return;
  }
  if (dF < f.r + 30) {
    const pts = flagCover(g, st, o.flag);
    if (pts.length >= 2) {
      const k = Math.floor(rnd(g) * (pts.length >> 1));
      m.holdX = pts[k * 2]; m.holdZ = pts[k * 2 + 1];
    } else {
      const a = rnd(g) * Math.PI * 2, r = rnd(g) * f.r * 0.6;
      m.holdX = f.pos.x + Math.sin(a) * r; m.holdZ = f.pos.z + Math.cos(a) * r;
    }
    m.hasHold = true; m.holdFlag = o.flag; m.holdUntil = g.time + 45; m.arrived = false;
    m.goalX = m.holdX; m.goalZ = m.holdZ; m.task = 'obj';
    return;
  }
  m.hasHold = false; m.task = 'obj';
  // 분대장 근처에 (15m) 머물며 이동
  const l = leaderOf(g, st, s);
  if (l && l !== s) {
    const dl = hyp(l.pos.x - s.pos.x, l.pos.z - s.pos.z);
    if (m.following ? dl < 7 : dl > 15) m.following = !m.following;
    if (m.following && dl < 120) {
      const side = ((m.idx % 4) - 1.5) * 2.5;
      const r = rightXZ(l.yaw), fw = forwardXZ(l.yaw);
      m.goalX = clamp(l.pos.x + r.x * side - fw.x * 3, 2, size - 2);
      m.goalZ = clamp(l.pos.z + r.z * side - fw.z * 3, 2, size - 2);
      return;
    }
  } else m.following = false;
  m.goalX = f.pos.x; m.goalZ = f.pos.z;
}

function decide(g: Game, st: AIState, s: Soldier, m: Mind): void {
  const nav = st.nav;
  const t = m.tgt >= 0 ? g.soldiers[m.tgt] : null;
  const tD = t && m.vis ? hyp(t.pos.x - s.pos.x, t.pos.z - s.pos.z) : 1e9;
  // 물러나기: 체력이 낮고 적이 보이면 가까운 엄폐로
  if (m.task === 'retreat' && (g.time > m.retreatUntil || s.hp > s.maxHp * 0.85 || (!m.vis && g.time - m.seenT > 6 && s.hp > s.maxHp * 0.6))) m.task = 'obj';
  if (m.task !== 'retreat' && t && m.vis && s.hp < s.maxHp * 0.5 && g.time > m.retreatT && tD > 6) {
    m.retreatT = g.time + 5;
    const cov = findCover(nav, s.pos, eyePos(t), 14, 8);
    if (cov) { m.task = 'retreat'; m.holdX = cov.x; m.holdZ = cov.z; m.retreatUntil = g.time + 9; m.hasHold = false; }
  }
  if (m.task === 'retreat') { m.goalX = m.holdX; m.goalZ = m.holdZ; return; }

  // 소생
  if (m.task === 'revive') {
    const d = g.soldiers[m.reviveId];
    if (!d || d.state !== 'down' || hyp(d.pos.x - s.pos.x, d.pos.z - s.pos.z) > 50 || tD < 12) {
      const cl = st.revClaim.get(m.reviveId);
      if (cl && cl.by === s.id) st.revClaim.delete(m.reviveId);
      m.task = 'obj'; m.reviveId = -1;
    } else {
      st.revClaim.set(d.id, { by: s.id, until: g.time + 3 });
      m.goalX = d.pos.x; m.goalZ = d.pos.z;
      return;
    }
  }
  if (tD > 20) {
    const medic = s.cls === 'support';
    const R = medic ? 40 : 18;
    let best = -1, bd = R * R;
    for (const o of g.soldiers) {
      if (o.team !== s.team || o.state !== 'down' || o.id === s.id || o.vehicle >= 0) continue;
      if (!medic && o.squad !== s.squad) continue;
      const d2 = (o.pos.x - s.pos.x) ** 2 + (o.pos.z - s.pos.z) ** 2;
      if (d2 >= bd) continue;
      const cl = st.revClaim.get(o.id);
      if (cl && cl.by !== s.id && cl.until > g.time) continue;
      bd = d2; best = o.id;
    }
    if (best >= 0) {
      m.task = 'revive'; m.reviveId = best; m.smoked = false; m.hasHold = false;
      st.revClaim.set(best, { by: s.id, until: g.time + 3 });
      m.goalX = g.soldiers[best].pos.x; m.goalZ = g.soldiers[best].pos.z;
      return;
    }
  }

  // 수리
  if (m.task === 'repair') {
    const v = g.vehicles[m.repairV];
    if (!v || !v.alive || v.hp >= v.maxHp * 0.96 || m.vis || hyp(v.pos.x - s.pos.x, v.pos.z - s.pos.z) > 45 || Math.abs(v.speed) > 3) { m.task = 'obj'; m.repairV = -1; }
    else { m.goalX = v.pos.x; m.goalZ = v.pos.z; return; }
  } else if (s.cls === 'engineer' && !m.vis && slotOf(s, ['repair'], false) >= 0) {
    for (const v of g.vehicles) {
      if (!v.alive || v.team !== s.team || v.hp >= v.maxHp * 0.7 || Math.abs(v.speed) > 2) continue;
      if (hyp(v.pos.x - s.pos.x, v.pos.z - s.pos.z) > 30) continue;
      const def = vehDef(v);
      if (def && def.air && v.pos.y - heightAt(g.world, v.pos.x, v.pos.z) > 3) continue;
      m.task = 'repair'; m.repairV = v.id; m.hasHold = false;
      m.goalX = v.pos.x; m.goalZ = v.pos.z;
      return;
    }
  }

  // 탑승
  if (m.task === 'board') {
    const v = g.vehicles[m.vehId];
    if (!v || !v.alive || g.time > m.vehUntil || v.seats.indexOf(-1) < 0 || tD < 30 || (v.seats[0] >= 0 && Math.abs(v.speed) > 1.5)) {
      if (v) { const vm = vmind(st, g, v); if (vm.claimBy === s.id) vm.claimBy = -1; }
      m.task = 'obj'; m.vehId = -1;
    } else { m.goalX = v.pos.x; m.goalZ = v.pos.z; return; }
  } else if (g.time - m.spawnT < 3 && m.vehId < 0 && tD > 60) tryBoard(g, st, s, m);
  if ((m.task as Task) === 'board') return;

  objectiveGoal(g, st, s, m);
  // 홀드 중 가끔 둘러보기
  if (m.task === 'hold' && g.time > m.scanT) {
    m.scanT = g.time + 2.5 + rnd(g) * 3;
    m.scanYaw = wrapAngle(m.scanYaw + (rnd(g) - 0.5) * 1.2);
  }
  // 멀리 쏠 때 가끔 앉기
  if (m.vis && tD > 40 && rnd(g) < 0.25) m.crouchUntil = g.time + 1.5 + rnd(g) * 2;
}

// ───────────────────────── 보병 (매 틱) ─────────────────────────

function anyVehicleNear(g: Game, s: Soldier, r: number): boolean {
  for (const v of g.vehicles) {
    if (!v.alive) continue;
    const def = vehDef(v);
    const half = def ? Math.max(def.size.x, def.size.z) * 0.5 : 2;
    if (hyp(v.pos.x - s.pos.x, v.pos.z - s.pos.z) < r + half) return true;
  }
  return false;
}

function infantryTick(g: Game, st: AIState, s: Soldier, m: Mind, c: Controls, dt: number, think: boolean): void {
  c.fire = false; c.ads = false; c.sprint = false; c.interact = false; c.lift = 0;
  let stance: 'stand' | 'crouch' = 'stand';
  const w = s.weapons[s.cur];
  const eye = eyePos(s);
  const t = m.tgt >= 0 ? g.soldiers[m.tgt] : null;
  m.errY += (m.errTY - m.errY) * damp(3.5, dt);
  m.errP += (m.errTP - m.errP) * damp(3.5, dt);

  const far = pathStep(g, st, s, m, m.goalX, m.goalZ, think);
  let mdx = W.x - s.pos.x, mdz = W.z - s.pos.z;
  let moveK = far < (m.task === 'hold' ? 0.9 : 0.6) ? 0 : 1;
  let engaged = false, tDist = 1e9;
  let using = runUse(g, s, m, c, dt);

  // ── 과제별 마무리 동작 ──
  if (m.task === 'revive') {
    const d = g.soldiers[m.reviveId];
    if (d && d.state === 'down') {
      const dd = hyp(d.pos.x - s.pos.x, d.pos.z - s.pos.z);
      if (!using && !m.smoked && dd < 9 && g.time - m.seenT < 6) {
        m.smoked = true;
        const ks = slotOf(s, ['smoke']);
        if (ks >= 0) { startUse(g, s, m, ks, null, { pitch: -1.0, dur: 1.5 }); using = true; }
      }
      if (dd < 1.3) {
        moveK = 0; stance = 'crouch';
        if (!using) {
          const k = slotOf(s, ['defib']);
          if (k >= 0) { startUse(g, s, m, k, { x: d.pos.x, y: d.pos.y + 0.2, z: d.pos.z }, { dur: 2.5 }); using = true; }
          else if (!anyVehicleNear(g, s, 3)) { c.interact = true; lookAt(g, m, yawTo(s.pos, d.pos), -0.6, 1, dt); using = true; }
          else m.task = 'obj';
        }
      } else if (dd < 3) { mdx = d.pos.x - s.pos.x; mdz = d.pos.z - s.pos.z; moveK = 0.6; }
    }
  } else if (m.task === 'repair') {
    const v = g.vehicles[m.repairV], def = v ? vehDef(v) : undefined;
    if (v && def) {
      const reach = Math.max(def.size.x, def.size.z) * 0.5 + 1.6;
      const dv = hyp(v.pos.x - s.pos.x, v.pos.z - s.pos.z);
      if (dv < reach) {
        moveK = 0;
        if (!using) {
          const k = slotOf(s, ['repair']);
          if (k >= 0 && s.gadgets[k].active < 0.9) { startUse(g, s, m, k, { x: v.pos.x, y: v.pos.y + def.size.y * 0.5, z: v.pos.z }, { hold: true, dur: 3.5 }); using = true; }
        }
      } else if (dv < reach + 4) { mdx = v.pos.x - s.pos.x; mdz = v.pos.z - s.pos.z; moveK = 0.7; }
    }
  } else if (m.task === 'board') {
    const v = g.vehicles[m.vehId], def = v ? vehDef(v) : undefined;
    if (v && def) {
      const half = Math.max(def.size.x, def.size.z) * 0.5;
      const dv = hyp(v.pos.x - s.pos.x, v.pos.z - s.pos.z);
      if (dv < half + 6) { mdx = v.pos.x - s.pos.x; mdz = v.pos.z - s.pos.z; moveK = dv < half + 0.6 ? 0 : 1; }
      if (dv < half + 1.8 && g.time > m.enterT) { c.interact = true; m.enterT = g.time + 0.35; }
    }
  }

  // ── 교전 ──
  if (!using && t && m.vis && t.state === 'alive') {
    engaged = true;
    const tp = targetPoint(g, t, m.headAim, T1);
    const a = solve(eye, tp, t.vel, w ? w.st.velocity : 700, 1, leadSkill(g));
    tDist = a.dist;
    const dYaw = wrapAngle(a.yaw + m.errY), dPitch = a.pitch + m.errP;
    lookAt(g, m, dYaw, dPitch, 1, dt);
    const tol = Math.max(0.03, Math.atan(0.45 / Math.max(1, tDist))) * 1.5;
    const onAim = Math.abs(angleDiff(m.yaw, dYaw)) < tol && Math.abs(m.pitch - dPitch) < tol;
    const cat = w ? w.st.cat : 'ar';
    c.ads = tDist > 20 || cat === 'sniper' || cat === 'dmr';
    if (t.spotT <= 0 && g.time > m.spotT) { c.spot = true; m.spotT = g.time + (s.cls === 'recon' ? 1.5 : 4 + rnd(g) * 4); }
    if (m.task === 'hold' || m.task === 'retreat') {
      if (tDist < 25 && far < 2.5) {
        if (g.time > m.strafeT) { m.strafe = -m.strafe; m.strafeT = g.time + 0.5 + rnd(g) * 0.8; }
        const r = rightXZ(a.yaw);
        mdx = r.x * m.strafe * 0.7 + (m.holdX - s.pos.x) * 0.6; mdz = r.z * m.strafe * 0.7 + (m.holdZ - s.pos.z) * 0.6;
        moveK = 1;
      } else if (far < 2.5) { moveK = 0; stance = 'crouch'; }
    } else if (m.task !== 'revive') {
      if (tDist < 28) {
        if (g.time > m.strafeT) { m.strafe = -m.strafe; m.strafeT = g.time + 0.45 + rnd(g) * 0.9; }
        const r = rightXZ(a.yaw), l = hyp(mdx, mdz) || 1;
        const push = cat === 'shotgun' || cat === 'smg' ? 0.45 : 0;
        const fw = forwardXZ(a.yaw);
        mdx = r.x * m.strafe + (mdx / l) * 0.3 + fw.x * push; mdz = r.z * m.strafe + (mdz / l) * 0.3 + fw.z * push;
        moveK = 1;
      } else if (tDist < 80) {
        if (g.time < m.crouchUntil) { moveK = 0; stance = 'crouch'; } else moveK *= 0.45;
      } else moveK *= 0.7;
    }
    gunFire(g, s, m, c, tDist, onAim, dt);
    if (w && s.cur === 0 && s.held === 'weapon' && w.mag === 0 && tDist < 25 && s.swapT <= 0) {
      const p = s.weapons[1];
      if (p && p.mag > 0) { c.switchTo = 1; m.pistolT = g.time; }
    }
  } else if (!using) {
    m.burstT = 0; m.firePrev = false;
    if (t && g.time - m.seenT < 5) {
      // 마지막으로 본 곳을 미리 겨눈다
      const a = solve(eye, m.lk, null, 1000, 0, 0);
      lookAt(g, m, a.yaw, a.pitch, 0.8, dt);
      c.ads = a.dist > 25 && moveK < 0.5;
      moveK *= 0.8;
    } else if (g.time < m.alertUntil) {
      lookAt(g, m, m.threatYaw, 0, 1, dt);
    } else if (m.known >= 0 && g.soldiers[m.known] && moveK > 0) {
      const k = g.soldiers[m.known];
      const kd = hyp(k.pos.x - s.pos.x, k.pos.z - s.pos.z);
      if (kd < 40) { const a = solve(eye, chestOf(k, T2), null, 1000, 0, 0); lookAt(g, m, a.yaw, a.pitch, 0.7, dt); moveK *= 0.8; }
      else lookAt(g, m, yawTo(s.pos, { x: W.x, y: 0, z: W.z }), 0, 0.6, dt);
    } else if (moveK > 0 && hyp(mdx, mdz) > 0.2) {
      lookAt(g, m, Math.atan2(-mdx, -mdz), 0, 0.6, dt);
    } else if (m.task === 'hold' || m.task === 'retreat') {
      lookAt(g, m, m.scanYaw, 0, 0.4, dt);
    }
    if (m.task === 'hold' && moveK === 0 && g.time - m.seenT > 1) stance = 'crouch';
    if (m.task === 'retreat' && far < 1.5) stance = 'crouch';
  }

  // ── 막힘 풀기·이동 ──
  if (g.time < m.unstuckUntil && !engaged) {
    const l = hyp(mdx, mdz) || 1, ux = mdx / l, uz = mdz / l;
    mdx = -uz * m.unstuckDir - ux * 0.3; mdz = ux * m.unstuckDir - uz * 0.3;
    moveK = 1;
  }
  applyLook(g, s, m, c);
  moveDir(c, c.yaw, mdx, mdz, moveK);
  c.sprint = !engaged && !using && moveK >= 1 && far > 18 && stance === 'stand' && c.mz > 0.85 && m.nVis === 0 && g.time - m.seenT > 3;
  c.stance = stance;
  stuckCheck(g, s, m, c, moveK > 0.3 && !engaged && !using, dt);

  // ── 무기 손질 ──
  if (!using && s.held === 'weapon' && w && !m.vis) {
    if (w.reloadT <= 0 && w.mag < w.st.mag * 0.3 && w.reserve > 0 && s.swapT <= 0) c.reload = true;
    if (s.cur === 1 && g.time - m.seenT > 2.5 && g.time - m.pistolT > 2) c.switchTo = 0;
  }
  if (s.held === 'weapon' && s.cur === 1 && w && w.mag === 0 && s.weapons[0] && s.weapons[0].mag + s.weapons[0].reserve > 0) c.switchTo = 0;
  if (!m.use && s.held === 'gadget') c.switchTo = s.cur;
}

// ───────────────────────── 차량 ─────────────────────────

function vehiclePath(g: Game, st: AIState, v: Vehicle, vm: VMind, gx: number, gz: number, think: boolean): void {
  if (!think) return;
  const moved = hyp(gx - vm.pgx, gz - vm.pgz) > 5;
  const atEnd = vm.pi * 2 >= vm.path.length;
  if (!(moved || vm.path.length === 0 || (atEnd && vm.partial) || g.time - vm.pathT > 25)) return;
  if (!moved && g.time - vm.pathT < 1.5) return;
  const r = findPath(st.nav, v.pos.x, v.pos.z, gx, gz, true, 4000);
  if (!r) return;
  vm.path = r.pts; vm.pi = 0; vm.pgx = gx; vm.pgz = gz; vm.partial = r.partial; vm.pathT = g.time;
}

function driveGround(g: Game, st: AIState, s: Soldier, m: Mind, v: Vehicle, vm: VMind, c: Controls, dt: number, think: boolean): void {
  const o = orderOf(g, st, s);
  const f = g.flags[o.flag];
  if (!f) return;
  const tracked = v.type !== 'ltv';
  if (g.time - vm.boardT < 3.5) return; // 포수·승객 기다리기
  const dF = hyp(f.pos.x - v.pos.x, f.pos.z - v.pos.z);
  const stand = o.defend && f.owner === s.team ? Math.min(vm.standoff, 20) : vm.standoff;
  if (dF < stand) {
    // 화력 지원 위치에서 버티며 차체 앞을 위협 쪽으로
    const thr = m.visV >= 0 ? g.vehicles[m.visV] : m.tgt >= 0 && m.vis ? g.soldiers[m.tgt] : null;
    if (thr && tracked) {
      const err = angleDiff(v.yaw, yawTo(v.pos, thr.pos));
      c.mx = Math.abs(err) > 0.45 ? clamp(-err * 1.5, -1, 1) : 0;
    }
    vm.stuckT = 0;
    return;
  }
  vehiclePath(g, st, v, vm, f.pos.x, f.pos.z, think);
  while (vm.pi * 2 < vm.path.length && hyp(vm.path[vm.pi * 2] - v.pos.x, vm.path[vm.pi * 2 + 1] - v.pos.z) < 6) vm.pi++;
  const wx = vm.pi * 2 < vm.path.length ? vm.path[vm.pi * 2] : f.pos.x;
  const wz = vm.pi * 2 < vm.path.length ? vm.path[vm.pi * 2 + 1] : f.pos.z;
  const err = angleDiff(v.yaw, Math.atan2(-(wx - v.pos.x), -(wz - v.pos.z)));
  if (g.time < vm.revUntil) {
    c.mz = -0.85;
    c.mx = tracked ? clamp(-err * 1.5, -1, 1) : clamp(err * 1.5, -1, 1);
    return;
  }
  const ae = Math.abs(err);
  c.mx = clamp(-err * 2, -1, 1);
  c.mz = ae > 1.2 ? (tracked ? 0.1 : 0.4) : clamp(1 - ae * 0.55, 0.35, 1);
  if (dF - stand < 25) c.mz *= 0.6;
  if (c.mz > 0.3 && Math.abs(v.speed) < 0.8) {
    vm.stuckT += dt;
    if (vm.stuckT > 2.5) { vm.stuckT = 0; vm.revUntil = g.time + 1.4 + rnd(g); vm.pathT = -99; vm.path = []; }
  } else vm.stuckT = 0;
}

function buildRoute(g: Game, s: Soldier, v: Vehicle, vm: VMind): void {
  const size = g.world.size;
  const enemy = 1 - s.team;
  let fl = g.flags.filter((f) => f.owner === enemy);
  if (!fl.length) fl = g.flags.filter((f) => f.owner !== s.team || f.contested);
  if (!fl.length) fl = g.flags.slice();
  fl.sort((a, b) => hyp(a.pos.x - v.pos.x, a.pos.z - v.pos.z) - hyp(b.pos.x - v.pos.x, b.pos.z - v.pos.z));
  const pts: number[] = [];
  for (const f of fl.slice(0, 4)) {
    const a0 = rnd(g) * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k * Math.PI * 2) / 3;
      pts.push(clamp(f.pos.x + Math.sin(a) * 75, 25, size - 25), clamp(f.pos.z + Math.cos(a) * 75, 25, size - 25));
    }
  }
  vm.route = pts; vm.ri = 0; vm.routeT = g.time;
}

function flyHeli(g: Game, s: Soldier, m: Mind, v: Vehicle, vm: VMind, c: Controls, dt: number, think: boolean): void {
  const w = g.world;
  const gh = heightAt(w, v.pos.x, v.pos.z);
  const alt = v.pos.y - gh;
  if (vm.route.length === 0 || g.time - vm.routeT > 40) buildRoute(g, s, v, vm);
  const fw = forwardXZ(v.yaw);
  const ahead = Math.max(heightAt(w, v.pos.x + fw.x * 40, v.pos.z + fw.z * 40), heightAt(w, v.pos.x + fw.x * 80, v.pos.z + fw.z * 80));
  const ref = Math.max(gh, ahead);
  if (g.time - vm.boardT < 2.5) { c.yaw = v.yaw; return; }
  // 공격 대상 고르기
  let P: Vec3 | null = null;
  if (think && g.time > vm.attackCd && g.time > vm.attackUntil) {
    const tv = m.visV >= 0 ? g.vehicles[m.visV] : null;
    if ((tv && !vehDef(tv)?.air && m.visVD < 260) || (m.vis && m.cluster >= 1)) vm.attackUntil = g.time + 7;
  }
  if (g.time < vm.attackUntil) {
    const tv = m.visV >= 0 ? g.vehicles[m.visV] : null;
    if (tv && tv.alive && !vehDef(tv)?.air) P = { x: tv.pos.x, y: tv.pos.y + 1, z: tv.pos.z };
    else if (m.tgt >= 0 && g.time - m.seenT < 3) P = m.lk;
    if (!P) { vm.attackUntil = 0; vm.attackCd = g.time + 4; }
  } else if (vm.attackUntil > 0) { vm.attackUntil = 0; vm.attackCd = g.time + 10 + rnd(g) * 6; }
  let tx: number, tz: number, altT = vm.alt;
  const np = vm.route.length >> 1;
  if (P) { tx = P.x; tz = P.z; altT = 30; }
  else {
    tx = vm.route[vm.ri * 2]; tz = vm.route[vm.ri * 2 + 1];
    if (hyp(tx - v.pos.x, tz - v.pos.z) < 35) { vm.ri = (vm.ri + 1) % Math.max(1, np); tx = vm.route[vm.ri * 2]; tz = vm.route[vm.ri * 2 + 1]; }
  }
  const yT = ref + altT;
  let lift = clamp((yT - v.pos.y) * 0.2 - v.vel.y * 0.12, -1, 1);
  if (Math.abs(lift) < 0.06) lift = yT > v.pos.y ? 0.06 : -0.06;
  const want = Math.atan2(-(tx - v.pos.x), -(tz - v.pos.z));
  const err = angleDiff(v.yaw, want);
  const ae = Math.abs(err);
  c.yaw = want; c.pitch = 0;
  if (alt < 12 && !P) { c.lift = 1; c.mz = 0; c.mx = 0; return; } // 이륙
  c.lift = lift;
  c.mx = ae > 0.2 ? clamp(-err * 0.6, -0.5, 0.5) : 0;
  if (P) {
    const from = seatWorldPos(v, 0);
    const hd = hyp(P.x - from.x, P.z - from.z);
    const need = Math.atan2(P.y - from.y, hd);
    c.mz = hd < 55 ? -0.4 : ae < 0.5 ? clamp(-need / 0.35, 0.2, 1) : 0.3;
    if (hd < 55) { vm.attackUntil = 0; vm.attackCd = g.time + 8; }
    const ad = seatAimDir(v, 0);
    const dx = P.x - from.x, dy = P.y - from.y, dz = P.z - from.z, dl = hyp(dx, dy, dz) || 1;
    const cosE = (ad.x * dx + ad.y * dy + ad.z * dz) / dl;
    if (g.time > m.vReactT && dl < 260 && cosE > Math.cos(4 * DEG)) c.fire = true;
  } else {
    c.mz = ae < 0.5 ? 1 : ae < 1.2 ? 0.45 : 0.1;
  }
}

function gunnerTick(g: Game, s: Soldier, m: Mind, v: Vehicle, c: Controls, dt: number): void {
  const def = vehDef(v);
  const sd = def ? def.seats[s.seat] : undefined;
  if (!sd || !sd.weapon) return;
  const wd = VWEAPONS[sd.weapon];
  if (!wd) return;
  if (s.seat === 0 && !sd.turret) return; // 고정 무기 (헬기 로켓)는 조종에서
  const from = seatWorldPos(v, s.seat);
  const antiV = wd.kind === 'cannon' || wd.kind === 'atgm' || wd.kind === 'rockets';
  const tv = m.visV >= 0 ? g.vehicles[m.visV] : null;
  const tdef = tv ? vehDef(tv) : undefined;
  const tvOk = !!tv && tv.alive && !!tdef && (wd.kind !== 'mg' || tv.type === 'ltv' || tdef.air) && !((wd.kind === 'cannon' || wd.kind === 'atgm') && tdef.air);
  const ts = m.tgt >= 0 && m.vis ? g.soldiers[m.tgt] : null;
  let P: Vec3 | null = null, PV: Vec3 | null = null, react = m.reactT;
  if (tvOk && tv && tdef && (antiV || !ts || m.visVD < 60)) {
    P = { x: tv.pos.x, y: tv.pos.y + tdef.size.y * 0.5, z: tv.pos.z }; PV = tv.vel; react = m.vReactT;
  } else if (ts && !(antiV && wd.kind !== 'cannon' && wd.kind !== 'rockets')) {
    P = targetPoint(g, ts, false, T1); PV = ts.vel;
  }
  m.errY += (m.errTY - m.errY) * damp(3.5, dt);
  m.errP += (m.errTP - m.errP) * damp(3.5, dt);
  if (!P) {
    const base = sd.turret ? v.yaw + v.tYaw : v.yaw;
    lookAt(g, m, g.time - m.seenT < 4 ? yawTo(from, m.lk) : base, 0, 0.5, dt);
    c.yaw = m.yaw; c.pitch = m.pitch;
    m.gunBurst = 0;
    return;
  }
  const grav = wd.kind === 'mg' ? 1 : wd.kind === 'rockets' ? 0.15 : wd.kind === 'atgm' ? 0 : 0.4;
  const a = solve(from, P, PV, wd.velocity, grav, leadSkill(g));
  const dY = a.yaw + m.errY * 0.5, dP = a.pitch + m.errP * 0.5;
  lookAt(g, m, dY, dP, 1.3, dt);
  c.yaw = m.yaw; c.pitch = m.pitch;
  const ad = seatAimDir(v, s.seat), want = dirFrom(dY, dP);
  const cosE = ad.x * want.x + ad.y * want.y + ad.z * want.z;
  const tol = wd.kind === 'cannon' || wd.kind === 'atgm' ? 1 : wd.kind === 'autocannon' ? 2 : 3;
  const range = wd.kind === 'mg' ? 230 : 330;
  if (g.time < react || a.dist > range || cosE < Math.cos(tol * DEG)) { m.gunBurst = 0; return; }
  if (wd.kind === 'cannon' || wd.kind === 'atgm') { c.fire = true; return; }
  if (m.gunBurst > 0) { c.fire = true; m.gunBurst -= dt; if (m.gunBurst <= 0) m.gunPause = 0.25 + rnd(g) * 0.4; }
  else if (m.gunPause > 0) m.gunPause -= dt;
  else { m.gunBurst = 0.5 + rnd(g) * 0.8; c.fire = true; }
}

function vehicleTick(g: Game, st: AIState, s: Soldier, m: Mind, c: Controls, dt: number, think: boolean): void {
  const v = g.vehicles[s.vehicle];
  const def = v ? vehDef(v) : undefined;
  c.fire = false; c.ads = false; c.sprint = false; c.interact = false; c.mx = 0; c.mz = 0; c.lift = 0; c.stance = 'stand';
  if (!v || !def || !v.alive) return;
  const vm = vmind(st, g, v);
  if (m.inVeh !== s.vehicle) {
    m.inVeh = s.vehicle; m.yaw = s.ctl.yaw; m.pitch = s.ctl.pitch; vm.boardT = g.time; vm.hpHist = v.hp;
    m.task = 'obj'; m.use = null;
    if (vm.claimBy === s.id) vm.claimBy = -1;
  }
  const alt = v.pos.y - heightAt(g.world, v.pos.x, v.pos.z);
  // 대응책
  if (g.time > vm.hpT) {
    const drop = vm.hpHist - v.hp;
    vm.hpHist = v.hp; vm.hpT = g.time + 1.5;
    if (drop > v.maxHp * 0.12 && v.counterCd <= 0) c.counter = true;
  }
  if (v.lockWarn > 0.5 && v.counterCd <= 0) c.counter = true;
  // 내리기
  if (v.hp < v.maxHp * 0.2 && !(def.air && alt > 5)) { c.exit = true; return; }
  if (s.seat !== 0 && v.seats[0] < 0) c.seat = 0;
  const sd = def.seats[s.seat];
  if (s.seat === 0) {
    if (def.air) flyHeli(g, s, m, v, vm, c, dt, think);
    else {
      driveGround(g, st, s, m, v, vm, c, dt, think);
      if (!sd || !sd.weapon) { lookAt(g, m, v.yaw, 0, 0.5, dt); c.yaw = m.yaw; c.pitch = m.pitch; }
    }
  }
  if (sd && sd.weapon) gunnerTick(g, s, m, v, c, dt);
  else if (s.seat !== 0) {
    // 승객: 목표 가까이서 차가 서면 내린다
    lookAt(g, m, v.yaw, 0, 0.5, dt); c.yaw = m.yaw; c.pitch = m.pitch;
    const o = orderOf(g, st, s), f = g.flags[o.flag];
    const dF = f ? hyp(f.pos.x - v.pos.x, f.pos.z - v.pos.z) : 1e9;
    const slow = Math.abs(v.speed) < 1.5 && (!def.air || alt < 2.5);
    if (slow && g.time - vm.boardT > 5 && (dF < 70 || (g.time - vm.boardT > 40 && vm.stuckT > 1))) c.exit = true;
  }
}

// ───────────────────────── 매 스텝 ─────────────────────────

let claimSweep = 0;

export function updateBots(g: Game, dt: number): void {
  let st = STATE.get(g);
  if (!st) { initBots(g); st = STATE.get(g); if (!st) return; }
  navFrame(st.nav);
  if (g.time >= st.teams[0].next) commander(g, st, 0);
  if (g.time >= st.teams[1].next) commander(g, st, 1);
  if (g.time > claimSweep) {
    claimSweep = g.time + 10;
    for (const [k, v] of st.revClaim) if (v.until < g.time) st.revClaim.delete(k);
  }
  let thinkLeft = 18;
  const ss = g.soldiers;
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    if (s.isPlayer || s.id === g.player) continue;
    let m = s.ai as Mind | null;
    if (!m || typeof m !== 'object' || typeof m.idx !== 'number') { m = newMind(g, s); s.ai = m; }
    const c = s.ctl;
    if (s.state !== 'alive') {
      neutral(c);
      if (m.prev === 'alive' && m.reviveId >= 0) { const cl = st.revClaim.get(m.reviveId); if (cl && cl.by === s.id) st.revClaim.delete(m.reviveId); }
      m.prev = s.state;
      continue;
    }
    if (m.prev !== 'alive') { resetLife(g, s, m); m.prev = 'alive'; }
    clearEdges(c);
    m.think -= dt;
    let think = false;
    if (m.think <= 0 && thinkLeft > 0) {
      thinkLeft--;
      think = true;
      m.think = 0.2 + rnd(g) * 0.15;
      perceive(g, s, m);
      if (s.vehicle < 0) { classActs(g, st, s, m); decide(g, st, s, m); }
    }
    if (s.vehicle >= 0) vehicleTick(g, st, s, m, c, dt, think);
    else {
      if (m.inVeh >= 0) {
        m.inVeh = -1; m.yaw = s.yaw; m.pitch = s.pitch; m.path = []; m.pgx = 1e9; m.task = 'obj'; m.vehId = -1;
      }
      infantryTick(g, st, s, m, c, dt, think);
    }
  }
}
