// render-viewmodel: weapon body builders (rifle / dmr / smg / bullpup / lmg / sniper / shotgun / pistol).
import * as THREE from 'three';
import { rrect, circlePts } from './vm-geo';
import * as M from './vm-mats';
import {
  GunCtx, HandSpec, Lay, pistolGrip, triggerGuard, buildMag, buildStock, skeletonStock, stockStyle, magStyle,
  mlokSlots, handguard, qdLoop, handAnchor, has, attId, boxMag,
} from './vm-gunparts';

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** barrel attachment → length multiplier, thickness multiplier, flags */
export function barrelMods(c: GunCtx): { mul: number; size: number; fluted: boolean; heavy: boolean; match: boolean } {
  const a = c.att.barrel; const id = a?.id ?? '';
  const mul = a?.model?.len ?? (has(id, 'short') ? 0.7 : has(id, 'long') ? 1.3 : 1);
  const size = a?.model?.size ?? (has(id, 'heavy') ? 1.4 : 1);
  return { mul, size, fluted: has(id, 'flut'), heavy: has(id, 'heavy'), match: has(id, 'match') };
}

/** support (left) hand under a handguard with section half sizes hw/hh centred at (0, cy), palm at z */
export function supportHand(cy: number, hw: number, hh: number, z: number): HandSpec {
  const nx = 0.45, ny = 0.893;
  const r = Math.max(hw, hh) * 0.9 + 0.0155;
  return { pos: [-nx * r, cy - ny * r, z + 0.01], f: [0.55, -0.27, -0.8], n: [nx, ny, 0], pose: 'wrap' };
}

function baseLay(): Lay {
  return {
    boreY: 0.067, railY: 0.104, railF: -0.3, railB: 0.07, opticZ: -0.04, rearIronZ: 0.06, frontIronZ: -0.4, frontOnBarrel: false,
    barZ0: -0.4, barLen: 0.15, barR: 0.0095, muzzleZ: -0.55,
    ugZ: -0.35, ugY: 0.04, ugMinZ: -0.42, ugMaxZ: -0.18, hasHandguard: true,
    sideX: 0.025, sideY: 0.068, sideZ: -0.4, hgHalfW: 0.025, hgHalfH: 0.027, hgCY: 0.068,
    leftHand: supportHand(0.068, 0.025, 0.027, -0.33), magThick: 0.023, pistol: false,
  };
}

/** ejection port anchor (casings fly +X) */
function ejectAt(c: GunCtx, x: number, y: number, z: number): void {
  const o = new THREE.Object3D(); o.name = 'eject'; o.position.set(x, y, z); c.root.add(o); c.ud.eject = o;
}

// ───────────────────────── AR family: rifle / dmr / smg ─────────────────────────

