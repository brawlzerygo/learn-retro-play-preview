/* Learn Retro Play: the game. Screens, the deck picker, and the duel: engine events (from js/worker.js) become animations on
 the 3D table (js/table.js) and the HUD; your choices go back to the engine. The engine decides every rule; this file only
 shows the duel and passes on what you pick. */
import { Table } from './table.js?v=81';
import * as S from './sfx.js?v=81';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LEAVES = '.dlg,.veil,.msheet,.dlist,.czoom,.hintp,.logp,.amenu,.dial-menu,.toast,.mydecks';
{ const rm = Element.prototype.remove;
  Element.prototype.remove = function () {
    if (!REDUCED && this.isConnected && !this.dataset.leaving && this.matches && this.matches(LEAVES)) {
      this.dataset.leaving = '1'; this.removeAttribute('id'); this.classList.add('out'); setTimeout(() => rm.call(this), 170); return; }
    return rm.call(this); }; }
const stage = $('#stage');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, document.hidden ? 0 : ms));
let scale = 1;
// touch screens and phones (Zack, 2026-11-24: "Touch + landscape"): .touch drops hover and key prompts, .phone (a touch screen
// where the stage shrinks below 0.6) scales the duel HUD and card text up from their corners (css/game.css)
const TAP = () => TOUCH ? 'tap' : 'click'; // on-screen words follow the device
const TOUCH = /[?&](touch|mobile|phone)\b/.test(location.search) || matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;
/* the phone layout (Zack, 2026-11-24: "a specific mobile version/layout... doesnt need to be in landscape... could not affect the web
   experience"): phones get an upright stage 390 points wide and as tall as the screen (#stage.m, css/mobile.css), the upright Card Shop
   render and its camera, and phone screens built from the same game. Computers and tablets keep the 1920x1080 stage. ?mobile tries it. */
const FORCE_M = /[?&]mobile\b/.test(location.search);
const PHONE = FORCE_M || /[?&]phone\b/.test(location.search) || (TOUCH && Math.min(screen.width, screen.height) < 520);
// phones always get the phone UI: upright (#stage.m) or, held sideways, its landscape version (#stage.m.ml; Zack, 2026-11-25: "the landscape
// version on mobile is literally just the web ui. it needs to match the mobile ui but be formatted for landscape")
const uprightNow = () => FORCE_M || innerHeight >= innerWidth;
const MOBILE = PHONE;
// sideways phones were tried and set aside (Zack, 2026-11-25: "the landscape view looks super janky right now, lets just stick to upright"):
// LAND stays false and a phone held sideways sees "Turn your phone upright" (#rotate); the #stage.ml styles remain for a later try
let LAND = false;
let LG = { cx: 195 };     // landscape: the board's middle, for the hands
let SW = 1920, SH = 1080;
const MV = { w: 390, h: 845 };            // the upright render (1080x2340) drawn at the phone's width
// the board on phones (Zack, 2026-11-24: "a bit too much dead space between my hand and the board, lets make the board a bit bigger"):
// as wide as the phone allows (up to 106% of the render) and sitting just above the row (turn, Hint, phase) over your hand.
// In the render at full size the board with its rim spans y 215 to 510. The prompt and chain strip sit above it when there is room;
// on short phones (an SE) the board shrinks to fit under the computer's hand instead.
const sabPx = () => { const pr = $('#sabProbe'); return pr ? pr.offsetHeight : 10; };
// landscape phones: the landscape render (its board spans x 12.5-87.5% at the near edge and y 22.4-92.8%) between a left column (bars,
// prompt, chain) and a right column (turn, phase, Hint, your card's buttons), its near edge just above your hand
const LCOL = 188, RCOL = 128;
function lview() {
  const cw = SW - LCOL - RCOL; let w = cw / 0.75, h = w * 9 / 16; const maxH = (SH - 52 - 56) / 0.704; if (h > maxH) { h = maxH; w = h * 16 / 9; }
  const cx = LCOL + cw / 2; LG = { cx };
  return { w: Math.round(w), h: Math.round(h), ox: Math.round(cx - w / 2), oy: Math.round(SH - 52 - 0.928 * h), dpr: Math.min(3, (window.devicePixelRatio || 1) * scale) }; }
function mview() {
  if (LAND) return lview();
  const rowTop = SH - sabPx() - ROW_B - 48, bottom = rowTop - 10;
  let k = Math.min(1.12, (bottom - 205) / 262); if (k < 0.9) k = Math.min(1.12, (bottom - 112) / 262);
  const w = Math.round(MV.w * k), h = Math.round(MV.h * k);
  return { w, h, ox: Math.round((MV.w - w) / 2), oy: Math.round(bottom - 499 * k), dpr: Math.min(3, (window.devicePixelRatio || 1) * scale) }; }
const ROW_B = 236, HW = 96;   // the row's distance above the safe bottom edge, and a hand card's width (css/mobile.css --row, .hc)
function switchLayout() {
  stage.classList.toggle('m', MOBILE); stage.classList.toggle('ml', LAND); document.documentElement.classList.toggle('m', MOBILE);
  try {
    closeSheet(); if (typeof closeCardZoom === 'function') closeCardZoom();
    if (table) rebuildTable();
    if (cur === 'build' && B.deck) renderBuilder(); if (cur === 'deck') renderDecks();
  } catch (e) { /* first call, before the game is set up */ }
}
function placeMid() { try { if (!table) return; const p = table.project(new (table.camera.position.constructor)(0, 0, 0)); stage.style.setProperty('--midy', Math.round(p.y) + 'px'); } catch (e) { /* no table yet */ } }
// the home-screen app draws under the status bar but iOS reports its height without that strip, which left a gap at the bottom
// (Zack, 2026-11-25: "only on the home screen version, lets extend this so as much space is used as possible"); there the game takes
// the phone's full screen height. In Safari the window height is right and stays as it is.
const homeApp = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
// measured, not guessed: a fixed box pinned to all four edges is exactly the area the app can draw in (screen.height ran past the bottom
// and cut off the tab bar's labels, Zack, 2026-11-25)
const phoneHeight = () => {
  if (!homeApp()) return innerHeight;
  let pr = document.getElementById('vhProbe'); if (!pr) { pr = document.createElement('div'); pr.id = 'vhProbe'; pr.style.cssText = 'position:fixed;left:0;top:0;bottom:0;width:0;visibility:hidden;pointer-events:none'; document.body.appendChild(pr); }
  return Math.round(pr.getBoundingClientRect().height) || innerHeight;
};
function fit() {
  if (PHONE) { document.documentElement.classList.toggle('sideways', !uprightNow()); document.documentElement.classList.add('m'); if (!uprightNow()) return; }   // sideways: nothing to lay out until it turns back
  if (!MOBILE) { stage.style.width = stage.style.height = ''; }
  if (MOBILE) { if (LAND) { scale = innerHeight / 390; SH = 390; SW = Math.round(innerWidth / scale); } else { scale = innerWidth / 390; SW = 390; SH = Math.round(phoneHeight() / scale); }
    stage.style.width = SW + 'px'; stage.style.height = SH + 'px'; stage.style.setProperty('--sw', SW + 'px');
    const v = mview(); for (const k of ['w', 'h', 'ox', 'oy']) stage.style.setProperty('--g' + k, v[k] + 'px');
    // the prompt strip: in the open band between the computer's hand and the board when there is one, else on the center line
    stage.style.setProperty('--cx', LG.cx + 'px');
    const top = v.oy + 237 * v.h / MV.h; if (!LAND && top - 112 >= 52) stage.style.setProperty('--py', Math.round(top - 26) + 'px'); else stage.style.removeProperty('--py'); stage.classList.toggle('mline', !LAND && top - 112 < 52); try { if (table) { table.setView(v); placeMid(); } } catch (e) { /* the table isn't made yet */ } }
  else scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  // phones: the stage is pinned to the top-left of the real screen and fills it exactly, so the home-screen app (which runs under the status
  // bar, Zack, 2026-11-25: "pushed up and top is cut off, dead space at bottom") lines up the same as the browser; the safe-area insets
  // keep the bars clear of the notch and the home indicator
  stage.style.transform = MOBILE ? `scale(${scale})` : `translate(-50%,-50%) scale(${scale})`;
  stage.classList.toggle('m', MOBILE); stage.classList.toggle('ml', LAND); document.documentElement.classList.toggle('m', MOBILE);
  stage.classList.toggle('touch', TOUCH); stage.classList.toggle('phone', !MOBILE && TOUCH && scale < 0.6); }
addEventListener('resize', fit); fit();
// iOS reports a home-screen app's final size a moment after it opens, and again after turning: measure again then
for (const ev of ['orientationchange', 'pageshow', 'load']) addEventListener(ev, () => { fit(); setTimeout(fit, 250); setTimeout(fit, 800); });
if (window.visualViewport) visualViewport.addEventListener('resize', fit);
const toStage = e => { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };

/* ---------- settings ---------- */
const SET = Object.assign({ vol: 50, speed: 'relaxed', hintLimit: '3', muted: false, theme: 'broadcast' }, JSON.parse(localStorage.getItem('lrplay:set') || '{}'));
const saveSet = () => localStorage.setItem('lrplay:set', JSON.stringify(SET));
const SPEED = { relaxed: 1.15, normal: 1.05, fast: 0.55, instant: 0.04 };   // a touch slower card moves (Zack, 2026-11-25: "slow down the card action animations just slightly")
const GAP = { relaxed: 1.6, normal: 1, fast: 0.55, instant: 0.04 };
const BEAT = { relaxed: 1100, normal: 450, fast: 160, instant: 0 };   // ms after each computer play
if (SET.paceV !== 2) { SET.speed = 'relaxed'; SET.paceV = 2; localStorage.setItem('lrplay:set', JSON.stringify(SET)); }   // once: everyone starts on Relaxed
S.setVolume(SET.vol / 100); S.setMuted(SET.muted); S.load();
/* Settings: one row per setting, ↑↓ to choose a row, ←→ to change it (Rewind's layout, Broadcast style) */
const SETROWS = [
  { k: 'speed', name: 'Duel speed', vals: ['relaxed', 'normal', 'fast', 'instant'], lab: v => v, desc: 'How fast cards move, banners play and the computer takes its turn. Relaxed gives you time to follow every play.' },
  { k: 'hintLimit', name: 'Hints per duel', vals: ['off', '1', '3', '5', 'unlimited'], lab: v => v, desc: 'A hint shows the strongest play and why it beats the next best, like the hint button on a chess site.' },
  { k: 'vol', name: 'Sound effects', vals: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], blocks: true, desc: 'How loud cards, summons and battles are.' },
  { k: 'muted', name: 'Sound', vals: [false, true], lab: v => v ? 'off' : 'on', desc: 'Turn every sound on or off.' },
  { k: 'table', name: 'Table', vals: ['shop'], lab: () => 'Card Shop', desc: 'The world your duels are played in.' },
];
let setRow = 0;
// themes share one layout; a class on the stage swaps the look (css/rewind.css)
// Rewind is in the back pocket (Zack, 2026-11-24): Broadcast always; set REWIND_PICKER true to bring back the Settings row and the T key
const REWIND_PICKER = false;
if (!REWIND_PICKER) SET.theme = 'broadcast';
function applyTheme() { stage.classList.toggle('th-rewind', SET.theme === 'rewind'); }
applyTheme();
function renderSettings() {
  $('#setList').innerHTML = SETROWS.map((r, i) => { const v = SET[r.k] != null ? SET[r.k] : r.vals[0];
    const val = r.blocks ? `<span class="blocks">${r.vals.slice(1).map(x => `<i class="${x <= v ? 'f' : ''}"></i>`).join('')}</span><span class="vn">${v}</span>` : `<span class="vt">${r.lab(v)}</span>`;
    return `<div class="vrow ${i === setRow ? 'on' : ''}" data-i="${i}"><span>${r.name}</span><span class="dots"></span><span class="val"><span class="arr" data-d="-1"><svg><use href="#i-tl"/></svg></span>${val}<span class="arr" data-d="1"><svg><use href="#i-tr"/></svg></span>${r.soon ? `<span class="soonv">${r.soon}</span>` : ''}</span></div>`; }).join('');
  $('#setDesc').textContent = SETROWS[setRow].desc;
}
function changeSetting(i, d) {
  const r = SETROWS[i]; const cur = SET[r.k] != null ? SET[r.k] : r.vals[0]; let j = r.vals.indexOf(cur); if (j < 0) j = 0;
  const nj = Math.max(0, Math.min(r.vals.length - 1, j + d)); if (nj === j) { S.play('error'); return; }
  SET[r.k] = r.vals[nj]; saveSet();
  if (r.k === 'vol') S.setVolume(SET.vol / 100); if (r.k === 'muted') S.setMuted(SET.muted); if (r.k === 'speed' && table) table.speed = SPEED[SET.speed]; if (r.k === 'theme') applyTheme();
  S.play('click'); renderSettings();
}
$('#setList').onclick = e => { const row = e.target.closest('[data-i]'); if (!row) return; setRow = +row.dataset.i; const a = e.target.closest('[data-d]'); if (a) changeSetting(setRow, +a.dataset.d); else { S.play('hover'); renderSettings(); } };
renderSettings();

/* ---------- data ---------- */
const FM = window.FORMATS, TOKEN_ART = window.TOKEN_ART;
const CARD = {}; for (const f in FM) CARD[f] = new Map(FM[f].cards.map(c => [String(c.id), c]));
const TOK = { 'tok-sheep': { n: 'Sheep Token', k: 'token', a: 'EARTH', r: 'Beast', lv: 1, atk: '0', def: '0', tx: 'A token made by Scapegoat.' }, 'tok-gorz': { n: 'Emissary of Darkness Token', k: 'token', a: 'LIGHT', r: 'Fairy', lv: 7, atk: '?', def: '?', tx: 'A token made by Gorz the Emissary of Darkness.' } };
const rec = (f, id) => id == null ? null : (CARD[f].get(String(id)) || TOK[id] || null);
const artUrl = id => id == null ? 'img/back.webp' : typeof id === 'string' && TOKEN_ART[id] ? `img/${TOKEN_ART[id][0]}.webp` : `img/${id}.webp`;

/* ---------- the duel host ---------- */
const W = new Worker('js/worker.js?v=81');
let READY = null; const readyP = new Promise(r => { W.addEventListener('message', function h(e) { if (e.data.type === 'ready') { READY = e.data.formats; W.removeEventListener('message', h); r(); } }); });
W.postMessage({ type: 'init' });
W.onmessage = e => { const m = e.data; if (m.type === 'update') duelUpdate(m); else if (m.type === 'hint') showHint(m); else if (m.type === 'summary') { if (D) { D.summary = m.summary; if (D.over) { recordMatch(D.over, m.summary); renderReview(m.summary); } } } else if (m.type === 'reviewing') { const el = $('#resReview p.mute'); if (el) el.textContent = `Reviewing your duel… ${m.left} decisions left`; } else if (m.type === 'error') { console.error(m.message, m.stack); toast('Something went wrong in the engine: ' + m.message, 6000); } };

