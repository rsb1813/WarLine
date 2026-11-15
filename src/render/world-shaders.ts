// 세계 재질용 셰이더 주입 (MeshStandardMaterial.onBeforeCompile).
// 빛·그림자·안개는 three 기본 경로를 그대로 쓰고, 알베도·거칠기·범프만 바꾼다.
import * as THREE from 'three';
import { packTex, terrainDetailTex, type PackId } from './textures';

type U<T> = { value: T };

/** 모든 세계 재질이 함께 쓰는 유니폼 (한 번 바꾸면 전부 반영) */
export interface SharedUniforms {
  uTime: U<number>;
  /** 테마 눈 양 0..1 */
  uSnowAmt: U<number>;
  /** 눈 색 (선형) */
  uSnowCol: U<THREE.Color>;
  /** 눈 반짝임 세기 (해 세기에 비례) */
  uSparkle: U<number>;
}

export function makeShared(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uSnowAmt: { value: 1 },
    uSnowCol: { value: new THREE.Color(0xeef3f8) },
    uSparkle: { value: 1 },
  };
}

const PERTURB = /* glsl */`
vec3 wlPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd) {
  vec3 sx = normalize(dFdx(surf_pos)); vec3 sy = normalize(dFdy(surf_pos));
  vec3 r1 = cross(sy, surf_norm); vec3 r2 = cross(surf_norm, sx);
  float det = dot(sx, r1) * fd;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surf_norm - grad);
}
`;

const WORLD_VARY_VERT = /* glsl */`
{
  vec4 wlW = vec4(transformed, 1.0);
  vec3 wlN = objectNormal;
  #ifdef USE_INSTANCING
    wlW = instanceMatrix * wlW;
    mat3 wlIm = mat3(instanceMatrix);
    wlN = wlIm * (wlN / max(vec3(dot(wlIm[0], wlIm[0]), dot(wlIm[1], wlIm[1]), dot(wlIm[2], wlIm[2])), vec3(1e-8)));
  #endif
  wlW = modelMatrix * wlW;
  vWPos = wlW.xyz;
  vWN = normalize(mat3(modelMatrix) * wlN + vec3(0.0, 1e-5, 0.0));
}
`;

// ───────────────────────── 상자 (건물·소품) 재질 ─────────────────────────

export interface BoxMatOpts {
  side: PackId; top: PackId;
  /** 타일 크기 m (가로, 세로). uvMode 1 이면 면당 반복 수 */
  sideTile: [number, number]; topTile: [number, number];
  /** 0 = 월드 좌표, 1 = 물체(면마다 0..1), 2 = 가로 월드 + 세로 물체 높이 */
  uvMode: 0 | 1 | 2;
  /** G 채널 둘째 색 (sRGB hex), 때 색, 때 양 */
  second: number; grime: number; grimeAmt: number;
  rough: number; metal: number;
  /** 둘째 색 자리의 금속성 감소 0..1 (녹은 금속이 아님) */
  secondNonMetal?: number;
  bump: number;
  /** 윗면 눈 배율, 벽 밑 눈 쌓임 배율 */
  snow: number; drift: number;
  alphaCut?: boolean;
  /** 밑동 때(지면 가까이 어두워짐) 세기 */
  baseDirt?: number;
  side2?: boolean;
}