export function bodyRifle(c: GunCtx, v: 'rifle' | 'dmr' | 'smg'): void {
  const k = c.k, m = c.m, P = c.root, spec = c.spec, def = c.def;
  const D = v === 'dmr', S = v === 'smg';
  const topMag = spec.mag === 'top';
  const recF = D ? -0.17 : S ? -0.118 : -0.152;
  const recB = D ? 0.085 : S ? 0.07 : 0.08;
  const upY0 = 0.044, upY1 = D ? 0.097 : S ? 0.088 : 0.092;
  const upW = D ? 0.038 : S ? 0.032 : 0.034;
  const lowW = upW - 0.006;
  const boreY = D ? 0.07 : S ? 0.064 : 0.067;
  const hgW = D ? 0.054 : S ? 0.046 : 0.05, hgH = D ? 0.058 : S ? 0.048 : 0.054;
  const hgLen = clamp(spec.length - (recB - recF), S ? 0.08 : 0.12, 0.44);
  const hgF = recF - hgLen;
  const L = baseLay(); c.L = L;
  L.boreY = boreY;
  const bm = barrelMods(c);
  L.barR = (D ? 0.0108 : S ? 0.0085 : 0.0095) * bm.size;

  // ── upper receiver
  k.side(P, [[recF, upY0], [recB, upY0], [recB, upY1 - 0.005], [recB - 0.007, upY1], [recF, upY1]], upW, m.rec, 0, 0.003);
  const portZ = recF + (recB - recF) * 0.36, portL = (recB - recF) * 0.24;
  k.box(P, 0.001, 0.017, portL, m.hole, upW / 2 + 0.0002, boreY - 0.001, portZ);                     // ejection port
  k.box(P, 0.0015, 0.0035, portL * 1.02, m.steel, upW / 2 + 0.0008, boreY - 0.0115, portZ, 0.0005);  // dust cover hinge
  k.box(P, 0.006, 0.012, 0.012, m.rec, upW / 2 + 0.003, boreY + 0.012, portZ + portL / 2 + 0.008, 0.002); // brass deflector
  k.tubeZ(P, 0.0062, 0.0062, recB - 0.048, recB - 0.016, m.rec, upW / 2 + 0.004, upY1 - 0.016, 12);  // forward assist
  k.tubeZ(P, 0.0048, 0.0048, recB - 0.016, recB - 0.01, m.dark, upW / 2 + 0.004, upY1 - 0.016, 10);
  ejectAt(c, upW / 2 + 0.004, boreY, portZ);
  // charging handle (dynamic)
  const ch = k.group(P, 0, 0, 0, true, 'charge');
  k.box(ch, 0.012, 0.007, 0.03, m.dark, 0, upY1 - 0.006, recB + 0.004, 0.0015);
  k.box(ch, 0.046, 0.008, 0.012, m.dark, 0, upY1 - 0.006, recB + 0.018, 0.003);
  k.box(ch, 0.011, 0.007, 0.012, m.accent, -0.021, upY1 - 0.006, recB + 0.017, 0.002);
  handAnchor(ch, { pos: [-0.006, upY1 + 0.006, recB + 0.045], f: [1, 0, 0], n: [0, -0.25, -1], pose: 'hook' }, 'chargeHand');
  c.ud.charge = ch;

  // ── lower receiver with magwell
  const magDepth = D ? 0.07 : S ? 0.036 : 0.062, magThick = D ? 0.026 : S ? 0.021 : 0.023;
  const magZ = recF + (D ? 0.062 : S ? 0.046 : 0.052);
  L.magThick = magThick;
  const m0 = magZ - magDepth / 2 - 0.006, m1 = magZ + magDepth / 2 + 0.005;
  if (!topMag) {
    k.side(P, [[recF + 0.012, upY0], [recB - 0.002, upY0], [recB - 0.002, upY0 - 0.026], [recB - 0.03, 0.006], [0.03, 0.0], [m1 + 0.006, 0.0],
      [m1, -0.026], [m0 + 0.006, -0.032], [m0, -0.03], [m0 - 0.006, -0.01], [m0 - 0.004, upY0 - 0.012]], lowW, m.rec, 0, 0.0025);
    k.span(P, lowW + 0.005, -0.033, -0.025, m0 + 0.001, m1 - 0.001, m.rec, 0, 0.002);                // magwell flare
    k.tubeX(P, 0.0035, 0.004, m.accent, lowW / 2 + 0.0015, 0.012, m1 + 0.007, 10);                    // mag release
    k.box(P, 0.003, 0.012, 0.009, m.dark, -lowW / 2 - 0.0015, 0.021, m1 + 0.005, 0.001);              // bolt catch
  } else {
    k.side(P, [[recF + 0.012, upY0], [recB - 0.002, upY0], [recB - 0.002, upY0 - 0.026], [recB - 0.03, 0.006], [0.03, 0.0], [-0.075, 0.0], [recF + 0.01, upY0 - 0.02]], lowW, m.rec, 0, 0.0025);
  }
  // selector + takedown pins
  k.tubeX(P, 0.0045, 0.003, m.dark, -lowW / 2 - 0.0015, 0.031, 0.026, 10);
  k.box(P, 0.003, 0.004, 0.016, m.accent, -lowW / 2 - 0.003, 0.031, 0.02, 0.001, 0.35);
  for (const z of [recF + 0.02, recB - 0.012]) k.tubeX(P, 0.0028, lowW + 0.003, m.steel, 0, 0.035, z, 8);
  triggerGuard(c, P, (topMag ? -0.064 : m1 + 0.004), -0.004, 0.002, 0.026, m.rec);
  const rh = pistolGrip(c, P, { z0: -0.006, top: 0.006, thick: lowW + 0.001 });
  c.ud.rightSpec = rh;

  // ── handguard
  let railY = upY1 + 0.0125;
  if (topMag) railY = upY1 + 0.0465 + 0.0125;
  const hgCY = topMag ? boreY + 0.003 : (upY1 + 0.0125 - 0.0065) - hgH / 2 + 0.0004;
  handguard(c, P, hgF, recF + 0.004, hgCY, hgW, hgH, S ? m.poly : m.rec);
  mlokSlots(c, P, hgF + 0.01, recF - 0.004, hgCY, hgW / 2, hgH / 2);
  k.tubeZ(P, hgH * 0.42, hgH * 0.42, recF - 0.004, recF + 0.003, m.dark, 0, boreY, 16);                // barrel nut
  qdLoop(c, P, -hgW / 2 - 0.002, hgCY - 0.006, recF - 0.03);
  if (!topMag) k.rail(P, recB - 0.004, hgF + 0.004, railY, m.dark, m.hole);
  else k.rail(P, recB - 0.004, recF + 0.01, upY1 + 0.0125, m.dark, m.hole);

  L.railY = railY;
  L.railF = topMag ? recF - 0.004 : hgF + 0.004;
  L.railB = topMag ? recB + 0.01 : recB - 0.004;
  L.opticZ = topMag ? (recF + recB) / 2 : (recF + recB) / 2 - 0.006;
  L.rearIronZ = L.railB - 0.016; L.frontIronZ = L.railF + 0.016;
  L.hgCY = hgCY; L.hgHalfW = hgW / 2; L.hgHalfH = hgH / 2;
  L.barZ0 = hgF;
  L.barLen = clamp(spec.barrel * bm.mul - hgLen * 0.55, 0.025, 0.5);
  L.muzzleZ = hgF - L.barLen;
  L.ugZ = hgF + clamp(hgLen * 0.3, 0.045, 0.1);
  L.ugY = hgCY - hgH / 2;
  L.ugMinZ = hgF + 0.02; L.ugMaxZ = recF - 0.03;
  L.sideX = hgW / 2; L.sideY = hgCY; L.sideZ = hgF + 0.035;
  L.leftHand = supportHand(hgCY, hgW / 2, hgH / 2, hgF + clamp(hgLen * 0.3, 0.05, 0.095));

  // ── magazine
  if (topMag) {
    topHelicalMag(c, recF, recB, upY1, railY);
  } else {
    const n = def.mag;
    const len = D ? 0.05 + n * 0.0058 : S ? 0.05 + n * 0.0028 : 0.05 + n * 0.0042;
    const curve = spec.mag === 'curved' ? (S ? 0.22 : 0.3) : v === 'rifle' ? 0.07 : 0;
    buildMag(c, magZ, 0.03, { len, depth: magDepth, thick: magThick, curve });
  }
  c.ud.reloadStyle = topMag ? 'top' : 'mag';
  c.ud.casing = S ? 'pistol' : D ? 'big' : 'rifle';

  // ── stock
  buildStock(c, recB, boreY - 0.003, v, upW / 2);
}

/** helical top magazine (smg 'top') + rail bridge */
function topHelicalMag(c: GunCtx, recF: number, recB: number, upY1: number, railY: number): void {
  const k = c.k, m = c.m, P = c.root;
  const ms = magStyle(c);
  const len = 0.2 * ms.len;
  const r = 0.0215;
  const cy = upY1 + r + 0.0015;
  const zF = recF + 0.012;
  // rail bridge posts + rail
  const zPostB = Math.max(recB - 0.01, zF + len + 0.01);
  k.span(P, 0.018, upY1 - 0.002, railY - 0.006, recF - 0.004, recF + 0.006, m.rec, 0, 0.002);
  k.span(P, 0.018, upY1 - 0.002, railY - 0.006, zPostB - 0.006, zPostB + 0.006, m.rec, 0, 0.002);
  k.rail(P, zPostB + 0.006, recF - 0.004, railY, m.dark, m.hole);
  const g = k.group(P, 0, cy, zF, true, 'mag');
  k.tubeZ(g, r, r, 0.006, len - 0.006, m.polyDark, 0, 0, 22);
  for (let i = 1; i < 6; i++) k.tubeZ(g, r + 0.0012, r + 0.0012, i * len / 6 - 0.003, i * len / 6 + 0.003, m.polyDark, 0, 0, 22);
  k.sphere(g, r, m.polyDark, 0, 0, 0.006, 1, 1, 0.45);
  k.tubeZ(g, r * 0.98, r * 0.85, len - 0.006, len + 0.004, m.accentPoly, 0, 0, 22);
  k.tubeZ(g, 0.007, 0.007, len + 0.004, len + 0.012, m.dark, 0, 0, 10);
  // round window
  k.box(g, 0.002, 0.008, len * 0.7, m.brass, -r - 0.0002, 0.004, len * 0.5, 0.001);
  handAnchor(g, { pos: [-0.028, 0.012, len * 0.45], f: [0.3, 0, -1], n: [0.75, -0.65, 0], pose: 'wrap' }, 'magHand');
  c.ud.mag = g;
}

// ───────────────────────── bullpup ─────────────────────────

