// 차량: 생성, 탑승과 하차, 주행, 무기, 피해와 파괴
import { DIFFS, SEAT_WEAPON, VEHICLES, VWEAPONS, type Team, type VehicleType, type VehicleDef } from './defs';
import {
  CELL, CRUSH_HEAVY, CRUSH_LIGHT, DOOR, FENCE, GROUND, RUBBLE, SANDBAG, STUMP, TREE, VEH_BLOCK, WALL, WINDOW, WRECK,
  collide, freeSpot, setCell,
} from './grid';
import { angDiff, award, damageCell, damageSoldier, dist, emit, enemyOf, explode, forNear, makeSmoke, rand } from './battle';
import type { Battle, Projectile, Soldier, Vehicle } from './types';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function createVehicle(b: Battle, team: Team, type: VehicleType, pad: number): Vehicle {
  const p = b.world.pads[pad];
  const d = VEHICLES[type];
  const seats = d.seats;
  const v: Vehicle = {
    id: b.vehicles.length, team, type, pad, x: p.x, y: p.y, ang: p.ang, spd: 0, vx: 0, vy: 0, tang: p.ang, tang2: p.ang,
    hp: d.hp, maxHp: d.hp, alive: true, respawnT: 0, seats: new Array(seats).fill(-1), fireT: new Array(seats).fill(0),
    mag: SEAT_WEAPON[type].map((w) => (w ? VWEAPONS[w].mag : 0)), reloadT: new Array(seats).fill(0), coaxT: 0, coaxMag: 200,
    cmCd: 0, track: 0, rotor: 0, lastHurtT: -99, idleT: 0, seen: team === 0, mapT: 0, dmgLog: [], stuckT: 0, lx: p.x, ly: p.y, revT: 0, goal: -1,
  };
  return v;
}

export function enterVehicle(b: Battle, s: Soldier, v: Vehicle, prefer = -1): boolean {
  if (!v.alive || v.team !== s.team) return false;
  let seat = prefer >= 0 && v.seats[prefer] < 0 ? prefer : v.seats.indexOf(-1);
  if (seat < 0) return false;
  if (prefer < 0 && v.seats[0] < 0) seat = 0;
  v.seats[seat] = s.id;
  s.veh = v.id;
  s.seat = seat;
  s.ads = false; s.held = 0; s.reloadT = 0; s.crouch = false;
  s.x = v.x; s.y = v.y; s.vx = 0; s.vy = 0;
  v.idleT = 0;
  return true;
}

export function exitVehicle(b: Battle, s: Soldier, force: boolean) {
  if (s.veh < 0) return;
  const v = b.vehicles[s.veh];
  const d = VEHICLES[v.type];
  if (!force && d.air && Math.hypot(v.vx, v.vy) > 140) {
    if (s === b.player) emit(b, { k: 'msg', text: '너무 빠르게 날고 있어 내릴 수 없습니다', tone: 'bad' });
    return;
  }
  v.seats[s.seat] = -1;
  s.veh = -1;
  s.seat = -1;
  const side = s.ang + Math.PI / 2;
  const p = freeSpot(b.world, v.x + Math.cos(side) * (d.r + 12), v.y + Math.sin(side) * (d.r + 12), 40, () => rand(b));
  s.x = p.x; s.y = p.y;
  s.protect = Math.max(s.protect, 0.4);
}

export function switchSeat(b: Battle, s: Soldier) {
  const v = b.vehicles[s.veh];
  for (let k = 1; k <= v.seats.length; k++) {
    const n = (s.seat + k) % v.seats.length;
    if (v.seats[n] < 0) {
      v.seats[s.seat] = -1;
      v.seats[n] = s.id;
      s.seat = n;
      return;
    }
  }
}

export function nearVehicle(b: Battle, s: Soldier): Vehicle | null {
  let best: Vehicle | null = null, bd = Infinity;
  for (const v of b.vehicles) {
    if (!v.alive || v.team !== s.team || !v.seats.includes(-1)) continue;
    const d = dist(v, s) - VEHICLES[v.type].r;
    if (d < 42 && d < bd) { bd = d; best = v; }
  }
  return best;
}

