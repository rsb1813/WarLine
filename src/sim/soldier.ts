// 보병 이동: 시선, 자세 전환, 걷기·달리기·정조준 속도, 미끄러지기, 점프, 중력, 충돌, 물, 낙하 피해, 발소리.
import type { Game, Soldier, Stance, Vec3, World } from '../types';
import { clamp, damp, lerp } from '../math';
import { BODY, SPEED } from './body';
import { collideBody, floorAt, groundTypeAt, heightAt, inWater, raycast } from '../world';
import { emit } from './game';
import { damageSoldier } from './damage';

/** 지상 가속 / 입력 없을 때 마찰 (m/s²) */
const ACCEL = 40;
const FRICTION = 32;
/** 공중 조작 20% */
const AIR_ACCEL = ACCEL * 0.2;
/** 눈높이 이동 속도 m/s */
const EYE_RATE = 6;
const SLIDE_TIME = 0.75;
const SLIDE_DECEL = 7.5;
const SLIDE_MIN_SPEED = 5;
const SLIDE_END_SPEED = 2.2;
const SLIDE_STEER = 1.2;
/** 걸어 내려갈 때 바닥에 붙는 최대 높이 */
const STEP_DOWN = 0.45;
/** 이보다 깊으면 헤엄 (발 기준 수심) */
const SWIM_DEPTH = 1.3;
const WADE_DEPTH = 0.35;
const HARD_LAND = -9;
const SOFT_LAND = -4;
const FALL_DMG = 8.5;
const SEP_DIST = BODY.radius * 2;
const STRIDE = 2.2;
const STRIDE_SPRINT = 2.6;

interface SoldierAux { standCheckT: number }
const auxMap = new WeakMap<Soldier, SoldierAux>();
function auxOf(s: Soldier): SoldierAux {
  let a = auxMap.get(s);
  if (!a) { a = { standCheckT: -1 }; auxMap.set(s, a); }
  return a;
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };
const DOWN: Vec3 = { x: 0, y: -1, z: 0 };
const tmpO: Vec3 = { x: 0, y: 0, z: 0 };

const approach = (cur: number, target: number, step: number): number =>
  cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);

