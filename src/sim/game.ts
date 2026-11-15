// sim-core: 판 만들기, 고정 스텝 진행, 배치·출현 지점, 점령·티켓·종료
import type {
  ClassId, Controls, Flag, GadgetPick, Game, GameOpts, Loadout, Placed, Side, Soldier, SpawnOption, Team, Vec3, Vehicle, WeaponPick,
} from '../types';
import { CLASSES, NAMES, PRIMARY_IDS, SIZES, VEHICLES, WEAPONS, defaultAttachments } from '../defs';
import { defaultLoadout } from '../profile';
import { boxesNear, collideBody, floorAt, genWorld, heightAt, inWater, lineOfSight } from '../world';
import { DEG, clamp, damp, dirFrom, distXZ, forwardXZ, rightXZ, yawTo } from '../math';
import { BODY, SPEED, eyePos } from './body';
import { updateSoldier } from './soldier';
import { makeWeaponState, updateProjectiles, updateWeapons } from './weapons';
import { makeGadgetState, updateGadgets, updatePlaced } from './gadgets';
import { createVehicles, enterVehicle, updateVehicles } from './vehicles';
import { initBots, updateBots } from '../ai/bots';
import { finalizeDown, reviveSoldier, smokeBlocks, spotSoldier } from './damage';
import { award, core, emit, occupied, rand, vehicleTeam } from './core-util';

export { award, emit, rand, soldierById } from './core-util';

const MATCH_LIMIT = 20 * 60;
const SPOT_RANGE = 250;
const COS_SPOT = Math.cos(7 * DEG);
const REVIVE_R = 1.8;

// ───────────────────────── 만들기 ─────────────────────────

function makeControls(yaw: number): Controls {
  return {
    mx: 0, mz: 0, yaw, pitch: 0,
    fire: false, ads: false, sprint: false, jump: false,
    stance: 'stand', reload: false, switchTo: -1, gadget: -1,
    interact: false, spot: false, seat: -1, exit: false, fireMode: false,
    lift: 0, counter: false,
  };
}

function cloneLoadout(lo: Loadout): Loadout {
  const w = (p: WeaponPick): WeaponPick => ({ id: p.id, att: { ...p.att } });
  const d = (p: GadgetPick): GadgetPick => ({ id: p.id, variant: p.variant });
  return { primary: w(lo.primary), secondary: w(lo.secondary), gadget1: d(lo.gadget1), gadget2: d(lo.gadget2), throwable: d(lo.throwable) };
}

const SIG_CACHE = new Map<ClassId, string[]>();
function signatureWeapons(cls: ClassId): string[] {
  let ids = SIG_CACHE.get(cls);
  if (!ids) {
    const sig = CLASSES[cls]?.signature ?? [];
    ids = PRIMARY_IDS.filter((id) => { const w = WEAPONS[id]; return !!w && sig.indexOf(w.cat) >= 0; });
    SIG_CACHE.set(cls, ids);
  }
  return ids;
}

/** 봇 로드아웃: 기본 로드아웃 + 숙련 분류 주무기 중 하나 */
function botLoadout(g: Game, cls: ClassId): Loadout {
  const lo = cloneLoadout(defaultLoadout(cls));
  const ids = signatureWeapons(cls);
  if (ids.length) {
    const id = ids[Math.floor(rand(g) * ids.length) % ids.length];
    lo.primary = { id, att: defaultAttachments(id) };
  }
  return lo;
}

const CLASS_MIX: [ClassId, number][] = [['assault', 0.35], ['engineer', 0.25], ['support', 0.25], ['recon', 0.15]];

function randomClass(g: Game): ClassId {
  let r = rand(g);
  for (const [c, p] of CLASS_MIX) { if (r < p) return c; r -= p; }
  return 'assault';
}

