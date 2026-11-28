/* Goat 4: the Metamorphosis Fusion Deck, Ben Kei OTK, Stall Burn and the singles of build/batches/goat-4.txt. Card scripts for
 js/engine.js (see build/CARD_SCRIPTS.md), registered for Goat only (E.addScripts(obj, 'goat')). Each card follows its summer
 2005 behavior. Every other card of this batch plays from its shared script (js/cards/full-*.js); only the cards with no shared
 script, or whose Goat play differs from it, are kept here (2026-11-28 audit, E2). */
(function () {
'use strict';
const E = window.EdisonEngine, L = E.lib;
const { pick, move, destroy, damage, equip, name, D, isMon, isTrap, onField, faceUp, monsOf, fieldMons, tgt, log, PN, live, opp,
  fromFieldToGY } = L;

const isFlipMon = c => isMon(c) && (!!D(c).flip || /Flip/.test(D(c).ab || ''));
// Negate the effect of a chain link (the card still resolves as negated; destroyIt also destroys the card).
function negLink(g, T, p, destroyIt) { if (!T || T.negated) return; T.negated = true; T.negBy = p; log(g, `${name(T.c)}'s effect was negated.`); if (destroyIt && onField(T.c)) destroy(g, [T.c], { by: p }); }
// An Equip Spell: target a face-up monster (filter), equip it at resolution. Bonuses go in the card's cont.
const equipAct = (filter = () => true, text = 'Equip to which face-up monster?') => ({ type: 'act',
  cond: g => fieldMons(g).some(m => faceUp(m) && filter(m)),
  target: function* (g, c, p, L2) { yield* tgt(g, p, L2, text, fieldMons(g).filter(m => faceUp(m) && filter(m)), 1, 1, 'good'); },
  res: function* (g, c, p, L2) { const t = live(L2)[0]; if (t && faceUp(t) && filter(t) && onField(c)) { equip(g, c, t); c.flags.eqU = t.u; } } });
const eqBonus = (a, d) => ({ atk: (g, src, m) => src.equipTo === m.u ? a : 0, def: (g, src, m) => src.equipTo === m.u ? d : 0 });
// "Negate any Trap/Spell effects that target this card": offered as a response to the link that targets it.
// ENGINE: continuous negation of a targeting card isn't automatic (no hook when a link picks its targets), so the
// controller uses it as an optional response at Spell Speed 3. PARTIAL: optional, and it is a chain link here.
const negTargeting = (isKind, label) => ({ type: 'quick', speed: 3, ds: true, label,
  cond: (g, c, p, x) => { const t = x.top; return !!(t && !t.negated && isKind(t.c) && t.c !== c && (t.t || []).includes(c) && faceUp(c)); },
  target: function* (g, c, p, L2) { L2.data.L = g.chain[g.chain.length - 1]; },
  res: function* (g, c, p, L2) { negLink(g, L2.data.L, p, true); } });
// Barrel Behind the Door: does this link's card text inflict effect damage? (battle-damage sentences are left out)
const burnText = c => { const t = (D(c).tx || '').replace(/[^.]*battle damage[^.]*\.?/gi, ''); return /inflict[^.]*damage|damage to (both|each|your)|takes? [^.]*damage/i.test(t); };

E.addScripts({
  // No shared script. "Negate the effects of Flip Effect Monsters. Negate any Trap effects that target this card on the field,
  // and if you do, destroy that Trap Card."
  'Fiend Skull Dragon': { cont: { negates: (g, src, c) => isFlipMon(c) },
    effs: [negTargeting(isTrap, 'Negate the Trap targeting it')] },

  // No shared script. "When this card is sent from the field to the Graveyard: You can Tribute 1 monster; place this card on the top of your Deck."
  'Axe of Despair': { cont: eqBonus(1000, 0), effs: [equipAct(),
    { type: 'trig', loc: 'gy', when: true, label: 'Tribute 1 monster: put it on top of the Deck',
      on: (g, ev, c) => fromFieldToGY(ev, c), cond: (g, c, p) => c.zone === 'gy' && monsOf(g, p).length > 0,
      cost: function* (g, c, p) { const [x] = yield* pick(g, p, 'Tribute 1 monster', monsOf(g, p), 1, 1, 'cost'); if (x) { const nm = x.pos === 'set' ? 'a face-down monster' : name(x); move(g, x, 'gy', { reason: 'tribute', by: p }); log(g, `${PN(g, p)} Tributed ${nm}.`); } },
      res: function* (g, c, p) { if (c.zone === 'gy') { move(g, c, 'deckTop', { reason: 'effect' }); log(g, 'Axe of Despair was put on top of the Deck.'); } } }] },

  // Kept over full-19.js, which only answers the opponent's links: Netrep "Barrel Behind the Door may be chained to your own effect
  // that inflicts Damage to you". Ported from full-19.js: not against a Continuous, Equip or Field card (ruling), and not against
  // another Barrel Behind the Door (ruling: it transfers damage, it doesn't inflict it). While that link resolves, damage to you
  // goes to the opponent.
  // PARTIAL: it doesn't check that the damage is certain or that it hits you (Dice Jar, Time Wizard, a burn to the opponent only).
  // Ring of Destruction's damage to its target's controller is dealt directly (goat-1.js), so it can't be turned around.
  'Barrel Behind the Door': {
    cont: { loc: 'gy', dmg: (g, src, p, n, o) => { if (o.barrel || !o.src || !g.barrel) return; const b = g.barrel.find(x => x.by === src.u && x.p === p && x.u === o.src.u); if (!b) return;
      log(g, `Barrel Behind the Door turned the damage around.`); damage(g, opp(p), n, { ...o, barrel: true }); return 0; } },
    effs: [{ type: 'act',
      cond: (g, c, p, x) => { const t = x.top; return !!(t && !t.negated && t.c !== c && D(t.c).n !== 'Barrel Behind the Door' && burnText(t.c) && !['Continuous', 'Equip', 'Field'].includes(D(t.c).sub || '')); },
      target: function* (g, c, p, L2) { L2.data.L = g.chain[g.chain.length - 1]; },
      res: function* (g, c, p, L2) { const T = L2.data.L; if (!T || T.negated) return; const res0 = T.eff.res, entry = { by: c.u, p, u: T.c.u };
        T.eff = { ...T.eff, res: function* (g2, c2, p2, L3) { (g2.barrel || (g2.barrel = [])).push(entry); try { yield* res0(g2, c2, p2, L3); } finally { g2.barrel = g2.barrel.filter(x => x !== entry); } } };
        log(g, `${PN(g, opp(p))} will take that damage instead.`); } }] },
}, 'goat');
})();
