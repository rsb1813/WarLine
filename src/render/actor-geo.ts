// 병사·차량·소품 모델용 기하 도우미: 기본 도형을 이어 붙여 정점 색이 든 하나의 BufferGeometry 로 합친다.
import * as THREE from 'three';
import type { Quality } from '../types';

/** 각 층(병사·차량·소품)이 프레임마다 받는 공통 정보 */
export interface ActorCtx {
  frustum: THREE.Frustum;
  /** 카메라 월드 위치 */
  cam: THREE.Vector3;
  /** 누적 시간, 이번 프레임 간격(잘라 둔 값) */
  t: number; dt: number;
  quality: Quality;
  frame: number;
}

const _sph = new THREE.Sphere();
/** 구가 시야 절두체에 걸치나 */
export function inView(ctx: ActorCtx, x: number, y: number, z: number, r: number): boolean {
  _sph.center.set(x, y, z);
  _sph.radius = r;
  return ctx.frustum.intersectsSphere(_sph);
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const IDENT = new THREE.Matrix4();

/** 이동·회전(XYZ 오일러)·크기 → 행렬 */
export function xf(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'XYZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** 회색조 배율로 색을 어둡게/밝게 */
export function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/** 두 색 섞기 */
export function mixHex(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];
  /** uv 배율 (압출 도형처럼 uv 가 미터 단위일 때 줄인다) */
  uvScale = 1;

  get empty(): boolean { return this.pos.length === 0; }

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: number, uvMul = 1): this {
    const mat = m ?? IDENT;
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const t = geo.getAttribute('uv');
    _nm.getNormalMatrix(mat);
    _c.setHex(color);
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      _v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(mat);
      this.pos.push(_v.x, _v.y, _v.z);
      if (n) { _v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(_nm).normalize(); this.nor.push(_v.x, _v.y, _v.z); }
      else this.nor.push(0, 1, 0);
      this.col.push(_c.r, _c.g, _c.b);
      if (t) this.uv.push(t.getX(i) * uvMul * this.uvScale, t.getY(i) * uvMul * this.uvScale);
      else this.uv.push(0, 0);
    }
    const ix = geo.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) this.idx.push(base + ix.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    geo.dispose();
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color = 0xffffff, rx = 0, ry = 0, rz = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), xf(x, y, z, rx, ry, rz), color);
  }
  /** 원기둥 (기본 축 Y) */
  cyl(rTop: number, rBot: number, h: number, x: number, y: number, z: number, color: number, rx = 0, ry = 0, rz = 0, seg = 10, sx = 1, sz = 1): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), xf(x, y, z, rx, ry, rz, sx, 1, sz), color);
  }
  /** 축이 Z 인 원기둥 (총열 등) */
  cylZ(r: number, len: number, x: number, y: number, z: number, color: number, seg = 8, r2 = r): this {
    return this.add(new THREE.CylinderGeometry(r2, r, len, seg, 1), xf(x, y, z, -Math.PI / 2, 0, 0), color);
  }
  /** 축이 X 인 원기둥 (바퀴 등) */
  cylX(r: number, w: number, x: number, y: number, z: number, color: number, seg = 12): this {
    return this.add(new THREE.CylinderGeometry(r, r, w, seg, 1), xf(x, y, z, 0, 0, Math.PI / 2), color);
  }
  sphere(r: number, x: number, y: number, z: number, color: number, sx = 1, sy = 1, sz = 1, ws = 10, hs = 7): this {
    return this.add(new THREE.SphereGeometry(r, ws, hs), xf(x, y, z, 0, 0, 0, sx, sy, sz), color);
  }
  /** 위쪽 일부만 있는 구(헬멧 껍데기 등). thetaLen = 위에서부터 덮는 각 */
  dome(r: number, thetaLen: number, x: number, y: number, z: number, color: number, sx = 1, sy = 1, sz = 1, ws = 14, hs = 7): this {
    return this.add(new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, thetaLen), xf(x, y, z, 0, 0, 0, sx, sy, sz), color);
  }

  /**
   * 옆모습(z, y) 다각형을 X 방향으로 폭만큼 밀어낸 모양. 앞은 -z.
   * bevel 이 있으면 모서리를 깎는다.
   */
  sideExtrude(pts: [number, number][], width: number, xCenter: number, color: number, bevel = 0): this {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
    sh.closePath();
    const depth = Math.max(0.01, width - bevel * 2);
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
    // shape x → model z, shape y → model y, 밀어낸 방향(shape z) → model -x (회전 행렬이라 면 방향 유지)
    const m = new THREE.Matrix4().set(
      0, 0, -1, xCenter + depth / 2,
      0, 1, 0, 0,
      1, 0, 0, 0,
      0, 0, 0, 1,
    );
    return this.add(geo, m, color, 0.25);
  }

  /** 위에서 본(x, 앞쪽+) 다각형을 위로 높이만큼 밀어낸 모양. 바닥이 y0. */
  topExtrude(pts: [number, number][], height: number, y0: number, color: number, bevel = 0, zOff = 0): this {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
    sh.closePath();
    const depth = Math.max(0.01, height - bevel * 2);
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
    // shape x → x, shape y → -z, shape z → y
    const m = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, 0, 1, y0 + bevel,
      0, -1, 0, zOff,
      0, 0, 0, 1,
    );
    return this.add(geo, m, color, 0.25);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const n = this.pos.length / 3;
    g.setIndex(n > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function canvas(size: number): { c: HTMLCanvasElement; x: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  if (!x) return null;
  return { c, x };
}

function hexCss(h: number): string { return '#' + h.toString(16).padStart(6, '0'); }

/** 결정적 난수 */
function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 이음매 없이 반복되는 얼룩 위장 무늬. cols[0] 바탕, 나머지 얼룩. */
export function camoTexture(cols: number[], seed: number, size = 256, splinter = true): THREE.Texture | null {
  const cv = canvas(size);
  if (!cv) return null;
  const { c, x } = cv;
  const r = rnd(seed);
  x.fillStyle = hexCss(cols[0]);
  x.fillRect(0, 0, size, size);
  for (let layer = 1; layer < cols.length; layer++) {
    x.fillStyle = hexCss(cols[layer]);
    const n = layer === 1 ? 26 : 16;
    for (let i = 0; i < n; i++) {
      const cx = r() * size, cy = r() * size;
      const rad = size * (layer === 1 ? 0.07 + r() * 0.09 : 0.04 + r() * 0.06);
      const pts = splinter ? 5 + Math.floor(r() * 3) : 9;
      const poly: [number, number][] = [];
      const rot = r() * Math.PI;
      for (let k = 0; k < pts; k++) {
        const a = rot + (k / pts) * Math.PI * 2;
        const rr = rad * (0.55 + r() * 0.75) * (splinter && k % 2 ? 0.55 : 1);
        poly.push([Math.cos(a) * rr * 1.6, Math.sin(a) * rr * 0.8]);
      }
      // 가장자리에서 잘리지 않게 9칸에 반복해서 그린다
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        x.beginPath();
        for (let k = 0; k < poly.length; k++) {
          const px = cx + ox * size + poly[k][0], py = cy + oy * size + poly[k][1];
          if (k === 0) x.moveTo(px, py); else x.lineTo(px, py);
        }
        x.closePath();
        x.fill();
      }
    }
  }
  // 잔 얼룩 (때·긁힘)
  for (let i = 0; i < size * 2; i++) {
    const g = Math.floor(r() * 40);
    x.fillStyle = `rgba(${g},${g},${g},${0.04 + r() * 0.06})`;
    x.fillRect(r() * size, r() * size, 1 + r() * 3, 1 + r() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  t.needsUpdate = true;
  return t;
}
