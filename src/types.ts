// ═══════════════════════════════════════════════════════════════════════════
// WARLINE 공통 규약 (모든 모듈이 공유하는 타입). 리드 외에는 수정 금지.
// 단위: 미터, 초, 라디안(별도 표기 없으면). 좌표: Three.js와 같은 y-위, x-동, z-남.
// 시선: yaw 0 = -Z(북) 바라봄, yaw가 커지면 왼쪽으로 돈다(+Y 축 기준 반시계).
//       pitch 양수 = 위를 봄. 방향 벡터는 src/math.ts 의 dirFrom(yaw, pitch).
// 지도: 정사각형, x와 z 모두 0..size. 높이 y는 지형 높이 기준.
// ═══════════════════════════════════════════════════════════════════════════

export interface Vec3 { x: number; y: number; z: number }
export type Team = 0 | 1;
export type Side = 'us' | 'ru';
export type ClassId = 'assault' | 'engineer' | 'support' | 'recon';
export type Diff = 'easy' | 'normal' | 'hard';
/** small = 16v16, medium = 32v32(기본), large = 64v64 */
export type SizeId = 'small' | 'medium' | 'large';
export type Quality = 'low' | 'medium' | 'high';

// ───────────────────────── 무기 ─────────────────────────

export type WeaponCat = 'ar' | 'carbine' | 'smg' | 'lmg' | 'dmr' | 'sniper' | 'shotgun' | 'pistol';
export type SlotId = 'optic' | 'muzzle' | 'barrel' | 'underbarrel' | 'magazine' | 'ammo' | 'stock';
export const SLOT_IDS: SlotId[] = ['optic', 'muzzle', 'barrel', 'underbarrel', 'magazine', 'ammo', 'stock'];
export type FireMode = 'auto' | 'burst' | 'semi' | 'bolt' | 'pump';
/** 슬롯별 장착한 부착물 id. 비어 있으면 그 무기의 기본값(slots[slot][0]) */
export type Attachments = Partial<Record<SlotId, string>>;

/** 총 모양을 만드는 매개변수 (render/gunmodel.ts 가 읽는다) */
export interface GunModelSpec {
  body: 'rifle' | 'bullpup' | 'smg' | 'lmg' | 'dmr' | 'sniper' | 'shotgun' | 'pistol';
  /** 몸통(리시버) 길이 m: 권총 0.2 .. 저격 0.75 */
  length: number;
  /** 기본 총열 길이 m */
  barrel: number;
  mag: 'box' | 'curved' | 'drum' | 'tube' | 'pistol' | 'top';
  /** 주 색상, 보조 색상 (0xRRGGBB) */
  color: number;
  accent: number;
  /** 위쪽 레일이 있나 (조준경 달 자리) */
  rail: boolean;
}

/** 합성 총소리 매개변수 (audio/audio.ts 가 읽는다) */
export interface GunSound { kind: 'rifle' | 'carbine' | 'smg' | 'lmg' | 'dmr' | 'sniper' | 'shotgun' | 'pistol'; pitch: number; punch: number }

export interface WeaponDef {
  id: string; name: string; cat: WeaponCat; desc: string;
  modes: FireMode[]; burst?: number;
  rpm: number;
  /** 피해: rangeNear(m)까지 dmgNear, rangeFar(m)부터 dmgFar, 사이는 선형 */
  dmgNear: number; dmgFar: number; rangeNear: number; rangeFar: number;
  headMul: number;
  /** 탄속 m/s (탄은 중력을 받는 투사체) */
  velocity: number;
  pellets?: number;
  mag: number; reserve: number;
  reload: number; reloadEmpty: number;
  adsTime: number;
  /** 퍼짐(원뿔 반각, 도): 허리 사격, 정조준, 이동 중 추가 */
  hipSpread: number; adsSpread: number; moveSpread: number;
  /** 연사 시 늘어나는 퍼짐(도/발)과 최대치 */
  spreadPerShot: number; spreadMax: number;
  /** 반동(도/발): 수직, 수평(±무작위), 첫 발 배율, 회복 속도(도/초) */
  recoilV: number; recoilH: number; firstShot: number; recoilRecover: number;
  /** 들고 있을 때 이동 속도 배율 */
  moveMul: number;
  /** 무기 교체(꺼내기) 시간 s */
  swap: number;
  /** 슬롯별로 달 수 있는 부착물 id 목록. 첫 번째가 기본값 */
  slots: Partial<Record<SlotId, string[]>>;
  model: GunModelSpec; sound: GunSound;
}