/** n 명 봇 병과 배분 (비율 맞춘 뒤 섞기) */
function classMix(g: Game, n: number): ClassId[] {
  const out: ClassId[] = [];
  const counts = CLASS_MIX.map(([, p]) => Math.floor(n * p));
  let left = n - counts.reduce((a, b) => a + b, 0);
  // 남는 자리는 비율 높은 순서로
  for (let i = 0; left > 0; i = (i + 1) % counts.length, left--) counts[i]++;
  CLASS_MIX.forEach(([c], i) => { for (let k = 0; k < counts[i]; k++) out.push(c); });
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand(g) * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

function shuffled<T>(g: Game, a: T[]): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand(g) * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

function makeSoldier(id: number, team: Team, squad: number, name: string, cls: ClassId, lo: Loadout, isPlayer: boolean, pos: Vec3, yaw: number): Soldier {
  const hp = CLASSES[cls]?.hp ?? 100;
  return {
    id, team, squad, name, cls, isPlayer,
    pos: { x: pos.x, y: pos.y, z: pos.z }, vel: { x: 0, y: 0, z: 0 }, yaw, pitch: 0,
    stance: 'stand', eyeH: BODY.eye.stand, sprinting: false, sliding: 0, onGround: true,
    hp, maxHp: hp, state: 'alive',
    downT: 0, deadT: 0, respawnT: 0, protect: 0,
    loadout: lo,
    weapons: [makeWeaponState(lo.primary, cls), makeWeaponState(lo.secondary, cls)], cur: 0,
    held: 'weapon', heldGadget: 0,
    gadgets: [makeGadgetState(lo.gadget1), makeGadgetState(lo.gadget2), makeGadgetState(lo.throwable)],
    ads: 0, swapT: 0,
    vehicle: -1, seat: -1,
    lastHurtT: -999, lastHurtBy: -1, lastHurtYaw: 0,
    spotT: 0, reviving: -1, reviveProg: 0, blindT: 0, stimT: 0,
    prevInteract: false, interactPressed: false,
    kills: 0, deaths: 0, assists: 0, revives: 0, score: 0, caps: 0, vkills: 0, heads: 0,
    dmgFrom: {},
    ctl: makeControls(yaw),
    ai: null,
    anim: { walk: 0, fireT: 0, reloadT: 0, throwT: 0, hitT: 0 },
    stepAcc: 0,
  };
}

export function createGame(o: GameOpts): Game {
  const size = SIZES[o.size];
  const world = genWorld(o.map, size.flags);
  const other: Side = o.side === 'us' ? 'ru' : 'us';
  const seed = (o.seed ?? Math.floor(Math.random() * 4294967296)) >>> 0;
  const g: Game = {
    opts: o, world,
    time: 0, limit: MATCH_LIMIT,
    tickets: [size.tickets, size.tickets], maxTickets: size.tickets,
    soldiers: [], vehicles: [], projectiles: [], placed: [], smokes: [], flags: [],
    player: 0, playerNeedsDeploy: true,
    events: [], over: null,
    sides: [o.side, other],
    seed: seed || 1, nextId: 1,
  };

  g.flags = world.flags.map((f): Flag => ({
    id: f.id, name: f.name, pos: { x: f.x, y: heightAt(world, f.x, f.z), z: f.z }, r: f.r,
    owner: -1, prog: 0, n: [0, 0], contested: false,
  }));

  const per = size.perTeam;
  const center: Vec3 = { x: world.size / 2, y: 0, z: world.size / 2 };
  for (let ti = 0; ti < 2; ti++) {
    const team = ti as Team;
    const pool = shuffled(g, NAMES[g.sides[team]] ?? []);
    const classes = classMix(g, team === 0 ? per - 1 : per);
    const hq = world.hq[team];
    let bi = 0;
    for (let i = 0; i < per; i++) {
      const id = g.soldiers.length;
      const isPlayer = team === 0 && i === 0;
      const squad = team * 100 + Math.floor(i / 4);
      const cls: ClassId = isPlayer ? o.playerCls : (classes[bi++] ?? randomClass(g));
      const lo = isPlayer ? cloneLoadout(o.loadouts[cls] ?? defaultLoadout(cls)) : botLoadout(g, cls);
      let name = '나';
      if (!isPlayer) {
        const k = i - (team === 0 ? 1 : 0);
        name = pool.length ? pool[k % pool.length] + (k >= pool.length ? ` ${Math.floor(k / pool.length) + 1}` : '') : `병사 ${k + 1}`;
      }
      const yaw = yawTo(hq, center);
      g.soldiers.push(makeSoldier(id, team, squad, name, cls, lo, isPlayer, hq, yaw));
    }
  }
  core(g);

  // 봇은 본부에 바로 배치, 사람은 배치 화면
  const p = g.soldiers[g.player];
  for (const s of g.soldiers) {
    if (s.isPlayer) continue;
    deployInternal(g, s, hqOption(g, s.team, true), s.cls, s.loadout, true);
    const yaw = yawTo(s.pos, center);
    s.yaw = yaw;
    s.ctl.yaw = yaw;
  }
  p.state = 'dead';
  p.hp = 0;
  p.respawnT = 0;
  p.deadT = 100; // 처음엔 시체를 그리지 않게
  p.pos = { x: world.hq[0].x, y: floorAt(world, world.hq[0].x, heightAt(world, world.hq[0].x, world.hq[0].z) + 1, world.hq[0].z, BODY.radius), z: world.hq[0].z };
  g.playerNeedsDeploy = true;

  createVehicles(g);
  initBots(g);
  g.events.length = 0;
  emit(g, { k: 'msg', text: '전투 개시 — 거점을 점령해 적 티켓을 깎으십시오', tone: 'info' });
  return g;
}

// ───────────────────────── 진행 ─────────────────────────

export function stepGame(g: Game, dt: number): void {
  if (g.over) return;
  g.time += dt;

  updateBots(g, dt);

  const ss = g.soldiers;
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    const it = s.ctl.interact;
    s.interactPressed = it && !s.prevInteract;
    s.prevInteract = it;
  }

  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    if (s.state === 'alive') {
      if (s.vehicle < 0) updateSoldier(g, s, dt);
      if (s.state === 'alive') {
        updateWeapons(g, s, dt);
        updateGadgets(g, s, dt);
      }
    }
    if (s.ctl.spot) {
      s.ctl.spot = false;
      if (s.state === 'alive' && s.blindT <= 0) doSpot(g, s);
    }
  }

  updateVehicles(g, dt);
  updateProjectiles(g, dt);
  updatePlaced(g, dt);

  // 연막
  const sm = g.smokes;
  let j = 0;
  for (let i = 0; i < sm.length; i++) {
    const k = sm[i];
    k.life -= dt;
    if (k.life > 0) sm[j++] = k;
  }
  sm.length = j;

  updateLives(g, dt);

  for (const v of g.vehicles) if (v.spotT > 0) v.spotT = Math.max(0, v.spotT - dt);

  updateFlags(g, dt);
  updateTickets(g, dt);
}