/* ---------- screens ---------- */
let cur = 'title';
const AUTO = new URLSearchParams(location.search).has('autoplay');   // testing only: your seat plays itself with the hint engine
window.__lr = { get D() { return D; }, get SEL() { return SEL; }, start: () => startDuel(), show: x => show(x) };
// one Back button, the same spot on every screen that has one (Zack, 2026-11-24)
const BACK = { settings: 'title', format: 'title', deck: 'format', stats: 'title', build: 'title' };
async function goBack() { if (cur === 'build' && B.dirty && !(await ask('Leave without saving?', 'Leave'))) return; if (BACK[cur]) show(BACK[cur]); }
$('#gBack').onclick = () => { S.unlock(); goBack(); };
$('#mTabs').onclick = async e => { const b = e.target.closest('[data-tab]'); if (!b || b.dataset.tab === cur) return; S.unlock(); if (cur === 'build' && B.dirty && !(await ask('Leave without saving?', 'Leave'))) return; show(b.dataset.tab); };
function show(s) { const prevScr = cur; if (s !== cur) S.play('nav'); if (s !== cur) closeDeckList(); if (s !== 'build') closeCardZoom(); cur = s; stage.dataset.scr = s; $$('#mTabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === s)); closeSheet(); $('#gBack').classList.toggle('on', !!BACK[s]); $$('.screen').forEach(e => { const on = e.id === 's-' + s; if (!on && e.classList.contains('on') && !REDUCED) { e.classList.add('leaving'); setTimeout(() => e.classList.remove('leaving'), 260); } e.classList.toggle('on', on); }); if (s === 'deck') { if (prevScr !== 'deck') { PK = { you: false, cpu: false }; pickingOpp = false; SEL.mtab = 'you'; } renderDecks(); } if (s === 'format') renderFormats(); if (s === 'build') { B.howto = undefined; readyP.then(openBuilder); } /* OK hides the how-to only until the next visit */ if (s === 'stats') renderStats(); if (s === 'settings') renderSettings(); if (s === 'title') updateTicker(); }
// browsers keep a page silent until the first click, tap or key press (hovering doesn't count): turn sound on at the very first one, anywhere
for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => S.unlock(), { capture: true, passive: true });
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { S.unlock(); show(b.dataset.go); } const h = e.target.closest('[data-href]'); if (h) open(h.dataset.href, '_blank'); });
// title
// the home screen's hero cards (Black Rose Dragon and Envoy) are in index.html
const menuItems = () => $$('#mainMenu .mi:not(.lock)');
$('#mainMenu').addEventListener('mouseover', e => { const m = e.target.closest('.mi:not(.lock)'); if (!m || m.classList.contains('on')) return; $$('#mainMenu .mi').forEach(x => x.classList.toggle('on', x === m)); S.play('hover'); });
addEventListener('keydown', e => {
  if (REWIND_PICKER && (e.key === 't' || e.key === 'T') && cur !== 'duel' && !(document.activeElement && document.activeElement.tagName === 'INPUT')) { SET.theme = SET.theme === 'rewind' ? 'broadcast' : 'rewind'; saveSet(); applyTheme(); S.play('click'); if (cur === 'settings') renderSettings(); return; }
  if (cur === 'title') {
    const it = menuItems(), i = it.findIndex(x => x.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const j = (i + (e.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length; it.forEach((x, k) => x.classList.toggle('on', k === j)); S.play('hover'); }
    if (e.key === 'Enter') it[i] && it[i].click();
  } else if (cur === 'format') { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { focusFmt(e.key === 'ArrowLeft' ? 'goat' : 'edison'); } if (e.key === 'Enter' && SEL.fmtFocus) chooseFmt(SEL.fmtFocus); if (e.key === 'Escape') show('title'); }
  else if (cur === 'deck') { if (e.key === 'Escape') { if (!closeDeckList()) show('format'); return; } if ($('#dlist')) return; if (e.key === 'Enter') $('#duelGo').click(); if (e.key === 'l' || e.key === 'L') $('#seeList') && $('#seeList').click(); }
  else if (cur === 'settings') { if (e.key === 'Escape') show('title'); if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { setRow = (setRow + (e.key === 'ArrowDown' ? 1 : -1) + SETROWS.length) % SETROWS.length; S.play('hover'); renderSettings(); } if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') changeSetting(setRow, e.key === 'ArrowRight' ? 1 : -1); }
  else if (cur === 'stats') { if (e.key === 'Escape') show('title'); }
  else if (cur === 'build') { if (e.key === 'Escape' && closeCardZoom()) return; if (e.key === 'Escape') { if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur(); else goBack(); } }
  else if (cur === 'results') { if (e.key === 'Enter') $('#resAgain').click(); }
  else if (cur === 'duel') duelKey(e);
});
$('#mainMenu').addEventListener('click', e => { const m = e.target.closest('.mi'); if (m && m.classList.contains('lock')) S.play('error'); });

/* ---------- format and decks ---------- */
const SEL = Object.assign({ fmt: 'goat', edison: { you: 'Blackwing', cpu: 'Hero Frog' }, goat: { you: 'Goat Control', cpu: 'Chaos Turbo' }, level: 'intermediate', tier: 'all' }, JSON.parse(localStorage.getItem('lrplay:sel') || '{}'));
const saveSel = () => localStorage.setItem('lrplay:sel', JSON.stringify(SEL));
// the computer's four levels (Zack, 2026-11-24: Experienced cut)
const LEVELS = [
  ['beginner', 'Beginner', 'Learning the game. Makes plenty of mistakes and misses responses.'],
  ['intermediate', 'Intermediate', 'Knows the game and makes good plays, but still misplays now and then.'],
  ['advanced', 'Advanced', 'Steadier, fewer mistakes, and plans two-step plays in its turn.'],
  ['tournament', 'Tournament', 'Virtually no mistakes. Weighs several guesses at your hand and checks its best lines deeper, with just enough variety to stay unpredictable.'],
];
if (!LEVELS.some(l => l[0] === SEL.level)) SEL.level = { easy: 'beginner', normal: 'intermediate', hard: 'advanced', experienced: 'tournament' }[SEL.level] || 'intermediate';
const levelName = k => (LEVELS.find(l => l[0] === k) || LEVELS[1])[1];
const readyDecks = f => READY ? allDecks(f).filter(d => deckInfo(f, d).ready).map(d => d.key) : [];
async function renderFormats() {
  await readyP;
  for (const [f, id] of [['edison', '#edReady'], ['goat', '#gtReady']]) { const n = readyDecks(f).length, all = allDecks(f).length; /* both counts include your own decks */ const t = $(id); t.textContent = n === all ? `${n} decks ready` : `${n} of ${all} decks ready`; t.className = 'tg ' + (n ? 'hot' : ''); }
  focusFmt(null);
}
// nothing is preselected: hovering (or arrow keys) highlights a format, clicking it (or Enter) goes to the deck screen
function focusFmt(f) { SEL.fmtFocus = f; $$('.fmt').forEach(x => x.classList.toggle('sel', x.dataset.fmt === f)); if (f) S.play('hover'); }
function chooseFmt(f) { if (!readyDecks(f).length) { toast('No deck in this format is ready yet.'); S.play('error'); return; } SEL.fmt = f; saveSel(); show('deck'); }
$$('.fmt').forEach(x => { x.onclick = () => { S.unlock(); chooseFmt(x.dataset.fmt); }; x.onmouseenter = () => focusFmt(x.dataset.fmt); x.onmouseleave = () => focusFmt(null); });
const TIERS = { edison: ['Best', 'Competitive', 'Rogue', 'Contender', 'Casual'], goat: ['A', 'B', 'C', 'D', 'T'] };
const TIERNAME = { A: 'Tier A', B: 'Tier B', C: 'Tier C', D: 'Tier D', T: 'Tournament' };
let pickingOpp = false, PK = { you: false, cpu: false };
// three cards to show for a deck: its signature monsters, the ones it runs most that few other decks share (its engine: Blackwings,
// Frogs, Plants...), Main Deck first (Zack, 2026-11-25: "should be their main engines/effect monsters/what theyre known for... instead of
// a lot of the same synchros"); the Extra Deck only fills in when the Main Deck has fewer than three monsters
const deckFreq = {};
function keyCards(f, d) {
  if (!deckFreq[f]) { const m = new Map(); for (const x of FM[f].decks) for (const id of new Set(x.main)) m.set(id, (m.get(id) || 0) + 1); deckFreq[f] = m; }
  const fq = deckFreq[f], N = FM[f].decks.length, count = new Map(); for (const id of d.main) count.set(id, (count.get(id) || 0) + 1);
  const mons = [...count.keys()].filter(id => { const r = rec(f, id); return r && !['spell', 'trap'].includes(r.k); });
  const score = id => { const r = rec(f, id); return count.get(id) * Math.log((N + 1) / ((fq.get(id) || 1))) + (r && r.k !== 'normal' ? 0.3 : 0) + (+(r && r.atk) || 0) / 10000; };
  mons.sort((a, b) => score(b) - score(a));
  const out = mons.slice(0, 3);
  for (const id of [...new Set(d.extra)]) { if (out.length >= 3) break; out.push(id); }
  for (const id of count.keys()) { if (out.length >= 3) break; if (!out.includes(id)) out.push(id); }
  return out;
}
async function renderDecks() {
  await readyP;
  const f = SEL.fmt, decks = allDecks(f), info = new Map(decks.map(d => [d.key, deckInfo(f, d)]));
  const ok = decks.filter(d => info.get(d.key).ready).map(d => d.key); const s = SEL[f];
  if (!ok.includes(s.you)) s.you = ok.find(k => !k.startsWith('my:')) || ok[0]; if (!ok.includes(s.cpu)) s.cpu = ok.filter(k => !k.startsWith('my:'))[1] || ok[0];
  if (MOBILE) pickingOpp = SEL.mtab === 'opp';
  $('#deckTitle').textContent = pickingOpp ? "Computer's deck" : 'Your deck';
  const tabs = ['all', 'my', ...TIERS[f]];
  $('#tierTabs').innerHTML = tabs.map(t => `<button class="gb sm ${SEL.tier === t ? 'on' : ''}" data-tier="${t}">${t === 'all' ? 'All' : t === 'my' ? 'My decks' : (TIERNAME[t] || t)}<span class="shine"></span></button>`).join('');
  $('#tierTabs').onclick = e => { const b = e.target.closest('[data-tier]'); if (b) { SEL.tier = b.dataset.tier; saveSel(); S.play('click'); renderDecks(); } };
  const tierIdx = d => d.tier === 'my' ? -1 : TIERS[f].indexOf(d.tier);
  const list = decks.filter(d => SEL.tier === 'all' || d.tier === SEL.tier).sort((a, b) => (info.get(b.key).ready - info.get(a.key).ready) || tierIdx(a) - tierIdx(b));
  const sel = pickingOpp ? s.cpu : s.you;
  const why = r => r.problems && r.problems.length ? ' · not legal yet' : r.missing.length ? ` · ${r.missing.length} card${r.missing.length > 1 ? 's' : ''} not playable yet` : '';
  $('#deckList').innerHTML = (list.length ? list : []).map(d => { const r = info.get(d.key); const k = keyCards(f, d)[0];
    return `<div class="dk ${d.key === sel && PK[pickingOpp ? 'cpu' : 'you'] ? 'sel' : ''} ${pickingOpp ? 'opp' : ''} ${r.ready ? '' : 'off'}" data-deck="${esc(d.key)}"><div class="strip" style="background-image:url(${artUrl(k)})"></div><div><div class="nm cap">${esc(d.name)}</div><div class="pl">${d.main.length} cards${d.extra.length ? ` · ${d.extra.length} in the ${f === 'goat' ? 'Fusion' : 'Extra'} Deck` : ''}${why(r)}</div></div><div class="tags"><span class="tg ${d.tier === 'my' || d.tier === TIERS[f][0] ? 'hot' : ''}">${d.tier === 'my' ? 'Yours' : esc(TIERNAME[d.tier] || d.tier)}</span>${r.ready ? '' : `<span class="tg">${r.problems && r.problems.length ? 'Fix' : 'Soon'}</span>`}</div></div>`; }).join('')
    || (SEL.tier === 'my' ? '<div class="mute" style="font-size:20px;padding:20px">No decks of your own yet. Build one in the Deck Builder.</div>' : '');
  $('#deckList').onclick = e => { const el = e.target.closest('[data-deck]'); if (!el) return; const r = info.get(el.dataset.deck);
    if (el.classList.contains('off')) { S.play('error'); toast(r.problems && r.problems.length ? r.problems[0] : 'This deck has cards the engine can\'t play yet: ' + r.missing.slice(0, 4).join(', ') + (r.missing.length > 4 ? '…' : '')); return; }
    if (pickingOpp) { s.cpu = el.dataset.deck; PK.cpu = true; if (!MOBILE) pickingOpp = false; }
    else { s.you = el.dataset.deck; PK.you = true; if (!PK.cpu) { if (MOBILE) SEL.mtab = 'opp'; else pickingOpp = true; } }
    saveSel(); S.play('click'); renderDecks(); if (pickingOpp) $('#deckList').scrollTop = 0; };
  const you = deckByKey(f, s.you), cpu = deckByKey(f, s.cpu);
  if (!you || !cpu) { $('#deckSide').innerHTML = ''; return; }
  const kc = keyCards(f, you);
  $('#deckSide').innerHTML = `<div class="dk-fan">${kc.map((id, i) => `<div class="card" style="background-image:url(${artUrl(id)});left:${170 + i * 150}px;${i === 1 ? 'top:-4px;z-index:2;box-shadow:0 20px 50px rgba(0,0,0,.8)' : `transform:rotate(${i ? 10 : -10}deg)`}"></div>`).join('')}</div>
    <div class="ph">Your deck · ${you.tier === 'my' ? 'Yours' : esc(TIERNAME[you.tier] || you.tier)} · ${f === 'goat' ? 'Goat' : 'Edison'}</div><h3 class="disp">${esc(you.name)}</h3>
    <p>${you.main.length} cards in the Main Deck${you.extra.length ? `, ${you.extra.length} in the ${f === 'goat' ? 'Fusion' : 'Extra'} Deck` : ''}.${you.credit ? ' List: ' + esc(you.credit) + '.' : ''}</p>
    <div class="row"><button class="gb sm pri" id="seeList"><svg><use href="#i-list"/></svg>See the full deck list<span class="key">L</span><span class="shine"></span></button><button class="gb sm" id="seeOpp" ${PK.cpu ? '' : 'disabled'}><svg><use href="#i-list"/></svg>Computer's list<span class="shine"></span></button></div>
    <div class="row"><span class="lb cap">Opponent</span><div style="display:flex;align-items:center;gap:12px;font-size:22px">${PK.cpu ? `<div class="card" style="width:50px;height:73px;background-image:url(${artUrl(keyCards(f, cpu)[0])})"></div><b class="cap">${esc(cpu.name)}</b>` : `<span class="mute">${pickingOpp ? 'Pick it from the list' : 'Not chosen yet'}</span>`}</div>
      <button class="gb sm" id="oppPick" style="margin-left:auto"><svg><use href="#i-cards"/></svg>${pickingOpp ? 'Picking…' : PK.cpu ? 'Change' : 'Choose'}<span class="shine"></span></button><button class="gb sm" id="oppRand">Random<span class="shine"></span></button></div>
    <div class="row" style="align-items:flex-start"><span class="lb cap" style="margin-top:14px">Computer</span><div><div class="seg" id="lvl">${LEVELS.map(([k, n]) => `<button class="gb sm ${SEL.level === k ? 'pri' : ''}" data-l="${k}">${n}<span class="shine"></span></button>`).join('')}</div>
      <div class="mute" style="font-size:16px;margin-top:10px;max-width:600px">${esc(LEVELS.find(l => l[0] === SEL.level)[2])}</div></div></div>`;
  if (!PK.you) $('#deckSide').insertAdjacentHTML('beforeend', `<div class="dk-pick"><div class="ph">Step 1 of 2</div><h3 class="disp">Choose your deck</h3><p>Pick a deck from the list on the left. Then pick the computer's deck, and the computer's level.</p></div>`);
  const ready = PK.you && PK.cpu; $('#duelGo').classList.toggle('off', !ready);
  if (MOBILE) {
    const thumb = d => `<i style="background-image:url(${artUrl(keyCards(f, d)[0])})"></i>`;
    const tb = (seat, d, label) => PK[seat] ? `${thumb(d)}<span><small>${label}</small>${esc(d.name)}</span>` : `<i class="empty"></i><span><small>${label}</small>Choose</span>`;
    $('#mdTabs').innerHTML = `<button class="${pickingOpp ? '' : 'on'}" data-mt="you">${tb('you', you, 'Your deck')}</button><button class="${pickingOpp ? 'on op' : ''}" data-mt="opp">${tb('cpu', cpu, 'Opponent')}</button>`;
    $('#mdTabs').onclick = e => { const b = e.target.closest('[data-mt]'); if (!b) return; SEL.mtab = b.dataset.mt; S.play('click'); renderDecks(); $('#deckList').scrollTop = 0; };
    const cur2 = pickingOpp ? cpu : you;
    const chosen = PK[pickingOpp ? 'cpu' : 'you'];
    $('#mdTools').innerHTML = `<button class="gb sm" id="mdList" ${chosen ? '' : 'disabled'}><svg><use href="#i-list"/></svg>See ${pickingOpp ? "the computer's" : 'your'} deck list<span class="shine"></span></button>${pickingOpp ? `<button class="gb sm" id="mdRand">Random<span class="shine"></span></button>` : ''}`;
    $('#mdList').onclick = () => deckList(f, cur2, pickingOpp ? "The computer's deck" : 'Your deck');
    if ($('#mdRand')) $('#mdRand').onclick = () => $('#oppRand').click();
    $('#mdFoot').innerHTML = `<div class="lvls">${LEVELS.map(([k, n]) => `<button class="${SEL.level === k ? 'on' : ''}" data-l="${k}">${n}</button>`).join('')}</div>`;
    $('#mdFoot').onclick = e => { const b = e.target.closest('[data-l]'); if (b) { SEL.level = b.dataset.l; saveSel(); S.play('click'); renderDecks(); } };
  }
  $('#seeList').onclick = () => deckList(f, you, 'Your deck');
  $('#seeOpp').onclick = () => deckList(f, cpu, "The computer's deck");
  $('#oppPick').onclick = () => { pickingOpp = !pickingOpp; S.play('click'); renderDecks(); };
  $('#oppRand').onclick = () => { const o = ok.filter(n => n !== s.you); s.cpu = o[Math.floor(Math.random() * o.length)] || s.you; pickingOpp = false; PK.cpu = true; if (MOBILE) SEL.mtab = 'opp'; saveSel(); S.play('shuffle'); renderDecks(); };
  $('#lvl').onclick = e => { const b = e.target.closest('[data-l]'); if (b) { SEL.level = b.dataset.l; saveSel(); S.play('click'); renderDecks(); } };
}
$('#duelGo').onclick = () => { S.unlock(); if (!(PK.you && PK.cpu)) { S.play('error'); toast(!PK.you ? 'Choose your deck first.' : "Choose the computer's deck first."); return; } startDuel(); };
// the whole list of a deck: Main Deck by card type, then the Extra (Fusion) Deck, with counts; hover a card to read it
function deckList(f, d, title, opts = {}) {
  closeDeckList(); S.play('click');
  const main = sortDeck(f, d.main), extra = sortDeck(f, d.extra);
  const W = 1576, H = extra.length ? 560 : 740, m = fitCards(main.length, W, H, 8), wm = Math.min(m.w, 150);
  const e = extra.length ? fitCards(extra.length, W - 40, 150, 8) : null, we = e ? Math.min(e.w, wm, 103) : 0;
  const tile = (id, w) => { const r = rec(f, id); return `<div class="dl" data-id="${id}" style="width:${w}px"><div class="card" style="background-image:url(${artUrl(id)});width:${w}px;height:${w * 614 / 421}px" title="${esc(r ? r.n : '')}"></div></div>`; };
  const nMon = main.filter(id => typeOrder(f, id) === 0).length, nSp = main.filter(id => typeOrder(f, id) === 2).length, nTr = main.filter(id => typeOrder(f, id) === 3).length;
  const v = document.createElement('div'); v.className = 'veil'; v.id = 'dlVeil'; v.style.zIndex = 59;
  const p = document.createElement('div'); p.className = 'pn dlist'; p.id = 'dlist';
  p.innerHTML = `<div class="head"><h3 class="disp" style="font-size:52px">${esc(title)}: ${esc(d.name)}</h3><span class="tg hot">${main.length} cards</span><span class="tg">${nMon} mon · ${nSp} spell · ${nTr} trap</span>${opts.copy ? `<button class="gb sm pri" id="dlCopy"><svg><use href="#i-cards"/></svg>Copy to Deck Builder<span class="shine"></span></button>` : ''}<button class="gb sm" id="dlClose"><svg><use href="#i-x"/></svg>Close<span class="key">Esc</span><span class="shine"></span></button></div>
    <div class="body"><div class="sec2">Main Deck</div><div class="fitgrid" style="grid-template-columns:repeat(${m.cols},${wm}px)">${main.map(id => tile(id, wm)).join('')}</div>
    ${extra.length ? `<div class="sec2" style="margin-top:14px">${f === 'goat' ? 'Fusion Deck' : 'Extra Deck'} · ${extra.length}</div><div class="fitgrid" style="grid-template-columns:repeat(${Math.max(e.cols, 1)},${we}px)">${extra.map(id => tile(id, we)).join('')}</div>${d.extraNote ? `<div class="mute" style="font-size:14px;margin-top:6px">${esc(d.extraNote)}.</div>` : ''}` : ''}</div>
    <div class="pn peek hidden" id="dlPeek"></div>`;
  stage.append(v, p);
  v.onclick = closeDeckList; p.querySelector('#dlClose').onclick = closeDeckList; if (opts.copy) p.querySelector('#dlCopy').onclick = () => { closeDeckList(); opts.copy(); };
  if (!MOBILE) p.addEventListener('click', e2 => peekOver(e2, p, f));
  if (MOBILE) p.querySelector('.body').onclick = e => { const t = e.target.closest('[data-id]'); if (t) cardSheet(t.dataset.id); };
}
function closeDeckList() { const a = $('#dlist'), b = $('#dlVeil'); if (a) { a.remove(); b && b.remove(); S.play('click'); return true; } return false; }

/* ---------- card detail text, shared by every card list ---------- */
function cardMeta(r) {
  const mon = !['spell', 'trap'].includes(r.k);
  return mon ? [r.a, r.r, r.k === 'token' ? 'Token' : null, r.lv ? `Level ${r.lv}` : null, `${r.atk} / ${r.def}`].filter(Boolean).join(' · ') : `${r.k === 'spell' ? 'Spell' : 'Trap'}${r.sub && r.sub !== 'Normal' ? ' · ' + r.sub : ''}`;
}
const cardText = (f, r) => f === 'edison' && r.ps && !/^No rulings/.test(r.ps) ? r.ps : (r.tx || '');

/* ---------- a pile on the table: every card in a Graveyard, the banished cards, your Extra Deck ---------- */
function pileView(pi, kind) {
  if (!D || !D.view) return;
  if (kind === 'gy' || kind === 'ban') return gyView(pi, kind);
  const P = D.view.p[pi], who = pi === 0 ? 'Your' : "The computer's";
  if (kind === 'deck') { toast(`${who} Deck: ${P.deck} cards.`); return; }
  if (kind === 'extra' && pi === 1) { toast(`The computer's ${D.fmt === 'goat' ? 'Fusion' : 'Extra'} Deck: ${P.extra.length} cards, face-down.`); return; }
  const list = [...P[kind]].reverse(); // newest first
  const title = `${who} ${kind === 'gy' ? 'Graveyard' : kind === 'ban' ? 'banished cards' : (D.fmt === 'goat' ? 'Fusion Deck' : 'Extra Deck')}`;
  if (!list.length) { toast(`${title}: empty.`); return; }
  closeDeckList(); S.play('click');
  const v = document.createElement('div'); v.className = 'veil'; v.id = 'dlVeil'; v.style.zIndex = 59;
  const p = document.createElement('div'); p.className = 'pn dlist'; p.id = 'dlist';
  p.innerHTML = `<div class="head"><h3 class="disp">${esc(title)}</h3><span class="tg hot">${list.length} card${list.length > 1 ? 's' : ''}</span>${kind === 'gy' ? '<span class="mute" style="font-size:15px">Newest first</span>' : ''}<button class="gb sm" id="dlClose"><svg><use href="#i-x"/></svg>Close<span class="key">Esc</span><span class="shine"></span></button></div>
    <div class="body"><div class="grid">${list.map(c => { const r = rec(D.fmt, c.id); return `<div class="dl" data-id="${c.id}"><div class="card" style="background-image:url(${artUrl(c.id)})"></div>${esc(r ? r.n : '')}</div>`; }).join('')}</div></div>
    <div class="pn peek hidden" id="dlPeek"></div>`;
  $('#layer').append(v, p);
  v.onclick = closeDeckList; p.querySelector('#dlClose').onclick = closeDeckList;
  if (!MOBILE) p.addEventListener('click', e => peekOver(e, p, D.fmt));
}
function gyView(pi, kind) {
  const P = D.view.p[pi], who = pi === 0 ? 'Your' : "The computer's";
  if (!P.gy.length && !P.ban.length) { toast(`${who} Graveyard is empty.`); return; }
  if (!P[kind].length) kind = kind === 'gy' ? 'ban' : 'gy';
  closeDeckList(); S.play('click');
  const v = document.createElement('div'); v.className = 'veil'; v.id = 'dlVeil'; v.style.zIndex = 59;
  const p = document.createElement('div'); p.className = 'pn dlist gyv'; p.id = 'dlist';
  const draw = () => {
    const list = [...P[kind]].reverse();
    p.innerHTML = `<div class="head"><h3 class="disp">${who} cards</h3><button class="gb sm" id="dlClose"><svg><use href="#i-x"/></svg>Close<span class="key">Esc</span><span class="shine"></span></button></div>
      <div class="gytabs"><button class="${kind === 'gy' ? 'on' : ''}" data-k="gy">Graveyard <b>${P.gy.length}</b></button><button class="${kind === 'ban' ? 'on ban' : ''}" data-k="ban">Banished <b>${P.ban.length}</b></button></div>
      <div class="body">${list.length ? `<div class="grid">${list.map(c => { const r = rec(D.fmt, c.id); return `<div class="dl" data-id="${c.id}"><div class="card" style="background-image:url(${artUrl(c.id)})"></div>${esc(r ? r.n : '')}</div>`; }).join('')}</div>` : `<div class="mute" style="padding:20px 4px">No ${kind === 'gy' ? 'cards in the Graveyard' : 'banished cards'}.</div>`}</div>
      <div class="pn peek hidden" id="dlPeek"></div>`;
    p.querySelector('#dlClose').onclick = closeDeckList;
    p.querySelector('.gytabs').onclick = e => { const b = e.target.closest('[data-k]'); if (b && b.dataset.k !== kind) { kind = b.dataset.k; S.play('click'); draw(); } };
    if (MOBILE) p.querySelector('.body').onclick = e => { const t = e.target.closest('[data-id]'); if (t) cardSheet(t.dataset.id); };
  };
  draw(); $('#layer').append(v, p); v.onclick = closeDeckList; if (!MOBILE) p.addEventListener('click', e => peekOver(e, p, D.fmt));
}
function peekOver(e, p, f) {
  if (MOBILE) return;   // phones read a card in its own sheet (a tap); the hover preview would stay behind with no way to close it (Zack, 2026-11-25)
  const pk = p.querySelector('#dlPeek'); if (!pk) return;
  if (e.target.closest('[data-pkx]') || (!e.target.closest('[data-id]') && !e.target.closest('#dlPeek'))) { pk.classList.add('hidden'); return; }   // its X, or a click away from the cards, closes it
  const t = e.target.closest('[data-id]'); if (!t || t.closest('#dlPeek')) return; const r = rec(f, t.dataset.id); if (!r) return; pk.classList.remove('hidden'); S.play('click');
  pk.innerHTML = `<button class="gb sm ico pkx" data-pkx title="Close"><svg><use href="#i-x"/></svg><span class="shine"></span></button><div class="card" style="background-image:url(${artUrl(t.dataset.id)})"></div><h4>${esc(r.n)}</h4><div class="meta">${esc(cardMeta(r))}</div><p>${esc(cardText(f, r))}</p>`;
  const right = e.clientX - stage.getBoundingClientRect().left > stage.getBoundingClientRect().width / 2; pk.style.left = right ? '40px' : ''; pk.style.right = right ? '' : '40px';
}

/* =====================================================================================================
   CUSTOM DECKS (Zack, 2026-11-24: saved in this browser for now; sign-in to keep them across devices comes later)
   ===================================================================================================== */
const MY = () => JSON.parse(localStorage.getItem('lrplay:decks') || '[]');
const saveMY = a => localStorage.setItem('lrplay:decks', JSON.stringify(a));
const isExtraK = r => r && (r.k === 'fusion' || r.k === 'synchro');
const LIMIT = r => r && r.b === 'F' ? 0 : r && r.b === 'L' ? 1 : r && r.b === 'S' ? 2 : 3;
// what's wrong with a deck under its format's rules (empty: legal)
// the empty deck shows how the builder works (Zack, 2026-11-24: "update with the new mechanics... and any other brief useful tutorial type info")
function howTo(f, xl) {
  const tip = (h, t) => `<div class="tip"><b>${h}</b><span>${t}</span></div>`;
  return `<div class="pn howto" id="howto"><h4 class="disp">Build your deck</h4>
    ${tip(TOUCH ? 'Tap a card' : 'Click a card', 'to read it, then Add to deck.')}
    ${MOBILE ? tip('Cards and Your deck', 'are tabs at the top. Tap a card in either to read it, then add or remove it.') : TOUCH ? tip('Hold a card and drag it', 'here to add it. Hold one in your deck and drag it back to the left to remove it.') : tip('Drag a card', `here to add it. Drag one back to the cards on the left to remove it.`)}
    ${TOUCH ? '' : tip('Right-click', 'adds a card from the left, or removes one from your deck, in one go.')}
    ${tip('Search and filter', `by name or card text, or show only Monsters, Spells, Traps or ${xl} cards.`)}
    ${tip('Deck rules', `40 to 60 cards in the Main Deck, up to 15 in the ${xl} Deck, 3 copies at most. Cards marked F, L or S are Forbidden, Limited (1) or Semi-Limited (2) on the ${f === 'goat' ? 'Goat' : 'Edison'} banlist.`)}
    ${tip('Start from a deck', 'copies one of the prebuilt decks so you can change it.')}
    ${tip('Save', 'names your deck. It then shows up under My decks when you pick a deck to duel.')}
    <div class="hfoot"><label class="chk"><input type="checkbox" id="htOff"><span></span>Don't show this again</label><button class="gb pri" id="htOk">OK<span class="shine"></span></button></div></div>`;
}
function deckProblems(f, d) {
  const out = []; const all = [...d.main, ...d.extra]; const n = new Map(); for (const id of all) n.set(id, (n.get(id) || 0) + 1);
  if (d.main.length < 40) out.push(`The Main Deck needs at least 40 cards (it has ${d.main.length}).`);
  if (d.main.length > 60) out.push(`The Main Deck can hold at most 60 cards (it has ${d.main.length}).`);
  if (d.extra.length > 15) out.push(`The ${f === 'goat' ? 'Fusion' : 'Extra'} Deck can hold at most 15 cards.`);
  for (const [id, k] of n) { const r = rec(f, id); const lim = LIMIT(r); if (k > lim) out.push(`${r ? r.n : id}: ${lim === 0 ? 'Forbidden' : `at most ${lim}`} under the ${f === 'goat' ? 'Goat' : 'Edison'} banlist.`); }
  return out;
}
const scriptedSet = {}; function playable(f, id) { if (!scriptedSet[f]) scriptedSet[f] = new Set(READY ? READY[f].scripted : []); return scriptedSet[f].has(String(id)); }
// every deck for a format: your own first, then the prebuilt ones. key: the prebuilt name, or 'my:<id>'
function allDecks(f) {
  const mine = MY().filter(d => d.fmt === f).map(d => ({ key: 'my:' + d.id, name: d.name, tier: 'my', main: d.main, extra: d.extra, custom: true }));
  return [...mine, ...FM[f].decks.map(d => ({ ...d, key: d.name }))];
}
function deckInfo(f, d) {
  if (!d.custom) { const r = READY[f].decks.find(x => x.name === d.name); return r || { ready: false, missing: [] }; }
  const missing = [...new Set([...d.main, ...d.extra].filter(id => !playable(f, id)).map(id => (rec(f, id) || {}).n || id))];
  const probs = deckProblems(f, d); return { ready: !missing.length && !probs.length, missing, problems: probs };
}
const deckByKey = (f, k) => allDecks(f).find(d => d.key === k);

/* ---------- the builder screen ---------- */
const B = { fmt: null, deck: null, q: '', type: 'all', dirty: false };
function newDeck(f) { return { id: Date.now().toString(36), fmt: f, name: 'My new deck', main: [], extra: [] }; }
function renderLists() {
  const f = B.lfmt || B.fmt, tiers = TIERS[f], el = $('#bListsPanel'); B.ltier = B.ltier || 'all';   // its own format choice, so the deck you are building is left alone
  const decks = FM[f].decks.filter(d => B.ltier === 'all' || d.tier === B.ltier);
  const xl = f === 'goat' ? 'Fusion' : 'Extra';
  el.innerHTML = `<div class="lhead"><div class="seg lfmt">${['goat', 'edison'].map(x => `<button class="gb sm ${x === f ? 'pri' : ''}" data-lf="${x}">${x === 'goat' ? 'Goat' : 'Edison'}<span class="shine"></span></button>`).join('')}</div><div class="seg ltiers">${['all', ...tiers].map(t => `<button class="gb sm ${B.ltier === t ? 'pri' : ''}" data-lt="${t}">${t === 'all' ? 'All' : (TIERNAME[t] || t)}<span class="shine"></span></button>`).join('')}</div></div>
    <div class="lgrid">${decks.map((d, i) => { const kc = keyCards(f, d), ok = deckInfo(f, d).ready;
      return `<div class="ldeck ${ok ? '' : 'off'}" data-i="${FM[f].decks.indexOf(d)}"><div class="lfan">${kc.map((id, j) => `<div class="card" style="background-image:url(${artUrl(id)})" data-j="${j}"></div>`).join('')}</div>
        <div class="lmeta"><div class="lname">${esc(d.name)}</div><div class="lsub">${d.main.length} cards${d.extra.length ? ` · ${d.extra.length} ${xl}` : ''}</div></div><span class="tg ${d.tier === tiers[0] ? 'hot' : ''}">${esc(TIERNAME[d.tier] || d.tier)}</span></div>`; }).join('')}</div>`;
  el.onclick = e => {
    const t = e.target.closest('[data-lt]'); if (t) { B.ltier = t.dataset.lt; S.play('click'); renderLists(); return; }
    const fm = e.target.closest('[data-lf]'); if (fm && fm.dataset.lf !== f) { B.lfmt = fm.dataset.lf; B.ltier = 'all'; S.play('click'); renderLists(); return; }
    const c = e.target.closest('[data-i]'); if (!c) return; const d = FM[f].decks[+c.dataset.i];
    deckList(f, d, `${f === 'goat' ? 'Goat' : 'Edison'} · ${TIERNAME[d.tier] || d.tier}`, { copy: async () => { if (B.dirty && !(await ask('Replace the deck you are building with a copy of this one?', 'Copy'))) return;
      B.fmt = f; B.deck = { ...newDeck(f), name: 'My ' + d.name, main: [...d.main], extra: [...d.extra] }; B.dirty = true; setBView('build'); renderBuilder(); toast(`${d.name} copied. Change it and Save it as your own.`); } });
  };
}
// the Deck Builder's views: building (Cards and Your deck) or Deck lists
function setBView(v) { B.view = v; $('#s-build').classList.toggle('listview', v === 'lists'); if (MOBILE && v !== 'lists' && B.mtab === 'lists') B.mtab = 'pool'; if (v === 'lists') renderLists(); }
function openBuilder() {
  B.fmt = B.fmt || SEL.fmt; if (!B.deck || B.deck.fmt !== B.fmt) { const mine = MY().filter(d => d.fmt === B.fmt); B.deck = mine.length ? JSON.parse(JSON.stringify(mine[0])) : newDeck(B.fmt); B.dirty = false; }
  renderBuilder();
}
function renderBuilder() {
  const f = B.fmt; 
  $('#bBar').innerHTML = `<input class="inp" id="bQ" placeholder="Search cards by name or text" value="${esc(B.q)}">
    <div class="seg" id="bType">${[['all', 'All'], ['mon', 'Monsters'], ['spell', 'Spells'], ['trap', 'Traps'], ['extra', f === 'goat' ? 'Fusion' : 'Extra']].map(([k, l]) => `<button class="gb sm ${B.type === k ? 'pri' : ''}" data-t="${k}">${l}<span class="shine"></span></button>`).join('')}</div>
    <div class="seg fmtb" id="bFmt">${['goat', 'edison'].map(x => `<button class="gb sm ${x === f ? 'pri' : ''}" data-f="${x}">${x === 'goat' ? 'Goat' : 'Edison'}<span class="shine"></span></button>`).join('')}</div>`;
  $('#bFmt').onclick = async e => { const b = e.target.closest('[data-f]'); if (!b || b.dataset.f === f) return; if (B.dirty && !(await ask('Leave this deck without saving?', 'Leave'))) return; B.fmt = b.dataset.f; B.deck = null; S.play('click'); openBuilder(); };
  $('#bQ').oninput = e => { B.q = e.target.value; renderPool(); };
  $('#bType').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; B.type = b.dataset.t; S.play('click'); renderBuilder(); };
  renderPool(); renderDeckSide();
  if (MOBILE) { const t = $('#mbTabs'); t.innerHTML = `<button class="${!B.mtab || B.mtab === 'pool' ? 'on' : ''}" data-mt="pool">Cards</button><button class="${B.mtab === 'deck' ? 'on' : ''}" data-mt="deck">Your deck · <b id="mbN">${B.deck.main.length}</b></button><button class="${B.mtab === 'lists' ? 'on' : ''}" data-mt="lists">Deck lists</button>`;
    $('#s-build').classList.toggle('deckview', B.mtab === 'deck'); stage.style.setProperty('--bt', ($('#bBoard').offsetHeight + 10) + 'px');
    t.onclick = e => { const b = e.target.closest('[data-mt]'); if (!b) return; B.mtab = b.dataset.mt; S.play('click'); closeCardZoom(); t.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('#s-build').classList.toggle('deckview', B.mtab === 'deck'); setBView(B.mtab === 'lists' ? 'lists' : 'build'); }; }
  if (B.view === 'lists') setBView('lists');
}
function poolCards() {
  const f = B.fmt, q = B.q.trim().toLowerCase();
  let cs = FM[f].cards.filter(c => playable(f, c.id));
  if (B.type === 'mon') cs = cs.filter(c => !['spell', 'trap'].includes(c.k) && !isExtraK(c));
  else if (B.type === 'extra') cs = cs.filter(isExtraK);
  else if (B.type !== 'all') cs = cs.filter(c => c.k === B.type);
  if (q) cs = cs.filter(c => c.n.toLowerCase().includes(q) || (c.tx || '').toLowerCase().includes(q));
  const ord = c => ['spell', 'trap'].includes(c.k) ? (c.k === 'spell' ? 2 : 3) : isExtraK(c) ? 4 : (c.k === 'normal' ? 1 : 0);
  return cs.sort((a, b) => ord(a) - ord(b) || a.n.localeCompare(b.n));
}
function inDeck(id) { return [...B.deck.main, ...B.deck.extra].filter(x => String(x) === String(id)).length; }
function renderPool() {
  const cs = poolCards();
  $('#bPool').innerHTML = cs.map(c => { const k = inDeck(c.id), lim = LIMIT(c);
    return `<div class="pc ${k >= lim ? 'max' : ''}" data-id="${c.id}" draggable="true"><img class="card" loading="lazy" alt="" draggable="false" src="${artUrl(c.id)}">${c.b ? `<span class="lim ${c.b}">${c.b}</span>` : ''}${k ? `<span class="in">${k}</span>` : ''}</div>`; }).join('') || '<div class="mute" style="grid-column:1/-1;font-size:20px">No cards match.</div>';
  const pool = $('#bPool');
  pool.onclick = e => { const t = e.target.closest('[data-id]'); if (t) cardZoom(t.dataset.id, 'add'); };
  pool.oncontextmenu = e => { e.preventDefault(); const t = e.target.closest('[data-id]'); if (t) removeCard(t.dataset.id); };
}
function builderPeek(e) {
  const t = e.target.closest('[data-id]'); const pk = $('#bPeek'); if (!t) return; const r = rec(B.fmt, t.dataset.id); if (!r) return;
  pk.classList.remove('hidden'); pk.innerHTML = `<div class="card" style="background-image:url(${artUrl(t.dataset.id)})"></div><h4>${esc(r.n)}</h4><div class="meta">${esc(cardMeta(r))}</div><p>${esc(cardText(B.fmt, r))}</p>`;
  const sr = stage.getBoundingClientRect(), x = (e.clientX - sr.left) / scale; Object.assign(pk.style, x > 960 ? { left: '60px', right: '', top: '250px' } : { left: '', right: '60px', top: '250px' });
}
function addCard(id) {
  const r = rec(B.fmt, id); if (!r) return; const lim = LIMIT(r);
  if (inDeck(id) >= lim) { S.play('error'); toast(lim === 0 ? `${r.n} is Forbidden.` : `${r.n}: ${lim === 3 ? 'three copies at most' : `at most ${lim} under the banlist`}.`); return; }
  const into = isExtraK(r) ? B.deck.extra : B.deck.main;
  if (into === B.deck.main && into.length >= 60) { S.play('error'); toast('The Main Deck holds at most 60 cards.'); return; }
  if (into === B.deck.extra && into.length >= 15) { S.play('error'); toast(`The ${B.fmt === 'goat' ? 'Fusion' : 'Extra'} Deck holds at most 15 cards.`); return; }
  into.push(String(id)); B.dirty = true; S.play('place', { gap: 30 }); renderPool(); renderDeckSide();
}
function removeCard(id) {
  for (const arr of [B.deck.main, B.deck.extra]) { const i = arr.lastIndexOf(String(id)); if (i >= 0) { arr.splice(i, 1); B.dirty = true; S.play('set', { gap: 30 }); renderPool(); renderDeckSide(); return; } }
}
// card width so n cards fit a W x H box (every copy shown, so the whole deck is on screen)
function fitCards(n, W, H, gap = 5, ratio = 614 / 421) {
  let best = { w: 0, cols: 1 }; for (let cols = 1; cols <= Math.max(1, n); cols++) { const w = (W - gap * (cols - 1)) / cols, rows = Math.ceil(n / cols); if (rows * (w * ratio) + gap * (rows - 1) <= H && w > best.w) best = { w, cols }; }
  if (!best.w) { const cols = Math.max(1, n); best = { w: (W - gap * (cols - 1)) / cols, cols }; } return best;
}
const typeOrder = (f, id) => { const r = rec(f, id); return !r ? 9 : isExtraK(r) ? 4 : r.k === 'spell' ? 2 : r.k === 'trap' ? 3 : 0; };
const sortDeck = (f, ids) => [...ids].sort((a, b) => typeOrder(f, a) - typeOrder(f, b) || ((rec(f, a) || {}).n || '').localeCompare((rec(f, b) || {}).n || ''));
function renderDeckSide() {
  const f = B.fmt, d = B.deck, probs = deckProblems(f, d); if ($('#mbN')) $('#mbN').textContent = d.main.length;
  const nMon = d.main.filter(id => typeOrder(f, id) === 0).length, nSp = d.main.filter(id => typeOrder(f, id) === 2).length, nTr = d.main.filter(id => typeOrder(f, id) === 3).length;
  const okMain = d.main.length >= 40 && d.main.length <= 60;
  // the bottom bar's live count: Main and Extra/Fusion against their limits, and whether the deck is ready to duel
  const xn = f === 'goat' ? 'Fusion' : 'Extra';
  $('#bStat').innerHTML = `<span class="${okMain ? 'ok' : 'bad'}">Main ${d.main.length}<i> / 40–60</i></span><span class="${d.extra.length > 15 ? 'bad' : ''}">${xn} ${d.extra.length}<i> / 15</i></span><span class="${probs.length ? 'bad' : 'ok'}">${probs.length ? 'Not ready' : 'Ready to duel'}</span>`;
  $('#bBoard').innerHTML = `<div class="cell name" style="flex:1"><div class="k">Deck · ${f === 'goat' ? 'Goat' : 'Edison'}</div><input id="bName" value="${esc(d.name)}" maxlength="40"></div>
    <div class="cell"><div class="k">Main</div><div class="v ${okMain ? 'ok' : 'bad'}">${d.main.length}</div></div>
    <div class="cell"><div class="k">${f === 'goat' ? 'Fusion' : 'Extra'}</div><div class="v ${d.extra.length > 15 ? 'bad' : ''}">${d.extra.length}</div></div>
    <div class="cell"><div class="k">Mon · Spell · Trap</div><div class="v">${nMon}·${nSp}·${nTr}</div></div>
    <div class="act"><div class="seg bview" id="bView"><button class="gb sm ${B.view !== 'lists' ? 'pri' : ''}" data-bv="build"><svg><use href="#i-cards"/></svg>Deck Builder<span class="shine"></span></button><button class="gb sm ${B.view === 'lists' ? 'pri' : ''}" data-bv="lists"><svg><use href="#i-list"/></svg>Deck lists<span class="shine"></span></button></div><button class="gb sm" id="bMine">My decks<span class="shine"></span></button><button class="gb sm" id="bCopy">Start from a deck<span class="shine"></span></button><button class="gb sm" id="bNew">New<span class="shine"></span></button><button class="gb sm" id="bDel">Delete<span class="shine"></span></button></div>
    <button class="savebtn" id="bSave">${B.dirty ? 'Save' : 'Saved'}</button>`;
  // the roster (right half): every card of the Main Deck and the Extra (Fusion) Deck, sized to fit without scrolling
  const main = sortDeck(f, d.main), extra = sortDeck(f, d.extra), RW = 912, xl = f === 'goat' ? 'Fusion' : 'Extra';
  const eH = extra.length > 8 ? 250 : 190, mH = 874 - 28 - 70 - eH - 40;
  const fm = fitCards(Math.max(1, main.length), RW, mH), w = Math.min(fm.w, 120);
  const fe = fitCards(Math.max(1, extra.length), RW, eH - 30), we = Math.min(fe.w, w, 100);
  const tile = id => `<div class="x" data-id="${id}" draggable="true"><img alt="" draggable="false" src="${artUrl(id)}"></div>`;
  const statLine = probs.length ? `<span style="color:#ff8a7a">${esc(probs[0])}</span>` : `<span style="color:#8dff9e">Legal under the ${f === 'goat' ? 'Goat' : 'Edison'} banlist · ready to duel</span>`;
  // the how-to window (Zack, 2026-11-24: "a distinct window with an 'ok' and 'do not show me this again'"): shown over an empty deck until OK
  // (this visit) or "Don't show this again" (lrplay:howto); the ? beside Your deck opens it again
  const showHow = B.howto !== false && localStorage.getItem('lrplay:howto') !== 'off' || B.howto === true;
  $('#bDeck').innerHTML = `<div class="rhead"><div class="lbl">Your deck</div><button class="hq" id="htQ" title="How the Deck Builder works">?</button><div class="stat">${statLine}</div></div>
    ${main.length ? `<div class="main" style="grid-template-columns:repeat(${fm.cols},${w}px)">${main.map(tile).join('')}</div>` : `<div class="dropme"><b>Drag cards here</b><span>or ${TAP()} a card on the left to read it and add it</span></div>`}
    ${showHow && (!main.length || B.howto === true) ? howTo(f, xl) : ''}
    <div class="extra" style="grid-template-columns:repeat(${fe.cols},${we}px)"><div class="xl">${xl} deck · ${extra.length}</div>${extra.map(tile).join('')}</div>`;
  $('#htQ').onclick = () => { B.howto = true; S.play('click'); renderDeckSide(); };
  if ($('#htOk')) $('#htOk').onclick = () => { if ($('#htOff').checked) localStorage.setItem('lrplay:howto', 'off'); B.howto = false; S.play('click'); renderDeckSide(); };
  $('#bName').oninput = e => { d.name = e.target.value; B.dirty = true; $('#bSave').textContent = 'Save'; };
  $('#bSave').onclick = saveDeck; $('#bNew').onclick = async () => { if (B.dirty && !(await ask('Start a new deck without saving this one?', 'New deck'))) return; B.deck = newDeck(f); B.dirty = false; S.play('click'); renderBuilder(); };
  $('#bDel').onclick = async () => { const all = MY(); if (!all.some(x => x.id === d.id)) { B.deck = newDeck(f); B.dirty = false; renderBuilder(); return; } if (!(await ask(`Delete "${d.name}"? This can't be undone.`, 'Delete'))) return; saveMY(all.filter(x => x.id !== d.id)); B.deck = null; S.play('destroy'); openBuilder(); };
  $('#bMine').onclick = () => myDecksDialog(f);
  // the Deck Builder and Deck lists are two tabs (Zack, 2026-11-25: "the deck builder should have its own tab")
  $('#bView').onclick = e => { const b = e.target.closest('[data-bv]'); if (!b || (b.dataset.bv === 'lists') === (B.view === 'lists')) return; S.play('click'); setBView(b.dataset.bv); $$('#bView [data-bv]').forEach(x => x.classList.toggle('pri', x === b)); };
  $('#bCopy').onclick = () => pickDialog('Start from a deck', FM[f].decks, x => { B.deck = { ...newDeck(f), name: 'My ' + x.name, main: [...x.main], extra: [...x.extra] }; B.dirty = true; renderBuilder(); });
  const dk = $('#bDeck'); dk.onclick = e => { const t = e.target.closest('[data-id]'); if (t) cardZoom(t.dataset.id, 'remove'); };
  dk.oncontextmenu = e => { e.preventDefault(); const t = e.target.closest('[data-id]'); if (t) addCard(t.dataset.id); };
}

/* the Deck Builder's card view (Zack, 2026-11-24: "rather than the card showing up on the right when hovering... left click enlarges the card over
   the left pane where they can read it, and then have the option to add to deck with another click"): a click on a card in the pool opens it large
   over the pool with Add to deck; a click on a card in your deck opens it over your deck with Remove from deck. Right-click still adds or removes at once. */
function cardZoom(id, mode) {
  closeCardZoom(); const r = rec(B.fmt, id); if (!r) return; S.play('click');
  const z = document.createElement('div'); z.className = 'pn czoom ' + (mode === 'add' ? 'left' : 'right'); z.id = 'czoom';
  const paint = () => { const k = inDeck(id), lim = LIMIT(r), full = mode === 'add' ? k >= lim : k <= 0;
    z.innerHTML = `<img class="zc" alt="" src="${artUrl(id)}"><div class="zi"><h3 class="disp">${esc(r.n)}</h3><div class="meta">${esc(cardMeta(r))}</div>
      <p>${esc(cardText(B.fmt, r))}</p>
      <div class="cnt">${lim === 0 ? 'Forbidden under this banlist' : `In your deck: <b>${k}</b> of ${lim}${r.b ? ` (${r.b === 'L' ? 'Limited' : 'Semi-Limited'})` : ''}`}</div>
      <div class="btns"><button class="gb pri" data-z="go" ${full ? 'disabled' : ''}>${mode === 'add' ? 'Add to deck' : 'Remove from deck'}<span class="shine"></span></button>
      <button class="gb" data-z="x">Close<span class="key">Esc</span><span class="shine"></span></button></div></div>`; };
  paint(); $('#s-build').appendChild(z);
  z.onclick = e => { const b = e.target.closest('[data-z]'); if (!b) return; if (b.dataset.z === 'x') return closeCardZoom(); if (mode === 'add') addCard(id); else removeCard(id); closeCardZoom(); };  // one add or remove, then back to the list (Zack, 2026-11-24)
}
function closeCardZoom() { const z = $('#czoom'); if (z) { z.remove(); return true; } return false; }


/* drag and drop in the Deck Builder (Zack, 2026-11-24: "support drag and dropping for both adding and removing, which skips the enlarge and add steps"):
   drag a card from the pool onto your deck to add it, or from your deck onto the pool to remove it. Bound once; the panes keep their elements. */
(function builderDrag() {
  const pool = $('#bPool'), deck = $('#bDeck'); let drag = null;
  const start = (from) => e => { const t = e.target.closest('[data-id]'); if (!t) return; closeCardZoom(); drag = { id: t.dataset.id, from };
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.dataset.id); const img = t.querySelector('img'); if (img) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
    t.classList.add('dragging'); (from === 'pool' ? deck : pool).classList.add('droppable'); };
  const end = e => { const t = e.target.closest('[data-id]'); if (t) t.classList.remove('dragging'); pool.classList.remove('droppable', 'over'); deck.classList.remove('droppable', 'over'); drag = null; };
  const over = (target, from) => e => { if (!drag || drag.from !== from) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; target.classList.add('over'); };
  const leave = target => e => { if (!target.contains(e.relatedTarget)) target.classList.remove('over'); };
  const drop = (target, from, act) => e => { if (!drag || drag.from !== from) return; e.preventDefault(); const id = drag.id; end(e); act(id); };
  pool.addEventListener('dragstart', start('pool')); deck.addEventListener('dragstart', start('deck'));
  pool.addEventListener('dragend', end); deck.addEventListener('dragend', end);
  deck.addEventListener('dragover', over(deck, 'pool')); deck.addEventListener('dragleave', leave(deck)); deck.addEventListener('drop', drop(deck, 'pool', addCard));
  pool.addEventListener('dragover', over(pool, 'deck')); pool.addEventListener('dragleave', leave(pool)); pool.addEventListener('drop', drop(pool, 'deck', removeCard));
})();

/* touch drag in the Deck Builder (Zack, 2026-11-24: touch): phones and tablets have no HTML drag and drop, so holding a card
   for a moment picks it up (a quick swipe still scrolls the list), it follows your finger, and letting go over the other
   pane adds or removes it, the same as a mouse drag. */
(function builderTouchDrag() {
  const pool = $('#bPool'), deck = $('#bDeck'); let hold = null, drag = null;
  const paneAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && (el.closest('#bPool') || el.closest('#bDeck')); };
  const cancel = () => { if (hold) clearTimeout(hold.t); hold = null; if (drag) { drag.g.remove(); drag.src.classList.remove('dragging'); pool.classList.remove('droppable', 'over'); deck.classList.remove('droppable', 'over'); } drag = null; };
  const startHold = from => e => {
    if (e.touches.length !== 1) return cancel(); const t = e.target.closest('[data-id]'); if (!t) return;
    const p0 = e.touches[0]; hold = { x: p0.clientX, y: p0.clientY, t: setTimeout(() => {
      closeCardZoom(); const g = document.createElement('div'); g.className = 'tdrag'; g.style.backgroundImage = `url(${artUrl(t.dataset.id)})`;
      const s = toStage({ clientX: hold.x, clientY: hold.y }); g.style.left = s.x + 'px'; g.style.top = s.y + 'px'; stage.appendChild(g);
      drag = { id: t.dataset.id, from, g, src: t }; t.classList.add('dragging'); (from === 'pool' ? deck : pool).classList.add('droppable');
      S.play('hover'); if (navigator.vibrate) navigator.vibrate(15); }, 260) };
  };
  const move = e => {
    if (!hold && !drag) return; const p = e.touches[0];
    if (!drag) { if (Math.hypot(p.clientX - hold.x, p.clientY - hold.y) > 10) cancel(); return; }
    e.preventDefault(); const s = toStage(p); drag.g.style.left = s.x + 'px'; drag.g.style.top = s.y + 'px';
    const target = drag.from === 'pool' ? deck : pool; target.classList.toggle('over', paneAt(p.clientX, p.clientY) === target);
  };
  const end = e => {
    if (!drag) return cancel(); const p = e.changedTouches[0], d = drag, over = paneAt(p.clientX, p.clientY); cancel();
    if (d.from === 'pool' && over === deck) addCard(d.id); else if (d.from === 'deck' && over === pool) removeCard(d.id);
    e.preventDefault();
  };
  for (const [el, from] of [[pool, 'pool'], [deck, 'deck']]) {
    el.addEventListener('touchstart', startHold(from), { passive: true }); el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: false }); el.addEventListener('touchcancel', cancel);
  }
  // a long press would also bring up the browser's own menu or a right-click: neither belongs here
  for (const el of [pool, deck]) el.addEventListener('contextmenu', e => { if (TOUCH) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
})();

