// 지형(높이장 덩어리 + 지도 밖 둘레), 도로 띠, 물, 얼음 조각, 헬기장 표시.
import * as THREE from 'three';
import type { World } from '../types';
import { heightAt, groundTypeAt } from '../world';
import { fbm, rng, smoothstep, clamp } from '../math';
import { roadTex, trackTex, waterNormalTex, helipadTex } from './textures';
import { makeTerrainMaterial, makeWaterMaterial, type SharedUniforms, type WaterUniforms } from './world-shaders';
import type { Palette } from './world-sky';

/** 지면 종류별 색 (sRGB): [기본, 변형, 셋째] */
const GROUND_COLS: [number, number, number][] = [
  [0xedf1f6, 0xd2dce7, 0xe4e9ef], // 0 눈
  [0x6a6250, 0x7b6c55, 0x8a8063], // 1 툰드라
  [0x4b3b2e, 0x3b332b, 0x55453a], // 2 흙
  [0x3b3d40, 0x46474a, 0x333538], // 3 아스팔트
  [0x8b8a85, 0x797873, 0x96948e], // 4 콘크리트
  [0x7a756b, 0x66625a, 0x857f73], // 5 자갈
];
const ROCK_COLS: [number, number] = [0x5a5550, 0x48443f];
const SILT = 0x3a3f38;

const lin = (hex: number): THREE.Color => new THREE.Color().setHex(hex);

export class TerrainLayer {
  readonly group = new THREE.Group();
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private waterUni: WaterUniforms | null = null;
  private waterMat: THREE.MeshStandardMaterial | null = null;
  private floes: THREE.Mesh | null = null;
  private waterY = -1e9;

  constructor(w: World, sh: SharedUniforms, pal: Palette, env: THREE.Texture | null) {
    const terrainMat = makeTerrainMaterial(sh);
    this.mats.push(terrainMat);
    this.buildTerrain(w, terrainMat);
    this.buildRoads(w);
    if (w.water > -1e8) this.buildWater(w, pal, env);
    this.buildHelipads(w);
  }

  // ───────────────────────── 지형 ─────────────────────────

