/* Learn Retro Play: duel effect styles (Zack, 2026-11-25: "the dueling experience absolutely needs to deliver").
   Three styles to compare, picked with ?fx=a|b|c (no ?fx is today's look):
     a  Broadcast Pro: today's Broadcast look sharpened into a TV tournament: lower-third callouts with the card art, a light streak on
        every attack, a shatter for every destroy, a rewind sweep between turns. Fast and clean.
     b  Cinematic: the camera pushes in on the action, letterbox bars on big moments, a full-width art cut-in for big summons,
        a brief hit-stop and flash on impact, a warm lamp and drifting dust around the table.
     c  Arcade: punchy comic stamps (SUMMON!, DIRECT HIT!, DESTROYED!), speed-line bursts in the card's color, bouncing damage
        numbers and a combo counter for attacks in a row.
   Every style shares the same core: the shatter (the card's own art breaks into pieces), the attack streak and impact, the summon callout.
   Performance rule (play/CLAUDE.md): only transform and opacity animate; nothing loops while off screen. */
import * as THREE from '../vendor/three.module.min.js';

export const STYLE = (() => { const v = new URLSearchParams(location.search).get('fx'); return v === 'off' ? null : ['a', 'b', 'c'].includes(v) ? v : 'b'; })();   // Cinematic by default (Zack, 2026-11-26: "B duel"); ?fx=off is the old look
let T = null, L = null, artUrl = null, rec = null, fmt = () => 'goat', MOBILE = false, REDUCED = false, sleep = ms => new Promise(r => setTimeout(r, ms));
export function init(o) { ({ table: T, layer: L, artUrl, rec, MOBILE, REDUCED } = o); fmt = o.fmt; sleep = o.sleep || sleep; if (STYLE) document.getElementById('s-duel').dataset.fx = STYLE; ambient(); }
export const on = () => !!STYLE && !REDUCED;

const ATTR = { DARK: '#9b5de5', LIGHT: '#ffd86a', EARTH: '#c98a4a', WATER: '#3aa8ff', FIRE: '#ff5a2a', WIND: '#47d47a', DIVINE: '#ffe27a' };
const colorOf = id => { const r = rec(fmt(), id); return r && ATTR[r.a] ? ATTR[r.a] : r && r.k === 'spell' ? '#2fbf8f' : r && r.k === 'trap' ? '#d04fa0' : '#ff8a3d'; };
const nameOf = id => { const r = rec(fmt(), id); return r ? r.n : ''; };
const el = (cls, html = '', style = '') => { const d = document.createElement('div'); d.className = 'fx ' + cls; d.innerHTML = html; if (style) d.style.cssText = style; L.appendChild(d); return d; };
const kill = (d, ms) => setTimeout(() => d.remove(), ms);
const scr = u => T.cardScreen(u) || null;
let comboN = 0, comboT = 0;

/* ---------- the camera push (Cinematic): the backdrop, the 3D table and the badges scale together, so cards stay on the painted mat ---------- */
const CAM = () => ['#scene', '#gl', '#ov'].map(s => document.querySelector(s)).filter(Boolean);
async function push(pt, k = 1.12, ms = 520) {
  if (STYLE !== 'b' || !pt) return;
  for (const e of CAM()) { e.style.transformOrigin = `${pt.x}px ${pt.y}px`; e.style.transition = `transform ${ms}ms cubic-bezier(.2,.7,.2,1)`; e.style.transform = `scale(${k})`; }
}
function release(ms = 600) { if (STYLE !== 'b') return; for (const e of CAM()) { e.style.transition = `transform ${ms}ms cubic-bezier(.4,0,.2,1)`; e.style.transform = ''; } }
function letterbox(onn) { if (STYLE !== 'b') return; document.getElementById('s-duel').classList.toggle('lbox', onn); }

/* ---------- ambient life around the table ---------- */
function ambient() {
  if (!STYLE || REDUCED) return; const s = document.getElementById('s-duel');
  if (STYLE === 'b' && !s.querySelector('.fx-amb')) { const a = document.createElement('div'); a.className = 'fx-amb'; a.innerHTML = '<i class="lampglow"></i><i class="vign"></i>' + (MOBILE ? '' : Array.from({ length: 14 }, (_, i) => `<b style="left:${8 + (i * 61) % 84}%;top:${10 + (i * 37) % 70}%;animation-delay:${-i * 1.3}s;animation-duration:${9 + (i % 5) * 2}s"></b>`).join('')); s.insertBefore(a, document.getElementById('ov')); }
  if (STYLE === 'c' && !s.querySelector('.fx-amb')) { const a = document.createElement('div'); a.className = 'fx-amb arc'; a.innerHTML = '<i class="vign"></i>'; s.insertBefore(a, document.getElementById('ov')); }
}

