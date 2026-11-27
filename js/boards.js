/* Learn Retro Play: duel boards (Zack, 2026-11-26: new boards, with Master Duel's Duel Fields as inspiration only; the board itself reacts
   to plays; a new layout; no light ring when a card lands). Everything here is ours: drawn in code, no Konami or Master Duel assets.

   A board is three things:
     1. a layout: where every zone sits (your side; the computer's side is the same turned round). Table.slot() reads it, so cards land
        on the drawn zones;
     2. a world: the mat (painted on a canvas), the floor around it and a few props on its rim, so the board is a diorama in its scene;
     3. reactions: one floor shader per board that lights summons, attacks, destroys, activations, new turns and hits, plus lasting state
        (a glow under every occupied zone in its card's color, the turn player's half, the phase, low Life Points).
   Only transform and opacity animate (and the shader's progress); nothing loops when nothing happens.

   Boards: arena (Arena Lights), rewind (Rewind), rune (Runestone). Pick with ?mat=<id> or Settings (lrplay:set mat). */
import * as THREE from '../vendor/three.module.min.js';
import { ICONS } from './icons.js?v=167';

const B = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
const CW = 0.6, CH = 0.875, ZW = CW + 0.08, ZH = CH + 0.08;
const YOU = 0xff6a1f, THEM = 0x5aa8ff, DANGER = 0xff2a3a;
const PHASES = ['draw', 'standby', 'main1', 'battle', 'main2', 'end'];
const PH_LABEL = ['DRAW', 'STANDBY', 'MAIN 1', 'BATTLE', 'MAIN 2', 'END'];
const ATTR = { DARK: 0x9b5de5, LIGHT: 0xffd86a, EARTH: 0xd0904c, WATER: 0x3aa8ff, FIRE: 0xff5a2a, WIND: 0x47d47a, DIVINE: 0xffe27a };

/* ---------------------------------------------------------------- layouts: (zone, i) -> [x, y] on your side
   Zones always sit side by side in straight rows, every gap the same, piles on the same rows (Zack, 2026-11-26: "the boards card tiles
   need to always be next to each other exactly and not staggered"). A board changes the lane between the fields and where the piles go. */
const grid = (lane, piles) => { const P = 0.76, M = -(lane + CH / 2), S = M - (CH + 0.1), row = { M, S };
  return (z, i) => { if (z === 'm') return [(i - 2) * P, M]; if (z === 'st') return [(i - 2) * P, S]; const [c, r] = piles[z]; return [c * P, row[r]]; }; };
const LAYOUTS = {
  // Arena Lights: a narrow lane; Field and Extra on the left, GY and Deck on the right, Banished beside the GY (today's places)
  arc: grid(0.2, { fz: [-3, 'M'], extra: [-3, 'S'], gy: [3, 'M'], deck: [3, 'S'], ban: [4, 'M'] }),
  // Rewind: a wide center lane for the dial and reels; Field and Extra on the left, GY and Deck on the right, Banished beside the GY
  // (Zack, 2026-11-26: the Extra Deck "needs to be under field spell")
  rack: grid(0.32, { fz: [-3, 'M'], extra: [-3, 'S'], gy: [3, 'M'], deck: [3, 'S'], ban: [4, 'M'] }),
  // Runestone: the rift between the fields; Field and Extra on the left, GY and Deck on the right, Banished beside the GY
  hex: grid(0.3, { fz: [-3, 'M'], extra: [-3, 'S'], gy: [3, 'M'], deck: [3, 'S'], ban: [4, 'M'] }),
};

export const MATS = {
  arena: { name: 'Arena Lights', desc: 'A lit stadium court. The floor answers every play.', layout: 'arc', bg: '#05060a',
    light: { sky: 0xf2f4ff, ground: 0x1a1d28, hemi: 1.6, key: 0xffffff, keyI: 1.25 }, under: 0.42 },
  rewind: { name: 'Rewind', desc: 'A tape deck. Phases turn the dial, a new turn rewinds it.', layout: 'rack', bg: '#0e0a09',
    light: { sky: 0xfff1e0, ground: 0x2a1e18, hemi: 1.55, key: 0xffe6cc, keyI: 1.3 }, under: 0.34 },
  rune: { name: 'Runestone', desc: 'Carved stone. Light runs through its channels.', layout: 'hex', bg: '#07090b',
    light: { sky: 0xe8fff8, ground: 0x10181a, hemi: 1.55, key: 0xf4fffb, keyI: 1.3 }, under: 0.4 },
};
export const MAT_IDS = Object.keys(MATS);
export const layoutOf = id => MATS[id] ? LAYOUTS[MATS[id].layout] : null;
// ?mat=<id> wins (testing; ?mat=shop still shows the old Card Shop scene), then the saved setting, else Rewind
// (Zack, 2026-11-26: "lets retire card shop"; anyone who had Card Shop saved gets Rewind)
export function matChoice(saved) {
  const q = new URLSearchParams(location.search).get('mat');
  if (q != null) return MATS[q] ? q : null;
  return MATS[saved] ? saved : 'rewind';
}

// every zone of a layout, both sides, with its board position
function zonesOf(L) {
  const out = [];
  for (const side of [1, -1]) {
    for (const zone of ['m', 'st']) for (let i = 0; i < 5; i++) { const [x, y] = L(zone, i); out.push({ side, zone, i, x: x * side, y: y * side }); }
    for (const zone of ['fz', 'extra', 'gy', 'deck', 'ban']) { const [x, y] = L(zone); out.push({ side, zone, i: 0, x: x * side, y: y * side, pile: zone !== 'fz' }); }
  }
  return out;
}
const PILE_LABEL = { fz: 'FIELD', extra: 'EXTRA', gy: 'GY', deck: 'DECK', ban: 'BANISHED' };

