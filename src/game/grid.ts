// 전장 격자: 칸 종류, 속성, 시야와 탄도 계산, 충돌
import type { MapDef, Theme } from './defs';

export const CELL = 32;

// 칸 종류
export const GROUND = 0, ROAD = 1, FLOOR = 2, WATER = 3, ROCK = 4, TREE = 5, WALL = 6, WINDOW = 7, DOOR = 8,
  RUBBLE = 9, SANDBAG = 10, CONTAINER = 11, FENCE = 12, BRIDGE = 13, WRECK = 14, STUMP = 15;
const N_TYPES = 16;

// 재질 (벽과 장애물의 내구도와 색)
export const M_NONE = 0, M_WOOD = 1, M_CONCRETE = 2, M_METAL = 3, M_BRICK = 4;
export const MAT_HP = [0, 140, 340, 260, 280];

function table(list: number[], v = 1): Uint8Array {
  const t = new Uint8Array(N_TYPES);
  for (const i of list) t[i] = v;
  return t;
}
/** 보병이 지나갈 수 없다 */
export const MOVE_BLOCK = table([WATER, ROCK, TREE, WALL, WINDOW, SANDBAG, CONTAINER, FENCE, WRECK]);
/** 차량이 지나갈 수 없다 (부수고 지나가는 것은 따로) */
export const VEH_BLOCK = table([WATER, ROCK, WALL, WINDOW, CONTAINER]);
/** 무거운 차량이 밀고 지나가며 부순다 */
export const CRUSH_HEAVY = table([TREE, FENCE, SANDBAG, WRECK]);
export const CRUSH_LIGHT = table([FENCE]);
/** 탄을 막는다 */
export const SHOT_BLOCK = table([ROCK, TREE, WALL, CONTAINER]);
/** 낮은 엄폐물이 탄을 막을 확률 (%) */
export const SHOT_PARTIAL = (() => { const t = new Uint8Array(N_TYPES); t[SANDBAG] = 60; t[RUBBLE] = 22; t[FENCE] = 8; t[WRECK] = 55; return t; })();
/** 시야를 막는다 */
export const LOS_BLOCK = table([ROCK, TREE, WALL, CONTAINER]);
/** 폭발로 부서진다 */
export const BREAKABLE = table([TREE, WALL, WINDOW, DOOR, SANDBAG, FENCE, WRECK, CONTAINER]);

export interface Building {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  mat: number;
  roof: 'gable' | 'flat' | 'metal' | 'dome';
  roofColor: string;
  walls: number;
  wallsLeft: number;
  collapsed: boolean;
  /** 지붕을 다시 그려야 한다 */
  dirty: boolean;
}

export interface FlagSite { x: number; y: number; name: string; tag: string; site: string }
export interface Pad { x: number; y: number; ang: number; team: number; type: string }
export interface Smoke { x: number; y: number; r: number; t: number; life: number }
/** 충돌 없는 장식 (천막, 크레인, 안테나 등) */
export interface Decor { k: string; x: number; y: number; a: number; s: number; c?: string }

export interface World {
  def: MapDef;
  theme: Theme;
  w: number;
  h: number;
  cw: number;
  ch: number;
  /** 칸 종류 */
  t: Uint8Array;
  hp: Int16Array;
  mat: Uint8Array;
  /** 겉모습 변형 (지면 무늬, 장애물 모양) */
  vis: Uint8Array;
  /** 지면 종류: 0 툰드라, 1 눈, 2 밭, 3 콘크리트, 4 자갈, 5 진흙 */
  gnd: Uint8Array;
  bld: Int16Array;
  roof: Uint8Array;
  buildings: Building[];
  flags: FlagSite[];
  hq: { x: number; y: number }[];
  pads: Pad[];
  decor: Decor[];
  /** 그림용 길: 월드 좌표 점 목록과 폭 (칸 단위) */
  roads: { pts: number[]; w: number; street: boolean }[];
  plazas: { x: number; y: number; r: number }[];
  smokes: Smoke[];
  /** 바뀐 칸 (지형 그림을 다시 굽는다) */
  changed: number[];
  /** 막혀 있다가 열린 칸 (길찾기를 부분 갱신한다) */
  opened: number[];
  navDirty: boolean;
}

export function emptyWorld(def: MapDef): World {
  const cw = Math.round(def.w / CELL), ch = Math.round(def.h / CELL);
  const n = cw * ch;
  return {
    def, theme: def.theme, w: cw * CELL, h: ch * CELL, cw, ch,
    t: new Uint8Array(n), hp: new Int16Array(n), mat: new Uint8Array(n), vis: new Uint8Array(n), gnd: new Uint8Array(n),
    bld: new Int16Array(n).fill(-1), roof: new Uint8Array(n),
    buildings: [], flags: [], hq: [], pads: [], decor: [], roads: [], plazas: [], smokes: [], changed: [], opened: [], navDirty: false,
  };
}

export const cellOf = (w: World, x: number, y: number) => {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  return cx < 0 || cy < 0 || cx >= w.cw || cy >= w.ch ? -1 : cy * w.cw + cx;
};
export const typeAt = (w: World, x: number, y: number) => {
  const i = cellOf(w, x, y);
  return i < 0 ? ROCK : w.t[i];
};

/**
 * 선분이 지나는 칸을 차례로 방문한다. visit가 true를 돌려주면 멈추고 그때의 진입 비율(0~1)을 돌려준다.
 * 끝까지 가면 -1.
 */
