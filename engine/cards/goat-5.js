/* Goat 5: Goat-only scripts for Water Return, Drain Burn, Gearfried, Flip Control, Emissary Beat, Tiger Stun, Bazoo Return,
 Soul Control, Stein Horus and Last Turn cards. Card scripts for js/engine.js (see build/CARD_SCRIPTS.md), registered for Goat only
 (E.addScripts(obj, 'goat')).
 2026-11-28 audit (E2, stale Goat overrides): every card here that has a shared script (full-*.js) now plays that one in Goat too,
 because the shared versions match the 2005 text and Goat rulings and carry later fixes (Aqua Spirit, Lekunga, Dark Flare Knight,
 King Dragun, Magic Jammer, Gearfried, Smoke Grenade of the Thief, Golem Sentry, Mask of Darkness, Emissary of the Afterlife,
 Back to Square One, Light of Intervention, Cliff the Trap Remover, Kuriboh, Token Thanksgiving, Catapult Turtle and the plain
 Fusions). Only cards with no shared script stay. */
(function () {
'use strict';
const E = window.EdisonEngine;

E.addScripts({
  // A Fusion Monster with no effect: the engine reads its materials from the first line of its text.
  'Black Skull Dragon': { effs: [] },
}, 'goat');
})();
