# WARLINE 3D — 모듈 규약

브라우저 3D(Three.js 0.170, WebGL) 1인칭 대규모 제병협동 슈터. 2147년 베링 해협, 미 북극사령부(us) 대 러시아 극동군(ru).
정복전(거점 점령, 티켓). 기본 32 대 32, 16 대 16 / 64 대 64 선택. 폰(터치)과 PC(마우스·키보드) 모두 지원.
장르·시스템은 대형 밀리터리 FPS 수준(4병과, 분대, 무기 부착물 7슬롯, 장비 변형, 차량, 건물 파괴)을 목표로 하되
특정 기존 게임의 이름·지도·UI 모양·로고는 따라 하지 않는다. 화면 글은 모두 한국어.

공통 파일 (수정 금지): `src/types.ts`(모든 공유 타입), `src/math.ts`(벡터·각도·난수), `src/sim/body.ts`(몸 치수·판정), `src/ui/base.css`(디자인 토큰).
좌표·각도 규약은 `src/types.ts` 맨 위 주석을 따른다. Three.js 카메라: `camera.rotation.set(pitch, yaw, 0, 'YXZ')`, 위치 = 눈 위치.

각 모듈은 아래에 적힌 export 를 **이름과 시그니처 그대로** 제공해야 한다. 다른 모듈이 동시에 만들어지고 있으므로,
남의 모듈은 이 문서의 시그니처만 믿고 import 한다. 아래에 없는 export 는 자유롭게 추가해도 되지만 남이 쓸 거라 기대하지 말 것.
Soldier.ai / Vehicle.ai 는 ai 모듈 전용 칸이다.

TypeScript strict, noUnusedLocals. three 는 `import * as THREE from 'three'`. CSS 는 모듈에서 `import './x.css'` (vite·esbuild 둘 다 묶는다).
외부 그림·소리 파일 없음: 텍스처는 캔버스로 절차 생성, 소리는 Web Audio 합성. 결과물은 한 장짜리 HTML(scripts/build-single.mjs).

---

## defs — `src/defs/*.ts`, `src/profile.ts` (index: `src/defs/index.ts` 가 전부 다시 export)
```ts
export const WEAPONS: Record<string, WeaponDef>;          // 주무기 18종 이상(ar 4, carbine 3, smg 3, lmg 3, dmr 2, sniper 2, shotgun 2) + 권총 3
export const PRIMARY_IDS: string[]; export const SECONDARY_IDS: string[];
export const ATTACHMENTS: Record<string, AttachmentDef>;  // 슬롯마다 4~9개
export function computeStats(weaponId: string, att: Attachments, cls?: ClassId): WeaponStats;  // cls 숙련 보너스 포함
export function defaultAttachments(weaponId: string): Attachments;
export const GADGETS: Record<string, GadgetDef>;          // GadgetKind 마다 최소 1개, 변형 2~3개
export const CLASSES: Record<ClassId, ClassDef>;
export const CLASS_IDS: ClassId[];
export const VEHICLES: Record<VehicleType, VehicleDef>;
export const VWEAPONS: Record<string, VWeaponDef>;
export const MAPS: MapDef[];                               // 3개
export const SIZES: Record<SizeId, SizeDef>;               // small 16/250/3거점, medium 32/400/5거점, large 64/650/7거점
export const DIFFS: Record<Diff, DiffDef>;
export const FACTIONS: Record<Side, FactionDef>;
export const NAMES: Record<Side, string[]>;                // 병사 이름 100개 이상씩 (한국어 음역)
export const SQUAD_NAMES: string[];                        // 알파, 브라보 ...
export const CAT_NAMES: Record<WeaponCat, string>;
export const SLOT_NAMES: Record<SlotId, string>;
export const LORE: string;
// src/profile.ts
export const DEFAULT_SETTINGS: Settings;
export function defaultLoadout(cls: ClassId): Loadout;
export function loadProfile(): Profile;                    // localStorage 'warline.v3', 실패하면 기본값
export function saveProfile(p: Profile): void;
export function rankOf(xp: number): { rank: number; cur: number; next: number };
```