export function bodyBullpup(c: GunCtx): void {
  const k = c.k, m = c.m, P = c.root, spec = c.spec, def = c.def;
  const Ls = spec.length;
  const boreY = 0.066, yt = 0.0975, W = 0.05;
  const zf = -0.36 * Ls, zb = 0.7 * Ls;
  const magZ = 0.12 + (Ls - 0.52) * 0.3;
  const magDepth = 0.062, magThick = 0.023;
  const mF = magZ - magDepth / 2 - 0.005, mB = magZ + magDepth / 2 + 0.005;
  const L = baseLay(); c.L = L;
  L.boreY = boreY; L.magThick = magThick;
  const bm = barrelMods(c);
  L.barR = 0.0095 * bm.size;
  // main shell
  k.side(P, [
    [zf, 0.062], [zf + 0.006, yt - 0.004], [zf + 0.02, yt], [zb - 0.012, yt + 0.002], [zb, yt - 0.006],
    [zb, -0.068], [zb - 0.03, -0.073], [zb - 0.1, -0.06], [mB + 0.012, -0.036], [mB, -0.014],
    [mF, -0.014], [mF - 0.012, -0.004], [0.058, 0.004], [-0.012, 0.004], [-0.06, 0.012], [zf + 0.1, 0.02], [zf + 0.03, 0.024], [zf, 0.034],
  ], W, m.poly, 0, 0.006);
  // darker fore-grip panel & side texture
  k.side(P, [[zf + 0.012, 0.03], [-0.08, 0.03], [-0.08, 0.075], [zf + 0.012, 0.075]], W + 0.003, m.polyDark, 0, 0.003);
  mlokSlots(c, P, zf + 0.016, -0.085, 0.052, W / 2 + 0.0015, 0.022, false);
  // cheek rest
  k.side(P, [[0.2, yt - 0.002], [zb - 0.03, yt + 0.006], [zb - 0.01, yt + 0.004], [zb - 0.012, yt - 0.01], [0.2, yt - 0.012]], W * 0.8, m.polyDark, 0, 0.004);
  // butt pad
  k.side(P, [[zb - 0.002, yt - 0.004], [zb + 0.014, yt - 0.006], [zb + 0.016, -0.066], [zb - 0.002, -0.07]], W + 0.003, m.rubber, 0, 0.003);
  // ejection port + deflector near the cheek
  k.box(P, 0.001, 0.016, 0.045, m.hole, W / 2 + 0.0004, boreY, magZ + 0.01);
  k.box(P, 0.005, 0.02, 0.012, m.poly, W / 2 + 0.002, boreY + 0.002, magZ + 0.04, 0.002);
  ejectAt(c, W / 2 + 0.004, boreY, magZ + 0.01);
  // receiver insert & barrel collar at front
  k.tubeZ(P, 0.017, 0.017, zf - 0.008, zf + 0.004, m.dark, 0, boreY, 16);
  // charging handle on the left front (dynamic) + its slot
  k.box(P, 0.001, 0.008, 0.12, m.hole, -W / 2 - 0.0004, 0.078, zf + 0.1);
  const ch = k.group(P, 0, 0, 0, true, 'charge');
  k.box(ch, 0.016, 0.009, 0.016, m.dark, -W / 2 - 0.007, 0.078, zf + 0.05, 0.003);
  k.box(ch, 0.008, 0.016, 0.012, m.accent, -W / 2 - 0.015, 0.078, zf + 0.05, 0.003);
  handAnchor(ch, { pos: [-W / 2 - 0.028, 0.08, zf + 0.06], f: [0.2, 0, -1], n: [1, 0, 0], pose: 'hook' }, 'chargeHand');
  c.ud.charge = ch;
  // grip, guard, magazine catch
  triggerGuard(c, P, -0.064, -0.004, 0.006, 0.026, m.poly);
  const rh = pistolGrip(c, P, { z0: -0.006, top: 0.006, thick: 0.029 });
  c.ud.rightSpec = rh;
  k.box(P, 0.02, 0.006, 0.01, m.accent, 0, -0.02, mB + 0.008, 0.002);
  // top rail + bottom rail stub
  const railY = yt + 0.0072;
  const railF = zf + 0.02, railB = Math.min(0.2, zb - 0.16);
  k.rail(P, railB, railF, railY, m.dark, m.hole);
  k.rail(P, zf + 0.012, zf + 0.085, 0.0195, m.dark, m.hole, 'bottom');
  qdLoop(c, P, -W / 2 - 0.002, 0.0, zb - 0.06);

  L.railY = railY; L.railF = railF; L.railB = railB;
  L.opticZ = (railF + railB) / 2 + 0.02;
  L.rearIronZ = railB - 0.014; L.frontIronZ = railF + 0.012;
  L.hgCY = 0.052; L.hgHalfW = W / 2; L.hgHalfH = 0.032;
  L.barZ0 = zf;
  L.barLen = clamp(spec.barrel * bm.mul - 0.16, 0.04, 0.42);
  L.muzzleZ = zf - L.barLen;
  L.ugZ = zf + 0.05; L.ugY = 0.0195; L.ugMinZ = zf + 0.015; L.ugMaxZ = zf + 0.085;
  L.sideX = W / 2; L.sideY = 0.058; L.sideZ = zf + 0.035;
  L.leftHand = supportHand(0.046, W / 2, 0.03, zf + 0.06);

  const n = def.mag;
  buildMag(c, magZ, 0.03, { len: 0.05 + n * 0.0042, depth: magDepth, thick: magThick, curve: spec.mag === 'curved' ? 0.3 : 0.07 });
  c.ud.reloadStyle = 'mag';
  c.ud.casing = 'rifle';
}

// ───────────────────────── light machine gun ─────────────────────────

