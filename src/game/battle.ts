// 전투 시뮬레이션의 중심: 병사, 사격, 장비, 폭발과 파괴, 거점과 티켓, 배치
import {
  ALLY_SKILL, BLEED_EVERY, CLASSES, DIFFS, DOWN_TIME, FLAG_R, FACTIONS, FRAG, GADGETS, MATCH_LIMIT, RESPAWN_DELAY, SIZES,
  SOLDIER_R, SQUAD_NAMES, WALK, SPRINT_MUL, CROUCH_MUL, ADS_MUL, VEHICLES, weaponStats,
  type ClassId, type Diff, type GadgetId, type Kit, type MapDef, type Side, type SizeId, type Team,
} from './defs';
import {
  BREAKABLE, CELL, CONTAINER, DOOR, FENCE, GROUND, MOVE_BLOCK, RUBBLE, SANDBAG, SHOT_BLOCK, SHOT_PARTIAL, STUMP, TREE, WALL,
  WINDOW, WRECK, cellOf, collide, freeSpot, los, setCell, traverse, BRIDGE, WATER, M_WOOD, M_METAL, M_CONCRETE,
} from './grid';
import { genWorld } from './mapgen';
import { buildNav, updateNav } from './nav';
import type { Battle, Brain, Flag, GEvent, Item, Projectile, Soldier, Spawn, Thrown, Vehicle } from './types';
import { newCtl } from './types';
import { botThink, commander } from './bots';
import { createVehicle, damageVehicle, enterVehicle, exitVehicle, nearVehicle, switchSeat, updateVehicle } from './vehicles';

const HC = 128;

export function rand(b: { seed: number }): number {
  b.seed = (b.seed + 0x6d2b79f5) | 0;
  let t = b.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const angDiff = (a: number, b: number) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
export const enemyOf = (t: Team): Team => (t === 0 ? 1 : 0);

export function emit(b: Battle, e: GEvent) {
  b.events.push(e);
  if (b.events.length > 3000) b.events.splice(0, 1000);
}

export function award(b: Battle, s: Soldier, pts: number, text: string) {
  s.score += pts;
  if (s === b.player && pts > 0) emit(b, { k: 'score', text, pts });
}

const newBrain = (skill: { react: number; err: number }): Brain => ({
  think: 0, target: -1, tveh: -1, react: 0, err: 0, burst: 0, strafe: 1, strafeT: 0, coverX: 0, coverY: 0, coverT: 0, goal: 0,
  wx: 0, wy: 0, wanderT: 0, stuckT: 0, lx: 0, ly: 0, jitterT: 0, jx: 0, jy: 0, nadeT: 4, gadgetT: 2, lastX: 0, lastY: 0, lastT: -99,
  orbit: 1, ride: -1, skill,
});

// ───────── 생성 ─────────

export interface BattleOpts {
  map: MapDef;
  size: SizeId;
  diff: Diff;
  side: Side;
  /** 병과별 내 로드아웃 (분대원도 같은 로드아웃을 쓴다) */
  kits: Record<ClassId, Kit>;
  playerCls: ClassId;
  squadCls: ClassId[];
  flip?: boolean;
}

const BOT_CLS: ClassId[] = ['assault', 'medic', 'engineer', 'assault', 'recon', 'medic', 'engineer', 'assault'];

/** 봇 로드아웃: 병과마다 몇 가지 조합을 돌려 쓴다 */
function botKit(cls: ClassId, r: () => number): Kit {
  const c = CLASSES[cls];
  const weapon = c.weapons[Math.floor(r() * c.weapons.length)];
  const ga = c.gadgetsA[Math.floor(r() * c.gadgetsA.length)];
  const gb = c.gadgetsB[Math.floor(r() * c.gadgetsB.length)];
  const long = weapon === 'b50' || weapon === 'b7' || weapon === 'd14';
  return { weapon, optic: long ? 'x6' : r() < 0.5 ? 'dot' : 'x2', muzzle: r() < 0.2 ? 'supp' : 'none', mag: 'std', grip: r() < 0.5 ? 'vert' : 'none', ga, gb };
}

export function createBattle(o: BattleOpts): Battle {
  const flip = o.flip ?? false;
  const world = genWorld(o.map, flip);
  const nav = buildNav(world);
  const sz = SIZES[o.size];
  const sides: [Side, Side] = [o.side, o.side === 'us' ? 'ru' : 'us'];
  const tk: [number, number] = [sz.tickets, sz.tickets];
  const b: Battle = {
    world, nav, map: o.map, size: o.size, diff: o.diff, sides, time: 0, limit: MATCH_LIMIT, over: null,
    tickets: [...tk], startTickets: [...tk], soldiers: [], vehicles: [], proj: [], thrown: [], items: [],
    flags: world.flags.map((f) => ({ ...f, owner: -1, prog: 0, n: [0, 0] }) as Flag),
    events: [], player: null as unknown as Soldier, needDeploy: true, seed: o.map.seed * 977 + 13,
    hash: [], hcw: Math.ceil(world.w / HC), hch: Math.ceil(world.h / HC), bleedT: BLEED_EVERY, cmdT: 0, seenT: 0, nextItem: 1,
    squadCls: o.squadCls,
  };
  b.hash = Array.from({ length: b.hcw * b.hch }, () => []);
  const rr = () => rand(b);
  for (const team of [0, 1] as Team[]) {
    const names = FACTIONS[sides[team]].names;
    const skill = team === 1 ? { react: DIFFS[o.diff].react, err: DIFFS[o.diff].err } : { ...ALLY_SKILL };
    for (let i = 0; i < sz.team; i++) {
      const squad = Math.floor(i / 4), slot = i % 4;
      const mine = team === 0 && squad === 0;
      const cls: ClassId = mine ? (slot === 0 ? o.playerCls : o.squadCls[slot - 1] ?? 'assault') : BOT_CLS[(i + squad) % BOT_CLS.length];
      const kit = mine ? { ...o.kits[cls] } : botKit(cls, rr);
      const nm = names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : '');
      const s: Soldier = {
        id: b.soldiers.length, team, squad, slot, name: team === 0 && i === 0 ? '나' : nm, bot: !(team === 0 && i === 0),
        cls, kit, ws: weaponStats(kit), x: world.hq[team].x, y: world.hq[team].y, vx: 0, vy: 0, ang: 0, legAng: 0, walk: 0,
        hp: 100, maxHp: 100, state: 2, downT: 0, respawnT: 0.2 + rr() * 2.5, deadT: 0, crouch: false, ads: false, sprint: false,
        held: 0, swapT: 0, mag: 0, reserve: 0, reloadT: 0, fireT: 0, bloom: 0, triggerHeld: false,
        ga: { ammo: 0, cd: 0 }, gb: { ammo: 0, cd: 0 }, frags: 0, heat: 0, lockT: 0, lockId: -1, stimT: 0, veh: -1, seat: -1,
        suppress: 0, lastHurtT: -99, lastShotT: -99, spotT: 0, mapT: 0, seen: team === 0, revive: 0, protect: 0,
        kills: 0, deaths: 0, assists: 0, revives: 0, score: 0, caps: 0, vkills: 0, dmgLog: [], ctl: newCtl(), ai: newBrain(skill),
      };
      b.soldiers.push(s);
    }
  }
  b.player = b.soldiers[0];
  b.player.respawnT = 0;
  for (const team of [0, 1] as Team[]) {
    const pads = world.pads.filter((p) => p.team === team);
    sz.vehicles.forEach((type, k) => b.vehicles.push(createVehicle(b, team, type, world.pads.indexOf(pads[k]))));
  }
  commander(b);
  return b;
}