export function makeBoxMaterial(o: BoxMatOpts, sh: SharedUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: o.rough, metalness: o.metal,
    side: o.side2 ? THREE.DoubleSide : THREE.FrontSide,
  });
  const uni = {
    uSideTex: { value: packTex(o.side) },
    uTopTex: { value: packTex(o.top) },
    uSideScale: { value: new THREE.Vector2(1 / o.sideTile[0], 1 / o.sideTile[1]) },
    uTopScale: { value: new THREE.Vector2(1 / o.topTile[0], 1 / o.topTile[1]) },
    uSecond: { value: new THREE.Color(o.second) },
    uGrimeCol: { value: new THREE.Color(o.grime) },
    uGrime: { value: o.grimeAmt },
    uSecondMetal: { value: o.secondNonMetal ?? 1 },
    uBump: { value: o.bump },
    uSnow: { value: o.snow },
    uDrift: { value: o.drift },
    uBaseDirt: { value: o.baseDirt ?? 0.35 },
  };
  m.defines = { WL_UV: o.uvMode, ...(o.alphaCut ? { WL_ALPHACUT: 1 } : { WL_BUMP: 1 }) };
  m.customProgramCacheKey = () => 'wl-box';
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uni, { uSnowAmt: sh.uSnowAmt, uSnowCol: sh.uSnowCol, uTime: sh.uTime });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aBase;
varying vec3 vWPos; varying vec3 vWN; varying vec3 vOP; varying float vBase;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
${WORLD_VARY_VERT}
vOP = position; vBase = aBase;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uSideTex; uniform sampler2D uTopTex;
uniform vec2 uSideScale; uniform vec2 uTopScale;
uniform vec3 uSecond; uniform vec3 uGrimeCol; uniform vec3 uSnowCol;
uniform float uGrime; uniform float uSecondMetal; uniform float uBump; uniform float uSnow; uniform float uDrift; uniform float uSnowAmt; uniform float uBaseDirt;
varying vec3 vWPos; varying vec3 vWN; varying vec3 vOP; varying float vBase;
float wlH = 0.5; float wlSnow = 0.0; float wlR = 0.5; float wlG = 0.0;
${PERTURB}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 wn = normalize(vWN);
  vec3 an = abs(wn);
  float isTop = step(an.x, an.y) * step(an.z, an.y);
  bool xFace = an.x > an.z;
  vec2 uvS; vec2 uvT;
  #if WL_UV == 1
    vec3 op = vOP + 0.5;
    uvS = (xFace ? op.zy : op.xy) * uSideScale;
    uvT = op.xz * uTopScale;
  #elif WL_UV == 2
    uvS = vec2((xFace ? vWPos.z : vWPos.x) * uSideScale.x, vOP.y + 0.5);
    uvT = vWPos.xz * uTopScale;
  #else
    uvS = (xFace ? vWPos.zy : vWPos.xy) * uSideScale;
    uvT = vWPos.xz * uTopScale;
  #endif
  vec4 tS = texture2D(uSideTex, uvS);
  vec4 tT = texture2D(uTopTex, uvT);
  vec4 tx = mix(tS, tT, isTop);
  #ifdef WL_ALPHACUT
    if (tx.a < 0.5) discard;
  #endif
  vec3 base = diffuseColor.rgb;
  vec3 alb = base * (0.3 + 1.4 * tx.r);
  alb = mix(alb, uSecond * (0.55 + 0.9 * tx.r), tx.g);
  float hgt = vWPos.y - vBase;
  float low = (1.0 - smoothstep(0.0, 1.1 + tx.r * 0.5, hgt)) * (1.0 - isTop);
  float grime = clamp(tx.b * uGrime + low * uBaseDirt, 0.0, 1.0);
  alb = mix(alb, uGrimeCol, grime * 0.75);
  float topSnow = smoothstep(0.55, 0.9, wn.y) * smoothstep(0.25, 0.6, tx.r + tx.a * 0.3);
  float drift = (1.0 - isTop) * (1.0 - smoothstep(0.0, 0.04 + 0.24 * tx.r * tx.r, hgt)) * uDrift;
  wlSnow = clamp((topSnow * uSnow + drift) * uSnowAmt, 0.0, 1.0);
  alb = mix(alb, uSnowCol * (0.92 + 0.08 * tx.r), wlSnow);
  diffuseColor.rgb = alb;
  #ifdef WL_ALPHACUT
    wlH = 0.5;
  #else
    wlH = tx.a * (1.0 - wlSnow * 0.8);
  #endif
  wlR = tx.r; wlG = tx.g;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(mix(roughnessFactor * (0.8 + 0.4 * wlR) + wlG * 0.15, 0.78, wlSnow), 0.04, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor *= (1.0 - wlSnow) * (1.0 - wlG * uSecondMetal);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef WL_BUMP
  normal = wlPerturb(-vViewPosition, normal, vec2(dFdx(wlH), dFdy(wlH)) * uBump * (1.0 - smoothstep(25.0, 110.0, length(vViewPosition))), faceDirection);
#endif`);
  };
  return m;
}

// ───────────────────────── 지형 재질 ─────────────────────────

