// 로드아웃 3D 미리보기: 자체 WebGLRenderer, 스튜디오 조명(키·보조·윤곽), 어두운 배경, 바닥 반사와 그림자.
// 총을 천천히 흔들어 돌리고 끌어서 돌린다. 부착물 슬롯 위치를 화면 좌표로 내 준다. 카드용 실루엣 그림도 만든다.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Quality, SlotId } from '../types';

const V = THREE.Vector3;

export class Studio {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);
  private spin = new THREE.Group();
  private mirror = new THREE.Group();
  private mirrorSpin = new THREE.Group();
  private holder: THREE.Group | null = null;
  private model: THREE.Object3D | null = null;
  private anchors: Partial<Record<SlotId, THREE.Vector3>> = {};
  private floor = new THREE.Group();
  private env: THREE.Texture | null = null;
  private bgTex: THREE.Texture;
  private floorTex: THREE.Texture;
  private poolTex: THREE.Texture;
  private key: THREE.DirectionalLight;
  private rt: THREE.WebGLRenderTarget | null = null;
  private normalMat = new THREE.MeshNormalMaterial();
  private fitLen = 1.5;
  private frameW = 1.5;
  private cssW = 1; private cssH = 1;
  private raf = 0; private last = 0; private t = 0;
  private active = false; private dead = false;
  private yaw = 0; private tilt = 0; private vel = 0; private idle = 3;
  private drag: { id: number; x: number; y: number; t: number } | null = null;
  private ro: ResizeObserver;
  private tmp = new V();
  /** 그릴 때마다 (슬롯 선 갱신용) */
  onFrame: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', alpha: false, powerPreference: 'default' });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = true;
    r.shadowMap.type = quality === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

    // 배경: 위는 차갑고 가운데 위쪽에 은은한 빛
    this.bgTex = canvasTex(512, 512, (g, w, h) => {
      const lin = g.createLinearGradient(0, 0, 0, h);
      lin.addColorStop(0, '#121922');
      lin.addColorStop(0.55, '#0b0f15');
      lin.addColorStop(1, '#050608');
      g.fillStyle = lin;
      g.fillRect(0, 0, w, h);
      const rad = g.createRadialGradient(w * 0.5, h * 0.36, 0, w * 0.5, h * 0.36, w * 0.6);
      rad.addColorStop(0, 'rgba(120,140,165,0.20)');
      rad.addColorStop(1, 'rgba(120,140,165,0)');
      g.fillStyle = rad;
      g.fillRect(0, 0, w, h);
    });
    this.scene.background = this.bgTex;
    try {
      const pm = new THREE.PMREMGenerator(r);
      const room = new RoomEnvironment();
      this.env = pm.fromScene(room, 0.04).texture;
      pm.dispose();
      room.dispose();
      this.scene.environment = this.env;
      this.scene.environmentIntensity = 0.42;
    } catch { /* 환경광 없이 */ }

    // 조명
    this.scene.add(new THREE.HemisphereLight(0x9fb2c8, 0x0a0b0d, 0.5));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.position.set(-2.2, 3.4, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(quality === 'low' ? 512 : 1024, quality === 'low' ? 512 : 1024);
    key.shadow.camera.left = -1.6; key.shadow.camera.right = 1.6; key.shadow.camera.top = 1.6; key.shadow.camera.bottom = -1.6;
    key.shadow.camera.near = 0.5; key.shadow.camera.far = 10;
    key.shadow.radius = 6;
    key.shadow.bias = -0.0005;
    this.key = key;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9ab4ff, 0.7);
    fill.position.set(-2.5, 0.2, -2.2);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffc98a, 2.2);
    rim.position.set(2.6, 1.6, -1.4);
    this.scene.add(rim);
    const rim2 = new THREE.DirectionalLight(0x8fd0ff, 1.1);
    rim2.position.set(2.2, 0.8, 2.4);
    this.scene.add(rim2);

    // 바닥: 반사 위에 덮는 판(가장자리로 갈수록 배경으로 녹아듦), 그림자, 빛 웅덩이
    this.floorTex = canvasTex(256, 256, (g, w) => {
      const rad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      rad.addColorStop(0, 'rgba(9,12,16,0.8)');
      rad.addColorStop(0.42, 'rgba(8,10,14,0.95)');
      rad.addColorStop(0.75, 'rgba(7,9,12,0.65)');
      rad.addColorStop(1, 'rgba(6,8,11,0)');
      g.fillStyle = rad;
      g.fillRect(0, 0, w, w);
    });
    this.poolTex = canvasTex(256, 256, (g, w) => {
      const rad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      rad.addColorStop(0, 'rgba(255,190,120,0.16)');
      rad.addColorStop(0.5, 'rgba(255,170,90,0.05)');
      rad.addColorStop(1, 'rgba(255,170,90,0)');
      g.fillStyle = rad;
      g.fillRect(0, 0, w, w);
    });
    const plane = new THREE.PlaneGeometry(7, 7);
    const cover = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: this.floorTex, transparent: true, depthWrite: false, toneMapped: false }));
    cover.rotation.x = -Math.PI / 2;
    cover.renderOrder = 1;
    const shadow = new THREE.Mesh(plane, new THREE.ShadowMaterial({ opacity: 0.5, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    shadow.receiveShadow = true;
    shadow.renderOrder = 2;
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: this.poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.004;
    pool.renderOrder = 3;
    this.floor.add(cover, shadow, pool);
    this.scene.add(this.floor);

    this.mirror.scale.y = -1;
    this.mirror.add(this.mirrorSpin);
    this.scene.add(this.spin, this.mirror);

    // 끌어서 돌리기
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('dblclick', this.onReset);
    document.addEventListener('visibilitychange', this.onVis);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  // ───────── 모델 ─────────

  /** 모델을 바꾼다. kind 'gun' 이면 부착물 슬롯 기준점을 계산 */
  setModel(obj: THREE.Object3D | null, kind: 'gun' | 'gadget'): void {
    const old = this.model;
    if (this.holder) { this.spin.remove(this.holder); this.holder = null; }
    this.mirrorSpin.clear();
    this.model = null;
    this.anchors = {};
    if (obj) {
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) box.set(new V(-0.1, -0.1, -0.4), new V(0.1, 0.1, 0.4));
      const size = box.getSize(new V());
      const center = box.getCenter(new V());
      if (kind === 'gun') this.anchors = gunAnchors(obj, box);
      const target = kind === 'gun' ? 1.5 : 1.05;
      const s = target / Math.max(size.x, size.y, size.z, 0.05);
      obj.position.sub(center);
      const holder = new THREE.Group();
      holder.scale.setScalar(s);
      holder.add(obj);
      obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      this.holder = holder;
      this.model = obj;
      this.spin.add(holder);
      const ghost = holder.clone(true);
      ghost.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
      this.mirrorSpin.add(ghost);
      const halfY = (size.y * s) / 2;
      const halfLen = (Math.max(size.x, size.z) * s) / 2;
      const floorY = -halfY - 0.12 - halfLen * Math.sin(0.26) * 0.6;
      this.floor.position.y = floorY;
      this.mirror.position.y = floorY * 2;
      this.key.target.position.set(0, floorY, 0);
      this.key.target.updateMatrixWorld();
      this.fitLen = Math.max(size.x, size.z) * s;
      this.fitCamera();
    }
    if (old) this.release(old);
  }

  /** 다른 모델이 쓰지 않는 GPU 자원을 놓는다 (만드는 쪽이 공유 캐시를 써도 안전) */
  private release(old: THREE.Object3D): void {
    const keep = new Set<unknown>();
    this.model?.traverse((o) => collect(o, keep));
    const drop = new Set<{ dispose(): void }>();
    old.traverse((o) => {
      const items = new Set<unknown>();
      collect(o, items);
      items.forEach((x) => { if (!keep.has(x)) drop.add(x as { dispose(): void }); });
    });
    drop.forEach((x) => { try { x.dispose(); } catch { /* 무시 */ } });
  }

  /** 슬롯 기준점의 화면 좌표 (캔버스 css px) */
  project(slot: SlotId): { x: number; y: number } | null {
    const a = this.anchors[slot];
    if (!a || !this.model) return null;
    this.tmp.copy(a).applyMatrix4(this.model.matrixWorld).project(this.camera);
    return { x: (this.tmp.x * 0.5 + 0.5) * this.cssW, y: (-this.tmp.y * 0.5 + 0.5) * this.cssH };
  }

  /** 화면 가로에서 모델이 차지할 몫 (부착물 버튼이 둘러싸면 여백을 넓게) */
  setFrame(widthFactor: number): void {
    this.frameW = widthFactor;
    this.fitCamera();
  }

  // ───────── 돌리기 ─────────

  setActive(on: boolean): void {
    if (this.dead) return;
    if (on === this.active) return;
    this.active = on;
    if (on && !document.hidden) this.loop();
    else cancelAnimationFrame(this.raf);
  }

  private onVis = () => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else if (this.active) this.loop();
  };

  private loop(): void {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const f = (now: number) => {
      if (!this.active || this.dead) return;
      this.raf = requestAnimationFrame(f);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
      this.render();
    };
    this.raf = requestAnimationFrame(f);
  }

  private step(dt: number): void {
    this.t += dt;
    if (!this.drag) {
      this.idle += dt;
      this.yaw += this.vel * dt;
      this.vel *= Math.exp(-dt * 3.2);
      // 오래 손대지 않으면 옆모습 쪽으로 천천히 돌아온다
      if (this.idle > 4) { this.yaw = wrap(this.yaw); this.yaw -= this.yaw * Math.min(1, dt * 0.35); }
      this.tilt += -this.tilt * Math.min(1, dt * 0.8);
    }
    const k = Math.min(1, Math.max(0, (this.idle - 1.2) / 2));
    const sway = Math.sin(this.t * 0.42) * 0.36 * k;
    this.spin.rotation.set(0, -0.32 + this.yaw + sway, this.tilt + Math.sin(this.t * 0.31) * 0.04 * k, 'ZYX');
    this.spin.position.y = Math.sin(this.t * 0.9) * 0.01;
    this.mirrorSpin.rotation.copy(this.spin.rotation);
    this.mirrorSpin.position.copy(this.spin.position);
  }

  render(): void {
    if (this.dead) return;
    this.renderer.render(this.scene, this.camera);
    if (this.onFrame) this.onFrame();
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    this.vel = 0;
    this.idle = 0;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
  };
  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const now = performance.now();
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const dt = Math.max(0.008, (now - d.t) / 1000);
    this.yaw += dx * 0.0095;
    this.vel = (dx * 0.0095) / dt;
    this.tilt = Math.max(-0.45, Math.min(0.45, this.tilt + dy * 0.004));
    d.x = e.clientX; d.y = e.clientY; d.t = now;
    this.idle = 0;
  };
  private onUp = (e: PointerEvent) => {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    if (performance.now() - this.drag.t > 90) this.vel = 0;
    this.drag = null;
    this.idle = 0;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* 무시 */ }
  };
  private onReset = () => { this.yaw = 0; this.tilt = 0; this.vel = 0; this.idle = 0; };

  // ───────── 크기 ─────────

  private resize(): void {
    const host = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, Math.round(host.clientWidth)), h = Math.max(1, Math.round(host.clientHeight));
    if (w === this.cssW && h === this.cssH) return;
    this.cssW = w; this.cssH = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.fitCamera();
    if (this.active) this.render();
  }

  private fitCamera(): void {
    const c = this.camera;
    const tan2 = 2 * Math.tan((c.fov * Math.PI) / 360);
    const L = this.fitLen;
    const d = Math.max((L * this.frameW) / (c.aspect * tan2), (L * 0.78) / tan2, 1.4);
    const dir = new V(-1, 0.24, 0.16).normalize();
    c.position.copy(dir.multiplyScalar(d));
    c.lookAt(0, -0.04, 0);
    c.near = Math.max(0.02, d * 0.05);
    c.far = d * 6 + 10;
    c.updateProjectionMatrix();
  }

  // ───────── 실루엣 그림 ─────────

  /** 옆모습 실루엣을 PNG data URL 로. 총구가 왼쪽 */
  snapshot(obj: THREE.Object3D, w: number, h: number): string | null {
    if (this.dead) return null;
    const r = this.renderer;
    const W = w * 2, H = h * 2;
    try {
      const sc = new THREE.Scene();
      sc.add(obj);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return null;
      const size = box.getSize(new V()), c = box.getCenter(new V());
      const aspect = W / H;
      let hw = Math.max(size.z, size.x * 0.3) / 2 * 1.06, hh = hw / aspect;
      if ((size.y / 2) * 1.1 > hh) { hh = (size.y / 2) * 1.1; hw = hh * aspect; }
      const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.01, 100);
      cam.position.set(c.x - 20, c.y, c.z);
      cam.up.set(0, 1, 0);
      cam.lookAt(c);
      sc.overrideMaterial = this.normalMat;
      if (!this.rt) this.rt = new THREE.WebGLRenderTarget(W, H);
      else if (this.rt.width !== W || this.rt.height !== H) this.rt.setSize(W, H);
      const prevCol = r.getClearColor(new THREE.Color()), prevA = r.getClearAlpha();
      const prevT = r.getRenderTarget();
      r.setRenderTarget(this.rt);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(sc, cam);
      const buf = new Uint8Array(W * H * 4);
      r.readRenderTargetPixels(this.rt, 0, 0, W, H, buf);
      r.setRenderTarget(prevT);
      r.setClearColor(prevCol, prevA);
      sc.remove(obj);
      const big = document.createElement('canvas');
      big.width = W; big.height = H;
      const g = big.getContext('2d') as CanvasRenderingContext2D;
      const id = g.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const s = ((H - 1 - y) * W + x) * 4, o = (y * W + x) * 4;
          const a = buf[s + 3];
          if (!a) continue;
          const nx = buf[s] / 127.5 - 1, ny = buf[s + 1] / 127.5 - 1, nz = buf[s + 2] / 127.5 - 1;
          const lum = 0.38 + 0.62 * Math.max(0, nx * -0.25 + ny * 0.72 + nz * 0.64);
          id.data[o] = 198 * lum + 22; id.data[o + 1] = 206 * lum + 22; id.data[o + 2] = 216 * lum + 24; id.data[o + 3] = a;
        }
      }
      g.putImageData(id, 0, 0);
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const og = out.getContext('2d') as CanvasRenderingContext2D;
      og.imageSmoothingQuality = 'high';
      og.drawImage(big, 0, 0, w, h);
      this.release(obj);
      return out.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('dblclick', this.onReset);
    const m = this.model;
    this.model = null;
    if (m) this.release(m);
    this.floor.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) { mm.geometry.dispose(); (mm.material as THREE.Material).dispose(); } });
    this.bgTex.dispose(); this.floorTex.dispose(); this.poolTex.dispose();
    this.env?.dispose();
    this.rt?.dispose();
    this.normalMat.dispose();
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch { /* 무시 */ }
    this.onFrame = null;
  }
}

