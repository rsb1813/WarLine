// render-fx: 카메라 둘레 눈발 (Points). 위치는 셰이더에서 시간·바람으로 움직이고 카메라 둘레 상자 안으로 감싼다 → CPU 비용 0.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec2 aRnd;
uniform float uTime;
uniform float uBox;
uniform float uScale;
uniform vec3 uCam;
uniform vec3 uWind;
varying float vA;
#include <fog_pars_vertex>
void main() {
  float sp = 0.7 + 0.6 * aRnd.x;
  vec3 p = position;
  p += uWind * (uTime * sp);
  p.y -= (0.9 + aRnd.x * 0.8) * uTime;
  p.x += sin(uTime * 1.3 + aRnd.y * 6.283) * 0.45;
  p.z += cos(uTime * 1.07 + aRnd.y * 4.1) * 0.45;
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mvPosition = modelViewMatrix * vec4(uCam + rel, 1.0);
  float d = max(-mvPosition.z, 0.05);
  gl_PointSize = clamp(uScale * (0.022 + aRnd.x * 0.022) / d, 1.0, 22.0);
  vA = (1.0 - smoothstep(uBox * 0.32, uBox * 0.5, length(rel))) * smoothstep(0.25, 1.2, d);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.12, length(c)) * vA * uAlpha;
  if (a < 0.01) discard;
  vec3 col = uColor;
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  col = mix(col, fogColor, fogF);
#endif
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Snow {
  readonly points: THREE.Points;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;

  constructor(count: number, box: number, alpha: number) {
    const pos = new Float32Array(count * 3), rnd = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * box; pos[i * 3 + 1] = Math.random() * box; pos[i * 3 + 2] = Math.random() * box;
      rnd[i * 2] = Math.random(); rnd[i * 2 + 1] = Math.random();
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 2));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: box },
        uScale: { value: 600 },
        uCam: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color(0.92, 0.95, 1.0) },
        uAlpha: { value: alpha },
        fogColor: { value: new THREE.Color(0xffffff) },
        fogNear: { value: 1 },
        fogFar: { value: 2000 },
        fogDensity: { value: 0.00025 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 13;
    const v2 = new THREE.Vector2();
    // 점 크기: 실제 그리는 버퍼 높이와 그 카메라 시야각으로
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const pc = camera as THREE.PerspectiveCamera;
      if (!pc.isPerspectiveCamera) return;
      renderer.getDrawingBufferSize(v2);
      this.mat.uniforms.uScale.value = (v2.y * pc.zoom) / (2 * Math.tan((pc.fov * Math.PI) / 360));
    };
  }

  update(time: number, cam: THREE.Vector3, windX: number, windZ: number, light: THREE.Color): void {
    const u = this.mat.uniforms;
    u.uTime.value = time % 3000;
    (u.uCam.value as THREE.Vector3).copy(cam);
    (u.uWind.value as THREE.Vector3).set(windX, 0, windZ);
    (u.uColor.value as THREE.Color).setRGB(0.92 * light.r, 0.95 * light.g, 1.0 * light.b);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