/** 부착물 수치 변화: 모두 곱셈 배율(기본 1). magAdd 만 덧셈 */
export interface StatMods {
  dmg?: number; range?: number; velocity?: number;
  recoilV?: number; recoilH?: number; firstShot?: number; recover?: number;
  adsTime?: number; hipSpread?: number; adsSpread?: number; moveSpread?: number; spreadPerShot?: number;
  moveMul?: number; reload?: number; swap?: number; headMul?: number; sway?: number;
  mag?: number; magAdd?: number;
}

export interface AttachmentDef {
  id: string; slot: SlotId; name: string; desc: string;
  mods: StatMods;
  /** 조준경 배율 (1 = 가늠자/도트) */
  zoom?: number;
  reticle?: 'iron' | 'dot' | 'holo' | 'cross' | 'mil' | 'chevron';
  suppressed?: boolean; laser?: boolean; flashlight?: boolean; bipod?: boolean;
  /** 탄 종류: ap 는 차량·엄폐물 관통 피해 증가, hp 는 보병 근거리 피해 증가, sub 는 소음기와 함께 쓰면 미니맵에 안 뜸 */
  ammoKind?: 'fmj' | 'hp' | 'ap' | 'sub' | 'tracer';
  /** UI에 보여 줄 장단점 한 줄씩 (한국어) */
  pros: string[]; cons: string[];
  /** 모양 힌트 */
  model?: { len?: number; size?: number; color?: number };
}

/** computeStats() 의 결과: 부착물을 반영한 실제 수치 */
export interface WeaponStats {
  id: string; name: string; cat: WeaponCat;
  modes: FireMode[]; burst: number; rpm: number;
  dmgNear: number; dmgFar: number; rangeNear: number; rangeFar: number; headMul: number;
  velocity: number; pellets: number;
  mag: number; reserve: number; reload: number; reloadEmpty: number; adsTime: number; swap: number;
  hipSpread: number; adsSpread: number; moveSpread: number; spreadPerShot: number; spreadMax: number;
  recoilV: number; recoilH: number; firstShot: number; recoilRecover: number;
  moveMul: number; sway: number;
  zoom: number; reticle: 'iron' | 'dot' | 'holo' | 'cross' | 'mil' | 'chevron';
  suppressed: boolean; laser: boolean; flashlight: boolean; bipod: boolean;
  ammoKind: 'fmj' | 'hp' | 'ap' | 'sub' | 'tracer';
}

// ───────────────────────── 장비 ─────────────────────────

export type GadgetKind =
  | 'rocket'      // 어깨 발사 로켓 (공병). params: velocity, dmgVehicle, dmgInfantry, radius, wallDmg
  | 'aa'          // 대공 유도 미사일 (공병). params: lockTime, dmgVehicle, velocity, range
  | 'repair'      // 수리 토치, 들고 쏘듯 사용 (공병). params: rate(hp/s), heat(과열까지 s), range
  | 'atmine'      // 대전차 지뢰 (공병). params: dmgVehicle, radius
  | 'ugl'         // 총열 아래 유탄 (돌격). params: velocity, dmg, radius, wallDmg, smoke(0/1)
  | 'stim'        // 아드레날린 (돌격). params: heal, speedMul, duration
  | 'breach'      // 접착 폭약, 던지고 다시 눌러 터뜨림 (돌격). params: dmg, radius, wallDmg, dmgVehicle
  | 'medbag'      // 의료 상자 설치 (지원). params: healPerSec, radius, life
  | 'ammobag'     // 탄약 상자 설치 (지원). params: magsPerSec, radius, life
  | 'defib'       // 제세동기, 쓰러진 아군 즉시 소생 (지원). params: reviveTime, hp, range
  | 'cover'       // 이동식 방벽 설치 (지원). params: width, hp
  | 'drone'       // 정찰 드론 (정찰). params: duration, spotRadius, speed
  | 'sensor'      // 동작 감지기 (정찰). params: radius, life
  | 'beacon'      // 분대 스폰 비컨 (정찰). params: life
  | 'claymore'    // 클레이모어 (정찰). params: dmg, radius, range
  | 'frag' | 'smoke' | 'flash' | 'incendiary' | 'impact'; // 투척: params dmg, radius, fuse, wallDmg / smoke: radius, life / flash: radius, blind / incendiary: dps, radius, life