// ───────────────────────── 표시 ─────────────────────────

interface SpotCand { c: number; p: Vec3; s: Soldier | null; v: Vehicle | null }
const spotCands: SpotCand[] = [];

function doSpot(g: Game, s: Soldier): void {
  const eye = eyePos(s);
  const dir = s.vehicle >= 0 ? dirFrom(s.ctl.yaw, s.ctl.pitch) : dirFrom(s.yaw, s.pitch);
  const R2 = SPOT_RANGE * SPOT_RANGE;
  spotCands.length = 0;
  for (const t of g.soldiers) {
    if (t.team === s.team || t.state !== 'alive' || t.vehicle >= 0) continue;
    const p: Vec3 = { x: t.pos.x, y: t.pos.y + (t.stance === 'prone' ? 0.3 : t.eyeH * 0.8), z: t.pos.z };
    const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > R2 || d2 < 0.25) continue;
    const c = (dx * dir.x + dy * dir.y + dz * dir.z) / Math.sqrt(d2);
    if (c >= COS_SPOT) spotCands.push({ c, p, s: t, v: null });
  }
  for (const v of g.vehicles) {
    if (!v.alive || !occupied(v) || vehicleTeam(g, v) === s.team) continue;
    const def = VEHICLES[v.type];
    const p: Vec3 = { x: v.pos.x, y: v.pos.y + (def && !def.air ? def.size.y * 0.5 : 0), z: v.pos.z };
    const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > R2 * 1.4 || d2 < 1) continue;
    const d = Math.sqrt(d2);
    const half = def ? Math.max(def.size.x, def.size.z) * 0.5 : 3;
    const lim = Math.cos(Math.min(0.6, 7 * DEG + Math.atan(half / d)));
    const c = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
    // 차량은 크기만큼 원뿔을 넓혀 주고, 같은 각도면 병사보다 조금 뒤로
    if (c >= lim) spotCands.push({ c: c - (1 - lim) * 0.25, p, s: null, v });
  }
  if (!spotCands.length) return;
  spotCands.sort((a, b) => b.c - a.c);
  const secs = s.cls === 'recon' ? 9 : 6;
  const n = Math.min(5, spotCands.length);
  for (let i = 0; i < n; i++) {
    const k = spotCands[i];
    if (!lineOfSight(g.world, eye, k.p) || smokeBlocks(g, eye, k.p)) continue;
    if (k.s) {
      const was = k.s.spotT > 0;
      spotSoldier(g, k.s, s.id, secs);
      if (was && s.isPlayer) emit(g, { k: 'spot', target: k.s.id, by: s.id, vehicle: false });
    } else if (k.v) {
      const was = k.v.spotT > 0;
      k.v.spotT = Math.max(k.v.spotT, secs + 2);
      if (s.isPlayer || !was) emit(g, { k: 'spot', target: k.v.id, by: s.id, vehicle: true });
    }
    break;
  }
  spotCands.length = 0;
}

// ───────────────────────── 생명 주기 ─────────────────────────

const downed: Soldier[] = [];

function bodyFall(g: Game, s: Soldier, dt: number, h: number): void {
  if (s.vehicle >= 0) return;
  const k = damp(s.onGround ? 8 : 0.4, dt);
  s.vel.x -= s.vel.x * k;
  s.vel.z -= s.vel.z * k;
  if (s.onGround && Math.abs(s.vel.x) + Math.abs(s.vel.z) < 0.02 && s.vel.y <= 0) { s.vel.x = 0; s.vel.z = 0; s.vel.y = 0; return; }
  s.vel.y -= SPEED.gravity * dt;
  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  s.pos.z += s.vel.z * dt;
  const r = collideBody(g.world, s.pos, s.vel, BODY.radius, h);
  s.onGround = r.ground;
  if (r.ground && s.vel.y < 0) s.vel.y = 0;
}