/* ---------- summons ---------- */
export async function summon(u, id, how, p) {
  if (!on()) return; const pt = scr(u), name = nameOf(id), col = colorOf(id), big = ['synchro', 'fusion', 'ritual', 'special', 'tribute'].includes(how);
  const label = { normal: 'Normal Summon', tribute: 'Tribute Summon', special: 'Special Summon', synchro: 'Synchro Summon', fusion: 'Fusion Summon', ritual: 'Ritual Summon', flip: 'Flip Summon', gemini: 'Gemini Summon' }[how] || 'Summon';
  if (STYLE === 'a') {   // a lower-third with the card art, and a ring on the card
    const d = el(`l3 ${p ? 'op' : ''}`, `<div class="l3-art" style="background-image:url(${artUrl(id)})"></div><div class="l3-t"><span>${label}</span><b>${name}</b></div>`, `--c:${col}`); kill(d, 2200);
    if (pt) kill(el('ring', '', `left:${pt.x}px;top:${pt.y}px;--c:${col}`), 900);
    return sleep(big ? 520 : 200);
  }
  if (STYLE === 'b') {   // big: letterbox, push in, a full-width art cut-in with the name; normal: a gentle push and a name card
    if (big) {
      letterbox(true); push(pt, 1.14, 600);
      const d = el('cutin', `<div class="ci-band" style="--c:${col}"><div class="ci-art" style="background-image:url(${artUrl(id)})"></div><div class="ci-t"><span>${label}</span><b>${name}</b></div><i class="ci-sweep"></i></div>`); kill(d, 1900);
      await sleep(1450); release(700); letterbox(false); return sleep(250);
    }
    push(pt, 1.06, 420); const d = el('namecard', `<span>${label}</span><b>${name}</b>`, `left:${pt ? pt.x : 960}px;top:${pt ? pt.y - 150 : 400}px`); kill(d, 1500);
    await sleep(700); release(500); return;
  }
  // Arcade: a stamp and a speed-line burst in the card's color
  if (pt) { kill(el('lines', '', `left:${pt.x}px;top:${pt.y}px;--c:${col}`), 700); kill(el('stamp', `${big ? label.split(' ')[0] + ' summon!' : 'Summon!'}`, `left:${pt.x}px;top:${pt.y - 40}px;--c:${col}`), 1300); }
  if (how === 'synchro' || how === 'fusion') confetti(pt, col);
  return sleep(big ? 420 : 160);
}

/* ---------- spell, trap and effect activations ---------- */
export async function activate(u, id, p, link) {
  if (!on() || id == null) return; const pt = scr(u), name = nameOf(id), col = colorOf(id);
  if (STYLE === 'a') { kill(el(`l3 sm ${p ? 'op' : ''}`, `<div class="l3-art" style="background-image:url(${artUrl(id)})"></div><div class="l3-t"><span>${link > 1 ? 'Chain Link ' + link : 'Activate'}</span><b>${name}</b></div>`, `--c:${col}`), 1800); return; }
  if (STYLE === 'b') { const d = el('showcard', `<div class="sc-card" style="background-image:url(${artUrl(id)})"></div><b>${name}</b>`, `--c:${col};--x:${pt ? pt.x : 960}px;--y:${pt ? pt.y : 540}px`); kill(d, 1500); await sleep(900); return; }
  if (pt) kill(el('stamp sm', link > 1 ? `Chain ${link}!` : 'Activate!', `left:${pt.x}px;top:${pt.y - 40}px;--c:${col}`), 1100);
}

/* ---------- attacks: before the lunge (wind-up) and at the hit ---------- */
export async function attackStart(a, t, p) {
  if (!on()) return; const pa = scr(a), pt = t != null ? scr(t) : T.project(T.screenToWorld(960, p === 0 ? 90 : 1000, 0.3)); if (!pa) return;
  if (STYLE === 'b') { letterbox(true); push({ x: (pa.x + pt.x) / 2, y: (pa.y + pt.y) / 2 }, 1.1, 420); }
  // the streak: a beam of light from attacker to target, drawn on, then gone
  const dx = pt.x - pa.x, dy = pt.y - pa.y, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
  kill(el(`streak s${STYLE}`, '', `left:${pa.x}px;top:${pa.y}px;width:${len}px;transform:rotate(${ang}deg);--c:${p === 0 ? '#ff8a3d' : '#7fb8ff'}`), 900);
}
export async function attackHit(a, t, p, direct) {
  if (!on()) return; const pt = t != null ? scr(t) : T.project(T.screenToWorld(960, p === 0 ? 90 : 1000, 0.3)); if (!pt) return;
  const col = p === 0 ? '#ffb070' : '#9fd0ff';
  kill(el('impact', '<i></i><i></i>', `left:${pt.x}px;top:${pt.y}px;--c:${col}`), 800);
  if (STYLE === 'b') { const f = el('flash'); kill(f, 260); await sleep(140); }   // hit-stop
  if (STYLE === 'c') {
    const now = performance.now(); comboN = now - comboT < 6000 ? comboN + 1 : 1; comboT = now;
    kill(el('stamp big', direct ? 'Direct hit!' : 'Bam!', `left:${pt.x}px;top:${pt.y - 30}px;--c:${col}`), 1100); kill(el('lines', '', `left:${pt.x}px;top:${pt.y}px;--c:${col}`), 700);
    if (comboN >= 2) kill(el('combo', `<b>${comboN}</b> hit combo`), 1400);
  }
}
export function attackEnd() { if (STYLE === 'b') { release(520); letterbox(false); } }