/* Add to home screen, phones only (Zack, 2026-11-25: "on mobile only is it possible to add a one click 'add to home screen' button?").
   Android's Chrome hands us an install prompt (beforeinstallprompt), so one tap installs; iPhones allow no website to do that, so the
   same button shows the two steps (Share, then Add to Home Screen). Hidden once the game is opened from the home screen. */
(function addToHome() {
  const b = $('#a2hs'); let evt = null;
  const installed = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  const upd = () => { b.hidden = !PHONE || installed() || localStorage.getItem('lrplay:a2hs') === 'done'; };
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); evt = e; upd(); });
  addEventListener('appinstalled', () => { localStorage.setItem('lrplay:a2hs', 'done'); upd(); toast('Learn Retro Play is on your home screen.'); });
  upd();
  const ios = /[?&]ios\b/.test(location.search) || /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  b.onclick = async () => {
    S.unlock(); S.play('click');
    if (evt) { evt.prompt(); const r = await evt.userChoice.catch(() => null); evt = null; if (r && r.outcome === 'accepted') { localStorage.setItem('lrplay:a2hs', 'done'); upd(); } return; }
    // the share sheet a website can open leaves out Add to Home Screen (on Zack's iPhone it offered Ask Gemini instead; 2026-11-25), so the
    // guide walks through the browser's own menu: Share, View More, Add to Home Screen. Chrome on iPhone and Safari name it the same way.
    const step = (n, icon, html) => `<div class="a2step"><b>${n}</b><span>${html}</span>${icon ? `<svg><use href="#i-${icon}"/></svg>` : ''}</div>`;
    const chromeIOS = /CriOS/.test(navigator.userAgent);
    const how = ios
      ? (chromeIOS ? step(1, 'share', 'Tap the <b>Share</b> button next to the address bar.')
                   : step(1, 'share', 'Tap <b>Share</b> in Safari’s toolbar. On newer iPhones, tap the <svg class="ii"><use href="#i-safmenu"/></svg> button to the left of the address bar, then <b>Share</b>.'))
        + step(2, 'viewmore', 'Tap <b>View More</b> and scroll down the list.') + step(3, 'addhome', 'Tap <b>Add to Home Screen</b>, then <b>Add</b>.')
      : step(1, 'dots', 'Open your browser’s menu, the three dots by the address bar.') + step(2, 'addhome', 'Tap <b>Install app</b> or <b>Add to Home screen</b>.');
    const v = document.createElement('div'); v.className = 'veil'; v.style.zIndex = 60;
    const p = document.createElement('div'); p.className = 'pn dlg a2dlg'; p.style.zIndex = 61;
    p.innerHTML = `<h3 class="disp">Add to home screen</h3><div class="sub">Learn Retro Play opens full screen from its own icon, like an app. Free, nothing to download.</div>${how}<div class="btns"><button class="gb pri" data-x>Got it<span class="shine"></span></button></div>`;
    stage.append(v, p); const close = () => { v.remove(); p.remove(); S.play('click'); }; v.onclick = close; p.querySelector('[data-x]').onclick = close;

  };
})();

