// 봇: 분대 목표 배분, 보병 판단, 차량 운전과 사격
import { DIFFS, FLAG_R, VEHICLES, VWEAPONS, SEAT_WEAPON, type Team } from './defs';
import { CELL, LOS_BLOCK, MOVE_BLOCK, SHOT_PARTIAL, cellOf, los } from './grid';
import { flow, pathDist } from './nav';
import { angDiff, dist, enemyOf, forNear, rand } from './battle';
import { enterVehicle } from './vehicles';
import type { Battle, Soldier, Vehicle } from './types';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** 분대마다 향할 거점을 정한다 */
export function commander(b: Battle) {
  for (const team of [0, 1] as Team[]) {
    const foe = enemyOf(team);
    const squads = new Map<number, Soldier[]>();
    for (const s of b.soldiers) {
      if (s.team !== team) continue;
      if (!squads.has(s.squad)) squads.set(s.squad, []);
      squads.get(s.squad)!.push(s);
    }
    const load = b.flags.map(() => 0);
    const cap = Math.ceil(squads.size / b.flags.length) + 1;
    const hq = b.world.hq[team], ehq = b.world.hq[foe];
    for (const [, members] of squads) {
      const live = members.filter((m) => m.state === 0);
      const cx = live.length ? live.reduce((a, m) => a + m.x, 0) / live.length : hq.x;
      const cy = live.length ? live.reduce((a, m) => a + m.y, 0) / live.length : hq.y;
      let best = 0, bs = -Infinity;
      b.flags.forEach((f, i) => {
        let val: number;
        if (f.owner !== team) val = f.owner < 0 ? 6 : 5;
        else val = f.n[foe] > 0 || f.prog * (team === 0 ? 1 : -1) > -0.9 ? 6.5 : 0.8;
        // 우리 본부 쪽 거점을 먼저 챙긴다
        const front = Math.hypot(f.x - hq.x, f.y - hq.y) / (Math.hypot(f.x - hq.x, f.y - hq.y) + Math.hypot(f.x - ehq.x, f.y - ehq.y));
        const s = val - Math.hypot(f.x - cx, f.y - cy) / 650 - front * 1.2 - (load[i] >= cap ? 4 : load[i] * 1.2) + (members[0].ai.goal === i ? 1 : 0) + rand(b) * 0.6;
        if (s > bs) { bs = s; best = i; }
      });
      load[best]++;
      for (const m of members) m.ai.goal = best;
    }
  }
}

function turnTo(cur: number, want: number, rate: number, dt: number): number {
  return cur + clamp(angDiff(want, cur), -rate * dt, rate * dt);
}

function steer(b: Battle, s: Soldier, tx: number, ty: number, flowIdx: number, arrive = 12): boolean {
  const c = s.ctl;
  const d = Math.hypot(tx - s.x, ty - s.y);
  if (d < arrive) return false;
  let dir: [number, number] | null = null;
  if (d < 500 && los(b.world, s.x, s.y, tx, ty, false)) dir = [(tx - s.x) / d, (ty - s.y) / d];
  else if (flowIdx >= 0) dir = flow(b.world, b.nav, flowIdx, s.x, s.y, false);
  if (!dir) dir = [(tx - s.x) / d, (ty - s.y) / d];
  c.mx = dir[0]; c.my = dir[1];
  return true;
}