export function updateSoldier(g: Game, s: Soldier, dt: number): void {
  if (s.vehicle >= 0 || s.state === 'dead') return;
  decayAnim(s, dt);
  if (s.state === 'down') { updateDown(g, s, dt); return; }

  const w = g.world, ctl = s.ctl, vel = s.vel, pos = s.pos;
  const aux = auxOf(s);

  const wet = inWater(w, pos.x, pos.z);
  const depth = wet ? w.water - pos.y : 0;
  const swimming = depth > SWIM_DEPTH;

  // ── 엣지 소비 ──
  const jumpReq = ctl.jump;
  ctl.jump = false;

  // ── 자세 의도, 미끄러지기 ──
  let want: Stance = swimming ? 'stand' : ctl.stance;
  const hs0 = Math.hypot(vel.x, vel.z);
  let doJump = false;

  if (s.sliding > 0) {
    s.sliding -= dt;
    if (jumpReq && s.onGround && !swimming) {
      // 미끄러지다 점프: 일어서며 탄력 유지
      s.sliding = 0; want = 'stand'; ctl.stance = 'stand'; doJump = true;
    } else if (want !== 'crouch' || hs0 < SLIDE_END_SPEED || swimming || s.sliding <= 0) {
      s.sliding = 0;
    }
  } else if (s.sprinting && want === 'crouch' && s.stance === 'stand' && s.onGround && hs0 > SLIDE_MIN_SPEED) {
    s.sliding = SLIDE_TIME;
    s.stance = 'crouch';
    const k = Math.max(hs0, SPEED.slide) / hs0;
    vel.x *= k; vel.z *= k;
    emit(g, { k: 'step', s: s.id, pos: { x: pos.x, y: pos.y, z: pos.z }, mat: stepMat(w, s, depth), sprint: true });
  } else if (jumpReq && s.onGround && !swimming) {
    if (s.stance === 'stand') doJump = true;
    else { want = 'stand'; ctl.stance = 'stand'; } // 앉거나 엎드려 있으면 점프 대신 일어선다
  }

  // ── 자세 전환 (일어설 때 머리 위가 막혔는지) ──
  if (want !== s.stance && s.sliding <= 0) {
    const hCur = BODY.height[s.stance], hNew = BODY.height[want];
    if (hNew <= hCur) {
      if (want !== 'prone' || s.onGround) s.stance = want;
    } else if (g.time >= aux.standCheckT) {
      if (clearAbove(w, s, hCur, hNew)) s.stance = want;
      else aux.standCheckT = g.time + 0.2;
    }
  }

  // ── 시선 ──
  s.yaw = ctl.yaw;
  s.pitch = s.stance === 'prone' ? clamp(ctl.pitch, -0.35, 0.6) : clamp(ctl.pitch, -1.45, 1.45);
  ctl.pitch = s.pitch;

  // ── 이동 의도 ──
  let mx = ctl.mx, mz = ctl.mz;
  const mmag = Math.hypot(mx, mz);
  if (mmag > 1) { mx /= mmag; mz /= mmag; }
  const hasInput = mmag > 0.05;

  // 달리기: 앞으로, 서서, 쏘지 않을 때. 정조준보다 우선. 재장전 중에도 가능
  s.sprinting = ctl.sprint && mz > 0.5 && s.stance === 'stand' && s.sliding <= 0 && !ctl.fire && !swimming
    && (s.onGround || s.sprinting) && s.eyeH > BODY.eye.stand - 0.3;

  let speed: number;
  if (s.stance === 'prone') speed = SPEED.prone;
  else if (s.stance === 'crouch') speed = SPEED.crouch;
  else speed = s.sprinting ? SPEED.sprint : SPEED.walk;
  if (!s.sprinting && s.ads > 0) {
    const adsSpeed = s.stance === 'stand' ? SPEED.ads : speed * 0.7;
    speed = lerp(speed, Math.min(speed, adsSpeed), s.ads);
  }
  if (!s.sprinting && mz < -0.1) speed *= 0.85; // 뒷걸음질은 조금 느리게
  const held = s.weapons[s.cur];
  if (s.held === 'weapon' && held) speed *= held.st.moveMul;
  if (s.stimT > 0) speed *= 1.15;
  if (depth > WADE_DEPTH) speed *= 0.55;

  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
  const wx = -sy * mz + cy * mx, wz = -cy * mz - sy * mx;
  const tx = wx * speed, tz = wz * speed;
  const grounded = s.onGround || swimming;

  if (s.sliding > 0) {
    // 낮은 마찰로 미끄러짐, 살짝 방향 틀기
    const hs = Math.hypot(vel.x, vel.z);
    if (hs > 1e-4) {
      if (grounded) {
        const k = Math.max(0, hs - SLIDE_DECEL * dt) / hs;
        vel.x *= k; vel.z *= k;
      }
      if (hasInput) {
        const cr = vel.x * wz - vel.z * wx, dp = vel.x * wx + vel.z * wz;
        const rot = clamp(Math.atan2(cr, dp), -SLIDE_STEER * dt, SLIDE_STEER * dt);
        const c = Math.cos(rot), sn = Math.sin(rot);
        const nx = vel.x * c - vel.z * sn, nz = vel.x * sn + vel.z * c;
        vel.x = nx; vel.z = nz;
      }
    }
  } else if (grounded) {
    accelTo(vel, tx, tz, hasInput ? ACCEL : FRICTION, dt);
  } else if (hasInput) {
    const before = Math.hypot(vel.x, vel.z);
    accelTo(vel, tx, tz, AIR_ACCEL, dt);
    // 공중에서는 방향만 틀고 이미 가진 속도는 잃지 않게
    const after = Math.hypot(vel.x, vel.z);
    if (after < before && before > speed && after > 1e-4) { const k = before / after; vel.x *= k; vel.z *= k; }
  }

  // ── 점프 ──
  let jumped = false;
  if (doJump && s.stance === 'stand' && s.onGround) {
    vel.y = SPEED.jump;
    s.onGround = false;
    jumped = true;
    emit(g, { k: 'jump', s: s.id });
  }

  // ── 중력 / 헤엄 ──
  if (swimming) {
    const target = w.water - SWIM_DEPTH + 0.05;
    vel.y = lerp(vel.y, clamp((target - pos.y) * 3, -2.5, 2.5), damp(6, dt));
  } else {
    vel.y -= SPEED.gravity * dt;
  }

  // ── 병사끼리 밀어내기 ──
  pushApart(g, s);

  // ── 적분과 충돌 ──
  const wasGround = s.onGround;
  const vyPre = vel.y;
  pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
  const res = collideBody(w, pos, vel, BODY.radius, BODY.height[s.stance]);
  let ground = res.ground;
  if (!ground && wasGround && !jumped && !swimming && vel.y <= 0) {
    // 계단·비탈을 내려갈 때 튀지 않게 바닥에 붙인다
    const f = floorAt(w, pos.x, pos.y, pos.z, BODY.radius * 0.8);
    if (f <= pos.y + 0.01 && pos.y - f < STEP_DOWN) { pos.y = f; vel.y = 0; ground = true; }
  }
  s.onGround = ground;

  // ── 착지 ──
  if (ground && !wasGround) {
    if (vyPre < HARD_LAND) {
      emit(g, { k: 'land', s: s.id, hard: true });
      vel.x *= 0.45; vel.z *= 0.45;
      if (!(depth > 0.8)) {
        damageSoldier(g, s, (-vyPre + HARD_LAND) * FALL_DMG, s.id, '낙하', false, null);
        if (s.state !== 'alive') return;
      }
    } else if (vyPre < SOFT_LAND) {
      emit(g, { k: 'land', s: s.id, hard: false });
    }
  }

  // ── 눈높이 ──
  const eyeTarget = s.sliding > 0 ? BODY.eye.crouch - 0.15 : BODY.eye[s.stance];
  s.eyeH = approach(s.eyeH, eyeTarget, EYE_RATE * dt);

  // ── 발소리, 걷기 위상 ──
  if (ground || swimming) {
    const hs = Math.hypot(vel.x, vel.z);
    const stride = s.sprinting ? STRIDE_SPRINT : STRIDE;
    if (hs > 0.3) s.anim.walk += hs * dt * (Math.PI / stride);
    if (s.sliding <= 0 && hs > 0.5) {
      s.stepAcc += hs * dt;
      if (s.stepAcc >= stride) {
        s.stepAcc -= stride;
        if (s.stepAcc > stride) s.stepAcc = 0;
        emit(g, { k: 'step', s: s.id, pos: { x: pos.x, y: pos.y, z: pos.z }, mat: stepMat(w, s, depth), sprint: s.sprinting });
      }
    }
  }
}

