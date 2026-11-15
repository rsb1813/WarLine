// render-viewmodel: procedural weapon & gadget models, shared by the first-person view and the loadout preview.
// Conventions: metres, muzzle toward -Z, origin at the pistol grip, sight line along -Z above the origin.
// userData: muzzle, sight (eye point for ADS), mag (reload group), zoom, reticle + extra anchors used by ViewModel.
import * as THREE from 'three';
import type { Attachments, SlotId, WeaponDef } from '../types';
import { SLOT_IDS } from '../types';
import { WEAPONS, ATTACHMENTS, GADGETS, defaultAttachments } from '../defs';
import { Kit, bake } from './vm-geo';
import { AttMap, GunCtx, gunMats, handAnchor, Lay } from './vm-gunparts';
import { bodyRifle, bodyBullpup, bodyLmg, bodySniper, bodyShotgun, bodyPistol } from './vm-bodies';
import { buildBarrel, buildMuzzle, buildOptic, buildUnder } from './vm-attach';
import { buildGadgetGroup } from './vm-gadgets';

function fallbackDef(id: string): WeaponDef {
  return {
    id, name: id, cat: 'ar', desc: '', modes: ['auto'], rpm: 700, dmgNear: 25, dmgFar: 18, rangeNear: 15, rangeFar: 50, headMul: 1.5,
    velocity: 800, mag: 30, reserve: 120, reload: 2.2, reloadEmpty: 2.8, adsTime: 0.25, hipSpread: 3, adsSpread: 0.3, moveSpread: 1,
    spreadPerShot: 0.1, spreadMax: 3, recoilV: 0.5, recoilH: 0.3, firstShot: 1.2, recoilRecover: 12, moveMul: 1, swap: 0.5, slots: {},
    model: { body: 'rifle', length: 0.5, barrel: 0.36, mag: 'curved', color: 0x2d3035, accent: 0x3f7fae, rail: true },
    sound: { kind: 'rifle', pitch: 1, punch: 1 },
  };
}

/** resolve each slot to its attachment definition (defaults where empty) */
export function resolveAttachments(def: WeaponDef, att: Attachments): AttMap {
  let dflt: Attachments = {};
  try { dflt = defaultAttachments(def.id) ?? {}; } catch { dflt = {}; }
  const out = {} as AttMap;
  for (const slot of SLOT_IDS as SlotId[]) {
    const allowed = def.slots?.[slot];
    let id = att?.[slot] ?? dflt[slot] ?? allowed?.[0];
    if (id && !ATTACHMENTS[id] && allowed?.length) id = allowed[0];
    const a = id ? ATTACHMENTS[id] : undefined;
    out[slot] = a && a.slot === slot ? a : null;
  }
  return out;
}

/** stable cache key for a weapon + attachment combination */
export function gunKey(weaponId: string, att: Attachments): string {
  const def = WEAPONS[weaponId];
  if (!def) return weaponId;
  const r = resolveAttachments(def, att);
  return weaponId + '|' + (SLOT_IDS as SlotId[]).map(s => r[s]?.id ?? '-').join(',');
}

export function buildGunModel(weaponId: string, att: Attachments): THREE.Group {
  const def = WEAPONS[weaponId] ?? fallbackDef(weaponId);
  const spec = def.model;
  const root = new THREE.Group();
  root.name = 'gun:' + weaponId;
  const c: GunCtx = {
    k: new Kit(root), root, def, spec, m: gunMats(spec), att: resolveAttachments(def, att ?? {}),
    L: {} as Lay, ud: {}, slide: null,
  };
  switch (spec.body) {
    case 'pistol': bodyPistol(c); break;
    case 'bullpup': bodyBullpup(c); break;
    case 'lmg': bodyLmg(c); break;
    case 'sniper': bodySniper(c); break;
    case 'shotgun': bodyShotgun(c); break;
    case 'dmr': bodyRifle(c, 'dmr'); break;
    case 'smg': bodyRifle(c, 'smg'); break;
    default: bodyRifle(c, 'rifle'); break;
  }
  buildBarrel(c);
  buildMuzzle(c);
  buildUnder(c);
  buildOptic(c);

  // hand anchors
  const rs = c.ud.rightSpec as Parameters<typeof handAnchor>[1] | undefined;
  const rightHand = rs ? handAnchor(root, rs, 'rightHand') : null;
  const leftParent = (c.ud.leftParent as THREE.Object3D | undefined) ?? root;
  const leftHand = handAnchor(leftParent, c.L.leftHand, 'leftHand');

  bake(root);

  const find = (n: string): THREE.Object3D | null => root.getObjectByName(n) ?? null;
  const st = c.att.ammo;
  const ud = root.userData;
  ud.weaponId = weaponId;
  ud.body = spec.body;
  ud.hold = (c.ud.hold as string) ?? 'rifle';
  ud.muzzle = c.ud.muzzle ?? find('muzzle');
  ud.sight = c.ud.sight;
  ud.sightPos = c.ud.sightPos;
  ud.eyeDist = c.ud.eyeDist ?? 0.1;
  ud.mag = c.ud.mag ?? find('mag') ?? root;
  ud.zoom = c.ud.zoom ?? 1;
  ud.reticle = c.ud.reticle ?? 'iron';
  ud.opticType = c.ud.opticType ?? 'iron';
  ud.rightHand = rightHand;
  ud.leftHand = leftHand;
  ud.magHand = find('magHand');
  ud.chargeHand = find('chargeHand');
  ud.boltHand = find('boltHand');
  ud.charge = c.ud.charge ?? null;
  ud.slide = c.ud.slide ?? null;
  ud.bolt = c.ud.bolt ?? null;
  ud.pump = c.ud.pump ?? null;
  ud.cover = c.ud.cover ?? null;
  ud.eject = c.ud.eject ?? null;
  ud.laser = c.ud.laser ?? null;
  ud.light = c.ud.light ?? null;
  ud.reloadStyle = c.ud.reloadStyle ?? 'mag';
  ud.cycle = c.ud.cycle ?? null;
  ud.casing = c.ud.casing ?? 'rifle';
  ud.suppressed = !!c.ud.suppressed;
  ud.tracer = st?.ammoKind === 'tracer';
  ud.lmgHandguard = c.ud.lmgHandguard ?? null;
  return root;
}

export function buildGadgetModel(gadgetId: string): THREE.Group {
  const def = GADGETS[gadgetId];
  const g = buildGadgetGroup(def?.kind ?? gadgetId, gadgetId);
  bake(g);
  const ud = g.userData;
  ud.gadgetId = gadgetId;
  if (!ud.mag) ud.mag = g;
  if (!ud.muzzle) ud.muzzle = g;
  if (!ud.sight) ud.sight = g;
  ud.zoom = ud.zoom ?? 1;
  ud.reticle = ud.reticle ?? 'iron';
  return g;
}
