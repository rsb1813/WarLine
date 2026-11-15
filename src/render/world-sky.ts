// 하늘 돔(그라데이션 + 해 + 구름), 시간대별 색·조명 값, 먼 산 고리, 환경 맵(PMREM).
// 하늘과 먼 산은 톤 매핑 없이 화면 색(sRGB) 그대로 내보낸다: three 의 안개도 화면 색으로 섞이므로 지평선이 정확히 이어진다.
import * as THREE from 'three';
import type { MapDef } from '../types';
import { fbm } from '../math';
import { cloudTex } from './textures';

export interface Palette {
  zenith: number; horizon: number; below: number;
  sunColor: number; sunIntensity: number; sunElev: number; sunAzim: number;
  hemiSky: number; hemiGround: number; hemiIntensity: number; hemiLow: number;
  ambient: number; ambientIntensity: number;
  envIntensity: number; envBelow: number;
  fogDensity: number; exposure: number;
  cloudCover: number; cloudAlpha: number; cloudLit: number; cloudDark: number;
  glow: number; horizGlow: number; sunDisk: number;
  sparkle: number;
  mountainRock: number; mountainSnow: number;
  water: number;
  snow: number;
}

export function paletteFor(time: MapDef['time'], seed: number): Palette {
  const az = 145 + (Math.abs(seed) % 70);
  if (time === 'dusk') return {
    zenith: 0x34426a, horizon: 0xdba48c, below: 0x9c8486,
    sunColor: 0xffa060, sunIntensity: 3.8, sunElev: 5.5, sunAzim: az + 60,
    hemiSky: 0x8890bc, hemiGround: 0x6e5a5a, hemiIntensity: 0.4, hemiLow: 1.15,
    ambient: 0xb8b0d0, ambientIntensity: 0.12,
    envIntensity: 0.9, envBelow: 0x9a8c94,
    fogDensity: 0.0029, exposure: 1.1,
    cloudCover: 0.47, cloudAlpha: 0.9, cloudLit: 0xf4b296, cloudDark: 0x5c5c80,
    glow: 1.35, horizGlow: 0.6, sunDisk: 1,
    sparkle: 1.1,
    mountainRock: 0x464660, mountainSnow: 0xe0b8b4,
    water: 0x141c2a, snow: 0xeef0f6,
  };
  if (time === 'overcast') return {
    zenith: 0x8c949f, horizon: 0xc3c8cd, below: 0xadb2b8,
    sunColor: 0xeef0f4, sunIntensity: 1.25, sunElev: 34, sunAzim: az,
    hemiSky: 0xc6ccd5, hemiGround: 0x9aa0a6, hemiIntensity: 0.65, hemiLow: 2.1,
    ambient: 0xffffff, ambientIntensity: 0.12,
    envIntensity: 1.15, envBelow: 0xc8ccd0,
    fogDensity: 0.0039, exposure: 1.05,
    cloudCover: 0.12, cloudAlpha: 0.95, cloudLit: 0xc9cdd3, cloudDark: 0x858c96,
    glow: 0.2, horizGlow: 0.0, sunDisk: 0,
    sparkle: 0.25,
    mountainRock: 0x646d78, mountainSnow: 0xd4dae1,
    water: 0x1a252c, snow: 0xe9edf1,
  };
  return {
    zenith: 0x6a8cb6, horizon: 0xcbd6df, below: 0xb5c0ca,
    sunColor: 0xfff0da, sunIntensity: 4.3, sunElev: 21, sunAzim: az,
    hemiSky: 0xc2d3e8, hemiGround: 0x98a0a8, hemiIntensity: 0.42, hemiLow: 1.5,
    ambient: 0xffffff, ambientIntensity: 0.1,
    envIntensity: 0.85, envBelow: 0xd2d8de,
    fogDensity: 0.0025, exposure: 1.0,
    cloudCover: 0.53, cloudAlpha: 0.85, cloudLit: 0xf6f8fa, cloudDark: 0xa4afbd,
    glow: 1.0, horizGlow: 0.14, sunDisk: 1,
    sparkle: 1.6,
    mountainRock: 0x525d6c, mountainSnow: 0xe6edf4,
    water: 0x13212a, snow: 0xedf2f7,
  };
}