/* full screen on touch screens that allow it (Android); on an iPhone, Add to Home Screen opens the game full screen */
(function fullBtn() {
  const b = $('#gFull'); const can = TOUCH && document.fullscreenEnabled && document.documentElement.requestFullscreen;
  if (!can) return; const upd = () => { b.hidden = !!document.fullscreenElement; }; upd();
  document.addEventListener('fullscreenchange', upd);
  b.onclick = () => { S.play('click'); document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {}); };
})();

/* My decks (Zack, 2026-11-24: "a rename and delete option"; no scroll bar): open, rename or delete each saved deck in this format */
function myDecksDialog(f) {
  S.play('click'); const v = document.createElement('div'); v.className = 'veil'; v.style.zIndex = 59; const p = document.createElement('div'); p.className = 'pn dlg mydecks'; p.style.zIndex = 60;
  const paint = () => { const list = MY().filter(x => x.fmt === f);
    p.innerHTML = `<h3 class="disp">My decks</h3><div class="mdl">${list.length ? list.map(x => `<div class="mdr" data-id="${esc(x.id)}"><button class="gb wide" data-a="open"><span class="lbl">${esc(x.name)}</span><span class="mute">${x.main.length} cards</span><span class="shine"></span></button>
      <button class="gb sm" data-a="ren">Rename<span class="shine"></span></button><button class="gb sm" data-a="del">Delete<span class="shine"></span></button></div>`).join('') : '<p class="mute">No saved decks yet.</p>'}</div>
      <div class="btns"><button class="gb" data-a="x">Close<span class="shine"></span></button></div>`; };
  paint(); stage.append(v, p); const close = () => { v.remove(); p.remove(); };
  v.onclick = close;
  p.onclick = async e => { const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a; if (a === 'x') return close();
    const id = b.closest('[data-id]').dataset.id, all = MY(), d = all.find(x => x.id === id); if (!d) return;
    if (a === 'open') { if (B.dirty && B.deck && B.deck.id !== id && !(await ask('Open this deck without saving the one you are building?', 'Open'))) return; close(); B.deck = JSON.parse(JSON.stringify(d)); B.dirty = false; S.play('click'); renderBuilder(); }
    if (a === 'ren') { const n = await askText('Rename this deck', d.name); if (n == null || !n.trim()) return; d.name = n.trim().slice(0, 40); d.updated = Date.now(); saveMY(all); if (B.deck && B.deck.id === id) { B.deck.name = d.name; renderDeckSide(); } S.play('click'); paint(); }
    if (a === 'del') { if (!(await ask(`Delete "${d.name}"? This can't be undone.`, 'Delete'))) return; saveMY(all.filter(x => x.id !== id)); if (B.deck && B.deck.id === id) { B.deck = newDeck(f); B.dirty = false; renderBuilder(); } S.play('set'); paint(); }
  };
}
function askText(title, value, ph = '') {
  return new Promise(res => {
    const v = document.createElement('div'); v.className = 'veil'; v.style.zIndex = 69; const p = document.createElement('div'); p.className = 'pn dlg'; p.style.zIndex = 70;
    p.innerHTML = `<h3 class="disp" style="font-size:28px">${esc(title)}</h3><input class="inp tinp" maxlength="40" value="${esc(value)}" placeholder="${esc(ph)}"><div class="btns"><button class="gb" data-n>Cancel<span class="shine"></span></button><button class="gb pri" data-y>Save<span class="shine"></span></button></div>`;
    stage.append(v, p); const inp = p.querySelector('input'); inp.focus(); inp.select();
    const done = r => { v.remove(); p.remove(); res(r); };
    v.onclick = () => done(null); inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); };
    p.onclick = e => { if (e.target.closest('[data-y]')) done(inp.value); else if (e.target.closest('[data-n]')) done(null); };
  });
}

/* the first save shows where decks live (Zack, 2026-11-24: "a popup notice... where they have to say 'ok' and a 'do not show me this again' checkbox") */
function saveNotice() {
  if (localStorage.getItem('lrplay:savenote') === 'off') return;
  const v = document.createElement('div'); v.className = 'veil'; v.style.zIndex = 69; const p = document.createElement('div'); p.className = 'pn dlg snote'; p.style.zIndex = 70;
  p.innerHTML = `<h3 class="disp">Saved in this browser</h3><p>Your decks, stats and settings are saved in this browser on this device. Clearing cookies and site data deletes them, and they don't carry over to another browser or device.</p>
    <label class="chk"><input type="checkbox" id="snOff"><span></span>Don't show this again</label><div class="btns"><button class="gb pri" data-ok>OK<span class="shine"></span></button></div>`;
  stage.append(v, p);
  p.querySelector('[data-ok]').onclick = () => { if (p.querySelector('#snOff').checked) localStorage.setItem('lrplay:savenote', 'off'); v.remove(); p.remove(); S.play('click'); };
}
async function saveDeck() {
  const d = B.deck;
  // a deck's first save asks for its name (Zack, 2026-11-24: "when clicking save for the first time on a deck, we should prompt them to name it")
  if (!MY().some(x => x.id === d.id)) { const n = await askText('Name your deck', d.name === 'My new deck' ? '' : d.name, 'e.g. My Goat Control'); if (n == null) return; if (!n.trim()) { toast('Give your deck a name to save it.'); S.play('error'); return; } d.name = n.trim().slice(0, 40); }
  d.name = (d.name || '').trim() || 'My deck'; d.updated = Date.now();
  const all = MY().filter(x => x.id !== d.id); all.unshift(JSON.parse(JSON.stringify(d))); saveMY(all); B.dirty = false; S.play('summon');
  toast(deckProblems(d.fmt, d).length ? `Saved "${d.name}". Fix the problems listed before dueling with it.` : `Saved "${d.name}". Pick it under My decks before a duel.`); renderDeckSide(); saveNotice();
}
function ask(text, yes = 'Yes', no = 'Cancel') {
  return new Promise(res => {
    S.play('click'); const v = document.createElement('div'); v.className = 'veil'; v.style.zIndex = 69; const p = document.createElement('div'); p.className = 'pn dlg'; p.style.zIndex = 70;
    p.innerHTML = `<h3 class="disp" style="font-size:28px">${esc(text)}</h3><div class="btns"><button class="gb" data-n>${esc(no)}<span class="shine"></span></button><button class="gb pri" data-y>${esc(yes)}<span class="shine"></span></button></div>`;
    stage.append(v, p); const done = r => { v.remove(); p.remove(); res(r); };
    v.onclick = () => done(false); p.onclick = e => { if (e.target.closest('[data-y]')) done(true); else if (e.target.closest('[data-n]')) done(false); };
  });
}
function pickDialog(title, list, onPick, empty) {
  S.play('click'); const v = document.createElement('div'); v.className = 'veil'; v.style.zIndex = 59; const p = document.createElement('div'); p.className = 'pn dlg'; p.style.zIndex = 60;
  p.innerHTML = `<h3 class="disp">${esc(title)}</h3><div class="opts" style="max-height:640px;overflow:auto">${list.length ? list.map((x, i) => `<button class="gb wide" data-i="${i}"><span class="lbl">${esc(x.name)}</span><span class="mute" style="margin-left:auto;font-size:14px;text-transform:none;letter-spacing:0">${x.main.length} cards</span><span class="shine"></span></button>`).join('') : `<div class="mute">${esc(empty || '')}</div>`}</div><div class="btns"><button class="gb sm" data-x>Close<span class="shine"></span></button></div>`;
  stage.append(v, p); const close = () => { v.remove(); p.remove(); };
  v.onclick = close; p.onclick = e => { if (e.target.closest('[data-x]')) return close(); const b = e.target.closest('[data-i]'); if (b) { close(); onPick(list[+b.dataset.i]); S.play('click'); } };
}
$('#resAgain').onclick = () => startDuel();

/* =====================================================================================================
   THE DUEL
   ===================================================================================================== */
