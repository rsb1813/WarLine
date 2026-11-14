import type { ClassId, Diff, Kit, MapDef, Side, SizeId, Team, VehicleType, WeaponStats } from './defs';
import type { Nav } from './nav';
import type { World } from './grid';

/** 한 프레임의 조작. 플레이어는 입력 장치가, 봇은 두뇌가 채운다. 끝이 E로 끝나는 것은 누른 순간만 참 */
export interface Ctl {
  mx: number;
  my: number;
  aim: number;
  tx: number;
  ty: number;
  fire: boolean;
  fire2: boolean;
  ads: boolean;
  sprint: boolean;
  crouch: boolean;
  interact: boolean;
  reloadE: boolean;
  primaryE: boolean;
  useAE: boolean;
  useBE: boolean;
  grenadeE: boolean;
  interactE: boolean;
  seatE: boolean;
  spotE: boolean;
  counterE: boolean;
}

export const newCtl = (): Ctl => ({
  mx: 0, my: 0, aim: 0, tx: 0, ty: 0, fire: false, fire2: false, ads: false, sprint: false, crouch: false, interact: false,
  reloadE: false, primaryE: false, useAE: false, useBE: false, grenadeE: false, interactE: false, seatE: false, spotE: false, counterE: false,
});

export interface GadgetState { ammo: number; cd: number }

export interface Brain {
  think: number;
  target: number;
  tveh: number;
  react: number;
  err: number;
  burst: number;
  strafe: number;
  strafeT: number;
  coverX: number;
  coverY: number;
  coverT: number;
  goal: number;
  wx: number;
  wy: number;
  wanderT: number;
  stuckT: number;
  lx: number;
  ly: number;
  jitterT: number;
  jx: number;
  jy: number;
  nadeT: number;
  gadgetT: number;
  lastX: number;
  lastY: number;
  lastT: number;
  orbit: number;
  ride: number;
  skill: { react: number; err: number };
}

export interface Soldier {
  id: number;
  team: Team;
  squad: number;
  slot: number;
  name: string;
  bot: boolean;
  cls: ClassId;
  kit: Kit;
  ws: WeaponStats;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  legAng: number;
  walk: number;
  hp: number;
  maxHp: number;
  /** 0 살아 있음, 1 쓰러짐, 2 죽음 */
  state: 0 | 1 | 2;
  downT: number;
  respawnT: number;
  deadT: number;
  crouch: boolean;
  ads: boolean;
  sprint: boolean;
  held: 0 | 1 | 2;
  swapT: number;
  mag: number;
  reserve: number;
  reloadT: number;
  fireT: number;
  bloom: number;
  triggerHeld: boolean;
  ga: GadgetState;
  gb: GadgetState;
  frags: number;
  heat: number;
  lockT: number;
  lockId: number;
  stimT: number;
  veh: number;
  seat: number;
  suppress: number;
  lastHurtT: number;
  lastShotT: number;
  spotT: number;
  mapT: number;
  seen: boolean;
  revive: number;
  protect: number;
  kills: number;
  deaths: number;
  assists: number;
  revives: number;
  score: number;
  caps: number;
  vkills: number;
  dmgLog: { by: number; dmg: number; t: number }[];
  ctl: Ctl;
  ai: Brain;
}

export interface Vehicle {
  id: number;
  team: Team;
  type: VehicleType;
  pad: number;
  x: number;
  y: number;
  ang: number;
  spd: number;
  vx: number;
  vy: number;
  tang: number;
  tang2: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnT: number;
  seats: number[];
  fireT: number[];
  mag: number[];
  reloadT: number[];
  coaxT: number;
  coaxMag: number;
  cmCd: number;
  track: number;
  rotor: number;
  lastHurtT: number;
  idleT: number;
  seen: boolean;
  mapT: number;
  dmgLog: { by: number; dmg: number; t: number }[];
  /** 봇 운전 상태 */
  stuckT: number;
  lx: number;
  ly: number;
  revT: number;
  goal: number;
}