export function damageVehicle(b: Battle, v: Vehicle, dmg: number, by: number, kind: string, fx: number, fy: number) {
  if (!v.alive || dmg <= 0 || b.over) return;
  const d = VEHICLES[v.type];
  if (kind === 'blast') {
    const rel = Math.abs(angDiff(Math.atan2(fy - v.y, fx - v.x), v.ang));
    dmg *= rel < Math.PI / 4 ? d.armor[0] : rel > (Math.PI * 3) / 4 ? d.armor[2] : d.armor[1];
  }
  const pl = b.player;
  const mine = pl.veh === v.id;
  if (mine) dmg *= DIFFS[b.diff].taken;
  if (by === pl.id && v.team !== pl.team) dmg *= DIFFS[b.diff].dealt;
  v.hp -= dmg;
  v.lastHurtT = b.time;
  if (by >= 0) { v.dmgLog.push({ by, dmg, t: b.time }); if (v.dmgLog.length > 8) v.dmgLog.shift(); }
  if (mine) emit(b, { k: 'hurt', a: Math.atan2(fy - v.y, fx - v.x), dmg: dmg * 0.25 });
  if (by === pl.id && v.team !== pl.team) emit(b, { k: 'hit', kill: v.hp <= 0, veh: true });
  for (const sid of v.seats) if (sid >= 0) { const s = b.soldiers[sid]; s.lastHurtT = b.time; if (s.bot) { s.ai.lastX = fx; s.ai.lastY = fy; s.ai.lastT = b.time; } }
  if (v.hp <= 0) destroyVehicle(b, v, by);
}

function destroyVehicle(b: Battle, v: Vehicle, by: number) {
  const d = VEHICLES[v.type];
  v.alive = false;
  v.hp = 0;
  v.respawnT = d.respawn;
  v.spd = 0; v.vx = 0; v.vy = 0;
  const k = by >= 0 ? b.soldiers[by] : null;
  if (k && k.team !== v.team) {
    k.vkills++;
    award(b, k, v.type === 'jeep' ? 150 : v.type === 'ifv' ? 250 : 300, `${d.name} 파괴`);
    for (const e of v.dmgLog) {
      if (e.by === by || b.time - e.t > 20 || e.dmg < 80) continue;
      const a = b.soldiers[e.by];
      if (a.team !== v.team) { award(b, a, 80, '차량 파괴 지원'); e.dmg = 0; }
    }
  }
  emit(b, { k: 'vdead', x: v.x, y: v.y, type: v.type, team: v.team });
  emit(b, { k: 'feed', killer: k ? k.name : '', victim: d.name, w: '', kt: k ? k.team : enemyOf(v.team), vt: v.team, me: k === b.player || v.seats.includes(b.player.id) });
  const team = k ? k.team : enemyOf(v.team);
  for (const sid of v.seats) {
    if (sid < 0) continue;
    const s = b.soldiers[sid];
    exitVehicle(b, s, true);
    s.protect = 0;
    damageSoldier(b, s, d.air ? 160 : 70, by, 0, d.name);
  }
  explode(b, v.x, v.y, d.air ? 110 : 130, 80, team, by, d.air ? 80 : 160, d.name, 0.3);
}

function respawnVehicle(b: Battle, v: Vehicle) {
  const p = b.world.pads[v.pad];
  const d = VEHICLES[v.type];
  Object.assign(v, {
    x: p.x, y: p.y, ang: p.ang, tang: p.ang, tang2: p.ang, spd: 0, vx: 0, vy: 0, hp: d.hp, alive: true, respawnT: 0, idleT: 0,
    cmCd: 0, lastHurtT: -99, dmgLog: [], stuckT: 0, revT: 0,
  });
  v.seats.fill(-1);
  v.mag = SEAT_WEAPON[v.type].map((w) => (w ? VWEAPONS[w].mag : 0));
  v.reloadT.fill(0);
}