let table = null, camData = null, D = null; // D: the duel's client state
const CAMS = {};
async function ensureTable() {
  if (table) return;
  await makeTable();
}
async function makeTable() {
  const key = MOBILE && !LAND ? 'shop-m' : 'shop';
  camData = CAMS[key] || (CAMS[key] = await (await fetch(`assets/scenes/${key}-camera.json`)).json());
  table = new Table($('#gl'), camData, { tokenArt: TOKEN_ART, view: MOBILE ? mview() : undefined });
  table.speed = SPEED[SET.speed];
  table.bindPointer($('#gl'), toStage);
  table.onHover = h => { $('#gl').classList.toggle('point', !!(h && (h.u != null || h.pile || h.zone))); if (!D) return; if (h && h.u != null) inspectU(h.u); else if (h && h.pile) hoverPile(h.pile); };
  table.onClick = h => { if (D) fieldClick(h); if (TOUCH && !h) $('#inspect').classList.add('hidden'); };
  table.onFrame = frameOverlay;
  // turn medallion and phase dial sit on the board's center line, just outside the mat
  const half = camData.board.BOARD_W / 2 + 0.62, L = table.project(new (table.camera.position.constructor)(-half, 0, 0)), R = table.project(new (table.camera.position.constructor)(half, 0, 0));
  if (!MOBILE) { Object.assign($('#turnm').style, { left: L.x + 'px', top: L.y + 'px' }); Object.assign($('#dial').style, { left: R.x + 'px', top: R.y + 'px' }); }
  if (!MOBILE) { $('#turnm').style.removeProperty('display'); } else { $('#turnm').style.left = $('#turnm').style.top = $('#dial').style.left = $('#dial').style.top = ''; }
  if (TOUCH) mobileDuelInput();
  if (MOBILE) placeMid();
}
// turning a phone mid-duel: a fresh table (and canvas) for the new layout's camera, then every card, pile and highlight put back
async function rebuildTable() {
  const old = table; table = null; old.dispose();
  const c = document.createElement('canvas'); c.id = 'gl'; $('#gl').replaceWith(c);
  for (const el of [...badges.values()]) el.remove(); badges.clear(); for (const k in pileEls) { pileEls[k].remove(); delete pileEls[k]; }
  await makeTable(); table.speed = SPEED[SET.speed];
  if (D && D.view) { D.piles = {}; reconcile(D.view); renderChain(); if (D.prompt) setPrompt(D.prompt); }
}
async function startDuel() {
  const f = SEL.fmt, s = SEL[f];
  const youDeck = deckByKey(f, s.you), cpuDeck = deckByKey(f, s.cpu); if (!youDeck || !cpuDeck) { show('deck'); return; }
  show('load'); $('#loadTxt').textContent = 'Shuffling…'; $('#loadSub').textContent = `${youDeck.name} vs ${cpuDeck.name} · ${f === 'goat' ? 'Goat' : 'Edison'} · ${levelName(SEL.level)}`;
  S.play('shuffle');
  await ensureTable();
  const first = Math.random() < 0.5 ? 0 : 1;
  const coin = $('#coin'); coin.className = 'coin ' + (first === 0 ? 'heads' : 'tails'); coin.style.animation = 'none'; void coin.offsetWidth; coin.style.animation = '';
  await sleep(1450); $('#loadTxt').textContent = first === 0 ? 'You go first' : 'The computer goes first'; S.play('turn');
  await sleep(1100);
  // reset the duel
  D = { fmt: f, you: youDeck.name, cpu: cpuDeck.name, youDeck, cpuDeck, first, q: [], busy: false, prompt: null, view: null, disp: null, lp: [8000, 8000], turn: 0, phase: '', tp: first,
    chain: [], log: [], stats: { summons: 0, synchro: 0, destroyed: 0, biggest: 0, dealt: 0, chains: 0, mvp: new Map(), lastAtk: null }, over: null, sel: null, zoneMode: null, picks: null };
  table.clearField(new Set()); for (const side of [1, -1]) for (const k of ['deck', 'extra', 'gy', 'ban']) table.setPile(side, k, 0, null);
  table.setPile(1, 'deck', youDeck.main.length, null); table.setPile(-1, 'deck', cpuDeck.main.length, null);
  table.setPile(1, 'extra', youDeck.extra.length, null); table.setPile(-1, 'extra', cpuDeck.extra.length, null);
  $('#hand').innerHTML = ''; $('#ohand').innerHTML = ''; $('#ov').innerHTML = ''; $('#layer').innerHTML = ''; $('#chainp').classList.add('hidden'); $('#inspect').classList.add('hidden');
  D.disp = { p: [{ hand: [], deck: youDeck.main.length }, { hand: [], deck: cpuDeck.main.length }] };
  setLP(0, 8000, true); setLP(1, 8000, true);
  $('#emMe').style.backgroundImage = `url(${artUrl(keyCards(f, youDeck)[0])})`; $('#emOp').style.backgroundImage = `url(${artUrl(keyCards(f, cpuDeck)[0])})`;
  $('#whoMe').textContent = 'You · ' + youDeck.name; $('#whoOp').textContent = 'Computer · ' + cpuDeck.name;
  $('#hcMe').textContent = 0; $('#hcOp').textContent = 0; $('#turnNo').textContent = 1; $('#phaseTxt').textContent = 'Draw';
  D.hintsUsed = 0; hintButton();
  setPrompt(null);
  show('duel');
  W.postMessage({ type: 'start', format: f, you: { name: youDeck.name, main: youDeck.main, extra: youDeck.extra }, cpu: { name: cpuDeck.name, main: cpuDeck.main, extra: cpuDeck.extra }, level: SEL.level, seed: Math.floor(Math.random() * 2 ** 31), first });
}

/* ---------- updates from the host, one at a time ---------- */
function duelUpdate(m) { if (!D) return; D.q.push(m); if (!D.busy) pump(); }
async function pump() {
  D.busy = true;
  while (D.q.length) {
    const m = D.q.shift(); const myD = D;
    for (const l of m.log) D.log.push(l);
    clearInteract();
    for (const ev of m.events) { try { await anim(ev); } catch (e) { console.error('anim', e, ev); } if (D !== myD) return;
      // a beat after each computer play: summons, activations, attacks, flips, position changes, cards put on the field
      const play = ['summon', 'chain', 'attack', 'flip', 'pos'].includes(ev.type) || (ev.type === 'move' && ['m', 'st', 'fz'].includes(ev.to));
      if (play && (ev.p === 1 || (ev.p == null && D.tp === 1)) && BEAT[SET.speed]) await sleep(BEAT[SET.speed]); }
    reconcile(m.view);
    if (m.over) { D.busy = false; return endDuel(m.over); }
    if (m.prompt) setPrompt(m.prompt);
    else setPrompt(null);
  }
  D.busy = false;
}
const side = p => p === 0 ? 1 : -1;
const handPoint = (p, u) => {
  const sr = stage.getBoundingClientRect(), mid = MOBILE ? (LAND ? LG.cx : SW / 2) : 960;
  const at = el => { const r = el.getBoundingClientRect(); return { x: (r.left + r.width / 2 - sr.left) / scale, y: (r.top + r.height * 0.45 - sr.top) / scale }; };
  if (p === 0) { const el = u != null && $(`#hand [data-u="${u}"]`); const pt = el ? at(el) : { x: mid, y: MOBILE ? SH - 110 : 1020 }; return table.screenToWorld(pt.x, Math.min(pt.y, (MOBILE ? SH : 1080) - 30), MOBILE ? 1.1 : 1.5); }
  const cs = $$('#ohand .card'), el = cs[cs.length - 1]; const pt = el ? at(el) : { x: mid, y: MOBILE ? 40 : 40 };
  return table.screenToWorld(pt.x, Math.max(pt.y, 12), MOBILE ? 1.1 : 1.5);
};
const pileKind = z => ({ deck: 'deck', deckTop: 'deck', extra: 'extra', gy: 'gy', ban: 'ban' }[z]);
const waitMs = ms => sleep(ms * GAP[SET.speed]);

async function anim(ev) {
  // a new turn or phase gets its banner first
  if (ev.turn != null && ev.turn !== D.turn && ev.turn > 0) { D.turn = ev.turn; D.tp = ev.turn % 2 === 1 ? D.first : 1 - D.first; $('#turnNo').textContent = ev.turn; await turnBanner(); }
  if (ev.phase && ev.phase !== D.phase) { D.phase = ev.phase; setPhase(ev.phase); if (ev.phase === 'battle') await banner('Battle Phase', D.tp === 0 ? '' : 'The computer is attacking', D.tp !== 0); }
  const t = ev.type;
  if (t === 'move') return animMove(ev);
  if (t === 'summon') {
    for (const u of ev.us) { const p = table.where(u); if (!p) continue; const big = ['synchro', 'fusion', 'ritual'].includes(ev.how);
      table.burst(p, big ? 0xffd080 : 0xff9a50, big ? 1.5 : 1); if (big) table.pillar(p); S.play(big ? 'synchro' : 'summon'); }
    D.stats.summons += ev.p === 0 ? 1 : 0; if (ev.p === 0 && ev.how === 'synchro') D.stats.synchro++;
    return waitMs(ev.how === 'synchro' || ev.how === 'fusion' ? 520 : 260);
  }
  if (t === 'flip') { S.play('flip'); return table.flip(ev.u, ev.id, true); }
  if (t === 'pos') {
    if (ev.pos === 'set') { S.play('set'); await table.flip(ev.u, null, false); return table.turnTo(ev.u, true); }
    S.play('flip'); const c = table.cards.get(ev.u); if (c && !c.up && ev.id != null) await table.flip(ev.u, ev.id, true); return table.turnTo(ev.u, ev.pos === 'def');
  }
  if (t === 'attack') {
    D.stats.lastAtk = ev.a; S.play('attack');
    const to = ev.t != null && table.where(ev.t) ? table.where(ev.t) : table.screenToWorld(960, ev.p === 0 ? 90 : 1000, 0.3);
    if (ev.t != null) table.ringOn(ev.t, ev.p === 0 ? 0xff7a30 : 0x7fb8ff);
    await table.lunge(ev.a, to); table.ringsOff(); return;
  }
  if (t === 'damage') {
    const before = D.lp[ev.p]; setLP(ev.p, ev.lp); S.play('hit'); const pl = ev.p === 0 ? $('#lpMe') : $('#lpOp');
    pl.classList.remove('shake'); void pl.offsetWidth; pl.classList.add('shake');
    popNum(ev.p, '-' + ev.n);
    if (ev.p === 1) { D.stats.dealt += ev.n; D.stats.biggest = Math.max(D.stats.biggest, ev.n); if (ev.battle && D.stats.lastAtk != null) D.stats.mvp.set(D.stats.lastAtk, (D.stats.mvp.get(D.stats.lastAtk) || 0) + ev.n); }
    if (before - ev.lp >= 1000) table.shakeCam(0.06);
    return waitMs(420);
  }
  if (t === 'chain') {
    if (ev.p === 0) D.stats.chains++;
    D.chain.push(ev); renderChain(); S.play(ev.link > 1 ? 'chain' : 'activate');
    const c = table.cards.get(ev.u); if (c && !c.up) await table.flip(ev.u, ev.id, true);
    else if (c) table.burst(c.g.position, 0xffc070, 0.7);
    for (const tu of ev.targets || []) table.ringOn(tu, ev.p === 0 ? 0xff7a30 : 0x7fb8ff);
    if (ev.link >= 2) await banner(`Chain Link ${ev.link}`, ev.name, ev.p !== 0); else await waitMs(650);
    return;
  }
  if (t === 'resolve') {
    const L = D.chain.find(x => x.link === ev.link); if (L) { L.res = true; renderChain(); }
    S.play('resolve'); await waitMs(420);
    D.chain = D.chain.filter(x => x.link !== ev.link); renderChain(); if (!D.chain.length) table.ringsOff();
    return;
  }
}
// the hand card flies over the table to its zone: from its own spot, growing or shrinking to the zone's size, turning for Defense
// Position, showing its face or back as it will land; then the table card appears in the same place
function stageBox(r) { const sr = stage.getBoundingClientRect(); return { x: (r.left - sr.left) / scale, y: (r.top - sr.top) / scale, w: r.width / scale, h: r.height / scale }; }
function pileBox(sd, kind) { const c = table.pileTop(sd, kind), q = table.project(c), e = table.project(c.clone().setX(c.x + table.CW / 2)); const w = Math.abs(e.x - q.x) * 2; return { cx: q.x, cy: q.y, w }; }
// a flat card flying over everything: from a box (stage pixels) to a centre point and width, turning by rot, its picture changing halfway
// flying cards (Zack, 2026-11-25: "make sure the gameplay is extremely smooth when cards are in the hands, being played"): both pictures are
// loaded before the card moves, so nothing pops in mid-flight, and a card that changes sides turns over in 3D on the way rather than
// swapping its picture. The flight is one eased arc; a draw first lifts off the top of the Deck.
const imgReady = new Map();
function preload(src) {
  if (!src) return Promise.resolve(); if (imgReady.has(src)) return imgReady.get(src);
  const pr = new Promise(res => { const im = new Image(); im.onload = im.onerror = () => res(); im.src = src; if (im.decode) im.decode().then(res, res); });
  imgReady.set(src, pr); return pr;
}
async function fly2D(b, to, o = {}) {
  const a1 = o.from || 'img/back.webp', a2 = o.to || a1, flip = a2 !== a1;
  await Promise.race([Promise.all([preload(a1), preload(a2)]), sleep(220)]);
  // the card is drawn at the larger of its two sizes and scaled down from there, so it stays sharp the whole way (never blown up)
  const W = Math.max(b.w, to.w), H = W * 614 / 421, sx = b.x + b.w / 2, sy = b.y + b.h / 2, s0 = b.w / W, s1 = to.w / W;
  const fly = document.createElement('div'); fly.className = 'flyc';
  fly.innerHTML = `<div class="fin"><i style="background-image:url(${a1})"></i>${flip ? `<i class="bk" style="background-image:url(${a2})"></i>` : ''}</div>`;
  Object.assign(fly.style, { left: (sx - W / 2) + 'px', top: (sy - H / 2) + 'px', width: W + 'px', height: H + 'px' }); $('#layer').appendChild(fly);
  const dx = to.cx - sx, dy = to.cy - sy, rot = o.rot || 0, dur = (o.dur || 440) * SPEED[SET.speed], arc = o.arc != null ? o.arc : 26;
  const kf = [{ transform: `translate(0px,0px) scale(${s0}) rotate(0deg)`, offset: 0 }];
  if (o.lift) kf.push({ transform: `translate(0px,${-o.lift}px) scale(${s0 * 1.06}) rotate(0deg)`, offset: 0.22, easing: 'ease-out' });
  kf.push({ transform: `translate(${dx * 0.5}px,${dy * 0.5 - arc}px) scale(${(s0 + s1) / 2 * 1.04}) rotate(${rot / 2}deg)`, offset: o.lift ? 0.6 : 0.5 });
  kf.push({ transform: `translate(${dx}px,${dy}px) scale(${s1}) rotate(${rot}deg)`, offset: 1 });
  const an = fly.animate(kf, { duration: dur, easing: o.settle ? 'cubic-bezier(.25,.75,.35,1)' : 'cubic-bezier(.33,.66,.3,1)', fill: 'forwards' });
  if (flip) fly.firstChild.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(0deg)', offset: o.lift ? 0.25 : 0.12 }, { transform: 'rotateY(180deg)', offset: 0.85 }, { transform: 'rotateY(180deg)' }],
    { duration: dur, easing: 'ease-in-out', fill: 'forwards' });
  await an.finished.catch(() => {}); if (!o.keep) fly.remove(); return fly;
}
async function flyFromHand(r, ev, toSide) {
  const zone = ev.to === 'fz' ? 'fz' : ev.to, up = ev.pos !== 'set', def = ev.to === 'm' && (ev.pos === 'def' || ev.pos === 'set');
  const c = table.slot(toSide, zone, ev.zi), q = table.project(c), e = table.project(c.clone().setX(c.x + table.CW / 2));
  const w1 = Math.abs(e.x - q.x) * 2 * (def ? table.DEF_S : 1), opp = toSide !== 1;
  const start = ev.owner === 0 && ev.id != null ? artUrl(ev.id) : 'img/back.webp', end = up && ev.id != null ? artUrl(ev.id) : 'img/back.webp';
  S.play(up ? 'place' : 'set');
  const fly = await fly2D(stageBox(r), { cx: q.x, cy: q.y, w: w1 }, { from: start, to: end, rot: (opp ? 180 : 0) - (def ? 90 : 0), dur: 560, arc: 30, keep: true });   // turned the same way the table card lies (the 3D table turns counterclockwise for Defense Position), so a Set monster never lands the wrong way round and corrects itself (Zack, 2026-11-25)
  await table.place(ev.u, toSide, zone, ev.zi, { id: ev.id, up, pos: ev.pos, from: c.clone().setY(0.06), fromUp: up, fromRotY: table.pose(toSide, def), dur: 90, lift: 0 });
  fly.remove();
}
async function animMove(ev) {
  const p = ev.owner, fromSide = side(ev.prevCtrl != null && ['m', 'st', 'fz'].includes(ev.from) ? ev.prevCtrl : p), toSide = side(['m', 'st', 'fz'].includes(ev.to) ? ev.ctrl : p);
  const dp = D.disp.p; const fast = ev.reason === 'deal';
  // where it starts
  let from = null;
  if (['m', 'st', 'fz'].includes(ev.from)) from = table.where(ev.u);
  else if (ev.from === 'hand' && ['m', 'st', 'fz'].includes(ev.to)) {
    const el = p === 0 ? $(`#hand [data-u="${ev.u}"]`) : $$('#ohand .card').pop();
    const r = el && el.getBoundingClientRect(); if (el && p === 0) el.style.visibility = 'hidden'; dropHand(p, ev.u);
    if (r && r.width) { await flyFromHand(r, ev, toSide); return; }
    from = handPoint(p, ev.u);
  }
  else if (ev.from === 'hand' && pileKind(ev.to)) {
    // a discard (or any card from a hand to a pile): the hand card itself flies to the pile
    const el = p === 0 ? $(`#hand [data-u="${ev.u}"]`) : $$('#ohand .card').pop(); const r = el && el.getBoundingClientRect();
    if (el && p === 0) el.style.visibility = 'hidden'; dropHand(p, ev.u);
    if (r && r.width) {
      const k = pileKind(ev.to), shows = (k === 'gy' || k === 'ban') && ev.id != null;
      S.play('set'); const a1 = p === 0 && ev.id != null ? artUrl(ev.id) : 'img/back.webp'; await fly2D(stageBox(r), pileBox(toSide, k), { from: a1, to: shows ? artUrl(ev.id) : a1, rot: toSide === 1 ? 0 : 180, dur: 440 });
      bumpPile(toSide, k, +1, ev.u, ev.id); return;
    }
    from = handPoint(p, ev.u);
  }
  else if (ev.from === 'hand') { from = handPoint(p, ev.u); dropHand(p, ev.u); }
  else if (pileKind(ev.from)) { from = table.pileTop(fromSide, pileKind(ev.from)); bumpPile(fromSide, pileKind(ev.from), -1, ev.u); }
  if (ev.destroyed && table.has(ev.u)) { S.play('destroy'); await table.shatter(ev.u); if (ev.owner === 1) D.stats.destroyed++; }
  // where it goes
  if (['m', 'st', 'fz'].includes(ev.to)) {
    const up = ev.pos !== 'set';
    S.play(up ? 'place' : 'set');
    await table.place(ev.u, toSide, ev.to === 'fz' ? 'fz' : ev.to, ev.zi, { id: ev.id, up, pos: ev.pos, from, fromUp: ev.from === 'hand' && p === 0 ? true : up, dur: ev.from === 'hand' ? 580 : 460 });
    return;
  }
  if (ev.to === 'hand') {
    const to = handPoint(p, null);
    if (table.has(ev.u)) await table.remove(ev.u, to, { up: p === 0, dur: 360 });
    else if (from && pileKind(ev.from)) {
      // a draw: the card's place in the hand is made first (hidden), and the card flies from the Deck straight into it
      addHand(p, { u: ev.u, id: p === 0 ? ev.id : null });
      const el = p === 0 ? $(`#hand [data-u="${ev.u}"]`) : $$('#ohand .card').pop();
      if (el) { el.style.visibility = 'hidden'; S.play(fast ? 'deal' : 'draw');
        // the draw lifts off the top of the Deck (the pile's top card, at its size), then flies into its own place in the hand
        // it lands exactly where the card will rest: the new hand card skips its own rise-in, and the flight ends at its centre, its true
        // (unturned) width and its tilt in the fan, so nothing overshoots or pops when the real card takes over (Zack, 2026-11-25)
        el.classList.remove('in'); el.style.animation = 'none';
        const pb = pileBox(fromSide, pileKind(ev.from)), ph = pb.w * 614 / 421, tb = stageBox(el.getBoundingClientRect());
        const tilt = parseFloat((el.style.transform.match(/rotate\((-?[\d.]+)deg\)/) || [0, 0])[1]) || 0;
        await fly2D({ x: pb.cx - pb.w / 2, y: pb.cy - ph / 2, w: pb.w, h: ph }, { cx: tb.x + tb.w / 2, cy: tb.y + tb.h / 2, w: el.offsetWidth },
          { from: 'img/back.webp', to: p === 0 && ev.id != null ? artUrl(ev.id) : 'img/back.webp', rot: tilt, dur: fast ? 320 : 520, arc: 16, lift: fast ? 8 : 14, settle: true });
        el.style.visibility = ''; }
      if (fast) await waitMs(40);
      return;
    }
    else if (from) { S.play(fast ? 'deal' : 'draw'); await table.fly(p === 0 ? ev.id : null, from, to, { up: false, toUp: p === 0 && ev.id != null, rotY: p === 0 ? 0 : Math.PI, dur: fast ? 200 : 340, lift: 0.4 }); }
    addHand(p, { u: ev.u, id: p === 0 ? ev.id : null });
    if (fast) await waitMs(40);
    return;
  }
  const k = pileKind(ev.to);
  if (k) {
    const to = table.pileTop(toSide, k); const up = k === 'gy' || k === 'ban';
    if (table.has(ev.u)) await table.remove(ev.u, to, { up, rotY: toSide === 1 ? 0 : Math.PI, dur: 380 });
    else if (from) await table.fly(ev.id, from, to, { up: ev.from !== 'deck' && ev.id != null && ev.from !== 'hand' || (ev.from === 'hand' && p === 0), toUp: up && ev.id != null, rotY: toSide === 1 ? 0 : Math.PI, dur: 360 });
    bumpPile(toSide, k, +1, ev.u, ev.id);
    return;
  }
  if (ev.to === 'gone') { if (table.has(ev.u)) { await table.shatter(ev.u); await table.remove(ev.u, null); } }
}
// the display between full updates: hand cards and pile counts move with each event
function dropHand(p, u) { const h = D.disp.p[p].hand; const i = h.findIndex(x => x.u === u); if (i >= 0) h.splice(i, 1); else if (p === 1) h.pop(); renderHands(); }
function addHand(p, c) { D.disp.p[p].hand.push(c); renderHands(c.u); }
function bumpPile(s, k, d, u, id) {
  const key = s + ':' + k; D.piles = D.piles || {}; const pl = D.piles[key] || (D.piles[key] = { n: table.piles.get(key) ? table.piles.get(key).n : 0, top: null });
  pl.n = Math.max(0, pl.n + d); if (d > 0 && id != null && (k === 'gy' || k === 'ban')) pl.top = id;
  table.setPile(s, k, pl.n, k === 'gy' || k === 'ban' ? pl.top : null); pileCounts();
}