export function bodyLmg(c: GunCtx): void {
  const k = c.k, m = c.m, P = c.root, spec = c.spec;
  const recF = -0.205, recB = 0.1, y0 = 0.02, y1 = 0.1, W = 0.052, boreY = 0.07;
  const L = baseLay(); c.L = L;
  L.boreY = boreY; L.magThick = 0.05;
  const bm = barrelMods(c);
  L.barR = 0.0135 * bm.size;
  // receiver
  k.side(P, [[recF, y0 + 0.012], [recF + 0.012, y0], [recB - 0.012, y0], [recB, y0 + 0.014], [recB, y1], [recF + 0.006, y1], [recF, y1 - 0.008]], W, m.rec, 0, 0.003);
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) k.tubeX(P, 0.0028, 0.002, m.steel, sx * (W / 2 + 0.0008), y0 + 0.012 + (i % 2) * 0.05, recF + 0.03 + Math.floor(i / 2) * 0.22, 8); // rivets
  k.box(P, 0.0012, 0.024, 0.05, m.hole, -W / 2 - 0.0003, 0.068, -0.1);    // feed tray entry (left)
  k.box(P, 0.0012, 0.01, 0.06, m.hole, W / 2 + 0.0003, 0.034, -0.06);     // ejection slot (right low)
  ejectAt(c, W / 2 + 0.004, 0.034, -0.06);
  // trigger housing + grip + guard
  k.span(P, 0.034, 0.0, y0 + 0.002, -0.075, 0.075, m.rec, 0, 0.003);
  triggerGuard(c, P, -0.066, -0.004, 0.002, 0.026, m.rec);
  const rh = pistolGrip(c, P, { z0: -0.006, top: 0.006, thick: 0.029 });
  c.ud.rightSpec = rh;
  // charging handle (right side) + slot
  k.box(P, 0.001, 0.007, 0.13, m.hole, W / 2 + 0.0003, 0.05, recF + 0.085);
  const ch = k.group(P, 0, 0, 0, true, 'charge');
  k.box(ch, 0.014, 0.01, 0.014, m.dark, W / 2 + 0.006, 0.05, recF + 0.03, 0.003);
  k.tubeX(ch, 0.006, 0.014, m.dark, W / 2 + 0.017, 0.05, recF + 0.03, 10);
  handAnchor(ch, { pos: [W / 2 + 0.035, 0.03, recF + 0.035], f: [-0.45, 0.2, -0.85], n: [-0.85, 0.2, 0.45], pose: 'hook' }, 'chargeHand');
  c.ud.charge = ch;
  // feed cover (hinged at front) with rail
  const cv = k.group(P, 0, y1, recF + 0.03, true, 'cover');
  const cl = recB - 0.012 - (recF + 0.03);
  k.span(cv, W - 0.004, 0, 0.013, 0, cl, m.rec, 0, 0.003);
  for (let i = 0; i < 6; i++) k.box(cv, W - 0.002, 0.004, 0.006, m.rec, 0, 0.004, 0.02 + i * cl / 6.5, 0.001);
  k.box(cv, 0.02, 0.008, 0.012, m.accent, 0, 0.006, cl - 0.004, 0.002);                // cover latch
  k.tubeX(cv, 0.005, W + 0.004, m.steel, 0, 0.004, 0.004, 10);
  k.rail(cv, cl - 0.01, 0.012, 0.0195, m.dark, m.hole);
  c.ud.cover = cv;
  // barrel group: heat shield, gas tube & block, carry handle
  const hgLen = clamp((spec.length - 0.3) * 0.7, 0.12, 0.26);
  const hgF = recF - hgLen;
  const hcy = boreY - 0.02;
  k.front(P, rrect(0, hcy, 0.054, 0.04, 0.012, 3), hgLen, m.poly, (hgF + recF) / 2, 0.002);
  for (let i = 0; i < Math.floor(hgLen / 0.03); i++) for (const sx of [-1, 1]) k.box(P, 0.0012, 0.016, 0.012, m.hole, sx * 0.0272, hcy - 0.004, hgF + 0.02 + i * 0.03);
  const shY = boreY + L.barR + 0.004;
  k.front(P, rrect(0, shY, 0.04, 0.012, 0.005, 2), hgLen * 0.9, m.dark, recF - hgLen * 0.45 - 0.004, 0.001);
  for (let i = 0; i < Math.floor(hgLen * 0.85 / 0.016); i++) for (const sx of [-1, 0, 1]) k.box(P, 0.005, 0.0012, 0.005, m.hole, sx * 0.012, shY + 0.0062, recF - 0.012 - i * 0.016);
  const gbZ = hgF - 0.035;
  k.tubeZ(P, 0.0065, 0.0065, hgF - 0.02, recF, m.steel, 0, boreY - 0.018, 10);
  k.span(P, 0.024, boreY - 0.028, boreY + L.barR + 0.004, gbZ - 0.014, gbZ + 0.014, m.dark, 0, 0.003);
  // carry handle (left, on barrel collar)
  const chZ0 = recF - 0.1, chZ1 = recF - 0.03;
  k.tubeZ(P, L.barR + 0.004, L.barR + 0.004, chZ0 + 0.015, chZ1 - 0.015, m.dark, 0, boreY, 16);
  for (const z of [chZ0 + 0.01, chZ1 - 0.01]) {
    const post = k.box(P, 0.006, 0.04, 0.01, m.dark, -0.018, boreY + 0.018, z, 0.002); post.rotation.z = 0.5;
  }
  k.span(P, 0.012, boreY + 0.03, boreY + 0.042, chZ0, chZ1, m.polyDark, -0.03, 0.005);
  // front sight on gas block (front iron sits on the barrel)
  L.frontOnBarrel = true;

  L.railY = y1 + 0.0195; L.railF = recF + 0.042; L.railB = recB - 0.022;
  L.opticZ = (recF + recB) / 2 - 0.01;
  L.rearIronZ = L.railB - 0.012; L.frontIronZ = gbZ;
  L.hgCY = hcy + 0.008; L.hgHalfW = 0.027; L.hgHalfH = 0.028;
  L.barZ0 = recF;
  L.barLen = clamp(spec.barrel * bm.mul - hgLen * 0.4, 0.15, 0.6);
  L.muzzleZ = recF - L.barLen;
  L.ugZ = gbZ + 0.004; L.ugY = boreY - 0.028; L.ugMinZ = gbZ - 0.01; L.ugMaxZ = recF - 0.04;
  L.sideX = 0.027; L.sideY = hcy; L.sideZ = hgF + 0.03;
  L.leftHand = supportHand(hcy + 0.006, 0.027, 0.024, hgF + 0.075);
  c.ud.lmgHandguard = [hgF, recF];

  beltBox(c, -0.12, y0);
  c.ud.reloadStyle = 'belt';
  c.ud.casing = 'rifle';
  buildStock(c, recB, boreY - 0.006, 'lmg', W / 2);
}

/** belt box / drum / pouch with a short belt feeding into the left side */
function beltBox(c: GunCtx, z: number, top: number): void {
  const k = c.k, m = c.m;
  const ms = magStyle(c);
  const id = attId(c, 'magazine');
  const g = k.group(c.root, 0, top, z, true, 'mag');
  const sz = ms.size;
  const soft = has(id, 'light') || sz < 0.9;
  const drum = c.spec.mag === 'drum' && !soft;
  if (drum) {
    const r = 0.066 * Math.min(1.25, sz), th = 0.056;
    const dg = k.group(g, -0.008, -r - 0.012, 0);
    k.mesh(dg, cylX(r, th), m.polyDark);
    k.mesh(dg, cylX(r * 1.02, 0.006), m.polyDark, -th / 2 + 0.004);
    k.mesh(dg, cylX(r * 1.02, 0.006), m.polyDark, th / 2 - 0.004);
    k.mesh(dg, cylX(r * 0.3, th + 0.006), m.accent);
    k.box(g, 0.036, 0.016, 0.06, m.polyDark, -0.004, -0.006, 0, 0.004);
  } else {
    const w = 0.056 * Math.min(1.2, Math.max(0.75, sz)), h = 0.1 * sz, d = 0.115 * Math.min(1.25, Math.max(0.75, sz));
    const mat = m.polyDark;
    if (soft) {
      // fabric pouch
      k.box(g, w, h, d, M.fabric(0x3b3d33), -0.01, -h / 2 - 0.004, 0, 0.012);
      k.box(g, w + 0.002, 0.006, d * 0.9, m.accentPoly, -0.01, -h * 0.35, 0, 0.002);
    } else {
      k.box(g, w, h, d, mat, -0.008, -h / 2 - 0.004, 0, 0.005);
      for (let i = 0; i < 3; i++) k.box(g, w + 0.002, 0.004, d + 0.002, mat, -0.008, -h * (0.25 + i * 0.25) - 0.004, 0, 0.0015);
      // folding handle (accent for quick-release mags)
      k.span(g, 0.006, -h * 0.75, -h * 0.25, -d / 2 - 0.012, -d / 2 - 0.006, has(id, 'fast') ? m.accentPoly : m.dark, -0.008, 0.002);
      for (const yy of [-h * 0.75, -h * 0.25]) k.box(g, 0.006, 0.006, 0.01, m.dark, -0.008, yy, -d / 2 - 0.004, 0.001);
    }
  }
  // belt: rounds pointing forward, arcing from the box top up into the left feed tray
  const N = 7;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const a = Math.PI * (0.15 + 0.85 * t);
    const bx = -0.03 - Math.sin(a) * 0.018 - t * 0.004, by = 0.012 + (1 - Math.cos(a)) * 0.024;
    k.tubeZ(g, 0.0047, 0.0047, -0.02, 0.02, m.brass, bx, by, 8);
    k.tubeZ(g, 0.0045, 0.0012, -0.036, -0.02, m.copper, bx, by, 8);
    k.box(g, 0.006, 0.004, 0.012, m.dark, bx + 0.002, by - 0.004, 0.006, 0.0008);
  }
  handAnchor(g, { pos: [-0.045, -0.05, 0.01], f: [0.15, -0.1, -1], n: [1, 0, 0.1], pose: 'wrap' }, 'magHand');
  c.ud.mag = g;
}