  private buildTerrain(w: World, mat: THREE.Material): void {
    const N = w.hfN, cell = w.hfCell, V = N + 1, size = N * cell;
    const theme = w.def.theme;
    const water = w.water > -1e8 ? w.water : -1e9;

    const H = new Float32Array(V * V);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) H[j * V + i] = heightAt(w, i * cell, j * cell);
    const T = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) T[j * N + i] = groundTypeAt(w, (i + 0.5) * cell, (j + 0.5) * cell);

    // 꼭짓점마다 둘레 칸들의 종류 가중치 → 두 번 흐리게
    const W6 = new Float32Array(V * V * 6);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const o = (j * V + i) * 6;
      for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
        const ci = clamp(i + di, 0, N - 1), cj = clamp(j + dj, 0, N - 1);
        W6[o + Math.min(5, T[cj * N + ci])] += 0.25;
      }
    }
    blurChannels(W6, V, V, 6, 2);

    // 법선
    const NR = new Float32Array(V * V * 3);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const hl = H[j * V + Math.max(0, i - 1)], hr = H[j * V + Math.min(N, i + 1)];
      const hd = H[Math.max(0, j - 1) * V + i], hu = H[Math.min(N, j + 1) * V + i];
      const sx = (i > 0 && i < N ? 2 : 1) * cell, sz = (j > 0 && j < N ? 2 : 1) * cell;
      const nx = (hl - hr) / sx, nz = (hd - hu) / sz;
      const il = 1 / Math.hypot(nx, 1, nz);
      NR[(j * V + i) * 3] = nx * il; NR[(j * V + i) * 3 + 1] = il; NR[(j * V + i) * 3 + 2] = nz * il;
    }

    // 색과 aGround
    const seed = w.def.seed;
    const nA = fbm(seed + 11, 4), nB = fbm(seed + 23, 3), nC = fbm(seed + 37, 3);
    const dust = theme === 'snow' ? 0.75 : theme === 'industrial' ? 0.45 : 0.2;
    const pal = GROUND_COLS.map((t) => t.map(lin));
    const rockA = lin(ROCK_COLS[0]), rockB = lin(ROCK_COLS[1]), silt = lin(SILT);
    const dirtySnow = lin(0xc4c6c6);
    const COL = new Float32Array(V * V * 3), GR = new Float32Array(V * V * 4);
    const c = new THREE.Color(), tmp = new THREE.Color();
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i, x = i * cell, z = j * cell, h = H[k];
      const a = nA(x * 0.018, z * 0.018), b = nB(x * 0.09, z * 0.09), pc = nC(x * 0.05, z * 0.05);
      let wS = W6[k * 6], wV = W6[k * 6 + 1];
      const wD = W6[k * 6 + 2], wA = W6[k * 6 + 3], wC = W6[k * 6 + 4], wG = W6[k * 6 + 5];
      // 툰드라 위 바람에 쌓인 눈 얼룩
      const patch = smoothstep(0.62 - dust * 0.35, 0.74 - dust * 0.3, pc + (b - 0.5) * 0.3) * Math.min(1, dust + 0.25);
      wS += wV * patch; wV *= 1 - patch;
      const ny = NR[k * 3 + 1];
      const rock = smoothstep(0.9, 0.7, ny);
      const rS = wS * rock * 0.85;
      wS -= rS;
      const wR = rS + (wV + wD + wG) * rock * 0.5;
      wV *= 1 - rock * 0.5;
      const tot = wS + wV + wD + wA + wC + wG + wR || 1;
      c.setRGB(0, 0, 0);
      const mixT = (t: number, wt: number) => {
        if (wt <= 0) return;
        const p = pal[t];
        tmp.copy(p[0]).lerp(p[1], a).lerp(p[2], b * 0.5);
        c.r += tmp.r * wt; c.g += tmp.g * wt; c.b += tmp.b * wt;
      };
      mixT(0, wS); mixT(1, wV); mixT(2, wD); mixT(3, wA); mixT(4, wC); mixT(5, wG);
      if (wR > 0) { tmp.copy(rockA).lerp(rockB, b); c.r += tmp.r * wR; c.g += tmp.g * wR; c.b += tmp.b * wR; }
      c.multiplyScalar(1 / tot);
      if (theme === 'industrial') { const sn = wS / tot; tmp.copy(c).lerp(dirtySnow, 0.3 * sn * (0.5 + a)); c.copy(tmp); }
      // 물가: 젖어서 어둡고, 물속은 진흙
      if (h < water + 0.6) {
        const wet = smoothstep(water + 0.6, water - 0.1, h);
        c.multiplyScalar(1 - wet * 0.25);
        const sub = smoothstep(water - 0.2, water - 1.4, h);
        c.lerp(silt, sub);
      }
      COL[k * 3] = c.r; COL[k * 3 + 1] = c.g; COL[k * 3 + 2] = c.b;
      GR[k * 4] = wS / tot; GR[k * 4 + 1] = wV / tot; GR[k * 4 + 2] = (wA + wC) / tot; GR[k * 4 + 3] = (wD + wG + wR) / tot;
    }

    // 덩어리 (최대 128 칸, Uint16 색인)
    const C = 128;
    for (let cj = 0; cj < N; cj += C) for (let ci = 0; ci < N; ci += C) {
      const i1 = Math.min(N, ci + C), j1 = Math.min(N, cj + C);
      const cw = i1 - ci + 1, ch = j1 - cj + 1;
      const pos = new Float32Array(cw * ch * 3), nor = new Float32Array(cw * ch * 3);
      const col = new Float32Array(cw * ch * 3), gr = new Float32Array(cw * ch * 4);
      for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
        const gi = ci + i, gj = cj + j, k = gj * V + gi, o = j * cw + i;
        pos[o * 3] = gi * cell; pos[o * 3 + 1] = H[k]; pos[o * 3 + 2] = gj * cell;
        nor.set(NR.subarray(k * 3, k * 3 + 3), o * 3);
        col.set(COL.subarray(k * 3, k * 3 + 3), o * 3);
        gr.set(GR.subarray(k * 4, k * 4 + 4), o * 4);
      }
      const idx: number[] = [];
      for (let j = 0; j < ch - 1; j++) for (let i = 0; i < cw - 1; i++) {
        const a = j * cw + i, b = a + 1, d = a + cw, e = d + 1;
        const ka = (cj + j) * V + ci + i;
        const h00 = H[ka], h10 = H[ka + 1], h01 = H[ka + V], h11 = H[ka + V + 1];
        if (Math.abs(h00 - h11) < Math.abs(h10 - h01)) idx.push(a, d, e, a, e, b);
        else idx.push(a, d, b, b, d, e);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aGround', new THREE.BufferAttribute(gr, 4));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.name = 'terrain';
      this.geos.push(g);
      this.group.add(m);
    }

    this.buildApron(w, H, NR, COL, GR, size, mat);
  }

  /** 지도 밖 둘레: 가장자리 꼭짓점에서 바깥으로 뻗는 광선 격자. 절벽 없이 낮은 언덕·바다로 이어진다 */
  private buildApron(w: World, H: Float32Array, NR: Float32Array, COL: Float32Array, GR: Float32Array, size: number, mat: THREE.Material): void {
    const N = w.hfN, cell = w.hfCell, V = N + 1;
    const water = w.water > -1e8 ? w.water : -1e9;
    type Ray = { ox: number; oz: number; dx: number; dz: number; k: number };
    const rays: Ray[] = [];
    const K = 7;
    const sides = [
      { ang: -Math.PI / 2, at: (s: number) => ({ i: s, j: 0 }) },
      { ang: 0, at: (s: number) => ({ i: N, j: s }) },
      { ang: Math.PI / 2, at: (s: number) => ({ i: N - s, j: N }) },
      { ang: Math.PI, at: (s: number) => ({ i: 0, j: N - s }) },
    ];
    for (let sd = 0; sd < 4; sd++) {
      const S = sides[sd];
      const prevAng = S.ang - Math.PI / 2;
      for (let s = 0; s < N; s++) {
        const { i, j } = S.at(s);
        const k = j * V + i;
        if (s === 0) {
          for (let f = 0; f <= K; f++) {
            const a = prevAng + (f / K) * (Math.PI / 2);
            rays.push({ ox: i * cell, oz: j * cell, dx: Math.cos(a), dz: Math.sin(a), k });
          }
        } else rays.push({ ox: i * cell, oz: j * cell, dx: Math.cos(S.ang), dz: Math.sin(S.ang), k });
      }
    }
    const R = rays.length;
    const D = [0, 5, 12, 22, 36, 55, 80, 115, 160, 220, 300, 400, 520, 660, 820];
    const NK = D.length;
    const edge = new Float32Array(R);
    let avg = 0;
    for (let r = 0; r < R; r++) { edge[r] = H[rays[r].k]; avg += edge[r]; }
    avg /= R;
    const edgeS = circBlur(edge, 10);
    const coast = new Float32Array(R);
    if (water > -1e8) for (let r = 0; r < R; r++) coast[r] = smoothstep(water + 1.2, water - 0.4, Math.min(edge[r], edgeS[r] + 0.5));
    const coastS = circBlur(coast, 14);
    const seed = w.def.seed;
    const nH = fbm(seed + 51, 4), nS = fbm(seed + 53, 3), nP = fbm(seed + 57, 3);
    const hillAmp = 18 + 45 * w.def.hills;
    const theme = w.def.theme;
    const far = lin(theme === 'tundra' ? 0x9a9a7e : theme === 'industrial' ? 0xd2d5d8 : 0xe9eef4);
    const farSnow = lin(0xe6ecf2), farVeg = lin(0x746a56), silt = lin(SILT);
    const pos = new Float32Array(R * NK * 3), nor = new Float32Array(R * NK * 3);
    const col = new Float32Array(R * NK * 3), gr = new Float32Array(R * NK * 4);
    const c = new THREE.Color(), e = new THREE.Color();
    for (let r = 0; r < R; r++) {
      const ry = rays[r];
      for (let q = 0; q < NK; q++) {
        const d = D[q], o = r * NK + q;
        const x = ry.ox + ry.dx * d, z = ry.oz + ry.dz * d;
        let h: number;
        if (q === 0) h = edge[r];
        else {
          const hills = (nH(x * 0.0035, z * 0.0035) - 0.38) * hillAmp * smoothstep(30, 380, d);
          const bumps = (nS(x * 0.03, z * 0.03) - 0.5) * 2.5 * smoothstep(5, 50, d);
          let land = edgeS[r] + (avg - edgeS[r]) * smoothstep(0, 500, d) + hills + bumps;
          if (water > -1e8) land = Math.max(land, water + 1.5 * smoothstep(20, 80, d) - 3 * (1 - smoothstep(20, 80, d)));
          const sea = water - 2.5 - smoothstep(0, 250, d) * 8;
          const tgt = land + (sea - land) * coastS[r];
          h = edge[r] + (tgt - edge[r]) * smoothstep(0, 70, d);
        }
        pos[o * 3] = x; pos[o * 3 + 1] = h; pos[o * 3 + 2] = z;
        // 색
        const t = smoothstep(0, 60, d);
        e.setRGB(COL[ry.k * 3], COL[ry.k * 3 + 1], COL[ry.k * 3 + 2]);
        const pv = nP(x * 0.02, z * 0.02);
        if (theme === 'tundra') c.copy(farVeg).lerp(farSnow, smoothstep(0.45, 0.65, pv));
        else c.copy(far).lerp(farSnow, 0.3 * pv);
        c.lerp(e, 1 - t);
        if (h < water + 0.3) c.lerp(silt, smoothstep(water + 0.3, water - 1.2, h));
        col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
        const g0 = GR.subarray(ry.k * 4, ry.k * 4 + 4);
        const fs = theme === 'tundra' ? smoothstep(0.45, 0.65, pv) : 1;
        gr[o * 4] = g0[0] + (fs - g0[0]) * t;
        gr[o * 4 + 1] = g0[1] + ((1 - fs) - g0[1]) * t;
        gr[o * 4 + 2] = g0[2] * (1 - t);
        gr[o * 4 + 3] = g0[3] * (1 - t);
      }
    }
    const idx: number[] = [];
    // 감김 방향: 첫 사각형으로 판단
    let flip = false;
    {
      const a = 0 * NK + 1, b = 1 * NK + 1, a1 = a + 1;
      const ax = pos[b * 3] - pos[a * 3], az = pos[b * 3 + 2] - pos[a * 3 + 2];
      const bx = pos[a1 * 3] - pos[a * 3], bz = pos[a1 * 3 + 2] - pos[a * 3 + 2];
      flip = ax * bz - az * bx > 0;
    }
    for (let r = 0; r < R; r++) {
      const r2 = (r + 1) % R;
      for (let q = 0; q < NK - 1; q++) {
        const a = r * NK + q, b = r2 * NK + q;
        if (flip) idx.push(a, a + 1, b, b, a + 1, b + 1);
        else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aGround', new THREE.BufferAttribute(gr, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const na = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let r = 0; r < R; r++) {
      const o = r * NK, k = rays[r].k;
      na.setXYZ(o, NR[k * 3], NR[k * 3 + 1], NR[k * 3 + 2]);
    }
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.name = 'apron';
    this.geos.push(g);
    this.group.add(m);
    void size;
  }

  // ───────────────────────── 도로 ─────────────────────────

  private buildRoads(w: World): void {
    const wide = w.roads.filter((r) => r.w >= 5), narrow = w.roads.filter((r) => r.w < 5);
    const water = w.water > -1e8 ? w.water : -1e9;
    const make = (list: typeof w.roads, tex: THREE.Texture, margin: number, period: number, base: number) => {
      if (!list.length) return;
      const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
      list.forEach((road, ri) => {
        const W = road.w, half = W / 2 + W * margin;
        const offs = [-half, -W / 2, -W / 4, 0, W / 4, W / 2, half];
        const lift = base + (ri % 7) * 0.004;
        const pts = resample(road.pts, 2);
        let strip: number[] = [];
        let vAcc = 0;
        const flush = () => {
          if (strip.length >= 2) {
            for (let s = 0; s < strip.length - 1; s++) {
              const a0 = strip[s], b0 = strip[s + 1];
              for (let cI = 0; cI < offs.length - 1; cI++) {
                const a = a0 + cI, b = b0 + cI;
                // 위를 보게 감기
                const ax = pos[b * 3] - pos[a * 3], az = pos[b * 3 + 2] - pos[a * 3 + 2];
                const bx = pos[(a + 1) * 3] - pos[a * 3], bz = pos[(a + 1) * 3 + 2] - pos[a * 3 + 2];
                if (ax * bz - az * bx > 0) idx.push(a, a + 1, b, b, a + 1, b + 1);
                else idx.push(a, b, a + 1, b, b + 1, a + 1);
              }
            }
          }
          strip = [];
        };
        for (let s = 0; s < pts.length; s++) {
          const p = pts[s];
          const pa = pts[Math.max(0, s - 1)], pb = pts[Math.min(pts.length - 1, s + 1)];
          let tx = pb[0] - pa[0], tz = pb[1] - pa[1];
          const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          if (s > 0) vAcc += Math.hypot(p[0] - pts[s - 1][0], p[1] - pts[s - 1][1]);
          const hc = heightAt(w, p[0], p[1]);
          if (hc < water - 0.15) { flush(); continue; }
          const start = pos.length / 3;
          for (let cI = 0; cI < offs.length; cI++) {
            const o = offs[cI];
            const x = clamp(p[0] - tz * o, 0, w.size), z = clamp(p[1] + tx * o, 0, w.size);
            const outer = cI === 0 || cI === offs.length - 1;
            const y = heightAt(w, x, z) + (outer ? lift * 0.5 : lift);
            pos.push(x, y, z);
            const hl = heightAt(w, x - 1, z), hr = heightAt(w, x + 1, z), hd = heightAt(w, x, z - 1), hu = heightAt(w, x, z + 1);
            const nx = (hl - hr) / 2, nz = (hd - hu) / 2, il = 1 / Math.hypot(nx, 1, nz);
            nor.push(nx * il, il, nz * il);
            uv.push((o + half) / (2 * half), vAcc / period);
          }
          strip.push(start);
        }
        flush();
      });
      if (!idx.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.84, metalness: 0, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mesh.name = 'roads';
      this.geos.push(g); this.mats.push(m);
      this.group.add(mesh);
    };
    make(wide, roadTex(), 0.12, 12, 0.07);
    make(narrow, trackTex(), 0.3, 8, 0.06);
  }

  // ───────────────────────── 물 ─────────────────────────

  private buildWater(w: World, pal: Palette, env: THREE.Texture | null): void {
    this.waterY = w.water;
    const ext = w.size + 3000;
    const g = new THREE.PlaneGeometry(ext, ext, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(w.size / 2, 0, w.size / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 14, p.getZ(i) / 14);
    const { mat, uni } = makeWaterMaterial(waterNormalTex(), env, pal.water);
    this.waterUni = uni; this.waterMat = mat;
    const m = new THREE.Mesh(g, mat);
    m.position.y = w.water;
    m.receiveShadow = true;
    m.renderOrder = 2;
    m.frustumCulled = false;
    m.name = 'water';
    this.geos.push(g); this.mats.push(mat);
    this.group.add(m);

    // 얼음 조각 (눈 테마)
    if (w.def.theme !== 'tundra') {
      const r = rng(w.def.seed * 31 + 7);
      const spots: [number, number, number, number, number][] = [];
      const max = w.def.theme === 'snow' ? 80 : 30;
      for (let t = 0; t < 1500 && spots.length < max; t++) {
        const x = r() * w.size, z = r() * w.size;
        if (heightAt(w, x, z) > w.water - 0.7) continue;
        const s = 1.2 + r() * r() * 6;
        if (spots.some((q) => Math.hypot(q[0] - x, q[1] - z) < (q[2] + s) * 0.9)) continue;
        spots.push([x, z, s, r() * Math.PI * 2, 0.6 + r() * 0.8]);
      }
      if (spots.length) {
        const fg = new THREE.CylinderGeometry(1, 1, 0.28, 8, 1);
        const fp = fg.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < fp.count; i++) {
          const x = fp.getX(i), z = fp.getZ(i);
          const a = Math.atan2(z, x), rr = Math.hypot(x, z);
          if (rr < 1e-3) continue;
          const k = 0.7 + 0.45 * Math.abs(Math.sin(a * 2.3 + 1.1) * Math.cos(a * 1.7));
          fp.setXYZ(i, x * k, fp.getY(i), z * k);
        }
        fg.computeVertexNormals();
        const fm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0 });
        const im = new THREE.InstancedMesh(fg, fm, spots.length);
        const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
        const cc = new THREE.Color();
        spots.forEach((sp, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sp[3]);
          sc.set(sp[2], 1, sp[2] * sp[4]);
          ps.set(sp[0], 0.02, sp[1]);
          mt.compose(ps, q, sc);
          im.setMatrixAt(i, mt);
          cc.setHex(0xdfe8f0).multiplyScalar(0.88 + r() * 0.14);
          im.setColorAt(i, cc);
        });
        im.position.y = w.water;
        im.receiveShadow = true;
        im.castShadow = false;
        im.name = 'floes';
        this.floes = im;
        this.geos.push(fg); this.mats.push(fm);
        this.group.add(im);
      }
    }
  }

  setEnv(env: THREE.Texture | null): void {
    if (this.waterMat) { this.waterMat.envMap = env; this.waterMat.needsUpdate = true; }
  }

  // ───────────────────────── 헬기장 ─────────────────────────

  private buildHelipads(w: World): void {
    const pads = w.vehicleSpawns.filter((v) => v.air);
    if (!pads.length) return;
    const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
    const S = 6;
    for (const p of pads) {
      const y = Math.max(heightAt(w, p.pos.x, p.pos.z), p.pos.y - 1) + 0.08;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      const base = pos.length / 3;
      const corners: [number, number, number, number][] = [[-S, -S, 0, 0], [S, -S, 1, 0], [S, S, 1, 1], [-S, S, 0, 1]];
      for (const [x, z, u, v] of corners) {
        const wx = p.pos.x + x * c + z * s, wz = p.pos.z - x * s + z * c;
        pos.push(wx, Math.max(y, heightAt(w, wx, wz) + 0.08), wz);
        uv.push(u, v); nor.push(0, 1, 0);
      }
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.MeshStandardMaterial({
      map: helipadTex(), roughness: 0.9, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.name = 'helipads';
    this.geos.push(g); this.mats.push(m);
    this.group.add(mesh);
  }

  update(time: number): void {
    if (this.waterUni) {
      this.waterUni.uFlow1.value.set(time * 0.011, time * 0.006);
      this.waterUni.uFlow2.value.set(-time * 0.008, time * 0.013);
    }
    if (this.floes) this.floes.position.y = this.waterY - 0.06 + Math.sin(time * 0.7) * 0.025;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos = []; this.mats = [];
    this.group.clear();
  }
}

// ───────────────────────── 도우미 ─────────────────────────

/** 채널 여러 개짜리 격자를 3x3 상자 흐림으로 passes 번 */
function blurChannels(a: Float32Array, w: number, h: number, ch: number, passes: number): void {
  const tmp = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    // 가로
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(w - 1, i + 1);
      for (let c = 0; c < ch; c++) tmp[(j * w + i) * ch + c] = (a[(j * w + i0) * ch + c] + a[(j * w + i) * ch + c] + a[(j * w + i1) * ch + c]) / 3;
    }
    // 세로
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const j0 = Math.max(0, j - 1), j1 = Math.min(h - 1, j + 1);
      for (let c = 0; c < ch; c++) a[(j * w + i) * ch + c] = (tmp[(j0 * w + i) * ch + c] + tmp[(j * w + i) * ch + c] + tmp[(j1 * w + i) * ch + c]) / 3;
    }
  }
}

/** 고리 모양 배열의 이동 평균 */
function circBlur(a: Float32Array, rad: number): Float32Array {
  const n = a.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -rad; k <= rad; k++) s += a[(i + k + n) % n];
    out[i] = s / (2 * rad + 1);
  }
  return out;
}

/** 꺾은선을 step m 이하 간격으로 다시 나눈다 (원래 꼭짓점 포함) */
function resample(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)]);
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}