/* ---------- the authoritative view after each update ---------- */
function reconcile(v) {
  D.view = v; const keep = new Set();
  v.p.forEach((P, pi) => {
    const s = side(pi);
    const put = (c, zone, i) => { if (!c) return; keep.add(c.u); const t = table.cards.get(c.u); const def = zone === 'm' && (c.pos === 'def' || c.pos === 'set');
      if (!t || t.zone !== zone || t.i !== i || t.side !== s || t.def !== def || t.up !== c.up || (c.id != null && t.id !== c.id)) table.place(c.u, s, zone, i, { id: c.id, up: c.up, pos: c.pos, dur: 220 }); };
    P.m.forEach((c, i) => put(c, 'm', i)); P.st.forEach((c, i) => put(c, 'st', i)); put(P.fz, 'fz', 0);
    D.piles = D.piles || {};
    for (const k of ['gy', 'ban']) { const top = P[k].length ? P[k][P[k].length - 1].id : null; table.setPile(s, k, P[k].length, top); D.piles[s + ':' + k] = { n: P[k].length, top }; }
    table.setPile(s, 'deck', P.deck, null); D.piles[s + ':deck'] = { n: P.deck, top: null };
    table.setPile(s, 'extra', P.extra.length, null); D.piles[s + ':extra'] = { n: P.extra.length, top: null };
    D.disp.p[pi].hand = P.hand.map(h => ({ u: h.u, id: h.id != null ? h.id : null }));
    if (D.lp[pi] !== P.lp) setLP(pi, P.lp);
  });
  table.clearField(keep);
  D.turn = v.turn; D.tp = v.tp; $('#turnNo').textContent = Math.max(1, v.turn);
  if (v.phase !== D.phase) { D.phase = v.phase; setPhase(v.phase); }
  $('#lpMe').classList.toggle('turn', v.tp === 0); $('#lpOp').classList.toggle('turn', v.tp === 1);
  if (!v.chain.length && D.chain.length) { D.chain = []; renderChain(); table.ringsOff(); }
  renderHands(); pileCounts(); buildStats();
}

/* ---------- HUD pieces ---------- */
function renderHands(newU) {
  const h = D.disp.p[0].hand, n = h.length;
  // phones: 86-point cards fanned across the bottom, overlapping more as the hand grows
  const hw = LAND ? 74 : HW, hx = LAND ? LG.cx : SW / 2, room = LAND ? SW - LCOL - RCOL + 40 : SW - 36;
  const step = MOBILE ? Math.min(LAND ? 60 : 74, (room - hw) / Math.max(1, n - 1)) : Math.min(150, 900 / Math.max(1, n)), x0 = MOBILE ? hx - hw / 2 - (step * (n - 1)) / 2 : 550 - (step * (n - 1)) / 2 - 70;
  const el = $('#hand'); const old = new Map([...el.children].map(c => [+c.dataset.u, c]));
  h.forEach((c, i) => {
    let d = old.get(c.u); if (!d) { d = document.createElement('div'); d.className = 'hc in'; d.dataset.u = c.u; el.appendChild(d); }
    old.delete(c.u);
    d.style.backgroundImage = `url(${artUrl(c.id)})`; d.style.left = (x0 + i * step) + 'px';
    const rot = (i - (n - 1) / 2) * Math.min(MOBILE ? 3 : 4, 24 / n); d.style.transform = `rotate(${rot}deg)`; d.style.zIndex = i + 1;
  });
  for (const d of old.values()) { d.classList.add('gone'); d.removeAttribute('data-u'); setTimeout(() => d.remove(), 240); }
  $('#hcMe').textContent = n;
  const on = D.disp.p[1].hand.length, oe = $('#ohand'); /* the computer's hand keeps its cards between updates, so they slide and turn smoothly into their new places instead of being redrawn */
  const os = MOBILE ? Math.min(30, 230 / Math.max(1, on)) : Math.min(92, 520 / Math.max(1, on)), ox = MOBILE ? (LAND ? LG.cx : SW / 2) - (os * (on - 1)) / 2 - 20 : 300 - (os * (on - 1)) / 2 - 48;
  while (oe.children.length > on) oe.lastElementChild.remove();
  while (oe.children.length < on) { const c = document.createElement('div'); c.className = 'card in'; oe.appendChild(c); }
  [...oe.children].forEach((c, i) => { c.style.left = (ox + i * os) + 'px'; c.style.transform = `rotate(${(i - (on - 1) / 2) * -3}deg) translateZ(0)`; });
  $('#hcOp').textContent = on;
}
$('#hand').addEventListener('mouseover', e => { const c = e.target.closest('.hc'); if (c) { const h = D && D.disp.p[0].hand.find(x => x.u === +c.dataset.u); if (h) inspect(h.id); } });
$('#hand').addEventListener('click', e => { const c = e.target.closest('.hc'); if (c && D) cardClick(+c.dataset.u, c); });
function setLP(p, v, instant) {
  const el = p === 0 ? $('#lpMeN') : $('#lpOpN'); const from = D ? D.lp[p] : v; if (D) D.lp[p] = v;
  const bar = p === 0 ? $('#barMe') : $('#barOp'); bar.innerHTML = Array.from({ length: 8 }, (_, i) => `<i class="${v > i * 1000 ? 'f' : ''}"></i>`).join('');
  if (instant || from === v) { el.textContent = v; return; }
  el.classList.add(v < from ? 'hit' : 'heal'); if (v > from) { S.play('heal'); popNum(p, '+' + (v - from), true); }
  const t0 = performance.now(), dur = 650 * SPEED[SET.speed] + 50;
  const step = () => { const k = Math.min(1, (performance.now() - t0) / dur); el.textContent = Math.round(from + (v - from) * k); if (k < 1) requestAnimationFrame(step); else { el.textContent = v; setTimeout(() => el.classList.remove('hit', 'heal'), 300); } };
  requestAnimationFrame(step); if (v < from) S.play('lp', { gap: 200 });
}
function popNum(p, txt, heal) { const d = document.createElement('div'); d.className = 'pop' + (heal ? ' heal' : ''); d.textContent = txt; Object.assign(d.style, MOBILE ? (LAND ? (p === 0 ? { left: '100px', top: (SH - 110) + 'px' } : { left: '100px', top: '70px' }) : p === 0 ? { left: '230px', top: (SH - 150) + 'px' } : { left: '230px', top: '70px' }) : p === 0 ? { left: '300px', top: '880px' } : { left: '1640px', top: '200px' }); $('#layer').appendChild(d); setTimeout(() => d.remove(), 1200); }
const PH = { draw: 'Draw', standby: 'Standby', main1: 'Main 1', battle: 'Battle', main2: 'Main 2', end: 'End', start: 'Draw' };
function setPhase(ph) { $('#phaseTxt').textContent = PH[ph] || ph; $('#dial').classList.toggle('op', D.tp !== 0); if (ph !== 'start') S.play('phase', { gap: 300 }); }
async function banner(txt, sub, op) {
  const b = document.createElement('div'); b.className = 'banner' + (op ? ' op' : ''); b.innerHTML = `<div class="disp">${esc(txt)}</div>${sub ? `<div class="sub cap">${esc(sub)}</div>` : ''}`;
  $('#layer').appendChild(b); const ms = 1300 * Math.max(0.35, SPEED[SET.speed]); b.style.animationDuration = ms + 'ms';
  await sleep(ms * 0.62); setTimeout(() => b.remove(), ms * 0.4);
}
async function turnBanner() { S.play('turn'); $('#dial').classList.toggle('op', D.tp !== 0); await banner(D.tp === 0 ? 'Your Turn' : "Computer's Turn", `Turn ${D.turn}`, D.tp !== 0); }
function renderChain() {
  const el = $('#chainp'); $('#s-duel').classList.toggle('chaining', !!D.chain.length); if (!D.chain.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `<div class="ph">Chain · resolves top down</div>` + [...D.chain].reverse().map(L => `<div class="link ${L.p === 0 ? '' : 'op'} ${L.res ? 'res' : ''}" data-id="${L.id}"><div class="no disp">${L.link}</div><div class="card" style="background-image:url(${artUrl(L.id)})"></div><div><div class="t">${esc(L.name)}</div><div class="s">${L.p === 0 ? 'You' : 'Computer'}${L.res ? ' · resolving' : ''}</div></div></div>`).join('');
}
// ATK/DEF badges under monsters, counts on piles
const badges = new Map();
function buildStats() {
  const want = new Map(); if (D.view) D.view.p.forEach(P => P.m.forEach(c => { if (c && c.up && c.atk != null) want.set(c.u, c); }));
  for (const [u, el] of badges) if (!want.has(u)) { el.remove(); badges.delete(u); }
  for (const [u, c] of want) {
    let el = badges.get(u); if (!el) { el = document.createElement('div'); el.className = 'st'; $('#ov').appendChild(el); badges.set(u, el); }
    const r = rec(D.fmt, c.id), batk = r && +r.atk, bdef = r && +r.def;
    el.innerHTML = `<b>${c.atk}</b><i>/</i>${c.def}`; el.classList.toggle('up', batk != null && c.atk > batk); el.classList.toggle('down', batk != null && c.atk < batk);
  }
}
let pileEls = {};
function pileCounts() {
  if (!D || !D.piles) return;
  for (const [pi, s] of [[0, 1], [1, -1]]) { const pl = D.piles[s + ':ban'], n = pl ? pl.n : 0, b = $(pi === 0 ? '#banMe' : '#banOp'); if (b) { b.hidden = !n; b.querySelector('b').textContent = n; } }
  for (const s of [1, -1]) for (const k of ['deck', 'extra', 'gy', 'ban']) {
    const key = s + ':' + k, pl = D.piles[key]; let el = pileEls[key];
    if (!el) { el = document.createElement('div'); el.className = 'ct'; $('#ov').appendChild(el); pileEls[key] = el; }
    if (!el.isConnected) $('#ov').appendChild(el);
    const n = pl ? pl.n : 0; el.textContent = n; el.classList.toggle('zero', !n);
    const top = table.pileTop(s, k); const corner = top.clone(); corner.x += s * table.CW / 2; corner.z -= s * table.CH / 2; const pt = table.project(corner);
    el.style.left = pt.x + 'px'; el.style.top = pt.y + 'px';
  }
}
function frameOverlay() {
  if (!D) return;
  for (const [u, el] of badges) { const p = table.cardScreen(u, 1); if (p) { el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.display = ''; } else el.style.display = 'none'; }
}

/* ---------- inspect ---------- */
let lastId = null;
function inspect(id) {
  if (id == null) return; lastId = id; const r = rec(D.fmt, id); if (!r) return; const el = $('#inspect');
  const mon = !['spell', 'trap'].includes(r.k);
  const meta = mon ? [r.a, r.r, r.k === 'token' ? 'Token' : null, r.lv ? `Level ${r.lv}` : null, `${r.atk} / ${r.def}`].filter(Boolean).join(' · ') : `${r.k === 'spell' ? 'Spell' : 'Trap'}${r.sub && r.sub !== 'Normal' ? ' · ' + r.sub : ''}`;
  const text = D.fmt === 'edison' && r.ps && !/^No rulings/.test(r.ps) ? r.ps : (r.tx || '');
  el.innerHTML = `<div class="ph">Card</div><div class="card" style="background-image:url(${artUrl(id)})"></div><h4>${esc(r.n)}</h4><div class="meta">${esc(meta)}</div><p>${esc(text)}</p>`;
  el.classList.remove('hidden');
}
function inspectU(u) { const c = findU(u); if (c && c.id != null) inspect(c.id); }
function findU(u) { if (!D.view) return null; for (const P of D.view.p) { for (const c of [...P.m, ...P.st, P.fz]) if (c && c.u === u) return c; } return null; }
function hoverPile(p) { const P = D.view && D.view.p[p.side === 1 ? 0 : 1]; if (!P) return; if ((p.kind === 'gy' || p.kind === 'ban') && P[p.kind].length) inspect(P[p.kind][P[p.kind].length - 1].id); }
$('#gl').addEventListener('mouseleave', () => {});

/* ---------- prompts: what you can do right now ---------- */
function clearInteract() {
  if (table) table.prefer = null;
  $$('#hand .hc').forEach(c => c.classList.remove('play', 'pick', 'up')); table && (table.unglowAll(), table.lightZones([]));
  closeMenu(); $('#hand').classList.remove('low'); $('#dial').classList.remove('ready'); D.sel = null; D.zoneMode = null; D.picks = null;
  $$('#layer .dlg, #layer .veil, #layer .respond').forEach(e => e.remove());
  if (!D || !D.keepHint) $$('#layer .hintp').forEach(e => e.remove());
}
function setPrompt(pr) {
  D.prompt = pr; clearInteract();
  const rib = $('#prompt');
  if (!pr) { rib.className = 'prompt wait'; rib.innerHTML = D.tp === 1 ? 'The computer is playing…' : 'Resolving…'; rib.classList.toggle('hidden', !D.view); return; }
  rib.className = 'prompt';
  if (AUTO) setTimeout(() => { if (D && D.prompt === pr) W.postMessage({ type: 'hint' }); }, 250);
  if (pr.type === 'idle') return promptIdle(pr);
  if (pr.type === 'respond') return promptRespond(pr);
  if (pr.type === 'pick') return promptPick(pr);
  if (pr.type === 'yesno' || pr.type === 'choose') return promptChoose(pr);
}
function optsByU(pr) { const m = new Map(); for (const o of pr.opts) if (o.u != null) { if (!m.has(o.u)) m.set(o.u, []); m.get(o.u).push(o); } return m; }
function promptIdle(pr) {
  const by = optsByU(pr); D.byU = by;
  const battle = pr.text === 'Battle Phase';
  $('#prompt').innerHTML = MOBILE ? (battle ? 'Battle Phase: pick an attacker, or tap Phase to end it' : `${esc(pr.text)}: play a card, or tap Phase to move on`) : battle ? 'Battle Phase: pick a monster to attack with, or end the Battle Phase on the dial' : `${esc(pr.text)}: play a card, or use the phase dial to move on`;
  $$('#hand .hc').forEach(c => c.classList.toggle('play', by.has(+c.dataset.u)));
  for (const u of by.keys()) if (table.has(u)) table.glow(u, battle ? 0xff5030 : 0xff7a30);
  if (pr.opts.some(o => o.kind === 'phase')) $('#dial').classList.add('ready');
  if (D.pendingU != null) { const u = D.pendingU; D.pendingU = null; const os = by.get(u); if (os) { const el = $(`#hand [data-u="${u}"]`); if (el) openMenu(u, os, el); else if (table.has(u)) openMenu(u, os, null, table.cardScreen(u, -1)); } }
  if (SET.hintLimit !== 'off' && D.turn <= 2 && !D.hintShown) { D.hintShown = true; toast(`Tip: ${TAP()} a glowing card to play it. The ${MOBILE ? 'phase button' : 'dial on the right'} moves to the next phase.`, 4200); }
}
function promptRespond(pr) {
  const by = optsByU(pr); D.byU = by;
  const mine = D.tp === 0; // on your own turn this window is optional: any other card you click keeps you playing
  $('#prompt').innerHTML = mine ? `You can use an effect now, or ${TAP()} any card to keep playing${TOUCH ? '' : ' <span class="key">Space</span> Continue'}` : `${esc(pr.text)}${TOUCH ? '' : ' <span class="key">Space</span> Pass'}`;
  $$('#hand .hc').forEach(c => c.classList.toggle('play', by.has(+c.dataset.u)));
  for (const u of by.keys()) if (table.has(u)) table.glow(u, 0x7fd3ff);
  const box = document.createElement('div'); box.className = 'pn amenu respond'; Object.assign(box.style, { right: '36px', bottom: '120px', position: 'absolute' });
  box.innerHTML = `<div class="ph">Respond</div>` + pr.opts.filter(o => o.key !== 'pass').map((o, i) => `<button class="gb sm wide" data-k="${esc(o.key)}"><svg><use href="#i-bolt"/></svg><span class="lbl">${esc(o.label)}</span><span class="key">${i + 1}</span><span class="shine"></span></button>`).join('')
    + `<button class="gb sm wide pri" data-k="pass"><svg><use href="#i-pass"/></svg>${mine ? 'Continue' : 'Pass'}<span class="key">Space</span><span class="shine"></span></button>`;
  box.onclick = e => { const b = e.target.closest('[data-k]'); if (b) send([b.dataset.k]); };
  box.onmouseover = e => { const b = e.target.closest('[data-k]'); const o = b && pr.opts.find(x => x.key === b.dataset.k); if (o && o.id != null) inspect(o.id); };
  $('#layer').appendChild(box);
}
function promptPick(pr) {
  const n = pr.min === pr.max ? pr.min : `${pr.min} to ${pr.max}`;
  $('#prompt').innerHTML = `${esc(pr.text)} <span class="mute">(choose ${n})</span>`;
  D.picks = new Set();
  const onField = pr.opts.every(o => o.u != null && table.has(o.u));
  const handOnly = pr.opts.every(o => o.zone === 'hand' && o.owner === 0);
  if (onField || handOnly) {
    for (const o of pr.opts) { if (table.has(o.u)) table.glow(o.u, 0x7fd3ff); const h = $(`#hand [data-u="${o.u}"]`); if (h) h.classList.add('pick'); }
    table.prefer = new Set(pr.opts.map(o => o.u));
    if (pr.max > 1 || pr.min !== 1 || MOBILE) confirmBar(pr);
    return;
  }
  // cards in a Deck or Graveyard: show them laid out to pick from
  const v = document.createElement('div'); v.className = 'veil'; $('#layer').appendChild(v);
  const dl = document.createElement('div'); dl.className = 'pn dlg';
  dl.innerHTML = `<h3 class="disp">${esc(pr.text)}</h3><div class="sub">Choose ${n}.</div><div class="picks">${pr.opts.map(o => `<div class="pk" data-k="${esc(o.key)}">${o.id != null ? `<div class="card" style="background-image:url(${artUrl(o.id)})"></div>` : `<div class="tile">${esc(o.label)}</div>`}<div>${esc(o.label)}</div></div>`).join('')}</div>
    <div class="btns"><button class="gb pri" data-ok disabled><svg><use href="#i-check"/></svg>Confirm<span class="key">Enter</span><span class="shine"></span></button></div>`;
  $('#layer').appendChild(dl);
  const okB = dl.querySelector('[data-ok]');
  dl.onclick = e => {
    const k = e.target.closest('[data-k]'); if (k) { togglePick(k.dataset.k, pr); k.classList.toggle('on', D.picks.has(k.dataset.k)); okB.disabled = !(D.picks.size >= pr.min && D.picks.size <= pr.max); if (pr.max === 1 && pr.min === 1 && D.picks.size === 1) send([...D.picks]); }
    if (e.target.closest('[data-ok]') && !okB.disabled) send([...D.picks]);
  };
  dl.onmouseover = e => { const k = e.target.closest('[data-k]'); const o = k && pr.opts.find(x => x.key === k.dataset.k); if (o && o.id != null) inspect(o.id); };
}
function togglePick(k, pr) { if (D.picks.has(k)) D.picks.delete(k); else { if (D.picks.size >= pr.max) { if (pr.max === 1) D.picks.clear(); else return; } D.picks.add(k); } S.play('click'); }
function confirmBar(pr) {
  const box = document.createElement('div'); box.className = 'pn amenu respond'; Object.assign(box.style, { right: '36px', bottom: '120px', position: 'absolute' });
  box.innerHTML = `<div class="ph">Chosen: <b id="pickN">0</b></div><button class="gb pri wide" data-ok disabled><svg><use href="#i-check"/></svg><span class="cl">${MOBILE ? (pr.max === 1 ? 'Tap a target' : `Choose ${pr.min || 1}`) : 'Confirm'}</span><span class="key">Enter</span><span class="shine"></span></button>`;
  box.onclick = e => { const b = e.target.closest('[data-ok]'); if (b && !b.disabled) send([...D.picks]); };
  $('#layer').appendChild(box);
}
function pickU(u) {
  const pr = D.prompt; const o = pr.opts.find(x => x.u === u); if (!o) return false;
  togglePick(o.key, pr);
  if (table.has(u)) table.glow(u, D.picks.has(o.key) ? 0xff7a30 : 0x7fd3ff);
  const h = $(`#hand [data-u="${u}"]`); if (h) { h.classList.toggle('play', D.picks.has(o.key)); h.classList.toggle('pick', !D.picks.has(o.key)); }
  if (pr.max === 1 && pr.min === 1 && !MOBILE) { send([o.key]); return true; }
  // phones: a single target waits for Confirm, which names the card, so a mis-tap never resolves anything
  if (MOBILE && pr.max === 1) { for (const x of pr.opts) if (x.key !== o.key && table.has(x.u)) table.glow(x.u, 0x7fd3ff); const b = $('#layer [data-ok]'); if (b) { const nm = D.picks.size ? (o.label || nameOfU(u)) : ''; b.querySelector('.cl').textContent = nm ? `Confirm: ${nm}` : 'Confirm'; } }
  const n = $('#pickN'); if (n) n.textContent = D.picks.size; const ok = $('#layer [data-ok]'); if (ok) ok.disabled = !(D.picks.size >= pr.min && D.picks.size <= pr.max);
  if (MOBILE && pr.max > 1 && ok) { const need = (pr.min || 1) - D.picks.size; ok.querySelector('.cl').textContent = need > 0 ? `Choose ${need} more` : `Confirm (${D.picks.size})`; }
  return true;
}
function promptChoose(pr) {
  $('#prompt').innerHTML = esc(pr.text);
  const v = document.createElement('div'); v.className = 'veil'; $('#layer').appendChild(v);
  const dl = document.createElement('div'); dl.className = 'pn dlg';
  dl.innerHTML = `<h3 class="disp">${esc(pr.text)}</h3><div class="opts">${pr.opts.map((o, i) => `<button class="gb ${i === 0 && pr.type === 'yesno' ? 'pri' : ''} wide" data-k="${esc(o.key)}"><span class="lbl">${esc(o.label)}</span><span class="key">${pr.type === 'yesno' ? (o.key === 'y' ? 'Y' : 'N') : i + 1}</span><span class="shine"></span></button>`).join('')}</div>`;
  dl.onclick = e => { const b = e.target.closest('[data-k]'); if (b) send([b.dataset.k]); };
  $('#layer').appendChild(dl);
}

/* clicking things */
function cardClick(u, el) {
  const pr = D.prompt; if (!pr) return;
  if (pr.type === 'pick') { pickU(u); return; }
  if (D.zoneMode) { cancelZone(); return; }
  if (D.menu && D.menu.u === u) { closeMenu(); S.play('click'); return; }
  const os = D.byU && D.byU.get(u);
  if ((!os || !os.length) && pr.type === 'respond' && D.tp === 0) { D.pendingU = u; send(['pass']); return; }
  if (!os || !os.length) { S.play('error'); return; }
  if (pr.type === 'respond' && os.length === 1) { send([os[0].key]); return; }
  openMenu(u, os, el);
}
// a card you can't act on right now: show what it is (your own Set cards included; the engine sends their names to you only)
function showCard(u) { const id = idAnyU(u); if (id == null) { S.play('error'); return; } if (MOBILE) cardSheet(id); else { inspect(id); S.play('click'); } }
function fieldClick(h) {
  const pr = D.prompt;
  if (h && h.pile && !D.zoneMode && !(pr && pr.type === 'pick')) { pileView(h.pile.side === 1 ? 0 : 1, h.pile.kind); return; }
  if (!pr) { if (h && h.u != null) showCard(h.u); return; }
  if (D.zoneMode) { if (h && h.zone) placeInZone(h.zone); else cancelZone(); return; }
  if (!h) { closeMenu(); return; }
  if (h.u != null) {
    if (pr.type === 'pick') { pickU(h.u); return; }
    if (D.menu && D.menu.u === h.u) { closeMenu(); S.play('click'); return; }
    const os = D.byU && D.byU.get(h.u);
    if (!os && pr.type === 'respond' && D.tp === 0) { D.pendingU = h.u; send(['pass']); return; }
    if (!os) { showCard(h.u); return; }
    if (pr.type === 'respond' && os.length === 1) { send([os[0].key]); return; }
    const p = table.cardScreen(h.u, -1); openMenu(h.u, os, null, p);
  }
}
const ICON = { ns: 'i-up', sp: 'i-up', syn: 'i-up', cf: 'i-up', set: 'i-set', setst: 'i-set', flip: 'i-turn', pos: 'i-turn', act: 'i-bolt', atk: 'i-swords', gem: 'i-up' };
function openMenu(u, os, el, at) {
  closeMenu(); S.play('click');
  const m = document.createElement('div'); m.className = 'pn amenu'; m.id = 'amenu'; m.style.position = 'absolute';
  m.innerHTML = os.map((o, i) => `<button class="gb sm wide ${i === 0 ? 'pri' : ''}" data-k="${esc(o.key)}"><svg><use href="#${ICON[o.kind] || 'i-bolt'}"/></svg><span class="lbl">${esc(o.label)}</span><span class="key">${i + 1}</span><span class="shine"></span></button>`).join('');
  if (MOBILE) { const id = idAnyU(u); m.classList.add('mrow'); if (id != null) m.insertAdjacentHTML('beforeend', `<button class="gb sm wide rd" data-read="${id}">Read<span class="shine"></span></button>`);
    m.onclick = e => { const r = e.target.closest('[data-read]'); if (r) { cardSheet(r.dataset.read); return; } const b = e.target.closest('[data-k]'); if (b) choose(os.find(o => o.key === b.dataset.k)); };
    $('#layer').appendChild(m); D.menu = { u, os }; if (el) el.classList.add('up'); $('#s-duel').classList.add('acting'); return; }
  let x, y; if (el) { const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect(); x = (r.left - sr.left) / scale + 70 - 150; y = 1080 - 190 - os.length * 54 - 30; }
  else { x = at.x - 150; y = at.y - 30 - os.length * 54; }
  m.style.left = Math.max(stage.classList.contains('phone') ? 650 : 20, Math.min(stage.classList.contains('phone') ? 1450 : 1600, x)) + 'px'; // on phones it clears the card text on the left m.style.top = Math.max(150, y) + 'px';
  m.onclick = e => { const b = e.target.closest('[data-k]'); if (b) choose(os.find(o => o.key === b.dataset.k)); };
  $('#layer').appendChild(m); D.menu = { u, os }; if (el) el.classList.add('up');
}
function closeMenu() { const m = $('#amenu'); if (m) m.remove(); $('#s-duel').classList.remove('acting'); $$('#hand .hc.up').forEach(c => c.classList.remove('up')); if (D) D.menu = null; }
function choose(o) {
  closeMenu();
  const z = zoneFor(o);
  if (z) { // the player picks the zone; the engine places it there (E.act's zone hint)
    const P = D.view.p[0], free = P[z].map((c, i) => c ? -1 : i).filter(i => i >= 0);
    if (free.length > 1) { $('#hand').classList.add('low'); D.zoneMode = { o, z }; table.lightZones(free.map(i => ({ side: 1, zone: z, i }))); $('#prompt').innerHTML = TOUCH ? `${MOBILE ? 'Tap a lit zone' : 'Choose a zone'} for <b>${esc(nameOfU(o.u))}</b> <button class="pcx" id="zCancel">Cancel</button>` : `Choose a zone for <b>${esc(nameOfU(o.u))}</b> <span class="key">Esc</span> Cancel`; if ($('#zCancel')) $('#zCancel').onclick = e => { e.stopPropagation(); cancelZone(); }; S.play('click'); return; }
    if (free.length === 1) return send([o.key], { u: o.u, to: z, zi: free[0] });
  }
  send([o.key]);
}
function zoneFor(o) {
  if (['ns', 'set', 'sp', 'syn', 'cf'].includes(o.kind) && !/Tribute/.test(o.label)) return 'm';
  const h = D.disp.p[0].hand.find(x => x.u === o.u); const r = h && rec(D.fmt, h.id);
  if (r && ['spell', 'trap'].includes(r.k) && r.sub !== 'Field' && (o.kind === 'setst' || o.kind === 'act')) return 'st';
  return null;
}
function placeInZone(zn) { const zm = D.zoneMode; if (!zm || zn.side !== 1 || zn.zone !== zm.z) return; table.lightZones([]); $('#hand').classList.remove('low'); D.zoneMode = null; send([zm.o.key], { u: zm.o.u, to: zm.z, zi: zn.i }); }
function cancelZone() { $('#hand').classList.remove('low'); D.zoneMode = null; table.lightZones([]); S.play('click'); promptIdle(D.prompt); }
function nameOfU(u) { const h = D.disp.p[0].hand.find(x => x.u === u); const r = h ? rec(D.fmt, h.id) : null; if (r) return r.n; const c = findU(u); const r2 = c && rec(D.fmt, c.id); if (r2) return r2.n; for (const x of D.view.p[0].extra) if (x.u === u) return (rec(D.fmt, x.id) || {}).n || 'card'; return 'this card'; }
function send(keys, pz) { if (!D.prompt) return; S.play('click'); clearInteract(); D.prompt = null; setPrompt(null); W.postMessage({ type: 'act', keys, pz: pz || null }); }

// the phase dial
$('#dial').onclick = e => {
  e.stopPropagation(); if (!D || !D.prompt) return;
  const ph = D.prompt.opts.filter(o => o.kind === 'phase'); if (!ph.length) { S.play('error'); return; }
  closeMenu(); S.play('click');
  const m = document.createElement('div'); m.className = 'dial-menu'; m.id = 'amenu';
  const r = $('#dial'); if (MOBILE) m.classList.add('mrow'); else { m.style.left = (parseFloat(r.style.left) - 120) + 'px'; m.style.top = (parseFloat(r.style.top) + 70) + 'px'; }
  m.innerHTML = ph.map(o => `<button class="gb sm" data-k="${o.key}"><svg><use href="#${o.key === 'bp' ? 'i-swords' : 'i-end'}"/></svg>${esc(o.label)}<span class="key">${o.key === 'bp' ? 'B' : 'E'}</span><span class="shine"></span></button>`).join('');
  m.onclick = ev => { const b = ev.target.closest('[data-k]'); if (b) send([b.dataset.k]); };
  $('#layer').appendChild(m);
};
function duelKey(e) {
  const pr = D && D.prompt;
  if (e.key === 'Escape' && closeDeckList()) return; if (e.key === 'h' || e.key === 'H') return askHint();
  if (!pr) return;
  if (e.key === 'Escape') { if (closeDeckList()) return; if (closeDuelMenu()) return; if (D.zoneMode) return cancelZone(); if ($('#amenu')) return closeMenu(); return duelMenu(); }
  if (pr.type === 'respond' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); return send(['pass']); }
  if (pr.type === 'yesno' && (e.key === 'y' || e.key === 'n')) return send([e.key]);
  if (pr.type === 'idle') { const k = { b: 'bp', e: pr.opts.some(o => o.key === 'endbp') ? 'endbp' : 'end' }[e.key.toLowerCase()]; if (k && pr.opts.some(o => o.key === k)) return send([k]); }
  if (D.menu && /^[1-9]$/.test(e.key)) { const o = D.menu.os[+e.key - 1]; if (o) choose(o); }
  if (e.key === 'Enter') { const ok = $('#layer [data-ok]'); if (ok && !ok.disabled) ok.click(); }
}