function cylX(r: number, len: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, 22);
  g.rotateZ(Math.PI / 2);
  return g;
}

// ───────────────────────── bolt-action sniper (chassis) ─────────────────────────

export function bodySniper(c: GunCtx): void {
  const k = c.k, m = c.m, P = c.root, spec = c.spec, def = c.def;
  const boreY = 0.062, actR = 0.0185, actF = -0.175, actB = 0.1;
  const L = baseLay(); c.L = L;
  L.boreY = boreY; L.magThick = 0.03;
  const bm = barrelMods(c);
  L.barR = 0.0122 * bm.size;
  const magZ = -0.1;
  // chassis centre section
  k.side(P, [[-0.205, boreY], [0.112, boreY], [0.112, 0.004], [0.075, 0.0], [-0.004, 0.0], [-0.062, 0.0], [-0.064, -0.012],
    [-0.138, -0.012], [-0.142, 0.006], [-0.205, 0.014]], 0.052, m.accent, 0, 0.004);
  k.box(P, 0.054, 0.012, 0.06, m.rec, 0, boreY - 0.012, -0.17, 0.003);
  // action
  k.tubeZ(P, actR, actR, actF, actB, m.steel, 0, boreY, 22);
  k.tubeZ(P, actR * 1.06, actR * 1.06, actF - 0.004, actF + 0.012, m.dark, 0, boreY, 22); // recoil lug / nut
  k.box(P, 0.0012, 0.017, 0.07, m.hole, actR - 0.0006, boreY, -0.035);      // ejection port
  ejectAt(c, actR + 0.004, boreY, -0.035);
  const railY = boreY + actR + 0.0072 + 0.002;
  k.span(P, 0.02, boreY + actR - 0.004, railY - 0.0062, actF + 0.004, actB - 0.006, m.dark, 0, 0.002);
  k.rail(P, actB - 0.006, -0.32, railY, m.dark, m.hole);
  // bolt (dynamic, pivot at bore axis)
  const bolt = k.group(P, 0, boreY, 0, true, 'bolt');
  k.tubeZ(bolt, 0.0095, 0.0095, actB - 0.04, actB + 0.035, m.steel, 0, 0, 16);
  k.tubeZ(bolt, 0.0165, 0.015, actB + 0.012, actB + 0.04, m.dark, 0, 0, 18);       // shroud
  const arm = k.box(bolt, 0.048, 0.0075, 0.0085, m.steel, 0.028, -0.008, actB - 0.004, 0.002); arm.rotation.z = -0.38;
  k.sphere(bolt, 0.0105, m.accent, 0.054, -0.019, actB - 0.004);
  handAnchor(bolt, { pos: [0.062, -0.002, actB + 0.006], f: [-0.25, -0.35, -0.9], n: [-0.55, -0.8, 0.1], pose: 'pinch' }, 'boltHand');
  c.ud.bolt = bolt;
  // forend
  const fLen = clamp(spec.length - 0.32, 0.25, 0.5);
  const fF = -0.2 - fLen, fcy = boreY - 0.006;
  k.front(P, rrect(0, fcy, 0.054, 0.056, 0.016, 2), fLen, m.rec, -0.2 - fLen / 2, 0.002);
  mlokSlots(c, P, fF + 0.015, -0.21, fcy, 0.027, 0.028);
  k.front(P, rrect(0, fcy, 0.056, 0.058, 0.017, 2), 0.008, m.accent, fF + 0.004, 0.001, [circlePts(0, boreY, L.barR * 1.2, 14).reverse()]);
  // grip, guard, mag
  triggerGuard(c, P, -0.062, -0.004, 0.002, 0.026, m.steel);
  const rh = pistolGrip(c, P, { tilt: 0.24, z0: -0.004, top: 0.004, thick: 0.03, depth: 0.046 });
  c.ud.rightSpec = rh;
  const g = k.group(P, 0, boreY - 0.03, magZ, true, 'mag');
  const ms = magStyle(c);
  const len = (0.08 + def.mag * 0.007) * ms.len;
  boxMag(c, g, { len, depth: 0.064, thick: 0.03, curve: 0, mat: m.dark, plate: ms.style === 'fast' ? m.accentPoly : m.rec });
  if (ms.style === 'fast') boxMag(c, g, { len, depth: 0.064, thick: 0.03, curve: 0, mat: m.dark, plate: m.accentPoly }, 0.034);
  handAnchor(g, { pos: [-0.029, -len * 0.7, 0.008], f: [0.15, -0.2, -1], n: [1, 0, 0.15], pose: 'wrap' }, 'magHand');
  c.ud.mag = g;
  k.box(P, 0.016, 0.006, 0.008, m.accent, 0, -0.016, -0.066, 0.002);     // mag catch paddle

  L.railY = railY; L.railF = -0.32; L.railB = actB - 0.006;
  L.opticZ = (actF + actB) / 2 - 0.01;
  L.rearIronZ = actB - 0.02; L.frontIronZ = fF + 0.02;
  L.hgCY = fcy; L.hgHalfW = 0.027; L.hgHalfH = 0.028;
  L.barZ0 = fF;
  const full = spec.barrel * bm.mul;
  L.muzzleZ = Math.min(fF - 0.05, actF - full);
  L.barLen = fF - L.muzzleZ;
  L.ugZ = fF + 0.035; L.ugY = fcy - 0.028; L.ugMinZ = fF + 0.02; L.ugMaxZ = -0.24;
  L.sideX = 0.027; L.sideY = fcy; L.sideZ = fF + 0.04;
  L.leftHand = supportHand(fcy, 0.027, 0.028, -0.2 - fLen * 0.42);
  c.ud.reloadStyle = 'mag';
  c.ud.cycle = 'bolt';
  c.ud.casing = 'big';
  c.ud.barTaper = 0.86;
  c.ud.flutes = true;

  sniperStock(c, 0.112, boreY);
}