/** 정점 색 + aGround(눈, 풀, 단단한 면, 흙·자갈 가중치)로 세부 결을 섞는 지형 재질 */
export function makeTerrainMaterial(sh: SharedUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const uni = { uDetail: { value: terrainDetailTex() }, uBump: { value: 1.6 } };
  m.customProgramCacheKey = () => 'wl-terrain';
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uni, { uSparkle: sh.uSparkle, uSnowAmt: sh.uSnowAmt });
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aGround;
varying vec4 vGround; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGround = aGround;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uDetail; uniform float uBump; uniform float uSparkle; uniform float uSnowAmt;
varying vec4 vGround; varying vec3 vWPos;
float wlH = 0.5; float wlSnow = 0.0;
${PERTURB}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec2 wlP = vWPos.xz;
vec4 wd1 = texture2D(uDetail, wlP * 0.21);
vec4 wd2 = texture2D(uDetail, wlP * 0.031 + vec2(0.37, 0.71));
vec4 wd3 = texture2D(uDetail, wlP * 0.93 + vec2(0.13, 0.52));
float wlDist = length(vViewPosition);
float wlNear = 1.0 - smoothstep(14.0, 65.0, wlDist);
vec4 wlGw = vGround / max(vGround.x + vGround.y + vGround.z + vGround.w, 1e-3);
float wlMacro = wd2.g;
{
  float mSnow = 0.93 + 0.07 * wd1.r + 0.05 * (wd3.r - 0.5) * wlNear + (wlMacro - 0.5) * 0.08;
  vec3 mVeg = mix(vec3(0.6, 0.58, 0.52), vec3(1.25, 1.12, 0.95), wd1.r) * (0.72 + 0.56 * mix(0.5, wd3.g, wlNear)) * (0.8 + 0.4 * wlMacro);
  float crack = 1.0 - smoothstep(0.0, 0.07, wd2.b);
  float mHard = (0.86 + 0.24 * wd1.r + 0.14 * (wd3.r - 0.5) * wlNear) * (1.0 - 0.32 * crack) * (0.9 + 0.2 * wlMacro);
  float mRough = (0.78 + 0.38 * mix(0.5, wd3.b, wlNear)) * (0.85 + 0.3 * wd1.r) * (0.85 + 0.3 * wlMacro);
  diffuseColor.rgb *= wlGw.x * mSnow + wlGw.y * mVeg + wlGw.z * mHard + wlGw.w * mRough;
  float speck = wlGw.y * smoothstep(0.5 + wlMacro * 0.25, 0.64 + wlMacro * 0.25, wd1.r * 0.55 + mix(0.5, wd3.g, wlNear) * 0.45) * 0.75;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.88, 0.93), speck);
  // 포장면·흙 위에 바람에 날린 눈 얼룩
  float dust = (wlGw.z + wlGw.w) * uSnowAmt * smoothstep(0.42, 0.72, wlMacro * 0.55 + wd1.r * 0.3 + wd3.r * 0.15 * wlNear) * 0.7;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.84, 0.89), dust);
  wlH = wlGw.x * wd1.r * 0.3 + wlGw.y * (wd1.r * 0.5 + wd3.g * 0.5 * wlNear) + wlGw.z * (wd1.r * 0.2 - crack * 0.5) + wlGw.w * (wd3.b * 0.8 * wlNear + wd1.r * 0.3);
  wlSnow = clamp(wlGw.x + dust * 0.6, 0.0, 1.0);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = wlGw.x * (0.6 + 0.15 * wd1.r) + wlGw.y * 0.95 + wlGw.z * 0.84 + wlGw.w * 0.9;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = wlPerturb(-vViewPosition, normal, vec2(dFdx(wlH), dFdy(wlH)) * uBump * (1.0 - smoothstep(18.0, 75.0, wlDist)), faceDirection);
{
  // 바람에 깎인 눈결 (해석적 기울기: 미분 블록 무늬 없음)
  float ph = dot(wlP, vec2(0.83, 0.56)) * 5.0 + wd1.g * 9.0 + wd2.r * 5.0;
  float amp = wlGw.x * (1.0 - smoothstep(12.0, 50.0, wlDist)) * 0.09;
  vec3 gW = vec3(0.83, 0.0, 0.56) * cos(ph) * amp;
  normal = normalize(normal - (viewMatrix * vec4(gW, 0.0)).xyz);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 vd = normalize(vViewPosition);
  vec2 sc = floor(vWPos.xz * 24.0) + floor(vd.xz * 9.0 + vd.y * 5.0);
  float hs = fract(sin(dot(sc, vec2(12.9898, 78.233))) * 43758.5453);
  float sp = step(0.993, hs) * smoothstep(0.6, 0.9, wlSnow) * (1.0 - smoothstep(5.0, 26.0, wlDist));
  totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * sp * uSparkle;
}`);
  };
  return m;
}

// ───────────────────────── 나무 흔들림 ─────────────────────────

/** 인스턴스 나무 정점을 바람에 살짝 흔든다 (그림자는 흔들지 않음: 차이는 몇 cm) */
export function addSway(m: THREE.Material, sh: SharedUniforms, amount: number, key: string): void {
  const uSway = { value: amount };
  m.customProgramCacheKey = () => 'wl-sway-' + key;
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = sh.uTime;
    s.uniforms.uSway = uSway;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uSway;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float ph = ip.x * 0.11 + ip.z * 0.07;
  float sw = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.3;
  float k = position.y * position.y * uSway;
  transformed.x += sw * k;
  transformed.z += sw * k * 0.6;
}
#endif`);
  };
}