export function traverse(w: World, x0: number, y0: number, x1: number, y1: number, visit: (i: number, t: number) => boolean): number {
  let cx = Math.floor(x0 / CELL), cy = Math.floor(y0 / CELL);
  const ex = Math.floor(x1 / CELL), ey = Math.floor(y1 / CELL);
  const dx = x1 - x0, dy = y1 - y0;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const tdx = adx > 1e-9 ? CELL / adx : Infinity, tdy = ady > 1e-9 ? CELL / ady : Infinity;
  let tmx = adx > 1e-9 ? (sx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / adx : Infinity;
  let tmy = ady > 1e-9 ? (sy > 0 ? (cy + 1) * CELL - y0 : y0 - cy * CELL) / ady : Infinity;
  let tEnter = 0;
  for (let n = 0; n < 4000; n++) {
    if (cx >= 0 && cy >= 0 && cx < w.cw && cy < w.ch) {
      if (visit(cy * w.cw + cx, tEnter)) return tEnter;
    } else if (visit(-1, tEnter)) return tEnter;
    if (cx === ex && cy === ey) return -1;
    if (tmx < tmy) { tEnter = tmx; tmx += tdx; cx += sx; } else { tEnter = tmy; tmy += tdy; cy += sy; }
    if (tEnter > 1) return -1;
  }
  return -1;
}

function smokeBlocks(w: World, x0: number, y0: number, x1: number, y1: number): boolean {
  for (const s of w.smokes) {
    const k = Math.min(1, s.t / 1.2) * Math.min(1, (s.life - s.t) / 2);
    if (k < 0.5) continue;
    const dx = x1 - x0, dy = y1 - y0;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((s.x - x0) * dx + (s.y - y0) * dy) / l2));
    const px = x0 + dx * t - s.x, py = y0 + dy * t - s.y;
    if (px * px + py * py < (s.r * 0.8) ** 2) return true;
  }
  return false;
}

/** 두 지점 사이에 시야를 막는 것이 없는가 (연막 포함) */
export function los(w: World, x0: number, y0: number, x1: number, y1: number, smoke = true): boolean {
  const start = cellOf(w, x0, y0);
  const hit = traverse(w, x0, y0, x1, y1, (i) => i >= 0 && i !== start && LOS_BLOCK[w.t[i]] === 1);
  if (hit >= 0) return false;
  return !(smoke && w.smokes.length && smokeBlocks(w, x0, y0, x1, y1));
}

/** 원을 이동 불가 칸 밖으로 밀어낸다. block 표를 따로 줄 수 있다 */
export function collide(w: World, p: { x: number; y: number }, r: number, block: Uint8Array = MOVE_BLOCK, bridgeOk = true) {
  for (let pass = 0; pass < 2; pass++) {
    const x0 = Math.floor((p.x - r) / CELL), x1 = Math.floor((p.x + r) / CELL);
    const y0 = Math.floor((p.y - r) / CELL), y1 = Math.floor((p.y + r) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const out = cx < 0 || cy < 0 || cx >= w.cw || cy >= w.ch;
        if (!out) {
          const t = w.t[cy * w.cw + cx];
          if (!block[t] || (bridgeOk && t === BRIDGE)) continue;
        }
        const nx = Math.max(cx * CELL, Math.min(p.x, (cx + 1) * CELL));
        const ny = Math.max(cy * CELL, Math.min(p.y, (cy + 1) * CELL));
        let dx = p.x - nx, dy = p.y - ny;
        const d = Math.hypot(dx, dy);
        if (d >= r) continue;
        if (d < 1e-4) {
          const l = p.x - cx * CELL, rr = (cx + 1) * CELL - p.x, tt = p.y - cy * CELL, bb = (cy + 1) * CELL - p.y;
          const m = Math.min(l, rr, tt, bb);
          if (m === l) p.x = cx * CELL - r; else if (m === rr) p.x = (cx + 1) * CELL + r;
          else if (m === tt) p.y = cy * CELL - r; else p.y = (cy + 1) * CELL + r;
          continue;
        }
        dx /= d; dy /= d;
        p.x = nx + dx * r;
        p.y = ny + dy * r;
      }
    }
  }
  p.x = Math.max(r, Math.min(w.w - r, p.x));
  p.y = Math.max(r, Math.min(w.h - r, p.y));
}

/** (x, y) 근처에서 보병이 설 수 있는 빈 자리 */
export function freeSpot(w: World, x: number, y: number, rad: number, rnd: () => number, block: Uint8Array = MOVE_BLOCK): { x: number; y: number } {
  for (let k = 0; k < 60; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * rad * (1 + k / 25);
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
    if (cx < 1 || cy < 1 || cx >= w.cw - 1 || cy >= w.ch - 1) continue;
    const i = cy * w.cw + cx;
    if (block[w.t[i]] && w.t[i] !== BRIDGE) continue;
    return { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
  }
  return { x, y };
}

/** 칸 종류를 바꾸고 다시 그릴 목록과 길찾기 갱신 표시를 남긴다 */
export function setCell(w: World, i: number, t: number) {
  const before = w.t[i];
  if (before === t) return;
  w.t[i] = t;
  w.changed.push(i);
  if (MOVE_BLOCK[before] !== MOVE_BLOCK[t] || VEH_BLOCK[before] !== VEH_BLOCK[t] || before === TREE) w.opened.push(i);
}
