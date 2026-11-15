// render-viewmodel: shared materials and procedural canvas textures for gun/gadget/arm models.
import * as THREE from 'three';

type Cvs = HTMLCanvasElement | OffscreenCanvas;
type Ctx2 = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { c: Cvs; x: Ctx2 } | null {
  try {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      if (x) return { c, x };
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(w, h);
      const x = c.getContext('2d');
      if (x) return { c, x: x as OffscreenCanvasRenderingContext2D };
    }
  } catch { /* no canvas available (tests / workers) */ }
  return null;
}

function toTex(c: Cvs, srgb: boolean, repeat = false): THREE.Texture {
  const t = new THREE.CanvasTexture(c as HTMLCanvasElement);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const texCache = new Map<string, THREE.Texture | null>();
function cachedTex(key: string, make: () => THREE.Texture | null): THREE.Texture | null {
  if (texCache.has(key)) return texCache.get(key) ?? null;
  const t = make();
  texCache.set(key, t);
  return t;
}

/** small seeded random for texture noise (deterministic look) */
function srand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** grey bump noise for grip stippling */
export function stippleTex(): THREE.Texture | null {
  return cachedTex('stipple', () => {
    const cv = makeCanvas(64, 64); if (!cv) return null;
    const { c, x } = cv; const r = srand(77);
    x.fillStyle = '#808080'; x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 520; i++) {
      const px = r() * 64, py = r() * 64, rad = 0.6 + r() * 1.3;
      const v = r() < 0.5 ? 40 + r() * 40 : 170 + r() * 60;
      x.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
    }
    return toTex(c, false, true);
  });
}

/** subtle fine noise used as roughness/bump on polymer & metal (cast texture look) */
export function grainTex(): THREE.Texture | null {
  return cachedTex('grain', () => {
    const cv = makeCanvas(128, 128); if (!cv) return null;
    const { c, x } = cv; const r = srand(9);
    const img = x.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) {
      const v = 118 + (r() - 0.5) * 50;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return toTex(c, false, true);
  });
}

/** 3-colour woodland/digital-ish camo for sleeves */
export function camoTex(cols: [number, number, number]): THREE.Texture | null {
  return cachedTex('camo:' + cols.join(','), () => {
    const cv = makeCanvas(128, 128); if (!cv) return null;
    const { c, x } = cv; const r = srand(cols[0] ^ (cols[1] << 3) ^ 0x51);
    const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
    x.fillStyle = hex(cols[0]); x.fillRect(0, 0, 128, 128);
    for (let layer = 1; layer < 3; layer++) {
      x.fillStyle = hex(cols[layer]);
      const n = layer === 1 ? 22 : 16;
      for (let i = 0; i < n; i++) {
        const cx = r() * 128, cy = r() * 128;
        const blobs = 3 + (r() * 4 | 0);
        for (let b = 0; b < blobs; b++) {
          const bx = cx + (r() - 0.5) * 22, by = cy + (r() - 0.5) * 14;
          const rw = 4 + r() * 10, rh = 3 + r() * 6;
          // wrap so the texture tiles
          for (const ox of [-128, 0, 128]) for (const oy of [-128, 0, 128]) {
            x.beginPath(); x.ellipse(bx + ox, by + oy, rw, rh, r() * Math.PI, 0, Math.PI * 2); x.fill();
          }
        }
      }
    }
    // fabric weave
    x.globalAlpha = 0.07; x.fillStyle = '#000';
    for (let i = 0; i < 128; i += 2) x.fillRect(0, i, 128, 1);
    x.globalAlpha = 1;
    return toTex(c, true, true);
  });
}

/** muzzle flash front star (white, additive) */
export function starTex(): THREE.Texture | null {
  return cachedTex('star', () => {
    const cv = makeCanvas(128, 128); if (!cv) return null;
    const { c, x } = cv; const r = srand(5);
    x.clearRect(0, 0, 128, 128);
    x.translate(64, 64);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 40);
    g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.25, 'rgba(255,220,150,0.9)');
    g.addColorStop(0.6, 'rgba(255,140,40,0.35)'); g.addColorStop(1, 'rgba(255,80,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, 40, 0, Math.PI * 2); x.fill();
    const prongs = 7;
    for (let i = 0; i < prongs; i++) {
      const a = (i / prongs) * Math.PI * 2 + r() * 0.3;
      const L = 40 + r() * 22, W = 4 + r() * 4;
      x.save(); x.rotate(a);
      const lg = x.createLinearGradient(0, 0, L, 0);
      lg.addColorStop(0, 'rgba(255,240,200,0.95)'); lg.addColorStop(0.5, 'rgba(255,170,70,0.6)'); lg.addColorStop(1, 'rgba(255,90,10,0)');
      x.fillStyle = lg;
      x.beginPath(); x.moveTo(0, -W); x.lineTo(L, 0); x.lineTo(0, W); x.closePath(); x.fill();
      x.restore();
    }
    return toTex(c, true);
  });
}

