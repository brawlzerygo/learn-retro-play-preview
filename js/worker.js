/* Learn Retro Play: the duel host (a Web Worker). Runs the shared rules engine and the computer, and tells the game
 only what player 0 (you) may see. The same messages will later come from an online server running the same engine.

 in : {type:'init'}                                            -> {type:'ready', formats:{edison:{decks:[{name,tier,ready,missing}]}, goat:{...}}}
      {type:'start', format, you, cpu, level, seed, first}       -> updates until it is your decision
      {type:'act', keys, pz}                                     -> updates
      {type:'hint'}                                              -> {type:'hint', key, label}
 out: {type:'update', events:[...], view, prompt|null, over|null, log:[lines]}
*/
self.window = self;
// every engine, card and data file carries the game's version (the worker's own ?v=), so a phone never keeps an old card list after an
// update (Zack, 2026-11-25: decks still looked grayed out on a phone that had saved the old files)
const V = (self.location.search.match(/[?&]v=(\d+)/) || [])[1] || String(Date.now());
importScripts('../engine/manifest.js?v=' + V);
importScripts(...self.ENGINE_FILES.map(f => '../engine/' + f + '?v=' + V));
importScripts('../data/edison.js?v=' + V, '../data/goat.js?v=' + V, '../data/tokens.js?v=' + V);
const E = self.EdisonEngine, AI = self.EdisonAI;

let g = null, fmt = null, level = 'intermediate', buf = [], logAt = 0;
const CARDS = f => self.FORMATS[f].cards;

function readiness(f) {
  E.init(CARDS(f), { format: f });
  const byId = new Map(CARDS(f).map(c => [String(c.id), c]));
  return self.FORMATS[f].decks.map(d => {
    // a card the engine can't play yet: an effect card with no script (Normal monsters and tokens need none)
    const missing = [...new Set([...d.main, ...d.extra].map(id => byId.get(id)).filter(c => c && !E.scripted(c.n)).map(c => c.n))];
    return { name: d.name, tier: d.tier, ready: missing.length === 0, missing };
  });
}

/* ---------- what you may see ---------- */
const pub = c => c && (c.zone === 'gy' || c.zone === 'ban' || ((c.zone === 'm' || c.zone === 'st' || c.zone === 'fz') && c.pos !== 'set'));
const mine = c => c && (c.zone === 'hand' || c.zone === 'extra' || ((c.zone === 'm' || c.zone === 'st' || c.zone === 'fz'))) && (c.zone === 'hand' || c.zone === 'extra' ? c.owner === 0 : c.ctrl === 0);
const seen = c => pub(c) || mine(c);
const cid = c => (typeof c.id === 'string' ? c.id : c.id);   // tokens have string ids like 'tok-sheep'
function fieldCard(c) {
  if (!c) return null;
  const up = c.pos !== 'set', o = { u: c.u, pos: c.pos, up, ctrl: c.ctrl, owner: c.owner };
  if (up || c.ctrl === 0) o.id = cid(c);
  if (up && E.data(c) && !['spell', 'trap'].includes(E.data(c).k)) { o.atk = E.atk(g, c); o.def = E.def(g, c); o.name = E.name(c); }
  if (c.ctr) { const n = Object.values(c.ctr).reduce((a, b) => a + b, 0); if (n) o.ctr = n; }
  return o;
}
function view() {
  return {
    turn: g.turnNo, tp: g.tp, phase: g.phase,
    p: g.p.map((P, i) => ({
      lp: P.lp, name: P.name, deckName: P.deckName,
      hand: P.hand.map(c => i === 0 ? { u: c.u, id: cid(c) } : { u: c.u }),
      deck: P.deck.length,
      extra: i === 0 ? P.extra.map(c => ({ u: c.u, id: cid(c) })) : P.extra.map(c => ({ u: c.u })),
      gy: P.gy.map(c => ({ u: c.u, id: cid(c) })), ban: P.ban.map(c => ({ u: c.u, id: cid(c) })),
      m: P.m.map(fieldCard), st: P.st.map(fieldCard), fz: fieldCard(P.fz),
    })),
    chain: g.chain.map((L, i) => ({ link: i + 1, u: L.c.u, id: cid(L.c), p: L.p, name: E.name(L.c) })),
  };
}
function zoneIndex(c) { const P = g.p[c.ctrl]; if (c.zone === 'm') return P.m.indexOf(c); if (c.zone === 'st') return P.st.indexOf(c); return -1; }

