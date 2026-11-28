/* Goat 3: Warrior, Zombie, Chaos and beatdown support (batch list build/batches/goat-3.txt).
 Card scripts for js/engine.js (see build/CARD_SCRIPTS.md), registered for Goat only (E.addScripts(obj, 'goat')).
 Written from each card's 2005 (summer Goat format) behavior. Every other card of this batch plays from its shared script
 (js/cards/full-*.js); only the cards whose Goat play differs from the shared script are kept here (2026-11-28 audit, E2). */
(function () {
'use strict';
const E = window.EdisonEngine, L = E.lib;
const { destroy, damage, isMon, onField, race, baseAtk, opp, battleKill } = L;

const foeOf = (g, c) => (g.battle ? (g.battle.a === c ? g.battle.t : g.battle.t === c ? g.battle.a : null) : null);
// "Destroy that monster" at a battle moment
const killFoe = (g, c, p, t) => { if (t && onField(t) && t.zone === 'm') destroy(g, [t], { by: p, src: c }); };

E.addScripts({
  // Kept over full-14.js: that one needs Kokki in the Monster Zone or GY, but Goat's Dark Magician of Chaos banishes it instead
  // of sending it to the GY, and the ruling has Kokki still destroy Dark Magician of Chaos then. loc 'any' (2026-11-26 review).
  'Ryu Kokki': { effs: [{ type: 'trig', loc: 'any', mand: true, tags: { destroy: 1 }, label: 'Destroy the Warrior or Spellcaster',
    on: (g, ev, c) => ev.type === 'dsEnd' && (ev.a === c || ev.t === c) && (() => { const o = ev.a === c ? ev.t : ev.a; return !!o && onField(o) && ['Warrior', 'Spellcaster'].includes(race(o)); })(),
    res: function* (g, c, p, L2) { killFoe(g, c, p, L2.ev.a === c ? L2.ev.t : L2.ev.a); } }] },
  // Kept over full-07.js: Goat's text reads "the ATK of the destroyed monster in the Graveyard", so no damage once it has left the
  // GY (EDOPro: the destroyed monster must still be in the GY). Its original ATK; a Fusilier Summoned without Tribute counts 1400
  // (archive ruling 4: its halved original ATK, read from the move's snapshot since the flags reset in the GY).
  // Its summoning condition comes from its text (engine, Group B).
  'Elemental HERO Flame Wingman': {
    effs: [{ type: 'trig', mand: true, label: 'Damage equal to its ATK', on: (g, ev, c) => battleKill(ev, c) && ev.prevCtrl !== c.ctrl,
      res: function* (g, c, p, L2) { const t = L2.ev.c; if (t.zone !== 'gy' || !isMon(t)) return;
        const f = L2.ev.snap && L2.ev.snap.flags, n = f && f.baseAtk != null && !f.ownBaseAtk ? f.baseAtk : baseAtk(t);
        damage(g, opp(p), n, { src: c, srcP: p }); } }] },
  // No shared script. The +2000 applies during damage calculation only (E.lib.dcalc, 2026-11-28 audit).
  'Cipher Soldier': {
    self: { atk: (g, c) => cipher(g, c), def: (g, c) => cipher(g, c) },
    effs: [] },
}, 'goat');

function cipher(g, c) { const o = foeOf(g, c); return E.lib.dcalc(g) && o && race(o) === 'Warrior' ? 2000 : 0; }
})();