/* ---------- tools ---------- */
$('#tHint').onclick = askHint;
$('#tSpeed').onclick = () => { const order = ['relaxed', 'normal', 'fast', 'instant']; SET.speed = order[(order.indexOf(SET.speed) + 1) % order.length]; saveSet(); table.speed = SPEED[SET.speed]; toast('Duel speed: ' + SET.speed); S.play('click'); };
const soundIcon = () => $('#tSound use').setAttribute('href', SET.muted ? '#i-mute' : '#i-sound');
$('#tSound').onclick = () => { SET.muted = !SET.muted; S.setMuted(SET.muted); saveSet(); soundIcon(); S.play('click'); }; soundIcon();
$('#tLog').onclick = () => {
  const old = $('#logp'); if (old) { old.remove(); return; } S.play('click');
  const p = document.createElement('div'); p.className = 'pn logp'; p.id = 'logp';
  p.innerHTML = `<button class="gb sm ico x" data-x title="Close"><svg><use href="#i-x"/></svg><span class="shine"></span></button><div class="ph">Duel log</div><div class="lines">${D.log.map(l => `<div class="${/^— Turn/.test(l) ? 'turn' : ''}">${esc(l)}</div>`).join('')}</div>`;
  $('#layer').appendChild(p); const ln = p.querySelector('.lines'); ln.scrollTop = ln.scrollHeight;
  p.querySelector('[data-x]').onclick = () => { p.remove(); S.play('click'); };
};
// the duel menu (Zack, 2026-11-24: "a menu/settings/quit option in the duel... adjust settings and quit to main menu during a game. will ask if youre sure")
function duelMenu() {
  if ($('#pauseMenu')) return closeDuelMenu();
  S.play('click'); const v = document.createElement('div'); v.className = 'veil'; v.id = 'pauseVeil'; const dl = document.createElement('div'); dl.className = 'pn dlg pmenu'; dl.id = 'pauseMenu';
  const rows = () => SETROWS.map((r, i) => [r, i]).filter(([r]) => r.k !== 'table').map(([r, i]) => { const v2 = SET[r.k] != null ? SET[r.k] : r.vals[0];
    const val = r.blocks ? `<span class="blocks">${r.vals.slice(1).map(x => `<i class="${x <= v2 ? 'f' : ''}"></i>`).join('')}</span><span class="vn">${v2}</span>` : `<span class="vt">${r.lab(v2)}</span>`;
    return `<div class="vrow" data-i="${i}"><span>${r.name}</span><span class="dots"></span><span class="val"><span class="arr" data-d="-1"><svg><use href="#i-tl"/></svg></span>${val}<span class="arr" data-d="1"><svg><use href="#i-tr"/></svg></span></span></div>`; }).join('');
  const main = () => { dl.innerHTML = `<h3 class="disp">Menu</h3><div class="opts">
      <button class="gb wide pri" data-a="resume"><span class="lbl">Resume</span><span class="key">Esc</span><span class="shine"></span></button>
      <button class="gb wide" data-a="settings"><svg><use href="#i-cog"/></svg><span class="lbl">Settings</span><span class="shine"></span></button>
      <button class="gb wide" data-a="giveup"><span class="lbl">Give up the duel</span><span class="shine"></span></button>
      <button class="gb wide" data-a="home"><svg><use href="#i-home"/></svg><span class="lbl">Quit to main menu</span><span class="shine"></span></button></div>`; };
  const settings = () => { dl.innerHTML = `<h3 class="disp">Settings</h3><div class="pset">${rows()}</div><div class="btns"><button class="gb" data-a="back"><svg><use href="#i-back"/></svg>Back<span class="shine"></span></button></div>`; };
  main(); $('#layer').append(v, dl); v.onclick = closeDuelMenu;
  dl.onclick = async e => {
    const ar = e.target.closest('[data-d]'), row = e.target.closest('[data-i]');
    if (ar && row) { changeSetting(+row.dataset.i, +ar.dataset.d); return settings(); }
    const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
    if (a === 'resume') return closeDuelMenu();
    if (a === 'settings') { S.play('click'); return settings(); }
    if (a === 'back') { S.play('click'); return main(); }
    const live = D && !D.over;
    const confirm = async (q, y) => { if (!live) return true; dl.style.visibility = 'hidden'; const ok = await ask(q, y); dl.style.visibility = ''; return ok; };
    if (a === 'giveup') { if (!(await confirm('Give up this duel? It counts as a loss.', 'Give up'))) return; closeDuelMenu(); W.postMessage({ type: 'giveup' }); endDuel({ winner: 1, why: 'You gave up.' }); }
    if (a === 'home') { if (!(await confirm('Quit to the main menu? This duel will end and won\'t be saved.', 'Quit'))) return; closeDuelMenu(); W.postMessage({ type: 'giveup' }); D = null; show('title'); }
  };
}
function closeDuelMenu() { const a = $('#pauseMenu'), b = $('#pauseVeil'); if (a) { a.remove(); b && b.remove(); S.play('click'); return true; } return false; }
$('#tMenu').onclick = duelMenu;
$('#banMe').onclick = () => pileView(0, 'ban'); $('#banOp').onclick = () => pileView(1, 'ban');

/* ---------- phone duel input (the phone layout) ----------
   Hold a card (in your hand, on the field or a pile top) to read it in a sheet that slides up; a tap still plays. */
function idAnyU(u) { if (!D) return null; const h = D.disp.p[0].hand.find(x => x.u === u); if (h && h.id != null) return h.id; return D.view ? idOfU(u) : null; }
function cardSheet(id) {
  if (id == null) return; const f = D ? D.fmt : B.fmt, r = rec(f, id); if (!r) return; closeSheet(); S.play('click');
  const v = document.createElement('div'); v.className = 'veil msv'; v.id = 'msVeil';
  const p = document.createElement('div'); p.className = 'msheet'; p.id = 'msheet';
  const mon = !['spell', 'trap'].includes(r.k);
  p.innerHTML = `<div class="grab"></div><div class="mtop"><div class="card" style="background-image:url(${artUrl(id)})"></div><div class="mh"><h3>${esc(r.n)}</h3><div class="meta">${esc(cardMeta(r))}</div>${mon && r.atk != null ? `<div class="num disp">${esc(r.atk)}<i> / ${esc(r.def)}</i></div>` : ''}</div></div><p>${esc(cardText(f, r))}</p><button class="gb wide" data-x>Close<span class="shine"></span></button>`;
  (cur === 'duel' ? $('#layer') : stage).append(v, p);
  const close = () => closeSheet(); v.onclick = close; p.querySelector('[data-x]').onclick = close;
  let y0 = null; p.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  p.addEventListener('touchmove', e => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0 && p.scrollTop <= 0) p.style.transform = `translateY(${dy}px)`; }, { passive: true });
  p.addEventListener('touchend', e => { const dy = e.changedTouches[0].clientY - (y0 == null ? 0 : y0); y0 = null; if (dy > 90 && p.scrollTop <= 0) close(); else p.style.transform = ''; });
}
function closeSheet() { const a = $('#msheet'), b = $('#msVeil'); if (a) { a.remove(); b && b.remove(); return true; } return false; }
let mobileBound = false;
function mobileDuelInput() {
  if (mobileBound) return; mobileBound = true;
  let hold = null, ate = false;
  const start = (e, idFn) => { if (!MOBILE || (e.pointerType === 'mouse' && !FORCE_M)) return; const x = e.clientX, y = e.clientY;
    hold = { x, y, t: setTimeout(() => { const id = idFn(); hold = null; if (id != null) { ate = true; if (navigator.vibrate) navigator.vibrate(12); cardSheet(id); } }, 430) }; };
  const cancel = () => { if (hold) clearTimeout(hold.t); hold = null; };
  const moveC = e => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) cancel(); };
  $('#hand').addEventListener('pointerdown', e => { const c = e.target.closest('.hc'); if (c) start(e, () => idAnyU(+c.dataset.u)); });
  const duel = $('#s-duel');
  duel.addEventListener('pointerdown', e => { if (e.target.id === 'gl') start(e, () => lastId); });  // the table's own pointerdown (on the canvas) has just set lastId
  for (const el of [$('#hand'), duel]) { el.addEventListener('pointermove', moveC); el.addEventListener('pointerup', cancel); el.addEventListener('pointercancel', cancel); el.addEventListener('contextmenu', e => e.preventDefault()); }
  // the click that ends a hold only opened the sheet: it must not also play the card
  addEventListener('click', e => { if (ate) { ate = false; e.stopPropagation(); e.preventDefault(); } }, true);
  // tapping a chain link reads its card
  $('#chainp').addEventListener('click', e => { const l = e.target.closest('[data-id]'); if (l) cardSheet(l.dataset.id); });
}