function crush(b: Battle, v: Vehicle, d: VehicleDef, dt: number) {
  const w = b.world;
  const heavy = d.crush === 'heavy';
  const table = heavy ? CRUSH_HEAVY : CRUSH_LIGHT;
  const r = d.r * 0.9;
  const fx = v.x + Math.cos(v.ang) * Math.sign(v.spd) * 6, fy = v.y + Math.sin(v.ang) * Math.sign(v.spd) * 6;
  const x0 = Math.floor((fx - r) / CELL), x1 = Math.floor((fx + r) / CELL), y0 = Math.floor((fy - r) / CELL), y1 = Math.floor((fy + r) / CELL);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (cx < 0 || cy < 0 || cx >= w.cw || cy >= w.ch) continue;
    const i = cy * w.cw + cx;
    const t = w.t[i];
    const nx = Math.max(cx * CELL, Math.min(fx, (cx + 1) * CELL)), ny = Math.max(cy * CELL, Math.min(fy, (cy + 1) * CELL));
    if ((nx - fx) ** 2 + (ny - fy) ** 2 > (r + 3) ** 2) continue;
    if (table[t]) {
      const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
      if (t === TREE) { setCell(w, i, STUMP); emit(b, { k: 'tree', x, y, a: v.ang }); }
      else { setCell(w, i, t === WRECK ? RUBBLE : GROUND); emit(b, { k: 'crush', x, y }); }
      v.spd *= heavy ? 0.92 : 0.7;
    } else if (heavy && Math.abs(v.spd) > 35 && (t === WALL || t === WINDOW || t === DOOR)) {
      damageCell(b, i, 520 * dt * (Math.abs(v.spd) / 100));
    }
  }
}

function moveGround(b: Battle, v: Vehicle, d: VehicleDef, drv: Soldier | null, dt: number) {
  let want = 0, steer = 0;
  if (drv) {
    const c = drv.ctl;
    const m = Math.min(1, Math.hypot(c.mx, c.my));
    if (m > 0.15) {
      const ta = Math.atan2(c.my, c.mx);
      let diff = angDiff(ta, v.ang);
      if (Math.abs(diff) > 2.25 || v.revT > 0) { diff = angDiff(ta + Math.PI, v.ang); want = -m; }
      else want = m * (Math.abs(diff) < 0.8 ? 1 : 0.3);
      steer = clamp(diff * 2.4, -1, 1);
    }
  }
  const disabled = v.hp < v.maxHp * 0.2;
  const target = want * (want >= 0 ? d.speed : d.reverse) * (disabled ? 0.45 : 1);
  v.spd += (target - v.spd) * Math.min(1, dt * (Math.abs(target) > Math.abs(v.spd) ? 1.3 : 2.4));
  const turnK = v.type === 'jeep' ? clamp(Math.abs(v.spd) / 90, 0, 1) * (v.spd < 0 ? -1 : 1) : 1;
  v.ang += steer * d.turn * dt * (v.type === 'jeep' ? turnK : 1);
  const ox = v.x, oy = v.y;
  v.x += Math.cos(v.ang) * v.spd * dt;
  v.y += Math.sin(v.ang) * v.spd * dt;
  if (Math.abs(v.spd) > 5) crush(b, v, d, dt);
  collide(b.world, v, d.r * 0.92, VEH_BLOCK);
  const moved = Math.hypot(v.x - ox, v.y - oy);
  if (moved < Math.abs(v.spd) * dt * 0.4) v.spd *= 0.8;
  v.track += moved;
  if (v.track > 15) {
    v.track = 0;
    emit(b, { k: 'track', x: v.x, y: v.y, a: v.ang, w: v.type === 'jeep' ? 0 : v.type === 'ifv' ? 1 : 2 });
  }
  // 다른 차량과 겹치지 않게
  for (const o of b.vehicles) {
    if (o === v || !o.alive || VEHICLES[o.type].air) continue;
    const dd = dist(v, o), min = d.r + VEHICLES[o.type].r;
    if (dd < min && dd > 0.01) { v.x -= ((o.x - v.x) / dd) * (min - dd) * 0.5; v.y -= ((o.y - v.y) / dd) * (min - dd) * 0.5; v.spd *= 0.9; }
  }
  // 보병을 밀어내고, 달리면서 적을 친다
  const sp = Math.abs(v.spd);
  forNear(b, v.x, v.y, d.r + 10, (o, d2) => {
    const dd = Math.sqrt(d2) || 1;
    if (o.team !== v.team && sp > 70 && drv) {
      const front = (Math.cos(v.ang) * (o.x - v.x) + Math.sin(v.ang) * (o.y - v.y)) * Math.sign(v.spd);
      if (front > 0) damageSoldier(b, o, 400, drv.id, v.ang + Math.PI, d.short);
    }
    const push = d.r + 10 - dd;
    o.x += ((o.x - v.x) / dd) * push;
    o.y += ((o.y - v.y) / dd) * push;
  });
}

