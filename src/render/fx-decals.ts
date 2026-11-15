// render-fx: 데칼 고리 버퍼 (탄흔, 유리 금, 그을음, 눈 자국). 곱하기 혼합이라 조명과 상관없이 표면을 어둡게 한다.
// 인스턴스: 위치·크기, 법선·회전, 칸·생성 시각·수명·알파, 색. 새 데칼은 가장 오래된 자리를 덮어쓴다.
import * as THREE from 'three';
import type { Vec3 } from '../types';
import { GRID } from './fx-textures';
import type { Col } from './fx-particles';

const VERT = /* glsl */ `
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
attribute vec3 iD;
uniform float uTime;
uniform float uGrid;
varying vec2 vUv;
varying vec4 vCol;
#include <fog_pars_vertex>
void main() {
  vec3 n = normalize(iB.xyz);
  vec3 up = abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, n));
  vec3 b = cross(n, t);
  float cs = cos(iB.w), sn = sin(iB.w);
  vec2 c = position.xy;
  vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * iA.w;
  vec3 wp = iA.xyz + n * (0.012 + iA.w * 0.01) + t * rc.x + b * rc.y;
  float age = uTime - iC.y;
  float a = iC.w * (1.0 - smoothstep(iC.z * 0.75, iC.z, age)) * smoothstep(-0.02, 0.06, age);
  float f = floor(iC.x + 0.5);
  float fy = floor(f / uGrid + 0.001);
  float fx = f - fy * uGrid;
  vUv = (vec2(fx, fy) + 0.5 + c * 0.97) / uGrid;
  vCol = vec4(iD, a);
  vec4 mvPosition = modelViewMatrix * vec4(wp, 1.0);
  gl_Position = a > 0.002 ? projectionMatrix * mvPosition : vec4(2.0, 2.0, 2.0, 1.0);
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vCol;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vCol.a;
  if (a < 0.004) discard;
  vec3 m = mix(vec3(1.0), t.rgb * vCol.rgb, a);
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  m = mix(m, vec3(1.0), fogF);
#endif
  gl_FragColor = vec4(m, 1.0);
}
`;

export class Decals {
  readonly cap: number;
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aA: THREE.InstancedBufferAttribute;
  private readonly aB: THREE.InstancedBufferAttribute;
  private readonly aC: THREE.InstancedBufferAttribute;
  private readonly aD: THREE.InstancedBufferAttribute;
  private next = 0;
  private count = 0;
  private lo = Infinity;
  private hi = -1;

  constructor(atlas: THREE.Texture, cap: number) {
    this.cap = cap;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (k: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aA = mk(4); this.aB = mk(4); this.aC = mk(4); this.aD = mk(3);
    geo.setAttribute('iA', this.aA);
    geo.setAttribute('iB', this.aB);
    geo.setAttribute('iC', this.aC);
    geo.setAttribute('iD', this.aD);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: atlas },
        uGrid: { value: GRID },
        uTime: { value: 0 },
        fogColor: { value: new THREE.Color(0xffffff) },
        fogNear: { value: 1 },
        fogFar: { value: 2000 },
        fogDensity: { value: 0.00025 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      blending: THREE.CustomBlending,
    });
    this.mat.blendEquation = THREE.AddEquation;
    this.mat.blendSrc = THREE.DstColorFactor;
    this.mat.blendDst = THREE.ZeroFactor;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  add(p: Vec3, n: Vec3, size: number, frame: number, tint: Col, alpha: number, life: number, time: number, rot = Math.random() * 6.2832): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    const A = this.aA.array as Float32Array, B = this.aB.array as Float32Array;
    const C = this.aC.array as Float32Array, D = this.aD.array as Float32Array;
    const nl = Math.hypot(n.x, n.y, n.z) || 1;
    A[i * 4] = p.x; A[i * 4 + 1] = p.y; A[i * 4 + 2] = p.z; A[i * 4 + 3] = size;
    B[i * 4] = n.x / nl; B[i * 4 + 1] = n.y / nl; B[i * 4 + 2] = n.z / nl; B[i * 4 + 3] = rot;
    C[i * 4] = frame; C[i * 4 + 1] = time; C[i * 4 + 2] = life; C[i * 4 + 3] = alpha;
    D[i * 3] = tint.r; D[i * 3 + 1] = tint.g; D[i * 3 + 2] = tint.b;
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
  }

  /** 상자 안(여유 m)에 있는 데칼 지우기 (부서진 벽·무너진 건물) */
  clearBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, pad = 0.25): void {
    const A = this.aA.array as Float32Array, C = this.aC.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const x = A[i * 4], y = A[i * 4 + 1], z = A[i * 4 + 2];
      if (x >= minX - pad && x <= maxX + pad && y >= minY - pad && y <= maxY + pad && z >= minZ - pad && z <= maxZ + pad && C[i * 4 + 3] > 0) {
        C[i * 4 + 3] = 0;
        if (i < this.lo) this.lo = i;
        if (i > this.hi) this.hi = i;
      }
    }
  }

  update(time: number): void {
    this.mat.uniforms.uTime.value = time;
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (this.hi >= this.lo) {
      for (const at of [this.aA, this.aB, this.aC, this.aD]) {
        at.clearUpdateRanges();
        at.addUpdateRange(this.lo * at.itemSize, (this.hi - this.lo + 1) * at.itemSize);
        at.needsUpdate = true;
      }
      this.lo = Infinity; this.hi = -1;
    }
  }

  clear(): void { this.count = 0; this.next = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