/* ---------- live events from the engine hooks, snapshotted at the moment they happen ---------- */
const hooks = {
  ev(gg, ev) {
    const t = ev.type, base = { type: t, turn: ev.turn, phase: ev.phase };
    if (t === 'move') {
      const c = ev.c, show = seen(c) || (ev.wasField && ev.snap && ev.snap.faceUp) || ev.from === 'gy' || ev.from === 'ban';
      buf.push({ ...base, u: c.u, id: show ? cid(c) : null, from: ev.from, to: ev.to, owner: c.owner, ctrl: c.ctrl, prevCtrl: ev.prevCtrl,
        pos: c.pos, zi: zoneIndex(c), reason: ev.reason || null, destroyed: !!ev.destroyed, battle: !!ev.battle });
    } else if (t === 'summon') buf.push({ ...base, us: ev.cs.map(c => c.u), how: ev.how, p: ev.p });
    else if (t === 'flip') buf.push({ ...base, u: ev.c.u, id: cid(ev.c), p: ev.p });
    else if (t === 'pos') buf.push({ ...base, u: ev.c.u, pos: ev.c.pos, id: ev.c.pos !== 'set' ? cid(ev.c) : null });
    else if (t === 'attack') buf.push({ ...base, a: ev.a.u, t: ev.t ? ev.t.u : null, p: ev.p });
    else if (t === 'damage') buf.push({ ...base, p: ev.p, n: ev.n, battle: !!ev.battle, lp: g.p[ev.p].lp });
    else if (t === 'phase') buf.push({ ...base, ph: ev.ph, tp: ev.tp });
    else if (t === 'set') buf.push({ ...base, u: ev.c && ev.c.u });
  },
  note(gg, n) {
    const L = n.L;
    if (n.type === 'chain') buf.push({ type: 'chain', turn: g.turnNo, link: g.chain.length, u: L.c.u, id: cid(L.c), p: L.p, name: E.name(L.c), targets: (L.t || []).filter(Boolean).map(x => x.u) });
    if (n.type === 'resolve') buf.push({ type: 'resolve', link: g.chain.length + 1, u: L.c.u, negated: !!L.negated });
  },
};

function promptFor0() {
  const pr = g.prompt; if (!pr || pr.p !== 0) return null;
  const all = [...g.p[0].hand, ...g.p[1].hand, ...g.p[0].deck, ...g.p[0].extra, ...g.p[0].gy, ...g.p[0].ban, ...g.p[1].gy, ...g.p[1].ban,
    ...g.p[0].m, ...g.p[0].st, g.p[0].fz, ...g.p[1].m, ...g.p[1].st, g.p[1].fz].filter(Boolean);
  const byU = new Map(all.map(c => [c.u, c]));
  return { type: pr.type, text: pr.text, min: pr.min, max: pr.max, hint: pr.hint || null,
    opts: pr.opts.map(o => { const c = o.u != null ? byU.get(o.u) : null; const r = { key: o.key, label: o.label, kind: o.kind || null, u: o.u != null ? o.u : null, t: o.t != null ? o.t : null };
      // an effect that lets you look at the opponent's hand names those cards (the engine's label): show their art too
      const revealed = c && pr.type === 'pick' && c.zone === 'hand' && c.owner === 1 && o.label === E.name(c);
      if (c && (seen(c) || revealed || c.zone === 'deck' && c.owner === 0)) { r.id = cid(c); r.zone = c.zone; r.owner = c.owner; } else if (c) { r.zone = c.zone; r.owner = c.owner; }
      return r; }) };
}
function newLog() { const out = g.log.slice(logAt); logAt = g.log.length; return out; }
function post() {
  const over = g.winner != null || !g.prompt ? { winner: g.winner, why: g.why } : null;
  for (const ev of buf) logTurn(ev);
  if (!curve.length || curve[curve.length - 1].turn !== g.turnNo || over) { try { curve.push({ turn: g.turnNo, v: AI.evaluate(g, 0) }); } catch (e) { /* skip */ } }
  self.postMessage({ type: 'update', events: buf, view: view(), prompt: over ? null : promptFor0(), over, log: newLog() });
  buf = [];
  if (over) finishReview(); else if (g.prompt && g.prompt.p === 0) reviewSoon();
}
// the computer answers its own prompts, one update per answer so the game can animate each
function runComputer() {
  let guard = 0;
  while (g.prompt && g.prompt.p === 1 && g.winner == null && guard++ < 400) {
    let k;
    try { k = AI.decide(g, 1, level); }
    catch (e) { console.error(e); const o = g.prompt.opts.find(o => ['pass', 'end', 'endbp', 'n'].includes(o.key)) || g.prompt.opts[0]; k = [o.key]; }
    E.act(g, k); post();
  }
}