export interface GadgetVariant { id: string; name: string; desc: string; params: Record<string, number> }
export interface GadgetDef {
  id: string; name: string; kind: GadgetKind; desc: string;
  slot: 'gadget' | 'throwable';
  classes: ClassId[];
  /** 한 생애 동안 쓸 수 있는 횟수 (탄약 상자로 보충) */
  uses: number;
  /** 다시 쓸 수 있을 때까지 s */
  cooldown: number;
  /** 커스텀 선택지 (1개 이상). 첫 번째가 기본값 */
  variants: GadgetVariant[];
  /** HUD 아이콘 글자 (한두 글자) */
  icon: string;
}

export interface ClassDef {
  id: ClassId; name: string; role: string; desc: string;
  /** 병과 특성 한 줄 */
  trait: string;
  icon: string;
  /** 숙련 무기 분류: 이 분류 주무기를 들면 정조준과 반동이 조금 좋아진다 */
  signature: WeaponCat[];
  /** 장비 칸에 넣을 수 있는 장비 id */
  gadgets: string[];
  throwables: string[];
  hp: number;
}

export interface WeaponPick { id: string; att: Attachments }
export interface GadgetPick { id: string; variant: string }
export interface Loadout { primary: WeaponPick; secondary: WeaponPick; gadget1: GadgetPick; gadget2: GadgetPick; throwable: GadgetPick }

export interface Settings {
  quality: Quality;
  /** 마우스·터치 감도 배율 (0.2..3, 기본 1) */
  sens: number;
  /** 정조준 시 감도 배율 (0.4..1.5, 기본 0.85) */
  adsSens: number;
  /** 시야각(수직, 도) 60..95, 기본 75 */
  fov: number;
  invertY: boolean;
  volume: number;
  /** 터치 조준 보정 0..1 */
  aimAssist: number;
  showFps: boolean;
  /** PC 정조준: true = 누르고 있기, false = 눌러서 켜고 끄기 */
  holdAds: boolean;
}

export interface Profile {
  version: 3;
  side: Side; diff: Diff; size: SizeId; map: string; cls: ClassId;
  loadouts: Record<ClassId, Loadout>;
  settings: Settings;
  xp: number;
  stats: { games: number; wins: number; kills: number; deaths: number; revives: number; caps: number; heads: number };
  seenHelp: boolean;
}

// ───────────────────────── 차량 ─────────────────────────

export type VehicleType = 'mbt' | 'ifv' | 'ltv' | 'heli';
export interface VWeaponDef {
  id: string; name: string;
  kind: 'cannon' | 'autocannon' | 'mg' | 'rockets' | 'atgm';
  rpm: number; dmg: number; dmgVehicle: number; radius: number; wallDmg: number;
  velocity: number; mag: number; reload: number; spread: number;
}
export interface SeatDef {
  name: string;
  /** 이 좌석이 쓰는 차량 무기 id (없으면 null) */
  weapon: string | null;
  /** 차체 기준 좌석 위치 (x 오른쪽, y 위, z 앞이 -) */
  offset: Vec3;
  /** 포탑을 돌리는 좌석인가 (true면 이 좌석의 yaw/pitch가 포탑을 움직인다) */
  turret: boolean;
  /** 몸이 밖으로 드러나 총에 맞는 좌석 */
  exposed: boolean;
}
export interface VehicleDef {
  type: VehicleType; name: string; short: string; desc: string;
  hp: number; speed: number; reverse: number; accel: number;
  /** 차체 선회 속도 rad/s, 포탑 선회 속도 rad/s */
  turn: number; turretTurn: number;
  air: boolean;
  /** 크기: x 폭, y 높이, z 길이 */
  size: Vec3;
  /** 피해 배율 (낮을수록 단단함) */
  armor: { front: number; side: number; rear: number; top: number };
  seats: SeatDef[];
  respawn: number;
  /** 대응책: 지상 = 연막, 헬기 = 플레어 */
  counter: 'smoke' | 'flare';
}