/* ---------- damage ---------- */
export function damage(p, n, lpEl) {
  if (!on() || !lpEl) return; const r = lpEl.getBoundingClientRect(), sr = document.getElementById('stage').getBoundingClientRect(), k = sr.width / (MOBILE ? 390 : 1920);
  const x = (r.left + r.width / 2 - sr.left) / k, y = (r.top + r.height / 2 - sr.top) / k;
  if (STYLE === 'c') kill(el('bignum', `-${n}`, `left:${x}px;top:${y + (p === 0 ? -140 : 140)}px`), 1300);
  if (STYLE === 'b' && n >= 1000) kill(el('flash red'), 380);
  lpEl.classList.remove('fxhit'); void lpEl.offsetWidth; lpEl.classList.add('fxhit');
}

/* ---------- destroy: the card's own art breaks into pieces that fly apart and fall ---------- */
export async function shatter(u) {
  const c = T.cards.get(u); if (!c) return false; if (!on()) return false;
  const face = c.up !== false ? c.m.material[2] : T.backMat, map = face && face.map;
  const p0 = c.g.position.clone(), rotY = c.g.rotation.y, def = !!c.def, cols = 4, rows = 5, W = T.CW, H = T.CH, pieces = [];
  T.burst(p0, 0xff6a3c, 0.9);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const g = new THREE.PlaneGeometry(W / cols, H / rows), uv = g.attributes.uv;
    for (let v = 0; v < uv.count; v++) uv.setXY(v, (i + uv.getX(v)) / cols, (j + uv.getY(v)) / rows);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: map || null, color: map ? 0xffffff : 0x333333, transparent: true, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; const grp = new THREE.Group(); grp.add(m); grp.rotation.y = rotY + (def ? Math.PI / 2 : 0);
    const lx = (i + 0.5) / cols * W - W / 2, lz = -((j + 0.5) / rows * H - H / 2); const off = new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), grp.rotation.y);
    grp.position.copy(p0).add(off); grp.position.y = p0.y + 0.01; T.scene.add(grp);
    pieces.push({ grp, m, v: off.clone().normalize().multiplyScalar(0.9 + Math.random() * 1.1).setY(1.2 + Math.random() * 1.4), spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3) });
  }
  T.cards.delete(u); T.unglow(u); T.scene.remove(c.g);
  const g = -5.5; let last = 0;
  await T.tween(STYLE === 'b' ? 900 : 700, k => { const t = k * (STYLE === 'b' ? 0.9 : 0.7), dt = t - last; last = t;
    for (const s of pieces) { s.v.y += g * dt; s.grp.position.addScaledVector(s.v, dt); s.grp.rotation.x += s.spin.x * dt; s.grp.rotation.z += s.spin.z * dt; s.m.material.opacity = 1 - k * k; } });
  for (const s of pieces) { T.scene.remove(s.grp); s.m.geometry.dispose(); s.m.material.dispose(); }
  if (STYLE === 'c') kill(el('stamp', 'Destroyed!', `left:${T.project(p0).x}px;top:${T.project(p0).y - 30}px;--c:#ff5a3c`), 1100);
  return true;
}

/* ---------- turn change ---------- */
export async function turn(mine, n) {
  if (!on()) return false;
  if (STYLE === 'a') { const d = el(`rewind ${mine ? '' : 'op'}`, `<i>◀◀</i><b>${mine ? 'Your turn' : "Computer's turn"}</b><span>Turn ${n}</span>`); kill(d, 1500); await sleep(950); return true; }
  if (STYLE === 'b') { letterbox(true); const d = el(`turnc ${mine ? '' : 'op'}`, `<span>Turn ${n}</span><b>${mine ? 'Your turn' : "Computer's turn"}</b>`); kill(d, 1700); await sleep(1250); letterbox(false); return true; }
  const d = el(`turnarc ${mine ? '' : 'op'}`, `<b>${mine ? 'Your turn!' : 'Their turn!'}</b><span>Turn ${n}</span>`); kill(d, 1300); await sleep(850); comboN = 0; return true;
}

function confetti(pt, col) { if (!pt) return; for (let i = 0; i < (MOBILE ? 12 : 22); i++) { const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 160; kill(el('cf', '', `left:${pt.x}px;top:${pt.y}px;--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d - 60}px;--r:${Math.random() * 720 - 360}deg;background:${i % 3 ? col : '#fff'}`), 1300); } }