/** 쓰러진 병사: 입력 없이 중력과 충돌만 */
function updateDown(g: Game, s: Soldier, dt: number): void {
  const w = g.world, v = s.vel, p = s.pos;
  s.sprinting = false; s.sliding = 0; s.ads = 0;
  const hs = Math.hypot(v.x, v.z);
  if (s.onGround && hs > 1e-4) { const k = Math.max(0, hs - 14 * dt) / hs; v.x *= k; v.z *= k; }
  const depth = inWater(w, p.x, p.z) ? w.water - p.y : 0;
  if (depth > 0.5) v.y = lerp(v.y, clamp((w.water - 0.35 - p.y) * 3, -2, 2), damp(6, dt));
  else v.y -= SPEED.gravity * dt;
  p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
  const r = collideBody(w, p, v, BODY.radius, BODY.height.prone);
  s.onGround = r.ground;
  s.eyeH = approach(s.eyeH, BODY.eye.prone, EYE_RATE * dt);
}

/** hitT 는 sim-core, throwT 는 sim-gadgets, reloadT 는 updateWeapons 가 맡는다 */
function decayAnim(s: Soldier, dt: number): void {
  const a = s.anim;
  if (a.fireT > 0) a.fireT = Math.max(0, a.fireT - dt);
}

function accelTo(v: Vec3, tx: number, tz: number, rate: number, dt: number): void {
  const dx = tx - v.x, dz = tz - v.z;
  const d = Math.hypot(dx, dz), st = rate * dt;
  if (d <= st) { v.x = tx; v.z = tz; } else { v.x += (dx / d) * st; v.z += (dz / d) * st; }
}

const PROBE = [0, 0, 0.65, 0, -0.65, 0, 0, 0.65, 0, -0.65];
/** 키를 fromH 에서 toH 로 늘려도 머리 위에 단단한 상자가 없나 */
function clearAbove(w: World, s: Soldier, fromH: number, toH: number): boolean {
  const y0 = s.pos.y + Math.max(0.15, fromH - 0.15);
  const len = s.pos.y + toH + 0.05 - y0;
  if (len <= 0) return true;
  for (let i = 0; i < PROBE.length; i += 2) {
    tmpO.x = s.pos.x + PROBE[i] * BODY.radius; tmpO.y = y0; tmpO.z = s.pos.z + PROBE[i + 1] * BODY.radius;
    const h = raycast(w, tmpO, UP, len);
    if (h && h.box >= 0) {
      const b = w.boxes[h.box];
      if (!b || b.solid) return false;
    }
  }
  return true;
}