/* ---------------------------------------------------------------- canvas painting */
const MAT_R = { x0: -4.4, x1: 4.4, y0: -3.0, y1: 3.0 };   // the painted mat's area in board units
class Paper {
  constructor(r, S) { Object.assign(this, r, { S }); this.c = document.createElement('canvas'); this.c.width = Math.round((r.x1 - r.x0) * S); this.c.height = Math.round((r.y1 - r.y0) * S); this.g = this.c.getContext('2d'); }
  X(x) { return (x - this.x0) * this.S; } Y(y) { return (this.y1 - y) * this.S; } U(u) { return u * this.S; }
  rr(cx, cy, w, h, r) { const g = this.g, x = this.X(cx - w / 2), y = this.Y(cy + h / 2), W = this.U(w), H = this.U(h), R = this.U(r); g.beginPath(); g.roundRect(x, y, W, H, R); }
  text(s, x, y, size, rot = 0, font = 'italic 800') { const g = this.g; g.save(); g.translate(this.X(x), this.Y(y)); g.rotate(rot); g.font = `${font} ${this.U(size)}px "Barlow Condensed", "Atkinson Hyperlegible", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, 0, 0); g.restore(); }
  line(pts, w) { const g = this.g; g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(this.X(x), this.Y(y)) : g.moveTo(this.X(x), this.Y(y))); g.lineWidth = this.U(w); g.stroke(); }
  tex(renderer) { const t = new THREE.CanvasTexture(this.c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; }
}
const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647);
const hex = n => '#' + n.toString(16).padStart(6, '0');
const rgba = (n, a) => `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;

// a soft card-shaped glow (zone underlights, the phase marker): white, tinted by the material
function glowTex(w, h, blur, r = 18) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.shadowColor = '#fff'; g.shadowBlur = blur; g.fillStyle = '#fff'; g.beginPath(); g.roundRect(blur * 1.1, blur * 1.1, w - blur * 2.2, h - blur * 2.2, r); g.fill(); g.fill();
  const t = new THREE.CanvasTexture(c); return t;
}

/* ---------------------------------------------------------------- the reaction shaders: one per board */
const VERT = 'varying vec2 vB; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vB = vec2(w.x, -w.z); gl_Position = projectionMatrix * viewMatrix * w; }';
const HEAD = `
  uniform float uTime; uniform vec4 uA[8]; uniform vec4 uB[8]; uniform vec3 uC[8]; uniform sampler2D uMask; uniform vec4 uMR;
  varying vec2 vB;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float cheb(vec2 a, vec2 b){ vec2 d = abs(a - b); return max(d.x / 0.36, d.y / 0.5); }   // 1.0 on a zone's frame: card-shaped distance
  float seg(vec2 p, vec2 a, vec2 b, out float h){ vec2 ab = b - a; h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0); return length(p - a - ab * h); }
`;
// kinds: 1 summon, 2 big summon, 3 attack, 4 destroyed, 5 activation, 6 new turn / damage wash, 7 hit
const FRAG = {
  // Arena Lights: an LED court; every reaction lights whole tiles
  arena: HEAD + `
  void main(){
    vec2 g = vB / 0.1; vec2 id = floor(g); vec2 c = (id + 0.5) * 0.1; vec2 f = abs(fract(g) - 0.5);
    float tile = smoothstep(0.48, 0.34, max(f.x, f.y));
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float kind = uA[i].x; if (kind < 0.5) continue;
      float k = uA[i].y; vec2 o = uA[i].zw; vec2 t = uB[i].xy; float sd = uB[i].w; float v = 0.0;
      if (kind < 1.5) { float d = cheb(c, o); v = smoothstep(0.55, 0.0, abs(d - 1.0 - k * 3.2)) * (1.0 - k) + step(d, 1.05) * (1.0 - k) * (1.0 - k) * 0.9; }
      else if (kind < 2.5) { float d = cheb(c, o); v = (smoothstep(0.7, 0.0, abs(d - 1.0 - k * 7.0)) + 0.6 * smoothstep(0.5, 0.0, abs(d - 1.0 - max(k - 0.15, 0.0) * 7.0))) * (1.0 - k) + step(d, 1.05) * (1.0 - k) * 1.1 + step(0.0, -c.y * sd) * 0.16 * sin(3.14159 * k); }
      else if (kind < 3.5) { float h; float dist = seg(c, o, t, h); float head = k * 1.35; v = smoothstep(0.2, 0.05, dist) * step(h, head) * smoothstep(0.5, 0.0, head - h) * (1.0 - smoothstep(0.85, 1.0, k)) * 1.4; }
      else if (kind < 4.5) { float d = cheb(c, o); v = step(d, 1.1) * step(0.45, hash(id + floor(uTime * 22.0))) * (1.0 - k) * 1.3; }
      else if (kind < 5.5) { float d = cheb(c, o); v = (smoothstep(0.25, 0.0, abs(d - 1.05)) * 1.2 + step(d, 1.0) * 0.3) * (0.5 + 0.5 * cos(k * 12.566)) * (1.0 - k); }
      else if (kind < 6.5) { float ay = -c.y * sd; v = step(0.0, ay) * (smoothstep(0.35, 0.0, abs(ay - k * 3.0)) * 0.9 + 0.08) * (1.0 - k); }
      else { float d = cheb(c, o); v = smoothstep(0.4, 0.0, abs(d - 0.8 - k * 2.2)) * (1.0 - k) * 1.4 + step(d, 0.9) * (1.0 - k) * 0.7; }
      acc += uC[i] * v;
    }
    gl_FragColor = vec4(acc * tile * 1.5, 1.0);
  }`,
  // Rewind: scanlines, tracking lines, play arrows and tape glitches, with a slight color split
  rewind: HEAD + `
  float ev(float kind, float k, vec2 o, vec2 t, float sd, vec2 p){
    float v = 0.0;
    if (kind < 2.5) {
      float big = step(1.5, kind); vec2 q = (p - o) * vec2(1.0, sd);
      float inz = step(abs(q.x), 0.38 + big * 0.06) * step(abs(q.y), 0.52);
      v = inz * (0.3 + step(0.55, fract(q.y * 7.0 - k * 5.0))) * (1.0 - k);
      float ly = o.y + sd * k * (3.0 + big * 3.5);
      v += smoothstep(0.05, 0.0, abs(p.y - ly)) * (1.0 - k) * (0.6 + 0.5 * big);
    } else if (kind < 3.5) {
      float h; float dist = seg(p, o, t, h); float L = length(t - o);
      float chev = step(0.5, fract((h * L - abs(dist) * 0.9) * 5.0 - k * 9.0));
      v = step(dist, 0.16) * chev * step(h, k * 1.3) * (1.0 - smoothstep(0.8, 1.0, k)) * 1.3;
    } else if (kind < 4.5) {
      float row = floor(p.y / 0.05); float off = (hash(vec2(row, floor(uTime * 24.0))) - 0.5) * 0.3 * (1.0 - k);
      vec2 q = p - o + vec2(off, 0.0);
      v = step(abs(q.x), 0.36) * step(abs(q.y), 0.5) * step(0.4, hash(vec2(row * 3.1, floor(uTime * 30.0)))) * (1.0 - k) * 1.3;
    } else if (kind < 5.5) {
      vec2 q = abs(p - o);
      float edge = max(smoothstep(0.05, 0.0, abs(q.x - 0.36)) * step(q.y, 0.5), smoothstep(0.05, 0.0, abs(q.y - 0.5)) * step(q.x, 0.36));
      v = edge * (0.5 + 0.5 * cos(k * 12.566)) * (1.0 - k) * 1.5;
    } else if (kind < 6.5) {
      float ay = -p.y * sd; v = step(0.0, ay) * (smoothstep(0.07, 0.0, abs(ay - k * 2.8)) * 1.2 + 0.1 * (1.0 - k)) * (1.0 - 0.6 * k);
    } else {
      float d = length((p - o) * vec2(1.0, 1.4));
      v = step(d, 0.2 + k * 0.8) * step(0.55, hash(floor(p / 0.04) + floor(uTime * 30.0))) * (1.0 - k) * 1.2;
    }
    return v;
  }
  void main(){
    float scan = 0.55 + 0.45 * step(0.5, fract(vB.y / 0.03));
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float kind = uA[i].x; if (kind < 0.5) continue;
      float k = uA[i].y; vec2 o = uA[i].zw; vec2 t = uB[i].xy; float sd = uB[i].w; vec3 col = uC[i];
      float r = ev(kind, k, o, t, sd, vB + vec2(0.022, 0.0)), g = ev(kind, k, o, t, sd, vB), b = ev(kind, k, o, t, sd, vB - vec2(0.022, 0.0));
      acc += vec3(col.r * r, col.g * g, col.b * b) + vec3(0.25) * min(min(r, g), b);
    }
    gl_FragColor = vec4(acc * scan, 1.0);
  }`,
  // Runestone: light runs through the carved channels (mask R), cracks (G) and runes (B) light inside their zones
  rune: HEAD + `
  vec3 M(vec2 p){ return texture2D(uMask, (p - uMR.xy) / uMR.zw).rgb; }
  void main(){
    vec3 m = M(vB); vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float kind = uA[i].x; if (kind < 0.5) continue;
      float k = uA[i].y; vec2 o = uA[i].zw; vec2 t = uB[i].xy; float sd = uB[i].w; float v = 0.0;
      if (kind < 2.5) {
        float big = step(1.5, kind); float d = length(vB - o);
        v = m.r * smoothstep(0.35, 0.0, abs(d - k * (3.2 + 3.0 * big))) * (1.0 - k) * 1.7 + m.b * step(cheb(vB, o), 1.05) * (1.0 - k) * 1.6 + big * m.r * 0.3 * sin(3.14159 * k);
      } else if (kind < 3.5) {
        float h; float dist = seg(vB, o, t, h); float jit = 0.035 * sin(h * 47.0 + uTime * 40.0) + 0.02 * sin(h * 113.0 - uTime * 55.0);
        float on = step(h, k * 1.25) * (1.0 - smoothstep(0.8, 1.0, k));
        v = smoothstep(0.028, 0.0, abs(dist - jit)) * on * 2.2 + m.r * smoothstep(0.45, 0.0, dist) * on * 0.7;
      } else if (kind < 4.5) {
        float c = cheb(vB, o); v = m.g * step(c, 1.1) * (1.0 - k) * 2.0 + step(c, 1.0) * (1.0 - k) * (1.0 - k) * 0.35;
      } else if (kind < 5.5) {
        v = m.b * step(cheb(vB, o), 1.1) * (0.5 + 0.5 * cos(k * 12.566)) * (1.0 - k) * 1.8;
      } else if (kind < 6.5) {
        v = m.r * (smoothstep(0.4, 0.0, abs(vB.y)) * smoothstep(0.6, 0.0, abs(abs(vB.x) - k * 4.6)) * 1.6 + step(0.0, -vB.y * sd) * 0.25 * sin(3.14159 * k)) * (1.0 - 0.3 * k);
      } else {
        float d = length(vB - o); v = m.r * smoothstep(0.3, 0.0, abs(d - k * 1.6)) * (1.0 - k) * 1.6 + step(d, 0.32) * (1.0 - k) * 0.5;
      }
      acc += uC[i] * v;
    }
    gl_FragColor = vec4(acc, 1.0);
  }`,
};
FRAG.theme = FRAG.rune.replace('gl_FragColor = vec4(acc, 1.0);', 'gl_FragColor = vec4(acc, clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0));');


/* ---------------------------------------------------------------- themed boards (Zack, 2026-11-26: "theme boards that match game themes similar to
   our packs/boosters (dragon theme, spellcaster, toons, fiend, light, dark, etc)... building off the new board engine of rewind and runestone").
   Each theme is Runestone's engine (straight grid, channels the reactions run through, standing props, phase lights on the rift) dressed in its
   own palette, mat texture, lane art, zone marks, props and floor. The art is ours, drawn in code. */
const curve = (P, g, pts, w) => { g.beginPath(); g.moveTo(P.X(pts[0][0]), P.Y(pts[0][1])); for (let i = 1; i + 1 < pts.length; i += 2) g.quadraticCurveTo(P.X(pts[i][0]), P.Y(pts[i][1]), P.X(pts[i + 1][0]), P.Y(pts[i + 1][1])); g.lineWidth = P.U(w); g.stroke(); };
const blobs = (P, g, R, n, cols, SW, SH, r0 = 0.2, r1 = 0.9) => { for (let k = 0; k < n; k++) { const x = (R() - 0.5) * SW, y = (R() - 0.5) * SH, r = r0 + R() * (r1 - r0), c = cols[k % cols.length]; const rg = g.createRadialGradient(P.X(x), P.Y(y), 0, P.X(x), P.Y(y), P.U(r)); rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(P.X(x - r), P.Y(y + r), P.U(2 * r), P.U(2 * r)); } };
const dots = (P, g, R, n, col, SW, SH, s0 = 1, s1 = 3) => { g.fillStyle = col; for (let k = 0; k < n; k++) { const s = s0 + R() * (s1 - s0); g.globalAlpha = 0.2 + R() * 0.8; g.fillRect(P.X((R() - 0.5) * SW) - s / 2, P.Y((R() - 0.5) * SH) - s / 2, s, s); } g.globalAlpha = 1; };
const radial = (P, g, x, y, r, c) => { const rg = g.createRadialGradient(P.X(x), P.Y(y), 0, P.X(x), P.Y(y), P.U(r)); rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, P.c.width, P.c.height); };
// a zone's mark: a game-icons.net icon (js/icons.js), the theme's monster icon on Monster and Field zones and its Spell/Trap icon on
// Spell/Trap zones, turned to face the zone's owner, filled in the current stroke color (the mat's ink, or a mask channel)
const PATH2D = {};
function zoneIcon(P, g, z, icons) {
  const name = z.zone === 'st' ? icons.st : icons.m, ic = ICONS[name]; if (!ic) return;
  const path = PATH2D[name] || (PATH2D[name] = new Path2D(ic.d)), size = z.zone === 'st' ? 0.34 : 0.42, k = P.U(size) / 512;
  g.save(); g.fillStyle = g.strokeStyle; g.translate(P.X(z.x), P.Y(z.y)); if (z.side === -1) g.rotate(Math.PI); g.scale(k, k); g.translate(-256, -256); g.fill(path); g.restore();
}
const RUNE_ICONS = { m: 'rune-stone', st: 'crystal-growth' };
function themeGlyph(P, g, z, lw, icons) { zoneIcon(P, g, z, icons); }
// the corner props share a light (a soft glow that lights for the turn player and flares on big summons) and a beam
function propLight(b, x, y, h, col, sd) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: b._round || (b._round = glowTex(128, 128, 30, 64)), color: col, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.copy(B(x, y, h)); m.lookAt(b.T.camera.position); b.root.add(m); b.stones[sd].push(m);
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 3.0), new THREE.MeshBasicMaterial({ map: b.beamTex(), color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.copy(B(x, y, h + 1.3)); beam.lookAt(b.T.camera.position.x, beam.position.y, b.T.camera.position.z); beam.visible = false; b.root.add(beam); b.flares[sd].push(beam);
}
const corners = (SW, SH, f) => { for (const sx of [-1, 1]) for (const sy of [-1, 1]) f(sx * (SW / 2 + 0.45), sy * (SH / 2 + 0.25), sy < 0 ? 0.65 : 1.25, sy < 0 ? 1 : -1, sx); };
const lam = c => new THREE.MeshLambertMaterial({ color: c });

const THEMES = {
  dragon: { name: 'Dragon', desc: 'Scaled stone, claw marks and ember spires.', icons: { m: 'dragon-head', st: 'claw-slashes' },
    base: '#1d1311', slab: 0x120c0a, bg: '#0d0807', glow: 0xff7a2a, glowCss: '#ff7a2a', hot: 0xff8a3a,
    ink: 'rgba(0,0,0,.5)', glowInk: 'rgba(255,122,42,.34)', zoneFill: 'rgba(0,0,0,.32)', zoneLine: 'rgba(232,170,90,.5)', pileLine: 'rgba(232,170,90,.26)', glyphInk: 'rgba(255,140,60,.2)', label: 'rgba(240,190,120,.6)',
    light: { sky: 0xffe9d8, ground: 0x2a140c, hemi: 1.55, key: 0xfff0e0, keyI: 1.3 }, under: 0.42,
    tex(P, g, R, SW, SH) { g.strokeStyle = 'rgba(255,160,90,.07)'; g.lineWidth = P.U(0.008); for (let r = 0, y = -SH / 2; y < SH / 2; y += 0.13, r++) for (let x = -SW / 2 + (r % 2) * 0.1; x < SW / 2; x += 0.2) { g.beginPath(); g.arc(P.X(x), P.Y(y), P.U(0.1), 0, Math.PI); g.stroke(); } dots(P, g, R, 500, '#ff9a4a', SW, SH, 1, 3); blobs(P, g, R, 40, ['rgba(0,0,0,.25)', 'rgba(120,40,10,.12)'], SW, SH); },
    deco(P, g, w) { for (const s of [1, -1]) for (let k = 0; k < 3; k++) { const y0 = -s * (0.7 + k * 0.16); curve(P, g, [[-3.75, y0], [-3.3, y0 - s * 0.55], [-2.72, y0 - s * 1.25]], w); } for (let k = 0; k < 3; k++) { const y0 = 0.5 + k * 0.14; curve(P, g, [[3.42, -y0], [3.6, -y0 - 0.6], [3.82, -y0 - 1.2]], w * 0.8); } },
    lane(P, g, w) { P.line([[-3.7, 0], [3.7, 0]], w); for (let x = -3.6; x <= 3.6; x += 0.24) { if (Math.abs(x) < 1.4) continue; P.line([[x - 0.04, -0.09], [x + 0.04, 0], [x - 0.04, 0.09]], w * 0.8); } },
    floor(P, g, R) { radial(P, g, 0, 0.3, 9, 'rgba(150,60,20,.42)'); dots(P, g, R, 900, '#ff8a3a', 30, 24, 1, 4); g.strokeStyle = 'rgba(255,140,60,.05)'; for (let k = 0; k < 30; k++) { const x = (R() - 0.5) * 34, y = (R() - 0.5) * 26; curve(P, g, [[x, y], [x + R() * 2, y + R() * 1.5], [x + 1 + R() * 2, y + R() * 3]], 0.04); } },
    props(b, SW, SH) { corners(SW, SH, (x, y, h, sd, sx) => { const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, h, 5), lam(0x1e1512)); c.position.copy(B(x, y, h / 2)); c.rotation.z = -sx * 0.08; b.root.add(c); const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.11, h * 0.6, 5), lam(0x2a1c17)); c2.position.copy(B(x + sx * 0.22, y + 0.12, h * 0.3)); c2.rotation.z = -sx * 0.25; b.root.add(c2); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 5), new THREE.MeshBasicMaterial({ color: 0xff7a2a })); tip.position.copy(B(x, y, h + 0.02)); b.root.add(tip); propLight(b, x, y, h * 0.9, 0xff7a2a, sd); }); } },
  caster: { name: 'Spellcaster', desc: 'A night sky of arcane lines and floating crystals.', icons: { m: 'wizard-staff', st: 'magic-swirl' },
    base: '#15122c', slab: 0x0d0b1e, bg: '#08071a', glow: 0x9b7bff, glowCss: '#9b7bff', hot: 0xc06bff,
    ink: 'rgba(0,0,0,.45)', glowInk: 'rgba(160,130,255,.34)', zoneFill: 'rgba(10,8,30,.42)', zoneLine: 'rgba(190,175,255,.5)', pileLine: 'rgba(190,175,255,.26)', glyphInk: 'rgba(170,150,255,.22)', label: 'rgba(200,190,255,.62)',
    light: { sky: 0xf0ecff, ground: 0x1a1430, hemi: 1.55, key: 0xf6f2ff, keyI: 1.3 }, under: 0.42,
    tex(P, g, R, SW, SH) { blobs(P, g, R, 26, ['rgba(120,80,255,.14)', 'rgba(60,200,255,.08)'], SW, SH, 0.5, 1.6); dots(P, g, R, 1400, '#ffffff', SW, SH, 1, 3); },
    deco(P, g, w) { for (const s of [1, -1]) { const cy = -s * 1.2; for (const rot of [0, Math.PI]) { g.beginPath(); for (let k = 0; k <= 3; k++) { const a = rot + Math.PI / 2 + k * 2 * Math.PI / 3; const px = Math.cos(a) * 1.55, py = cy + Math.sin(a) * 1.0; k ? g.lineTo(P.X(px), P.Y(py)) : g.moveTo(P.X(px), P.Y(py)); } g.lineWidth = P.U(w * 0.8); g.stroke(); } }
      const st = [[-3.7, 1.9], [-3.35, 1.3], [-3.6, 0.7], [-3.1, 0.45]]; P.line(st, w * 0.6); P.line(st.map(([x, y]) => [x, -y]), w * 0.6); },
    lane(P, g, w) { g.setLineDash([P.U(0.12), P.U(0.08)]); P.line([[-3.7, 0], [3.7, 0]], w); g.setLineDash([]); for (const x of [-3.2, -2.4, -1.6, 1.6, 2.4, 3.2]) { g.beginPath(); g.moveTo(P.X(x), P.Y(0.08)); g.lineTo(P.X(x + 0.06), P.Y(0)); g.lineTo(P.X(x), P.Y(-0.08)); g.lineTo(P.X(x - 0.06), P.Y(0)); g.closePath(); g.lineWidth = P.U(w); g.stroke(); } },
    floor(P, g, R) { radial(P, g, 0, 0.3, 10, 'rgba(70,50,160,.5)'); dots(P, g, R, 2200, '#ffffff', 40, 32, 1, 3); blobs(P, g, R, 18, ['rgba(110,70,255,.12)', 'rgba(40,180,255,.07)'], 40, 30, 1.5, 4); },
    props(b, SW, SH) { corners(SW, SH, (x, y, h, sd) => { const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 8), lam(0x26214a)); ped.position.copy(B(x, y, 0.06)); b.root.add(ped); const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshLambertMaterial({ color: 0x8f78ff, emissive: 0x3b2a99 })); cr.scale.set(0.8, 1.9, 0.8); cr.position.copy(B(x, y, h * 0.55 + 0.25)); cr.rotation.y = 0.5; b.root.add(cr); propLight(b, x, y, h * 0.55 + 0.25, 0x9b7bff, sd); }); } },
  fiend: { name: 'Fiend', desc: 'Cracked basalt with lava running through it, and thorns.', icons: { m: 'daemon-skull', st: 'thorn-helix' },
    base: '#1c0d0e', slab: 0x100607, bg: '#0c0405', glow: 0xff3a2a, glowCss: '#ff3a2a', hot: 0xff5a2a,
    ink: 'rgba(0,0,0,.55)', glowInk: 'rgba(255,80,40,.42)', zoneFill: 'rgba(0,0,0,.36)', zoneLine: 'rgba(255,110,90,.44)', pileLine: 'rgba(255,110,90,.22)', glyphInk: 'rgba(255,80,60,.2)', label: 'rgba(255,150,130,.58)',
    light: { sky: 0xffe4e0, ground: 0x2a0c0c, hemi: 1.55, key: 0xfff0ec, keyI: 1.3 }, under: 0.42,
    tex(P, g, R, SW, SH) { blobs(P, g, R, 60, ['rgba(0,0,0,.3)', 'rgba(110,20,20,.16)'], SW, SH, 0.1, 0.6); dots(P, g, R, 300, '#ff6a3a', SW, SH, 1, 2); },
    deco(P, g, w) { const R = rnd(41); for (let k = 0; k < 16; k++) { let x = (R() - 0.5) * 7.4, y = (R() - 0.5) * 4.6; const pts = [[x, y]]; let a = R() * 6.28; for (let j = 0; j < 8; j++) { a += (R() - 0.5) * 1.1; x += Math.cos(a) * 0.16; y += Math.sin(a) * 0.16; pts.push([x, y]); } P.line(pts, w * (0.6 + R() * 0.6)); } },
    lane(P, g, w) { const R = rnd(43), pts = []; for (let x = -3.75; x <= 3.75; x += 0.1) pts.push([x, (R() - 0.5) * 0.09]); P.line(pts, w * 1.2); },
    floor(P, g, R) { radial(P, g, 0, 0.3, 9, 'rgba(140,20,15,.45)'); dots(P, g, R, 900, '#ff5a2a', 34, 26, 1, 4); },
    props(b, SW, SH) { corners(SW, SH, (x, y, h, sd, sx) => { for (let k = 0; k < 3; k++) { const hh = h * (1 - k * 0.25); const c = new THREE.Mesh(new THREE.ConeGeometry(0.07, hh, 6), lam(0x231010)); c.position.copy(B(x + (k - 1) * 0.18, y + (k % 2) * 0.12, hh / 2)); c.rotation.z = (k - 1) * 0.35 - sx * 0.05; b.root.add(c); } propLight(b, x, y, h * 0.5, 0xff3a2a, sd); }); } },
  light: { name: 'Light', desc: 'White marble and gold, with rays from the center.', icons: { m: 'barbed-sun', st: 'sparkles' }, bright: true,
    base: '#ddd4c2', slab: 0xb9ad94, bg: '#c9bc9e', glow: 0xffb020, glowCss: '#e0a830', hot: 0xff9a10,
    ink: 'rgba(150,110,40,.32)', zoneFill: 'rgba(255,255,255,.32)', zoneLine: 'rgba(160,120,40,.72)', pileLine: 'rgba(160,120,40,.42)', glyphInk: 'rgba(170,130,50,.28)', label: 'rgba(120,90,30,.8)',
    light: { sky: 0xffffff, ground: 0x8a7a60, hemi: 1.4, key: 0xfff6e6, keyI: 1.05 }, under: 0.3,
    tex(P, g, R, SW, SH) { blobs(P, g, R, 30, ['rgba(255,255,255,.35)', 'rgba(190,170,130,.18)'], SW, SH, 0.4, 1.4); g.strokeStyle = 'rgba(120,110,100,.16)'; for (let k = 0; k < 14; k++) { const x = (R() - 0.5) * SW, y = (R() - 0.5) * SH; curve(P, g, [[x, y], [x + (R() - 0.5) * 2, y + (R() - 0.5) * 1.5], [x + (R() - 0.5) * 3, y + (R() - 0.5) * 2]], 0.008 + R() * 0.01); } },
    deco(P, g, w) { for (let k = 0; k < 20; k++) { const a = k * Math.PI / 10 + 0.08; P.line([[Math.cos(a) * 0.45, Math.sin(a) * 0.3], [Math.cos(a) * 4.4, Math.sin(a) * 2.9]], w * 0.55); } },
    lane(P, g, w) { P.line([[-3.75, 0.06], [3.75, 0.06]], w * 0.7); P.line([[-3.75, -0.06], [3.75, -0.06]], w * 0.7); for (const x of [-3.2, -2.4, -1.6, 1.6, 2.4, 3.2]) { g.beginPath(); g.moveTo(P.X(x), P.Y(0.11)); g.lineTo(P.X(x + 0.07), P.Y(0)); g.lineTo(P.X(x), P.Y(-0.11)); g.lineTo(P.X(x - 0.07), P.Y(0)); g.closePath(); g.lineWidth = P.U(w); g.stroke(); } },
    floor(P, g, R) { radial(P, g, 0, 0.3, 10, 'rgba(255,236,190,.55)'); blobs(P, g, R, 24, ['rgba(255,255,255,.4)', 'rgba(230,200,140,.2)'], 40, 30, 1.5, 4); g.strokeStyle = 'rgba(180,140,60,.12)'; for (let k = 0; k < 28; k++) { const a = k * Math.PI / 14; P.line([[Math.cos(a) * 5.5, Math.sin(a) * 4], [Math.cos(a) * 22, Math.sin(a) * 18]], 0.06); } },
    props(b, SW, SH) { corners(SW, SH, (x, y, h, sd) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, h, 18), lam(0xf4eee2)); c.position.copy(B(x, y, h / 2)); b.root.add(c); for (const z of [0.03, h - 0.03]) { const cap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.36), lam(0xd2a845)); cap.position.copy(B(x, y, z)); b.root.add(cap); } propLight(b, x, y, h + 0.1, 0xffc040, sd); }); } },
  dark: { name: 'Dark', desc: 'A void of ink and shadow, with obelisks at the edge.', icons: { m: 'evil-moon', st: 'ink-swirl' },
    base: '#0f0b17', slab: 0x07050c, bg: '#050309', glow: 0x9a5cff, glowCss: '#9a5cff', hot: 0xd04dff,
    ink: 'rgba(0,0,0,.5)', glowInk: 'rgba(150,90,255,.32)', zoneFill: 'rgba(0,0,0,.38)', zoneLine: 'rgba(180,140,255,.42)', pileLine: 'rgba(180,140,255,.22)', glyphInk: 'rgba(160,110,255,.2)', label: 'rgba(190,160,255,.58)',
    light: { sky: 0xf0e8ff, ground: 0x120a20, hemi: 1.55, key: 0xf6f0ff, keyI: 1.3 }, under: 0.42,
    tex(P, g, R, SW, SH) { blobs(P, g, R, 50, ['rgba(70,30,120,.18)', 'rgba(0,0,0,.35)', 'rgba(120,40,160,.08)'], SW, SH, 0.3, 1.3); },
    deco(P, g, w) { for (const s of [1, -1]) for (let k = 0; k < 3; k++) { const pts = []; for (let t = 0; t <= 1.001; t += 0.05) { const a = t * 4.2 + k * 2.1, r = 0.15 + t * 0.75; pts.push([-3.3 + Math.cos(a) * r * 0.6, -s * 1.3 + Math.sin(a) * r]); } P.line(pts, w * (0.9 - t0(k))); } },
    lane(P, g, w) { const pts = []; for (let x = -3.75; x <= 3.75; x += 0.05) pts.push([x, Math.sin(x * 4) * 0.07]); P.line(pts, w); P.line(pts.map(([x, y]) => [x, -y]), w * 0.6); },
    floor(P, g, R) { radial(P, g, 0, 0.3, 9, 'rgba(80,30,150,.4)'); g.strokeStyle = 'rgba(150,90,255,.05)'; for (let k = 0; k < 4; k++) { const pts = []; for (let t = 0; t < 1; t += 0.01) { const a = t * 12 + k * 1.57, r = 4 + t * 14; pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.8]); } P.line(pts, 0.12); } },
    props(b, SW, SH) { corners(SW, SH, (x, y, h, sd, sx) => { const o = new THREE.Mesh(new THREE.BoxGeometry(0.18, h * 1.1, 0.18), lam(0x0e0b14)); o.position.copy(B(x, y, h * 0.55)); o.rotation.y = sx * 0.3; b.root.add(o); const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.03, h * 0.7), new THREE.MeshBasicMaterial({ color: 0xa070ff })); slit.position.copy(B(x, y, h * 0.6)); slit.rotation.y = o.rotation.y; slit.translateZ(0.092); b.root.add(slit); propLight(b, x, y, h * 0.6, 0x9a5cff, sd); }); } },
};
const t0 = k => k * 0.2;
for (const [id, t] of Object.entries(THEMES)) MATS[id] = { name: t.name, desc: t.desc, layout: 'hex', bg: t.bg, light: t.light, under: t.under, theme: t, glow: t.glow, hot: t.hot };
export const THEME_IDS = Object.keys(THEMES);