## world — `src/world/*.ts` (index: `src/world/index.ts`)
```ts
export function genWorld(def: MapDef, flagCount: number): World;   // 결정적(def.seed). 지형, 도로, 마을·건물(층, 문, 창, 계단), 숲, 바위, 엄폐물, 거점, 본부, 차량 자리
export function heightAt(w: World, x: number, z: number): number;  // 지형만, 쌍선형
export function groundTypeAt(w: World, x: number, z: number): GroundType;
export function floorAt(w: World, x: number, y: number, z: number, radius: number): number; // y+0.5 아래에서 가장 높은 디딤면(지형·바닥·지붕·상자 윗면)
export function raycast(w: World, o: Vec3, d: Vec3, maxT: number, sight?: boolean): RayHit | null; // sight=true 면 opaque 아닌 상자 통과
export function lineOfSight(w: World, a: Vec3, b: Vec3): boolean;
export function collideBody(w: World, pos: Vec3, vel: Vec3, radius: number, height: number): { ground: boolean; ceiling: boolean; wall: boolean };
   // pos=발. solid 상자에서 밀어내고, 0.5m 이하 턱은 올라서고, 지형 아래로 못 들어가게 하고, 지도 밖으로 못 나가게. 막힌 축의 vel 은 0.
export function boxesNear(w: World, x: number, z: number, r: number, cb: (b: Box) => void): void;
export function damageBox(w: World, id: number, dmg: number): BreakResult;          // hp 0 → alive=false, brokenLog 에 추가. 건물 벽 60% 이상 잃으면 무너짐(collapseLog, 그 건물 상자 전부 제거하고 rubble 상자 몇 개 추가)
export function blastWorld(w: World, c: Vec3, radius: number, dmg: number): BreakResult;
export function inWater(w: World, x: number, z: number): boolean;
```

## sim-core — `src/sim/game.ts`, `src/sim/damage.ts`
```ts
// game.ts
export function createGame(o: GameOpts): Game;   // genWorld, 병사(팀당 SIZES.perTeam, 4명 분대, 0번 = 사람, 0팀), 차량(createVehicles), 거점, 티켓. 봇은 바로 본부/거점에 배치, 사람은 playerNeedsDeploy=true
export function stepGame(g: Game, dt: number): void; // 고정 1/60. 순서: updateBots → 병사마다(차량 밖이면 updateSoldier) updateWeapons, updateGadgets → updateVehicles → updateProjectiles → updatePlaced → 연막 → 소생·쓰러짐·부활 타이머(봇 자동 재배치) → 점령 → 티켓·종료
export function spawnOptions(g: Game, sid: number): SpawnOption[];
export function deploySoldier(g: Game, sid: number, opt: SpawnOption, cls: ClassId, loadout: Loadout): void;
export function giveUp(g: Game, sid: number): void;
export function rand(g: Game): number;            // 결정적 0..1
export function emit(g: Game, e: GameEvent): void;
export function award(g: Game, sid: number, pts: number, text: string): void;  // 점수 + score 이벤트
export function soldierById(g: Game, id: number): Soldier;  // soldiers[id] (id = 배열 순번)
// damage.ts
export function damageSoldier(g: Game, t: Soldier, dmg: number, by: number, weapon: string, head: boolean, from: Vec3 | null): void; // 난이도 배율, 보호, 쓰러짐(down)/즉사(헤드 고배율·폭발 큰 피해), 도움, 이벤트
export function killSoldier(g: Game, t: Soldier, by: number, weapon: string, head: boolean): void;
export function explode(g: Game, pos: Vec3, r: number, dmg: number, by: number, team: Team, weapon: string, o: { dmgVehicle: number; wallDmg: number; kind: 'grenade' | 'rocket' | 'shell' | 'vehicle' | 'mine' | 'c4' | 'ugl' }): void;
export function damageVehicle(g: Game, v: Vehicle, dmg: number, by: number, weapon: string, hit: Vec3 | null, kind: 'bullet' | 'ap' | 'explosive'): void; // 앞·옆·뒤·위 장갑, 파괴 시 탑승자 사망, 이벤트, 점수
export function reviveSoldier(g: Game, t: Soldier, by: number, hp: number): void;
export function smokeBlocks(g: Game, a: Vec3, b: Vec3): boolean;
export function spotSoldier(g: Game, t: Soldier, by: number, secs: number): void;
export function applyBreak(g: Game, r: BreakResult): void;   // 세계 파괴 결과를 boxBroken/collapse 이벤트로 내보내고, 무너진 건물 안 병사에게 피해
```
병사 id 는 `g.soldiers` 배열 순번과 같다. 차량 id 는 `g.vehicles` 순번. 투사체·설치물 id 는 `g.nextId++`.