function sniperStock(c: GunCtx, z0: number, boreY: number): void {
  const k = c.k, m = c.m, P = c.root;
  const st = stockStyle(c);
  const lenK = st.len;
  if (st.style === 'fold') {
    k.span(P, 0.04, boreY - 0.03, boreY + 0.004, z0, z0 + 0.02, m.dark, 0, 0.003);
    const fg = k.group(P, -0.04, 0, z0 + 0.015); fg.rotation.y = Math.PI;
    skeletonStock(c, fg, 0, boreY - 0.01, 0.22, 0.012);
    return;
  }
  if (st.style === 'heavy') {
    k.side(P, [[z0, boreY + 0.002], [z0 + 0.3 * lenK, boreY + 0.008], [z0 + 0.31 * lenK, -0.08], [z0 + 0.25 * lenK, -0.082], [z0 + 0.06, -0.02], [z0, -0.006]], 0.048, m.poly, 0, 0.006);
    k.span(P, 0.04, boreY + 0.004, boreY + 0.03, z0 + 0.06, z0 + 0.24 * lenK, m.accentPoly, 0, 0.006);
    k.side(P, [[z0 + 0.308 * lenK, boreY + 0.01], [z0 + 0.328 * lenK, boreY + 0.008], [z0 + 0.33 * lenK, -0.078], [z0 + 0.308 * lenK, -0.082]], 0.05, m.rubber, 0, 0.004);
    return;
  }
  const se = z0 + 0.3 * lenK;
  // hinge block
  k.span(P, 0.04, boreY - 0.03, boreY + 0.008, z0 - 0.002, z0 + 0.022, m.dark, 0, 0.004);
  k.tubeY(P, 0.006, 0.006, 0.042, m.steel, 0.021, boreY - 0.011, z0 + 0.01);
  // top tube
  k.tubeZ(P, 0.0115, 0.0115, z0 + 0.02, se, m.rec, 0, boreY - 0.004, 16);
  if (st.style !== 'light') {
    // lower skeleton member
    const outer: [number, number][] = [[z0 + 0.02, boreY - 0.03], [se - 0.01, boreY - 0.02], [se, -0.07], [se - 0.05, -0.074], [z0 + 0.05, -0.02], [z0 + 0.02, -0.012]];
    const hole: [number, number][] = [[z0 + 0.06, boreY - 0.04], [se - 0.03, boreY - 0.03], [se - 0.022, -0.05], [se - 0.05, -0.058], [z0 + 0.07, -0.02]];
    k.side(P, outer, 0.018, m.accent, 0, 0.003, [hole.reverse() as [number, number][]]);
    // monopod
    k.tubeY(P, 0.006, 0.006, 0.036, m.steel, 0, -0.088, se - 0.045);
    k.tubeY(P, 0.009, 0.009, 0.008, m.dark, 0, -0.07, se - 0.045);
    k.box(P, 0.02, 0.006, 0.016, m.rubber, 0, -0.106, se - 0.045, 0.002);
  }
  // cheek riser
  const cheekH = st.style === 'cheek' ? 0.04 : st.style === 'light' ? 0.0 : 0.03;
  if (cheekH > 0) {
    for (const z of [z0 + 0.08, z0 + 0.2]) k.tubeY(P, 0.004, 0.004, cheekH * 0.6, m.steel, 0, boreY + cheekH * 0.3, z);
    k.span(P, 0.034, boreY + cheekH * 0.5, boreY + cheekH, z0 + 0.05, z0 + 0.24 * lenK, m.accentPoly, 0, 0.007);
  }
  // butt plate (adjustable) + pad
  k.span(P, 0.034, -0.072, boreY + 0.02, se, se + 0.008, m.rec, 0, 0.003);
  k.span(P, 0.038, -0.075, boreY + 0.022, se + 0.008, se + 0.022, m.rubber, 0, 0.005);
}

// ───────────────────────── shotgun ─────────────────────────