// ───────────────────────── 깃발 천 ─────────────────────────

/** 깃발 천: 깃대 쪽(x=0)은 고정, 끝으로 갈수록 물결 */
export function makeClothMaterial(map: THREE.Texture, sh: SharedUniforms, len: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const uLen = { value: len };
  m.customProgramCacheKey = () => 'wl-cloth';
  const wave = `
  float wk = clamp(position.x / uLen, 0.0, 1.0);
  float wph = position.x * 2.3 - uTime * 5.2 + (instanceMatrix[3][0] + instanceMatrix[3][2]) * 0.37 + position.y * 0.6;
  float wamp = 0.24 * wk;`;
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = sh.uTime;
    s.uniforms.uLen = uLen;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uLen;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
#ifdef USE_INSTANCING
{
  ${wave}
  float dz = cos(wph) * 2.3 * wamp + sin(wph) * 0.24 / uLen;
  objectNormal = normalize(vec3(-dz, 0.0, 1.0));
}
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  ${wave}
  transformed.z += sin(wph) * wamp;
  transformed.y -= wk * wk * 0.12;
  transformed.x -= wk * abs(sin(wph)) * 0.06;
}
#endif`);
  };
  return m;
}

// ───────────────────────── 창 유리 ─────────────────────────

/** 반투명 유리: 가장자리(비스듬히 볼 때) 더 불투명, aGlow 인스턴스는 안에서 불빛 */
export function makeGlassMaterial(env: THREE.Texture | null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.36,
    envMap: env, envMapIntensity: 1.5, depthWrite: false,
  });
  m.customProgramCacheKey = () => 'wl-glass';
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float fres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0);
  diffuseColor.a = mix(diffuseColor.a, 0.92, max(fres * 0.8, min(vGlow, 1.0) * 0.6));
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.6, 0.28) * vGlow * 1.4;`);
  };
  return m;
}

// ───────────────────────── 물 ─────────────────────────

export interface WaterUniforms { uFlow1: U<THREE.Vector2>; uFlow2: U<THREE.Vector2> }

/** 차갑고 어두운 물: 두 겹으로 흐르는 물결 법선 */
export function makeWaterMaterial(normal: THREE.Texture, env: THREE.Texture | null, color: number): { mat: THREE.MeshStandardMaterial; uni: WaterUniforms } {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: 0.07, metalness: 0.0, transparent: true, opacity: 0.86,
    envMap: env, envMapIntensity: 1.0, normalMap: normal, normalScale: new THREE.Vector2(0.32, 0.32),
    depthWrite: false,
  });
  const uni: WaterUniforms = { uFlow1: { value: new THREE.Vector2() }, uFlow2: { value: new THREE.Vector2() } };
  m.customProgramCacheKey = () => 'wl-water';
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uni);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uFlow1; uniform vec2 uFlow2;')
      .replace('#include <normal_fragment_maps>', `
{
  vec3 mapN = normalize((texture2D(normalMap, vNormalMapUv + uFlow1).xyz * 2.0 - 1.0) + (texture2D(normalMap, vNormalMapUv * 2.7 + uFlow2).xyz * 2.0 - 1.0) * 0.6);
  mapN.xy *= normalScale;
  normal = normalize(tbn * mapN);
}
{
  float fres = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 4.0);
  diffuseColor.a = mix(diffuseColor.a, 1.0, fres);
}`);
  };
  return { mat: m, uni };
}