export const squadName = (b: Battle, s: Soldier) => (s.team === 0 ? SQUAD_NAMES[s.squad % SQUAD_NAMES.length] : SQUAD_NAMES[(s.squad + 3) % SQUAD_NAMES.length]);

// ───────── 공간 해시 ─────────

function rebuildHash(b: Battle) {
  for (const c of b.hash) c.length = 0;
  for (const s of b.soldiers) {
    if (s.state !== 0 || s.veh >= 0) continue;
    const cx = Math.min(b.hcw - 1, Math.max(0, Math.floor(s.x / HC))), cy = Math.min(b.hch - 1, Math.max(0, Math.floor(s.y / HC)));
    b.hash[cy * b.hcw + cx].push(s);
  }
}

/** 살아서 걸어 다니는 병사 가운데 (x, y)에서 r 안에 있는 병사 */
export function forNear(b: Battle, x: number, y: number, r: number, fn: (s: Soldier, d2: number) => void) {
  const x0 = Math.max(0, Math.floor((x - r) / HC)), x1 = Math.min(b.hcw - 1, Math.floor((x + r) / HC));
  const y0 = Math.max(0, Math.floor((y - r) / HC)), y1 = Math.min(b.hch - 1, Math.floor((y + r) / HC));
  const r2 = r * r;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    for (const s of b.hash[cy * b.hcw + cx]) {
      const d2 = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d2 <= r2) fn(s, d2);
    }
  }
}

/** 선분 근처의 병사 (선분 위 위치 t와 거리를 함께 준다) */
function forSegment(b: Battle, x0: number, y0: number, x1: number, y1: number, pad: number, fn: (s: Soldier, t: number, d: number) => void) {
  const minx = Math.min(x0, x1) - pad, maxx = Math.max(x0, x1) + pad, miny = Math.min(y0, y1) - pad, maxy = Math.max(y0, y1) + pad;
  const cx0 = Math.max(0, Math.floor(minx / HC)), cx1 = Math.min(b.hcw - 1, Math.floor(maxx / HC));
  const cy0 = Math.max(0, Math.floor(miny / HC)), cy1 = Math.min(b.hch - 1, Math.floor(maxy / HC));
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    for (const s of b.hash[cy * b.hcw + cx]) {
      const t = Math.max(0, Math.min(1, ((s.x - x0) * dx + (s.y - y0) * dy) / l2));
      const px = x0 + dx * t - s.x, py = y0 + dy * t - s.y;
      const d = Math.hypot(px, py);
      if (d <= pad) fn(s, t, d);
    }
  }
}

export function enemyNear(b: Battle, team: Team, x: number, y: number, r: number): boolean {
  let found = false;
  forNear(b, x, y, r, (o) => { if (o.team !== team) found = true; });
  return found;
}

// ───────── 피해 ─────────

export function damageSoldier(b: Battle, s: Soldier, dmg: number, by: number, from: number, w: string) {
  if (s.state === 2 || b.over || dmg <= 0) return;
  if (s.state === 1) {
    s.downT -= dmg * 0.08;
    if (s.downT <= 0) die(b, s);
    return;
  }
  if (s.veh >= 0 || s.protect > 0) return;
  const d = DIFFS[b.diff];
  if (s === b.player) dmg *= d.taken;
  if (by === b.player.id && s.team !== b.player.team) dmg *= d.dealt;
  s.hp -= dmg;
  s.lastHurtT = b.time;
  s.suppress = Math.min(1, s.suppress + 0.3);
  if (by >= 0) {
    s.dmgLog.push({ by, dmg, t: b.time });
    if (s.dmgLog.length > 6) s.dmgLog.shift();
    if (s.bot) { s.ai.lastX = b.soldiers[by].x; s.ai.lastY = b.soldiers[by].y; s.ai.lastT = b.time; }
  }
  if (s === b.player) emit(b, { k: 'hurt', a: from, dmg });
  if (by === b.player.id && s.team !== b.player.team) emit(b, { k: 'hit', kill: s.hp <= 0, veh: false });
  if (s.hp <= 0) down(b, s, by, w);
}

function down(b: Battle, s: Soldier, by: number, w: string) {
  s.state = 1;
  s.hp = 0;
  s.downT = DOWN_TIME;
  s.revive = 0;
  s.ads = false;
  s.reloadT = 0;
  s.vx = 0; s.vy = 0;
  const k = by >= 0 ? b.soldiers[by] : null;
  if (k && k !== s && k.team !== s.team) {
    k.kills++;
    award(b, k, 100, '적 사살');
    for (const e of s.dmgLog) {
      if (e.by === by || b.time - e.t > 12 || e.dmg < 20) continue;
      const a = b.soldiers[e.by];
      if (a.team === s.team) continue;
      a.assists++;
      award(b, a, 50, '사살 지원');
      e.dmg = 0;
    }
    if (s.spotT > 0) for (const t of b.soldiers) if (t.team === k.team && t.cls === 'recon' && t !== k && dist(t, s) < 1600 && t.state === 0) { award(b, t, 20, '표시 지원'); break; }
  }
  emit(b, { k: 'feed', killer: k && k !== s ? k.name : '', victim: s.name, w, kt: k ? k.team : s.team, vt: s.team, me: k === b.player || s === b.player });
}

export function die(b: Battle, s: Soldier) {
  if (s.state === 2) return;
  if (s.veh >= 0) exitVehicle(b, s, true);
  s.state = 2;
  s.hp = 0;
  s.deadT = 0;
  s.deaths++;
  s.respawnT = RESPAWN_DELAY;
  s.held = 0;
  b.tickets[s.team] = Math.max(0, b.tickets[s.team] - 1);
  if (s === b.player) b.needDeploy = true;
}

/** 칸 하나에 피해를 준다. 부서지면 잔해가 되고 건물이 무너질 수 있다 */
export function damageCell(b: Battle, i: number, dmg: number) {
  const w = b.world;
  const t = w.t[i];
  if (!BREAKABLE[t] || dmg <= 0) return;
  if (t === CONTAINER && w.vis[i] === 255) dmg *= 0.2;
  w.hp[i] -= dmg;
  if (w.hp[i] > 0) return;
  const cx = i % w.cw, cy = (i - cx) / w.cw;
  const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
  const bid = w.bld[i];
  if (t === TREE) {
    setCell(w, i, STUMP);
    emit(b, { k: 'tree', x, y, a: rand(b) * Math.PI * 2 });
    return;
  }
  emit(b, { k: 'break', x, y, m: w.mat[i], t });
  if (t === SANDBAG || t === FENCE) { setCell(w, i, GROUND); return; }
  setCell(w, i, RUBBLE);
  w.hp[i] = 0;
  if (bid >= 0 && (t === WALL || t === WINDOW || t === DOOR)) {
    const bl = w.buildings[bid];
    if (t !== DOOR) bl.wallsLeft--;
    holeRoof(b, cx, cy, 1.3, bid);
    if (!bl.collapsed && bl.wallsLeft < bl.walls * 0.5) collapse(b, bid);
  }
}

function holeRoof(b: Battle, cx: number, cy: number, r: number, bid: number) {
  const w = b.world;
  const ri = Math.ceil(r);
  for (let y = cy - ri; y <= cy + ri; y++) for (let x = cx - ri; x <= cx + ri; x++) {
    if (x < 0 || y < 0 || x >= w.cw || y >= w.ch || Math.hypot(x - cx, y - cy) > r) continue;
    const i = y * w.cw + x;
    if (w.bld[i] === bid && w.roof[i]) { w.roof[i] = 0; w.buildings[bid].dirty = true; }
  }
}