// ───────── 도우미 ─────────

const wrap = (a: number) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d') as CanvasRenderingContext2D, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function collect(o: THREE.Object3D, into: Set<unknown>): void {
  const m = o as THREE.Mesh;
  if (!m.isMesh && !(o as THREE.Line).isLine && !(o as THREE.Points).isPoints) return;
  if (m.geometry) into.add(m.geometry);
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  for (const mt of mats) {
    if (!mt) continue;
    into.add(mt);
    for (const k of Object.keys(mt)) {
      const v = (mt as unknown as Record<string, unknown>)[k];
      if (v && (v as THREE.Texture).isTexture) into.add(v);
    }
  }
}

/** 총 모델(원점 = 손잡이, 총구 -Z)에서 슬롯별 기준점. userData.muzzle / sight / mag 가 있으면 쓴다 */
function gunAnchors(obj: THREE.Object3D, box: THREE.Box3): Partial<Record<SlotId, THREE.Vector3>> {
  const inv = obj.matrixWorld.clone().invert();
  const local = (o: unknown): THREE.Vector3 | null => {
    const x = o as THREE.Object3D | undefined;
    if (!x || !x.isObject3D) return null;
    return x.getWorldPosition(new V()).applyMatrix4(inv);
  };
  const lb = box.clone().applyMatrix4(inv);
  const midZ = (lb.min.z + lb.max.z) / 2;
  const ud = obj.userData as Record<string, unknown>;
  const muzzle = local(ud.muzzle) ?? new V(0, lb.max.y * 0.55 + lb.min.y * 0.45, lb.min.z);
  const sight = local(ud.sight) ?? new V(0, lb.max.y, midZ);
  let magC: THREE.Vector3 | null = null;
  const magObj = ud.mag as THREE.Object3D | undefined;
  if (magObj && magObj.isObject3D) {
    const mb = new THREE.Box3().setFromObject(magObj);
    magC = mb.isEmpty() ? local(magObj) : mb.getCenter(new V()).applyMatrix4(inv);
  }
  if (!magC) magC = new V(0, lb.min.y * 0.7 + lb.max.y * 0.3, Math.min(0, midZ) * 0.5);
  const len = Math.max(0.05, lb.max.z - muzzle.z);
  return {
    optic: new V(0, sight.y - 0.01, sight.z + (muzzle.z - sight.z) * 0.16),
    muzzle: muzzle.clone(),
    barrel: new V(0, muzzle.y, muzzle.z + len * 0.14),
    underbarrel: new V(0, muzzle.y - Math.max(0.03, (muzzle.y - lb.min.y) * 0.3), muzzle.z + len * 0.3),
    magazine: magC.clone(),
    ammo: new V(0, (magC.y + muzzle.y) / 2 + 0.02, magC.z + 0.02),
    stock: new V(0, (lb.min.y + lb.max.y) / 2 + 0.01, lb.max.z - Math.min(0.05, len * 0.05)),
  };
}
