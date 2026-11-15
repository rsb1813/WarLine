// 인스턴스 메시 한 벌: 프레임마다 begin → push… → end. 쓴 만큼만 GPU 로 올린다.
import * as THREE from 'three';

export class IPart {
  mesh: THREE.InstancedMesh;
  n = 0;
  cap = 0;
  private cast = false;
  private recv = false;
  private m!: Float32Array;
  private c!: Float32Array;

  constructor(private scene: THREE.Scene, readonly geo: THREE.BufferGeometry, private mat: THREE.Material, cap: number) {
    this.mesh = this.make(Math.max(1, cap));
  }

  private make(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new Float32Array(cap * 3);
    col.fill(1);
    m.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    m.visible = false;
    m.castShadow = this.cast;
    m.receiveShadow = this.recv;
    this.m = m.instanceMatrix.array as Float32Array;
    this.c = col;
    this.cap = cap;
    this.scene.add(m);
    return m;
  }

  setShadow(cast: boolean, recv: boolean): void {
    this.cast = cast; this.recv = recv;
    this.mesh.castShadow = cast; this.mesh.receiveShadow = recv;
  }

  /** 필요한 개수보다 작으면 다시 만든다 */
  ensure(need: number): void {
    if (need <= this.cap) return;
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = this.make(Math.ceil(need * 1.25));
  }

  begin(): void { this.n = 0; }

  /** 열 기준 축 3개 + 위치 */
  basis(
    xx: number, xy: number, xz: number,
    yx: number, yy: number, yz: number,
    zx: number, zy: number, zz: number,
    px: number, py: number, pz: number,
    r: number, g: number, b: number,
  ): void {
    if (this.n >= this.cap) return;
    const a = this.m, o = this.n * 16;
    a[o] = xx; a[o + 1] = xy; a[o + 2] = xz; a[o + 3] = 0;
    a[o + 4] = yx; a[o + 5] = yy; a[o + 6] = yz; a[o + 7] = 0;
    a[o + 8] = zx; a[o + 9] = zy; a[o + 10] = zz; a[o + 11] = 0;
    a[o + 12] = px; a[o + 13] = py; a[o + 14] = pz; a[o + 15] = 1;
    const c = this.c, k = this.n * 3;
    c[k] = r; c[k + 1] = g; c[k + 2] = b;
    this.n++;
  }

  matrix(mt: THREE.Matrix4, r: number, g: number, b: number): void {
    if (this.n >= this.cap) return;
    const e = mt.elements, a = this.m, o = this.n * 16;
    for (let i = 0; i < 16; i++) a[o + i] = e[i];
    const c = this.c, k = this.n * 3;
    c[k] = r; c[k + 1] = g; c[k + 2] = b;
    this.n++;
  }

  end(): void {
    const m = this.mesh;
    m.count = this.n;
    m.visible = this.n > 0;
    if (this.n === 0) return;
    const im = m.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, this.n * 16);
    im.needsUpdate = true;
    const ic = m.instanceColor;
    if (ic) {
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, this.n * 3);
      ic.needsUpdate = true;
    }
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
  }
}
