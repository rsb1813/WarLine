// render-world: 렌더러·장면·카메라와 정적인 세계(하늘, 지형, 도로, 물, 건물, 나무, 깃대) + 파괴 동기화.
import * as THREE from 'three';
import type { Game, Quality, World } from '../types';
import { heightAt } from '../world';
import { Sky, paletteFor, sunDirection, type Palette } from './world-sky';
import { TerrainLayer } from './world-terrain';
import { BoxLayer } from './world-boxes';
import { TreeLayer } from './world-trees';
import { FlagLayer } from './world-flags';
import { makeShared, type SharedUniforms } from './world-shaders';
import { disposeTextures, setTextureAnisotropy } from './textures';

const PR_CAP: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };
const SHADOW_SIZE: Record<Quality, number> = { low: 0, medium: 1024, high: 2048 };
const SHADOW_HALF: Record<Quality, number> = { low: 60, medium: 55, high: 62 };
const ANISO: Record<Quality, number> = { low: 1, medium: 4, high: 8 };

export class WorldView {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;

  private quality: Quality;
  private dpr = 1;
  private width = 1;
  private height = 1;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private amb: THREE.AmbientLight;
  private fog: THREE.FogExp2;
  private sky: Sky;
  private pal: Palette;
  /** 해 쪽 (하늘에 보이는 해) */
  private sunDir = new THREE.Vector3();
  /** 그림자·직사광 방향 (아주 낮은 해는 그림자가 너무 늘어나서 조금 올린다) */
  private lightDir = new THREE.Vector3();
  private sh: SharedUniforms;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private world: World | null = null;
  private terrain: TerrainLayer | null = null;
  private boxes: BoxLayer | null = null;
  private trees: TreeLayer | null = null;
  private flags: FlagLayer | null = null;
  private brokenCur = 0;
  private collapseCur = 0;
  private time = 0;
  private shadowW = 60;
  private shadowH = 60;
  private lastShadowType: THREE.ShadowMapType | null = null;
  private lastShadowOn: boolean | null = null;
  private t1 = new THREE.Vector3();
  private t2 = new THREE.Vector3();
  private lr = new THREE.Vector3();
  private lu = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    const r = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.autoClear = true;
    this.renderer = r;

    this.dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    this.height = Math.max(1, canvas.clientHeight || canvas.height || 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 1600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.sh = makeShared();
    this.pal = paletteFor('day', 0);
    this.sky = new Sky(this.pal);
    this.scene.add(this.sky.group);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.name = 'sun';
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
    this.amb = new THREE.AmbientLight(0xffffff, 0.1);
    this.scene.add(this.hemi, this.amb);
    this.fog = new THREE.FogExp2(this.pal.horizon, this.pal.fogDensity);
    this.scene.fog = this.fog;

    this.applyPalette();
    r.setPixelRatio(Math.min(this.dpr, PR_CAP[quality]));
    r.setSize(this.width, this.height, false);
    this.applyQuality();
  }

  // ───────────────────────── 세계 ─────────────────────────

  setWorld(w: World): void {
    this.clearWorld();
    this.world = w;
    this.pal = paletteFor(w.def.time, w.def.seed);
    this.applyPalette();
    const theme = w.def.theme;
    this.sh.uSnowAmt.value = theme === 'snow' ? 1 : theme === 'industrial' ? 0.78 : 0.45;
    this.sh.uSnowCol.value.setHex(this.pal.snow);

    this.envRT?.dispose();
    this.envRT = null;
    try { this.envRT = this.sky.makeEnv(this.renderer, this.pal); } catch (e) { console.warn('env map 실패', e); }
    const env = this.envRT ? this.envRT.texture : null;

    this.terrain = new TerrainLayer(w, this.sh, this.pal, env);
    const glow = w.def.time === 'dusk' ? 0.16 : w.def.time === 'overcast' ? 0.06 : 0.02;
    this.boxes = new BoxLayer(w, this.sh, env, glow);
    this.trees = new TreeLayer(w, this.sh);
    this.flags = new FlagLayer(w, this.sh);
    this.scene.add(this.terrain.group, this.boxes.group, this.trees.group, this.flags.group);

    // 먼 산: 지도 가장자리 평균 높이 기준, 바다 쪽은 낮게
    const S = w.size, center = new THREE.Vector3(S / 2, 0, S / 2);
    let sum = 0, cnt = 0;
    for (let k = 0; k <= 32; k++) {
      const t = (k / 32) * S;
      for (const [x, z] of [[t, 0], [t, S], [0, t], [S, t]]) { sum += heightAt(w, x, z); cnt++; }
    }
    const baseY = sum / cnt - 4;
    let lowDir: number[] | null = null;
    if (w.water > -1e8) {
      const B = 48, raw: number[] = [];
      for (let k = 0; k < B; k++) {
        const a = (k / B) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        const tt = (S / 2) / Math.max(Math.abs(dx), Math.abs(dz));
        const ex = Math.min(S, Math.max(0, S / 2 + dx * tt)), ez = Math.min(S, Math.max(0, S / 2 + dz * tt));
        raw.push(heightAt(w, ex, ez) < w.water + 0.3 ? 1 : 0);
      }
      lowDir = raw.map((_, k) => (raw[(k + B - 2) % B] + raw[(k + B - 1) % B] * 2 + raw[k] * 3 + raw[(k + 1) % B] * 2 + raw[(k + 2) % B]) / 9);
    }
    this.sky.buildMountains(this.pal, center, baseY, w.def.seed, lowDir);

    this.brokenCur = w.brokenLog.length;
    this.collapseCur = w.collapseLog.length;
    this.applyQuality();
    this.camera.position.set(S / 2, heightAt(w, S / 2, S / 2) + 2, S / 2);
  }

