/* Goat 6: Goat-only scripts for Zorc Turbo, Chaos Return, Economics FTK, Library FTK, Warrior Control, Zombie Turbo, the Stein
 decks, Last Turn, Mataza Rush, Tomato Control, Emissary Beat and Water Return cards.
 Card scripts for js/engine.js (see build/CARD_SCRIPTS.md), registered for Goat only (E.addScripts(obj, 'goat')).
 2026-11-28 audit (E2, stale Goat overrides): every other card this file used to hold now plays its shared script (full-*.js) in
 Goat too, because the shared version matches the 2005 text and Goat rulings and carries later fixes (Dark Paladin's negate
 resolves after it leaves, The Creator's send is part of the effect, Mataza follows its last face-up controller, Dice Re-Roll for
 Zorc and Roulette Barrel, Robbin' Goblin and Serpentine Princess always activate, ...). What stays is where Goat differs. */
(function () {
'use strict';
const E = window.EdisonEngine, L = E.lib;
const { pick, move, ss, damage, addMod, name, onField, faceUp, freeM, opp, log, PN } = L;

E.addScripts({
  /* ----- Economics FTK, Library FTK ----- */
  // Toon Cannon Soldier: no Goat override (E4, 2026-11-28). The Goat pool's own text has the Toon rules, so the shared full-17.js Toon
  // version applies (format text first; EDOPro's Goat script agrees).

  /* ----- Warrior Control ----- */
  // 2005: "If this face-up card is removed from play, Special Summon it during the End Phase of this turn." No once per turn, and
  // "this turn": one banished during the End Phase after that moment doesn't come back next turn (that is the Edison ruling in
  // full-04.js). The position is asked by the engine (cfg.askPos).
  'D.D. Survivor': { effs: [{ type: 'trig', loc: 'ban', mand: true, tags: { ss: 1 }, label: 'Return from banishment',
    on: (g, ev, c) => {
      if (ev.type === 'move' && ev.c === c && ev.to === 'ban' && ev.wasField && ev.snap && ev.snap.faceUp && ev.prevCtrl === c.owner) c.flags.ddsurv = g.turnNo;
      return ev.type === 'phase' && ev.ph === 'end' && c.flags.ddsurv === g.turnNo;
    },
    cond: (g, c) => freeM(g, c.owner) >= 0,
    res: function* (g, c) { if (c.zone === 'ban') ss(g, c.owner, c, 'atk'); } }] },

  /* ----- Zombie Turbo ----- */
  // Goat archive: "When a monster's ATK or DEF are changed by its own effect, like Slate Warrior ..., and Skill Drain is activated,
  // ... the ATK/DEF are returned to normal. Even if Skill Drain is then destroyed, the old adjustment ... does not come back."
  // So its own +500 is an `own` mod (dropped for good when negated); the shared full-27.js gain isn't.
  'Slate Warrior': { effs: [
    { type: 'trig', mand: true, faceDownOk: true, label: '+500 ATK and DEF', on: (g, ev, c) => ev.type === 'flip' && ev.c === c,
      res: function* (g, c) { if (onField(c) && faceUp(c)) { addMod(g, c, { atk: 500, def: 500, own: true }); log(g, `${name(c)} gained 500 ATK and DEF.`); } } },
    { type: 'trig', loc: 'gy', mand: true, label: 'The monster that destroyed it loses 500', on: (g, ev, c) => ev.type === 'move' && ev.c === c && ev.battle && ev.destroyed && ev.wasField && !!ev.killer,
      res: function* (g, c, p, L2) { const k = L2.ev.killer; if (k && onField(k) && faceUp(k)) { addMod(g, k, { atk: -500, def: -500 }); log(g, `${name(k)} lost 500 ATK and DEF.`); } } }] },
}, 'goat');
})();