function collapse(b: Battle, bid: number) {
  const w = b.world;
  const bl = w.buildings[bid];
  bl.collapsed = true;
  bl.dirty = true;
  for (let y = bl.y; y < bl.y + bl.h; y++) for (let x = bl.x; x < bl.x + bl.w; x++) {
    const i = y * w.cw + x;
    w.roof[i] = 0;
    const t = w.t[i];
    if (t === WALL || t === WINDOW || t === DOOR) { setCell(w, i, RUBBLE); w.hp[i] = 0; }
  }
  emit(b, { k: 'collapse', b: bid });
  emit(b, { k: 'boom', x: (bl.x + bl.w / 2) * CELL, y: (bl.y + bl.h / 2) * CELL, r: Math.max(bl.w, bl.h) * CELL * 0.6, big: true });
  for (const s of b.soldiers) {
    if (s.state === 2 || s.veh >= 0) continue;
    const i = cellOf(w, s.x, s.y);
    if (i >= 0 && w.bld[i] === bid) damageSoldier(b, s, 85, -1, 0, '붕괴');
  }
}

/** 폭발: 주변 병사, 차량, 지형에 피해 */
export function explode(b: Battle, x: number, y: number, r: number, dmg: number, team: Team, by: number, wall: number, w: string, vehMul = 0.35) {
  const world = b.world;
  emit(b, { k: 'boom', x, y, r, big: r >= 100 });
  for (const s of b.soldiers) {
    if (s.state === 2 || s.veh >= 0) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d >= r) continue;
    if (s.team === team && s.id !== by) continue;
    let f = 1 - 0.7 * (d / r);
    if (d > 24 && !los(world, x, y, s.x, s.y, false)) f *= 0.25;
    if (s.id === by) f *= 0.5;
    damageSoldier(b, s, dmg * f, by, Math.atan2(s.y - y, s.x - x) + Math.PI, w);
    if (s.state === 0) s.suppress = 1;
  }
  if (vehMul > 0) {
    for (const v of b.vehicles) {
      if (!v.alive || v.team === team || VEHICLES[v.type].air) continue;
      const d = Math.hypot(v.x - x, v.y - y) - VEHICLES[v.type].r;
      if (d < r) damageVehicle(b, v, dmg * vehMul * (1 - 0.6 * Math.max(0, d) / r), by, 'blast', x, y);
    }
  }
  if (wall > 0) {
    const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL);
    const rc = (r * 0.7) / CELL;
    const ri = Math.ceil(rc);
    for (let yy = cj - ri; yy <= cj + ri; yy++) for (let xx = ci - ri; xx <= ci + ri; xx++) {
      if (xx < 0 || yy < 0 || xx >= world.cw || yy >= world.ch) continue;
      const d = Math.hypot(xx + 0.5 - x / CELL, yy + 0.5 - y / CELL);
      if (d > rc + 0.5) continue;
      damageCell(b, yy * world.cw + xx, wall * (1 - 0.55 * Math.min(1, d / (rc + 0.5))));
    }
    const i = cellOf(world, x, y);
    if (i >= 0 && world.bld[i] >= 0) holeRoof(b, ci, cj, Math.max(1, rc * 0.8), world.bld[i]);
  }
}

// ───────── 배치 ─────────

export function spawnOptions(b: Battle, s: Soldier): Spawn[] {
  const team = s.team;
  const hq = b.world.hq[team];
  const out: Spawn[] = [{ kind: 'hq', x: hq.x, y: hq.y, label: '본부', veh: -1, ref: -1 }];
  b.flags.forEach((f, k) => {
    if (f.owner === team && f.n[enemyOf(team)] === 0 && Math.abs(f.prog) > 0.95) out.push({ kind: 'flag', x: f.x, y: f.y, label: f.tag, veh: -1, ref: k });
  });
  for (const m of b.soldiers) {
    if (m === s || m.team !== team || m.squad !== s.squad || m.state !== 0) continue;
    if (b.time - m.lastHurtT < 5) continue;
    if (m.veh >= 0) {
      const v = b.vehicles[m.veh];
      if (v.seats.some((x) => x < 0)) out.push({ kind: 'vehicle', x: v.x, y: v.y, label: VEHICLES[v.type].short, veh: v.id, ref: m.id });
      continue;
    }
    if (enemyNear(b, team, m.x, m.y, 320)) continue;
    out.push({ kind: 'squad', x: m.x, y: m.y, label: m.name, veh: -1, ref: m.id });
  }
  for (const it of b.items) {
    if (it.kind === 'beacon' && it.team === team && b.soldiers[it.owner].squad === s.squad) out.push({ kind: 'beacon', x: it.x, y: it.y, label: '비컨', veh: -1, ref: it.id });
  }
  for (const v of b.vehicles) {
    if (!v.alive || v.team !== team || v.seats[0] >= 0 || v.seats.some((x) => x >= 0)) continue;
    if (dist(v, hq) > 600) continue;
    out.push({ kind: 'vehicle', x: v.x, y: v.y, label: VEHICLES[v.type].short, veh: v.id, ref: -1 });
  }
  return out;
}

export function spawnSoldier(b: Battle, s: Soldier, sp: Spawn, kit?: Kit, cls?: ClassId) {
  if (cls) s.cls = cls;
  if (kit) s.kit = { ...kit };
  s.ws = weaponStats(s.kit);
  s.maxHp = s.kit.gb === 'plate' ? 135 : 100;
  s.hp = s.maxHp;
  s.state = 0;
  s.protect = sp.kind === 'hq' ? 2.5 : 1.5;
  s.mag = s.ws.mag;
  s.reserve = s.ws.mag * s.ws.mags;
  s.reloadT = 0; s.fireT = 0; s.bloom = 0; s.held = 0; s.swapT = 0; s.heat = 0; s.lockT = 0; s.lockId = -1; s.stimT = 0;
  s.ga = { ammo: GADGETS[s.kit.ga].ammo, cd: 0 };
  s.gb = { ammo: GADGETS[s.kit.gb].ammo, cd: 0 };
  s.frags = FRAG.count;
  s.suppress = 0; s.dmgLog = []; s.revive = 0; s.downT = 0; s.spotT = 0; s.crouch = false; s.ads = false;
  s.lastHurtT = -99;
  s.ai.target = -1; s.ai.tveh = -1; s.ai.coverT = 0; s.ai.ride = -1;
  if (sp.kind === 'vehicle' && sp.veh >= 0) {
    const v = b.vehicles[sp.veh];
    s.x = v.x; s.y = v.y;
    if (v.alive && enterVehicle(b, s, v)) return;
  }
  const p = freeSpot(b.world, sp.x, sp.y, sp.kind === 'squad' || sp.kind === 'beacon' ? 50 : 150, () => rand(b));
  s.x = p.x; s.y = p.y; s.vx = 0; s.vy = 0;
  s.ai.lx = p.x; s.ai.ly = p.y;
  const goal = b.flags[s.ai.goal] ?? b.flags[0];
  s.ang = Math.atan2(goal.y - s.y, goal.x - s.x);
}

export function deployPlayer(b: Battle, sp: Spawn, cls: ClassId, kit: Kit) {
  const s = b.player;
  if (s.state !== 2 || b.over) return;
  spawnSoldier(b, s, sp, kit, cls);
  b.needDeploy = false;
}

/** 쓰러진 플레이어가 소생을 기다리지 않고 재배치를 고른다 */
export function giveUp(b: Battle) {
  if (b.player.state === 1) die(b, b.player);
}

