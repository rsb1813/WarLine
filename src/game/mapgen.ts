// 전장 생성: 지형, 물, 길, 거점마다 마을·공업 단지·농장 등, 본부, 숲
import type { MapDef } from './defs';
import {
  BRIDGE, CONTAINER, DOOR, FENCE, FLOOR, GROUND, MAT_HP, MOVE_BLOCK, M_BRICK, M_CONCRETE, M_METAL, M_WOOD, ROAD, ROCK,
  RUBBLE, SANDBAG, STUMP, TREE, WALL, WATER, WINDOW, WRECK, emptyWorld, type Building, type World, CELL,
} from './grid';

export function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noise2(seed: number) {
  const r = rng(seed);
  const N = 64;
  const g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const at = (x: number, y: number) => g[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  const one = (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = sm(x - x0), fy = sm(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x: number, y: number) => (one(x, y) * 2 + one(x * 2.1 + 7, y * 2.1 + 3)) / 3;
}

/** 우선순위 큐 (작은 값 먼저). 같은 칸이 여러 번 들어갈 수 있다 */
class Heap {
  i = new Int32Array(1024);
  p = new Float32Array(1024);
  size = 0;
  push(i: number, p: number) {
    if (this.size === this.i.length) {
      const ni = new Int32Array(this.size * 2); ni.set(this.i); this.i = ni;
      const np = new Float32Array(this.size * 2); np.set(this.p); this.p = np;
    }
    const I = this.i, P = this.p;
    let k = this.size++;
    while (k > 0) {
      const q = (k - 1) >> 1;
      if (P[q] <= p) break;
      I[k] = I[q]; P[k] = P[q];
      k = q;
    }
    I[k] = i; P[k] = p;
  }
  pop(): number {
    const I = this.i, P = this.p;
    const top = I[0];
    const n = --this.size;
    if (n > 0) {
      const li = I[n], lp = P[n];
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && P[r] < P[l] ? r : l;
        if (P[m] >= lp) break;
        I[k] = I[m]; P[k] = P[m];
        k = m;
      }
      I[k] = li; P[k] = lp;
    }
    return top;
  }
}
export { Heap };

const ROOF_COLORS = ['#9a3b30', '#2f5f80', '#3f6e4b', '#a8772f', '#6d4c7d', '#7c2c2c', '#3a5964', '#b0503a', '#4b6e8f'];
const CONTAINER_KINDS = 6;

type Face = 'n' | 's' | 'e' | 'w';

export function genWorld(def: MapDef, flip: boolean): World {
  const w = emptyWorld(def);
  const { cw, ch } = w;
  const n = cw * ch;
  const R = rng(def.seed);
  const lock = new Uint8Array(n); // 1 길(+여백), 2 거점, 3 본부
  const I = (x: number, y: number) => y * cw + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < cw && y < ch;
  const cellX = (u: number) => Math.max(3, Math.min(cw - 4, Math.round((flip ? 1 - u : u) * (cw - 1))));
  const cellY = (v: number) => Math.max(3, Math.min(ch - 4, Math.round(v * (ch - 1))));
  const n1 = noise2(def.seed + 11), n2 = noise2(def.seed + 23), n3 = noise2(def.seed + 37);
  const disc = (cx: number, cy: number, r: number, f: (i: number, x: number, y: number, d: number) => void) => {
    const ri = Math.ceil(r);
    for (let y = cy - ri; y <= cy + ri; y++) for (let x = cx - ri; x <= cx + ri; x++) {
      if (!inb(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) f(I(x, y), x, y, d);
    }
  };
  const set = (i: number, t: number, hp = 0, mat = 0) => { w.t[i] = t; w.hp[i] = hp; w.mat[i] = mat; };

  // ── 1. 지면 ──
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = I(x, y);
    const a = n1(x * 0.045, y * 0.045);
    if (def.theme === 'snow') w.gnd[i] = a < 0.3 ? 0 : 1;
    else if (def.theme === 'industrial') w.gnd[i] = a > 0.58 ? 0 : a < 0.3 ? 5 : 4;
    else w.gnd[i] = a > 0.63 ? 1 : a < 0.3 ? 5 : 0;
    w.vis[i] = (R() * 256) | 0;
  }

  // ── 2. 물: 해안, 강, 호수 ──
  if (def.coast) {
    for (let x = 0; x < cw; x++) {
      const depth = 4 + 9 * n2(x * 0.04, 3.3);
      for (let y = 0; y < ch; y++) {
        const d = def.coast === 'n' ? y : ch - 1 - y;
        if (d < depth) set(I(x, y), WATER);
      }
    }
  }
  const riverX: number[] = [];
  if (def.river) {
    for (let y = 0; y < ch; y++) {
      const cx = cw / 2 + Math.sin(y * 0.04 + def.seed) * 5 + (n2(y * 0.05, 5) - 0.5) * 7;
      const hw = 2.8 + n2(3, y * 0.08) * 1.4;
      riverX.push(cx);
      for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) if (inb(x, y) && Math.abs(x - cx) <= hw) set(I(x, y), WATER);
    }
    for (const v of def.river) {
      const by = cellY(v);
      for (let y = by - 2; y <= by + 2; y++) {
        const cx = riverX[y];
        for (let x = Math.floor(cx - 6); x <= Math.ceil(cx + 6); x++) {
          if (!inb(x, y)) continue;
          const i = I(x, y);
          if (w.t[i] === WATER) set(i, BRIDGE);
          lock[i] = 1;
        }
      }
    }
  }
  if (def.lake) {
    const lx = cellX(def.lake.u), ly = cellY(def.lake.v), lr = def.lake.r * cw;
    disc(lx, ly, lr * 1.3, (i, x, y, d) => {
      const edge = lr * (0.85 + 0.3 * n2(x * 0.15, y * 0.15));
      if (d < edge) set(i, WATER);
    });
  }
  // 물가는 진흙
  for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) {
    const i = I(x, y);
    if (w.t[i] === WATER) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(x + dx, y + dy) && w.t[I(x + dx, y + dy)] === WATER) { near = true; break; }
    if (near && def.theme !== 'snow') w.gnd[i] = 5;
  }

  // ── 3. 본부와 거점 위치 ──
  const hq = [{ x: cellX(0.035), y: cellY(0.5) }, { x: cellX(0.965), y: cellY(0.5) }];
  for (const h of hq) disc(h.x, h.y, 13, (i, _x, _y, d) => { if (w.t[i] === WATER) set(i, GROUND); lock[i] = 3; if (d < 8) w.gnd[i] = 3; });
  const flags = def.flags.map((f, k) => {
    let fx = cellX(f.u);
    const fy = cellY(f.v);
    if (def.river && f.site === 'bridge') fx = Math.round(riverX[fy]);
    return { x: fx, y: fy, name: f.name, tag: 'ABCDEFGH'[k], site: f.site };
  });
  // 물 위의 거점은 부두 모양 발판을 깐다
  for (const f of flags) {
    if (w.t[I(f.x, f.y)] === WATER || w.t[I(f.x, f.y)] === BRIDGE) {
      disc(f.x, f.y, 4.2, (i) => { if (w.t[i] === WATER) { set(i, BRIDGE); w.vis[i] = 1; } lock[i] = 1; });
    }
  }

  // ── 4. 길: 본부와 거점을 잇는 그물 ──
  const nodes = [hq[0], hq[1], ...flags];
  const edges: [number, number][] = [];
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  {
    // 최소 신장 트리
    const inTree = new Set([0]);
    while (inTree.size < nodes.length) {
      let best: [number, number] | null = null, bd = Infinity;
      for (const a of inTree) for (let b = 0; b < nodes.length; b++) {
        if (inTree.has(b)) continue;
        const d = dist(nodes[a], nodes[b]);
        if (d < bd) { bd = d; best = [a, b]; }
      }
      edges.push(best!);
      inTree.add(best![1]);
    }
    // 본부마다 가까운 거점 둘, 거점끼리 짧은 고리 둘
    for (const h of [0, 1]) {
      const near = flags.map((f, k) => [dist(nodes[h], f), k + 2] as const).sort((a, b) => a[0] - b[0]).slice(0, 2);
      for (const [, k] of near) if (!edges.some(([a, b]) => (a === h && b === k) || (a === k && b === h))) edges.push([h, k]);
    }
    const extra: [number, number, number][] = [];
    for (let a = 2; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      if (edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) continue;
      extra.push([dist(nodes[a], nodes[b]), a, b]);
    }
    extra.sort((x, y) => x[0] - y[0]);
    for (const [, a, b] of extra.slice(0, 2)) edges.push([a, b]);
  }
  const astar = (sx: number, sy: number, tx: number, ty: number): number[] => {
    const g = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new Heap();
    const s = I(sx, sy), t = I(tx, ty);
    const h = (x: number, y: number) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return (dx + dy - 0.6 * Math.min(dx, dy)) * 0.9; };
    g[s] = 0;
    heap.push(s, h(sx, sy));
    while (heap.size) {
      const cur = heap.pop();
      if (cur === t) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % cw, cy = (cur - cx) / cw;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 2 || ny < 2 || nx >= cw - 2 || ny >= ch - 2) continue;
        const ni = I(nx, ny);
        const tt = w.t[ni];
        let c = tt === WATER ? 400 : tt === BRIDGE ? 0.7 : tt === ROAD ? 0.6 : 1 + 1.2 * n2(nx * 0.09, ny * 0.09);
        if (lock[ni] === 3 && dist({ x: nx, y: ny }, hq[0]) > 3 && dist({ x: nx, y: ny }, hq[1]) > 3) c += 0.5;
        const ng = g[cur] + c * (dx && dy ? 1.414 : 1);
        if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; heap.push(ni, ng + h(nx, ny)); }
      }
    }
    const path: number[] = [];
    for (let c = t; c >= 0; c = from[c]) { path.push(c); if (c === s) break; }
    return path;
  };
  const carveRoad = (path: number[], half = 1.6) => {
    for (const c of path) {
      const px = c % cw, py = (c - px) / cw;
      disc(px, py, half + 0.6, (i, _x, _y, d) => {
        if (d <= half) {
          if (w.t[i] === WATER) set(i, BRIDGE);
          else if (w.t[i] !== BRIDGE) set(i, ROAD);
        } else if (w.t[i] === GROUND && def.theme !== 'snow') w.gnd[i] = 4;
        lock[i] = lock[i] === 3 ? 3 : 1;
      });
    }
  };
  for (const [a, b] of edges) carveRoad(astar(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y));

  // ── 5. 건물 ──
  const canPlace = (x0: number, y0: number, bw: number, bh: number) => {
    if (x0 < 3 || y0 < 3 || x0 + bw > cw - 3 || y0 + bh > ch - 3) return false;
    for (let y = y0 - 1; y <= y0 + bh; y++) for (let x = x0 - 1; x <= x0 + bw; x++) {
      const i = I(x, y);
      const edge = x === x0 - 1 || y === y0 - 1 || x === x0 + bw || y === y0 + bh;
      const t = w.t[i];
      if (w.bld[i] >= 0 || lock[i] === 3) return false;
      if (edge) { if (t !== GROUND && t !== STUMP && t !== ROAD) return false; }
      else if ((t !== GROUND && t !== STUMP) || lock[i] === 1) return false;
    }
    return true;
  };
  const addBuilding = (x0: number, y0: number, bw: number, bh: number, mat: number, roof: Building['roof'], color: string, face: Face,
    opt: { door2?: boolean; wide?: number; part?: boolean; winEvery?: number } = {}): Building => {
    const id = w.buildings.length;
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) {
      const i = I(x, y);
      const edge = x === x0 || x === x0 + bw - 1 || y === y0 || y === y0 + bh - 1;
      set(i, edge ? WALL : FLOOR, edge ? MAT_HP[mat] : 0, mat);
      w.bld[i] = id;
      w.roof[i] = 1;
      lock[i] = 2;
    }
    const doorXs: number[] = [], doorYs: number[] = [];
    const makeDoor = (side: Face, width: number) => {
      const horiz = side === 'n' || side === 's';
      const len = horiz ? bw : bh;
      const mid = Math.floor(len / 2) + (len > 6 ? Math.floor((R() - 0.5) * 3) : 0);
      for (let k = 0; k < width; k++) {
        const o = Math.max(1, Math.min(len - 2, mid - Math.floor(width / 2) + k));
        const x = horiz ? x0 + o : side === 'w' ? x0 : x0 + bw - 1;
        const y = horiz ? (side === 'n' ? y0 : y0 + bh - 1) : y0 + o;
        set(I(x, y), DOOR, 70, mat);
        if (horiz) doorXs.push(x); else doorYs.push(y);
      }
    };
    const opp: Record<Face, Face> = { n: 's', s: 'n', e: 'w', w: 'e' };
    makeDoor(face, opt.wide ?? 1);
    if (opt.door2) makeDoor(opp[face], opt.wide ?? 1);
    // 안쪽 벽: 방을 나눈다
    if (opt.part) {
      if (bw >= 8) {
        let px = x0 + Math.floor(bw / 2);
        while (doorXs.includes(px) || doorXs.includes(px - 1) || doorXs.includes(px + 1)) px++;
        if (px < x0 + bw - 2) {
          const gap = y0 + 1 + Math.floor(R() * (bh - 2));
          for (let y = y0 + 1; y < y0 + bh - 1; y++) set(I(px, y), y === gap ? DOOR : WALL, y === gap ? 70 : MAT_HP[mat], mat);
        }
      } else if (bh >= 7) {
        let py = y0 + Math.floor(bh / 2);
        while (doorYs.includes(py) || doorYs.includes(py - 1) || doorYs.includes(py + 1)) py++;
        if (py < y0 + bh - 2) {
          const gap = x0 + 1 + Math.floor(R() * (bw - 2));
          for (let x = x0 + 1; x < x0 + bw - 1; x++) set(I(x, py), x === gap ? DOOR : WALL, x === gap ? 70 : MAT_HP[mat], mat);
        }
      }
    }
    // 창문
    const every = opt.winEvery ?? 3;
    let k = 0;
    const per: [number, number][] = [];
    for (let x = x0 + 1; x < x0 + bw - 1; x++) { per.push([x, y0]); per.push([x, y0 + bh - 1]); }
    for (let y = y0 + 1; y < y0 + bh - 1; y++) { per.push([x0, y]); per.push([x0 + bw - 1, y]); }
    for (const [x, y] of per) {
      k++;
      const i = I(x, y);
      if (w.t[i] !== WALL) continue;
      let nearDoor = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.t[I(x + dx, y + dy)] === DOOR) nearDoor = true;
      const along = y === y0 || y === y0 + bh - 1 ? x - x0 : y - y0;
      if (!nearDoor && along % every === 1 && k % 1 === 0) set(i, WINDOW, 50, mat);
    }
    let walls = 0;
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) { const t = w.t[I(x, y)]; if (t === WALL || t === WINDOW) walls++; }
    const b: Building = { id, x: x0, y: y0, w: bw, h: bh, mat, roof, roofColor: color, walls, wallsLeft: walls, collapsed: false, dirty: true };
    w.buildings.push(b);
    return b;
  };
  const faceToward = (x0: number, y0: number, bw: number, bh: number, tx: number, ty: number): Face => {
    const dx = tx - (x0 + bw / 2), dy = ty - (y0 + bh / 2);
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n';
  };
  const tryHouse = (fx: number, fy: number, rMin: number, rMax: number, sz: [number, number, number, number], mat: number, roof: Building['roof'], color: string,
    opt: { door2?: boolean; wide?: number; part?: boolean; winEvery?: number } = {}, tries = 40): Building | null => {
    for (let a = 0; a < tries; a++) {
      const ang = R() * Math.PI * 2, d = rMin + R() * (rMax - rMin);
      let bw = sz[0] + Math.floor(R() * (sz[1] - sz[0] + 1)), bh = sz[2] + Math.floor(R() * (sz[3] - sz[2] + 1));
      if (R() < 0.5) [bw, bh] = [bh, bw];
      const x0 = Math.round(fx + Math.cos(ang) * d - bw / 2), y0 = Math.round(fy + Math.sin(ang) * d - bh / 2);
      if (!canPlace(x0, y0, bw, bh)) continue;
      const big = bw * bh >= 30;
      return addBuilding(x0, y0, bw, bh, mat, roof, color, faceToward(x0, y0, bw, bh, fx, fy), { door2: big, part: bw * bh >= 36, ...opt });
    }
    return null;
  };
  const free = (i: number) => w.t[i] === GROUND && lock[i] !== 1 && lock[i] !== 3 && w.bld[i] < 0;
  const sandbagLine = (x: number, y: number, dx: number, dy: number, len: number) => {
    for (let k = 0; k < len; k++) {
      const cx = x + dx * k, cy = y + dy * k;
      if (!inb(cx, cy)) continue;
      const i = I(cx, cy);
      if (w.t[i] === GROUND || (w.t[i] === ROAD && lock[i] !== 1)) set(i, SANDBAG, 170);
    }
  };
  const sandbagRing = (cx: number, cy: number, r: number, gaps: number) => {
    const steps = Math.round(r * 7);
    for (let s = 0; s < steps; s++) {
      if (Math.floor((s / steps) * gaps * 2) % 2 === 1) continue;
      const a = (s / steps) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (!inb(x, y)) continue;
      const i = I(x, y);
      if (w.t[i] === GROUND) set(i, SANDBAG, 170);
    }
  };
  const fenceRect = (x0: number, y0: number, x1: number, y1: number, gapAt?: [number, number]) => {
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) put(x, y);
    for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) put(x, y);
    function put(x: number, y: number) {
      if (!inb(x, y)) return;
      if (gapAt && Math.abs(x - gapAt[0]) <= 1 && Math.abs(y - gapAt[1]) <= 1) return;
      const i = I(x, y);
      if (w.t[i] === GROUND && lock[i] !== 1 && lock[i] !== 3) set(i, FENCE, 60);
    }
  };
  const wreck = (x: number, y: number, horiz: boolean) => {
    const cells = horiz ? [I(x, y), I(x + 1, y)] : [I(x, y), I(x, y + 1)];
    if (!cells.every((i) => w.t[i] === GROUND || w.t[i] === ROAD)) return;
    const v = (R() * 4) | 0;
    for (const i of cells) { set(i, WRECK, 220, M_METAL); w.vis[i] = (v << 1) | (horiz ? 1 : 0); }
  };
  const street = (x0: number, y0: number, x1: number, y1: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps), y = Math.round(y0 + ((y1 - y0) * s) / steps);
      disc(x, y, 1.3, (i) => { if (w.t[i] === GROUND) { set(i, ROAD); w.vis[i] |= 128; } if (lock[i] !== 3) lock[i] = 1; });
    }
  };
  const plaza = (fx: number, fy: number, r: number) => {
    disc(fx, fy, r, (i) => { if (w.t[i] !== WATER && w.t[i] !== BRIDGE) { set(i, ROAD); w.gnd[i] = 3; } lock[i] = 1; });
  };
  const yard = (fx: number, fy: number, rx: number, ry: number) => {
    for (let y = fy - ry; y <= fy + ry; y++) for (let x = fx - rx; x <= fx + rx; x++) if (inb(x, y) && w.t[I(x, y)] !== WATER) w.gnd[I(x, y)] = 3;
  };
  const containers = (fx: number, fy: number, rx: number, ry: number, p: number) => {
    for (let gy = -ry + 2; gy <= ry - 3; gy += 5) for (let gx = -rx + 2; gx <= rx - 4; gx += 7) {
      if (R() > p || Math.hypot(gx, gy) < 4) continue;
      const horiz = R() < 0.6;
      const bw = horiz ? 4 : 2, bh = horiz ? 2 : 4;
      const x0 = fx + gx + Math.floor(R() * 2), y0 = fy + gy;
      let ok = true;
      for (let y = y0; y < y0 + bh && ok; y++) for (let x = x0; x < x0 + bw; x++) if (!inb(x, y) || !free(I(x, y))) { ok = false; break; }
      if (!ok) continue;
      const kind = (R() * CONTAINER_KINDS) | 0;
      for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) { set(I(x, y), CONTAINER, 650, M_METAL); w.vis[I(x, y)] = kind | (horiz ? 16 : 0); lock[I(x, y)] = 2; }
    }
  };
  const silo = (cx: number, cy: number) => {
    let ok = true;
    disc(cx, cy, 1.8, (i) => { if (!free(i)) ok = false; });
    if (!ok) return;
    disc(cx, cy, 1.8, (i) => { set(i, CONTAINER, 2000, M_METAL); w.vis[i] = 255; lock[i] = 2; });
    w.decor.push({ k: 'silo', x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL, a: 0, s: 1.9 * CELL });
  };
  const roofColor = () => ROOF_COLORS[(R() * ROOF_COLORS.length) | 0];

  const SITE_R: Record<string, number> = { town: 15, village: 11, industrial: 13, port: 12, radar: 11, farm: 11, bridge: 7 };
  for (const f of flags) {
    const r = SITE_R[f.site];
    disc(f.x, f.y, r + 3, (i) => { if (lock[i] === 0) lock[i] = 2; });
    switch (f.site) {
      case 'town': {
        street(f.x - r, f.y, f.x + r, f.y);
        street(f.x, f.y - r, f.x, f.y + r);
        plaza(f.x, f.y, 3);
        tryHouse(f.x, f.y, 5, 7, [9, 11, 7, 8], M_BRICK, 'flat', '#6f6a64', { part: true, door2: true });
        for (let k = 0; k < 24; k++) {
          const b = tryHouse(f.x, f.y, 4, r + 1, [4, 7, 4, 6], R() < 0.25 ? M_BRICK : M_WOOD, 'gable', roofColor(), {}, 60);
          if (b && R() < 0.15) fenceRect(b.x - 2, b.y - 2, b.x + b.w + 1, b.y + b.h + 1, door(b));
        }
        for (let k = 0; k < 4; k++) {
          const a = R() * Math.PI * 2, d = 3 + R() * (r - 3);
          wreck(Math.round(f.x + Math.cos(a) * d), Math.round(f.y + Math.sin(a) * d), R() < 0.5);
        }
        for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) sandbagLine(f.x + dx * 4, f.y + dy * 4, dx > 0 ? 0 : 0, 1, 2);
        w.decor.push({ k: 'lamp', x: (f.x + 3.5) * CELL, y: (f.y + 3.5) * CELL, a: 0, s: 1 });
        break;
      }
      case 'village': {
        street(f.x - r, f.y, f.x + r, f.y);
        plaza(f.x, f.y, 2.5);
        for (let k = 0; k < 11; k++) {
          const b = tryHouse(f.x, f.y, 3, r + 1, [4, 6, 4, 5], M_WOOD, 'gable', roofColor(), {}, 60);
          if (b && R() < 0.35) fenceRect(b.x - 2, b.y - 2, b.x + b.w + 1, b.y + b.h + 1, door(b));
        }
        wreck(f.x + 4, f.y + 2, true);
        sandbagRing(f.x, f.y, 3.5, 4);
        break;
      }
      case 'industrial': {
        const rx = r, ry = Math.round(r * 0.75);
        yard(f.x, f.y, rx, ry);
        plaza(f.x, f.y, 2.5);
        for (let k = 0; k < 4; k++) tryHouse(f.x, f.y, 5, r + 2, [9, 14, 6, 8], M_METAL, 'metal', '#5f6c78', { wide: 3, door2: true, winEvery: 5 }, 90);
        tryHouse(f.x, f.y, 4, r, [5, 6, 4, 5], M_CONCRETE, 'flat', '#767c82', { part: true }, 60);
        containers(f.x, f.y, rx, ry, 0.6);
        silo(f.x + (R() < 0.5 ? -1 : 1) * (rx - 3), f.y - ry + 3);
        silo(f.x + (R() < 0.5 ? -1 : 1) * (rx - 3), f.y + ry - 3);
        fenceRect(f.x - rx - 1, f.y - ry - 1, f.x + rx + 1, f.y + ry + 1);
        sandbagRing(f.x, f.y, 3.5, 3);
        w.decor.push({ k: 'pipe', x: (f.x - rx + 1) * CELL, y: (f.y) * CELL, a: 0, s: rx * 0.8 * CELL });
        break;
      }
      case 'port': {
        const rx = r, ry = Math.round(r * 0.7);
        yard(f.x, f.y, rx, ry);
        plaza(f.x, f.y, 2.5);
        for (let k = 0; k < 3; k++) tryHouse(f.x, f.y, 5, r + 2, [9, 13, 6, 8], M_METAL, 'metal', '#56636e', { wide: 3, door2: true, winEvery: 5 }, 90);
        containers(f.x, f.y, rx, ry, 0.75);
        // 바다 쪽으로 부두를 낸다
        let best: [number, number] | null = null;
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2;
          for (let d = 4; d < 24; d++) {
            const x = Math.round(f.x + Math.cos(ang) * d), y = Math.round(f.y + Math.sin(ang) * d);
            if (!inb(x, y)) break;
            if (w.t[I(x, y)] === WATER) { if (!best || d < Math.hypot(best[0] - f.x, best[1] - f.y)) best = [x, y]; break; }
          }
        }
        if (best) {
          const dx = Math.sign(best[0] - f.x), dy = Math.sign(best[1] - f.y);
          const vert = Math.abs(best[1] - f.y) >= Math.abs(best[0] - f.x);
          for (const off of [-6, 6]) {
            for (let k = -2; k < 11; k++) for (let wdt = -1; wdt <= 1; wdt++) {
              const x = vert ? best[0] + off + wdt : best[0] + dx * k;
              const y = vert ? best[1] + dy * k : best[1] + off + wdt;
              if (!inb(x, y)) continue;
              const i = I(x, y);
              if (w.t[i] === WATER) { set(i, BRIDGE); w.vis[i] = 1; }
            }
            const bx = vert ? best[0] + off + 3 : best[0] + dx * 6, by = vert ? best[1] + dy * 6 : best[1] + off + 3;
            w.decor.push({ k: 'boat', x: (bx + 0.5) * CELL, y: (by + 0.5) * CELL, a: vert ? Math.PI / 2 : 0, s: 1 });
          }
          w.decor.push({ k: 'crane', x: (best[0] - dx * 2 + 0.5) * CELL, y: (best[1] - dy * 2 + 0.5) * CELL, a: Math.atan2(dy, dx), s: 1 });
        }
        sandbagRing(f.x, f.y, 3.5, 3);
        break;
      }
      case 'radar': {
        plaza(f.x, f.y, 2);
        const main = tryHouse(f.x, f.y, 5, 7, [7, 8, 7, 8], M_CONCRETE, 'dome', '#8a9096', { door2: true, part: true }, 80);
        if (main) w.decor.push({ k: 'dome', x: (main.x + main.w / 2) * CELL, y: (main.y + main.h / 2) * CELL, a: 0, s: Math.min(main.w, main.h) * CELL * 0.42 });
        for (let k = 0; k < 4; k++) tryHouse(f.x, f.y, 5, r + 1, [4, 6, 3, 5], M_CONCRETE, 'flat', '#7d838a', {}, 60);
        sandbagRing(f.x, f.y, 3.5, 4);
        sandbagRing(f.x, f.y, 6.5, 6);
        for (let k = 0; k < 2; k++) {
          const a = R() * Math.PI * 2;
          w.decor.push({ k: 'antenna', x: (f.x + Math.cos(a) * 8 + 0.5) * CELL, y: (f.y + Math.sin(a) * 8 + 0.5) * CELL, a: 0, s: 1 });
        }
        fenceRect(f.x - r, f.y - r, f.x + r, f.y + r);
        break;
      }
      case 'farm': {
        plaza(f.x, f.y, 2);
        tryHouse(f.x, f.y, 5, 8, [9, 10, 6, 7], M_WOOD, 'gable', R() < 0.5 ? '#7c2c2c' : '#6b4a2f', { wide: 2, door2: true, part: false }, 60);
        tryHouse(f.x, f.y, 4, 8, [6, 7, 5, 5], M_WOOD, 'gable', roofColor(), { part: true });
        tryHouse(f.x, f.y, 4, 9, [4, 4, 3, 4], M_WOOD, 'gable', roofColor());
        for (let k = 0; k < 3; k++) {
          const a = R() * Math.PI * 2, d = 7 + R() * 4;
          const fw = 8 + Math.floor(R() * 5), fh = 5 + Math.floor(R() * 3);
          const x0 = Math.round(f.x + Math.cos(a) * d - fw / 2), y0 = Math.round(f.y + Math.sin(a) * d - fh / 2);
          for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) if (inb(x, y) && w.t[I(x, y)] === GROUND && w.bld[I(x, y)] < 0) w.gnd[I(x, y)] = 2;
          fenceRect(x0 - 1, y0 - 1, x0 + fw, y0 + fh, [Math.round(x0 + fw / 2), y0 - 1]);
          for (let h = 0; h < 3; h++) {
            const hx = x0 + 1 + Math.floor(R() * (fw - 2)), hy = y0 + 1 + Math.floor(R() * (fh - 2));
            if (inb(hx, hy) && w.t[I(hx, hy)] === GROUND) { set(I(hx, hy), SANDBAG, 120); w.vis[I(hx, hy)] = 1; }
          }
        }
        sandbagRing(f.x, f.y, 3, 3);
        break;
      }
      case 'bridge': {
        for (const sx of [-1, 1]) {
          let x = f.x, guard = 0;
          while (inb(x, f.y) && (w.t[I(x, f.y)] === BRIDGE || w.t[I(x, f.y)] === WATER) && guard++ < 30) x += sx;
          x += sx * 3;
          if (!inb(x, f.y)) continue;
          sandbagLine(x, f.y - 4, 0, 1, 2);
          sandbagLine(x, f.y + 3, 0, 1, 2);
          tryHouse(x + sx * 3, f.y + (R() < 0.5 ? -6 : 6), 0, 3, [4, 5, 3, 4], M_WOOD, 'gable', roofColor());
        }
        sandbagLine(f.x - 1, f.y - 2, 1, 0, 1);
        sandbagLine(f.x + 1, f.y + 2, 1, 0, 1);
        break;
      }
    }
    function door(b: Building): [number, number] {
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        if (w.t[I(x, y)] !== DOOR) continue;
        const ox = x === b.x ? -2 : x === b.x + b.w - 1 ? 2 : 0, oy = y === b.y ? -2 : y === b.y + b.h - 1 ? 2 : 0;
        return [x + ox, y + oy];
      }
      return [b.x - 2, b.y - 2];
    }
  }

  // 들판 곳곳의 외딴 오두막과 창고 (엄폐물)
  for (let k = 0; k < Math.round((cw * ch) / 1500); k++) {
    const x = 8 + Math.floor(R() * (cw - 16)), y = 8 + Math.floor(R() * (ch - 16));
    if (hq.some((h) => Math.hypot(h.x - x, h.y - y) < 20)) continue;
    const b = tryHouse(x, y, 0, 3, [4, 6, 3, 5], R() < 0.3 ? M_CONCRETE : M_WOOD, R() < 0.3 ? 'flat' : 'gable', R() < 0.3 ? '#767c82' : roofColor(), {}, 10);
    if (b && R() < 0.5) sandbagLine(b.x - 2, b.y + b.h + 1, 1, 0, 3);
  }

  // ── 6. 본부: 모래주머니, 천막, 차량 대기선 ──
  hq.forEach((h, team) => {
    const cx = (cw - 1) / 2;
    const dir = h.x < cx ? 1 : -1;
    disc(h.x, h.y, 12, (i) => { if (w.t[i] !== ROAD) set(i, GROUND); w.bld[i] = -1; });
    plaza(h.x, h.y, 2);
    const steps = 30;
    for (let s = 0; s < steps; s++) {
      const a = (dir > 0 ? 0 : Math.PI) + ((s / (steps - 1)) - 0.5) * 2.4;
      if (s % 5 === 2) continue;
      const x = Math.round(h.x + Math.cos(a) * 11), y = Math.round(h.y + Math.sin(a) * 11);
      if (inb(x, y) && w.t[I(x, y)] === GROUND) set(I(x, y), SANDBAG, 220);
    }
    for (let k = 0; k < 4; k++) w.decor.push({ k: 'tent', x: (h.x - dir * 6 + 0.5) * CELL, y: (h.y - 6 + k * 4 + 0.5) * CELL, a: 0, s: 1, c: team === 0 ? 'a' : 'b' });
    w.decor.push({ k: 'hqflag', x: (h.x + 0.5) * CELL, y: (h.y + 0.5) * CELL, a: 0, s: 1, c: String(team) });
    for (let k = 0; k < 10; k++) {
      const row = Math.floor(k / 5), col = k % 5;
      const px = h.x + dir * (4 + row * 3.4), py = h.y + (col - 2) * 3.6 + (col >= 2 ? 0 : 0);
      w.pads.push({ x: (px + 0.5) * CELL, y: (py + 0.5) * CELL, ang: dir > 0 ? 0 : Math.PI, team, type: '' });
      disc(Math.round(px), Math.round(py), 1.6, (i) => { if (w.t[i] !== ROAD) set(i, GROUND); w.gnd[i] = 3; });
    }
  });

  // ── 7. 숲과 바위 ──
  for (let y = 2; y < ch - 2; y++) for (let x = 2; x < cw - 2; x++) {
    const i = I(x, y);
    if (lock[i] || w.t[i] !== GROUND) continue;
    const fn = n3(x * 0.06, y * 0.06);
    const p = Math.max(0, Math.min(1, (fn - 0.42) * 2.8)) * def.forest;
    const rk = n1(x * 0.11 + 40, y * 0.11 + 40);
    if (rk > 0.8 && R() < 0.35) { set(i, ROCK); continue; }
    if (R() < p * 0.42 || R() < 0.004) {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && w.t[I(x + dx, y + dy)] === TREE) { near = true; break; }
      if (!near) set(i, TREE, 110, M_WOOD);
    }
  }
  // 길가 검문소와 버려진 차량
  for (let k = 0; k < Math.round(cw * ch / 5000); k++) {
    const x = 6 + Math.floor(R() * (cw - 12)), y = 6 + Math.floor(R() * (ch - 12));
    if (w.t[I(x, y)] !== ROAD || lock[I(x, y)] === 3) continue;
    for (let d = 2; d < 4; d++) {
      const nx = x + (R() < 0.5 ? d : -d);
      if (inb(nx, y) && w.t[I(nx, y)] === GROUND) { wreck(nx, y, false); break; }
    }
  }

  // ── 8. 모든 거점과 본부가 걸어서 이어지는지 확인하고, 막혔으면 길을 튼다 ──
  const reach = (sx: number, sy: number) => {
    const seen = new Uint8Array(n);
    const q = [I(sx, sy)];
    seen[q[0]] = 1;
    while (q.length) {
      const c = q.pop()!;
      const x = c % cw, y = (c - x) / cw;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const ni = I(nx, ny);
        if (seen[ni] || MOVE_BLOCK[w.t[ni]]) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return seen;
  };
  for (let pass = 0; pass < 4; pass++) {
    const seen = reach(hq[0].x, hq[0].y);
    const missing = [...flags, hq[1]].filter((p) => !seen[I(p.x, p.y)]);
    if (!missing.length) break;
    for (const p of missing) {
      const steps = Math.max(Math.abs(p.x - hq[0].x), Math.abs(p.y - hq[0].y));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(p.x + ((hq[0].x - p.x) * s) / steps), y = Math.round(p.y + ((hq[0].y - p.y) * s) / steps);
        disc(x, y, 1, (i) => {
          if (seen[i]) return;
          const t = w.t[i];
          if (t === WATER) set(i, BRIDGE);
          else if (MOVE_BLOCK[t]) set(i, t === WALL || t === WINDOW ? RUBBLE : GROUND);
        });
      }
    }
  }

  w.hq = hq.map((h) => ({ x: (h.x + 0.5) * CELL, y: (h.y + 0.5) * CELL }));
  w.flags = flags.map((f) => ({ x: (f.x + 0.5) * CELL, y: (f.y + 0.5) * CELL, name: f.name, tag: f.tag, site: f.site }));
  w.changed.length = 0;
  w.navDirty = false;
  return w;
}

export { FLOOR, M_CONCRETE, M_BRICK, WINDOW, DOOR };