function nearestFlag(b: Battle, x: number, y: number): number {
  let best = 0, bd = Infinity;
  b.flags.forEach((f, i) => { const d = (f.x - x) ** 2 + (f.y - y) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

/** 위협 방향을 가리는 엄폐 자리 */
function findCover(b: Battle, s: Soldier, tx: number, ty: number): [number, number] | null {
  const w = b.world;
  const cx = Math.floor(s.x / CELL), cy = Math.floor(s.y / CELL);
  let best: [number, number] | null = null, bs = Infinity;
  for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 6; x <= cx + 6; x++) {
    if (x < 1 || y < 1 || x >= w.cw - 1 || y >= w.ch - 1) continue;
    if (MOVE_BLOCK[w.t[y * w.cw + x]]) continue;
    const px = (x + 0.5) * CELL, py = (y + 0.5) * CELL;
    const dx = tx - px, dy = ty - py, l = Math.hypot(dx, dy) || 1;
    const qx = Math.floor((px + (dx / l) * CELL * 1.1) / CELL), qy = Math.floor((py + (dy / l) * CELL * 1.1) / CELL);
    const qt = w.t[qy * w.cw + qx];
    if (!LOS_BLOCK[qt] && SHOT_PARTIAL[qt] < 50) continue;
    const sc = Math.hypot(px - s.x, py - s.y) + rand(b) * 30 - (LOS_BLOCK[qt] ? 20 : 0);
    if (sc < bs) { bs = sc; best = [px, py]; }
  }
  return best;
}

function sightOf(s: Soldier): number {
  return clamp(s.ws.range * 0.85, 560, s.ws.scope ? 1500 : 1050);
}

function perceive(b: Battle, s: Soldier) {
  const ai = s.ai;
  const sight = sightOf(s);
  const cands: [number, Soldier][] = [];
  forNear(b, s.x, s.y, sight, (o, d2) => { if (o.team !== s.team && o.protect < 1) cands.push([d2, o]); });
  cands.sort((a, c) => a[0] - c[0]);
  const focus = s.team === 1 ? DIFFS[b.diff].focus : 1;
  let best = -1, bs = Infinity, checked = 0;
  for (const [d2, o] of cands) {
    if (checked++ > 8) break;
    if (!los(b.world, s.x, s.y, o.x, o.y)) continue;
    if (s.team === 0) o.mapT = Math.max(o.mapT, 1.2);
    let sc = Math.sqrt(d2);
    if (o === b.player) sc /= focus;
    if (o.id === ai.target) sc *= 0.7;
    if (b.time - o.lastShotT < 1) sc *= 0.85;
    if (sc < bs) { bs = sc; best = o.id; }
  }
  if (best >= 0 && best !== ai.target) {
    ai.react = ai.skill.react * (0.7 + rand(b) * 0.6);
    ai.err = (rand(b) - 0.5) * 2 * ai.skill.err * 2.2;
    if (rand(b) < (s.cls === 'recon' ? 0.7 : 0.15)) s.ctl.spotE = true;
  }
  ai.target = best;
  // 차량 표적
  ai.tveh = -1;
  const rocket = (s.kit.ga === 'rpg' || s.kit.ga === 'aa') && s.ga.ammo > 0;
  let vb = rocket ? (s.kit.ga === 'aa' ? 1250 : 650) : 600;
  for (const v of b.vehicles) {
    if (!v.alive || v.team === s.team) continue;
    const air = VEHICLES[v.type].air;
    if (rocket && s.kit.ga === 'aa' && !air) continue;
    if (!rocket && v.type !== 'jeep' && !air) continue;
    const d = dist(v, s);
    if (d < vb && (air || los(b.world, s.x, s.y, v.x, v.y))) { vb = d; ai.tveh = v.id; }
  }
}

/** 보병 봇의 이번 프레임 조작 */
export function botThink(b: Battle, s: Soldier, dt: number) {
  const c = s.ctl;
  const ai = s.ai;
  c.mx = 0; c.my = 0; c.fire = false; c.fire2 = false; c.sprint = false; c.ads = false; c.interact = false;
  ai.think -= dt;
  if (s.veh >= 0) { vehicleBrain(b, s, dt); return; }
  if (ai.think <= 0) {
    ai.think = 0.22 + rand(b) * 0.14;
    perceive(b, s);
  }
  const t = ai.target >= 0 ? b.soldiers[ai.target] : null;
  const target = t && t.state === 0 && t.veh < 0 ? t : null;
  if (!target) ai.target = -1;
  const tv = ai.tveh >= 0 ? b.vehicles[ai.tveh] : null;
  ai.nadeT -= dt;
  ai.gadgetT -= dt;
  ai.coverT -= dt;

  // ── 쓰러진 아군 ──
  let downed: Soldier | null = null;
  {
    const medic = s.cls === 'medic';
    const reach = medic ? 380 : 220;
    let bd = target && dist(target, s) < 260 ? 0 : reach;
    for (const o of b.soldiers) {
      if (o.state !== 1 || o.team !== s.team || o.downT < 1.2) continue;
      if (!medic && o.squad !== s.squad) continue;
      const d = dist(o, s);
      if (d < bd) { bd = d; downed = o; }
    }
  }

  // ── 장비 ──
  const gA = s.kit.ga, gB = s.kit.gb;
  if (gB === 'stim' && s.hp < s.maxHp * 0.45 && s.gb.cd <= 0) c.useBE = true;
  if (gA === 'medbag' && s.ga.cd <= 0 && (s.hp < s.maxHp * 0.6 || (ai.gadgetT <= 0 && rand(b) < 0.02))) { c.useAE = true; ai.gadgetT = 6; }
  if (gB === 'ammobox' && s.gb.cd <= 0 && ai.gadgetT <= 0 && rand(b) < 0.01) { c.useBE = true; ai.gadgetT = 6; }

  // 들고 쏘는 장비 (로켓, 대공, 유탄)
  if (s.held === 1) {
    const aimT = tv && tv.alive ? tv : null;
    if (gA === 'ugl' || gA === 'smokegl') {
      if (target && s.ga.ammo > 0) {
        c.tx = target.x; c.ty = target.y;
        const want = Math.atan2(target.y - s.y, target.x - s.x);
        c.aim = turnTo(s.ang, want, 7, dt);
        if (Math.abs(angDiff(want, s.ang)) < 0.08) c.fire = !s.triggerHeld;
      }
      if (!target || s.ga.ammo <= 0 || ai.gadgetT < -2.5) { c.primaryE = true; ai.gadgetT = 8 + rand(b) * 8; }
    } else if (aimT && s.ga.ammo > 0) {
      const d = dist(aimT, s);
      const sp = gA === 'aa' ? 720 : 640;
      const lead = d / sp;
      const want = Math.atan2(aimT.y + aimT.vy * lead + Math.sin(aimT.ang) * aimT.spd * lead * (VEHICLES[aimT.type].air ? 0 : 1) - s.y,
        aimT.x + aimT.vx * lead + Math.cos(aimT.ang) * aimT.spd * lead * (VEHICLES[aimT.type].air ? 0 : 1) - s.x) + ai.err * 0.4;
      c.aim = turnTo(s.ang, want, 5, dt);
      c.ads = true;
      if (Math.abs(angDiff(want, s.ang)) < 0.06 && (gA !== 'aa' || s.lockT >= 1)) c.fire = !s.triggerHeld;
      c.crouch = true;
      return;
    } else { c.primaryE = true; }
  } else if (s.held === 2 && gB === 'repair') {
    // 수리 대상에 붙어 고친다
    const rv = ai.ride >= 0 ? b.vehicles[ai.ride] : null;
    if (rv && rv.alive && rv.hp < rv.maxHp && !target) {
      const d = dist(rv, s);
      if (d > VEHICLES[rv.type].r + 30) steer(b, s, rv.x, rv.y, -1, 4);
      c.aim = turnTo(s.ang, Math.atan2(rv.y - s.y, rv.x - s.x), 8, dt);
      c.fire = true;
      return;
    }
    c.primaryE = true;
    ai.ride = -1;
  } else if (tv && tv.alive && (gA === 'rpg' || gA === 'aa') && s.ga.ammo > 0 && s.swapT <= 0) {
    c.useAE = true;
    ai.err = (rand(b) - 0.5) * ai.skill.err;
  }

  // ── 싸움 ──
  if (target) {
    const d = dist(target, s);
    const w = s.ws;
    const lead = d / w.speed;
    let err = ai.err * (1 + s.suppress * 1.6);
    if (s.crouch || s.ads) err *= 0.8;
    const want = Math.atan2(target.y + target.vy * lead - s.y, target.x + target.vx * lead - s.x) + err;
    ai.err += ((rand(b) - 0.5) * ai.skill.err * 2.5 - ai.err * 0.8) * dt;
    c.aim = turnTo(s.ang, want, 9, dt);
    c.tx = target.x; c.ty = target.y;
    ai.react -= dt;
    ai.lastX = target.x; ai.lastY = target.y; ai.lastT = b.time;
    const pref = w.scope ? 750 : Math.max(110, w.near * 1.05);
    const stationary = Math.hypot(s.vx, s.vy) < 40;
    c.ads = d > 260 && (stationary || w.scope);
    ai.burst -= dt;
    if (ai.burst < -0.35) ai.burst = 0.3 + rand(b) * 0.5;
    const aligned = Math.abs(angDiff(want, s.ang)) < 0.1 + spreadGuess(s);
    if (ai.react <= 0 && aligned && d < w.range * 0.95 && s.held === 0) {
      if (!w.auto) c.fire = !s.triggerHeld;
      else c.fire = d < 260 || ai.burst > 0;
    }
    // 수류탄: 엄폐한 적이나 모여 있는 적
    if (s.frags > 0 && ai.nadeT <= 0 && d > 140 && d < 380) {
      let crowd = 0;
      forNear(b, target.x, target.y, 110, (o) => { if (o.team === target.team) crowd++; });
      if (crowd >= 2 || target.crouch || rand(b) < 0.25) { c.tx = target.x; c.ty = target.y; c.grenadeE = true; }
      ai.nadeT = 7 + rand(b) * 9;
    }
    // 유탄
    if (gA === 'ugl' && s.ga.ammo > 0 && ai.gadgetT <= 0 && d > 140 && d < 520 && s.held === 0 && rand(b) < 0.3) { c.useAE = true; ai.gadgetT = 0; }
    if (s.mag <= 0 || (s.reloadT > 0)) ai.coverT = Math.min(ai.coverT, 0);
    // 움직임
    const hurt = s.hp < s.maxHp * 0.45;
    if ((s.suppress > 0.55 || hurt || s.reloadT > 0) && ai.coverT <= 0) {
      const cv = findCover(b, s, target.x, target.y);
      ai.coverT = 1.8 + rand(b);
      if (cv) { ai.coverX = cv[0]; ai.coverY = cv[1]; } else { ai.coverX = 0; ai.coverY = 0; }
    }
    if (ai.coverX && (s.suppress > 0.3 || hurt || s.reloadT > 0) && Math.hypot(ai.coverX - s.x, ai.coverY - s.y) > 10) {
      steer(b, s, ai.coverX, ai.coverY, -1, 6);
      c.sprint = s.reloadT > 0 || hurt;
    } else if (downed && s.cls === 'medic' && d > 230) {
      // 싸우는 중에도 의무병은 일으키러 간다
      reviveMove(b, s, downed);
    } else {
      const ux = (target.x - s.x) / (d || 1), uy = (target.y - s.y) / (d || 1);
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeT = 0.5 + rand(b) * 1.1; ai.strafe = rand(b) < 0.5 ? -1 : 1; if (rand(b) < 0.25) ai.strafe = 0; }
      if (d > pref * 1.5) { steer(b, s, target.x, target.y, ai.goal, 20); c.mx += -uy * ai.strafe * 0.3; c.my += ux * ai.strafe * 0.3; }
      else if (d < pref * 0.45 && w.range > 900) { c.mx = -ux * 0.8; c.my = -uy * 0.8; }
      else { c.mx = -uy * ai.strafe * 0.6; c.my = ux * ai.strafe * 0.6; }
    }
    c.crouch = (ai.coverX !== 0 && Math.hypot(ai.coverX - s.x, ai.coverY - s.y) < 14) || (w.scope && d > 500) || (s.cls === 'medic' && stationary && d > 400);
    stuck(b, s, dt);
    return;
  }

  // ── 표적이 없다 ──
  c.crouch = false;
  if (s.mag < s.ws.mag * 0.4 && s.reloadT <= 0) c.reloadE = true;
  c.aim = s.ang;
  if (downed) { reviveMove(b, s, downed); stuck(b, s, dt); return; }
  // 최근에 맞은 쪽을 돌아본다
  if (b.time - ai.lastT < 3) c.aim = turnTo(s.ang, Math.atan2(ai.lastY - s.y, ai.lastX - s.x), 6, dt);
  // 공병: 다친 아군 차량을 고친다
  if (s.kit.gb === 'repair') {
    for (const v of b.vehicles) {
      if (!v.alive || v.team !== s.team || v.hp > v.maxHp * 0.7 || VEHICLES[v.type].air || dist(v, s) > 320) continue;
      ai.ride = v.id;
      if (s.held !== 2) c.useBE = true;
      return;
    }
  }
  moveToGoal(b, s, dt);
  stuck(b, s, dt);
}

function spreadGuess(s: Soldier): number {
  return s.ads ? s.ws.ads * 2 : s.ws.hip;
}

function reviveMove(b: Battle, s: Soldier, o: Soldier) {
  const c = s.ctl;
  const d = dist(o, s);
  if (d > 26) { steer(b, s, o.x, o.y, nearestFlag(b, o.x, o.y), 4); c.sprint = d > 120; }
  else c.interact = true;
  if (s.kit.gb === 'smoke' && s.gb.ammo > 0 && b.time - o.downT > 0 && s.lastHurtT > b.time - 2 && s.gb.cd <= 0) { c.tx = o.x; c.ty = o.y; c.useBE = true; }
}

function moveToGoal(b: Battle, s: Soldier, dt: number) {
  const c = s.ctl;
  const ai = s.ai;
  const pl = b.player;
  // 플레이어 분대원은 플레이어를 따른다
  if (s.team === pl.team && s.squad === pl.squad && pl.state === 0) {
    const pv = pl.veh >= 0 ? b.vehicles[pl.veh] : null;
    const px = pv ? pv.x : pl.x, py = pv ? pv.y : pl.y;
    // 플레이어가 탄 차량에 자리가 있으면 같이 탄다
    if (pv && !VEHICLES[pv.type].air && pv.seats.includes(-1) && dist(pv, s) < VEHICLES[pv.type].r + 40) { enterVehicle(b, s, pv); return; }
    const off = [[0, 0], [-55, -42], [-55, 42], [-95, 0]][s.slot] ?? [-60, 0];
    const ca = Math.cos(pl.ang), sa = Math.sin(pl.ang);
    const tx = px + off[0] * ca - off[1] * sa, ty = py + off[0] * sa + off[1] * ca;
    const d = Math.hypot(tx - s.x, ty - s.y);
    if (d > 40) { steer(b, s, tx, ty, nearestFlag(b, px, py), 20); c.sprint = d > 200 || !!pv; }
    c.aim = turnTo(s.ang, pl.ang + (s.slot - 2) * 0.6, 4, dt);
    return;
  }
  const f = b.flags[ai.goal];
  if (!f) return;
  // 분대장을 따라간다
  let leader: Soldier | null = null;
  for (const m of b.soldiers) if (m.team === s.team && m.squad === s.squad && m.state === 0 && m.veh < 0) { leader = m; break; }
  const df = Math.hypot(f.x - s.x, f.y - s.y);
  // 멀면 근처의 빈 차량을 탄다
  if (df > 1400 && ai.ride < 0 && rand(b) < 0.01) {
    for (const v of b.vehicles) {
      if (!v.alive || v.team !== s.team || VEHICLES[v.type].air || !v.seats.includes(-1) || dist(v, s) > 220) continue;
      ai.ride = v.id;
      break;
    }
  }
  if (ai.ride >= 0 && s.held === 0) {
    const v = b.vehicles[ai.ride];
    if (!v.alive || !v.seats.includes(-1) || dist(v, s) > 400) ai.ride = -1;
    else {
      if (dist(v, s) < VEHICLES[v.type].r + 30) { enterVehicle(b, s, v); ai.ride = -1; return; }
      steer(b, s, v.x, v.y, -1, 4);
      c.sprint = true;
      return;
    }
  }
  if (df < FLAG_R * 0.8) {
    ai.wanderT -= dt;
    if (ai.wanderT <= 0 || (ai.wx === 0 && ai.wy === 0)) {
      ai.wanderT = 3 + rand(b) * 4;
      for (let k = 0; k < 8; k++) {
        const a = rand(b) * Math.PI * 2, r = rand(b) * FLAG_R * 0.75;
        const x = f.x + Math.cos(a) * r, y = f.y + Math.sin(a) * r;
        if (isFinite(pathDist(b.world, b.nav, ai.goal, x, y))) { ai.wx = x; ai.wy = y; break; }
      }
    }
    if (!steer(b, s, ai.wx, ai.wy, ai.goal, 14)) c.crouch = rand(b) < 0.5;
    if (rand(b) < 0.004) c.aim = rand(b) * Math.PI * 2;
    // 정찰병과 공병의 거점 장비
    if (s.kit.gb === 'claymore' && s.gb.ammo > 0 && f.owner === s.team && rand(b) < 0.003) c.useBE = true;
    if (s.kit.gb === 'beacon' && s.gb.cd <= 0 && rand(b) < 0.002) c.useBE = true;
    if (s.kit.gb === 'mine' && s.gb.ammo > 0 && rand(b) < 0.002) c.useBE = true;
    return;
  }
  if (leader && leader !== s && dist(leader, s) < 700) {
    const off = [[0, 0], [-50, -40], [-50, 40], [-90, 0]][s.slot] ?? [-60, 0];
    const la = Math.atan2(f.y - leader.y, f.x - leader.x);
    const ca = Math.cos(la), sa = Math.sin(la);
    const tx = leader.x + off[0] * ca - off[1] * sa, ty = leader.y + off[0] * sa + off[1] * ca;
    if (Math.hypot(tx - s.x, ty - s.y) > 30) steer(b, s, tx, ty, ai.goal, 16);
    c.sprint = Math.hypot(tx - s.x, ty - s.y) > 160 || Math.hypot(leader.vx, leader.vy) > 160;
  } else {
    steer(b, s, f.x, f.y, ai.goal, FLAG_R * 0.5);
    c.sprint = df > 300;
  }
  if (c.mx || c.my) c.aim = turnTo(s.ang, Math.atan2(c.my, c.mx), 5, dt);
  // 정찰병: 목표 거점에 드론과 감지기를 던진다
  if (s.cls === 'recon' && df < 900 && rand(b) < 0.01) {
    c.tx = f.x; c.ty = f.y;
    if (s.kit.ga === 'drone' && s.ga.cd <= 0) c.useAE = true;
    if (s.kit.ga === 'sensor' && s.ga.cd <= 0 && df < 420) { c.aim = Math.atan2(f.y - s.y, f.x - s.x); c.useAE = true; }
  }
}

function stuck(b: Battle, s: Soldier, dt: number) {
  const c = s.ctl, ai = s.ai;
  if (ai.jitterT > 0) { ai.jitterT -= dt; c.mx = ai.jx; c.my = ai.jy; return; }
  ai.stuckT += dt;
  if (ai.stuckT > 1.1) {
    if ((c.mx || c.my) && Math.hypot(s.x - ai.lx, s.y - ai.ly) < 9) {
      const a = rand(b) * Math.PI * 2;
      ai.jitterT = 0.45; ai.jx = Math.cos(a); ai.jy = Math.sin(a);
      ai.wx = 0; ai.wy = 0;
    }
    ai.stuckT = 0; ai.lx = s.x; ai.ly = s.y;
  }
}

// ───────── 차량 ─────────

function vehicleGoal(b: Battle, v: Vehicle): number {
  const foe = enemyOf(v.team);
  let best = 0, bs = -Infinity;
  b.flags.forEach((f, i) => {
    const val = f.owner !== v.team ? 5 : f.n[foe] > 0 ? 6 : 0.5;
    const s = val - Math.hypot(f.x - v.x, f.y - v.y) / 900 + (v.goal === i ? 1 : 0) + rand(b);
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}

function pickVehicleTarget(b: Battle, v: Vehicle, s: Soldier, range: number, air: boolean, needLos: boolean, preferVeh: boolean): { x: number; y: number; vx: number; vy: number; d: number; veh: boolean } | null {
  let best: { x: number; y: number; vx: number; vy: number; d: number; veh: boolean } | null = null;
  let bs = Infinity;
  for (const o of b.vehicles) {
    if (!o.alive || o.team === v.team) continue;
    if (VEHICLES[o.type].air && !air) continue;
    const d = dist(o, v);
    if (d > range) continue;
    if (needLos && !VEHICLES[o.type].air && !los(b.world, v.x, v.y, o.x, o.y, true)) continue;
    const sc = d * (preferVeh ? 0.5 : 1);
    const vx = VEHICLES[o.type].air ? o.vx : Math.cos(o.ang) * o.spd, vy = VEHICLES[o.type].air ? o.vy : Math.sin(o.ang) * o.spd;
    if (sc < bs) { bs = sc; best = { x: o.x, y: o.y, vx, vy, d, veh: true }; }
  }
  const focus = v.team === 1 ? DIFFS[b.diff].focus : 1;
  forNear(b, v.x, v.y, range * 0.75, (o, d2) => {
    if (o.team === v.team) return;
    let d = Math.sqrt(d2);
    if (o === b.player) d /= focus;
    if (d >= bs) return;
    if (needLos && !los(b.world, v.x, v.y, o.x, o.y, true)) return;
    if (!needLos) { const ci = cellOf(b.world, o.x, o.y); if (ci >= 0 && b.world.roof[ci]) return; }
    bs = d; best = { x: o.x, y: o.y, vx: o.vx, vy: o.vy, d: Math.sqrt(d2), veh: false };
  });
  return best;
}

function vehicleBrain(b: Battle, s: Soldier, dt: number) {
  const c = s.ctl, ai = s.ai;
  const v = b.vehicles[s.veh];
  const d = VEHICLES[v.type];
  const wid = SEAT_WEAPON[v.type][s.seat];
  // 운전석이 비면 옮겨 앉는다
  if (s.seat !== 0 && v.seats[0] < 0 && (v.type !== 'heli' || rand(b) < 0.02)) { v.seats[s.seat] = -1; v.seats[0] = s.id; s.seat = 0; return; }
  if (ai.think <= 0) {
    ai.think = 0.3 + rand(b) * 0.2;
    const W = wid ? VWEAPONS[wid] : null;
    const tg = W ? pickVehicleTarget(b, v, s, Math.min(W.range, d.air ? 1000 : 1100), true, !d.air, W.kind === 'shell' || W.kind === 'rockets') : null;
    ai.target = tg ? 1 : -1;
    ai.lastX = tg ? tg.x : 0; ai.lastY = tg ? tg.y : 0; ai.wx = tg ? tg.vx : 0; ai.wy = tg ? tg.vy : 0; ai.coverX = tg ? tg.d : 0;
    ai.burst = tg && tg.veh ? 1 : 0;
  }
  const hasT = ai.target > 0;
  if (wid) {
    const W = VWEAPONS[wid];
    if (hasT) {
      const lead = ai.coverX / W.speed;
      const tx = ai.lastX + ai.wx * lead, ty = ai.lastY + ai.wy * lead;
      const want = Math.atan2(ty - v.y, tx - v.x) + ai.err * 0.5;
      c.aim = want;
      c.tx = tx; c.ty = ty;
      const dir = s.seat === 0 ? (d.air ? v.ang : v.tang) : v.tang2;
      const aligned = Math.abs(angDiff(want, dir)) < (W.kind === 'shell' ? 0.05 : 0.15);
      c.fire = aligned && ai.coverX < W.range * 0.9;
      if (W.kind === 'shell' && !ai.burst && ai.coverX > 700) c.fire = false;
      if (v.type === 'tank' && s.seat === 0 && !ai.burst && ai.coverX < 600) c.fire2 = true;
    } else c.aim = s.seat === 0 ? (d.air ? v.ang : v.ang) : v.tang2;
  }
  if (s.seat !== 0) {
    // 탑승자는 목표 거점에 닿거나 차가 멈추면 내린다
    if (!wid && v.goal >= 0) {
      const f = b.flags[v.goal];
      if (Math.hypot(f.x - v.x, f.y - v.y) < FLAG_R * 1.3 || (Math.abs(v.spd) < 10 && v.idleT === 0 && rand(b) < 0.01)) c.interactE = true;
    }
    if (s.team === b.player.team && s.squad === b.player.squad && b.player.veh !== v.id && b.player.state === 0 && dist(b.player, v) > 400) c.interactE = true;
    return;
  }
  // ── 운전 ──
  if (ai.gadgetT <= 0 || v.goal < 0) { v.goal = vehicleGoal(b, v); ai.gadgetT = 6; }
  ai.gadgetT -= dt;
  const retreat = v.hp < v.maxHp * 0.35 || (v.type !== 'jeep' && v.hp < v.maxHp * 0.6 && b.world.hq[v.team] && dist(v, b.world.hq[v.team]) < 500);
  const goalIdx = retreat ? b.flags.length + v.team : v.goal;
  const goal = retreat ? b.world.hq[v.team] : b.flags[v.goal];
  if (d.air) {
    heliFly(b, s, v, goal, hasT, dt);
    if (b.proj.some((p) => p.kind === 'missile' && p.target === v.id && Math.hypot(p.x - v.x, p.y - v.y) < 600) && v.cmCd <= 0 && rand(b) < 0.1) c.counterE = true;
    return;
  }
  const gd = Math.hypot(goal.x - v.x, goal.y - v.y);
  const hold = retreat ? gd < 220 : gd < FLAG_R * (v.type === 'jeep' ? 0.6 : 1.1) || (hasT && ai.burst === 1 && ai.coverX < 900 && v.type === 'tank');
  if (v.type === 'jeep' && !retreat && gd < FLAG_R * 0.8) { c.interactE = true; return; }
  if (!hold) {
    const dir = flow(b.world, b.nav, goalIdx, v.x, v.y, true) ?? flow(b.world, b.nav, goalIdx, v.x, v.y, false);
    if (dir) { c.mx = dir[0]; c.my = dir[1]; }
    else { c.mx = (goal.x - v.x) / (gd || 1); c.my = (goal.y - v.y) / (gd || 1); }
  } else if (!retreat && hasT && v.type !== 'tank') {
    // 장갑차는 천천히 돌며 쏜다
    const a = Math.atan2(ai.lastY - v.y, ai.lastX - v.x) + Math.PI / 2;
    c.mx = Math.cos(a) * 0.4; c.my = Math.sin(a) * 0.4;
  }
  // 걸렸으면 뒤로 뺀다
  if (v.revT > 0) { v.revT -= dt; c.mx = -Math.cos(v.ang) + (rand(b) - 0.5); c.my = -Math.sin(v.ang) + (rand(b) - 0.5); }
  v.stuckT += dt;
  if (v.stuckT > 1.6) {
    if ((c.mx || c.my) && Math.hypot(v.x - v.lx, v.y - v.ly) < 14) v.revT = 1 + rand(b);
    v.stuckT = 0; v.lx = v.x; v.ly = v.y;
  }
  if (v.hp < v.maxHp * 0.5 && b.time - v.lastHurtT < 1 && v.cmCd <= 0 && rand(b) < 0.3) c.counterE = true;
}

function heliFly(b: Battle, s: Soldier, v: Vehicle, goal: { x: number; y: number }, hasT: boolean, dt: number) {
  const c = s.ctl, ai = s.ai;
  const home = goal === b.world.hq[v.team];
  const cx = hasT && !home ? ai.lastX : goal.x, cy = hasT && !home ? ai.lastY : goal.y;
  const R = home ? 60 : 420;
  ai.orbit += dt * 0.35;
  const px = cx + Math.cos(ai.orbit) * R, py = cy + Math.sin(ai.orbit) * R;
  const dx = px - v.x, dy = py - v.y, l = Math.hypot(dx, dy) || 1;
  const sp = Math.min(1, l / 200);
  c.mx = (dx / l) * sp; c.my = (dy / l) * sp;
  if (!hasT) c.aim = Math.atan2(cy - v.y, cx - v.x);
}