## sim-combat — `src/sim/soldier.ts`, `src/sim/weapons.ts`
```ts
// soldier.ts
export function updateSoldier(g: Game, s: Soldier, dt: number): void; // 살아 있고 차량 밖일 때: yaw/pitch ← ctl(피치 제한), 자세 전환과 eyeH 보간, 걷기/달리기/정조준 속도(SPEED, 무기 moveMul), 미끄러지기(달리다 앉기), 점프, 중력, collideBody, 물에서 느려짐, 낙하 피해, 발소리·착지 이벤트, anim.walk
// weapons.ts
export function makeWeaponState(pick: WeaponPick, cls: ClassId): WeaponState;
export function updateWeapons(g: Game, s: Soldier, dt: number): void; // 정조준 진행, 교체, 재장전(빈 탄창 더 김), 사격 방식(auto/burst/semi/bolt/pump), 반동(kickP/kickY 를 쌓고 회복), 퍼짐(허리/정조준/이동/연사), 탄 투사체 생성, shot 이벤트, 탄 없으면 dry
export function updateProjectiles(g: Game, dt: number): void;          // 이동·중력·수명, 세계(raycast)·병사(raySoldier)·차량(vehicleHit) 충돌. 총탄: 거리 감쇠 피해, 헤드샷, 벽 관통 없음(ap 는 얇은 나무·유리 관통), 상자 피해(damageBox 소량). 폭발물: explode. impact 이벤트. 근접 탄에 대한 억제 효과는 생략 가능
export function fireOrigin(s: Soldier): Vec3;                          // 눈 위치에서 약간 앞
```
- 총탄은 Placed 중 kind 'cover'(방벽: 폭 params.width, 높이 1.2, 두께 0.3, yaw 방향으로 회전)를 막고 그 hp 를 깎는다.
- 'missile' 이 target ≥ 0 이면 그 차량 쪽으로 꺾는다(초당 2.5rad). 대상 차량의 counterT > 0 이면 target = -1.
- 'thrown' 은 fuse 가 끝나거나(fuse>0), 부딪히면(fuse≤0) `detonateThrown(g, p, at)` 을 부른다(sim-gadgets). 'ugl' 은 부딪히면 variant 가 smoke 면 detonateThrown, 아니면 explode. 'rocket'·'shell' 은 explode.
- 소음기 없는 사격은 쏜 사람의 spotT 를 최소 1.2 초로 (미니맵에 뜸).

## sim-gadgets — `src/sim/gadgets.ts`
```ts
export function makeGadgetState(pick: GadgetPick): GadgetState;
export function updateGadgets(g: Game, s: Soldier, dt: number): void;  // ctl.gadget 엣지로 꺼내기/쓰기, 들고 있을 때 fire 로 사용. 종류별 동작(GadgetKind 주석 참고): 로켓·유탄·투척물 투사체, 대공 조준 고정(lock 이벤트), 수리 토치(앞의 아군 차량 hp 회복, 과열), 설치물(medbag/ammobag/atmine/claymore/breach/beacon/sensor/cover), 드론(조준 지점 위로 날아가 주변 적을 계속 표시), 아드레날린, 제세동기(앞의 쓰러진 아군 즉시 소생). 다 쓰면 무기로 돌아감
export function updatePlaced(g: Game, dt: number): void;              // 설치물 수명·효과: 회복/탄약 보충(heal/resupply 이벤트), 지뢰(적 차량 접근 시 폭발), 클레이모어(앞쪽 부채꼴에 적 보병), 감지기·드론(주변 적 spotSoldier), 비컨(spawnOptions 가 읽음), 방벽(상자가 아니라 Placed 로 남김, 총탄 판정은 sim-combat 이 Placed cover 를 상자처럼 고려하지 않아도 됨), 화염(fire: 범위 지속 피해)
export function detonateBreach(g: Game, s: Soldier): void;
export function detonateThrown(g: Game, p: Projectile, at: Vec3): void; // 투척물·연막 유탄이 터질 때: frag/impact 폭발, smoke → g.smokes, flash → 범위 안에서 보고 있는 병사 blindT, incendiary → Placed 'fire', breach → 그 자리에 Placed 'breach'(차량에 붙으면 attached), sensor → Placed 'sensor'
```