/** muzzle flash side flame (u = along barrel from muzzle, v = across) */
export function flameTex(): THREE.Texture | null {
  return cachedTex('flame', () => {
    const cv = makeCanvas(128, 64); if (!cv) return null;
    const { c, x } = cv; const r = srand(11);
    x.clearRect(0, 0, 128, 64);
    for (let k = 0; k < 3; k++) {
      x.beginPath();
      x.moveTo(0, 32);
      const L = 90 + r() * 36, W = 10 + r() * 9;
      x.bezierCurveTo(L * 0.25, 32 - W * 1.4, L * 0.6, 32 - W * 0.6, L, 32 + (r() - 0.5) * 8);
      x.bezierCurveTo(L * 0.6, 32 + W * 0.6, L * 0.25, 32 + W * 1.4, 0, 32);
      const g = x.createLinearGradient(0, 0, L, 0);
      g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.35, 'rgba(255,190,90,0.8)'); g.addColorStop(1, 'rgba(255,90,10,0)');
      x.fillStyle = g; x.globalAlpha = 0.55; x.fill();
    }
    x.globalAlpha = 1;
    return toTex(c, true);
  });
}

/** soft round glow (laser dot, LEDs, sparks) */
export function glowTex(): THREE.Texture | null {
  return cachedTex('glow', () => {
    const cv = makeCanvas(64, 64); if (!cv) return null;
    const { c, x } = cv;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return toTex(c, true);
  });
}

/** optic reticle drawn white on transparent (tinted by material colour). kind: dot | holo | chevron | cross | mil */
export function reticleTex(kind: string): THREE.Texture | null {
  return cachedTex('ret:' + kind, () => {
    const cv = makeCanvas(256, 256); if (!cv) return null;
    const { c, x } = cv;
    x.clearRect(0, 0, 256, 256);
    x.translate(128, 128);
    const glow = (rad: number) => {
      const g = x.createRadialGradient(0, 0, 0, 0, 0, rad);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, rad, 0, Math.PI * 2); x.fill();
    };
    x.strokeStyle = 'rgba(255,255,255,0.95)'; x.fillStyle = 'rgba(255,255,255,1)';
    x.shadowColor = 'rgba(255,255,255,0.9)'; x.shadowBlur = 6;
    if (kind === 'holo') {
      x.lineWidth = 5; x.beginPath(); x.arc(0, 0, 92, 0, Math.PI * 2); x.stroke();
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        x.save(); x.rotate(a); x.fillRect(-3, 80, 6, 26); x.restore();
      }
      glow(9);
    } else if (kind === 'chevron') {
      x.lineWidth = 7; x.lineJoin = 'miter';
      x.beginPath(); x.moveTo(-34, 30); x.lineTo(0, 0); x.lineTo(34, 30); x.stroke();
      x.lineWidth = 3; x.beginPath(); x.moveTo(0, 30); x.lineTo(0, 110); x.stroke();
      for (let i = 1; i <= 3; i++) { x.beginPath(); x.moveTo(-10 + i, 30 + i * 22); x.lineTo(10 - i, 30 + i * 22); x.stroke(); }
    } else if (kind === 'cross' || kind === 'mil') {
      x.lineWidth = 3;
      x.beginPath(); x.moveTo(-120, 0); x.lineTo(-14, 0); x.moveTo(14, 0); x.lineTo(120, 0);
      x.moveTo(0, -120); x.lineTo(0, -14); x.moveTo(0, 14); x.lineTo(0, 120); x.stroke();
      x.lineWidth = 7;
      x.beginPath(); x.moveTo(-128, 0); x.lineTo(-70, 0); x.moveTo(70, 0); x.lineTo(128, 0); x.moveTo(0, 70); x.lineTo(0, 128); x.stroke();
      if (kind === 'mil') for (let i = -5; i <= 5; i++) if (i) {
        x.beginPath(); x.arc(i * 11, 0, 2.6, 0, Math.PI * 2); x.arc(0, i * 11, 2.6, 0, Math.PI * 2); x.fill();
      }
      glow(5);
    } else {
      glow(16);
    }
    return toTex(c, true);
  });
}

/** red cross / ammo icon decals for med & ammo bags */
export function iconTex(kind: 'med' | 'ammo'): THREE.Texture | null {
  return cachedTex('icon:' + kind, () => {
    const cv = makeCanvas(64, 64); if (!cv) return null;
    const { c, x } = cv;
    if (kind === 'med') {
      x.fillStyle = '#e8e4da'; x.fillRect(0, 0, 64, 64);
      x.fillStyle = '#b0161a'; x.fillRect(24, 8, 16, 48); x.fillRect(8, 24, 48, 16);
    } else {
      x.fillStyle = '#3b3f2c'; x.fillRect(0, 0, 64, 64);
      x.fillStyle = '#d6b35a';
      for (let i = 0; i < 3; i++) {
        const bx = 12 + i * 15;
        x.fillRect(bx, 26, 9, 28);
        x.beginPath(); x.moveTo(bx, 26); x.quadraticCurveTo(bx + 4.5, 8, bx + 9, 26); x.fill();
      }
    }
    return toTex(c, true);
  });
}

