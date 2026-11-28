/* Goat 2: the four tier B Goat decks (Burn, Lockdown Burn, Empty Jar, Reasoning Gate).
 Card scripts for js/engine.js (see build/CARD_SCRIPTS.md), registered for Goat only (E.addScripts(obj, 'goat')).
 Only cards whose 2005 (summer Goat format) behavior differs from the shared script are kept here; every other card of these decks
 plays its shared script (2026-11-28 stale-override check: Big Shield Gardna, Cyber Jar, Des Koala, Giant Germ, Ceasefire,
 Desert Sunlight, Just Desserts, Ojama Trio, Secret Barrel, Lava Golem, Stealth Bird, Swords of Revealing Light, Wave-Motion Cannon,
 A Feather of the Phoenix, Book of Taiyou, Premature Burial, Serial Spell, Reload, The Shallow Grave, Spell Reproduction,
 Blowback Dragon, Jinzo, Magical Marionette, Sacred Crane, Dimension Fusion, Monster Gate and Reasoning were dropped: the shared
 scripts match their Goat texts and rulings, with the later audit fixes). Cards these decks share with tier A are in goat-1.js. */
(function () {
'use strict';
const E = window.EdisonEngine, L = E.lib;
const { tgt, move, name, isSpell, log, PN, evSummoned } = L;

E.addScripts({
  // Kept. 2005: "When this card is Normal or Special Summoned, you can add 1 Spell from your GY to your hand during the End Phase.
  // When this card destroys a monster by battle, remove that monster from play. If this card would leave the field, remove it from play instead."
  'Dark Magician of Chaos': { effs: [
    // a summon trigger (archive errata and rulings, findings goat-03 (1); 2026-11-28 audit, E4c): "When this card is Normal Summoned or
    // Special Summoned, you can add 1 Spell Card from your Graveyard to your hand"; it can miss the timing; the Spell is a target
    { type: 'trig', when: true, label: 'Add a Spell from the GY', on: (g, ev, c) => evSummoned(ev, c) && ev.how !== 'flip',
      cond: (g, c, p) => g.p[p].gy.some(isSpell),
      target: function* (g, c, p, L2) { yield* tgt(g, p, L2, 'Add which Spell from your GY to your hand?', g.p[p].gy.filter(isSpell), 1, 1, 'good'); },
      res: function* (g, c, p, L2) { const t = L2.t[0]; if (t && t.zone === 'gy') { move(g, t, 'hand', { reason: 'effect' }); log(g, `${PN(g, p)} added ${name(t)} to the hand.`); } } },
  ],
    // 2005 text: "A monster that is destroyed by this monster as a result of battle is removed from play instead of going to the Graveyard":
    // a replacement (engine damageStep, self.battleBanish), so it never reaches the GY (2026-11-28 audit: Sangan searched; equal ATK, both banished).
    // full-05.js follows Edison's text (banish from the field after damage calculation). "If this card would leave the field, remove it
    // from play instead": self.banishLeave, read in move() while it is face-up (not stopped by Skill Drain, ruling 18).
    self: { battleBanish: true, banishLeave: true } },
}, 'goat');
})();