## sim-vehicles — `src/sim/vehicles.ts`
```ts
export function createVehicles(g: Game): void;                         // world.vehicleSpawns 와 SIZES[g.opts.size].vehicles 로 차량 생성 (헬기는 air 패드)
export function updateVehicles(g: Game, dt: number): void;            // 탑승(차량 3.5m 안에서 interactPressed, 빈 좌석 중 운전석 우선), 좌석 이동(ctl.seat), 하차(ctl.exit), 운전(운전석 ctl.mx/mz, 지형 따라 기울기, 상자 충돌, 나무 쓰러뜨리기 → damageBox), 헬기 비행(lift, 기울기, 추락), 포탑(포수 ctl.yaw/pitch 따라 turretTurn 속도로), 좌석 무기 사격(투사체 또는 기관총 탄, vshot 이벤트), 대응책(counter), 불붙음, 파괴 후 잔해·재생성, 들이받기 피해, 탑승자 위치를 좌석 위치로 맞춤
export function seatWorldPos(v: Vehicle, seat: number): Vec3;
export function seatAimDir(v: Vehicle, seat: number): Vec3;           // 그 좌석 무기 방향 (포탑 좌석이면 포탑, 아니면 탑승자 시선)
export function nearestVehicle(g: Game, s: Soldier, maxD: number): Vehicle | null;
export function vehicleHit(g: Game, o: Vec3, d: Vec3, maxT: number, ignore: number): { v: Vehicle; t: number; point: Vec3 } | null;  // 회전한 상자(OBB) 판정
export function enterVehicle(g: Game, s: Soldier, v: Vehicle, seat: number): boolean;
export function exitVehicle(g: Game, s: Soldier): void;
```

## ai — `src/ai/nav.ts`, `src/ai/bots.ts`
```ts
export function initBots(g: Game): void;            // 길찾기 격자 생성 (2m 칸, 상자로 막힌 칸, 문은 열림), 분대 목표 배정
export function updateBots(g: Game, dt: number): void; // 봇마다 ctl 를 채운다 (사람 병사는 건드리지 않음). 인지(0.2~0.3s 간격, 시야각, lineOfSight, smokeBlocks, 표시된 적), 난이도 반응·조준 오차, 거점 목표(분대 단위), 길찾기(A* + 경로 매끈하게, 부서진 상자는 brokenLog 커서로 반영), 엄폐·앉기, 재장전, 수류탄·로켓(차량 상대), 의무(지원병이 쓰러진 아군 소생, 의료 상자), 공병 수리, 차량 탑승·운전·포수(가까운 거점으로), 헬기는 단순 순회 비행. 배치 시 직업 장비 사용
```

## render-world — `src/render/scene.ts`, `src/render/textures.ts`
```ts
export class WorldView {
  constructor(canvas: HTMLCanvasElement, quality: Quality);
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  setWorld(w: World): void;        // 하늘(그라데이션 + 해), 안개, 해·반구 조명, 그림자(quality), 지형 메시(지면 종류 섞인 절차 텍스처, 눈), 도로, 물, 건물(벽·창·바닥·지붕을 상자 종류·재질별 InstancedMesh, 창 유리 반투명), 나무(인스턴스 침엽수), 바위, 컨테이너, 모래주머니, 울타리, 거점 깃대
  update(g: Game, dt: number): void; // brokenLog/collapseLog 커서로 부서진 상자 숨김(인스턴스 행렬 0), 잔해 상자 추가, 그림자 카메라를 카메라 근처로, 물결
  setQuality(q: Quality): void;
  resize(width: number, height: number, dpr: number): void;
  render(): void;                  // renderer.render(scene, camera). autoClear 는 켜 둔다
  dispose(): void;
}
```

