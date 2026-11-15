// render-fx: 인스턴스 빌보드 파티클 풀 (InstancedBufferGeometry + ShaderMaterial).
// 인스턴스마다 위치·방향·색·알파·크기·회전·칸(플립북)·모드. 모드 0 = 카메라 정면, 1 = 속도 방향으로 늘인 줄(예광탄·불티),
// 2 = 바닥에 눕힌 판(충격파 고리·물결). 정렬 없음: 가산(불·불티·섬광) 풀과 일반 알파(연기·먼지) 풀을 따로 둔다.
// CPU 쪽은 구조-배열(SoA) Float32Array 로 밀집 보관(죽으면 맨 끝 것을 옮겨 채움), 프레임마다 쓰는 구간만 올린다.
import * as THREE from 'three';
import { GRID } from './fx-textures';

export interface Col { r: number; g: number; b: number }

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iDir;
attribute vec4 iCol;
attribute vec4 iPrm;
uniform float uGrid;
uniform float uPx;
varying vec2 vUv;
varying vec4 vCol;
varying float vShade;
varying float vDepth;
#include <fog_pars_vertex>
void main() {
  vec2 c = position.xy;
  float size = iPrm.x;
  float rot = iPrm.y;
  float mode = iPrm.w;
  vec4 mvPosition;
  vShade = 1.0;
  if (mode < 0.5) {
    float cs = cos(rot), sn = sin(rot);
    vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
    mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    mvPosition.xy += rc;
    vShade = mix(0.7, 1.12, c.y + 0.5);
  } else if (mode < 1.5) {
    vec3 pv = (modelViewMatrix * vec4(iPos, 1.0)).xyz;
    vec3 dv = (modelViewMatrix * vec4(iDir, 0.0)).xyz;
    vec3 sd = cross(dv, pv);
    float sl = length(sd);
    sd = sl > 1e-6 ? sd / sl : vec3(1.0, 0.0, 0.0);
    float w = max(size, uPx * 1.6 * max(-pv.z, 0.0));
    mvPosition = vec4(pv + dv * (c.y - 0.5) + sd * (c.x * w), 1.0);
  } else {
    float cs = cos(rot), sn = sin(rot);
    vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
    mvPosition = modelViewMatrix * vec4(iPos + vec3(rc.x, 0.0, rc.y), 1.0);
  }
  float f = floor(iPrm.z + 0.5);
  float fy = floor(f / uGrid + 0.001);
  float fx = f - fy * uGrid;
  vUv = (vec2(fx, fy) + 0.5 + c * 0.97) / uGrid;
  vCol = iCol;
  vDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uLight;
varying vec2 vUv;
varying vec4 vCol;
varying float vShade;
varying float vDepth;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vCol.a * smoothstep(0.12, 0.6, vDepth);
  if (a < 0.003) discard;
#ifdef ADDITIVE
  vec3 col = vCol.rgb * t.rgb * a;
#else
  vec3 col = vCol.rgb * t.rgb * uLight * vShade;
#endif
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  #ifdef ADDITIVE
    col *= 1.0 - fogF;
  #else
    col = mix(col, fogColor, fogF);
  #endif
#endif
#ifdef ADDITIVE
  gl_FragColor = vec4(col, 1.0);
#else
  gl_FragColor = vec4(col, a);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ParticlePool {
  readonly cap: number;
  /** 살아 있는 파티클 수 */
  n = 0;
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  windX = 0; windZ = 0;

  readonly px: Float32Array; readonly py: Float32Array; readonly pz: Float32Array;
  readonly vx: Float32Array; readonly vy: Float32Array; readonly vz: Float32Array;
  readonly age: Float32Array; readonly life: Float32Array;
  readonly s0: Float32Array; readonly s1: Float32Array;
  readonly rot: Float32Array; readonly rv: Float32Array;
  readonly r0: Float32Array; readonly g0: Float32Array; readonly b0: Float32Array;
  readonly r1: Float32Array; readonly g1: Float32Array; readonly b1: Float32Array;
  /** 최대 알파, 나타나기 끝(수명 비율), 사라지기 시작(수명 비율) */
  readonly al: Float32Array; readonly fin: Float32Array; readonly fout: Float32Array;
  /** 초당 감쇠, 중력(+ = 아래, - = 떠오름), 바람 영향 0..1 */
  readonly drag: Float32Array; readonly grav: Float32Array; readonly wnd: Float32Array;
  /** 첫 칸, 수명 동안 재생할 칸 수 */
  readonly fr: Float32Array; readonly nf: Float32Array;
  /** 모드, 늘인 줄 기본 길이, 속도당 길이 */
  readonly mode: Float32Array; readonly ln: Float32Array; readonly st: Float32Array;
  /** 바닥 높이와 튕김 (0 = 닿으면 멈춤) */
  readonly gy: Float32Array; readonly bnc: Float32Array;

  private readonly all: Float32Array[];
  private readonly extCap: number;
  private ext = 0;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aDir: THREE.InstancedBufferAttribute;
  private readonly aCol: THREE.InstancedBufferAttribute;
  private readonly aPrm: THREE.InstancedBufferAttribute;

  constructor(atlas: THREE.Texture, cap: number, extCap: number, additive: boolean) {
    this.cap = cap;
    this.extCap = extCap;
    const N = cap + 1; // 마지막 칸 = 가득 찼을 때 쓰기를 흘려보내는 빈 칸
    const f = (): Float32Array => new Float32Array(N);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.s0 = f(); this.s1 = f(); this.rot = f(); this.rv = f();
    this.r0 = f(); this.g0 = f(); this.b0 = f(); this.r1 = f(); this.g1 = f(); this.b1 = f();
    this.al = f(); this.fin = f(); this.fout = f(); this.drag = f(); this.grav = f(); this.wnd = f();
    this.fr = f(); this.nf = f(); this.mode = f(); this.ln = f(); this.st = f(); this.gy = f(); this.bnc = f();
    this.all = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.age, this.life, this.s0, this.s1, this.rot, this.rv,
      this.r0, this.g0, this.b0, this.r1, this.g1, this.b1, this.al, this.fin, this.fout, this.drag, this.grav, this.wnd,
      this.fr, this.nf, this.mode, this.ln, this.st, this.gy, this.bnc];

    const M = cap + extCap;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (k: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(M * k), k);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(3); this.aDir = mk(3); this.aCol = mk(4); this.aPrm = mk(4);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iDir', this.aDir);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iPrm', this.aPrm);
    geo.instanceCount = 0;
    this.geo = geo;

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: atlas },
        uGrid: { value: GRID },
        uPx: { value: 0.001 },
        uLight: { value: new THREE.Color(1, 1, 1) },
        fogColor: { value: new THREE.Color(0xffffff) },
        fogNear: { value: 1 },
        fogFar: { value: 2000 },
        fogDensity: { value: 0.00025 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: additive ? { ADDITIVE: '' } : {},
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      side: THREE.DoubleSide,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
    });
    if (additive) {
      this.mat.blendEquation = THREE.AddEquation;
      this.mat.blendSrc = THREE.OneFactor;
      this.mat.blendDst = THREE.OneFactor;
    }
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 11;
    this.mesh.visible = false;
  }

  /** 남은 자리 비율 0..1 */
  free(): number { return 1 - this.n / this.cap; }

  /**
   * 파티클 하나. 돌려준 번호로 배열을 직접 고쳐 세부 값을 바꾼다.
   * 기본값: 무작위 회전, 감쇠·중력·바람 0, 나타나기 0.08, 사라지기 0.5, 모드 0, 바닥 없음.
   */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number,
    s0: number, s1: number, frame: number, c0: Col, c1: Col, alpha: number): number {
    const i = this.n < this.cap ? this.n++ : this.cap;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life > 0.01 ? life : 0.01;
    this.s0[i] = s0; this.s1[i] = s1;
    this.rot[i] = Math.random() * 6.2832; this.rv[i] = 0;
    this.r0[i] = c0.r; this.g0[i] = c0.g; this.b0[i] = c0.b;
    this.r1[i] = c1.r; this.g1[i] = c1.g; this.b1[i] = c1.b;
    this.al[i] = alpha; this.fin[i] = 0.08; this.fout[i] = 0.5;
    this.drag[i] = 0; this.grav[i] = 0; this.wnd[i] = 0;
    this.fr[i] = frame; this.nf[i] = 1;
    this.mode[i] = 0; this.ln[i] = 0; this.st[i] = 0;
    this.gy[i] = -1e9; this.bnc[i] = 0;
    return i;
  }

  /** 색 밝기 곱 */
  tint(i: number, k: number): void {
    this.r0[i] *= k; this.g0[i] *= k; this.b0[i] *= k;
    this.r1[i] *= k; this.g1[i] *= k; this.b1[i] *= k;
  }

  /** 늘인 줄로 만들기 */
  streak(i: number, baseLen: number, perSpeed: number): void {
    this.mode[i] = 1; this.ln[i] = baseLen; this.st[i] = perSpeed;
  }

  /** 수명 일부를 미리 지난 것으로 */
  preAge(i: number, t: number): void { this.age[i] = Math.min(t, this.life[i] * 0.9); }

  /** 이번 프레임 시작 (외부 인스턴스 비움) */
  begin(): void { this.ext = 0; }

  /** 시뮬레이션 없이 이번 프레임에만 그릴 인스턴스 (연막 구름, 배기 불빛 등). 모드 1 이면 d = 방향×길이 */
  pushExt(x: number, y: number, z: number, size: number, rot: number, frame: number,
    r: number, g: number, b: number, a: number, mode = 0, dx = 0, dy = 0, dz = 0): void {
    if (this.ext >= this.extCap || a <= 0.002) return;
    const j = this.ext++;
    const P = this.aPos.array as Float32Array, D = this.aDir.array as Float32Array;
    const C = this.aCol.array as Float32Array, R = this.aPrm.array as Float32Array;
    P[j * 3] = x; P[j * 3 + 1] = y; P[j * 3 + 2] = z;
    D[j * 3] = dx; D[j * 3 + 1] = dy; D[j * 3 + 2] = dz;
    C[j * 4] = r; C[j * 4 + 1] = g; C[j * 4 + 2] = b; C[j * 4 + 3] = a;
    R[j * 4] = size; R[j * 4 + 1] = rot; R[j * 4 + 2] = frame; R[j * 4 + 3] = mode;
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i !== last) for (const a of this.all) a[i] = a[last];
  }

  /** 시뮬레이션 + 인스턴스 버퍼 쓰기 */
  update(dt: number, lightK: number): void {
    const { px, py, pz, vx, vy, vz, age, life, drag, grav, wnd, rot, rv, gy, bnc } = this;
    const wx = this.windX * dt, wz = this.windZ * dt;
    let i = 0;
    while (i < this.n) {
      const a = age[i] + dt;
      if (a >= life[i]) { this.kill(i); continue; }
      age[i] = a;
      const d = drag[i] > 0 ? Math.exp(-drag[i] * dt) : 1;
      vx[i] *= d; vz[i] *= d; vy[i] = vy[i] * d - grav[i] * dt;
      px[i] += vx[i] * dt + wx * wnd[i];
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt + wz * wnd[i];
      if (py[i] < gy[i]) {
        py[i] = gy[i];
        if (bnc[i] > 0 && vy[i] < -1.2) {
          vy[i] = -vy[i] * bnc[i]; vx[i] *= 0.65; vz[i] *= 0.65;
        } else {
          vy[i] = 0; vx[i] *= 0.3; vz[i] *= 0.3; rv[i] = 0;
        }
      }
      rot[i] += rv[i] * dt;
      i++;
    }

    const P = this.aPos.array as Float32Array, D = this.aDir.array as Float32Array;
    const C = this.aCol.array as Float32Array, R = this.aPrm.array as Float32Array;
    const { s0, s1, r0, g0, b0, r1, g1, b1, al, fin, fout, fr, nf, mode, ln, st } = this;
    const base = this.ext;
    const count = this.n;
    for (let k = 0; k < count; k++) {
      const j = base + k;
      const t = age[k] / life[k];
      const e = 1 - (1 - t) * (1 - t);
      let a = al[k];
      if (t < fin[k]) a *= t / fin[k];
      if (t > fout[k]) { const q = (1 - t) / (1 - fout[k]); a *= q * q * (3 - 2 * q); }
      const m = mode[k];
      P[j * 3] = px[k]; P[j * 3 + 1] = py[k]; P[j * 3 + 2] = pz[k];
      if (m === 1) {
        const sp = Math.hypot(vx[k], vy[k], vz[k]);
        const L = ln[k] + sp * st[k];
        if (sp > 1e-4) { const s = L / sp; D[j * 3] = vx[k] * s; D[j * 3 + 1] = vy[k] * s; D[j * 3 + 2] = vz[k] * s; }
        else { D[j * 3] = 0; D[j * 3 + 1] = L; D[j * 3 + 2] = 0; }
      }
      C[j * 4] = (r0[k] + (r1[k] - r0[k]) * t) * lightK;
      C[j * 4 + 1] = (g0[k] + (g1[k] - g0[k]) * t) * lightK;
      C[j * 4 + 2] = (b0[k] + (b1[k] - b0[k]) * t) * lightK;
      C[j * 4 + 3] = a;
      R[j * 4] = s0[k] + (s1[k] - s0[k]) * e;
      R[j * 4 + 1] = rot[k];
      R[j * 4 + 2] = fr[k] + (nf[k] > 1 ? Math.min(nf[k] - 1, Math.floor(t * nf[k])) : 0);
      R[j * 4 + 3] = m;
    }

    const total = base + count;
    this.geo.instanceCount = total;
    this.mesh.visible = total > 0;
    if (total > 0) {
      for (const at of [this.aPos, this.aDir, this.aCol, this.aPrm]) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, total * at.itemSize);
        at.needsUpdate = true;
      }
    }
  }

  setPx(px: number): void { this.mat.uniforms.uPx.value = px; }
  setLight(c: THREE.Color): void { (this.mat.uniforms.uLight.value as THREE.Color).copy(c); }

  clear(): void { this.n = 0; this.ext = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