function botSpawn(b: Battle, s: Soldier) {
  const opts = spawnOptions(b, s);
  let pick: Spawn | undefined;
  const sq = opts.filter((o) => o.kind === 'squad' || o.kind === 'beacon' || (o.kind === 'vehicle' && o.ref >= 0));
  if (sq.length && rand(b) < 0.65) pick = sq[Math.floor(rand(b) * sq.length)];
  if (!pick) {
    const goal = b.flags[s.ai.goal];
    let best: Spawn | undefined, bd = Infinity;
    for (const o of opts) {
      if (o.kind !== 'flag' && o.kind !== 'hq') continue;
      const d = goal ? Math.hypot(o.x - goal.x, o.y - goal.y) + (o.kind === 'hq' ? 600 : 0) : 0;
      if (d < bd) { bd = d; best = o; }
    }
    pick = best ?? opts[0];
  }
  if (pick.kind === 'hq') {
    // 본부에서는 빈 차량을 먼저 챙긴다
    const vs = opts.filter((o) => o.kind === 'vehicle' && o.ref < 0);
    if (vs.length && rand(b) < 0.8) {
      const v = b.vehicles[vs[Math.floor(rand(b) * vs.length)].veh];
      if (v.type !== 'heli' || rand(b) < 0.85) pick = vs.find((o) => o.veh === v.id)!;
    }
  }
  spawnSoldier(b, s, pick);
}

// ───────── 사격과 장비 ─────────

function fireBullet(b: Battle, s: Soldier, a: number, kind: Projectile['kind'] = 'bullet') {
  const w = s.ws;
  const life = w.range / w.speed;
  b.proj.push({
    kind, x: s.x + Math.cos(s.ang) * 12, y: s.y + Math.sin(s.ang) * 12, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
    life, traveled: 0, maxDist: w.range, team: s.team, owner: s.id, dmg: w.dmg, dmgFar: w.dmgFar, near: w.near, far: w.far,
    splash: 0, splashR: 0, wall: 0, target: -1, air: false, weapon: w.name, lastCell: -1,
  });
}

export function spreadOf(s: Soldier): number {
  const w = s.ws;
  let sp = (s.ads ? w.ads : w.hip) + s.bloom;
  if (s.crouch) sp *= 0.75;
  const moving = Math.hypot(s.vx, s.vy) > 30;
  if (moving && !s.ads) sp *= 1.3;
  sp *= 1 + s.suppress * 0.7;
  return sp;
}

function shoot(b: Battle, s: Soldier) {
  const w = s.ws;
  const sp = spreadOf(s);
  const n = w.pellets ?? 1;
  for (let k = 0; k < n; k++) fireBullet(b, s, s.ang + (rand(b) - 0.5) * 2 * sp);
  s.mag--;
  s.fireT = 60 / w.rpm;
  s.bloom = Math.min(w.bloomMax, s.bloom + w.bloom);
  if (!w.supp) s.mapT = Math.max(s.mapT, 2);
  s.lastShotT = b.time;
  emit(b, { k: 'shot', x: s.x + Math.cos(s.ang) * 14, y: s.y + Math.sin(s.ang) * 14, a: s.ang, w: w.kind, team: s.team, supp: w.supp, heavy: w.snd[2] });
  if (rand(b) < 0.5) emit(b, { k: 'casing', x: s.x, y: s.y, a: s.ang + Math.PI / 2 });
  if (s.mag <= 0) startReload(s);
}

function startReload(s: Soldier) {
  if (s.reloadT > 0 || s.mag >= s.ws.mag) return;
  if (!s.bot && s.reserve <= 0) return;
  s.reloadT = s.ws.reload;
  s.ads = false;
}

function gadgetOf(s: Soldier, slot: 1 | 2): [GadgetId, { ammo: number; cd: number }] {
  return slot === 1 ? [s.kit.ga, s.ga] : [s.kit.gb, s.gb];
}

/** 들고 쏘는 장비를 발사한다 */
function fireGadget(b: Battle, s: Soldier, slot: 1 | 2) {
  const [id, st] = gadgetOf(s, slot);
  const g = GADGETS[id];
  if (st.cd > 0) return;
  const c = s.ctl;
  const sx = s.x + Math.cos(s.ang) * 14, sy = s.y + Math.sin(s.ang) * 14;
  const base = { x: sx, y: sy, traveled: 0, team: s.team, owner: s.id, target: -1, air: false, lastCell: -1, near: 0, far: 0, dmgFar: 0 };
  if (id === 'repair') return;
  if (g.ammo > 0 && st.ammo <= 0) return;
  if (id === 'ugl' || id === 'smokegl') {
    const d = Math.min(560, Math.max(80, Math.hypot(c.tx - s.x, c.ty - s.y)));
    const sp = 700;
    b.proj.push({ ...base, kind: id === 'ugl' ? 'gl' : 'smokegl', vx: Math.cos(s.ang) * sp, vy: Math.sin(s.ang) * sp, life: 2, maxDist: d, dmg: 0, splash: 95, splashR: 92, wall: 230, weapon: g.name });
  } else if (id === 'rpg') {
    const sp = 640;
    b.proj.push({ ...base, kind: 'rocket', vx: Math.cos(s.ang) * sp, vy: Math.sin(s.ang) * sp, life: 1.8, maxDist: 1150, dmg: 310, splash: 85, splashR: 82, wall: 320, weapon: g.name });
  } else if (id === 'aa') {
    const sp = 720;
    const tgt = s.lockT >= 1 ? s.lockId : -1;
    b.proj.push({ ...base, kind: 'missile', vx: Math.cos(s.ang) * sp, vy: Math.sin(s.ang) * sp, life: 3.2, maxDist: 2300, dmg: 380, splash: 40, splashR: 50, wall: 60, target: tgt, weapon: g.name });
    s.lockT = 0;
  } else return;
  st.ammo--;
  st.cd = g.cd;
  emit(b, { k: 'shot', x: sx, y: sy, a: s.ang, w: id, team: s.team, supp: false, heavy: 1 });
  s.mapT = Math.max(s.mapT, 3);
}

/** 내려놓거나 던지거나 바로 쓰는 장비 */
function useGadget(b: Battle, s: Soldier, slot: 1 | 2) {
  const [id, st] = gadgetOf(s, slot);
  const g = GADGETS[id];
  if (g.use === 'aimed') {
    if (s.held === slot) s.held = 0; else { s.held = slot; s.swapT = 0.35; s.ads = false; }
    return;
  }
  if (g.use === 'passive' || st.cd > 0) return;
  if (g.ammo > 0 && st.ammo <= 0) return;
  const c = s.ctl;
  const front = { x: s.x + Math.cos(s.ang) * 16, y: s.y + Math.sin(s.ang) * 16 };
  const place = MOVE_BLOCK[b.world.t[cellOf(b.world, front.x, front.y)] ?? 0] ? { x: s.x, y: s.y } : front;
  const item = (kind: Item['kind'], life: number, x = place.x, y = place.y): Item => {
    const it: Item = { id: b.nextItem++, kind, team: s.team, owner: s.id, x, y, ang: s.ang, t: 0, life, tick: 0, tx: c.tx, ty: c.ty };
    b.items.push(it);
    return it;
  };
  const mine = (kind: Item['kind'], max: number) => {
    const own = b.items.filter((i) => i.kind === kind && i.owner === s.id);
    if (own.length >= max) b.items.splice(b.items.indexOf(own[0]), 1);
  };
  switch (id) {
    case 'stim':
      s.hp = Math.min(s.maxHp, s.hp + 60);
      s.stimT = 6;
      emit(b, { k: 'heal', x: s.x, y: s.y });
      break;
    case 'medbag': item('medbag', 14); break;
    case 'ammobox': item('ammobox', 22); break;
    case 'mine': mine('mine', 3); item('mine', 9999); break;
    case 'claymore': mine('claymore', 2); item('claymore', 9999); break;
    case 'beacon': b.items = b.items.filter((i) => !(i.kind === 'beacon' && i.owner === s.id)); item('beacon', 9999); break;
    case 'smoke': case 'sensor': case 'drone': {
      if (id === 'drone') { item('drone', 13, s.x, s.y); break; }
      const d = Math.min(id === 'sensor' ? 420 : 380, Math.hypot(c.tx - s.x, c.ty - s.y));
      const a = s.ang;
      b.thrown.push({ kind: id as Thrown['kind'], x: s.x, y: s.y, sx: s.x, sy: s.y, tx: s.x + Math.cos(a) * d, ty: s.y + Math.sin(a) * d, t: 0, flight: 0.25 + d / 700, fuse: 0.9, team: s.team, owner: s.id });
      break;
    }
    default: return;
  }
  if (g.ammo > 0) st.ammo--;
  st.cd = g.cd;
}