## render-actors — `src/render/actors.ts`
```ts
export class ActorsView {
  constructor(scene: THREE.Scene, quality: Quality);
  update(g: Game, dt: number, viewer: number, camera: THREE.Camera): void; // viewer 병사 본인은 1인칭이라 몸을 그리지 않음(차량 3인칭일 땐 차량은 그림). 병사: 부위별 InstancedMesh(헬멧, 머리, 몸통, 조끼, 팔, 다리, 배낭, 총), 진영 위장색, 걷기·달리기·앉기·엎드림·쓰러짐·죽음(넘어진 자세, 몇 초 뒤 사라짐) 절차 애니메이션, 조준 방향으로 상체·총. 차량: 전차·보병전투차·경전술차량·헬기 모델(Group, 포탑·포신 회전, 회전날개, 부서지면 검게 탄 잔해). 투사체 모델(로켓·미사일·유탄·수류탄), 설치물 모델(상자·지뢰·클레이모어·비컨·감지기·방벽·드론)
  dispose(): void;
}
```

## render-viewmodel — `src/render/gunmodel.ts`, `src/render/viewmodel.ts`
```ts
// gunmodel.ts — 1인칭·로드아웃 미리보기 공용. 총구는 -Z 쪽, 단위 m, 원점은 손잡이
export function buildGunModel(weaponId: string, att: Attachments): THREE.Group; // userData.muzzle: Object3D, userData.sight: Object3D(정조준 시 눈이 올 자리), userData.mag: Object3D. 부착물이 실제로 보여야 함(조준경 종류별 모양, 소음기, 총열 길이, 손잡이, 양각대, 레이저, 탄창 크기·드럼)
export function buildGadgetModel(gadgetId: string): THREE.Group;
// viewmodel.ts
export class ViewModel {
  constructor();
  scene: THREE.Scene; camera: THREE.PerspectiveCamera;   // 별도 장면·카메라(시야각 고정 ~55)로 벽에 안 파묻힘
  update(g: Game, s: Soldier, dt: number, look: { dx: number; dy: number }): void; // 무기/장비/부착물 바뀌면 다시 만듦. 팔·손(장갑), 흔들림(sway, look 반대 방향), 걷기 흔들림, 달리기 자세, 정조준 보간(sight 를 화면 중앙으로), 반동 킥, 재장전 동작(탄창 빼고 넣기), 꺼내기, 투척, 총구 섬광(점광원 짧게)
  render(renderer: THREE.WebGLRenderer): void;            // renderer.clearDepth() 후 자기 장면 렌더 (autoClear 건드리지 말고 직접 처리)
  scope(): { active: boolean; zoom: number; reticle: string }; // 정조준이 거의 끝났고 배율 ≥ 3 이면 active (HUD 가 조준경 화면을 그리고, 이때 총 모델은 숨김)
  resize(width: number, height: number): void;
  dispose(): void;
}
```

## render-fx — `src/render/effects.ts`
```ts
export class Effects {
  constructor(scene: THREE.Scene, camera: THREE.Camera, quality: Quality);
  event(e: GameEvent, g: Game, viewer: number): void;  // 3인칭 총구 섬광(viewer 본인 shot 은 생략 — 뷰모델이 함), 예광탄, 탄착(재질별 불꽃·먼지·눈·나무 조각·물보라), 탄흔 데칼, 피격 혈흔 안개(약하게), 폭발(불덩이·연기 기둥·충격파 고리·파편·그을음 데칼·순간 조명), 건물 붕괴 먼지 구름, 상자 파괴 파편, 차량 파괴 불길
  update(g: Game, dt: number): void;                   // 파티클(인스턴스 빌보드, 개수 상한 quality), g.smokes 연막 구름, 불타는 차량 연기, 로켓 연기 꼬리(g.projectiles 중 rocket/missile/ugl), 카메라 주변 눈발
  dispose(): void;
}
```