export function bodyShotgun(c: GunCtx): void {
  const k = c.k, m = c.m, P = c.root, spec = c.spec, def = c.def;
  const tube = spec.mag === 'tube';
  const pump = def.modes.includes('pump');
  const boreY = 0.07, recF = tube ? -0.115 : -0.14, recB = 0.085, ry0 = 0.026, ry1 = 0.094, W = 0.038;
  const L = baseLay(); c.L = L;
  L.boreY = boreY; L.magThick = 0.034;
  const bm = barrelMods(c);
  L.barR = 0.0118 * bm.size;
  k.side(P, [[recF, ry0 + 0.004], [recB - 0.01, ry0], [recB, ry0 + 0.01], [recB, ry1 - 0.004], [recB - 0.01, ry1], [recF + 0.01, ry1 - 0.002], [recF, ry1 - 0.01]], W, m.rec, 0, 0.003);
  k.box(P, 0.001, 0.024, 0.052, m.hole, W / 2 + 0.0003, 0.066, -0.048);       // ejection port
  ejectAt(c, W / 2 + 0.004, 0.066, -0.048);
  k.tubeX(P, 0.004, W + 0.004, m.steel, 0, 0.05, recB - 0.02, 8);
  k.tubeX(P, 0.0035, W + 0.003, m.steel, 0, 0.05, recF + 0.025, 8);
  k.span(P, 0.03, 0.0, ry0 + 0.002, -0.07, 0.07, m.rec, 0, 0.003);           // trigger group housing
  triggerGuard(c, P, tube ? -0.062 : -0.044, -0.004, 0.002, 0.026, m.rec);
  const rh = pistolGrip(c, P, { z0: -0.006, top: 0.006, thick: 0.03 });
  c.ud.rightSpec = rh;
  const railY = ry1 + 0.0072;
  k.rail(P, recB - 0.008, recF + 0.006, railY, m.dark, m.hole);
  // barrel with vent rib
  const full = spec.barrel * bm.mul;
  L.barZ0 = recF; L.barLen = full; L.muzzleZ = recF - full;
  for (let z = recF - 0.03; z > L.muzzleZ + 0.02; z -= 0.05) k.box(P, 0.003, 0.005, 0.004, m.dark, 0, boreY + L.barR + 0.002, z);
  k.span(P, 0.008, boreY + L.barR + 0.004, boreY + L.barR + 0.007, L.muzzleZ + 0.004, recF, m.dark, 0, 0.001);
  // side saddle (left)
  const ms = magStyle(c);
  const nSh = ms.style === 'fast' ? 6 : 4;
  k.span(P, 0.004, 0.04, 0.09, recF + 0.01, recF + 0.01 + nSh * 0.0235, m.dark, -W / 2 - 0.002, 0.001);
  for (let i = 0; i < nSh; i++) {
    const z = recF + 0.022 + i * 0.0235, x = -W / 2 - 0.0145;
    k.tubeY(P, 0.0105, 0.0105, 0.05, M_shell(c), x, 0.068, z, 12);
    k.tubeY(P, 0.011, 0.011, 0.014, m.brass, x, 0.036, z, 12);
  }
  let leftParent: THREE.Object3D = P;
  if (tube) {
    const tLen = (full - 0.035) * ms.len;
    const tEnd = recF - tLen;
    const ty = boreY - 0.025;
    k.tubeZ(P, 0.0108, 0.0108, tEnd, recF + 0.002, m.steel, 0, ty, 16);
    k.tubeZ(P, 0.0118, 0.0112, tEnd - 0.016, tEnd + 0.002, m.accent, 0, ty, 16);
    const clZ = Math.max(tEnd + 0.03, L.muzzleZ + 0.035);
    k.span(P, 0.026, ty - 0.012, boreY + 0.006, clZ - 0.008, clZ + 0.008, m.dark, 0, 0.004);
    k.box(P, 0.018, 0.002, 0.07, m.hole, 0, ry0 - 0.0002, -0.05);                 // loading port
    // pump (dynamic)
    const pg = k.group(P, 0, 0, 0, true, pump ? 'pump' : 'fore');
    const pB = recF - 0.055, pF = pB - 0.165;
    const pcy = boreY - 0.022;
    k.front(pg, rrect(0, pcy, 0.05, 0.046, 0.016, 3), pB - pF, m.poly, (pF + pB) / 2, 0.003);
    for (let i = 0; i < 8; i++) {
      const z = pF + 0.02 + i * 0.018;
      for (const sx of [-1, 1]) k.box(pg, 0.002, 0.03, 0.005, m.polyDark, sx * 0.0252, pcy - 0.002, z, 0.001);
      k.box(pg, 0.03, 0.002, 0.005, m.polyDark, 0, pcy - 0.0232, z, 0.001);
    }
    for (const sx of [-1, 1]) k.tubeZ(pg, 0.0022, 0.0022, pB, pB + 0.07, m.steel, sx * 0.013, ty + 0.002, 6);
    leftParent = pg;
    L.leftHand = supportHand(pcy, 0.025, 0.023, (pF + pB) / 2 + 0.01);
    if (pump) c.ud.pump = pg;
    // reload shell anchor
    const sg = k.group(P, 0, ry0 - 0.004, -0.05, true, 'mag');
    c.ud.mag = sg;
    c.ud.loadPort = sg;
    c.ud.reloadStyle = 'tube';
    L.ugZ = pF + 0.03; L.ugY = pcy - 0.023; L.ugMinZ = pF + 0.01; L.ugMaxZ = pB - 0.01;
    L.hgCY = pcy; L.hgHalfW = 0.025; L.hgHalfH = 0.023;
    L.sideX = 0.025; L.sideY = pcy; L.sideZ = pF + 0.03;
  } else {
    const hgLen = clamp(spec.length * 0.48, 0.18, 0.28);
    const hgF = recF - hgLen;
    const hcy = boreY - 0.004;
    handguard(c, P, hgF, recF + 0.004, hcy, 0.052, 0.052, m.poly, 0.018);
    mlokSlots(c, P, hgF + 0.01, recF - 0.004, hcy, 0.026, 0.026);
    const ch = k.group(P, 0, 0, 0, true, 'charge');
    k.box(ch, 0.016, 0.008, 0.012, m.dark, W / 2 + 0.008, 0.066, -0.075, 0.002);
    k.tubeX(ch, 0.0055, 0.01, m.accent, W / 2 + 0.019, 0.066, -0.075, 10);
    handAnchor(ch, { pos: [W / 2 + 0.032, 0.05, -0.07], f: [-0.45, 0.2, -0.85], n: [-0.85, 0.2, 0.45], pose: 'hook' }, 'chargeHand');
    c.ud.charge = ch;
    k.box(P, 0.001, 0.007, 0.06, m.hole, W / 2 + 0.0003, 0.066, -0.06);
    const n = def.mag;
    buildMag(c, -0.088, 0.05, { len: (0.05 + n * 0.011), depth: 0.08, thick: 0.034, curve: 0.05 });
    k.span(P, 0.044, 0.016, ry0 + 0.004, -0.13, -0.044, m.rec, 0, 0.003);          // magwell
    c.ud.reloadStyle = 'mag';
    L.ugZ = hgF + 0.05; L.ugY = hcy - 0.026; L.ugMinZ = hgF + 0.02; L.ugMaxZ = recF - 0.03;
    L.hgCY = hcy; L.hgHalfW = 0.026; L.hgHalfH = 0.026;
    L.sideX = 0.026; L.sideY = hcy; L.sideZ = hgF + 0.035;
    L.leftHand = supportHand(hcy, 0.026, 0.026, hgF + 0.07);
  }
  c.ud.leftParent = leftParent;
  L.railY = railY; L.railF = recF + 0.006; L.railB = recB - 0.008;
  L.opticZ = (recF + recB) / 2 - 0.005;
  L.rearIronZ = recB - 0.02; L.frontIronZ = L.muzzleZ + 0.012; L.frontOnBarrel = true;
  c.ud.cycle = pump ? 'pump' : undefined;
  c.ud.casing = 'shell';
  buildStock(c, recB, boreY - 0.004, 'lmg', W / 2);
}

function M_shell(_c: GunCtx): THREE.Material { return M.polymer(0x8e1d18, 0.55); }

// ───────────────────────── pistol ─────────────────────────