  private clearWorld(): void {
    for (const l of [this.terrain, this.boxes, this.trees, this.flags]) {
      if (!l) continue;
      this.scene.remove(l.group);
      l.dispose();
    }
    this.terrain = null; this.boxes = null; this.trees = null; this.flags = null;
    this.world = null;
  }

  private applyPalette(): void {
    const p = this.pal;
    sunDirection(p, this.sunDir);
    const el = Math.max(p.sunElev, 12) * Math.PI / 180, az = p.sunAzim * Math.PI / 180;
    this.lightDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.amb.color.setHex(p.ambient);
    this.amb.intensity = p.ambientIntensity;
    this.fog.color.setHex(p.horizon);
    this.fog.density = p.fogDensity;
    this.renderer.toneMappingExposure = p.exposure;
    this.renderer.setClearColor(p.horizon, 1);
    this.sky.setPalette(p);
    this.sh.uSparkle.value = p.sparkle;
    this.scene.environmentIntensity = p.envIntensity;
    // 바람 방향(구름 흐름)은 하늘이 알아서
  }

  // ───────────────────────── 품질 ─────────────────────────

  setQuality(q: Quality): void {
    this.quality = q;
    this.applyQuality();
  }

  private applyQuality(): void {
    const q = this.quality, r = this.renderer;
    r.setPixelRatio(Math.min(this.dpr, PR_CAP[q]));
    r.setSize(this.width, this.height, false);
    const size = SHADOW_SIZE[q];
    const on = size > 0;
    const type: THREE.ShadowMapType = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    r.shadowMap.enabled = on;
    r.shadowMap.type = type;
    r.shadowMap.autoUpdate = true;
    const sun = this.sun;
    sun.castShadow = on;
    if (on) {
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      const half = SHADOW_HALF[q];
      this.shadowW = half;
      this.shadowH = half * Math.min(1, Math.max(0.5, this.lightDir.y * 2.6));
      const cam = sun.shadow.camera;
      cam.left = -this.shadowW; cam.right = this.shadowW; cam.top = this.shadowH; cam.bottom = -this.shadowH;
      cam.near = 1; cam.far = 700;
      cam.updateProjectionMatrix();
      sun.shadow.bias = q === 'high' ? -0.00035 : -0.0006;
      sun.shadow.normalBias = q === 'high' ? 0.03 : 0.045;
      sun.shadow.radius = q === 'high' ? 2 : 1;
    }
    const maxA = r.capabilities.getMaxAnisotropy ? r.capabilities.getMaxAnisotropy() : 1;
    setTextureAnisotropy(Math.min(ANISO[q], maxA || 1));
    // 환경 맵(간접광·반사)은 low 에서 끄고 반구광을 세게
    const env = this.envRT ? this.envRT.texture : null;
    if (q === 'low' || !env) {
      this.scene.environment = null;
      this.hemi.intensity = this.pal.hemiLow;
    } else {
      this.scene.environment = env;
      this.hemi.intensity = this.pal.hemiIntensity;
    }
    if (this.lastShadowOn !== null && (this.lastShadowOn !== on || this.lastShadowType !== type)) this.refreshMaterials();
    this.lastShadowOn = on; this.lastShadowType = type;
  }

  private refreshMaterials(): void {
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true; });
      else m.needsUpdate = true;
    });
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.dpr = dpr || 1;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(this.dpr, PR_CAP[this.quality]));
    this.renderer.setSize(this.width, this.height);
  }

  // ───────────────────────── 프레임 ─────────────────────────

  update(g: Game, dt: number): void {
    if (g.world !== this.world) this.setWorld(g.world);
    const w = g.world;
    this.time += dt;
    this.sh.uTime.value = this.time;
    if (this.boxes) {
      const bl = w.brokenLog;
      for (; this.brokenCur < bl.length; this.brokenCur++) {
        const id = bl[this.brokenCur];
        this.boxes.hide(id);
        this.trees?.breakBox(id);
      }
      const cl = w.collapseLog;
      for (; this.collapseCur < cl.length; this.collapseCur++) this.boxes.collapse(cl[this.collapseCur]);
      this.boxes.sync();
    }
    this.trees?.update(dt);
    this.flags?.update(g, dt);
    this.terrain?.update(this.time);
    this.sky.update(dt);
    this.follow();
  }

  /** 하늘·산은 카메라에, 그림자 상자는 카메라 앞쪽에 (텍셀 단위로 맞춰 떨림 없음) */
  private follow(): void {
    const cam = this.camera.position;
    this.sky.follow(cam);
    const sun = this.sun;
    const L = this.lightDir;
    const fwd = this.t1.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const c = this.t2.copy(cam).addScaledVector(fwd, this.shadowW * 0.4);
    this.lr.set(0, 1, 0).cross(L).normalize();
    this.lu.copy(L).cross(this.lr).normalize();
    const size = Math.max(1, sun.shadow.mapSize.x);
    const tw = (2 * this.shadowW) / size, th = (2 * this.shadowH) / size;
    const a = Math.round(c.dot(this.lr) / tw) * tw;
    const b = Math.round(c.dot(this.lu) / th) * th;
    const d = c.dot(L);
    c.set(0, 0, 0).addScaledVector(this.lr, a).addScaledVector(this.lu, b).addScaledVector(L, d);
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(L, 320);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  render(): void {
    this.follow();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearWorld();
    this.sky.dispose();
    this.envRT?.dispose();
    this.envRT = null;
    disposeTextures();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
  }
}