const GROUND_MAT = ['snow', 'dirt', 'dirt', 'concrete', 'concrete', 'dirt'];
function matName(m: string): string {
  switch (m) {
    case 'snow': case 'water': case 'metal': case 'wood': return m;
    case 'concrete': case 'brick': case 'rock': case 'glass': return 'concrete';
    default: return 'dirt';
  }
}
/** 발밑 재질: 물 → 상자 윗면(raycast) → 지면 종류 */
function stepMat(w: World, s: Soldier, depth: number): string {
  if (depth > 0.12) return 'water';
  const p = s.pos;
  if (p.y > heightAt(w, p.x, p.z) + 0.15) {
    tmpO.x = p.x; tmpO.y = p.y + 0.3; tmpO.z = p.z;
    const h = raycast(w, tmpO, DOWN, 0.9);
    if (h) return matName(h.mat);
  }
  return GROUND_MAT[groundTypeAt(w, p.x, p.z)] ?? 'dirt';
}

// ───────────── 병사끼리 밀어내기: 스텝마다 한 번 만드는 2m 격자 ─────────────
const CELL = 2;
let gridGame: Game | null = null;
let gridTime = NaN;
let gridN = 0;
let head = new Int32Array(0);
let next = new Int32Array(0);
const usedCells: number[] = [];

function ensureGrid(g: Game): void {
  if (gridGame === g && gridTime === g.time) return;
  gridGame = g; gridTime = g.time;
  const n = Math.ceil(g.world.size / CELL) + 2;
  if (n !== gridN) {
    gridN = n;
    head = new Int32Array(n * n).fill(-1);
    usedCells.length = 0;
  } else {
    for (let i = 0; i < usedCells.length; i++) head[usedCells[i]] = -1;
    usedCells.length = 0;
  }
  const sol = g.soldiers;
  if (next.length < sol.length) next = new Int32Array(sol.length * 2);
  for (let i = 0; i < sol.length; i++) {
    const o = sol[i];
    if (o.state !== 'alive' || o.vehicle >= 0) continue;
    const c = cellOf(o.pos.x, o.pos.z);
    if (head[c] === -1) usedCells.push(c);
    next[i] = head[c];
    head[c] = i;
  }
}

function cellOf(x: number, z: number): number {
  const cx = clamp(Math.floor(x / CELL), 0, gridN - 1), cz = clamp(Math.floor(z / CELL), 0, gridN - 1);
  return cz * gridN + cx;
}

function pushApart(g: Game, s: Soldier): void {
  ensureGrid(g);
  const sol = g.soldiers, p = s.pos;
  const cx = clamp(Math.floor(p.x / CELL), 0, gridN - 1), cz = clamp(Math.floor(p.z / CELL), 0, gridN - 1);
  for (let dz = -1; dz <= 1; dz++) {
    const z = cz + dz;
    if (z < 0 || z >= gridN) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= gridN) continue;
      for (let i = head[z * gridN + x]; i >= 0; i = next[i]) {
        const o = sol[i];
        if (!o || o === s || o.state !== 'alive' || o.vehicle >= 0) continue;
        const ddy = o.pos.y - p.y;
        if (ddy > 1.5 || ddy < -1.5) continue;
        const ex = p.x - o.pos.x, ez = p.z - o.pos.z;
        const d2 = ex * ex + ez * ez;
        if (d2 >= SEP_DIST * SEP_DIST) continue;
        let nx: number, nz: number, d: number;
        if (d2 < 1e-8) {
          // 정확히 겹치면 id 로 정한 방향으로
          const a = (s.id * 2.399963) % (Math.PI * 2);
          nx = Math.cos(a); nz = Math.sin(a); d = 0;
        } else {
          d = Math.sqrt(d2); nx = ex / d; nz = ez / d;
        }
        const push = (SEP_DIST - d) * 0.5;
        p.x += nx * push;
        p.z += nz * push;
      }
    }
  }
}