/* ---------------------------------------------------------------- the board */
export class Board {
  constructor(T, id, o = {}) {
    this.T = T; this.id = id; this.M = MATS[id]; this.L = LAYOUTS[this.M.layout]; this.phone = !!o.phone; this.rec = o.rec || (() => null);
    this.zones = zonesOf(this.L); this.wfx = []; this.events = []; this.lpv = { 1: 8000, '-1': 8000 }; this.tp = 0; this.ph = -1;
    this.root = new THREE.Group(); T.scene.add(this.root);
    this.lights(); this.world(); this.reactLayer(); this.underlights(); this.turnRims(); this.props(); this.hookTable();
    // the mat waits for the display font so its labels are drawn in it
    const fonts = document.fonts ? Promise.race([Promise.all(['italic 800 40px "Barlow Condensed"', 'italic 900 40px "Barlow Condensed"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 1500))]) : Promise.resolve();
    fonts.catch(() => {}).then(() => { this.paintMat(); T.wake(); });
  }

  /* ----- the scene's light: each board sets its own tone (cards stay near white so they read) */
  lights() {
    const l = this.M.light;
    this.T.scene.traverse(n => {
      if (n.isHemisphereLight) { n.color.setHex(l.sky); n.groundColor.setHex(l.ground); n.intensity = l.hemi; }
      else if (n.isDirectionalLight) { n.color.setHex(l.key); n.intensity = l.keyI; }
    });
  }

  /* ----- the floor around the mat (the world the board sits in) and the mat itself */
  world() {
    const P = new Paper({ x0: -20, x1: 20, y0: -14, y1: 18 }, 40), g = P.g, id = this.id;
    const bg = this.M.bg; g.fillStyle = bg; g.fillRect(0, 0, P.c.width, P.c.height);
    if (id === 'arena') {
      const rg = g.createRadialGradient(P.X(0), P.Y(0.4), 0, P.X(0), P.Y(0.4), P.U(9)); rg.addColorStop(0, 'rgba(46,56,86,.55)'); rg.addColorStop(1, 'rgba(46,56,86,0)'); g.fillStyle = rg; g.fillRect(0, 0, P.c.width, P.c.height);
      g.strokeStyle = 'rgba(140,160,220,.06)'; for (let x = -20; x <= 20; x++) P.line([[x, -14], [x, 18]], 0.02); for (let y = -14; y <= 18; y++) P.line([[-20, y], [20, y]], 0.02);
      // the stadium's own markings beyond the court: two big arcs and the lane carried out to the walls
      g.strokeStyle = 'rgba(255,106,31,.10)'; g.beginPath(); g.arc(P.X(0), P.Y(0), P.U(6.2), Math.PI * 0.08, Math.PI * 0.92); g.lineWidth = P.U(0.05); g.stroke();
      g.strokeStyle = 'rgba(90,168,255,.10)'; g.beginPath(); g.arc(P.X(0), P.Y(0), P.U(6.2), Math.PI * 1.08, Math.PI * 1.92); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.07)'; P.line([[-20, 0], [20, 0]], 0.03);
    } else if (id === 'rewind') {
      // Rewind's world is the den (Zack, 2026-11-26, from the surroundings mock-ups: "i like the first one... just remove the vhs";
      // "i liked the new backdrop and the brighter squares around the board"): a plank floor, a rug in bright bands under the board, a lamp's warm light
      const R = rnd(5);
      g.fillStyle = '#25170e'; g.fillRect(0, 0, P.c.width, P.c.height);
      for (let y = -14; y < 18; y += 0.55) { g.fillStyle = `rgb(${44 + R() * 16},${28 + R() * 10},${17 + R() * 6})`; g.fillRect(0, P.Y(y + 0.55), P.c.width, P.U(0.55)); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, P.Y(y + 0.55), P.c.width, 1.5); for (let x = -20 + R() * 3; x < 20; x += 2.5 + R() * 3) g.fillRect(P.X(x), P.Y(y + 0.55), 1.5, P.U(0.55)); }
      g.strokeStyle = 'rgba(255,220,180,.05)'; for (let k = 0; k < 260; k++) { const x = (R() - 0.5) * 40, y = (R() - 0.5) * 32; P.line([[x, y], [x + 1 + R() * 2, y + (R() - 0.5) * 0.05]], 0.012); }
      const band = (w, h, c) => { P.rr(0, 0.15, w, h, 0.05); g.fillStyle = c; g.fill(); };
      band(10.4, 7.2, '#7a3218'); band(10.0, 6.8, '#d9c3a0'); band(9.8, 6.6, '#4a2416'); band(9.3, 6.1, '#b4532a'); band(9.1, 5.9, '#3a1d13');
      g.strokeStyle = 'rgba(217,195,160,.14)'; for (let x = -4.4; x <= 4.4; x += 0.55) for (const y of [-2.8, 3.1]) { g.beginPath(); g.moveTo(P.X(x), P.Y(y + 0.15)); g.lineTo(P.X(x + 0.22), P.Y(y)); g.lineTo(P.X(x), P.Y(y - 0.15)); g.lineTo(P.X(x - 0.22), P.Y(y)); g.closePath(); g.lineWidth = 2; g.stroke(); }
      const rg = g.createRadialGradient(P.X(0), P.Y(0.5), 0, P.X(0), P.Y(0.5), P.U(9)); rg.addColorStop(0, 'rgba(255,170,90,.16)'); rg.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = rg; g.fillRect(0, 0, P.c.width, P.c.height);
    } else if (this.M.theme) { this.M.theme.floor(P, g, rnd(17));
    } else {
      const rg = g.createRadialGradient(P.X(0), P.Y(0.3), 0, P.X(0), P.Y(0.3), P.U(9)); rg.addColorStop(0, 'rgba(40,74,70,.5)'); rg.addColorStop(1, 'rgba(40,74,70,0)'); g.fillStyle = rg; g.fillRect(0, 0, P.c.width, P.c.height);
      // broken flagstones fading into the dark
      const R = rnd(7); g.strokeStyle = 'rgba(160,220,210,.05)';
      for (let y = -14; y < 18; y += 1.1) for (let x = -20 + (y * 7 % 1.3); x < 20; x += 1.3 + R() * 0.8) { P.rr(x, y, 1.1 + R() * 0.5, 0.95, 0.05); g.lineWidth = P.U(0.03); g.stroke(); }
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 32), new THREE.MeshBasicMaterial({ map: P.tex(this.T.renderer), depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.copy(B(0, 2, -0.004)); floor.renderOrder = -3; this.root.add(floor);
    // the mat: painted once the font is in (paintMat); a plain slab until then
    this.mat = new THREE.Mesh(new THREE.PlaneGeometry(MAT_R.x1 - MAT_R.x0, MAT_R.y1 - MAT_R.y0), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 1 }));
    this.mat.rotation.x = -Math.PI / 2; this.mat.position.copy(B((MAT_R.x0 + MAT_R.x1) / 2, (MAT_R.y0 + MAT_R.y1) / 2, -0.002)); this.mat.renderOrder = -2; this.root.add(this.mat);
    // a raised edge under the mat, so the board is a slab sitting in its world (the diorama feel)
    const slab = this.slab = this.M.theme ? [7.8, 4.9, this.M.theme.slab] : { arena: [7.8, 4.9, 0x0b0d13], rewind: [7.5, 4.95, 0x1d1613], rune: [7.8, 4.9, 0x15181b] }[id];
    const s = new THREE.Mesh(new THREE.BoxGeometry(slab[0] + 0.14, 0.12, slab[1] + 0.14), new THREE.MeshLambertMaterial({ color: slab[2] }));
    s.position.copy(B(0, 0, -0.064)); this.root.add(s);
  }
  paintMat() {
    const P = new Paper(MAT_R, this.phone ? 300 : 380), g = P.g, id = this.id, [SW, SH] = this.slab;
    if (this.M.theme) this.paintTheme(P, g, SW, SH); else if (id === 'arena') this.paintArena(P, g, SW, SH); else if (id === 'rewind') this.paintRewind(P, g, SW, SH); else this.paintRune(P, g, SW, SH);
    const old = this.mat.material.map; this.mat.material.map = P.tex(this.T.renderer); this.mat.material.needsUpdate = true; if (old) old.dispose();
  }
  pileLabels(P, g, color) {
    g.fillStyle = color;
    for (const z of this.zones) if (z.zone in PILE_LABEL) { const s = z.side, ly = z.y - s * (ZH / 2 + 0.1); P.text(PILE_LABEL[z.zone], z.x, ly, 0.1, s === 1 ? 0 : Math.PI); }
  }
  paintArena(P, g, SW, SH) {
    // the court: black glass with a fine dot grid, your near edge orange, theirs blue
    P.rr(0, 0, SW, SH, 0.3); const cg = g.createLinearGradient(0, P.Y(SH / 2), 0, P.Y(-SH / 2)); cg.addColorStop(0, '#0a0d16'); cg.addColorStop(0.5, '#11141d'); cg.addColorStop(1, '#0d0f16'); g.fillStyle = cg; g.fill();
    g.save(); g.clip(); g.fillStyle = 'rgba(255,255,255,.07)';
    for (let x = -SW / 2; x < SW / 2; x += 0.1) for (let y = -SH / 2; y < SH / 2; y += 0.1) { g.fillRect(P.X(x + 0.05) - 1.5, P.Y(y + 0.05) - 1.5, 3, 3); }
    const sheen = g.createLinearGradient(P.X(-SW / 2), 0, P.X(SW / 2), 0); sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.42, 'rgba(255,255,255,.035)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0)'); g.fillStyle = sheen; g.fillRect(0, 0, P.c.width, P.c.height);
    g.restore();
    g.lineWidth = P.U(0.025); g.strokeStyle = 'rgba(160,175,220,.35)'; P.rr(0, 0, SW, SH, 0.3); g.stroke();
    for (const [s, c] of [[1, YOU], [-1, THEM]]) { g.strokeStyle = rgba(c, 0.9); g.shadowColor = hex(c); g.shadowBlur = P.U(0.12); P.line([[-SW / 2 + 0.5, -s * SH / 2], [SW / 2 - 0.5, -s * SH / 2]], 0.04); g.shadowBlur = 0; }
    // the battle lane: carried past the court's edge like a halfway line, with the phase strip in the middle
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(P.X(-SW / 2), P.Y(0.2), P.U(SW), P.U(0.4));
    g.strokeStyle = rgba(THEM, 0.55); P.line([[-4.4, 0.2], [4.4, 0.2]], 0.016); g.strokeStyle = rgba(YOU, 0.55); P.line([[-4.4, -0.2], [4.4, -0.2]], 0.016);
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.setLineDash([P.U(0.08), P.U(0.06)]); P.line([[-4.4, 0], [4.4, 0]], 0.012); g.setLineDash([]);
    this.phaseX = PHASES.map((_, k) => (k - 2.5) * 0.66);
    PHASES.forEach((_, k) => { const x = this.phaseX[k]; P.rr(x, 0, 0.6, 0.17, 0.03); g.fillStyle = 'rgba(8,10,16,.9)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = P.U(0.01); g.stroke(); g.fillStyle = 'rgba(255,255,255,.42)'; P.text(PH_LABEL[k], x, 0, 0.1); });
    // zones: framed glass tiles; monster zones carry a slanted bar in the owner's color at their near edge
    for (const z of this.zones) {
      const s = z.side, col = s === 1 ? YOU : THEM;
      P.rr(z.x, z.y, ZW, ZH, 0.05); g.fillStyle = z.pile ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.04)'; g.fill();
      g.lineWidth = P.U(0.012); g.strokeStyle = z.pile ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.34)'; if (z.pile) g.setLineDash([P.U(0.05), P.U(0.04)]); g.stroke(); g.setLineDash([]);
      P.rr(z.x, z.y, ZW - 0.07, ZH - 0.07, 0.035); g.strokeStyle = 'rgba(255,255,255,.07)'; g.stroke();
      if (z.zone === 'm') { g.save(); g.translate(P.X(z.x), P.Y(z.y - s * (ZH / 2 - 0.05))); g.transform(1, 0, -0.35, 1, 0, 0); g.fillStyle = rgba(col, 0.75); g.fillRect(-P.U(0.11), -P.U(0.014), P.U(0.22), P.U(0.028)); g.restore(); }
      if (z.zone === 'st') { g.fillStyle = 'rgba(255,255,255,.18)'; for (const dx of [-0.06, 0, 0.06]) g.fillRect(P.X(z.x + dx) - 3, P.Y(z.y - s * (ZH / 2 - 0.05)) - 3, 6, 6); }
    }
    this.pileLabels(P, g, 'rgba(255,255,255,.55)');
  }
  paintRewind(P, g, SW, SH) {
    // the deck: matte charcoal with a fine speckle, cream screen-printed lines, a lighter bevel round the edge
    P.rr(0, 0, SW, SH, 0.22); g.fillStyle = '#1a1411'; g.fill();
    g.save(); g.clip(); const R = rnd(3); for (let n = 0; n < 9000; n++) { g.fillStyle = `rgba(255,240,220,${0.02 + R() * 0.03})`; g.fillRect(R() * P.c.width, R() * P.c.height, 2, 2); }
    const vg = g.createRadialGradient(P.X(0), P.Y(0), P.U(1.5), P.X(0), P.Y(0), P.U(5)); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.35)'); g.fillStyle = vg; g.fillRect(0, 0, P.c.width, P.c.height); g.restore();
    g.lineWidth = P.U(0.05); g.strokeStyle = '#3a2d26'; P.rr(0, 0, SW - 0.05, SH - 0.05, 0.2); g.stroke();
    g.lineWidth = P.U(0.012); g.strokeStyle = 'rgba(239,227,207,.35)'; P.rr(0, 0, SW - 0.24, SH - 0.24, 0.14); g.stroke();
    // the tape window across the middle: the dial and both reels sit in it (separate meshes that turn)
    P.rr(0, 0, 6.7, 0.6, 0.3); g.fillStyle = '#0d0a09'; g.fill(); g.strokeStyle = 'rgba(239,227,207,.5)'; g.lineWidth = P.U(0.014); g.stroke();
    g.strokeStyle = 'rgba(255,91,31,.8)'; P.line([[-3.0, -0.24], [-0.45, -0.24]], 0.012); P.line([[0.45, -0.24], [3.0, -0.24]], 0.012);
    g.strokeStyle = rgba(THEM, 0.7); P.line([[-3.0, 0.24], [-0.45, 0.24]], 0.012); P.line([[0.45, 0.24], [3.0, 0.24]], 0.012);
    g.fillStyle = 'rgba(239,227,207,.45)'; P.text('PLAY  ·  A SIDE', -1.15, 0, 0.09); P.text('B SIDE  ·  PLAY', 1.15, 0, 0.09, Math.PI);
    // the dial's pointer: a fixed orange notch above the dial
    g.fillStyle = '#ff5b1f'; g.beginPath(); g.moveTo(P.X(-0.05), P.Y(0.33)); g.lineTo(P.X(0.05), P.Y(0.33)); g.lineTo(P.X(0), P.Y(0.27)); g.closePath(); g.fill();
    // zones: cream outlines with a label tab at one corner, like a tape label
    for (const z of this.zones) {
      const s = z.side, col = s === 1 ? 0xff5b1f : THEM;
      P.rr(z.x, z.y, ZW, ZH, 0.03); g.fillStyle = 'rgba(0,0,0,.22)'; g.fill(); g.lineWidth = P.U(0.012); g.strokeStyle = z.pile ? 'rgba(239,227,207,.3)' : 'rgba(239,227,207,.55)'; g.stroke();
      const tx = z.x - s * (ZW / 2 - 0.09), ty = z.y - s * (ZH / 2 - 0.05); P.rr(tx, ty, 0.12, 0.05, 0.01); g.fillStyle = z.pile ? 'rgba(239,227,207,.35)' : rgba(col, 0.85); g.fill();
      if (z.zone === 'st') { g.strokeStyle = 'rgba(239,227,207,.18)'; P.line([[z.x - 0.2, z.y], [z.x + 0.2, z.y]], 0.01); }
    }
    this.pileLabels(P, g, 'rgba(239,227,207,.6)');
  }
  // the channel network, shared by the mat painting and the reaction mask
  runeNet(P, g, mode, k = 1) {
    const lw = (mode === 'mask' ? 0.05 : 0.045) * k, R = rnd(11);
    g.lineCap = 'round'; g.lineJoin = 'round';
    // the rift along the center line, carried out to the slab's edge
    P.line([[-3.9, 0], [3.9, 0]], lw * 1.3);
    for (const z of this.zones) {
      const s = z.side;
      if (z.zone === 'm') { P.line([[z.x, z.y + s * ZH / 2], [z.x, 0]], lw); }
      if (z.zone === 'st') { P.line([[z.x, z.y + s * ZH / 2], [z.x, z.y + s * (ZH / 2 + 0.13)]], lw); }
      if (['gy', 'ban', 'fz'].includes(z.zone)) P.line([[z.x, z.y + s * ZH / 2], [z.x, 0]], lw * 0.8);
      if (['deck', 'extra'].includes(z.zone)) P.line([[z.x, z.y + s * ZH / 2], [z.x, z.y + s * (ZH / 2 + 0.13)]], lw * 0.8);
    }
    // a groove round each side's zones
    for (const s of [1, -1]) { const zs = this.zones.filter(z => z.side === s), ys = zs.map(z => z.y), xs = zs.map(z => z.x); const y0 = Math.min(...ys) - ZH / 2 - 0.1, y1 = Math.max(...ys) + ZH / 2 + 0.1, x0 = Math.min(...xs) - ZW / 2 - 0.1, x1 = Math.max(...xs) + ZW / 2 + 0.1; P.rr((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 0.2); g.lineWidth = P.U(lw * 0.8); g.stroke(); }
    void R;
  }
  runeGlyph(P, g, z, lw) { zoneIcon(P, g, z, RUNE_ICONS); }   // game-icons.net icons since 2026-11-26 (Zack: "actual icons")
  paintRune(P, g, SW, SH) {
    // stone: mottled basalt, darker toward the rim
    P.rr(0, 0, SW, SH, 0.35); g.fillStyle = '#1b1f22'; g.fill();
    g.save(); g.clip(); const R = rnd(5);
    for (let n = 0; n < 1400; n++) { const x = (R() - 0.5) * SW, y = (R() - 0.5) * SH, r = 0.05 + R() * 0.35; g.fillStyle = R() < 0.5 ? `rgba(255,255,255,${0.012 + R() * 0.02})` : `rgba(0,0,0,${0.04 + R() * 0.06})`; g.beginPath(); g.ellipse(P.X(x), P.Y(y), P.U(r), P.U(r * (0.5 + R() * 0.6)), R() * 3, 0, 7); g.fill(); }
    const vg = g.createRadialGradient(P.X(0), P.Y(0), P.U(1.8), P.X(0), P.Y(0), P.U(4.8)); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = vg; g.fillRect(0, 0, P.c.width, P.c.height); g.restore();
    g.lineWidth = P.U(0.06); g.strokeStyle = '#2c3236'; P.rr(0, 0, SW - 0.06, SH - 0.06, 0.32); g.stroke();
    // carved channels: a dark groove with a faint teal glow inside
    g.strokeStyle = 'rgba(0,0,0,.55)'; this.runeNet(P, g, 'groove');
    g.save(); g.shadowColor = '#36e0c0'; g.shadowBlur = P.U(0.05); g.strokeStyle = 'rgba(54,224,192,.32)'; g.globalCompositeOperation = 'lighter';
    this.runeNet(P, g, 'groove', 0.35); g.restore();
    // zones: recessed stone with a light lower edge and a dark upper edge, and a faint carved rune
    for (const z of this.zones) {
      P.rr(z.x, z.y, ZW, ZH, 0.06); g.fillStyle = 'rgba(0,0,0,.32)'; g.fill();
      g.lineWidth = P.U(0.016); g.strokeStyle = 'rgba(0,0,0,.6)'; P.rr(z.x - 0.008, z.y + 0.008, ZW, ZH, 0.06); g.stroke();
      g.strokeStyle = z.pile ? 'rgba(170,230,215,.18)' : 'rgba(170,230,215,.3)'; P.rr(z.x + 0.006, z.y - 0.006, ZW, ZH, 0.06); g.stroke();
      if (!z.pile) { g.strokeStyle = 'rgba(54,224,192,.16)'; this.runeGlyph(P, g, z, 0.018); }
    }
    this.pileLabels(P, g, 'rgba(170,230,215,.5)');
  }
  // Runestone's reaction mask: R channels, G cracks, B runes
  runeMask() {
    const P = new Paper(MAT_R, 150), g = P.g; g.fillStyle = '#000'; g.fillRect(0, 0, P.c.width, P.c.height); g.globalCompositeOperation = 'lighter';
    g.strokeStyle = '#ff0000'; g.shadowColor = '#ff0000'; g.shadowBlur = 5; this.runeNet(P, g, 'mask'); g.shadowBlur = 0;
    const R = rnd(23);
    for (const z of this.zones) {
      g.strokeStyle = '#00ff00'; g.lineWidth = 2;
      for (let n = 0; n < 4; n++) { let x = z.x + (R() - 0.5) * 0.1, y = z.y + (R() - 0.5) * 0.1; const a = R() * 6.28; g.beginPath(); g.moveTo(P.X(x), P.Y(y)); for (let s = 0; s < 6; s++) { x += Math.cos(a + (R() - 0.5) * 1.2) * 0.07; y += Math.sin(a + (R() - 0.5) * 1.2) * 0.09; g.lineTo(P.X(x), P.Y(y)); } g.stroke(); }
      g.strokeStyle = '#0000ff'; this.runeGlyph(P, g, z, 0.035);
    }
    const t = new THREE.CanvasTexture(P.c); t.colorSpace = THREE.NoColorSpace; return t;
  }

  // a themed mat: base, texture, the channel network and the theme's lane and decoration in its ink, then lit; zones and their marks
  paintTheme(P, g, SW, SH) {
    const T = this.M.theme, R = rnd(5);
    P.rr(0, 0, SW, SH, 0.3); g.fillStyle = T.base; g.fill();
    g.save(); g.clip(); T.tex(P, g, R, SW, SH);
    const vg = g.createRadialGradient(P.X(0), P.Y(0), P.U(1.8), P.X(0), P.Y(0), P.U(4.8)); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, T.bright ? 'rgba(80,60,30,.18)' : 'rgba(0,0,0,.42)'); g.fillStyle = vg; g.fillRect(0, 0, P.c.width, P.c.height);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = T.ink; this.runeNet(P, g, 'groove', T.bright ? 0.5 : 1); T.deco(P, g, 0.03); T.lane(P, g, 0.03, 'mat');
    if (T.glowInk) { g.shadowColor = T.glowCss; g.shadowBlur = P.U(0.05); g.strokeStyle = T.glowInk; g.globalCompositeOperation = 'lighter'; this.runeNet(P, g, 'groove', 0.32); T.deco(P, g, 0.012); T.lane(P, g, 0.012, 'glow'); }
    g.restore();
    g.lineWidth = P.U(0.06); g.strokeStyle = T.bright ? 'rgba(90,70,40,.5)' : 'rgba(255,255,255,.08)'; P.rr(0, 0, SW - 0.06, SH - 0.06, 0.28); g.stroke();
    for (const z of this.zones) {
      if (T.shadow) { P.rr(z.x + 0.03, z.y - 0.03, ZW, ZH, 0.05); g.fillStyle = 'rgba(22,17,14,.35)'; g.fill(); }
      P.rr(z.x, z.y, ZW, ZH, 0.05); g.fillStyle = T.zoneFill; g.fill(); g.lineWidth = P.U(T.zoneW || 0.014); g.strokeStyle = z.pile ? T.pileLine : T.zoneLine; g.stroke();
      if (!z.pile) { g.strokeStyle = T.glyphInk; themeGlyph(P, g, z, 0.018, T.icons); }
    }
    this.pileLabels(P, g, T.label);
  }
  // a theme's reaction mask, like Runestone's: R its lines (channels, lane, decoration), G cracks, B the zone marks
  themeMask() {
    const T = this.M.theme, P = new Paper(MAT_R, 150), g = P.g; g.fillStyle = '#000'; g.fillRect(0, 0, P.c.width, P.c.height); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    g.strokeStyle = '#ff0000'; g.shadowColor = '#ff0000'; g.shadowBlur = 5; this.runeNet(P, g, 'mask'); T.deco(P, g, 0.05); T.lane(P, g, 0.05, 'mask'); g.shadowBlur = 0;
    const R = rnd(23);
    for (const z of this.zones) {
      g.strokeStyle = '#00ff00'; g.lineWidth = 2;
      for (let n = 0; n < 4; n++) { let x = z.x + (R() - 0.5) * 0.1, y = z.y + (R() - 0.5) * 0.1; const a = R() * 6.28; g.beginPath(); g.moveTo(P.X(x), P.Y(y)); for (let s = 0; s < 6; s++) { x += Math.cos(a + (R() - 0.5) * 1.2) * 0.07; y += Math.sin(a + (R() - 0.5) * 1.2) * 0.09; g.lineTo(P.X(x), P.Y(y)); } g.stroke(); }
      if (!z.pile) { g.strokeStyle = '#0000ff'; themeGlyph(P, g, z, 0.035, T.icons); }
    }
    const t = new THREE.CanvasTexture(P.c); t.colorSpace = THREE.NoColorSpace; return t;
  }