function toast(t, ms = 2600) { const d = document.createElement('div'); d.className = 'pn toast'; d.textContent = t; (cur === 'duel' ? $('#layer') : stage).appendChild(d); setTimeout(() => d.remove(), ms); }


/* ---------- hints (Zack, 2026-11-24): the strongest play and why, with a per-duel limit set in Settings ---------- */
const hintLimit = () => SET.hintLimit === 'unlimited' ? Infinity : SET.hintLimit === 'off' ? 0 : +SET.hintLimit;
function hintsLeft() { return D ? Math.max(0, hintLimit() - (D.hintsUsed || 0)) : 0; }
function hintButton() { const b = $('#tHint'); if (!b) return; const n = hintsLeft(); b.innerHTML = `<svg><use href="#i-bulb"/></svg>Hint${hintLimit() === Infinity ? '' : ` <span class="left"><b>${n}</b> left</span>`}<span class="key">H</span><span class="shine"></span>`; b.disabled = hintLimit() === 0 || n === 0; }
function askHint() {
  if (!D || !D.prompt) return; if (!AUTO) { if (hintLimit() === 0) { toast('Hints are off. Turn them on in Settings.'); return; } if (!hintsLeft()) { toast('No hints left this duel.'); S.play('error'); return; } }
  S.play('click'); W.postMessage({ type: 'hint' }); $('#prompt').innerHTML = 'Thinking about your best play…';
}
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t;
// the review describes what you did ("Normal Summoning X"); a hint says what to do ("Normal Summon X")
const imperative = w => cap(String(w || '')
  .replace(/^attacking with (.+?) into (.+)$/, 'attack $2 with $1').replace(/^attacking with (.+?) directly$/, 'attack directly with $1')
  .replace(/^Normal Summoning /, 'Normal Summon ').replace(/^activating /, 'activate ').replace(/^Setting /, 'Set ')
  .replace(/^ending your turn$/, 'end your turn').replace(/^ending the Battle Phase$/, 'end the Battle Phase').replace(/^going to the Battle Phase$/, 'go to the Battle Phase')
  .replace(/^not responding$/, "don't respond").replace(/^passing$/, 'pass'));
function showHint(m) {
  if (!D || !D.prompt) return;
  if (AUTO) { send(m.keys); return; }
  D.hintsUsed = (D.hintsUsed || 0) + 1; hintButton(); S.play('activate');
  const p = document.createElement('div'); p.className = 'pn hintp';
  const why = (m.why || []).length ? `<div class="ph">Why</div><ul>${m.why.map(w => `<li>${esc(cap(w.replace(/^it /, 'It ')))}.</li>`).join('')}</ul>` : `<div class="ph">Why</div><ul><li>It leaves you in the strongest position the computer can find from here.</li></ul>`;
  p.innerHTML = `<button class="gb sm ico x" data-x><svg><use href="#i-x"/></svg><span class="shine"></span></button><div class="ph">Hint</div><div class="play">${esc(imperative(m.words || m.label))}</div>${why}${m.next ? `<div class="nx">Next best: ${esc(imperative(m.next))}</div>` : ''}`;
  p.querySelector('[data-x]').onclick = () => p.remove();
  $('#layer').appendChild(p);
  const pr = D.prompt; setPrompt(pr); $('#layer').appendChild(p); // keep the prompt's controls, show the panel over them
  if (m.u != null) { if (table.has(m.u)) table.glow(m.u, 0x8dff9e); const h = $(`#hand [data-u="${m.u}"]`); if (h) h.classList.add('up'); }
}

/* ---------- the post-match review ---------- */
function renderReview(sm) {
  const el = $('#resReview'); if (!el) return;
  if (!sm) { el.innerHTML = `<div class="ph">Your duel review</div><p class="mute">Reviewing your duel…</p>`; return; }
  const win = sm.winner === 0, P = n => n === 1 ? '' : 's';
  const tp = sm.turning; let turnTxt = '';
  if (tp) {
    const parts = [];
    if (tp.lost[1]) parts.push(`${tp.lost[1]} of the computer's card${P(tp.lost[1])} ${tp.lost[1] > 1 ? 'were' : 'was'} destroyed`);
    if (tp.lost[0]) parts.push(`you lost ${tp.lost[0]} card${P(tp.lost[0])}`);
    if (tp.dmg[1]) parts.push(`the computer took ${tp.dmg[1]} damage`);
    if (tp.dmg[0]) parts.push(`you took ${tp.dmg[0]} damage`);
    const list = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0];
    if (tp.acts[0].length) parts.push(`you played ${list([...new Set(tp.acts[0])].slice(0, 3))}`);
    if (tp.acts[1].length) parts.push(`the computer played ${list([...new Set(tp.acts[1])].slice(0, 3))}`);
    turnTxt = `The duel turned on turn ${tp.turn} (${tp.tp === 0 ? 'your' : "the computer's"} turn)${parts.length ? ': ' + parts.join('; ') : ''}.`;
  }
  const t = sm.totals || {};
  const cardsUp = (t.lostTheirs || 0) - (t.lostMine || 0);
  const why = win ? `You won in ${sm.turns} turns. ${turnTxt}` : sm.winner === -1 ? `A draw after ${sm.turns} turns. ${turnTxt}` : `You lost in ${sm.turns} turns. ${turnTxt}`;
  const wellList = [...sm.good.map(g2 => `<span class="t">Turn ${g2.turn}:</span> ${esc(cap(g2.did))} was the right call${g2.why && g2.why.length ? `: ${esc(g2.why.join(' and '))}` : ''}.`)];
  if (t.dealt) wellList.push(`You dealt ${t.dealt} damage in total.`);
  if (cardsUp > 0) wellList.push(`You destroyed ${t.lostTheirs} of the computer's cards and lost ${t.lostMine}: ahead by ${cardsUp} in trades.`);
  const badList = sm.mistakes.map(x => `<span class="t">Turn ${x.turn}:</span> ${esc(cap(x.did))}. ${esc(cap(x.better))} was stronger${x.why && x.why.length ? `: ${esc(x.why.join(' and '))}` : ''}.`);
  if (cardsUp < 0) badList.push(`You lost ${t.lostMine} cards to the computer's ${t.lostTheirs}: it won the trades by ${-cardsUp}.`);
  // the advantage line: above the middle is your advantage
  const cv = sm.curve || []; let svg = '';
  if (cv.length > 1) { const W2 = 740, H = 110, mx = Math.max(3000, ...cv.map(c => Math.abs(c.v))); const pts = cv.map((c, i) => `${(i / (cv.length - 1) * W2).toFixed(1)},${(H / 2 - c.v / mx * (H / 2 - 6)).toFixed(1)}`).join(' ');
    svg = `<h4>Advantage, turn by turn</h4><svg class="curve" viewBox="0 0 ${W2} ${H}" preserveAspectRatio="none"><line x1="0" y1="${H / 2}" x2="${W2}" y2="${H / 2}" stroke="rgba(255,255,255,.2)" stroke-dasharray="4 6"/><polyline points="${pts}" fill="none" stroke="#e8692e" stroke-width="3"/></svg><div class="mute" style="font-size:14px">Above the line you were ahead, below it the computer was.</div>`; }
  el.innerHTML = `<div class="ph">Your duel review</div><p>${esc(why)}</p>
    <h4>What went well</h4>${wellList.length ? `<ul>${wellList.map(x => `<li>${x}</li>`).join('')}</ul>` : '<p class="mute">Nothing stood out this time.</p>'}
    <h4>${sm.mistakes.length ? 'Clear mistakes' : 'Mistakes'}</h4>${badList.length ? `<ul>${badList.map(x => `<li>${x}</li>`).join('')}</ul>` : '<p>No clear mistakes. Well played.</p>'}
    ${svg}<p class="mute" style="font-size:14px;margin-top:12px">Checked ${sm.reviewedCount} of your decisions with the Tournament-level computer. Only plays that cost about a card or more are listed.</p>`;
}

/* ---------- match records and stats (saved in this browser; Zack, 2026-11-24) ---------- */
const MATCHES = () => JSON.parse(localStorage.getItem('lrplay:matches') || '[]');
function recordMatch(over, sm) {
  if (!D || D.recorded) return; D.recorded = true;
  const r = { id: Date.now().toString(36), at: Date.now(), fmt: D.fmt, you: D.you, cpu: D.cpu, level: SEL.level, result: over.winner === 0 ? 'win' : over.winner === -1 ? 'draw' : 'loss',
    why: over.why || '', gaveUp: /gave up/.test(over.why || ''), turns: D.turn, acts: sm ? sm.acts : null, first: D.first === 0, lp: D.lp[0], oppLp: D.lp[1],
    dealt: sm ? sm.totals.dealt : D.stats.dealt, taken: sm ? sm.totals.taken : null, mistakes: sm ? sm.mistakes.length : null, summary: sm || null };
  const all = MATCHES(); all.unshift(r); all.forEach((m, i) => { if (i >= 30) m.summary = null; }); localStorage.setItem('lrplay:matches', JSON.stringify(all.slice(0, 400)));
}
let stFmt = 'all';
function renderStats() {
  $('#stFmt').innerHTML = [['all', 'All'], ['goat', 'Goat'], ['edison', 'Edison']].map(([k, l]) => `<button class="gb sm ${stFmt === k ? 'pri' : ''}" data-f="${k}">${l}<span class="shine"></span></button>`).join('');
  $('#stFmt').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { stFmt = b.dataset.f; S.play('click'); renderStats(); } };
  const ms = MATCHES().filter(m => stFmt === 'all' || m.fmt === stFmt);
  if (!ms.length) { $('#stBody').innerHTML = `<div class="stbox pn"><p style="font-size:20px">No duels yet${stFmt !== 'all' ? ' in this format' : ''}. Play one and your record starts here.</p></div>`; return; }
  const W = m => m.result === 'win', pct = (w, n) => n ? Math.round(w / n * 100) + '%' : '—';
  const wins = ms.filter(W).length, losses = ms.filter(m => m.result === 'loss').length, draws = ms.length - wins - losses;
  let cur = 0, curType = null; for (const m of ms) { if (m.result === 'draw') break; if (curType == null) curType = m.result; if (m.result !== curType) break; cur++; }
  let best = 0, run = 0; for (const m of [...ms].reverse()) { if (W(m)) { run++; best = Math.max(best, run); } else run = 0; }
  const wonMs = ms.filter(W), avg = (a, f) => a.length ? (a.reduce((x, m) => x + (f(m) || 0), 0) / a.length) : null;
  const avgTurns = avg(wonMs, m => m.turns), avgActs = avg(wonMs.filter(m => m.acts != null), m => m.acts), reviewedMs = ms.filter(m => m.mistakes != null), avgMist = avg(reviewedMs, m => m.mistakes);
  const tile = (n, l) => `<div class="tile pn"><div class="n disp">${n}</div><div class="l">${l}</div></div>`;
  const group = key => { const m = new Map(); for (const x of ms) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return [...m].map(([k, a]) => ({ k, n: a.length, w: a.filter(W).length, l: a.filter(x => x.result === 'loss').length, turns: avg(a.filter(W), x => x.turns) })).sort((a, b) => b.n - a.n); };
  const table = (title, rows, label) => `<div class="stbox pn"><div class="ph">${title}</div><table class="sttab"><tr><th>${label}</th><th>Duels</th><th>W–L</th><th>Win %</th><th>Avg turns to win</th></tr>${rows.map(r => `<tr><td>${esc(r.k)}</td><td class="num">${r.n}</td><td class="num">${r.w}–${r.l}</td><td class="num">${pct(r.w, r.n)}<span class="bar2" style="width:${Math.round(r.w / r.n * 60)}px"></span></td><td class="num">${r.turns ? r.turns.toFixed(1) : '—'}</td></tr>`).join('')}</table></div>`;
  const lvlName = k => levelName(k), levelRows = group(m => lvlName(m.level)), deckRows = group(m => m.you), oppRows = group(m => m.cpu);
  const firstRows = group(m => m.first ? 'Going first' : 'Going second');
  // insights in plain words
  const ins = [];
  const bestDeck = deckRows.filter(r => r.n >= 3).sort((a, b) => b.w / b.n - a.w / a.n)[0]; if (bestDeck) ins.push(`Your best deck so far is ${bestDeck.k}: ${bestDeck.w}–${bestDeck.l} (${pct(bestDeck.w, bestDeck.n)}).`);
  const hardOpp = oppRows.filter(r => r.n >= 3).sort((a, b) => a.w / a.n - b.w / b.n)[0]; if (hardOpp && hardOpp.w / hardOpp.n < 0.5) ins.push(`${hardOpp.k} gives you the most trouble: ${hardOpp.w}–${hardOpp.l} against it.`);
  for (const lv of LEVELS) { const r = levelRows.find(x => x.k === lv[1]); const nxt = LEVELS[LEVELS.indexOf(lv) + 1]; if (r && r.n >= 5 && r.w / r.n >= 0.7 && nxt) ins.push(`You win ${pct(r.w, r.n)} on ${lv[1]}. Ready to try ${nxt[1]}?`); }
  const f1 = firstRows.find(r => r.k === 'Going first'), f2 = firstRows.find(r => r.k === 'Going second');
  if (f1 && f2 && f1.n >= 3 && f2.n >= 3 && Math.abs(f1.w / f1.n - f2.w / f2.n) >= 0.15) ins.push(`You win ${pct(f1.w, f1.n)} going first and ${pct(f2.w, f2.n)} going second.`);
  if (reviewedMs.length >= 6) { const recent = avg(reviewedMs.slice(0, 5), m => m.mistakes), before = avg(reviewedMs.slice(5), m => m.mistakes); if (recent < before - 0.3) ins.push(`You're making fewer clear mistakes lately: ${recent.toFixed(1)} a duel, down from ${before.toFixed(1)}.`); else if (recent > before + 0.3) ins.push(`Clear mistakes are up lately (${recent.toFixed(1)} a duel, from ${before.toFixed(1)}). The duel review lists each one.`); }
  const fastest = wonMs.slice().sort((a, b) => a.turns - b.turns)[0]; if (fastest) ins.push(`Fastest win: ${fastest.turns} turns with ${fastest.you} against ${fastest.cpu} (${lvlName(fastest.level)}).`);
  if (!ins.length) ins.push('Play a few more duels and insights about your decks and levels will show up here.');
  const recent = ms.slice(0, 12);
  $('#stBody').innerHTML = `<div class="sttiles">${tile(ms.length, 'Duels')}${tile(`${wins}–${losses}${draws ? '–' + draws : ''}`, 'Wins–losses')}${tile(pct(wins, ms.length), 'Win rate')}${tile(cur ? `${cur}${curType === 'win' ? 'W' : 'L'}` : '—', 'Current streak')}${tile(best, 'Best win streak')}${tile(avgTurns ? avgTurns.toFixed(1) : '—', 'Avg turns to win')}${tile(avgActs ? Math.round(avgActs) : '—', 'Avg moves to win')}${tile(avgMist != null ? avgMist.toFixed(1) : '—', 'Clear mistakes a duel')}</div>
    <div class="stcols"><div>${table('By computer level', levelRows, 'Level')}${table('By your deck', deckRows, 'Deck')}${table('By opponent deck', oppRows, 'Opponent')}${table('Going first or second', firstRows, 'Turn order')}</div>
    <div><div class="stbox pn"><div class="ph">Insights</div><ul class="ins">${ins.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="stbox pn"><div class="ph">Recent duels</div><table class="sttab"><tr><th>Result</th><th>Your deck</th><th>Opponent</th><th>Level</th><th>Turns</th></tr>${recent.map(m => `<tr class="${m.summary ? 'click' : ''}" data-m="${m.id}"><td class="${m.result === 'win' ? 'res-w' : m.result === 'loss' ? 'res-l' : 'res-d'}">${m.result === 'win' ? 'Win' : m.result === 'loss' ? (m.gaveUp ? 'Gave up' : 'Loss') : 'Draw'}</td><td>${esc(m.you)}</td><td>${esc(m.cpu)}</td><td>${esc(lvlName(m.level))}</td><td class="num">${m.turns}</td></tr>`).join('')}</table><div class="mute" style="font-size:14px;margin-top:8px">Click a duel to read its review.</div></div></div></div>`;
  $('#stBody').onclick = e => { const r = e.target.closest('tr[data-m]'); if (!r) return; const m = MATCHES().find(x => x.id === r.dataset.m); if (!m || !m.summary) return; S.play('click');
    const v = document.createElement('div'); v.className = 'veil'; v.style.zIndex = 59; const p = document.createElement('div'); p.className = 'pn dlg'; p.style.cssText = 'z-index:60;width:900px;max-height:900px;overflow:auto';
    p.innerHTML = `<div class="review" id="resReview" style="position:static;width:auto;padding:0"></div><div class="btns"><button class="gb sm" data-x>Close<span class="shine"></span></button></div>`;
    stage.append(v, p); const prev = $('#s-results #resReview'); if (prev) prev.id = 'resReviewMain'; renderReview(m.summary); p.querySelector('.review').id = 'stReview'; if (prev) prev.id = 'resReview';
    const close = () => { v.remove(); p.remove(); }; v.onclick = close; p.querySelector('[data-x]').onclick = close; };
}

/* ---------- results ---------- */
async function endDuel(over) {
  if (!D || D.over) return; D.over = over; clearInteract(); setPrompt(null); $('#prompt').classList.add('hidden');
  const win = over.winner === 0; S.play(win ? 'win' : 'lose');
  await banner(win ? 'Victory' : over.winner === -1 ? 'Draw' : 'Defeat', '', !win);
  await sleep(500);
  const st = D.stats, lpYou = D.lp[0];
  $('#resHero').className = 'res-hero' + (win ? '' : ' lose');
  $('#resHero').innerHTML = `<div class="cap mute" style="font-size:18px">Turn ${D.turn} · ${D.fmt === 'goat' ? 'Goat' : 'Edison'} · ${levelName(SEL.level)}</div><div class="disp">${win ? 'Victory' : over.winner === -1 ? 'Draw' : 'Defeat'}</div><p>${esc(whyText(over, win))}</p>`;
  const tiles = [[lpYou, 'Your Life Points left'], [st.summons, 'Your summons'], [D.turn, 'Turns played'], [st.destroyed, "Computer's cards destroyed"], [st.chains, 'Cards and effects you activated'], [st.biggest, 'Biggest hit']];
  $('#resTiles').innerHTML = tiles.map(([n, l]) => `<div class="tile pn"><div class="n disp">${n}</div><div class="l">${l}</div></div>`).join('');
  renderReview(D.summary || null); if (D.summary) recordMatch(over, D.summary); else setTimeout(() => { if (D && !D.recorded && D.over === over) recordMatch(over, null); }, 60000);
  show('results');
}
function idOfU(u) { if (!D.view) return null; for (const P of D.view.p) for (const z of ['gy', 'ban']) for (const c of P[z]) if (c.u === u) return c.id; const c = findU(u); return c ? c.id : null; }
function whyText(o, win) {
  const w = o.why || '';
  if (/gave up/.test(w)) return w;
  if (/both/i.test(w) || o.winner === -1) return 'Both players ran out of Life Points at the same time.';
  if (/draw/i.test(w)) return win ? "The computer couldn't draw a card." : "You couldn't draw a card.";
  return win ? 'The computer ran out of Life Points.' : 'You ran out of Life Points.';
}

function updateTicker() {
  const ms = JSON.parse(localStorage.getItem('lrplay:matches') || '[]'), w = ms.filter(m => m.result === 'win').length, l = ms.filter(m => m.result === 'loss').length;
  const n = f => READY ? READY[f].decks.filter(d => d.ready).length : 0;
  // a static bar, the main points only (Zack, 2026-11-24: "make the bottom bars stop scrolling... simple and direct")
  const items = [`Goat: ${n('goat')} decks`, `Edison: ${n('edison')} decks`, '4 computer levels', ms.length ? `Your record: ${w}–${l}` : 'Build your own deck in Decks'];
  $('#ticker').innerHTML = items.map(esc).join(' <i class="dia"></i> ');
}
readyP.then(() => { if (cur === 'format') renderFormats(); updateTicker(); const sc = new URLSearchParams(location.search).get('screen'); if (sc) { if (sc === 'build') B.deck = null; show(sc); if (sc === 'list') { show('deck'); setTimeout(() => $('#seeList') && $('#seeList').click(), 300); } } });