export type ProjKind = 'bullet' | 'hmg' | 'cannon' | 'shell' | 'rocket' | 'gl' | 'smokegl' | 'missile' | 'hrocket';

export interface Projectile {
  kind: ProjKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  traveled: number;
  maxDist: number;
  team: Team;
  owner: number;
  dmg: number;
  dmgFar: number;
  near: number;
  far: number;
  splash: number;
  splashR: number;
  wall: number;
  target: number;
  /** 하늘에서 쏜 탄: 지형을 넘어가고 마지막 구간에서만 맞는다 */
  air: boolean;
  weapon: string;
  lastCell: number;
}

export interface Thrown {
  kind: 'frag' | 'smoke' | 'sensor' | 'drone';
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  flight: number;
  fuse: number;
  team: Team;
  owner: number;
}

export interface Item {
  id: number;
  kind: 'medbag' | 'ammobox' | 'mine' | 'claymore' | 'beacon' | 'sensor' | 'drone';
  team: Team;
  owner: number;
  x: number;
  y: number;
  ang: number;
  t: number;
  life: number;
  tick: number;
  tx: number;
  ty: number;
}

export interface Flag {
  x: number;
  y: number;
  name: string;
  tag: string;
  site: string;
  owner: -1 | 0 | 1;
  prog: number;
  n: [number, number];
}

export type GEvent =
  | { k: 'shot'; x: number; y: number; a: number; w: string; team: Team; supp: boolean; heavy: number }
  | { k: 'impact'; x: number; y: number; a: number; m: string }
  | { k: 'boom'; x: number; y: number; r: number; big: boolean }
  | { k: 'break'; x: number; y: number; m: number; t: number }
  | { k: 'collapse'; b: number }
  | { k: 'tree'; x: number; y: number; a: number }
  | { k: 'glass'; x: number; y: number }
  | { k: 'hit'; kill: boolean; veh: boolean }
  | { k: 'hurt'; a: number; dmg: number }
  | { k: 'whiz'; x: number; y: number }
  | { k: 'score'; text: string; pts: number }
  | { k: 'cap'; tag: string; team: number; lost: boolean }
  | { k: 'feed'; killer: string; victim: string; w: string; kt: number; vt: number; me: boolean }
  | { k: 'vdead'; x: number; y: number; type: VehicleType; team: Team }
  | { k: 'casing'; x: number; y: number; a: number }
  | { k: 'smoke'; x: number; y: number; r: number }
  | { k: 'flare'; x: number; y: number }
  | { k: 'blood'; x: number; y: number; a: number }
  | { k: 'msg'; text: string; tone: 'good' | 'bad' | 'info' }
  | { k: 'crush'; x: number; y: number }
  | { k: 'heal'; x: number; y: number }
  | { k: 'track'; x: number; y: number; a: number; w: number };

export interface Spawn {
  kind: 'hq' | 'flag' | 'squad' | 'beacon' | 'vehicle';
  x: number;
  y: number;
  label: string;
  veh: number;
  ref: number;
}

export interface Battle {
  world: World;
  nav: Nav;
  map: MapDef;
  size: SizeId;
  diff: Diff;
  sides: [Side, Side];
  time: number;
  limit: number;
  over: null | { win: boolean; why: string };
  tickets: [number, number];
  startTickets: [number, number];
  soldiers: Soldier[];
  vehicles: Vehicle[];
  proj: Projectile[];
  thrown: Thrown[];
  items: Item[];
  flags: Flag[];
  events: GEvent[];
  player: Soldier;
  needDeploy: boolean;
  seed: number;
  hash: Soldier[][];
  hcw: number;
  hch: number;
  bleedT: number;
  cmdT: number;
  seenT: number;
  nextItem: number;
  /** 플레이어 분대원 병과 */
  squadCls: ClassId[];
}