// ───────────────────────── 지도·규모 ─────────────────────────

export interface MapDef {
  id: string; name: string; place: string; desc: string;
  seed: number;
  /** 한 변 길이 m (420..700) */
  size: number;
  theme: 'snow' | 'tundra' | 'industrial';
  water: 'none' | 'coast' | 'river';
  /** 마을 밀도 0..1, 숲 0..1, 언덕 0..1 */
  town: number; forest: number; hills: number;
  time: 'day' | 'dusk' | 'overcast';
}
export interface SizeDef { id: SizeId; name: string; perTeam: number; tickets: number; flags: number; vehicles: VehicleType[] }
export interface DiffDef { id: Diff; name: string; desc: string; react: number; aimErr: number; dmgTaken: number; dmgDealt: number }
export interface FactionDef { id: Side; name: string; army: string; short: string; color: number; css: string; camo: [number, number, number] }

// ───────────────────────── 세계 ─────────────────────────

export type BoxKind = 'wall' | 'window' | 'floor' | 'roof' | 'stair' | 'prop' | 'rock' | 'sandbag' | 'container' | 'tree' | 'fence' | 'rubble' | 'cover' | 'bridge';
export type Mat = 'concrete' | 'brick' | 'wood' | 'metal' | 'glass' | 'rock' | 'sand' | 'foliage';
export interface Box {
  id: number; kind: BoxKind; mat: Mat;
  /** 축 정렬 상자 (월드 좌표) */
  min: Vec3; max: Vec3;
  hp: number; maxHp: number; destructible: boolean; alive: boolean;
  /** 속한 건물 id (-1 = 없음) */
  building: number;
  color: number;
  /** 움직임을 막나 */
  solid: boolean;
  /** 시야를 막나 (유리, 울타리는 false) */
  opaque: boolean;
}
export interface Building {
  id: number; x: number; z: number; w: number; d: number;
  /** 바닥 높이(지면) */
  y: number;
  floors: number; floorH: number;
  boxes: number[];
  wallCount: number; wallsAlive: number; collapsed: boolean;
  style: 'house' | 'apartment' | 'warehouse' | 'office' | 'shed' | 'tower';
  color: number; roofColor: number;
}
export interface FlagSite { id: string; name: string; x: number; z: number; r: number }
export interface Road { pts: [number, number][]; w: number }
export interface Tree { x: number; z: number; y: number; h: number; r: number; kind: 'pine' | 'birch' | 'dead'; box: number }
/** 0 눈, 1 툰드라 풀, 2 흙·진흙, 3 아스팔트, 4 콘크리트, 5 자갈·모래 */
export type GroundType = 0 | 1 | 2 | 3 | 4 | 5;
export interface World {
  def: MapDef; size: number;
  /** 높이장: (hfN+1)^2 꼭짓점, 꼭짓점 (i, j) 는 x = i*hfCell, z = j*hfCell */
  hfN: number; hfCell: number; heights: Float32Array;
  /** hfN*hfN 칸의 지면 종류 */
  ground: Uint8Array;
  /** 수면 높이 (물이 없으면 -1e9) */
  water: number;
  boxes: Box[]; buildings: Building[]; trees: Tree[]; roads: Road[];
  flags: FlagSite[];
  hq: [Vec3, Vec3];
  /** 차량 출발 자리 (air = 헬기 패드) */
  vehicleSpawns: { team: Team; pos: Vec3; yaw: number; air: boolean }[];
  /** 부서진 상자 id 를 계속 덧붙인다 (소비자는 각자 커서를 들고 읽는다) */
  brokenLog: number[];
  /** 무너진 건물 id 를 계속 덧붙인다 */
  collapseLog: number[];
  /** world 모듈 내부용 (공간 색인 등). 다른 모듈은 건드리지 않는다 */
  index: unknown;
}
export interface RayHit {
  t: number; point: Vec3; normal: Vec3;
  /** 상자 id, -1 = 지형, -2 = 물 */
  box: number;
  mat: Mat | 'snow' | 'dirt' | 'water';
}
export interface BreakResult { broken: number[]; collapsed: number[] }