## hud — `src/ui/hud.ts`, `src/ui/deploy.ts`, `src/ui/hud.css`
```ts
export class Hud {
  constructor(root: HTMLElement, g: Game);   // root 는 게임 화면 위에 덮인 absolute 레이어
  update(g: Game, dt: number, cam: THREE.PerspectiveCamera, view: { w: number; h: number }, scope: { active: boolean; zoom: number; reticle: string }): void;
  // 상단 나침반(방위, 거점·표시된 적 방향), 상단 가운데 거점 상태와 티켓, 왼쪽 위 미니맵(회전, 아군·분대·표시된 적·거점·차량), 분대 목록, 오른쪽 위 사살 기록, 오른쪽 아래 무기 이름·탄약·사격 방식·장비 칸, 체력, 가운데 조준선(퍼짐 반영, 허리 사격만), 피격 표시(X, 사살 시 빨강, 헤드샷), 피격 방향 호, 점수 팝업, 3D 위치 표시(거점 글자와 거리, 표시된 적 빨간 마름모, 아군 이름, 분대원 초록), 점령 진행 막대, 상호작용 안내, 쓰러짐 화면(출혈 시간, 포기 버튼 → onGiveUp), 차량 HUD(체력, 무기, 좌석, 속도), 조준 고정 경고, 조준경 화면(scope.active), 낮은 체력·섬광 화면 효과, 상단 오른쪽 버튼(점수판·지도·일시 정지 → onButton)
  event(e: GameEvent, g: Game): void;
  showScoreboard(on: boolean): void;
  toggleMap(): void;
  onButton: (b: 'scoreboard' | 'map' | 'pause') => void;
  onGiveUp: () => void;
  dispose(): void;
}
export class DeployScreen {
  constructor(root: HTMLElement, g: Game, profile: Profile);
  // 전장 지도(캔버스, 지형·건물·거점 색), 출현 지점 고르기(spawnOptions), 병과 4개 탭, 그 병과 로드아웃 요약(무기·부착물·장비), '로드아웃 편집'(onEdit), '배치'(onDeploy), '나가기'(onQuit)
  onDeploy: (opt: SpawnOption, cls: ClassId) => void;
  onEdit: (cls: ClassId) => void;
  onQuit: () => void;
  open(): void; close(): void; isOpen(): boolean;
  update(g: Game, dt: number): void;   // 출현 지점 목록 갱신, 재배치 대기 시간
  refresh(): void;                      // 로드아웃 편집 뒤 다시 그리기
  dispose(): void;
}
```

## menus — `src/ui/app.ts`, `src/ui/loadout.ts`, `src/ui/menus.css`
```ts
// app.ts
export function startApp(root: HTMLElement): void;  // 해시 라우터(#home #play #loadout #settings #help #battle). 기기 뒤로 가기 동작. 홈(배경 3D 장면 또는 그림 + 큰 제목, 바로 시작, 전투 설정, 로드아웃, 설정, 도움말, 계급·전적), 전투 설정(지도 카드, 규모, 난이도, 진영), 설정(그래픽 품질, 감도, 정조준 감도, 시야각, Y 반전, 음량, 조준 보정, FPS 표시, 정조준 방식), 도움말(조작·규칙). #battle 은 startBattle 호출, 끝나면 결과 화면(BattleResult) → 홈
// loadout.ts
export function openLoadoutEditor(host: HTMLElement, profile: Profile, cls: ClassId, onClose: () => void): void;
  // host 위에 덮는 전체 화면 편집기(전투 중 배치 화면에서도 씀). 병과 탭, 칸(주무기·보조무기·장비1·장비2·투척), 무기 고르기(분류 탭, 무기 카드, 수치 막대), 무기 커스텀(가운데 3D 미리보기 buildGunModel 을 회전, 슬롯 7개를 둘러 배치, 부착물 고르면 수치 막대에 증감 표시 +초록/-빨강, 장단점), 장비 고르기와 변형 커스텀. 바뀌면 saveProfile.
```
`src/app/battle.ts` 가 `export function startBattle(root: HTMLElement, profile: Profile, onExit: (r: BattleResult | null) => void): () => void` 를 제공한다(통합 단계에서 작성). menus 는 이것을 import 해서 쓴다.