// ───────────────────────── materials ─────────────────────────

const matCache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) { m = make(); matCache.set(key, m); }
  return m;
}

/** polymer (furniture, grips, stocks) */
export function polymer(color: number, rough = 0.8): THREE.MeshStandardMaterial {
  return cached('poly:' + color + ':' + rough, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.04 });
    const g = grainTex();
    if (g) { m.roughnessMap = g; m.bumpMap = g; m.bumpScale = 0.15; }
    return m;
  });
}
/** stippled grip polymer */
export function stippled(color: number): THREE.MeshStandardMaterial {
  return cached('stip:' + color, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.02 });
    const t = stippleTex();
    if (t) {
      const tt = t.clone(); tt.needsUpdate = true; tt.repeat.set(55, 55);
      m.bumpMap = tt; m.bumpScale = 1.2;
    }
    return m;
  });
}
/** parkerized / anodised metal */
export function metal(color = 0x2a2c2e, rough = 0.42, metalness = 0.72): THREE.MeshStandardMaterial {
  return cached('metal:' + color + ':' + rough + ':' + metalness, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness });
    const g = grainTex();
    if (g) { m.roughnessMap = g; }
    return m;
  });
}
export function rubber(color = 0x161616): THREE.MeshStandardMaterial {
  return cached('rub:' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 }));
}
/** flat black for holes, slots, bore */
export function hole(): THREE.MeshStandardMaterial {
  return cached('hole', () => new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, metalness: 0 }));
}
export function brass(): THREE.MeshStandardMaterial {
  return cached('brass', () => new THREE.MeshStandardMaterial({ color: 0xc9a046, roughness: 0.3, metalness: 0.95 }));
}
export function copper(): THREE.MeshStandardMaterial {
  return cached('copper', () => new THREE.MeshStandardMaterial({ color: 0xb46a3a, roughness: 0.32, metalness: 0.9 }));
}
/** optic glass: dark tinted, reflective, see-through */
export function glass(tint = 0x2a4a66, opacity = 0.32): THREE.MeshStandardMaterial {
  return cached('glass:' + tint + ':' + opacity, () => new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.04, metalness: 0.9, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  }));
}
/** opaque coated lens (magnified optics look into darkness) */
export function lensCoated(): THREE.MeshStandardMaterial {
  return cached('lensc', () => new THREE.MeshStandardMaterial({ color: 0x0b1626, roughness: 0.03, metalness: 1, emissive: 0x0a1a10, emissiveIntensity: 0.3 }));
}
/** glowing unlit colour (LEDs, laser, fibre) */
export function glow(color: number, intensity = 1): THREE.MeshBasicMaterial {
  return cached('glow:' + color + ':' + intensity, () => {
    const c = new THREE.Color(color).multiplyScalar(intensity);
    return new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
  });
}
/** additive textured sprite plane (reticles, dots) */
export function additive(color: number, tex: THREE.Texture | null, key: string, opacity = 1): THREE.MeshBasicMaterial {
  return cached('add:' + key + ':' + color + ':' + opacity, () => new THREE.MeshBasicMaterial({
    color, map: tex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  }));
}
export function fabric(color: number): THREE.MeshStandardMaterial {
  return cached('fab:' + color, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.97, metalness: 0 });
    const g = grainTex(); if (g) { m.bumpMap = g; m.bumpScale = 0.6; }
    return m;
  });
}
export function decal(kind: 'med' | 'ammo'): THREE.MeshStandardMaterial {
  return cached('decal:' + kind, () => new THREE.MeshStandardMaterial({ map: iconTex(kind), roughness: 0.9, metalness: 0, color: iconTex(kind) ? 0xffffff : (kind === 'med' ? 0xb0161a : 0xd6b35a) }));
}
export function camo(cols: [number, number, number]): THREE.MeshStandardMaterial {
  return cached('camo:' + cols.join(','), () => {
    const t = camoTex(cols);
    const m = new THREE.MeshStandardMaterial({ color: t ? 0xffffff : cols[0], map: t, roughness: 0.95, metalness: 0 });
    if (t) { m.bumpMap = t; m.bumpScale = 0.3; }
    return m;
  });
}

/** shade a hex colour (k<1 darker, k>1 lighter) */
export function shade(color: number, k: number): number {
  const r = Math.min(255, ((color >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((color >> 8) & 255) * k) | 0;
  const b = Math.min(255, (color & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
}

export function disposeAllMaterials(): void {
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
  for (const t of texCache.values()) t?.dispose();
  texCache.clear();
}