// ───────────────────────── 전투 상태 ─────────────────────────

export type Stance = 'stand' | 'crouch' | 'prone';
export type LifeState = 'alive' | 'down' | 'dead';

/**
 * 한 병사의 조작 의도. 사람은 입력에서, 봇은 ai 에서 채운다. 시뮬레이션은 둘을 똑같이 다룬다.
 * (엣지) 표시 항목은 한 번 누른 신호: 소비한 모듈이 false / -1 로 되돌린다.
 */
export interface Controls {
  /** 로컬 이동 의도: x 오른쪽 +, z 앞 +, 크기 ≤ 1. 차량: z 가속/후진, x 조향. 헬기: z 앞뒤 기울임, x 좌우 */
  mx: number; mz: number;
  /** 원하는 절대 시선 각 (보병 시선, 포탑·카메라 조준). sim 이 pitch 를 ±1.45 로 자른다 */
  yaw: number; pitch: number;
  fire: boolean; ads: boolean; sprint: boolean;
  /** (엣지) 점프 */
  jump: boolean;
  /** 원하는 자세 (입력 층이 토글을 풀어서 넣는다) */
  stance: Stance;
  /** (엣지) */ reload: boolean;
  /** (엣지) 무기 칸으로 바꾸기: 0 주무기, 1 보조무기 */
  switchTo: -1 | 0 | 1;
  /** (엣지) 장비 꺼내기/쓰기: 0 장비1, 1 장비2, 2 투척 */
  gadget: -1 | 0 | 1 | 2;
  /** 누르고 있음: 소생, 탑승, 줍기 */
  interact: boolean;
  /** (엣지) 적 표시 */ spot: boolean;
  /** (엣지) 차량 안에서 옮겨 앉을 좌석 (-1 = 없음) */
  seat: number;
  /** (엣지) 차량에서 내리기 */ exit: boolean;
  /** (엣지) 사격 방식 바꾸기 */ fireMode: boolean;
  /** 헬기 상승(+)/하강(-) -1..1 */
  lift: number;
  /** (엣지) 연막·플레어 */ counter: boolean;
}

export interface WeaponState {
  id: string; att: Attachments; st: WeaponStats;
  mag: number; reserve: number;
  /** 재장전 남은 시간 (0 = 재장전 아님), 전체 시간 */
  reloadT: number; reloadTotal: number;
  /** 다음 발까지 남은 시간 */
  fireT: number;
  burstLeft: number; mode: FireMode;
  /** 연사 퍼짐 누적(도) */
  bloom: number;
  /** 지금 반동으로 들린 시선 (라디안, 시점이 더한다) */
  kickP: number; kickY: number;
  /** 연속 발사 수 (첫 발 판정) */
  shots: number;
  triggerHeld: boolean;
}
export interface GadgetState {
  id: string; variant: string; kind: GadgetKind;
  uses: number; maxUses: number; cd: number;
  params: Record<string, number>;
  /** 진행 값 (조준 고정 진행도, 수리 과열, 접착 폭약 설치 여부 등) */
  active: number;
}