function throwFrag(b: Battle, s: Soldier) {
  if (s.frags <= 0) return;
  const c = s.ctl;
  const d = Math.max(60, Math.min(FRAG.maxRange, Math.hypot(c.tx - s.x, c.ty - s.y)));
  b.thrown.push({ kind: 'frag', x: s.x, y: s.y, sx: s.x, sy: s.y, tx: s.x + Math.cos(s.ang) * d, ty: s.y + Math.sin(s.ang) * d, t: 0, flight: 0.3 + d / 650, fuse: FRAG.fuse, team: s.team, owner: s.id });
  s.frags--;
}

function spot(b: Battle, s: Soldier) {
  const recon = s.cls === 'recon';
  const range = recon ? 1400 : 900;
  let n = 0;
  for (const o of b.soldiers) {
    if (o.team === s.team || o.state === 2) continue;
    const d = dist(s, o);
    if (d > range || Math.abs(angDiff(Math.atan2(o.y - s.y, o.x - s.x), s.ang)) > 0.45) continue;
    if (!los(b.world, s.x, s.y, o.x, o.y)) continue;
    o.spotT = recon ? 12 : 6;
    n++;
  }
  for (const v of b.vehicles) {
    if (!v.alive || v.team === s.team || dist(s, v) > range * 1.3) continue;
    if (Math.abs(angDiff(Math.atan2(v.y - s.y, v.x - s.x), s.ang)) > 0.5) continue;
    v.mapT = recon ? 12 : 6;
    n++;
  }
  if (n && s === b.player) emit(b, { k: 'msg', text: `적 ${n} 표시`, tone: 'info' });
}

// ───────── 병사 ─────────

