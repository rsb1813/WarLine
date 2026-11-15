// render-fx: 점광원 풀 (폭발 섬광, 총구, 불길 깜빡임). 빛 개수가 바뀌면 모든 재질이 다시 컴파일되므로
// 빛은 언제나 장면에 둔 채 세기만 0 으로 내린다.
import * as THREE from 'three';

export class LightPool {
  private readonly lights: THREE.PointLight[] = [];
  private readonly t: Float32Array;
  private readonly dur: Float32Array;
  private readonly peak: Float32Array;
  private readonly prio: Float32Array;

  constructor(scene: THREE.Scene, count: number) {
    this.t = new Float32Array(count);
    this.dur = new Float32Array(count);
    this.peak = new Float32Array(count);
    this.prio = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 10, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
      this.dur[i] = 1; this.t[i] = 1;
    }
  }

  get size(): number { return this.lights.length; }

  private cur(i: number): number {
    const k = 1 - this.t[i] / this.dur[i];
    return k > 0 ? this.peak[i] * k * k : 0;
  }

  /**
   * 짧은 빛. 빈 자리가 없으면 우선순위가 낮은 빛, 또는 같은 순위의 더 약한 빛을 빼앗는다.
   * intensity: 칸델라 (물리 기반 조명), distance: 끊기는 거리 m
   */
  flash(x: number, y: number, z: number, color: number, intensity: number, distance: number, dur: number, prio: number): boolean {
    let best = -1, bestV = Infinity;
    for (let i = 0; i < this.lights.length; i++) {
      const c = this.cur(i);
      if (c <= 0) { best = i; break; }
      if (prio > this.prio[i] || (prio === this.prio[i] && c < intensity)) {
        const v = c * (1 + this.prio[i]);
        if (v < bestV) { bestV = v; best = i; }
      }
    }
    if (best < 0) return false;
    const l = this.lights[best];
    l.position.set(x, y, z);
    l.color.setHex(color);
    l.distance = distance;
    this.peak[best] = intensity;
    this.dur[best] = Math.max(0.02, dur);
    this.t[best] = 0;
    this.prio[best] = prio;
    l.intensity = intensity;
    return true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.lights.length; i++) {
      this.t[i] += dt;
      this.lights[i].intensity = this.cur(i);
    }
  }

  dispose(): void {
    for (const l of this.lights) { l.removeFromParent(); l.dispose(); }
    this.lights.length = 0;
  }
}