function updateLives(g: Game, dt: number): void {
  const c = core(g);
  const ss = g.soldiers;
  downed.length = 0;
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    if (s.anim.hitT > 0) s.anim.hitT = Math.max(0, s.anim.hitT - dt);
    if (s.blindT > 0) s.blindT = Math.max(0, s.blindT - dt);
    if (s.stimT > 0) s.stimT = Math.max(0, s.stimT - dt);
    if (s.spotT > 0) {
      s.spotT -= dt;
      if (s.spotT <= 0) { s.spotT = 0; c.spottedBy[s.id] = -1; }
    }
    if (s.state === 'alive') {
      if (s.protect > 0) {
        s.protect = Math.max(0, s.protect - dt);
        if (s.ctl.fire && s.protect < 1.6) s.protect = 0; // 쏘기 시작하면 보호 끝
      }
      if (s.vehicle < 0 && s.hp < s.maxHp) {
        const delay = s.stimT > 0 ? 1 : s.cls === 'assault' ? 3 : 5;
        if (g.time - s.lastHurtT >= delay) s.hp = Math.min(s.maxHp, s.hp + (s.stimT > 0 ? 30 : 12) * dt);
      }
    } else if (s.state === 'down') {
      s.downT -= dt;
      s.reviveProg = 0;
      s.eyeH += (BODY.eye.prone + 0.03 - s.eyeH) * damp(6, dt);
      bodyFall(g, s, dt, BODY.height.prone);
      if (s.downT <= 0) finalizeDown(g, s);
      else downed.push(s);
    } else {
      s.deadT += dt;
      if (s.respawnT > 0) s.respawnT = Math.max(0, s.respawnT - dt);
      if (s.deadT < 3) bodyFall(g, s, dt, BODY.height.prone);
      if (s.isPlayer) g.playerNeedsDeploy = true;
      else if (s.respawnT <= 0) botRespawn(g, s);
    }
  }

  // 손으로 소생 (상호작용 누르고 있기)
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    const mine = c.handRevive[s.id] === 1;
    if (s.state !== 'alive' || !s.ctl.interact || s.vehicle >= 0 || downed.length === 0) {
      if (mine) { c.handRevive[s.id] = 0; s.reviving = -1; s.reviveProg = 0; }
      continue;
    }
    const medic = s.cls === 'support';
    let best: Soldier | null = null;
    let bd = REVIVE_R * REVIVE_R;
    for (let k = 0; k < downed.length; k++) {
      const t = downed[k];
      if (t.team !== s.team || t.state !== 'down') continue;
      if (t.squad !== s.squad && !medic) continue;
      const dx = t.pos.x - s.pos.x, dz = t.pos.z - s.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bd && Math.abs(t.pos.y - s.pos.y) < 1.5) { bd = d2; best = t; }
    }
    if (!best) {
      if (mine) { c.handRevive[s.id] = 0; s.reviving = -1; s.reviveProg = 0; }
      continue;
    }
    if (!mine || s.reviving !== best.id) { s.reviving = best.id; s.reviveProg = 0; c.handRevive[s.id] = 1; }
    s.reviveProg = Math.min(1, s.reviveProg + dt / (medic ? 2 : 4));
    if (s.reviveProg > best.reviveProg) best.reviveProg = s.reviveProg;
    if (s.reviveProg >= 1) {
      c.handRevive[s.id] = 0;
      s.reviving = -1;
      s.reviveProg = 0;
      reviveSoldier(g, best, s.id, medic ? 100 : 50);
      award(g, s.id, 100, '소생');
    }
  }
}

export function giveUp(g: Game, sid: number): void {
  const s = g.soldiers[sid];
  if (s && s.state === 'down') finalizeDown(g, s);
}

// ───────────────────────── 봇 재배치 ─────────────────────────

function pickBotClass(g: Game, s: Soldier): ClassId {
  if (rand(g) > 0.3) return s.cls;
  let n = 0, sup = 0, eng = 0;
  for (const o of g.soldiers) {
    if (o.team !== s.team || o.id === s.id) continue;
    n++;
    if (o.cls === 'support') sup++;
    else if (o.cls === 'engineer') eng++;
  }
  let armor = 0;
  for (const v of g.vehicles) {
    if (v.alive && (v.type === 'mbt' || v.type === 'ifv' || v.type === 'heli') && occupied(v) && vehicleTeam(g, v) !== s.team) armor++;
  }
  if (armor > 0 && eng < n * 0.22 + armor && s.cls !== 'engineer') return 'engineer';
  if (sup < n * 0.2 && s.cls !== 'support') return 'support';
  if (rand(g) < 0.2) return randomClass(g);
  return s.cls;
}

function pick<T>(g: Game, a: T[]): T {
  return a[Math.floor(rand(g) * a.length) % a.length];
}

