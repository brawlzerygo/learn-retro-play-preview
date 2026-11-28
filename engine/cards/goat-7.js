/* Goat 7: Clown Control, Heavy Slump, Stein Gate Turbo, Last Turn, Library FTK, Monarch, Earth Beat, Drain Beat,
 Cat OTK, Cat Burn, Stein Horus, Stein OTK, Panda Burn, Bazoo Burn and the other decks that share these cards.
 Card scripts for js/engine.js (see build/CARD_SCRIPTS.md), registered for Goat only (E.addScripts(obj, 'goat')).
 Only the cards whose 2005 (summer Goat format) behavior differs from the shared script are here; every other card of these decks
 uses its shared script (2026-11-28 stale-override check, E2: 33 overrides dropped). Coin calls are a fair coin. */
(function () {
'use strict';
const E = window.EdisonEngine, L = E.lib;
const { pick, choose, destroy, ss, name, D, isMon, isExtraD, onField, baseAtk, freeM, shuffleDeck, log, PN } = L;

const coin = g => g.rnd() < 0.5; // true: the call was right
// Last Will's monster: 1500 or less ATK, from the Deck; whether it can be Special Summoned is the engine's canSS (summoning conditions
// read from the text, Jowgen and the other locks), so Toon Mermaid under Toon World is fine (Goat archive).
const lwFrom = c => isMon(c) && !isExtraD(D(c)) && !['ritual', 'token'].includes(D(c).k) && baseAtk(c) <= 1500;
const lwState = (g, c) => g.lw7 && g.lw7[c.u];

E.addScripts({
  // PARTIAL: the coin is tossed at the start of the Damage Step (the engine has no trigger point right before damage calculation);
  // the result is the same: the other monster is destroyed before damage is calculated.
  'Sasuke Samurai #4': { effs: [{ type: 'trig', mand: true, faceDownOk: true, tags: { destroy: 1 }, label: 'Toss a coin',
    on: (g, ev, c) => ev.type === 'dsStart' && ev.t && (ev.a === c || ev.t === c),
    res: function* (g, c, p, L2) { const o = L2.ev.a === c ? L2.ev.t : L2.ev.a; if (!onField(c) || !o || !onField(o)) return;
      const right = coin(g); log(g, `${PN(g, p)} called the coin ${right ? 'right' : 'wrong'}.`); if (right) destroy(g, [o], { by: p }); } }] },

  // The no-Tribute Summon or Set makes its original ATK 1400 and DEF 1000 (rulings: Megamorph then makes it 2800 or 700, so the halving is
  // its original ATK, c.flags.baseAtk; turned face-down and flipped again it is 2800/2000). Its own effect: once Skill Drain (or any
  // negation) applies it is 2800/2000, and it stays 2800/2000 after Skill Drain leaves (ruling 5): ownBaseAtk, which the engine drops
  // for good on negation (dropOwnWhenNegated), and the DEF half reads it.
  // tributes returns [0], not 0: the engine skips a bare 0 as no alternative.
  'Fusilier Dragon, the Dual-Mode Beast': {
    self: { tributes: () => [0], def: (g, c) => c.flags.fusHalf && c.flags.ownBaseAtk ? -1000 : 0 },
    effs: [{ type: 'trig', faceDownOk: true, on: (g, ev, c) => {
      if (((ev.type === 'summon' && ev.cs.includes(c) && ev.how === 'normal') || (ev.type === 'set' && ev.c === c)) && !(c.tributes || []).length) {
        c.flags.baseAtk = 1400; c.flags.ownBaseAtk = true; c.flags.fusHalf = true; }
      return false; }, res: function* () {} }] },

  // 2005 (Goat archive, Netrep, judge list): Last Will is activated before the monster goes; it summons nothing on resolution and creates
  // a state for this turn. The next time a monster of yours goes from your field to your GY (not a Token), a mandatory trigger lets you
  // Special Summon 1 monster with 1500 or less ATK from your Deck, then shuffle; the state ends then (used or declined) or at the end of
  // the turn. Each Last Will is its own state (2 Last Wills, 2 summons). It works in the Battle Phase and End Phase. Imperial Order
  // after it resolved doesn't stop the state (the trigger is in the GY); under Jowgen it can be activated but summons nothing.
  // The state lives in g.lw7 by card (turn and player); a watcher in any zone notes the monster, and the trigger fires from the GY,
  // at once or as Last Will itself reaches the GY at the end of its chain.
  'Last Will': { effs: [
    { type: 'act', res: function* (g, c, p) { (g.lw7 || (g.lw7 = {}))[c.u] = { t: g.turnNo, p }; log(g, `Last Will: the next time ${PN(g, p)}'s monster goes from the field to the GY this turn, ${PN(g, p)} may Special Summon a monster with 1500 or less ATK from the Deck.`); } },
    { type: 'trig', loc: 'any', on: (g, ev, c) => { const s = lwState(g, c);
      if (s && s.t === g.turnNo && !s.hit && ev.type === 'move' && ev.wasField && ev.to === 'gy' && ev.snap && ev.snap.mon && ev.prevCtrl === s.p && ev.c.owner === s.p) s.hit = true;
      return false; }, res: function* () {} },
    { type: 'trig', loc: 'gy', mand: true, tags: { ss: 1 }, label: 'Special Summon a monster with 1500 or less ATK',
      on: (g, ev, c) => { const s = lwState(g, c); if (!s || s.t !== g.turnNo || !s.hit || s.fired) return false; s.fired = true; return true; },
      res: function* (g, c, p) { const s = lwState(g, c); const q = s ? s.p : p; if (s) delete g.lw7[c.u];
        const cs = freeM(g, q) >= 0 ? g.p[q].deck.filter(x => lwFrom(x) && L.canSS(g, q, x)) : [];
        if (cs.length) { const [x] = yield* pick(g, q, 'Special Summon a monster with 1500 or less ATK from your Deck? (none is fine)', cs, 0, 1, 'good');
          if (x) { const i = yield* choose(g, q, `${name(x)}: which position?`, ['Attack Position', 'Defense Position']); ss(g, q, x, i ? 'def' : 'atk'); } }
        shuffleDeck(g, q); } }] },
}, 'goat');
})();