export function bodyPistol(c: GunCtx): void {
  const k = c.k, m = c.m, P = c.root, spec = c.spec;
  const Ls = spec.length, zr = 0.036, zf = zr - Ls;
  const sy0 = 0.019, sy1 = 0.05, sw = 0.026, boreY = 0.036;
  const L = baseLay(); c.L = L;
  L.pistol = true; L.boreY = boreY; L.magThick = 0.022; L.hasHandguard = false;
  // frame
  k.side(P, [[zf + 0.012, 0.02], [0.03, 0.02], [0.036, 0.01], [0.03, 0.0], [-0.075, 0.0], [zf + 0.014, 0.0], [zf + 0.012, 0.006]], 0.024, m.poly, 0, 0.003);
  triggerGuard(c, P, -0.074, -0.006, 0.002, 0.028, m.poly);
  const rh = pistolGrip(c, P, { tilt: 0.3, h: 0.098, thick: 0.03, depth: 0.05, z0: -0.009, top: 0.004 });
  c.ud.rightSpec = rh;
  if (spec.rail) k.rail(P, zf + 0.018, -0.082, -0.003, m.dark, m.hole, 'bottom');
  k.box(P, 0.003, 0.006, 0.03, m.dark, -0.0135, 0.017, -0.018, 0.001);                 // slide stop
  k.tubeX(P, 0.004, 0.004, m.accent, -0.0145, -0.004, -0.004, 10);                     // mag release
  k.box(P, 0.003, 0.005, 0.012, m.dark, -0.013, 0.012, 0.026, 0.001, 0.2);             // safety / decocker
  // barrel crown + guide rod
  k.tubeZ(P, 0.0068, 0.0068, zf - 0.002, zf + 0.012, m.steel, 0, boreY, 14);
  k.mesh(P, new THREE.CircleGeometry(0.0045, 12), m.hole, 0, boreY, zf - 0.0022, 0, Math.PI, 0);
  k.tubeZ(P, 0.0032, 0.0032, zf - 0.0005, zf + 0.01, m.steel, 0, 0.026, 8);
  // slide (dynamic)
  const sl = k.group(P, 0, 0, 0, true, 'slide');
  const sec: [number, number][] = [[-sw / 2, sy0], [sw / 2, sy0], [sw / 2, sy1 - 0.007], [sw / 2 - 0.004, sy1], [-sw / 2 + 0.004, sy1], [-sw / 2, sy1 - 0.007]];
  k.front(sl, sec, Ls, m.rec, (zf + zr) / 2, 0.0012, [circlePts(0, boreY, 0.0072, 12).reverse()]);
  for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) k.box(sl, 0.0009, 0.021, 0.0017, m.hole, sx * (sw / 2 + 0.0002), 0.0335, zr - 0.006 - i * 0.0042);
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) k.box(sl, 0.0009, 0.018, 0.0017, m.hole, sx * (sw / 2 + 0.0002), 0.034, zf + 0.012 + i * 0.0042);
  k.box(sl, 0.012, 0.001, 0.034, m.hole, 0.004, sy1 + 0.0002, -0.032);                  // ejection port
  k.box(sl, 0.0105, 0.003, 0.03, m.steel, 0.004, sy1 - 0.001, -0.032, 0.0008);          // barrel hood
  k.box(sl, 0.002, 0.006, 0.006, m.dark, sw / 2 + 0.0008, 0.038, -0.03, 0.0005);         // extractor
  // irons on slide
  const sightY = 0.056;
  k.box(sl, 0.008, 0.008, 0.01, m.dark, -0.0072, sy1 + 0.003, zr - 0.008, 0.001);
  k.box(sl, 0.008, 0.008, 0.01, m.dark, 0.0072, sy1 + 0.003, zr - 0.008, 0.001);
  k.box(sl, 0.0225, 0.003, 0.01, m.dark, 0, sy1 + 0.0005, zr - 0.008, 0.001);
  for (const sx of [-1, 1]) k.mesh(sl, new THREE.CircleGeometry(0.0011, 8), m.white, sx * 0.0072, sightY - 0.0035, zr - 0.0028);
  k.box(sl, 0.0036, 0.0075, 0.006, m.dark, 0, sy1 + 0.0033, zf + 0.01, 0.0006);
  k.mesh(sl, new THREE.CircleGeometry(0.0012, 8), m.fibre, 0, sightY - 0.002, zf + 0.0131);
  handAnchor(sl, { pos: [0.002, sy1 + 0.016, zr - 0.014], f: [1, -0.15, 0], n: [0, -1, -0.15], pose: 'wrap' }, 'chargeHand');
  c.ud.slide = sl; c.slide = sl;
  ejectAt(c, 0.01, sy1 - 0.002, -0.032);
  // magazine in grip
  const tilt = 0.3;
  const mg = k.group(P, 0, 0.0, -0.009 + 0.025, true, 'mag');
  mg.rotation.x = -tilt;
  const ms = magStyle(c);
  const ext = ms.style === 'ext' ? 0.035 * ms.len : 0;
  k.box(mg, 0.021, 0.1 + ext, 0.03, m.steel, 0, -0.05 - ext / 2, 0.002, 0.002);
  if (ext > 0) {
    k.box(mg, 0.031, ext + 0.004, 0.05, m.grip, 0, -0.104 - ext / 2 + 0.004, 0.004, 0.004);
    k.box(mg, 0.033, 0.008, 0.054, m.polyDark, 0, -0.108 - ext, 0.004, 0.003);
  } else {
    k.box(mg, 0.031, 0.008, 0.05, ms.style === 'fast' ? m.accentPoly : m.polyDark, 0, -0.106, 0.004, 0.003);
  }
  k.tubeZ(mg, 0.0044, 0.0044, -0.012, 0.006, m.brass, 0, -0.004, 8);
  handAnchor(mg, { pos: [-0.004, -0.13 - ext, 0.006], f: [0.15, 0.1, -1], n: [0.1, 1, 0], pose: 'cup' }, 'magHand');
  c.ud.mag = mg;
  if (ms.style === 'fast') {
    // flared magwell funnel
    const fz = -0.009 + 0.025 + Math.tan(tilt) * 0.1;
    k.box(P, 0.036, 0.012, 0.056, m.accent, 0, -0.094, fz, 0.004, -tilt);
  }
  // stock brace for machine pistols
  const st = stockStyle(c);
  if (st.style === 'brace') {
    const zb = 0.04 + 0.22 * Math.max(0.8, st.len);
    k.span(P, 0.026, -0.01, 0.024, 0.03, 0.05, m.dark, 0, 0.003);
    for (const sx of [-1, 1]) {
      k.tubeZ(P, 0.0038, 0.0038, 0.045, zb, m.steel, sx * 0.011, 0.016, 8);
      k.tubeZ(P, 0.0038, 0.0038, 0.045, zb - 0.02, m.steel, sx * 0.011, -0.03, 8);
    }
    k.side(P, [[zb - 0.004, 0.03], [zb + 0.012, 0.03], [zb + 0.014, -0.07], [zb - 0.002, -0.072], [zb - 0.022, -0.036]], 0.034, m.poly, 0, 0.004);
    k.side(P, [[zb + 0.011, 0.031], [zb + 0.021, 0.03], [zb + 0.023, -0.07], [zb + 0.013, -0.071]], 0.036, m.rubber, 0, 0.003);
  }

  L.railY = sy1; L.railF = zf + 0.03; L.railB = zr - 0.004;
  L.opticZ = zr - 0.03;
  L.rearIronZ = zr - 0.008; L.frontIronZ = zf + 0.01;
  c.ud.ironSightY = sightY;
  L.barZ0 = zf; L.barLen = 0; L.barR = 0.0068; L.muzzleZ = zf - 0.002;
  L.ugZ = (zf + 0.018 - 0.082) / 2; L.ugY = -0.003; L.ugMinZ = zf + 0.018; L.ugMaxZ = -0.082;
  L.sideX = 0.012; L.sideY = 0.008; L.sideZ = L.ugZ;
  L.hgCY = 0.01; L.hgHalfW = 0.012; L.hgHalfH = 0.012;
  L.leftHand = { pos: [-0.029, -0.046, 0.004], f: [0.6, 0.15, -0.78], n: [0.78, 0.0, 0.62], pose: 'wrap' };
  c.ud.reloadStyle = 'pistol';
  c.ud.casing = 'pistol';
  c.ud.hold = 'pistol';
}