  /* ----- reactions: the floor shader and its events */
  reactLayer() {
    const A = [], Bv = [], C = [];
    for (let i = 0; i < 8; i++) { A.push(new THREE.Vector4()); Bv.push(new THREE.Vector4()); C.push(new THREE.Vector3()); }
    const T = this.M.theme, mask = this.id === 'rune' ? this.runeMask() : T && T.shader !== 'toon' ? this.themeMask() : null;
    this.fxu = { uTime: { value: 0 }, uA: { value: A }, uB: { value: Bv }, uC: { value: C }, uMask: { value: mask }, uMR: { value: new THREE.Vector4(MAT_R.x0, MAT_R.y0, MAT_R.x1 - MAT_R.x0, MAT_R.y1 - MAT_R.y0) } };
    const [SW, SH] = this.slab;
    const m = this.fxm = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.ShaderMaterial(Object.assign({ uniforms: this.fxu, vertexShader: VERT, fragmentShader: FRAG[T ? T.shader || 'theme' : this.id], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending },
      T ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor } : {})));
    m.rotation.x = -Math.PI / 2; m.position.copy(B(0, 0, 0.0015)); m.visible = false; m.renderOrder = -1; this.root.add(m);
  }
  // fire one reaction: kind (see FRAG), at board point o, toward t, on side sd, in a color, over ms
  fire(kind, o, t, sd, color, ms) {
    if (this.events.length >= 8) this.events.shift().done = true;
    const e = { kind, k: 0, o, t: t || o, sd, c: new THREE.Color(color) }; this.events.push(e); this.sync();
    return this.T.tween(ms, k => { e.k = k; this.fxu.uTime.value = performance.now() / 1000; this.sync(); }, x => x).then(() => { e.done = true; this.events = this.events.filter(x => x !== e); this.sync(); });
  }
  sync() {
    const u = this.fxu; this.events = this.events.filter(e => !e.done);
    for (let i = 0; i < 8; i++) { const e = this.events[i];
      if (!e) { u.uA.value[i].set(0, 0, 0, 0); continue; }
      u.uA.value[i].set(e.kind, e.k, e.o[0], e.o[1]); u.uB.value[i].set(e.t[0], e.t[1], 0, e.sd); u.uC.value[i].set(e.c.r, e.c.g, e.c.b); }
    this.fxm.visible = this.events.length > 0;
  }
  bp(v) { return v ? [v.x, -v.z] : [0, 0]; }   // a world point to board units
  colorOf(id) { const r = id != null && this.rec(id); return r && ATTR[r.a] ? ATTR[r.a] : r && r.k === 'spell' ? 0x2fbf8f : r && r.k === 'trap' ? 0xd04fa0 : 0xff8a3d; }

  /* ----- the hooks the duel calls */
  summon(pos, id, big) {
    const o = this.bp(pos), sd = o[1] < 0 ? 1 : -1, col = this.colorOf(id);
    this.fire(big ? 2 : 1, o, null, sd, col, big ? 1500 : 950);
    if (big) this.flare(sd, col);
    this.wfxRun(big ? 'big' : 'summon', col, sd);
    if (this.id === 'rewind') this.spinReels(big ? 2 : 0.8, 900);
  }
  activate(pos, id) { const o = this.bp(pos); this.fire(5, o, null, o[1] < 0 ? 1 : -1, this.colorOf(id), 900); }
  attack(from, to, sd) {
    const o = this.bp(from), t = to ? this.bp(to) : [o[0] * 0.3, sd * 2.4];
    this.fire(3, o, t, sd, sd === 1 ? 0xffb070 : 0x9fd0ff, 640); this.wfxRun('attack', 0, sd);
    if (this.id === 'rewind') this.spinReels(0.6, 600);
  }
  hit(pos) { const o = this.bp(pos); this.fire(7, o, null, o[1] < 0 ? 1 : -1, 0xfff0dc, 520); }
  destroy(pos) { const o = this.bp(pos); this.fire(4, o, null, o[1] < 0 ? 1 : -1, this.M.hot || (this.id === 'rune' ? 0xff7a4a : 0xff4a3a), 700); }
  damage(sd, n, lp) {
    this.lp(sd, lp);
    this.fire(6, [0, 0], null, sd, DANGER, n >= 1000 ? 900 : 600); this.wfxRun('hit', DANGER, sd);
    if (n >= 1000) this.flare(sd, DANGER);
  }
  wfxRun(kind, col, sd) { for (const f of this.wfx) f(kind, col, sd); }   // the world's own answers (Rewind's surroundings)
  lp(sd, lp) { this.lpv[sd] = lp; this.rimColor(); }
  turn(sd) {
    this.tp = sd; this.rimColor(); this.fade(this.rims[1], sd === 1 ? 0.55 : 0.08, 500); this.fade(this.rims[-1], sd === -1 ? 0.55 : 0.08, 500);
    this.fire(6, [0, 0], null, sd, sd === 1 ? YOU : THEM, 900);
    if (this.id === 'rewind') { this.rewindDial(); this.spinReels(-3, 1100); }
    if (this.stones) this.lightStones(sd === 1 ? YOU : THEM, sd);
  }
  phase(ph, sd) {
    const k = Math.max(0, PHASES.indexOf(ph === 'start' ? 'draw' : ph)); if (k === this.ph && sd === this.tp) return; this.ph = k;
    const col = sd === 1 ? YOU : THEM;
    if (this.phaseMark) { const m = this.phaseMark; m.material.color.setHex(col); const x0 = m.position.x, x1 = this.phaseX[k]; this.T.tween(320, e => { m.position.x = x0 + (x1 - x0) * e; }); this.fade(m, 0.9, 200); }
    if (this.dial) { const r0 = this.dial.rotation.z, r1 = this.dialBase - k * Math.PI / 3; this.T.tween(420, e => { this.dial.rotation.z = r0 + (r1 - r0) * e; }); }
    if (this.glyphs) this.glyphs.forEach((m, j) => { m.material.color.setHex(col); this.fade(m, j === k ? 0.95 : 0.12, 300); });
  }
  reset() { this.lpv = { 1: 8000, '-1': 8000 }; this.ph = -1; this.rimColor(); this.events.forEach(e => (e.done = true)); this.sync(); this.refresh(); }

  /* ----- lasting state: a glow under each occupied zone, the turn player's half, low LP */
  underlights() {
    const tex = glowTex(256, 330, 56, 30); this.under = new Map();
    for (const z of this.zones) {
      if (!['m', 'st', 'fz'].includes(z.zone)) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ZW + 0.55, ZH + 0.55), new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.copy(B(z.x, z.y, 0.001)); m.visible = false; this.root.add(m); this.under.set(`${z.side}:${z.zone}:${z.i}`, m);
    }
  }
  refresh() {
    const want = new Map();
    for (const c of this.T.cards.values()) if (['m', 'st', 'fz'].includes(c.zone)) want.set(`${c.side}:${c.zone}:${c.i || 0}`, c.up ? this.colorOf(c.id) : 0xbfc6d4);
    for (const [k, m] of this.under) {
      const col = want.get(k);
      if (col != null) { m.material.color.setHex(col); this.fade(m, col === 0xbfc6d4 ? 0.22 : this.M.under, 380); }
      else if (m.visible) this.fade(m, 0, 300);
    }
  }
  turnRims() {
    const [SW, SH] = this.slab, mk = sd => {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 360; const g = c.getContext('2d');
      g.shadowColor = '#fff'; g.shadowBlur = 40; g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.roundRect(36, 36, 952, 288, 40); g.stroke(); g.stroke();
      const t = new THREE.CanvasTexture(c);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(SW + 0.3, SH / 2 + 0.15), new THREE.MeshBasicMaterial({ map: t, color: sd === 1 ? YOU : THEM, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.copy(B(0, -sd * SH / 4, 0.0012)); m.visible = false; this.root.add(m); return m;
    };
    this.rims = { 1: mk(1), '-1': mk(-1) };
  }
  rimColor() { for (const sd of [1, -1]) { const danger = this.lpv[sd] > 0 && this.lpv[sd] <= 2000; this.rims[sd].material.color.setHex(danger ? DANGER : sd === 1 ? YOU : THEM); if (danger && this.rims[sd].material.opacity < 0.3) this.fade(this.rims[sd], 0.4, 400); } }
  fade(m, to, ms) { const a = m.material.opacity; if (to > 0) m.visible = true; return this.T.tween(ms, k => { m.material.opacity = a + (to - a) * k; }).then(() => { if (to <= 0) m.visible = false; }); }

  /* ----- props on the rim: each board's scenery, and the parts that react */
  props() {
    const [SW, SH] = this.slab; this.flares = { 1: [], '-1': [] };
    if (this.M.theme) {
      const T = this.M.theme; this.stones = { 1: [], '-1': [] }; T.props(this, SW, SH);
      this.glyphs = PHASES.map((_, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: glowTex(64, 64, 14, 30), color: YOU, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.copy(B((k - 2.5) * 0.5, 0, 0.0018)); this.root.add(m); return m; });
    } else if (this.id === 'arena') {
      // four light pylons at the court's corners, and a long LED board behind the far side
      const body = new THREE.MeshLambertMaterial({ color: 0x14171f });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = sx * (SW / 2 + 0.42), y = sy * (SH / 2 + 0.3), col = sy < 0 ? YOU : THEM, h = sy < 0 ? 0.55 : 1.15;
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, h, 0.2), body); p.position.copy(B(x, y, h / 2)); this.root.add(p);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.86, 0.21), new THREE.MeshBasicMaterial({ color: col })); strip.position.copy(B(x - sx * 0.08, y, h / 2)); this.root.add(strip);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.26), new THREE.MeshBasicMaterial({ color: 0xffffff })); cap.position.copy(B(x, y, h + 0.03)); this.root.add(cap);
        const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 3.2), new THREE.MeshBasicMaterial({ map: this.beamTex(), color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.copy(B(x, y, h + 1.6)); beam.lookAt(this.T.camera.position.x, beam.position.y, this.T.camera.position.z); beam.visible = false; this.root.add(beam);
        this.flares[sy < 0 ? 1 : -1].push(beam);
      }
      const wall = new THREE.Mesh(new THREE.BoxGeometry(SW + 0.6, 0.3, 0.08), body); wall.position.copy(B(0, SH / 2 + 1.5, 0.15)); this.root.add(wall);
      const led = new THREE.Mesh(new THREE.PlaneGeometry(SW + 0.5, 0.24), new THREE.MeshBasicMaterial({ map: this.ledTex(), transparent: true, opacity: 0.7 })); led.position.copy(B(0, SH / 2 + 1.45, 0.15)); this.root.add(led);
      this.ledFlash = new THREE.Mesh(new THREE.PlaneGeometry(SW + 0.5, 0.24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); this.ledFlash.position.copy(B(0, SH / 2 + 1.44, 0.152)); this.ledFlash.visible = false; this.root.add(this.ledFlash);
      // the phase marker: a lit tile behind the strip's label
      this.phaseX = PHASES.map((_, k) => (k - 2.5) * 0.66);
      this.phaseMark = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.4), new THREE.MeshBasicMaterial({ map: glowTex(256, 132, 24, 10), color: YOU, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.phaseMark.rotation.x = -Math.PI / 2; this.phaseMark.position.copy(B(this.phaseX[0], 0, 0.0018)); this.phaseMark.visible = false; this.root.add(this.phaseMark);
    } else if (this.id === 'rewind') {
      // the dial in the tape window (turns with the phase, spins back on a new turn) and two reels (the stacked tapes were removed: Zack, 2026-11-26)
      this.dial = new THREE.Mesh(new THREE.CircleGeometry(0.29, 64), new THREE.MeshBasicMaterial({ map: this.dialTex(), transparent: true }));
      this.dial.rotation.x = -Math.PI / 2; this.dial.position.copy(B(0, 0, 0.0016)); this.dialBase = 0; this.root.add(this.dial);
      this.reels = [-2.3, 2.3].map(x => { const r = new THREE.Mesh(new THREE.CircleGeometry(0.25, 48), new THREE.MeshBasicMaterial({ map: this.reelTex(), transparent: true })); r.rotation.x = -Math.PI / 2; r.position.copy(B(x, 0, 0.0016)); this.root.add(r); return r; });
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshBasicMaterial({ map: glowTex(256, 256, 60, 120), color: 0xff5b1f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2; glow.position.copy(B(0, 0, 0.0014)); glow.visible = false; this.root.add(glow); this.flares[1].push(glow); this.flares[-1].push(glow);
    } else {
      // standing stones at the corners: their carved rune lights for the turn player and flares on big summons
      const stone = new THREE.MeshLambertMaterial({ color: 0x3a4044 }); this.stones = { 1: [], '-1': [] };
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = sx * (SW / 2 + 0.45), y = sy * (SH / 2 + 0.22), h = sy < 0 ? 0.6 : 1.25;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.34, h, 0.24), stone); s.position.copy(B(x, y, h / 2)); s.rotation.y = sx * 0.25; s.rotation.z = sx * 0.04; this.root.add(s);
        const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.24, Math.min(0.6, h * 0.55)), new THREE.MeshBasicMaterial({ map: this.stoneRuneTex(), color: 0x36e0c0, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
        rune.position.copy(B(x, y, h * 0.55)); rune.rotation.copy(s.rotation); rune.translateZ(0.125); this.root.add(rune); this.stones[sy < 0 ? 1 : -1].push(rune);
        const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 3.0), new THREE.MeshBasicMaterial({ map: this.beamTex(), color: 0x36e0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.copy(B(x, y, h + 1.4)); beam.lookAt(this.T.camera.position.x, beam.position.y, this.T.camera.position.z); beam.visible = false; this.root.add(beam); this.flares[sy < 0 ? 1 : -1].push(beam);
      }
      // the phase: six small rune lights along the rift
      this.glyphs = PHASES.map((_, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: glowTex(64, 64, 14, 30), color: YOU, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.copy(B((k - 2.5) * 0.5, 0, 0.0018)); this.root.add(m); return m; });
    }
  }
  flare(sd, col) {
    for (const m of this.flares[sd] || []) { m.material.color.setHex(col); m.visible = true; const s0 = 0.6; this.T.tween(1100, k => { m.material.opacity = Math.sin(Math.PI * Math.min(1, k * 1.4)) * 0.85 * (1 - k * 0.4); m.scale.set(s0 + k * 0.6, 1, 1); }).then(() => { m.material.opacity = 0; m.visible = false; }); }
    if (this.ledFlash) { this.ledFlash.material.color.setHex(col); this.ledFlash.visible = true; this.T.tween(700, k => { this.ledFlash.material.opacity = 0.55 * (1 - k); }).then(() => { this.ledFlash.visible = false; }); }
    if (this.stones) for (const r of this.stones[sd]) { r.material.color.setHex(col); this.T.tween(900, k => { r.material.opacity = 0.18 + 0.8 * Math.sin(Math.PI * k); }); }
  }
  lightStones(col, sd) { if (!this.stones) return; for (const s of [1, -1]) for (const r of this.stones[s]) { r.material.color.setHex(s === sd ? col : this.M.glow || 0x36e0c0); this.fade(r, s === sd ? 0.75 : 0.15, 600); } }
  rewindDial() { if (!this.dial) return; const r0 = this.dial.rotation.z; this.dialBase = r0 + 2 * Math.PI; this.T.tween(1000, k => { this.dial.rotation.z = r0 + 2 * Math.PI * k; }); this.ph = -1; }
  spinReels(turns, ms) { if (!this.reels) return; for (const r of this.reels) { const a = r.rotation.z; this.T.tween(ms, k => { r.rotation.z = a + turns * 2 * Math.PI * k; }); } }

  /* ----- small textures for the props */
  beamTex() { if (this._beam) return this._beam; const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,.95)'); const gx = g.createLinearGradient(0, 0, 64, 0); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); g.globalCompositeOperation = 'destination-in'; gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.5, '#000'); gx.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gx; g.fillRect(0, 0, 64, 256); return (this._beam = new THREE.CanvasTexture(c)); }
  ledTex() {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 96; const g = c.getContext('2d'); g.fillStyle = '#07080c'; g.fillRect(0, 0, 2048, 96);
    g.font = 'italic 900 64px "Barlow Condensed", sans-serif'; g.textBaseline = 'middle'; let x = 20, k = 0;
    while (x < 2048) { const s = ['LEARN RETRO', 'PLAY', 'DUEL', 'LIVE'][k % 4]; g.fillStyle = k % 2 ? '#ff6a1f' : '#f4f6ff'; g.fillText(s, x, 50); x += g.measureText(s).width + 26; g.fillStyle = '#5aa8ff'; g.fillRect(x, 40, 12, 12); x += 38; k++; }
    for (let y = 0; y < 96; y += 4) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y, 2048, 1.5); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  dialTex() {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'), m = 256;
    g.fillStyle = '#efe3cf'; g.beginPath(); g.arc(m, m, 250, 0, 7); g.fill(); g.fillStyle = '#1a1411'; g.beginPath(); g.arc(m, m, 232, 0, 7); g.fill();
    g.font = 'italic 800 34px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    PH_LABEL.forEach((s, k) => { const a = -Math.PI / 2 + k * Math.PI / 3; g.save(); g.translate(m + Math.cos(a) * 190, m + Math.sin(a) * 190); g.rotate(a + Math.PI / 2); g.fillStyle = k === 3 ? '#ff5b1f' : '#efe3cf'; g.fillText(s, 0, 0); g.restore(); g.strokeStyle = 'rgba(239,227,207,.6)'; g.lineWidth = 4; g.beginPath(); g.moveTo(m + Math.cos(a + Math.PI / 6) * 160, m + Math.sin(a + Math.PI / 6) * 160); g.lineTo(m + Math.cos(a + Math.PI / 6) * 228, m + Math.sin(a + Math.PI / 6) * 228); g.stroke(); });
    // the rewind mark in the middle: two triangles pointing back
    g.fillStyle = '#ff5b1f'; for (const dx of [-38, 26]) { g.beginPath(); g.moveTo(m + dx - 32, m); g.lineTo(m + dx + 32, m - 44); g.lineTo(m + dx + 32, m + 44); g.closePath(); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  reelTex() {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), m = 128;
    g.fillStyle = '#2a1f1a'; g.beginPath(); g.arc(m, m, 124, 0, 7); g.fill(); g.fillStyle = '#4a3a31'; g.beginPath(); g.arc(m, m, 96, 0, 7); g.fill();
    g.fillStyle = '#efe3cf'; g.beginPath(); g.arc(m, m, 40, 0, 7); g.fill(); g.fillStyle = '#1a1411'; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.save(); g.translate(m, m); g.rotate(a); g.fillRect(-6, -36, 12, 18); g.restore(); }
    g.fillStyle = '#1a1411'; g.beginPath(); g.arc(m, m, 14, 0, 7); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  stoneRuneTex() {
    if (this._srune) return this._srune; const c = document.createElement('canvas'); c.width = 64; c.height = 160; const g = c.getContext('2d');
    g.strokeStyle = '#fff'; g.lineWidth = 6; g.shadowColor = '#fff'; g.shadowBlur = 8; g.lineCap = 'round';
    g.beginPath(); g.moveTo(32, 18); g.lineTo(32, 142); g.moveTo(32, 50); g.lineTo(12, 78); g.moveTo(32, 50); g.lineTo(52, 78); g.moveTo(14, 112); g.lineTo(50, 112); g.stroke();
    return (this._srune = new THREE.CanvasTexture(c));
  }

  /* ----- keep the underlights in step with the table: wrap the table methods that change the field */
  hookTable() {
    const T = this.T;
    for (const k of ['place', 'remove', 'flip', 'turnTo']) { const f = T[k]; T[k] = async (...a) => { const r = await f.apply(T, a); this.refresh(); return r; }; }
    const cf = T.clearField; T.clearField = (...a) => { const r = cf.apply(T, a); this.refresh(); return r; };
    T.board = this;
  }
}