/** 해 쪽을 가리키는 단위 벡터 */
export function sunDirection(p: Palette, out = new THREE.Vector3()): THREE.Vector3 {
  const el = p.sunElev * Math.PI / 180, az = p.sunAzim * Math.PI / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

/** sRGB hex → 화면 색 그대로의 vec3 */
function srgbVec(hex: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uBelow; uniform vec3 uSunCol; uniform vec3 uSunDir;
uniform vec3 uCloudLit; uniform vec3 uCloudDark;
uniform float uGlow; uniform float uHorizGlow; uniform float uCover; uniform float uCloudAlpha; uniform float uTime;
uniform float uLinear; uniform float uDisk;
uniform sampler2D uClouds;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float hp = max(h, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(hp, 0.55));
  col = mix(col, uHorizon, exp(-hp * 22.0) * 0.45);
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 6.0) * 0.16 + pow(sd, 48.0) * 0.32) * uGlow;
  col += uSunCol * pow(sd, 2.5) * exp(-hp * 9.0) * uHorizGlow;
  float cov = 0.0;
  if (h > 0.0) {
    vec2 cuv = d.xz / (h * 0.9 + 0.07) * 0.16;
    float c1 = texture2D(uClouds, cuv + uTime * vec2(0.0015, 0.0006)).r;
    float c2 = texture2D(uClouds, cuv * 2.6 + uTime * vec2(0.0028, -0.0009)).g;
    float c = c1 * 0.72 + c2 * 0.28;
    float fade = smoothstep(0.0, 0.2, h);
    cov = smoothstep(uCover, uCover + 0.28, c) * fade * uCloudAlpha;
    float lit = clamp(smoothstep(0.35, 0.85, c2) * 0.55 + pow(sd, 3.0) * 0.45, 0.0, 1.0);
    vec3 cc = mix(uCloudDark, uCloudLit, lit);
    cc = mix(cc, uHorizon, (1.0 - fade) * 0.6 + exp(-hp * 6.0) * 0.3);
    col = mix(col, cc, cov);
    col += uSunCol * pow(sd, 14.0) * cov * 0.3 * uGlow;
  }
  float disk = smoothstep(0.99955, 0.99975, sd) * uDisk;
  col = mix(col, uSunCol * 1.6 + 0.2, disk * (1.0 - cov * 0.85));
  col = mix(col, uBelow, smoothstep(0.0, -0.06, h));
  float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dn - 0.5) / 255.0;
  col = clamp(col, 0.0, 1.0);
  if (uLinear > 0.5) col = pow(col, vec3(2.2));
  gl_FragColor = vec4(col, 1.0);
}`;

function skyUniforms(p: Palette, env: boolean) {
  return {
    uZenith: { value: srgbVec(p.zenith) },
    uHorizon: { value: srgbVec(p.horizon) },
    uBelow: { value: srgbVec(env ? p.envBelow : p.below) },
    uSunCol: { value: srgbVec(p.sunColor) },
    uSunDir: { value: sunDirection(p) },
    uCloudLit: { value: srgbVec(p.cloudLit) },
    uCloudDark: { value: srgbVec(p.cloudDark) },
    uGlow: { value: p.glow },
    uHorizGlow: { value: p.horizGlow },
    uCover: { value: p.cloudCover },
    uCloudAlpha: { value: p.cloudAlpha },
    uTime: { value: 0 },
    uLinear: { value: env ? 1 : 0 },
    uDisk: { value: env ? 0 : p.sunDisk },
    uClouds: { value: cloudTex() },
  };
}

function skyMaterial(p: Palette, env: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: skyUniforms(p, env),
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: !env ? true : false, fog: false, toneMapped: false,
  });
}

export class Sky {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private mountains: THREE.Mesh | null = null;
  private center = new THREE.Vector3();
  private time = 0;

  constructor(p: Palette) {
    this.domeMat = skyMaterial(p, false);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), this.domeMat);
    this.dome.renderOrder = -100;
    this.dome.frustumCulled = false;
    this.dome.name = 'sky';
    this.group.add(this.dome);
  }

  setPalette(p: Palette): void {
    const u = skyUniforms(p, false);
    for (const k of Object.keys(u) as (keyof typeof u)[]) {
      if (k === 'uTime' || k === 'uClouds') continue;
      (this.domeMat.uniforms[k] as { value: unknown }).value = u[k].value;
    }
  }

  /** 환경 맵(반사·간접광)을 하늘로 굽는다 */
  makeEnv(renderer: THREE.WebGLRenderer, p: Palette): THREE.WebGLRenderTarget {
    const scene = new THREE.Scene();
    const mat = skyMaterial(p, true);
    const geo = new THREE.SphereGeometry(900, 32, 16);
    scene.add(new THREE.Mesh(geo, mat));
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(scene, 0.03, 0.1, 2000);
    pm.dispose(); geo.dispose(); mat.dispose();
    return rt;
  }

  /** 먼 산 두 겹 (안개 대신 미리 섞은 대기색) */
  buildMountains(p: Palette, center: THREE.Vector3, baseY: number, seed: number, lowDir: number[] | null): void {
    this.disposeMountains();
    this.center.copy(center);
    const layers = [
      { r: 1040, hMin: 25, hMax: 130, hazeTop: 0.42, rough: 1.0 },
      { r: 1260, hMin: 70, hMax: 260, hazeTop: 0.6, rough: 0.8 },
    ];
    const N = 220;
    const rows = [0, 0.4, 0.75, 1];
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const hz = new THREE.Color().setHex(p.horizon);
    const rock = new THREE.Color().setHex(p.mountainRock), snow = new THREE.Color().setHex(p.mountainSnow);
    // 모두 sRGB 에서 섞는다
    const toS = (c: THREE.Color) => [c.r, c.g, c.b].map((x) => THREE.ColorManagement.fromWorkingColorSpace(new THREE.Color(x, x, x), THREE.SRGBColorSpace).r);
    const hzS = toS(hz), rockS = toS(rock), snowS = toS(snow);
    const tmp = new THREE.Color();
    for (let L = 0; L < layers.length; L++) {
      const ly = layers[L];
      const nA = fbm(seed * 13 + L * 101, 5), nB = fbm(seed * 7 + L * 53, 3);
      const base0 = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const cx = Math.cos(a), sz = Math.sin(a);
        const k = 3.2 * ly.rough;
        let ridge = 1 - Math.abs(nA(cx * k + 10, sz * k + 10) * 2 - 1);
        ridge = ridge * ridge;
        const broad = nB(cx * 1.3 + 5, sz * 1.3 + 5);
        let hgt = ly.hMin + (ly.hMax - ly.hMin) * (0.35 * broad + 0.65 * ridge);
        if (lowDir) {
          const li = Math.floor((i / N) * lowDir.length) % lowDir.length;
          hgt *= 1 - 0.55 * lowDir[li];
        }
        const snowy = 0.55 + 0.45 * nB(cx * 6 + 2, sz * 6 + 2);
        for (let r = 0; r < rows.length; r++) {
          const t = rows[r];
          const jitter = r === rows.length - 1 ? 0 : (nA(cx * 20 + r, sz * 20) - 0.5) * 8;
          const y = r === 0 ? baseY - 60 : baseY + hgt * t + jitter;
          pos.push(center.x + cx * ly.r, y, center.z + sz * ly.r);
          // 아래는 대기색, 위로 갈수록 바위/눈
          const snowAmt = Math.min(1, Math.max(0, (t - 0.35) * 1.6)) * snowy;
          const haze = r === 0 ? 1 : ly.hazeTop + (1 - ly.hazeTop) * Math.pow(1 - t, 1.6);
          const c = [0, 1, 2].map((ch) => {
            const m = rockS[ch] + (snowS[ch] - rockS[ch]) * snowAmt;
            return m + (hzS[ch] - m) * haze;
          });
          tmp.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
          col.push(tmp.r, tmp.g, tmp.b);
        }
      }
      const R = rows.length;
      for (let i = 0; i < N; i++) {
        for (let r = 0; r < R - 1; r++) {
          const a = base0 + i * R + r, b = base0 + (i + 1) * R + r;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, side: THREE.DoubleSide });
    this.mountains = new THREE.Mesh(g, m);
    this.mountains.frustumCulled = false;
    this.mountains.renderOrder = -50;
    this.mountains.name = 'mountains';
    this.group.add(this.mountains);
  }

  /** 하늘은 카메라에 붙이고, 산은 조금만 따라와(시차) 먼 평면에 잘리지 않게 */
  follow(cam: THREE.Vector3): void {
    this.dome.position.copy(cam);
    if (this.mountains) {
      this.mountains.position.set((cam.x - this.center.x) * 0.82, cam.y * 0.5, (cam.z - this.center.z) * 0.82);
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.domeMat.uniforms.uTime.value = this.time;
  }

  private disposeMountains(): void {
    if (!this.mountains) return;
    this.group.remove(this.mountains);
    this.mountains.geometry.dispose();
    (this.mountains.material as THREE.Material).dispose();
    this.mountains = null;
  }

  dispose(): void {
    this.disposeMountains();
    this.dome.geometry.dispose();
    this.domeMat.dispose();
  }
}
