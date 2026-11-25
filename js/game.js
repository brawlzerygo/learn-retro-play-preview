/* Learn Retro Play: the game. Screens, the deck picker, and the duel: engine events (from js/worker.js) become animations on
 the 3D table (js/table.js) and the HUD; your choices go back to the engine. The engine decides every rule; this file only
 shows the duel and passes on what you pick. */
import { Table } from './table.js';
import * as S from './sfx.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const stage = $('#stage');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, document.hidden ? 0 : ms));
let scale = 1;
function fit() { scale = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(-50%,-50%) scale(${scale})`; }
addEventListener('resize', fit); fit();
const toStage = e => { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };

/* ---------- settings ---------- */
const SET = Object.assign({ vol: 50, speed: 'normal', hintLimit: '3', muted: false, theme: 'broadcast' }, JSON.parse(localStorage.getItem('lrplay:set') || '{}'));
const saveSet = () => localStorage.setItem('lrplay:set', JSON.stringify(SET));
const SPEED = { relaxed: 1.35, normal: 1, fast: 0.55, instant: 0.04 };
S.setVolume(SET.vol / 100); S.setMuted(SET.muted); S.load();
/* Settings: one row per setting, ↑↓ to choose a row, ←→ to change it (Rewind's layout, Broadcast style) */
const SETROWS = [
  { k: 'speed', name: 'Duel speed', vals: ['relaxed', 'normal', 'fast', 'instant'], lab: v => v, desc: 'How fast cards move and banners play during a duel.' },
  { k: 'hintLimit', name: 'Hints per duel', vals: ['off', '1', '3', '5', 'unlimited'], lab: v => v, desc: 'A hint shows the strongest play and why it beats the next best, like the hint button on a chess site.' },
  { k: 'vol', name: 'Sound effects', vals: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], blocks: true, desc: 'How loud cards, summons and battles are.' },
  { k: 'muted', name: 'Sound', vals: [false, true], lab: v => v ? 'off' : 'on', desc: 'Turn every sound on or off.' },
  { k: 'table', name: 'Table', vals: ['shop'], lab: () => 'Card Shop', soon: 'Arena soon', desc: 'The world your duels are played in. More tables are coming.' },
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
    return `<div class="vrow ${i === setRow ? 'on' : ''}" data-i="${i}"><span>${r.name}</span><span class="dots"></span><span class="val"><span class="arr" data-d="-1">◀</span>${val}<span class="arr" data-d="1">▶</span>${r.soon ? `<span class="soonv">${r.soon}</span>` : ''}</span></div>`; }).join('');
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
const W = new Worker('js/worker.js');
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
function show(s) { if (s !== cur) S.play('nav'); if (s !== cur) closeDeckList(); cur = s; stage.dataset.scr = s; $('#gBack').classList.toggle('on', !!BACK[s]); $$('.screen').forEach(e => e.classList.toggle('on', e.id === 's-' + s)); if (s === 'deck') renderDecks(); if (s === 'format') renderFormats(); if (s === 'build') readyP.then(openBuilder); if (s === 'stats') renderStats(); if (s === 'settings') renderSettings(); if (s === 'title') updateTicker(); }
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
  else if (cur === 'build') { if (e.key === 'Escape') { if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur(); else goBack(); } }
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
  for (const [f, id] of [['edison', '#edReady'], ['goat', '#gtReady']]) { const n = readyDecks(f).length, all = READY[f].decks.length; const t = $(id); t.textContent = n === all ? `${n} decks ready` : `${n} of ${all} decks ready`; t.className = 'tg ' + (n ? 'hot' : ''); }
  focusFmt(null);
}
// nothing is preselected: hovering (or arrow keys) highlights a format, clicking it (or Enter) goes to the deck screen
function focusFmt(f) { SEL.fmtFocus = f; $$('.fmt').forEach(x => x.classList.toggle('sel', x.dataset.fmt === f)); if (f) S.play('hover'); }
function chooseFmt(f) { if (!readyDecks(f).length) { toast('No deck in this format is ready yet.'); S.play('error'); return; } SEL.fmt = f; saveSel(); show('deck'); }
$$('.fmt').forEach(x => { x.onclick = () => { S.unlock(); chooseFmt(x.dataset.fmt); }; x.onmouseenter = () => focusFmt(x.dataset.fmt); x.onmouseleave = () => focusFmt(null); });
const TIERS = { edison: ['Best', 'Competitive', 'Rogue', 'Contender', 'Casual'], goat: ['A', 'B', 'C', 'D', 'T'] };
const TIERNAME = { A: 'Tier A', B: 'Tier B', C: 'Tier C', D: 'Tier D', T: 'Tournament' };
let pickingOpp = false;
function keyCards(f, d) { // three cards to show for a deck: its strongest monsters, Extra Deck first
  const ids = [...new Set([...d.extra, ...d.main])]; const rs = ids.map(id => rec(f, id)).filter(r => r && !['spell', 'trap'].includes(r.k));
  rs.sort((a, b) => (+b.atk || 0) - (+a.atk || 0)); const out = rs.slice(0, 3).map(r => r.id); while (out.length < 3 && ids[out.length]) out.push(ids[out.length]); return out;
}
async function renderDecks() {
  await readyP;
  const f = SEL.fmt, decks = allDecks(f), info = new Map(decks.map(d => [d.key, deckInfo(f, d)]));
  const ok = decks.filter(d => info.get(d.key).ready).map(d => d.key); const s = SEL[f];
  if (!ok.includes(s.you)) s.you = ok.find(k => !k.startsWith('my:')) || ok[0]; if (!ok.includes(s.cpu)) s.cpu = ok.filter(k => !k.startsWith('my:'))[1] || ok[0];
  $('#deckTitle').textContent = pickingOpp ? "Computer's deck" : 'Your deck';
  const tabs = ['all', 'my', ...TIERS[f]];
  $('#tierTabs').innerHTML = tabs.map(t => `<button class="gb sm ${SEL.tier === t ? 'on' : ''}" data-tier="${t}">${t === 'all' ? 'All' : t === 'my' ? 'My decks' : (TIERNAME[t] || t)}<span class="shine"></span></button>`).join('');
  $('#tierTabs').onclick = e => { const b = e.target.closest('[data-tier]'); if (b) { SEL.tier = b.dataset.tier; saveSel(); S.play('click'); renderDecks(); } };
  const tierIdx = d => d.tier === 'my' ? -1 : TIERS[f].indexOf(d.tier);
  const list = decks.filter(d => SEL.tier === 'all' || d.tier === SEL.tier).sort((a, b) => (info.get(b.key).ready - info.get(a.key).ready) || tierIdx(a) - tierIdx(b));
  const sel = pickingOpp ? s.cpu : s.you;
  const why = r => r.problems && r.problems.length ? ' · not legal yet' : r.missing.length ? ` · ${r.missing.length} card${r.missing.length > 1 ? 's' : ''} not playable yet` : '';
  $('#deckList').innerHTML = (list.length ? list : []).map(d => { const r = info.get(d.key); const k = keyCards(f, d)[0];
    return `<div class="dk ${d.key === sel ? 'sel' : ''} ${pickingOpp ? 'opp' : ''} ${r.ready ? '' : 'off'}" data-deck="${esc(d.key)}"><div class="strip" style="background-image:url(${artUrl(k)})"></div><div><div class="nm cap">${esc(d.name)}</div><div class="pl">${d.main.length} cards${d.extra.length ? ` · ${d.extra.length} in the ${f === 'goat' ? 'Fusion' : 'Extra'} Deck` : ''}${why(r)}</div></div><div class="tags"><span class="tg ${d.tier === 'my' || d.tier === TIERS[f][0] ? 'hot' : ''}">${d.tier === 'my' ? 'Yours' : esc(TIERNAME[d.tier] || d.tier)}</span>${r.ready ? '' : `<span class="tg">${r.problems && r.problems.length ? 'Fix' : 'Soon'}</span>`}</div></div>`; }).join('')
    || (SEL.tier === 'my' ? '<div class="mute" style="font-size:20px;padding:20px">No decks of your own yet. Build one in the Deck Builder.</div>' : '');
  $('#deckList').onclick = e => { const el = e.target.closest('[data-deck]'); if (!el) return; const r = info.get(el.dataset.deck);
    if (el.classList.contains('off')) { S.play('error'); toast(r.problems && r.problems.length ? r.problems[0] : 'This deck has cards the engine can\'t play yet: ' + r.missing.slice(0, 4).join(', ') + (r.missing.length > 4 ? '…' : '')); return; }
    if (pickingOpp) { s.cpu = el.dataset.deck; pickingOpp = false; } else s.you = el.dataset.deck; saveSel(); S.play('click'); renderDecks(); };
  const you = deckByKey(f, s.you), cpu = deckByKey(f, s.cpu);
  if (!you || !cpu) { $('#deckSide').innerHTML = ''; return; }
  const kc = keyCards(f, you);
  $('#deckSide').innerHTML = `<div class="dk-fan">${kc.map((id, i) => `<div class="card" style="background-image:url(${artUrl(id)});left:${170 + i * 150}px;${i === 1 ? 'top:-4px;z-index:2;box-shadow:0 20px 50px rgba(0,0,0,.8)' : `transform:rotate(${i ? 10 : -10}deg)`}"></div>`).join('')}</div>
    <div class="ph">Your deck · ${you.tier === 'my' ? 'Yours' : esc(TIERNAME[you.tier] || you.tier)} · ${f === 'goat' ? 'Goat' : 'Edison'}</div><h3 class="disp">${esc(you.name)}</h3>
    <p>${you.main.length} cards in the Main Deck${you.extra.length ? `, ${you.extra.length} in the ${f === 'goat' ? 'Fusion' : 'Extra'} Deck` : ''}.${you.credit ? ' List: ' + esc(you.credit) + '.' : ''}</p>
    <div class="row"><button class="gb sm pri" id="seeList"><svg><use href="#i-list"/></svg>See the full deck list<span class="key">L</span><span class="shine"></span></button><button class="gb sm" id="seeOpp"><svg><use href="#i-list"/></svg>Computer's list<span class="shine"></span></button></div>
    <div class="row"><span class="lb cap">Opponent</span><div style="display:flex;align-items:center;gap:12px;font-size:22px"><div class="card" style="width:50px;height:73px;background-image:url(${artUrl(keyCards(f, cpu)[0])})"></div><b class="cap">${esc(cpu.name)}</b></div>
      <button class="gb sm" id="oppPick" style="margin-left:auto"><svg><use href="#i-cards"/></svg>${pickingOpp ? 'Picking…' : 'Change'}<span class="shine"></span></button><button class="gb sm" id="oppRand">Random<span class="shine"></span></button></div>
    <div class="row" style="align-items:flex-start"><span class="lb cap" style="margin-top:14px">Computer</span><div><div class="seg" id="lvl">${LEVELS.map(([k, n]) => `<button class="gb sm ${SEL.level === k ? 'pri' : ''}" data-l="${k}">${n}<span class="shine"></span></button>`).join('')}</div>
      <div class="mute" style="font-size:16px;margin-top:10px;max-width:600px">${esc(LEVELS.find(l => l[0] === SEL.level)[2])}</div></div></div>`;
  $('#seeList').onclick = () => deckList(f, you, 'Your deck');
  $('#seeOpp').onclick = () => deckList(f, cpu, "The computer's deck");
  $('#oppPick').onclick = () => { pickingOpp = !pickingOpp; S.play('click'); renderDecks(); };
  $('#oppRand').onclick = () => { const o = ok.filter(n => n !== s.you); s.cpu = o[Math.floor(Math.random() * o.length)] || s.you; pickingOpp = false; saveSel(); S.play('shuffle'); renderDecks(); };
  $('#lvl').onclick = e => { const b = e.target.closest('[data-l]'); if (b) { SEL.level = b.dataset.l; saveSel(); S.play('click'); renderDecks(); } };
}
$('#duelGo').onclick = () => { S.unlock(); startDuel(); };
// the whole list of a deck: Main Deck by card type, then the Extra (Fusion) Deck, with counts; hover a card to read it
function deckList(f, d, title) {
  closeDeckList(); S.play('click');
  const main = sortDeck(f, d.main), extra = sortDeck(f, d.extra);
  const W = 1576, H = extra.length ? 560 : 740, m = fitCards(main.length, W, H, 8), wm = Math.min(m.w, 150);
  const e = extra.length ? fitCards(extra.length, W - 40, 150, 8) : null, we = e ? Math.min(e.w, wm, 103) : 0;
  const tile = (id, w) => { const r = rec(f, id); return `<div class="dl" data-id="${id}" style="width:${w}px"><div class="card" style="background-image:url(${artUrl(id)});width:${w}px;height:${w * 614 / 421}px" title="${esc(r ? r.n : '')}"></div></div>`; };
  const nMon = main.filter(id => typeOrder(f, id) === 0).length, nSp = main.filter(id => typeOrder(f, id) === 2).length, nTr = main.filter(id => typeOrder(f, id) === 3).length;
  const v = document.createElement('div'); v.className = 'veil'; v.id = 'dlVeil'; v.style.zIndex = 59;
  const p = document.createElement('div'); p.className = 'pn dlist'; p.id = 'dlist';
  p.innerHTML = `<div class="head"><h3 class="disp" style="font-size:52px">${esc(title)}: ${esc(d.name)}</h3><span class="tg hot">${main.length} cards</span><span class="tg">${nMon} mon · ${nSp} spell · ${nTr} trap</span><button class="gb sm" id="dlClose"><svg><use href="#i-x"/></svg>Close<span class="key">Esc</span><span class="shine"></span></button></div>
    <div class="body"><div class="sec2">Main Deck</div><div class="fitgrid" style="grid-template-columns:repeat(${m.cols},${wm}px)">${main.map(id => tile(id, wm)).join('')}</div>
    ${extra.length ? `<div class="sec2" style="margin-top:14px">${f === 'goat' ? 'Fusion Deck' : 'Extra Deck'} · ${extra.length}</div><div class="fitgrid" style="grid-template-columns:repeat(${Math.max(e.cols, 1)},${we}px)">${extra.map(id => tile(id, we)).join('')}</div>${d.extraNote ? `<div class="mute" style="font-size:14px;margin-top:6px">${esc(d.extraNote)}.</div>` : ''}` : ''}</div>
    <div class="pn peek hidden" id="dlPeek"></div>`;
  stage.append(v, p);
  v.onclick = closeDeckList; p.querySelector('#dlClose').onclick = closeDeckList;
  p.onmouseover = e2 => peekOver(e2, p, f);
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
  p.onmouseover = e => peekOver(e, p, D.fmt);
}
function peekOver(e, p, f) {
  const t = e.target.closest('[data-id]'); if (!t) return; const r = rec(f, t.dataset.id); if (!r) return; const pk = p.querySelector('#dlPeek'); pk.classList.remove('hidden');
  pk.innerHTML = `<div class="card" style="background-image:url(${artUrl(t.dataset.id)})"></div><h4>${esc(r.n)}</h4><div class="meta">${esc(cardMeta(r))}</div><p>${esc(cardText(f, r))}</p>`;
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
    return `<div class="pc ${k >= lim ? 'max' : ''}" data-id="${c.id}"><img class="card" loading="lazy" alt="" src="${artUrl(c.id)}">${c.b ? `<span class="lim ${c.b}">${c.b}</span>` : ''}${k ? `<span class="in">${k}</span>` : ''}</div>`; }).join('') || '<div class="mute" style="grid-column:1/-1;font-size:20px">No cards match.</div>';
  const pool = $('#bPool');
  pool.onclick = e => { const t = e.target.closest('[data-id]'); if (t) addCard(t.dataset.id); };
  pool.oncontextmenu = e => { e.preventDefault(); const t = e.target.closest('[data-id]'); if (t) removeCard(t.dataset.id); };
  pool.onmouseover = e => builderPeek(e); pool.onmouseleave = () => $('#bPeek').classList.add('hidden');
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
  const f = B.fmt, d = B.deck, probs = deckProblems(f, d);
  const nMon = d.main.filter(id => typeOrder(f, id) === 0).length, nSp = d.main.filter(id => typeOrder(f, id) === 2).length, nTr = d.main.filter(id => typeOrder(f, id) === 3).length;
  const okMain = d.main.length >= 40 && d.main.length <= 60;
  $('#bBoard').innerHTML = `<div class="cell name" style="flex:1"><div class="k">Deck · ${f === 'goat' ? 'Goat' : 'Edison'}</div><input id="bName" value="${esc(d.name)}" maxlength="40"></div>
    <div class="cell"><div class="k">Main</div><div class="v ${okMain ? 'ok' : 'bad'}">${d.main.length}</div></div>
    <div class="cell"><div class="k">${f === 'goat' ? 'Fusion' : 'Extra'}</div><div class="v ${d.extra.length > 15 ? 'bad' : ''}">${d.extra.length}</div></div>
    <div class="cell"><div class="k">Mon · Spell · Trap</div><div class="v">${nMon}·${nSp}·${nTr}</div></div>
    <div class="act"><button class="gb sm" id="bMine">My decks<span class="shine"></span></button><button class="gb sm" id="bCopy">Start from a deck<span class="shine"></span></button><button class="gb sm" id="bNew">New<span class="shine"></span></button><button class="gb sm" id="bDel">Delete<span class="shine"></span></button></div>
    <button class="savebtn" id="bSave">${B.dirty ? 'Save' : 'Saved'}</button>`;
  // the roster (right half): every card of the Main Deck and the Extra (Fusion) Deck, sized to fit without scrolling
  const main = sortDeck(f, d.main), extra = sortDeck(f, d.extra), RW = 912, xl = f === 'goat' ? 'Fusion' : 'Extra';
  const eH = extra.length > 8 ? 250 : 190, mH = 874 - 28 - 70 - eH - 40;
  const fm = fitCards(Math.max(1, main.length), RW, mH), w = Math.min(fm.w, 120);
  const fe = fitCards(Math.max(1, extra.length), RW, eH - 30), we = Math.min(fe.w, w, 100);
  const tile = id => `<div class="x" data-id="${id}"><img alt="" src="${artUrl(id)}"></div>`;
  const statLine = probs.length ? `<span style="color:#ff8a7a">${esc(probs[0])}</span>` : `<span style="color:#8dff9e">Legal under the ${f === 'goat' ? 'Goat' : 'Edison'} banlist · ready to duel</span>`;
  $('#bDeck').innerHTML = `<div class="rhead"><div class="lbl">Your deck</div><div class="stat">${statLine}</div></div>
    <div class="main" style="grid-template-columns:repeat(${fm.cols},${w}px)">${main.length ? main.map(tile).join('') : '<div class="empty">Click cards on the left to add them</div>'}</div>
    <div class="extra" style="grid-template-columns:repeat(${fe.cols},${we}px)"><div class="xl">${xl} deck · ${extra.length}</div>${extra.map(tile).join('')}</div>`;
  $('#bName').oninput = e => { d.name = e.target.value; B.dirty = true; $('#bSave').textContent = 'Save'; };
  $('#bSave').onclick = saveDeck; $('#bNew').onclick = async () => { if (B.dirty && !(await ask('Start a new deck without saving this one?', 'New deck'))) return; B.deck = newDeck(f); B.dirty = false; S.play('click'); renderBuilder(); };
  $('#bDel').onclick = async () => { const all = MY(); if (!all.some(x => x.id === d.id)) { B.deck = newDeck(f); B.dirty = false; renderBuilder(); return; } if (!(await ask(`Delete "${d.name}"? This can't be undone.`, 'Delete'))) return; saveMY(all.filter(x => x.id !== d.id)); B.deck = null; S.play('destroy'); openBuilder(); };
  $('#bMine').onclick = () => pickDialog('My decks', MY().filter(x => x.fmt === f), x => { B.deck = JSON.parse(JSON.stringify(x)); B.dirty = false; renderBuilder(); }, 'No saved decks yet.');
  $('#bCopy').onclick = () => pickDialog('Start from a deck', FM[f].decks, x => { B.deck = { ...newDeck(f), name: 'My ' + x.name, main: [...x.main], extra: [...x.extra] }; B.dirty = true; renderBuilder(); });
  const dk = $('#bDeck'); dk.onclick = e => { const t = e.target.closest('[data-id]'); if (t) removeCard(t.dataset.id); };
  dk.oncontextmenu = e => { e.preventDefault(); const t = e.target.closest('[data-id]'); if (t) addCard(t.dataset.id); };
  dk.onmouseover = e => builderPeek(e); dk.onmouseleave = () => $('#bPeek').classList.add('hidden');
}
function saveDeck() {
  const d = B.deck; d.name = (d.name || '').trim() || 'My deck'; d.updated = Date.now();
  const all = MY().filter(x => x.id !== d.id); all.unshift(JSON.parse(JSON.stringify(d))); saveMY(all); B.dirty = false; S.play('summon');
  toast(deckProblems(d.fmt, d).length ? `Saved "${d.name}". Fix the problems listed before dueling with it.` : `Saved "${d.name}". Pick it under My decks before a duel.`); renderDeckSide();
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
async function ensureTable() {
  if (table) return;
  camData = await (await fetch('assets/scenes/shop-camera.json')).json();
  table = new Table($('#gl'), camData, { tokenArt: TOKEN_ART });
  table.speed = SPEED[SET.speed];
  table.bindPointer($('#gl'), toStage);
  table.onHover = h => { $('#gl').classList.toggle('point', !!(h && (h.u != null || h.pile || h.zone))); if (!D) return; if (h && h.u != null) inspectU(h.u); else if (h && h.pile) hoverPile(h.pile); };
  table.onClick = h => { if (D) fieldClick(h); };
  table.onFrame = frameOverlay;
  // turn medallion and phase dial sit on the board's center line, just outside the mat
  const half = camData.board.BOARD_W / 2 + 0.62, L = table.project(new (table.camera.position.constructor)(-half, 0, 0)), R = table.project(new (table.camera.position.constructor)(half, 0, 0));
  Object.assign($('#turnm').style, { left: L.x + 'px', top: L.y + 'px' }); Object.assign($('#dial').style, { left: R.x + 'px', top: R.y + 'px' });
}
async function startDuel() {
  const f = SEL.fmt, s = SEL[f];
  const youDeck = deckByKey(f, s.you), cpuDeck = deckByKey(f, s.cpu); if (!youDeck || !cpuDeck) { show('deck'); return; }
  show('load'); $('#loadTxt').textContent = 'Shuffling…'; $('#loadSub').textContent = `${youDeck.name} vs ${cpuDeck.name} · ${f === 'goat' ? 'Goat' : 'Edison'} · ${levelName(SEL.level)}`;
  S.play('shuffle');
  await ensureTable();
  const first = Math.random() < 0.5 ? 0 : 1;
  $('#coin').textContent = '?'; $('#coin').style.animation = 'none'; void $('#coin').offsetWidth; $('#coin').style.animation = '';
  await sleep(1150); $('#coin').textContent = first === 0 ? 'Y' : 'C'; $('#loadTxt').textContent = first === 0 ? 'You go first' : 'The computer goes first'; S.play('turn');
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
    for (const ev of m.events) { try { await anim(ev); } catch (e) { console.error('anim', e, ev); } if (D !== myD) return; }
    reconcile(m.view);
    if (m.over) { D.busy = false; return endDuel(m.over); }
    if (m.prompt) setPrompt(m.prompt);
    else setPrompt(null);
  }
  D.busy = false;
}
const side = p => p === 0 ? 1 : -1;
const handPoint = (p, u) => {
  if (p === 0) { const el = u != null && $(`#hand [data-u="${u}"]`); const x = el ? parseFloat(el.style.left) + 70 + (960 - 550) : 960; return table.screenToWorld(x, 1020, 1.5); }
  return table.screenToWorld(960, 40, 1.5);
};
const pileKind = z => ({ deck: 'deck', deckTop: 'deck', extra: 'extra', gy: 'gy', ban: 'ban' }[z]);
const waitMs = ms => sleep(ms * SPEED[SET.speed]);

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
async function animMove(ev) {
  const p = ev.owner, fromSide = side(ev.prevCtrl != null && ['m', 'st', 'fz'].includes(ev.from) ? ev.prevCtrl : p), toSide = side(['m', 'st', 'fz'].includes(ev.to) ? ev.ctrl : p);
  const dp = D.disp.p; const fast = ev.reason === 'deal';
  // where it starts
  let from = null;
  if (['m', 'st', 'fz'].includes(ev.from)) from = table.where(ev.u);
  else if (ev.from === 'hand') { from = handPoint(p, ev.u); dropHand(p, ev.u); }
  else if (pileKind(ev.from)) { from = table.pileTop(fromSide, pileKind(ev.from)); bumpPile(fromSide, pileKind(ev.from), -1, ev.u); }
  if (ev.destroyed && table.has(ev.u)) { S.play('destroy'); await table.shatter(ev.u); if (ev.owner === 1) D.stats.destroyed++; }
  // where it goes
  if (['m', 'st', 'fz'].includes(ev.to)) {
    const up = ev.pos !== 'set';
    S.play(up ? 'place' : 'set');
    await table.place(ev.u, toSide, ev.to === 'fz' ? 'fz' : ev.to, ev.zi, { id: ev.id, up, pos: ev.pos, from, fromUp: ev.from === 'hand' && p === 0 ? true : up, dur: 460 });
    return;
  }
  if (ev.to === 'hand') {
    const to = handPoint(p, null);
    if (table.has(ev.u)) await table.remove(ev.u, to, { up: p === 0, dur: 360 });
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
  const h = D.disp.p[0].hand, n = h.length, step = Math.min(150, 900 / Math.max(1, n)), x0 = 550 - (step * (n - 1)) / 2 - 70;
  const el = $('#hand'); const old = new Map([...el.children].map(c => [+c.dataset.u, c]));
  h.forEach((c, i) => {
    let d = old.get(c.u); if (!d) { d = document.createElement('div'); d.className = 'hc in'; d.dataset.u = c.u; el.appendChild(d); }
    old.delete(c.u);
    d.style.backgroundImage = `url(${artUrl(c.id)})`; d.style.left = (x0 + i * step) + 'px';
    const rot = (i - (n - 1) / 2) * Math.min(4, 24 / n); d.style.transform = `rotate(${rot}deg)`; d.style.zIndex = i + 1;
  });
  for (const d of old.values()) d.remove();
  $('#hcMe').textContent = n;
  const on = D.disp.p[1].hand.length, oe = $('#ohand'); oe.innerHTML = '';
  const os = Math.min(92, 520 / Math.max(1, on)), ox = 300 - (os * (on - 1)) / 2 - 48;
  for (let i = 0; i < on; i++) { const c = document.createElement('div'); c.className = 'card'; c.style.left = (ox + i * os) + 'px'; c.style.transform = `rotate(${(i - (on - 1) / 2) * -3}deg)`; oe.appendChild(c); }
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
function popNum(p, txt, heal) { const d = document.createElement('div'); d.className = 'pop' + (heal ? ' heal' : ''); d.textContent = txt; Object.assign(d.style, p === 0 ? { left: '300px', top: '880px' } : { left: '1640px', top: '200px' }); $('#layer').appendChild(d); setTimeout(() => d.remove(), 1200); }
const PH = { draw: 'Draw', standby: 'Standby', main1: 'Main 1', battle: 'Battle', main2: 'Main 2', end: 'End', start: 'Draw' };
function setPhase(ph) { $('#phaseTxt').textContent = PH[ph] || ph; $('#dial').classList.toggle('op', D.tp !== 0); if (ph !== 'start') S.play('phase', { gap: 300 }); }
async function banner(txt, sub, op) {
  const b = document.createElement('div'); b.className = 'banner' + (op ? ' op' : ''); b.innerHTML = `<div class="disp">${esc(txt)}</div>${sub ? `<div class="sub cap">${esc(sub)}</div>` : ''}`;
  $('#layer').appendChild(b); const ms = 1300 * Math.max(0.35, SPEED[SET.speed]); b.style.animationDuration = ms + 'ms';
  await sleep(ms * 0.62); setTimeout(() => b.remove(), ms * 0.4);
}
async function turnBanner() { S.play('turn'); $('#dial').classList.toggle('op', D.tp !== 0); await banner(D.tp === 0 ? 'Your Turn' : "Computer's Turn", `Turn ${D.turn}`, D.tp !== 0); }
function renderChain() {
  const el = $('#chainp'); if (!D.chain.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = `<div class="ph">Chain · resolves top down</div>` + [...D.chain].reverse().map(L => `<div class="link ${L.p === 0 ? '' : 'op'} ${L.res ? 'res' : ''}"><div class="no disp">${L.link}</div><div class="card" style="background-image:url(${artUrl(L.id)})"></div><div><div class="t">${esc(L.name)}</div><div class="s">${L.p === 0 ? 'You' : 'Computer'}${L.res ? ' · resolving' : ''}</div></div></div>`).join('');
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
function inspect(id) {
  if (id == null) return; const r = rec(D.fmt, id); if (!r) return; const el = $('#inspect');
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
  $('#prompt').innerHTML = battle ? 'Battle Phase: pick a monster to attack with, or end the Battle Phase on the dial' : `${esc(pr.text)}: play a card, or use the phase dial to move on`;
  $$('#hand .hc').forEach(c => c.classList.toggle('play', by.has(+c.dataset.u)));
  for (const u of by.keys()) if (table.has(u)) table.glow(u, battle ? 0xff5030 : 0xff7a30);
  if (pr.opts.some(o => o.kind === 'phase')) $('#dial').classList.add('ready');
  if (D.pendingU != null) { const u = D.pendingU; D.pendingU = null; const os = by.get(u); if (os) { const el = $(`#hand [data-u="${u}"]`); if (el) openMenu(u, os, el); else if (table.has(u)) openMenu(u, os, null, table.cardScreen(u, -1)); } }
  if (SET.hintLimit !== 'off' && D.turn <= 2 && !D.hintShown) { D.hintShown = true; toast('Tip: click a glowing card to play it. The dial on the right moves to the next phase.', 4200); }
}
function promptRespond(pr) {
  const by = optsByU(pr); D.byU = by;
  const mine = D.tp === 0; // on your own turn this window is optional: any other card you click keeps you playing
  $('#prompt').innerHTML = mine ? `You can use an effect now, or click any card to keep playing <span class="key">Space</span> Continue` : `${esc(pr.text)} <span class="key">Space</span> Pass`;
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
    if (pr.max > 1 || pr.min !== 1) confirmBar(pr);
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
  box.innerHTML = `<div class="ph">Chosen: <b id="pickN">0</b></div><button class="gb pri wide" data-ok disabled><svg><use href="#i-check"/></svg>Confirm<span class="key">Enter</span><span class="shine"></span></button>`;
  box.onclick = e => { const b = e.target.closest('[data-ok]'); if (b && !b.disabled) send([...D.picks]); };
  $('#layer').appendChild(box);
}
function pickU(u) {
  const pr = D.prompt; const o = pr.opts.find(x => x.u === u); if (!o) return false;
  togglePick(o.key, pr);
  if (table.has(u)) table.glow(u, D.picks.has(o.key) ? 0xff7a30 : 0x7fd3ff);
  const h = $(`#hand [data-u="${u}"]`); if (h) { h.classList.toggle('play', D.picks.has(o.key)); h.classList.toggle('pick', !D.picks.has(o.key)); }
  if (pr.max === 1 && pr.min === 1) { send([o.key]); return true; }
  const n = $('#pickN'); if (n) n.textContent = D.picks.size; const ok = $('#layer [data-ok]'); if (ok) ok.disabled = !(D.picks.size >= pr.min && D.picks.size <= pr.max);
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
  const os = D.byU && D.byU.get(u);
  if ((!os || !os.length) && pr.type === 'respond' && D.tp === 0) { D.pendingU = u; send(['pass']); return; }
  if (!os || !os.length) { S.play('error'); return; }
  if (pr.type === 'respond' && os.length === 1) { send([os[0].key]); return; }
  openMenu(u, os, el);
}
function fieldClick(h) {
  const pr = D.prompt;
  if (h && h.pile && !D.zoneMode && !(pr && pr.type === 'pick')) { pileView(h.pile.side === 1 ? 0 : 1, h.pile.kind); return; }
  if (!pr) return;
  if (D.zoneMode) { if (h && h.zone) placeInZone(h.zone); else cancelZone(); return; }
  if (!h) { closeMenu(); return; }
  if (h.u != null) {
    if (pr.type === 'pick') { pickU(h.u); return; }
    const os = D.byU && D.byU.get(h.u);
    if (!os && pr.type === 'respond' && D.tp === 0) { D.pendingU = h.u; send(['pass']); return; }
    if (!os) { S.play('error'); return; }
    if (pr.type === 'respond' && os.length === 1) { send([os[0].key]); return; }
    const p = table.cardScreen(h.u, -1); openMenu(h.u, os, null, p);
  }
}
const ICON = { ns: 'i-up', sp: 'i-up', syn: 'i-up', cf: 'i-up', set: 'i-set', setst: 'i-set', flip: 'i-turn', pos: 'i-turn', act: 'i-bolt', atk: 'i-swords', gem: 'i-up' };
function openMenu(u, os, el, at) {
  closeMenu(); S.play('click');
  const m = document.createElement('div'); m.className = 'pn amenu'; m.id = 'amenu'; m.style.position = 'absolute';
  m.innerHTML = os.map((o, i) => `<button class="gb sm wide ${i === 0 ? 'pri' : ''}" data-k="${esc(o.key)}"><svg><use href="#${ICON[o.kind] || 'i-bolt'}"/></svg><span class="lbl">${esc(o.label)}</span><span class="key">${i + 1}</span><span class="shine"></span></button>`).join('');
  let x, y; if (el) { const r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect(); x = (r.left - sr.left) / scale + 70 - 150; y = 1080 - 190 - os.length * 54 - 30; }
  else { x = at.x - 150; y = at.y - 30 - os.length * 54; }
  m.style.left = Math.max(20, Math.min(1600, x)) + 'px'; m.style.top = Math.max(150, y) + 'px';
  m.onclick = e => { const b = e.target.closest('[data-k]'); if (b) choose(os.find(o => o.key === b.dataset.k)); };
  $('#layer').appendChild(m); D.menu = { u, os }; if (el) el.classList.add('up');
}
function closeMenu() { const m = $('#amenu'); if (m) m.remove(); $$('#hand .hc.up').forEach(c => c.classList.remove('up')); if (D) D.menu = null; }
function choose(o) {
  closeMenu();
  const z = zoneFor(o);
  if (z) { // the player picks the zone; the engine places it there (E.act's zone hint)
    const P = D.view.p[0], free = P[z].map((c, i) => c ? -1 : i).filter(i => i >= 0);
    if (free.length > 1) { $('#hand').classList.add('low'); D.zoneMode = { o, z }; table.lightZones(free.map(i => ({ side: 1, zone: z, i }))); $('#prompt').innerHTML = `Choose a zone for <b>${esc(nameOfU(o.u))}</b> <span class="key">Esc</span> Cancel`; S.play('click'); return; }
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
  const r = $('#dial'); m.style.left = (parseFloat(r.style.left) - 120) + 'px'; m.style.top = (parseFloat(r.style.top) + 70) + 'px';
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
$('#tSpeed').onclick = () => { const order = ['normal', 'fast', 'instant', 'relaxed']; SET.speed = order[(order.indexOf(SET.speed) + 1) % order.length]; saveSet(); table.speed = SPEED[SET.speed]; toast('Duel speed: ' + SET.speed); S.play('click'); };
const soundIcon = () => $('#tSound use').setAttribute('href', SET.muted ? '#i-mute' : '#i-sound');
$('#tSound').onclick = () => { SET.muted = !SET.muted; S.setMuted(SET.muted); saveSet(); soundIcon(); S.play('click'); }; soundIcon();
$('#tLog').onclick = () => {
  const old = $('#logp'); if (old) { old.remove(); return; } S.play('click');
  const p = document.createElement('div'); p.className = 'pn logp'; p.id = 'logp';
  p.innerHTML = `<div class="ph">Duel log</div><div class="lines">${D.log.map(l => `<div class="${/^— Turn/.test(l) ? 'turn' : ''}">${esc(l)}</div>`).join('')}</div>`;
  $('#layer').appendChild(p); const ln = p.querySelector('.lines'); ln.scrollTop = ln.scrollHeight;
};
// the duel menu (Zack, 2026-11-24: "a menu/settings/quit option in the duel... adjust settings and quit to main menu during a game. will ask if youre sure")
function duelMenu() {
  if ($('#pauseMenu')) return closeDuelMenu();
  S.play('click'); const v = document.createElement('div'); v.className = 'veil'; v.id = 'pauseVeil'; const dl = document.createElement('div'); dl.className = 'pn dlg pmenu'; dl.id = 'pauseMenu';
  const rows = () => SETROWS.map((r, i) => [r, i]).filter(([r]) => r.k !== 'table').map(([r, i]) => { const v2 = SET[r.k] != null ? SET[r.k] : r.vals[0];
    const val = r.blocks ? `<span class="blocks">${r.vals.slice(1).map(x => `<i class="${x <= v2 ? 'f' : ''}"></i>`).join('')}</span><span class="vn">${v2}</span>` : `<span class="vt">${r.lab(v2)}</span>`;
    return `<div class="vrow" data-i="${i}"><span>${r.name}</span><span class="dots"></span><span class="val"><span class="arr" data-d="-1">◀</span>${val}<span class="arr" data-d="1">▶</span></span></div>`; }).join('');
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
function toast(t, ms = 2600) { const d = document.createElement('div'); d.className = 'pn toast'; d.textContent = t; (cur === 'duel' ? $('#layer') : stage).appendChild(d); setTimeout(() => d.remove(), ms); }


/* ---------- hints (Zack, 2026-11-24): the strongest play and why, with a per-duel limit set in Settings ---------- */
const hintLimit = () => SET.hintLimit === 'unlimited' ? Infinity : SET.hintLimit === 'off' ? 0 : +SET.hintLimit;
function hintsLeft() { return D ? Math.max(0, hintLimit() - (D.hintsUsed || 0)) : 0; }
function hintButton() { const b = $('#tHint'); if (!b) return; const n = hintsLeft(); b.innerHTML = `<svg><use href="#i-bulb"/></svg>Hint${hintLimit() === Infinity ? '' : ` <span class="left">${n} left</span>`}<span class="key">H</span><span class="shine"></span>`; b.disabled = hintLimit() === 0 || n === 0; }
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
  $('#ticker').textContent = items.join('   ◆   ');
}
readyP.then(() => { if (cur === 'format') renderFormats(); updateTicker(); const sc = new URLSearchParams(location.search).get('screen'); if (sc) { if (sc === 'build') B.deck = null; show(sc); if (sc === 'list') { show('deck'); setTimeout(() => $('#seeList') && $('#seeList').click(), 300); } } });