function moveAir(b: Battle, v: Vehicle, d: VehicleDef, drv: Soldier | null, dt: number) {
  const c = drv?.ctl;
  const m = c ? Math.min(1, Math.hypot(c.mx, c.my)) : 0;
  const tvx = c && m > 0.1 ? (c.mx / Math.max(1, Math.hypot(c.mx, c.my))) * d.speed * m : 0;
  const tvy = c && m > 0.1 ? (c.my / Math.max(1, Math.hypot(c.mx, c.my))) * d.speed * m : 0;
  const disabled = v.hp < v.maxHp * 0.2;
  const k = Math.min(1, dt * 1.25);
  v.vx += (tvx * (disabled ? 0.6 : 1) - v.vx) * k;
  v.vy += (tvy * (disabled ? 0.6 : 1) - v.vy) * k;
  v.x = clamp(v.x + v.vx * dt, 60, b.world.w - 60);
  v.y = clamp(v.y + v.vy * dt, 60, b.world.h - 60);
  if (c) v.ang += clamp(angDiff(c.aim, v.ang), -d.turn * dt, d.turn * dt);
  v.rotor += dt * (drv ? 30 : 6);
  v.spd = Math.hypot(v.vx, v.vy);
  for (const o of b.vehicles) {
    if (o === v || !o.alive || !VEHICLES[o.type].air) continue;
    const dd = dist(v, o), min = d.r * 2.2;
    if (dd < min && dd > 0.01) { v.x -= ((o.x - v.x) / dd) * (min - dd) * 0.5; v.y -= ((o.y - v.y) / dd) * (min - dd) * 0.5; }
  }
}

function fire(b: Battle, v: Vehicle, s: Soldier, wid: string, dir: number) {
  const W = VWEAPONS[wid];
  const d = VEHICLES[v.type];
  const mz = d.r + 10;
  const x = v.x + Math.cos(dir) * mz, y = v.y + Math.sin(dir) * mz;
  const a = dir + (rand(b) - 0.5) * 2 * W.spread;
  const air = d.air;
  const c = s.ctl;
  const aimDist = clamp(Math.hypot(c.tx - v.x, c.ty - v.y) - mz, 120, W.range);
  const kind: Projectile['kind'] = W.kind === 'shell' ? 'shell' : W.kind === 'cannon' ? 'cannon' : W.kind === 'rockets' ? 'hrocket' : W.kind === 'coax' ? 'bullet' : 'hmg';
  b.proj.push({
    kind, x, y, vx: Math.cos(a) * W.speed, vy: Math.sin(a) * W.speed, life: W.range / W.speed + 0.2, traveled: 0,
    maxDist: air ? aimDist * (0.96 + rand(b) * 0.08) : W.range, team: v.team, owner: s.id, dmg: W.dmg, dmgFar: W.dmg * 0.8,
    near: 400, far: 1000, splash: W.splash, splashR: W.splashR, wall: W.wall, target: -1, air, weapon: W.name, lastCell: -1,
  });
  emit(b, { k: 'shot', x, y, a, w: wid, team: v.team, supp: false, heavy: W.kind === 'shell' ? 3 : W.kind === 'rockets' ? 2 : W.kind === 'cannon' ? 1.5 : 1 });
  v.mapT = Math.max(v.mapT, 3);
}