export interface Soldier {
  id: number; team: Team; squad: number; name: string; cls: ClassId; isPlayer: boolean;
  /** 발 위치 */
  pos: Vec3; vel: Vec3; yaw: number; pitch: number;
  stance: Stance;
  /** 지금 눈높이 (자세 사이를 부드럽게 옮겨 간다) */
  eyeH: number;
  sprinting: boolean;
  /** 미끄러지기 남은 시간 s */
  sliding: number;
  onGround: boolean;
  hp: number; maxHp: number; state: LifeState;
  /** 쓰러진 뒤 출혈 남은 시간, 죽은 뒤 지난 시간, 다시 나올 때까지 남은 시간, 출현 보호 */
  downT: number; deadT: number; respawnT: number; protect: number;
  loadout: Loadout;
  weapons: [WeaponState, WeaponState]; cur: 0 | 1;
  held: 'weapon' | 'gadget'; heldGadget: 0 | 1 | 2;
  gadgets: [GadgetState, GadgetState, GadgetState];
  /** 정조준 진행 0..1, 무기 꺼내기 남은 시간 */
  ads: number; swapT: number;
  /** 탄 차량 id (-1 = 없음), 좌석 */
  vehicle: number; seat: number;
  lastHurtT: number; lastHurtBy: number;
  /** 마지막으로 맞은 방향 (월드 yaw, 공격자 쪽) */
  lastHurtYaw: number;
  /** 적에게 표시된 남은 시간 */
  spotT: number;
  /** 소생 중인 대상 id (-1), 진행 0..1 */
  reviving: number; reviveProg: number;
  /** 섬광 실명 남은 시간, 아드레날린 남은 시간 */
  blindT: number; stimT: number;
  /** 상호작용 누르기 엣지 (sim-core 가 매 스텝 계산) */
  prevInteract: boolean; interactPressed: boolean;
  kills: number; deaths: number; assists: number; revives: number; score: number; caps: number; vkills: number; heads: number;
  /** 이번 생에서 나에게 피해를 준 병사 id → 피해량 (도움 판정) */
  dmgFrom: Record<number, number>;
  ctl: Controls;
  /** ai 모듈 전용 */
  ai: any;
  /** 렌더 보조: sim 이 갱신한다 */
  anim: { walk: number; fireT: number; reloadT: number; throwT: number; hitT: number };
  /** 발소리 누적 */
  stepAcc: number;
}

export type ProjKind = 'bullet' | 'pellet' | 'rocket' | 'missile' | 'shell' | 'ugl' | 'thrown';
export interface Projectile {
  id: number; kind: ProjKind; alive: boolean;
  pos: Vec3; prev: Vec3; vel: Vec3;
  owner: number; team: Team;
  /** 무기 id 또는 장비 id 또는 차량 무기 id */
  weapon: string; variant: string;
  dmg: number; dmgFar: number; rangeNear: number; rangeFar: number; headMul: number;
  /** 날아간 거리 m, 남은 수명 s, 중력 배율 */
  dist: number; life: number; gravity: number;
  /** 폭발 반경 (0 = 폭발 없음), 차량 피해, 벽 피해 */
  radius: number; dmgVehicle: number; wallDmg: number;
  tracer: boolean;
  /** 투척물 신관 남은 s (0 이하 = 충돌 시 폭발), 튕기나 */
  fuse: number; bounce: boolean;
  /** 유도 대상 차량 id (-1) */
  target: number;
  ammoKind: string;
}

export type PlacedKind = 'medbag' | 'ammobag' | 'atmine' | 'claymore' | 'breach' | 'beacon' | 'sensor' | 'cover' | 'drone' | 'fire';
export interface Placed {
  id: number; kind: PlacedKind; alive: boolean;
  team: Team; owner: number;
  pos: Vec3; yaw: number; vel: Vec3;
  life: number; hp: number;
  params: Record<string, number>;
  /** 붙은 차량 id (-1) */
  attached: number;
}

export interface Vehicle {
  id: number; type: VehicleType; team: Team; alive: boolean;
  pos: Vec3; vel: Vec3;
  /** 차체 방향 (yaw 규약은 시선과 같음), 지형에 맞춘 기울기 */
  yaw: number; pitch: number; roll: number;
  /** 포탑 yaw (차체 기준), 포 pitch */
  tYaw: number; tPitch: number;
  /** 앞으로 가는 속도 (부호 있음) */
  speed: number;
  hp: number; maxHp: number;
  /** 좌석별 병사 id (-1 = 빈 좌석) */
  seats: number[];
  /** 좌석별 무기 상태 */
  wpn: { mag: number; reloadT: number; fireT: number; heat: number }[];
  respawnT: number; wreckT: number;
  spawn: { pos: Vec3; yaw: number };
  counterCd: number; counterT: number;
  burning: boolean; lastHurtBy: number; spotT: number;
  /** 조준 고정 경고 (0..1) */
  lockWarn: number;
  ai: any;
}