function updateSoldier(b: Battle, s: Soldier, dt: number) {
  const c = s.ctl;
  s.spotT = Math.max(0, s.spotT - dt);
  s.mapT = Math.max(0, s.mapT - dt);
  if (s.state === 2) {
    s.deadT += dt;
    if (s.bot) {
      s.respawnT -= dt;
      if (s.respawnT <= 0 && !b.over && b.tickets[s.team] > 0) botSpawn(b, s);
    }
    return;
  }
  if (s.state === 1) {
    s.downT -= dt;
    if (s.revive > 0) s.revive = Math.max(0, s.revive - dt * 0.15);
    if (s.downT <= 0) die(b, s);
    return;
  }
  if (s.bot) botThink(b, s, dt);
  s.protect = Math.max(0, s.protect - dt);
  s.suppress = Math.max(0, s.suppress - dt * 0.45);
  s.stimT = Math.max(0, s.stimT - dt);
  s.swapT = Math.max(0, s.swapT - dt);
  s.ga.cd = Math.max(0, s.ga.cd - dt);
  s.gb.cd = Math.max(0, s.gb.cd - dt);
  s.fireT -= dt;
  s.bloom = Math.max(0, s.bloom - s.ws.recover * dt);
  if (s.heat > 0) s.heat = Math.max(0, s.heat - dt * 0.18);

  // 차량에 타고 있다
  if (s.veh >= 0) {
    if (c.interactE) { exitVehicle(b, s, false); return; }
    if (c.seatE) switchSeat(b, s);
    const v = b.vehicles[s.veh];
    s.x = v.x; s.y = v.y; s.vx = 0; s.vy = 0; s.ang = c.aim;
    return;
  }

  // 자세와 이동
  s.crouch = c.crouch;
  s.ads = c.ads && s.reloadT <= 0;
  const firing = c.fire && s.fireT > -0.2;
  s.sprint = c.sprint && !s.ads && !s.crouch && !c.fire && (c.mx || c.my) !== 0;
  let sp = WALK * s.ws.move * (s.stimT > 0 ? 1.25 : 1) * (s.cls === 'assault' ? 1.03 : 1);
  if (s.crouch) sp *= CROUCH_MUL;
  if (s.ads) sp *= ADS_MUL * (s.ws.scope ? 0.8 : 1);
  if (s.sprint) sp *= SPRINT_MUL;
  if (firing && !s.ads) sp *= 0.85;
  let mx = c.mx, my = c.my;
  const ml = Math.hypot(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  const k = Math.min(1, dt * 14);
  s.vx += (mx * sp - s.vx) * k;
  s.vy += (my * sp - s.vy) * k;
  const ox = s.x, oy = s.y;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  collide(b.world, s, SOLDIER_R);
  // 서로 겹치지 않게 민다
  forNear(b, s.x, s.y, SOLDIER_R * 2, (o, d2) => {
    if (o === s || d2 < 1e-6) return;
    const d = Math.sqrt(d2);
    const push = (SOLDIER_R * 2 - d) * 0.5;
    s.x += ((s.x - o.x) / d) * push;
    s.y += ((s.y - o.y) / d) * push;
  });
  s.vx = (s.x - ox) / dt;
  s.vy = (s.y - oy) / dt;
  const spd = Math.hypot(s.vx, s.vy);
  if (spd > 10) {
    s.walk += spd * dt * 0.06;
    s.legAng = Math.atan2(s.vy, s.vx);
  }
  s.ang = c.aim;

  // 상호작용: 소생 우선, 아니면 차량 탑승
  if (c.interact) {
    const downed = reviveTarget(b, s);
    if (downed) {
      const time = s.cls === 'medic' ? 1 : 3.5;
      downed.revive += dt / time;
      s.vx *= 0.3; s.vy *= 0.3;
      if (downed.revive >= 1) reviveSoldier(b, downed, s);
    } else if (c.interactE) {
      const v = nearVehicle(b, s);
      if (v) { enterVehicle(b, s, v); return; }
    }
  }
  if (c.spotE) spot(b, s);
  if (c.primaryE && s.held !== 0) { s.held = 0; s.swapT = 0.3; }
  if (c.useAE) useGadget(b, s, 1);
  if (c.useBE) useGadget(b, s, 2);
  if (c.grenadeE && s.swapT <= 0) throwFrag(b, s);

  // 재장전과 사격
  if (s.reloadT > 0) {
    s.reloadT -= dt;
    if (s.reloadT <= 0) {
      const need = s.ws.mag - s.mag;
      const take = s.bot ? need : Math.min(need, s.reserve);
      s.mag += take;
      if (!s.bot) s.reserve -= take;
    }
  } else if (c.reloadE && s.held === 0) startReload(s);

  if (s.held === 0) {
    if (c.fire && s.reloadT <= 0 && s.fireT <= 0 && s.mag > 0 && s.swapT <= 0 && !(s.ws.auto === false && s.triggerHeld)) shoot(b, s);
  } else {
    const [id, st] = gadgetOf(s, s.held);
    if (id === 'repair') {
      if (c.fire && s.heat < 1) {
        s.heat += dt / 7;
        if (s.heat >= 1) s.heat = 1.6;
        for (const v of b.vehicles) {
          if (!v.alive || v.team !== s.team || v.hp >= v.maxHp) continue;
          if (dist(v, s) > VEHICLES[v.type].r + 46) continue;
          const before = v.hp;
          v.hp = Math.min(v.maxHp, v.hp + 150 * dt);
          if (Math.floor(before / 100) !== Math.floor(v.hp / 100)) award(b, s, 10, '차량 수리');
          if (rand(b) < 0.4) emit(b, { k: 'impact', x: s.x + Math.cos(s.ang) * 22, y: s.y + Math.sin(s.ang) * 22, a: s.ang, m: 'spark' });
          break;
        }
      }
    } else if (id === 'aa') {
      // 대공 미사일: 헬기를 겨누면 잠긴다
      let lock = -1;
      for (const v of b.vehicles) {
        if (!v.alive || v.team === s.team || v.type !== 'heli') continue;
        const d = dist(v, s);
        if (d > 1300 || Math.abs(angDiff(Math.atan2(v.y - s.y, v.x - s.x), s.ang)) > 0.18) continue;
        lock = v.id;
        break;
      }
      if (lock >= 0 && lock === s.lockId) s.lockT += dt; else { s.lockId = lock; s.lockT = lock >= 0 ? dt : 0; }
      if (c.fire && !s.triggerHeld && s.swapT <= 0 && st.ammo > 0) fireGadget(b, s, s.held);
    } else if (c.fire && !s.triggerHeld && s.swapT <= 0) {
      fireGadget(b, s, s.held);
      if (st.ammo <= 0 && GADGETS[id].ammo > 0) { s.held = 0; s.swapT = 0.4; }
    }
  }
  s.triggerHeld = c.fire;

  // 체력 회복
  const delay = s.cls === 'assault' ? 3 : 5;
  if (b.time - s.lastHurtT > delay && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + (s.bot ? 9 : 14) * dt);
}

function reviveTarget(b: Battle, s: Soldier): Soldier | null {
  let best: Soldier | null = null, bd = 44;
  for (const o of b.soldiers) {
    if (o.state !== 1 || o.team !== s.team) continue;
    if (s.cls !== 'medic' && o.squad !== s.squad) continue;
    const d = dist(o, s);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

export function reviveSoldier(b: Battle, o: Soldier, by: Soldier) {
  o.state = 0;
  o.hp = by.cls === 'medic' ? o.maxHp : 45;
  o.downT = 0;
  o.revive = 0;
  o.protect = 1.2;
  o.lastHurtT = b.time;
  by.revives++;
  award(b, by, by.cls === 'medic' ? 80 : 50, '아군 소생');
  emit(b, { k: 'heal', x: o.x, y: o.y });
  if (o === b.player) emit(b, { k: 'msg', text: `${by.name}이(가) 일으켜 세웠습니다`, tone: 'good' });
}

// ───────── 탄 ─────────

function impactMat(b: Battle, i: number): string {
  if (i < 0) return 'dirt';
  const w = b.world;
  const t = w.t[i];
  if (t === WATER) return 'water';
  if (t === TREE || (t === WALL && w.mat[i] === M_WOOD)) return 'wood';
  if (t === CONTAINER || t === WRECK || w.mat[i] === M_METAL) return 'metal';
  if (t === WALL || t === RUBBLE || w.mat[i] === M_CONCRETE) return 'concrete';
  if (t === SANDBAG) return 'dirt';
  return w.gnd[i] === 1 ? 'snow' : 'dirt';
}

function vehMult(kind: Projectile['kind'], type: Vehicle['type']): number {
  const d = VEHICLES[type];
  switch (kind) {
    case 'bullet': return d.vsBullet;
    case 'hmg': return d.vsBullet * 2.6;
    case 'cannon': return d.vsCannon;
    case 'missile': return type === 'heli' ? 1 : 0.4;
    default: return d.vsBlast;
  }
}

const BLAST = new Set<Projectile['kind']>(['shell', 'rocket', 'gl', 'missile', 'hrocket']);

function updateProjectiles(b: Battle, dt: number) {
  const w = b.world;
  let wi = 0;
  for (let pi = 0; pi < b.proj.length; pi++) {
    const p = b.proj[pi];
    if (p.kind === 'missile' && p.target >= 0) {
      const v = b.vehicles[p.target];
      if (!v.alive) p.target = -1;
      else {
        const want = Math.atan2(v.y - p.y, v.x - p.x);
        const cur = Math.atan2(p.vy, p.vx);
        const na = cur + Math.max(-2.6 * dt, Math.min(2.6 * dt, angDiff(want, cur)));
        const sp = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
      }
    }
    const len = Math.hypot(p.vx, p.vy) * dt;
    let tEnd = 1;
    if (p.traveled + len > p.maxDist) tEnd = Math.max(0, (p.maxDist - p.traveled) / len);
    const ex = p.x + p.vx * dt * tEnd, ey = p.y + p.vy * dt * tEnd;
    let hitT = Infinity, hitS: import('./types').Soldier | null = null, hitV: Vehicle | null = null;
    const late = !p.air || p.traveled + len * tEnd > p.maxDist * 0.72;
    if (late && p.kind !== 'smokegl') {
      forSegment(b, p.x, p.y, ex, ey, SOLDIER_R + 1.5, (s, t) => {
        if (s.team === p.team || t >= hitT) return;
        if (p.kind === 'gl' && p.traveled + len * t < 40) return;
        hitT = t; hitS = s;
      });
      for (const v of b.vehicles) {
        if (!v.alive || v.team === p.team) continue;
        const air = VEHICLES[v.type].air;
        if (air && (p.kind === 'gl' || p.air)) continue;
        if (!air && p.air && p.traveled + len < p.maxDist * 0.72) continue;
        const r = VEHICLES[v.type].r;
        const dx = ex - p.x, dy = ey - p.y, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((v.x - p.x) * dx + (v.y - p.y) * dy) / l2));
        const px = p.x + dx * t - v.x, py = p.y + dy * t - v.y;
        if (px * px + py * py <= r * r && t < hitT) { hitT = t; hitV = v; hitS = null; }
      }
    }
    let wallT = Infinity, wallI = -1;
    if (!p.air) {
      const target = hitS as import('./types').Soldier | null;
      traverse(w, p.x, p.y, ex, ey, (i, t) => {
        if (t > hitT) return true;
        if (i < 0) { wallT = t; return true; }
        const tt = w.t[i];
        if (SHOT_BLOCK[tt]) { wallT = t; wallI = i; return true; }
        if (tt === WINDOW && !(w.vis[i] & 1)) { w.vis[i] |= 1; w.changed.push(i); const cx = i % w.cw; emit(b, { k: 'glass', x: (cx + 0.5) * CELL, y: ((i - cx) / w.cw + 0.5) * CELL }); }
        if (SHOT_PARTIAL[tt] && i !== p.lastCell && !BLAST.has(p.kind)) {
          p.lastCell = i;
          let chance = SHOT_PARTIAL[tt];
          if (target && target.crouch) {
            const cx = i % w.cw, cy = (i - cx) / w.cw;
            if (Math.hypot((cx + 0.5) * CELL - target.x, (cy + 0.5) * CELL - target.y) < 75) chance = 88;
          }
          if (rand(b) * 100 < chance) { wallT = t; wallI = i; return true; }
        }
        return false;
      });
    }
    const tHit = Math.min(hitT, wallT);
    const dx = ex - p.x, dy = ey - p.y;
    const a = Math.atan2(p.vy, p.vx);
    let alive = true;
    // 지나가는 탄이 근처 병사를 제압한다
    if ((p.kind === 'bullet' || p.kind === 'hmg' || p.kind === 'cannon') && !p.air) {
      const lim = Math.min(1, tHit);
      forSegment(b, p.x, p.y, p.x + dx * lim, p.y + dy * lim, 46, (s, _t, d) => {
        if (s.team === p.team || s === hitS || d < SOLDIER_R + 2) return;
        s.suppress = Math.min(1, s.suppress + (p.kind === 'bullet' ? 0.07 : 0.2));
        if (s === b.player && rand(b) < 0.35) emit(b, { k: 'whiz', x: s.x, y: s.y });
      });
    }
    if (tHit <= 1) {
      const hx = p.x + dx * Math.max(0, tHit - 0.01), hy = p.y + dy * Math.max(0, tHit - 0.01);
      const traveled = p.traveled + len * tEnd * tHit;
      alive = false;
      if (hitT <= wallT && (hitS || hitV)) {
        if (hitV) {
          const v = hitV as Vehicle;
          damageVehicle(b, v, p.dmg * vehMult(p.kind, v.type), p.owner, BLAST.has(p.kind) ? 'blast' : p.kind, p.x - p.vx, p.y - p.vy);
          emit(b, { k: 'impact', x: hx, y: hy, a, m: 'metal' });
        } else if (hitS) {
          const s = hitS as import('./types').Soldier;
          let dmg = p.dmg;
          if (p.kind === 'bullet') dmg = traveled <= p.near ? p.dmg : traveled >= p.far ? p.dmgFar : p.dmg + ((p.dmgFar - p.dmg) * (traveled - p.near)) / (p.far - p.near);
          if (!BLAST.has(p.kind) || p.kind === 'gl') damageSoldier(b, s, p.kind === 'gl' ? 0 : dmg, p.owner, a + Math.PI, p.weapon);
          emit(b, { k: 'blood', x: s.x, y: s.y, a });
        }
      } else {
        emit(b, { k: 'impact', x: hx, y: hy, a, m: impactMat(b, wallI) });
        if (wallI >= 0 && (p.kind === 'cannon' || p.kind === 'hmg')) damageCell(b, wallI, p.wall);
      }
      if (BLAST.has(p.kind)) explode(b, hx, hy, p.splashR, p.splash, p.team, p.owner, p.wall, p.weapon, p.kind === 'gl' ? 0.25 : 0.4);
      else if (p.kind === 'cannon' && p.splash) explode(b, hx, hy, p.splashR, p.splash, p.team, p.owner, 0, p.weapon, 0);
      else if (p.kind === 'smokegl') makeSmoke(b, hx, hy);
    } else {
      p.x = ex; p.y = ey;
      p.traveled += len * tEnd;
      if (tEnd < 1) {
        alive = false;
        if (BLAST.has(p.kind)) explode(b, p.x, p.y, p.splashR, p.splash, p.team, p.owner, p.wall, p.weapon, 0.4);
        else if (p.kind === 'smokegl') makeSmoke(b, p.x, p.y);
        else if (p.kind === 'cannon') { emit(b, { k: 'impact', x: p.x, y: p.y, a, m: impactMat(b, cellOf(w, p.x, p.y)) }); if (p.splash) explode(b, p.x, p.y, p.splashR, p.splash, p.team, p.owner, 0, p.weapon, 0); }
      }
    }
    p.life -= dt;
    if (alive && p.life <= 0) { alive = false; if (BLAST.has(p.kind)) explode(b, p.x, p.y, p.splashR, p.splash, p.team, p.owner, p.wall, p.weapon, 0.4); }
    if (alive) b.proj[wi++] = p;
  }
  b.proj.length = wi;
}

export function makeSmoke(b: Battle, x: number, y: number, r = 170) {
  b.world.smokes.push({ x, y, r, t: 0, life: 15 });
  emit(b, { k: 'smoke', x, y, r });
}

function updateThrown(b: Battle, dt: number) {
  for (let i = b.thrown.length - 1; i >= 0; i--) {
    const g = b.thrown[i];
    g.t += dt;
    const f = Math.min(1, g.t / g.flight);
    // 벽에 부딪히면 그 자리에 떨어진다
    const nx = g.sx + (g.tx - g.sx) * f, ny = g.sy + (g.ty - g.sy) * f;
    const ci = cellOf(b.world, nx, ny);
    if (ci < 0 || (SHOT_BLOCK[b.world.t[ci]] && f < 1)) { g.tx = g.x; g.ty = g.y; g.sx = g.x; g.sy = g.y; g.flight = 0.0001; }
    else { g.x = nx; g.y = ny; }
    if (g.kind === 'frag') {
      if (g.t >= g.fuse) {
        explode(b, g.x, g.y, FRAG.r, FRAG.dmg, g.team, g.owner, FRAG.wall, FRAG.name, 0.15);
        b.thrown.splice(i, 1);
      }
    } else if (f >= 1) {
      if (g.kind === 'smoke') makeSmoke(b, g.x, g.y);
      else b.items.push({ id: b.nextItem++, kind: g.kind, team: g.team, owner: g.owner, x: g.x, y: g.y, ang: 0, t: 0, life: g.kind === 'sensor' ? 20 : 13, tick: 0, tx: g.x, ty: g.y });
      b.thrown.splice(i, 1);
    }
  }
}

function updateItems(b: Battle, dt: number) {
  for (let i = b.items.length - 1; i >= 0; i--) {
    const it = b.items[i];
    it.t += dt;
    it.tick -= dt;
    const owner = b.soldiers[it.owner];
    if (it.t >= it.life) { b.items.splice(i, 1); continue; }
    switch (it.kind) {
      case 'medbag':
        forNear(b, it.x, it.y, 115, (s) => {
          if (s.team !== it.team || s.hp >= s.maxHp) return;
          s.hp = Math.min(s.maxHp, s.hp + 20 * dt);
          if (s !== owner && it.tick <= 0) award(b, owner, 10, '치료');
        });
        if (it.tick <= 0) it.tick = 2;
        break;
      case 'ammobox':
        if (it.tick <= 0) {
          it.tick = 1.5;
          forNear(b, it.x, it.y, 115, (s) => {
            if (s.team !== it.team) return;
            let gave = false;
            if (s.reserve < s.ws.mag * s.ws.mags) { s.reserve = Math.min(s.ws.mag * s.ws.mags, s.reserve + s.ws.mag); gave = true; }
            for (const [id, st] of [[s.kit.ga, s.ga], [s.kit.gb, s.gb]] as const) {
              const max = GADGETS[id].ammo;
              if (max && st.ammo < max) { st.ammo++; gave = true; }
            }
            if (s.frags < FRAG.count) { s.frags++; gave = true; }
            if (gave && s !== owner) award(b, owner, 10, '탄약 보급');
          });
        }
        break;
      case 'mine':
        if (it.t < 1.5) break;
        for (const v of b.vehicles) {
          if (!v.alive || v.team === it.team || VEHICLES[v.type].air || dist(v, it) > VEHICLES[v.type].r + 10) continue;
          damageVehicle(b, v, 560, it.owner, 'blast', it.x, it.y);
          explode(b, it.x, it.y, 80, 60, it.team, it.owner, 120, '대전차 지뢰', 0);
          b.items.splice(i, 1);
          break;
        }
        break;
      case 'claymore': {
        if (it.t < 1.5) break;
        let trig = false;
        forNear(b, it.x, it.y, 70, (s) => {
          if (s.team === it.team || trig) return;
          if (Math.abs(angDiff(Math.atan2(s.y - it.y, s.x - it.x), it.ang)) < 0.8) trig = true;
        });
        if (trig) {
          explode(b, it.x + Math.cos(it.ang) * 30, it.y + Math.sin(it.ang) * 30, 95, 150, it.team, it.owner, 40, '대인 지뢰', 0.1);
          b.items.splice(i, 1);
        }
        break;
      }
      case 'drone': {
        const dx = it.tx - it.x, dy = it.ty - it.y, d = Math.hypot(dx, dy);
        if (d > 10) { it.x += (dx / d) * Math.min(d, 300 * dt); it.y += (dy / d) * Math.min(d, 300 * dt); it.ang = Math.atan2(dy, dx); }
        if (it.tick <= 0) {
          it.tick = 1;
          for (const s of b.soldiers) if (s.team !== it.team && s.state !== 2 && dist(s, it) < 480) { if (s.spotT < 2) award(b, owner, 5, '드론 정찰'); s.spotT = Math.max(s.spotT, 2.2); }
          for (const v of b.vehicles) if (v.alive && v.team !== it.team && dist(v, it) < 560) v.mapT = Math.max(v.mapT, 2.2);
        }
        break;
      }
      case 'sensor':
        if (it.tick <= 0) {
          it.tick = 0.5;
          for (const s of b.soldiers) if (s.team !== it.team && s.state === 0 && dist(s, it) < 290 && Math.hypot(s.vx, s.vy) > 40) s.spotT = Math.max(s.spotT, 1.5);
        }
        break;
      case 'beacon':
        if (!owner || owner.team !== it.team) b.items.splice(i, 1);
        break;
    }
  }
  // 적이 밟은 비컨과 지뢰는 총으로 부술 수 없지만 폭발로는 사라진다 (단순화: 시간 제한 없음)
}

// ───────── 거점과 티켓 ─────────

function updateFlags(b: Battle, dt: number) {
  for (const f of b.flags) {
    f.n[0] = 0; f.n[1] = 0;
    for (const s of b.soldiers) {
      if (s.state !== 0) continue;
      if (s.veh >= 0 && VEHICLES[b.vehicles[s.veh].type].air) continue;
      if ((s.x - f.x) ** 2 + (s.y - f.y) ** 2 < FLAG_R * FLAG_R) f.n[s.team]++;
    }
    const diff = f.n[0] - f.n[1];
    const before = f.owner;
    if (diff !== 0) {
      const rate = (0.05 + 0.016 * Math.min(Math.abs(diff), 6)) * dt;
      f.prog = Math.max(-1, Math.min(1, f.prog + (diff > 0 ? -rate : rate)));
    } else if (!f.n[0] && !f.n[1] && f.owner >= 0) {
      const home = f.owner === 0 ? -1 : 1;
      f.prog += Math.sign(home - f.prog) * Math.min(Math.abs(home - f.prog), 0.03 * dt);
    }
    if (f.prog <= -1) f.owner = 0;
    else if (f.prog >= 1) f.owner = 1;
    else if ((f.owner === 0 && f.prog > 0) || (f.owner === 1 && f.prog < 0)) f.owner = -1;
    if (f.owner !== before) {
      const neutral = f.owner < 0;
      const team = neutral ? (before === 0 ? 1 : 0) : f.owner;
      for (const s of b.soldiers) {
        if (s.state !== 0 || s.team !== team || (s.x - f.x) ** 2 + (s.y - f.y) ** 2 >= FLAG_R * FLAG_R) continue;
        if (neutral) award(b, s, 100, `거점 ${f.tag} 무력화`);
        else { award(b, s, 200, `거점 ${f.tag} 점령`); s.caps++; }
      }
      if (!neutral) emit(b, { k: 'cap', tag: f.tag, team: f.owner, lost: before === 0 });
      else if (before === 0) emit(b, { k: 'msg', text: `거점 ${f.tag}을(를) 빼앗기는 중`, tone: 'bad' });
    }
  }
  b.bleedT -= dt;
  if (b.bleedT <= 0) {
    b.bleedT = BLEED_EVERY;
    const c0 = b.flags.filter((f) => f.owner === 0).length, c1 = b.flags.filter((f) => f.owner === 1).length;
    const half = b.flags.length / 2;
    if (c0 > c1 && c0 > half) b.tickets[1] = Math.max(0, b.tickets[1] - (c0 - c1));
    else if (c1 > c0 && c1 > half) b.tickets[0] = Math.max(0, b.tickets[0] - (c1 - c0));
  }
}

function checkOver(b: Battle) {
  if (b.over) return;
  const [a, e] = b.tickets;
  if (e <= 0 && a > 0) b.over = { win: true, why: '적의 증원 티켓이 바닥났다.' };
  else if (a <= 0) b.over = { win: false, why: '아군의 증원 티켓이 바닥났다.' };
  else if (b.time >= b.limit) b.over = a > e ? { win: true, why: `시간 종료. 티켓 ${a} 대 ${e}로 앞섰다.` } : { win: false, why: `시간 종료. 티켓 ${a} 대 ${e}로 밀렸다.` };
}

/** 플레이어 눈에 보이는 적 */
function updateSeen(b: Battle) {
  const p = b.player;
  const pv = p.veh >= 0 ? b.vehicles[p.veh] : null;
  const px = pv ? pv.x : p.x, py = pv ? pv.y : p.y;
  const air = !!pv && VEHICLES[pv.type].air;
  const alive = p.state === 0;
  const w = b.world;
  for (const s of b.soldiers) {
    if (s.team === 0) continue;
    if (s.state === 2) { s.seen = false; continue; }
    if (s.spotT > 0) { s.seen = true; continue; }
    if (!alive) { s.seen = false; continue; }
    const sx = s.veh >= 0 ? b.vehicles[s.veh].x : s.x, sy = s.veh >= 0 ? b.vehicles[s.veh].y : s.y;
    const d2 = (sx - px) ** 2 + (sy - py) ** 2;
    if (air) {
      const ci = cellOf(w, sx, sy);
      s.seen = d2 < 1400 * 1400 && !(ci >= 0 && w.roof[ci]);
    } else s.seen = d2 < 1300 * 1300 && (d2 < 110 * 110 || los(w, px, py, sx, sy));
  }
  for (const v of b.vehicles) {
    if (v.team === 0) continue;
    if (!v.alive) { v.seen = false; continue; }
    const d2 = (v.x - px) ** 2 + (v.y - py) ** 2;
    v.seen = v.mapT > 0 || (alive && (VEHICLES[v.type].air ? d2 < 1800 * 1800 : d2 < 1500 * 1500 && (air || los(w, px, py, v.x, v.y))));
  }
}

export function step(b: Battle, dt: number) {
  if (b.over) return;
  b.time += dt;
  rebuildHash(b);
  updateNav(b.world, b.nav, dt);
  b.cmdT -= dt;
  if (b.cmdT <= 0) { b.cmdT = 4; commander(b); }
  for (const s of b.soldiers) updateSoldier(b, s, dt);
  for (const v of b.vehicles) updateVehicle(b, v, dt);
  updateProjectiles(b, dt);
  updateThrown(b, dt);
  updateItems(b, dt);
  const sm = b.world.smokes;
  for (let i = sm.length - 1; i >= 0; i--) { sm[i].t += dt; if (sm[i].t >= sm[i].life) sm.splice(i, 1); }
  updateFlags(b, dt);
  b.seenT -= dt;
  if (b.seenT <= 0) { b.seenT = 0.1; updateSeen(b); }
  // 한 프레임짜리 입력 끄기
  for (const s of b.soldiers) {
    const c = s.ctl;
    c.reloadE = c.primaryE = c.useAE = c.useBE = c.grenadeE = c.interactE = c.seatE = c.spotE = c.counterE = false;
  }
  checkOver(b);
}

export { BRIDGE, SANDBAG };