/* ---------- the review: your choices checked in the background, turns summarised, for hints and the post-match summary ---------- */
const MISTAKE = 900;          // a clear mistake costs at least about one card's worth on the computer's scale (Zack: clear mistakes only)
let lite = false;            // phones: the review runs in slower, smaller steps so it never keeps the processor busy (Zack, 2026-11-25: the phone ran hot)
let pending = [], reviewed = [], turnLog = new Map(), curve = [], acts0 = 0, reviewBusy = false;
const keyEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function optWords(h, keys) { // a plain description of an answer: "Normal Summon Sangan", "Breaker the Magical Warrior attacks Dupe Frog"
  const pr = h.prompt; const k = keys[0]; const o = pr.opts.find(x => x.key === k); if (!o) return keys.join(', ');
  const all = [...h.p[0].hand, ...h.p[0].extra, ...h.p[0].m, ...h.p[0].st, h.p[0].fz, ...h.p[0].gy, ...h.p[1].m, ...h.p[1].st].filter(Boolean);
  const c = o.u != null ? all.find(x => x.u === o.u) : null; const nm = c ? E.name(c) : '';
  if (k === 'pass') return pr.type === 'respond' ? 'not responding' : 'passing';
  if (k === 'end') return 'ending your turn'; if (k === 'endbp') return 'ending the Battle Phase'; if (k === 'bp') return 'going to the Battle Phase';
  if (o.kind === 'atk') return `attacking with ${nm}${o.label.replace(/^Attack/, ':').replace(/^: directly/, ' directly').replace(/^: /, ' into ')}`;
  if (pr.type === 'pick') return keys.map(x => (pr.opts.find(y => y.key === x) || {}).label).filter(Boolean).join(', ');
  return nm && !o.label.includes(nm) ? `${o.label.replace(/: .*$/, '')} ${nm}`.replace(/^Activate /, 'activating ').replace(/^Normal Summon /, 'Normal Summoning ').replace(/^Set face-down /, 'Setting ').replace(/^Set /, 'Setting ') : o.label;
}
function side(h, p) { const P = h.p[p]; return { lp: P.lp, mons: P.m.filter(Boolean).length, sets: P.st.filter(c => c && c.pos === 'set').length + P.m.filter(c => c && c.pos === 'set').length, st: P.st.filter(Boolean).length, hand: P.hand.length,
  atk: P.m.filter(c => c && c.pos !== 'set').reduce((a, c) => a + (E.atk(h, c) || 0), 0) }; }