export function updateVehicle(b: Battle, v: Vehicle, dt: number) {
  const d = VEHICLES[v.type];
  v.mapT = Math.max(0, v.mapT - dt);
  if (!v.alive) {
    v.respawnT -= dt;
    if (v.respawnT <= 0) respawnVehicle(b, v);
    return;
  }
  v.cmCd = Math.max(0, v.cmCd - dt);
  const drv = v.seats[0] >= 0 ? b.soldiers[v.seats[0]] : null;
  const occupied = v.seats.some((x) => x >= 0);
  const hq = b.world.hq[v.team];
  if (!occupied) {
    v.idleT += dt;
    const pad = b.world.pads[v.pad];
    if (v.idleT > 75 && dist(v, pad) > 250) respawnVehicle(b, v);
  } else v.idleT = 0;
  if (dist(v, hq) < 520 && v.hp < v.maxHp) v.hp = Math.min(v.maxHp, v.hp + 45 * dt);
  if (drv && drv.cls === 'engineer' && b.time - v.lastHurtT > 4) v.hp = Math.min(v.maxHp, v.hp + 7 * dt);
  if (v.hp < v.maxHp * 0.2) {
    v.hp -= 7 * dt;
    if (v.hp <= 0) { const last = v.dmgLog[v.dmgLog.length - 1]; destroyVehicle(b, v, last ? last.by : -1); return; }
  }
  if (d.air) moveAir(b, v, d, drv, dt); else moveGround(b, v, d, drv, dt);
  // 무기
  const weapons = SEAT_WEAPON[v.type];
  for (let k = 0; k < v.seats.length; k++) {
    v.fireT[k] -= dt;
    const wid = weapons[k];
    if (v.reloadT[k] > 0) { v.reloadT[k] -= dt; if (v.reloadT[k] <= 0 && wid) v.mag[k] = VWEAPONS[wid].mag; }
    const sid = v.seats[k];
    if (sid < 0 || !wid) continue;
    const s = b.soldiers[sid];
    const c = s.ctl;
    const W = VWEAPONS[wid];
    let dir: number;
    if (k === 0) {
      if (d.air) dir = v.ang;
      else { v.tang += clamp(angDiff(c.aim, v.tang), -d.tturn * dt, d.tturn * dt); dir = v.tang; }
    } else { v.tang2 += clamp(angDiff(c.aim, v.tang2), -4 * dt, 4 * dt); dir = v.tang2; }
    const aligned = (d.air && k === 0) || Math.abs(angDiff(c.aim, dir)) < (W.kind === 'shell' ? 0.07 : 0.3);
    if (c.fire && v.fireT[k] <= 0 && v.reloadT[k] <= 0 && v.mag[k] > 0 && aligned) {
      fire(b, v, s, wid, dir);
      v.fireT[k] = 60 / W.rpm;
      v.mag[k]--;
      if (v.mag[k] <= 0) v.reloadT[k] = W.reload;
    }
    if (c.reloadE && v.mag[k] < W.mag && v.reloadT[k] <= 0) v.reloadT[k] = W.reload;
  }
  // 전차 조종수의 동축 기관총
  if (v.type === 'tank' && drv) {
    v.coaxT -= dt;
    if (v.coaxMag <= 0) { v.coaxT = 4; v.coaxMag = 200; }
    if (drv.ctl.fire2 && v.coaxT <= 0) {
      fire(b, v, drv, 'tankCoax', v.tang);
      v.coaxT = 60 / VWEAPONS.tankCoax.rpm;
      v.coaxMag--;
    }
  }
  // 연막과 섬광탄
  if (drv && drv.ctl.counterE && v.cmCd <= 0 && v.type !== 'jeep') {
    if (d.air) {
      for (const p of b.proj) if (p.kind === 'missile' && p.target === v.id) p.target = -1;
      emit(b, { k: 'flare', x: v.x, y: v.y });
      v.cmCd = 16;
    } else {
      makeSmoke(b, v.x + Math.cos(v.tang) * 70, v.y + Math.sin(v.tang) * 70, 150);
      v.cmCd = 25;
    }
  }
}

export { CELL, FENCE, SANDBAG };