export interface Flag {
  id: string; name: string; pos: Vec3; r: number;
  owner: Team | -1;
  /** -1..1: +1 = 0팀 완전 점령, -1 = 1팀 완전 점령 */
  prog: number;
  n: [number, number];
  contested: boolean;
}

export interface Smoke { pos: Vec3; r: number; life: number; max: number }

export type GameEvent =
  | { k: 'shot'; s: number; weapon: string; pos: Vec3; dir: Vec3; suppressed: boolean; tracer: boolean }
  | { k: 'vshot'; v: number; seat: number; weapon: string; pos: Vec3; dir: Vec3 }
  | { k: 'impact'; pos: Vec3; normal: Vec3; mat: string; big: boolean }
  | { k: 'hit'; target: number; by: number; dmg: number; head: boolean; pos: Vec3; kill: boolean }
  | { k: 'vhit'; v: number; by: number; dmg: number; pos: Vec3; kill: boolean }
  | { k: 'explosion'; pos: Vec3; r: number; kind: 'grenade' | 'rocket' | 'shell' | 'vehicle' | 'mine' | 'c4' | 'ugl' }
  | { k: 'down'; s: number; by: number; weapon: string; head: boolean }
  | { k: 'kill'; s: number; by: number; weapon: string; head: boolean }
  | { k: 'revive'; s: number; by: number }
  | { k: 'spawn'; s: number }
  | { k: 'boxBroken'; box: number; pos: Vec3; mat: Mat }
  | { k: 'collapse'; building: number; pos: Vec3 }
  | { k: 'flag'; flag: string; team: Team | -1; what: 'captured' | 'neutralized' | 'losing' }
  | { k: 'score'; s: number; pts: number; text: string }
  | { k: 'vdestroyed'; v: number; by: number }
  | { k: 'venter'; s: number; v: number; seat: number }
  | { k: 'vexit'; s: number; v: number }
  | { k: 'reload'; s: number; empty: boolean }
  | { k: 'dry'; s: number }
  | { k: 'swap'; s: number }
  | { k: 'throw'; s: number; gadget: string }
  | { k: 'gadget'; s: number; gadget: string; pos: Vec3 }
  | { k: 'placed'; p: number }
  | { k: 'spot'; target: number; by: number; vehicle: boolean }
  | { k: 'step'; s: number; pos: Vec3; mat: string; sprint: boolean }
  | { k: 'jump'; s: number }
  | { k: 'land'; s: number; hard: boolean }
  | { k: 'heal'; s: number }
  | { k: 'resupply'; s: number }
  | { k: 'lock'; v: number; by: number; done: boolean }
  | { k: 'counter'; v: number }
  | { k: 'msg'; text: string; tone: 'good' | 'bad' | 'info' }
  | { k: 'over'; winner: Team };

export interface SpawnOption {
  kind: 'hq' | 'flag' | 'squad' | 'beacon' | 'vehicle';
  label: string; pos: Vec3;
  /** flag 순번 / 병사 id / 설치물 id / 차량 id */
  ref: number;
  ok: boolean;
}

export interface GameOpts { map: MapDef; size: SizeId; diff: Diff; side: Side; loadouts: Record<ClassId, Loadout>; playerCls: ClassId; seed?: number }

export interface Game {
  opts: GameOpts; world: World;
  time: number; limit: number;
  tickets: [number, number]; maxTickets: number;
  soldiers: Soldier[]; vehicles: Vehicle[]; projectiles: Projectile[]; placed: Placed[]; smokes: Smoke[]; flags: Flag[];
  /** 사람이 조종하는 병사 id (언제나 0팀) */
  player: number;
  /** 사람이 배치 화면을 봐야 하나 */
  playerNeedsDeploy: boolean;
  events: GameEvent[];
  over: null | { winner: Team; reason: string };
  /** 0팀, 1팀의 진영 */
  sides: [Side, Side];
  seed: number; nextId: number;
}

export interface BattleResult {
  win: boolean; score: number; kills: number; deaths: number; assists: number; revives: number; caps: number; heads: number;
  xp: number; minutes: number; reason: string;
}