// why one line beats another, in plain words, from the positions they lead to
function whyBetter(h0, kBest, kOther) {
  const hb = AI.lineState(h0, 0, kBest), ho = AI.lineState(h0, 0, kOther); if (!hb || !ho) return [];
  if (hb.winner === 0 && ho.winner !== 0) return ['it wins the duel right now'];
  const b0 = side(hb, 0), b1 = side(hb, 1), o0 = side(ho, 0), o1 = side(ho, 1), out = [];
  const add = (v, txt) => { if (v > 0) out.push([v, txt]); };
  add((o1.lp - b1.lp) / 1000 * 900, `it deals ${o1.lp - b1.lp} more damage`);
  add((b0.lp - o0.lp) / 1000 * 900, `it saves you ${b0.lp - o0.lp} Life Points`);
  add((o1.mons - b1.mons) * 900, `it removes ${o1.mons - b1.mons === 1 ? 'one more of their monsters' : `${o1.mons - b1.mons} more of their monsters`}`);
  add((o1.sets - b1.sets) * 800, `it clears ${o1.sets - b1.sets === 1 ? 'one of their face-down cards' : `${o1.sets - b1.sets} of their face-down cards`}`);
  add((b0.mons - o0.mons) * 850, `it keeps ${b0.mons - o0.mons === 1 ? 'one more monster' : `${b0.mons - o0.mons} more monsters`} on your field`);
  add((b0.hand - o0.hand) * 700, `it keeps ${b0.hand - o0.hand === 1 ? 'one more card' : `${b0.hand - o0.hand} more cards`} in your hand`);
  add((b0.atk - o0.atk) * 0.4, 'it leaves you a stronger board');
  add((o1.hand - b1.hand) * 600, `it takes ${o1.hand - b1.hand === 1 ? 'a card' : `${o1.hand - b1.hand} cards`} from their hand`);
  return out.sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => x[1]);
}
function replayTo(n) { const h = E.newDuel({ ...g.cfg, quiet: true }); for (let i = 0; i < n; i++) E.act(h, g.history[i], g.pzs && g.pzs[i]); return h; }
function reviewOne(d) {
  const h = replayTo(d.at); if (!h.prompt || h.prompt.p !== 0) return;
  const scores = AI.scoreMoves(h, 0, 'tournament'); if (scores.length < 2) return;
  scores.sort((a, b) => b.v - a.v); const best = scores[0], mine = scores.find(s => keyEq(s.k, d.keys)); if (!mine) return;
  const r = { turn: d.turn, phase: d.phase, type: d.type, did: optWords(h, d.keys) };
  if (!keyEq(best.k, d.keys) && best.v - mine.v >= MISTAKE && best.v < 1e6) { r.mistake = true; r.loss = Math.round(best.v - mine.v); r.better = optWords(h, best.k); r.why = whyBetter(h, best.k, d.keys); }
  else if (keyEq(best.k, d.keys) && !['pass', 'end', 'endbp', 'bp'].includes(d.keys[0]) && scores[1] && best.v - scores[1].v >= MISTAKE && best.v < 1e6) { r.good = true; r.gain = Math.round(best.v - scores[1].v); r.why = whyBetter(h, best.k, scores[1].k); }
  reviewed.push(r);
}
// review in small steps while you think, so the duel never waits on it
function reviewSoon() {
  if (reviewBusy || !pending.length) return; reviewBusy = true;
  setTimeout(() => { try { const d = pending.shift(); if (d) reviewOne(d); } catch (e) { console.error('review', e); } reviewBusy = false; if (pending.length && g && g.prompt && g.prompt.p === 0) reviewSoon(); }, lite ? 600 : 40);
}
function logTurn(ev) { // per-turn tallies for the summary's turning points
  const t = ev.turn; if (!t) return; let L = turnLog.get(t); if (!L) { L = { turn: t, tp: g.tp, dmg: [0, 0], lost: [0, 0], acts: [[], []], summons: [[], []] }; turnLog.set(t, L); }
  if (ev.type === 'damage') L.dmg[ev.p] += ev.n;
  if (ev.type === 'move' && ev.destroyed && ['m', 'st', 'fz'].includes(ev.from)) L.lost[ev.prevCtrl != null ? ev.prevCtrl : ev.owner]++;
  if (ev.type === 'chain') L.acts[ev.p].push(ev.name);
  if (ev.type === 'summon') for (const u of ev.us) { const c = [...g.p[ev.p].m].find(x => x && x.u === u); if (c) L.summons[ev.p].push(E.name(c)); }
}
function summary() {
  const turns = [...turnLog.values()]; const winner = g.winner;
  const mistakes = reviewed.filter(r => r.mistake).sort((a, b) => b.loss - a.loss).slice(0, 5).sort((a, b) => a.turn - b.turn);
  const good = reviewed.filter(r => r.good).sort((a, b) => b.gain - a.gain).slice(0, 3).sort((a, b) => a.turn - b.turn);
  // the turning point: the biggest swing toward the winner in the computer's view of the position
  let turning = null; for (let i = 1; i < curve.length; i++) { const d = curve[i].v - curve[i - 1].v; const toward = winner === 1 ? -d : d; if (!turning || toward > turning.d) turning = { turn: curve[i].turn, d: toward }; }
  const tl = turning && turnLog.get(turning.turn);
  return { winner, why: g.why, turns: g.turnNo, acts: acts0, mistakes, good, reviewedCount: reviewed.length,
    turning: tl ? { turn: tl.turn, tp: tl.tp, dmg: tl.dmg, lost: tl.lost, acts: tl.acts, summons: tl.summons } : null,
    curve: curve.map(c => ({ turn: c.turn, v: Math.round(Math.max(-12000, Math.min(12000, c.v))) })),
    totals: { dealt: turns.reduce((a, t) => a + t.dmg[1], 0), taken: turns.reduce((a, t) => a + t.dmg[0], 0), lostMine: turns.reduce((a, t) => a + t.lost[0], 0), lostTheirs: turns.reduce((a, t) => a + t.lost[1], 0) } };
}
function finishReview() {
  // check anything still waiting, a few at a time, then send the summary
  const step = () => { for (let i = 0; i < 3 && pending.length; i++) { try { reviewOne(pending.shift()); } catch (e) { console.error(e); } }
    if (pending.length) { self.postMessage({ type: 'reviewing', left: pending.length }); setTimeout(step, 0); } else self.postMessage({ type: 'summary', summary: summary() }); };
  step();
}

