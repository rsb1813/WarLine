// render-actors: 병사·차량·투사체·설치물을 그린다. 프레임마다 update(g, dt, viewer, camera).
import * as THREE from 'three';
import type { Game, Quality } from '../types';
import type { ActorCtx } from './actor-geo';
import { SoldierLayer } from './actor-soldiers';
import { VehicleLayer } from './actor-vehicles';
import { PropsLayer } from './actor-props';

export class ActorsView {
  private soldiers: SoldierLayer;
  private vehicles: VehicleLayer;
  private props: PropsLayer;
  private frustum = new THREE.Frustum();
  private proj = new THREE.Matrix4();
  private ctx: ActorCtx;

  constructor(scene: THREE.Scene, quality: Quality) {
    this.soldiers = new SoldierLayer(scene, quality);
    this.vehicles = new VehicleLayer(scene, quality);
    this.props = new PropsLayer(scene, quality);
    this.ctx = { frustum: this.frustum, cam: new THREE.Vector3(), t: 0, dt: 0, quality, frame: 0 };
  }

  /** 그래픽 품질 바꾸기 (그림자 범위) */
  setQuality(q: Quality): void {
    this.ctx.quality = q;
    this.soldiers.setQuality(q);
    this.vehicles.setQuality(q);
    this.props.setQuality(q);
  }

  update(g: Game, dt: number, viewer: number, camera: THREE.Camera): void {
    const c = this.ctx;
    c.dt = Math.min(Math.max(dt, 0), 0.1);
    c.t += c.dt;
    c.frame++;
    camera.updateMatrixWorld();
    this.proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.proj);
    c.cam.setFromMatrixPosition(camera.matrixWorld);
    this.vehicles.update(g, c);
    this.soldiers.update(g, c, viewer);
    this.props.update(g, c);
  }

  dispose(): void {
    this.soldiers.dispose();
    this.vehicles.dispose();
    this.props.dispose();
  }
}