## input + audio — `src/input/input.ts`, `src/input/touch.css`, `src/audio/audio.ts`
```ts
export interface InputFrame {
  mx: number; mz: number;                // 이동 -1..1 (z 앞 +)
  lookX: number; lookY: number;          // 이번 프레임 시선 변화(rad), 감도 반영. lookX + = 오른쪽으로 돎(yaw 감소), lookY + = 위
  fire: boolean; ads: boolean; sprint: boolean;
  jump: boolean; crouch: boolean; prone: boolean;   // 엣지 (crouch/prone 은 토글 신호)
  reload: boolean; swap: boolean; slot: -1 | 0 | 1; gadget: -1 | 0 | 1 | 2;
  interact: boolean;                     // 누르고 있음 (E / 터치 버튼)
  interactEdge: boolean;
  spot: boolean; seat: number; fireMode: boolean; counter: boolean;
  lift: number;                          // 헬기: Space +1, Ctrl/C -1
  scoreboard: boolean;                   // 누르고 있음 (Tab)
  map: boolean; pause: boolean;          // 엣지
}
export class Input {
  constructor(el: HTMLElement, settings: Settings);  // el = 게임 루트. PC: 클릭으로 포인터 잠금, 마우스 이동 → 시선. 터치: 화면 위 조작 레이어를 el 안에 직접 만든다
  readonly touch: boolean;
  poll(ads: boolean, zoom: number): InputFrame;       // 프레임마다 한 번. 정조준 감도·배율 반영
  setMode(m: 'infantry' | 'vehicle' | 'heli' | 'hidden'): void;  // 터치 버튼 구성 바꾸기
  setContext(c: { interact: string | null; gadgets: [string, string, string] }): void; // 터치 상호작용 버튼 글자, 장비 버튼 글자
  lock(): void; readonly locked: boolean;
  setSettings(s: Settings): void;
  dispose(): void;
}
// PC 키: WASD, 마우스, 좌클릭 사격, 우클릭 정조준, Shift 달리기, Space 점프, C 앉기(달리다 누르면 미끄러지기), Z 엎드리기, R 재장전, 1/2 무기, 3/4 장비, G 투척, E 상호작용·탑승·하차, Q 표시, F1~F4 좌석, B 사격 방식, X 대응책, Tab 점수판, M 지도, Esc 일시 정지
// 터치: 왼쪽 아래 이동 스틱(끝까지 위로 = 달리기), 오른쪽 절반 끌기 = 시선, 사격 버튼(누른 채 끌어도 시선), 정조준, 재장전, 점프, 앉기(길게 = 엎드리기), 투척, 장비1, 장비2, 무기 바꾸기, 상호작용(상황일 때만), 표시. 차량 모드는 가속·후진·사격·좌석·하차·대응책, 헬기는 상승·하강

export class AudioSys {
  constructor();
  unlock(): void; setVolume(v: number): void;
  listener(pos: Vec3, yaw: number, pitch: number): void;
  event(e: GameEvent, g: Game, viewer: number): void;   // 총성(무기별 GunSound, 소음기, 거리별 저역 통과와 메아리, 내 총은 크고 선명), 탄착, 피격음, 헤드샷 띵, 사살 확인음, 폭발(거리 지연 없음 가능), 재장전 철컥, 빈 탄창, 발소리(재질), 차량 사격, 점령 알림, 건물 붕괴
  update(g: Game, dt: number, viewer: number): void;   // 차량 엔진, 헬기 날개, 바람, 먼 교전 배경음
  ui(kind: 'click' | 'hover' | 'equip' | 'deploy'): void;
  dispose(): void;
}
```

## integration — `src/app/battle.ts`, `src/main.ts` (마지막 단계)
게임 루프(고정 1/60, 최대 5스텝), 입력 → 사람 병사 ctl, 카메라(1인칭 눈 위치 + 반동, 정조준 시 시야각 = fov/zoom 근사, 차량은 3인칭 추적·포수 시점), 이벤트를 Effects·AudioSys·Hud 로 전달 후 비움, 배치 화면, 일시 정지, 끝 화면, 품질 설정.