self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'init') {
      const fmtInfo = f => { const decks = readiness(f); return { decks, scripted: CARDS(f).filter(c => E.scripted(c.n)).map(c => String(c.id)) }; };
      self.postMessage({ type: 'ready', formats: { edison: fmtInfo('edison'), goat: fmtInfo('goat') }, tokens: self.TOKEN_ART });
    } else if (m.type === 'start') {
      fmt = m.format; level = m.level || 'intermediate'; lite = !!m.lite;
      E.init(CARDS(fmt), { format: fmt });
      // a deck is a prebuilt deck's name, or a custom deck {name, main, extra} from the deck builder
      const D = self.FORMATS[fmt].decks; const deck = n => { const d = typeof n === 'string' ? D.find(x => x.name === n) : n; return { name: d.name, main: d.main.map(Number), extra: d.extra.map(Number) }; };
      buf = []; logAt = 0; pending = []; reviewed = []; turnLog = new Map(); curve = []; acts0 = 0;
      g = E.newDuel({ decks: [deck(m.you), deck(m.cpu)], seed: m.seed, first: m.first || 0, names: ['You', 'Computer'], askPos: true, board: m.board || undefined });   // board: a preset position (the ?demo recordings)
      g.hooks = hooks;
      // the opening hands were dealt before the hooks were attached: send them as draws
      for (const p of [0, 1]) for (const c of g.p[p].hand) buf.unshift({ type: 'move', u: c.u, id: p === 0 ? cid(c) : null, from: 'deck', to: 'hand', owner: p, ctrl: p, reason: 'deal', zi: -1 });
      post(); runComputer();
    } else if (m.type === 'act') {
      if (!g || !g.prompt || g.prompt.p !== 0) return;
      // remember your choice for the review (free actions and responses with more than one option)
      acts0++; if ((g.prompt.type === 'idle' || g.prompt.type === 'respond') && g.prompt.opts.length > 1) pending.push({ at: g.history.length, keys: m.keys, turn: g.turnNo, phase: g.phase, type: g.prompt.type });
      E.act(g, m.keys, m.pz || undefined); post(); runComputer();
    } else if (m.type === 'hint') {
      // the best play by Tournament-level checking, and why it beats the next best
      if (!g || !g.prompt || g.prompt.p !== 0) return;
      const scores = AI.scoreMoves(g, 0, 'tournament').sort((a, b) => b.v - a.v); const best = scores[0];
      const o = g.prompt.opts.find(x => x.key === best.k[0]);
      let why = []; try { if (scores[1]) why = whyBetter(g, best.k, scores[1].k); } catch (e) { /* no reason */ }
      self.postMessage({ type: 'hint', keys: best.k, label: o ? o.label : '', words: optWords(g, best.k), why, next: scores[1] ? optWords(g, scores[1].k) : null, u: o && o.u != null ? o.u : null });
    } else if (m.type === 'giveup') {
      if (g && g.winner == null) { g.winner = 1; g.why = 'You gave up.'; finishReview(); }
    }
  } catch (e) {
    console.error(e);
    self.postMessage({ type: 'error', message: String(e && e.message || e), stack: String(e && e.stack || '') });
  }
};