function chooseBotSpawn(g: Game, s: Soldier, opts: SpawnOption[]): SpawnOption {
  let hq: SpawnOption | null = null;
  const mates: SpawnOption[] = [], beacons: SpawnOption[] = [], empties: SpawnOption[] = [], flags: SpawnOption[] = [];
  for (const o of opts) {
    if (!o.ok) continue;
    if (o.kind === 'hq') hq = o;
    else if (o.kind === 'squad') mates.push(o);
    else if (o.kind === 'beacon') beacons.push(o);
    else if (o.kind === 'flag') flags.push(o);
    else if (o.kind === 'vehicle') {
      const v = g.vehicles[o.ref];
      if (v && occupied(v)) mates.push(o); else empties.push(o);
    }
  }
  const fallback = hq ?? hqOption(g, s.team, true);
  const r = rand(g);
  if (mates.length && r < 0.45) return pick(g, mates);
  if (beacons.length && r < 0.6) return pick(g, beacons);
  if (empties.length && rand(g) < 0.35) return pick(g, empties);
  if (flags.length && rand(g) < 0.85) {
    if (rand(g) < 0.3) return pick(g, flags);
    // 앞선 거점: 우리 것이 아닌 거점(없으면 적 본부)에 가장 가까운 곳
    const targets: Vec3[] = g.flags.filter((f) => f.owner !== s.team).map((f) => f.pos);
    if (!targets.length) targets.push(g.world.hq[(1 - s.team) as Team]);
    let best = flags[0], bd = Infinity;
    for (const o of flags) {
      let d = Infinity;
      for (const t of targets) d = Math.min(d, distXZ(o.pos, t));
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  return fallback;
}

function botRespawn(g: Game, s: Soldier): void {
  let cls = s.cls;
  let lo = s.loadout;
  const nc = pickBotClass(g, s);
  if (nc !== cls) { cls = nc; lo = botLoadout(g, cls); }
  const opt = chooseBotSpawn(g, s, spawnOptions(g, s.id));
  deploySoldier(g, s.id, opt, cls, lo);
}

// ───────────────────────── 출현 지점 ─────────────────────────

function hqOption(g: Game, team: Team, ok: boolean): SpawnOption {
  const h = g.world.hq[team];
  return { kind: 'hq', label: '본부', pos: { x: h.x, y: h.y, z: h.z }, ref: team, ok };
}

function enemyNear(g: Game, m: Soldier, r: number): boolean {
  const r2 = r * r;
  for (const o of g.soldiers) {
    if (o.team === m.team || o.state !== 'alive') continue;
    const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

export function spawnOptions(g: Game, sid: number): SpawnOption[] {
  const s = g.soldiers[sid];
  if (!s) return [];
  const ready = s.respawnT <= 0 && !g.over;
  const team = s.team;
  const other = (1 - team) as Team;
  const hq = g.world.hq[team];
  const out: SpawnOption[] = [hqOption(g, team, ready)];

  for (let i = 0; i < g.flags.length; i++) {
    const f = g.flags[i];
    if (f.owner !== team) continue;
    const safe = Math.abs(f.prog) > 0.95 && f.n[other] === 0;
    out.push({ kind: 'flag', label: `${f.id} ${f.name}`, pos: { x: f.pos.x, y: f.pos.y, z: f.pos.z }, ref: i, ok: ready && safe });
  }

  const seen: number[] = [];
  for (const m of g.soldiers) {
    if (m.team !== team || m.squad !== s.squad || m.id === s.id || m.state !== 'alive') continue;
    const calm = g.time - m.lastHurtT >= 5 && !enemyNear(g, m, 25);
    if (m.vehicle >= 0) {
      const v = g.vehicles[m.vehicle];
      if (!v || !v.alive || seen.indexOf(v.id) >= 0) continue;
      seen.push(v.id);
      const free = v.seats.indexOf(-1) >= 0;
      const short = VEHICLES[v.type]?.short ?? '차량';
      out.push({ kind: 'vehicle', label: `${m.name} · ${short}`, pos: { x: v.pos.x, y: v.pos.y, z: v.pos.z }, ref: v.id, ok: ready && free && calm });
    } else {
      out.push({ kind: 'squad', label: m.name, pos: { x: m.pos.x, y: m.pos.y, z: m.pos.z }, ref: m.id, ok: ready && calm });
    }
  }

  for (const p of g.placed) {
    if (!p.alive || p.kind !== 'beacon' || p.team !== team) continue;
    const ow = g.soldiers[p.owner];
    if (!ow || ow.squad !== s.squad) continue;
    out.push({ kind: 'beacon', label: `비컨 · ${ow.name}`, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, ref: p.id, ok: ready });
  }

  for (const v of g.vehicles) {
    if (!v.alive || v.team !== team || seen.indexOf(v.id) >= 0 || occupied(v)) continue;
    if (distXZ(v.pos, hq) > 90) continue;
    seen.push(v.id);
    out.push({ kind: 'vehicle', label: VEHICLES[v.type]?.name ?? '차량', pos: { x: v.pos.x, y: v.pos.y, z: v.pos.z }, ref: v.id, ok: ready });
  }
  return out;
}

// ───────────────────────── 배치 ─────────────────────────

/** (x, z) 에 서 있을 수 있으면 발 높이, 아니면 null */
function freeAt(g: Game, x: number, z: number, probeY: number, self: number): number | null {
  const w = g.world;
  if (x < 2 || z < 2 || x > w.size - 2 || z > w.size - 2) return null;
  if (inWater(w, x, z)) return null;
  const y = floorAt(w, x, probeY, z, BODY.radius);
  const r = BODY.radius + 0.05;
  const top = y + BODY.height.stand;
  const hit = { b: false };
  boxesNear(w, x, z, r + 0.5, (b) => {
    if (hit.b || !b.alive || !b.solid) return;
    if (b.max.y <= y + 0.45 || b.min.y >= top) return;
    if (x + r < b.min.x || x - r > b.max.x || z + r < b.min.z || z - r > b.max.z) return;
    hit.b = true;
  });
  if (hit.b) return null;
  for (const v of g.vehicles) {
    if (!v.alive && v.wreckT > 30) continue;
    const def = VEHICLES[v.type];
    if (!def || (def.air && v.pos.y - heightAt(w, v.pos.x, v.pos.z) > 4)) continue;
    const dx = x - v.pos.x, dz = z - v.pos.z;
    const fw = forwardXZ(v.yaw), rt = rightXZ(v.yaw);
    const lx = dx * rt.x + dz * rt.z, lz = dx * fw.x + dz * fw.z;
    if (Math.abs(lx) < def.size.x * 0.5 + 0.8 && Math.abs(lz) < def.size.z * 0.5 + 0.8) return null;
  }
  for (const o of g.soldiers) {
    if (o.id === self || o.state === 'dead') continue;
    const dx = o.pos.x - x, dz = o.pos.z - z;
    if (dx * dx + dz * dz < 0.9 * 0.9 && Math.abs(o.pos.y - y) < 1.8) return null;
  }
  return y;
}

function setPos(s: Soldier, x: number, y: number, z: number): void {
  s.pos.x = x; s.pos.y = y; s.pos.z = z;
  s.vel.x = 0; s.vel.y = 0; s.vel.z = 0;
  s.onGround = true;
}

function spawnAround(g: Game, s: Soldier, c: Vec3, r0: number, r1: number): void {
  const w = g.world;
  for (let k = 0; k < 24; k++) {
    const a = rand(g) * Math.PI * 2;
    const rr = r0 + (r1 - r0) * rand(g) + k * 0.4;
    const x = clamp(c.x + Math.cos(a) * rr, 3, w.size - 3);
    const z = clamp(c.z + Math.sin(a) * rr, 3, w.size - 3);
    const y = freeAt(g, x, z, heightAt(w, x, z) + 1.0, s.id);
    if (y !== null) { setPos(s, x, y, z); return; }
  }
  const x = clamp(c.x, 3, w.size - 3), z = clamp(c.z, 3, w.size - 3);
  setPos(s, x, floorAt(w, x, heightAt(w, x, z) + 1.0, z, BODY.radius), z);
}

function spawnNear(g: Game, s: Soldier, at: Vec3, yaw: number, offsets: [number, number][]): boolean {
  const w = g.world;
  const fw = forwardXZ(yaw), rt = rightXZ(yaw);
  const from: Vec3 = { x: at.x, y: at.y + 1.0, z: at.z };
  for (const [f, r] of offsets) {
    const x = at.x + fw.x * f + rt.x * r, z = at.z + fw.z * f + rt.z * r;
    const y = freeAt(g, x, z, at.y + 1.0, s.id);
    if (y === null || Math.abs(y - at.y) > 1.2) continue;
    if (!lineOfSight(w, from, { x, y: y + 1.0, z })) continue;
    setPos(s, x, y, z);
    return true;
  }
  return false;
}

const BEHIND: [number, number][] = [[-2, 0], [-1.6, -1.2], [-1.6, 1.2], [0, -1.6], [0, 1.6], [-3, 0], [1.6, 0]];
const AROUND: [number, number][] = [[-1, 0], [0, 1], [0, -1], [1, 0], [-1.5, 1], [-1.5, -1]];

/** 다음 공격 방향: 가장 가까운 우리 것 아닌 거점, 없으면 적 본부 */
function frontYaw(g: Game, p: Vec3, team: Team): number {
  let best: Vec3 | null = null, bd = Infinity;
  for (const f of g.flags) {
    if (f.owner === team) continue;
    const d = distXZ(p, f.pos);
    if (d > 4 && d < bd) { bd = d; best = f.pos; }
  }
  return yawTo(p, best ?? g.world.hq[(1 - team) as Team]);
}

function tryEnter(g: Game, s: Soldier, v: Vehicle | undefined): boolean {
  if (!v || !v.alive) return false;
  const seat = v.seats.indexOf(-1);
  if (seat < 0) return false;
  setPos(s, v.pos.x, v.pos.y, v.pos.z);
  s.yaw = v.yaw;
  s.ctl.yaw = v.yaw;
  return enterVehicle(g, s, v, seat);
}

/** 위치 정하기. 차량에 태웠으면 true */
function placeFor(g: Game, s: Soldier, opt: SpawnOption): void {
  let yaw: number | null = null;
  let placed = false;
  switch (opt.kind) {
    case 'vehicle':
      if (tryEnter(g, s, g.vehicles[opt.ref])) return;
      break;
    case 'squad': {
      const m = g.soldiers[opt.ref];
      if (m && m.id !== s.id && m.team === s.team && m.state === 'alive') {
        if (m.vehicle >= 0) { if (tryEnter(g, s, g.vehicles[m.vehicle])) return; }
        else {
          placed = spawnNear(g, s, m.pos, m.yaw, BEHIND);
          if (!placed) { setPos(s, m.pos.x, m.pos.y, m.pos.z); placed = true; }
          yaw = m.yaw;
        }
      }
      break;
    }
    case 'beacon': {
      let p: Placed | undefined;
      for (const x of g.placed) if (x.id === opt.ref) { p = x; break; }
      if (p && p.alive && p.team === s.team) {
        placed = spawnNear(g, s, p.pos, p.yaw, AROUND);
        if (!placed) { setPos(s, p.pos.x, floorAt(g.world, p.pos.x, p.pos.y + 1, p.pos.z, BODY.radius), p.pos.z); placed = true; }
      }
      break;
    }
    case 'flag': {
      const f = g.flags[opt.ref];
      if (f && f.owner === s.team) { spawnAround(g, s, f.pos, 8, 14); placed = true; }
      break;
    }
    default:
      break;
  }
  if (!placed) spawnAround(g, s, g.world.hq[s.team], 8, 14);
  const y = yaw ?? frontYaw(g, s.pos, s.team);
  s.yaw = y;
  s.pitch = 0;
  s.ctl.yaw = y;
  s.ctl.pitch = 0;
}

function resetLife(g: Game, s: Soldier, cls: ClassId, loadout: Loadout): void {
  const c = core(g);
  s.cls = cls;
  s.loadout = cloneLoadout(loadout);
  const hp = CLASSES[cls]?.hp ?? 100;
  s.hp = hp;
  s.maxHp = hp;
  s.weapons = [makeWeaponState(s.loadout.primary, cls), makeWeaponState(s.loadout.secondary, cls)];
  s.gadgets = [makeGadgetState(s.loadout.gadget1), makeGadgetState(s.loadout.gadget2), makeGadgetState(s.loadout.throwable)];
  s.cur = 0;
  s.held = 'weapon';
  s.heldGadget = 0;
  s.ads = 0;
  const sw = s.weapons[0]?.st?.swap;
  s.swapT = typeof sw === 'number' && sw > 0 ? Math.min(0.6, sw) : 0;
  s.state = 'alive';
  s.downT = 0;
  s.deadT = 0;
  s.respawnT = 0;
  s.protect = 2;
  s.stance = 'stand';
  s.eyeH = BODY.eye.stand;
  s.sprinting = false;
  s.sliding = 0;
  s.onGround = true;
  s.vel.x = 0; s.vel.y = 0; s.vel.z = 0;
  s.pitch = 0;
  s.vehicle = -1;
  s.seat = -1;
  s.lastHurtT = -999;
  s.lastHurtBy = -1;
  s.lastHurtYaw = 0;
  s.spotT = 0;
  s.reviving = -1;
  s.reviveProg = 0;
  s.blindT = 0;
  s.stimT = 0;
  s.prevInteract = false;
  s.interactPressed = false;
  s.dmgFrom = {};
  s.anim.walk = 0; s.anim.fireT = 0; s.anim.reloadT = 0; s.anim.throwT = 0; s.anim.hitT = 0;
  s.stepAcc = 0;
  Object.assign(s.ctl, makeControls(s.yaw));
  c.downBy[s.id] = -1;
  c.downWeapon[s.id] = '';
  c.downHead[s.id] = 0;
  c.spottedBy[s.id] = -1;
  c.handRevive[s.id] = 0;
  c.inFlag[s.id] = -1;
}

function deployInternal(g: Game, s: Soldier, opt: SpawnOption, cls: ClassId, loadout: Loadout, silent: boolean): void {
  resetLife(g, s, cls, loadout);
  if (!silent) emit(g, { k: 'spawn', s: s.id });
  placeFor(g, s, opt);
  if (s.isPlayer) g.playerNeedsDeploy = false;
}

export function deploySoldier(g: Game, sid: number, opt: SpawnOption, cls: ClassId, loadout: Loadout): void {
  const s = g.soldiers[sid];
  if (!s || g.over) return;
  if (s.state === 'down') return;
  if (s.state === 'dead' && s.respawnT > 0) return;
  if (s.state === 'alive' && s.vehicle >= 0) {
    // 살아 있는 채 재배치: 먼저 좌석을 비운다
    const v = g.vehicles[s.vehicle];
    if (v) { const i = v.seats.indexOf(s.id); if (i >= 0) v.seats[i] = -1; }
    s.vehicle = -1;
    s.seat = -1;
  }
  deployInternal(g, s, opt, cls, loadout, false);
}

// ───────────────────────── 점령 ─────────────────────────

function inZone(g: Game, fi: number, team: Team, cb: (s: Soldier) => void): void {
  const c = core(g);
  for (const s of g.soldiers) if (s.team === team && s.state === 'alive' && c.inFlag[s.id] === fi) cb(s);
}

function updateFlags(g: Game, dt: number): void {
  const fl = g.flags;
  if (!fl.length) return;
  const c = core(g);
  for (const f of fl) { f.n[0] = 0; f.n[1] = 0; }
  const ss = g.soldiers;
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i];
    c.inFlag[s.id] = -1;
    if (s.state !== 'alive') continue;
    if (s.vehicle >= 0) {
      const v = g.vehicles[s.vehicle];
      if (v && VEHICLES[v.type]?.air) continue;
    }
    for (let k = 0; k < fl.length; k++) {
      const f = fl[k];
      const dx = s.pos.x - f.pos.x, dz = s.pos.z - f.pos.z;
      if (dx * dx + dz * dz <= f.r * f.r && Math.abs(s.pos.y - f.pos.y) < 25) {
        f.n[s.team]++;
        c.inFlag[s.id] = k;
        break;
      }
    }
  }

  for (let i = 0; i < fl.length; i++) {
    const f = fl[i];
    const n0 = f.n[0], n1 = f.n[1];
    f.contested = n0 > 0 && n1 > 0;
    if (f.contested) continue;
    if (n0 === 0 && n1 === 0) {
      // 아무도 없으면 주인 쪽으로 천천히 되돌아감
      const goal = f.owner === 0 ? 1 : f.owner === 1 ? -1 : 0;
      const step = 0.05 * dt;
      if (f.prog < goal) f.prog = Math.min(goal, f.prog + step);
      else if (f.prog > goal) f.prog = Math.max(goal, f.prog - step);
      continue;
    }
    const team: Team = n0 > 0 ? 0 : 1;
    const cnt = team === 0 ? n0 : n1;
    const dir = team === 0 ? 1 : -1;
    if (f.owner === team && f.prog * dir >= 1) continue;
    const rate = 0.1 + 0.03 * Math.min(cnt, 4);
    f.prog = clamp(f.prog + dir * rate * dt, -1, 1);

    if (f.owner !== -1 && f.owner !== team) {
      const owner = f.owner;
      if (g.time - c.lastDrain[i] > 5) emit(g, { k: 'flag', flag: f.id, team: owner, what: 'losing' });
      c.lastDrain[i] = g.time;
      if ((owner === 0 && f.prog <= 0) || (owner === 1 && f.prog >= 0)) {
        f.owner = -1;
        emit(g, { k: 'flag', flag: f.id, team: -1, what: 'neutralized' });
        emit(g, owner === 0
          ? { k: 'msg', text: `${f.id} ${f.name} 거점이 무력화되었습니다`, tone: 'bad' }
          : { k: 'msg', text: `적 거점 ${f.id} ${f.name} 무력화`, tone: 'good' });
        inZone(g, i, team, (s) => award(g, s.id, 100, '거점 무력화'));
      }
    }
    if (f.owner !== team && f.prog * dir >= 1) {
      f.prog = dir;
      f.owner = team;
      c.lastDrain[i] = -1e9;
      emit(g, { k: 'flag', flag: f.id, team, what: 'captured' });
      inZone(g, i, team, (s) => { s.caps++; award(g, s.id, 200, '거점 점령'); });
    }
  }
}

// ───────────────────────── 티켓·종료 ─────────────────────────

function finish(g: Game, winner: Team, reason: string): void {
  if (g.over) return;
  g.over = { winner, reason };
  emit(g, { k: 'over', winner });
}

function updateTickets(g: Game, dt: number): void {
  const c = core(g);
  let o0 = 0, o1 = 0;
  for (const f of g.flags) { if (f.owner === 0) o0++; else if (f.owner === 1) o1++; }
  const half = g.flags.length / 2;
  const bleed: Team | -1 = o0 > half ? 1 : o1 > half ? 0 : -1;
  if (bleed !== c.bleeding) {
    if (bleed === 0) emit(g, { k: 'msg', text: '적이 거점 과반을 장악했습니다 — 아군 티켓 감소 중', tone: 'bad' });
    else if (bleed === 1) emit(g, { k: 'msg', text: '거점 과반 장악 — 적 티켓 감소 중', tone: 'good' });
    c.bleeding = bleed;
  }
  c.bleedAcc += dt;
  if (c.bleedAcc >= 4) {
    c.bleedAcc -= 4;
    if (bleed !== -1) {
      const loss = Math.min(3, Math.abs(o0 - o1));
      g.tickets[bleed] = Math.max(0, g.tickets[bleed] - loss);
    }
  }

  // 티켓 알림
  for (let ti = 0; ti < 2; ti++) {
    const marks = c.ticketMarks[ti];
    let hit = -1;
    while (marks.length && g.tickets[ti] <= marks[0]) hit = marks.shift() as number;
    if (hit > 0 && g.tickets[ti] > 0) {
      emit(g, ti === 0
        ? { k: 'msg', text: `아군 티켓 ${hit} 남음`, tone: 'bad' }
        : { k: 'msg', text: `적 티켓 ${hit} 남음`, tone: 'good' });
    }
  }
  // 남은 시간 알림
  const left = g.limit - g.time;
  while (c.timeMarks.length && left <= c.timeMarks[0]) {
    const m = c.timeMarks.shift() as number;
    emit(g, { k: 'msg', text: `남은 시간 ${m >= 60 ? `${Math.round(m / 60)}분` : `${m}초`}`, tone: 'info' });
  }

  if (g.tickets[0] <= 0 || g.tickets[1] <= 0) {
    if (g.tickets[0] <= 0 && g.tickets[1] <= 0) finish(g, o0 >= o1 ? 0 : 1, '양측 티켓 소진');
    else if (g.tickets[1] <= 0) finish(g, 0, '적 티켓 소진');
    else finish(g, 1, '아군 티켓 소진');
  } else if (g.time >= g.limit) {
    const w: Team = g.tickets[0] > g.tickets[1] ? 0 : g.tickets[1] > g.tickets[0] ? 1 : o0 >= o1 ? 0 : 1;
    finish(g, w, '시간 종료');
  }
}
