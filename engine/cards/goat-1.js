/* Goat 1: the four tier A Goat decks (Goat Control, Chaos Turbo, Thunder Dragon Chaos Control, Chaos Control).
 Card scripts for js/engine.js (see build/CARD_SCRIPTS.md), registered for Goat only (E.addScripts(obj, 'goat')),
 so they win over the shared Edison SCRIPTS of the same name while Goat is loaded and Edison never sees them.
 Only cards whose 2005 (summer Goat format) behavior differs from the shared script are kept here; every other card of these decks
 plays its shared script (2026-11-28 stale-override check: Airknight Parshath, Asura Priest, Dark Mimic LV1/LV3, Magician of Faith,
 Sinister Serpent, Tribe-Infecting Virus, Tsukuyomi, Skilled White Magician, Buster Blader, Delinquent Duo, Graceful Charity,
 Pot of Greed, Metamorphosis, Snatch Steal, Sakuretsu Armor and Kycoo the Ghost Destroyer were dropped: the shared scripts match
 their Goat texts and rulings, with the later audit fixes). */
(function () {
'use strict';
const E = window.EdisonEngine, L = E.lib;
const { pick, tgt, move, destroy, damage, name, D, isMon, onField, faceUp, attr, monsOf, allField, fieldMons, freeST,
  shuffleDeck, log, PN, live, opp, forbid, stat, addRule } = L;

const named = (c, n) => D(c).n === n;
// "If this card destroys an opponent's monster by battle" (no "and sends it to the GY")
const killedByBattle = (ev, c) => ev.type === 'move' && ev.battle && ev.destroyed && ev.killer === c && ev.prevCtrl !== c.ctrl;
// Chaos Sorcerer style summon: banish 1 LIGHT and 1 DARK monster from your GY.
const chaosProc = { label: 'Special Summon (banish a LIGHT and a DARK)',
  cond: (g, c, p) => g.p[p].gy.some(x => isMon(x) && attr(x) === 'LIGHT') && g.p[p].gy.some(x => isMon(x) && attr(x) === 'DARK'),
  cost: function* (g, c, p, grp) {
    const [l] = yield* pick(g, p, 'Banish a LIGHT monster from your GY', g.p[p].gy.filter(x => isMon(x) && attr(x) === 'LIGHT'), 1, 1, 'cost');
    const [d] = yield* pick(g, p, 'Banish a DARK monster from your GY', g.p[p].gy.filter(x => isMon(x) && attr(x) === 'DARK'), 1, 1, 'cost');
    for (const x of [l, d]) if (x) move(g, x, 'ban', { reason: 'cost', group: grp });
    log(g, `${PN(g, p)} banished ${[l, d].filter(Boolean).map(name).join(' and ')}.`);
  } };
// Thousand-Eyes Restrict / Relinquished: the monster equipped to this card (it sits in a Spell/Trap Zone as an Equip Card).
const eyeEquip = (g, c) => allField(g).find(x => x.zone === 'st' && isMon(x) && x.equipTo === c.u) || null;
// a face-down monster equipped this way gives 0 ATK/DEF (as full-17.js; EDOPro, goat-08 finding)
const eqStat = (g, e, which) => e.flags.fdEquip ? 0 : stat(g, e, which);
const absorb = { type: 'ign', opt: true, label: 'Equip an opponent’s monster',
  cond: (g, c, p) => !eyeEquip(g, c) && freeST(g, p) >= 0 && monsOf(g, opp(p)).length > 0,
  target: function* (g, c, p, L2) { yield* tgt(g, p, L2, 'Equip which of their monsters to this card?', monsOf(g, opp(p)), 1, 1, 'bad'); },
  res: function* (g, c, p, L2) {
    // gone if the target came back to this card's controller in the chain (Remove Brainwashing: archive), or this card left or turned face-down
    const t = live(L2)[0]; if (!t || t.zone !== 'm' || t.ctrl === p || !onField(c) || !faceUp(c) || eyeEquip(g, c) || freeST(g, p) < 0) return;
    const nm = D(t).n, fd = t.pos === 'set'; move(g, t, 'st', { ctrl: p, pos: 'up', reason: 'equip', by: p });
    t.equipTo = c.u; t.flags.negated = true; if (fd) t.flags.fdEquip = true;   // an Equip Card now: its monster effects don't apply
    log(g, `${nm} was equipped to ${name(c)}.`);
  } };
const absorbSelf = (refl) => ({
  atk: (g, c) => { const e = eyeEquip(g, c); return e ? eqStat(g, e, 'atk') : 0; },
  def: (g, c) => { const e = eyeEquip(g, c); return e ? eqStat(g, e, 'def') : 0; },
  // "If this card would be destroyed by battle, destroy the equipped monster instead."
  replaceDestroy: (g, c, o) => { if (!o.battle) return false; const e = eyeEquip(g, c); if (!e) return false;
    // Relinquished (2005): the battle damage its controller took in this battle is dealt to the opponent too, only in this case
    if (refl && c.flags.relDmg && c.flags.relDmg.b === g.battle && c.flags.relDmg.n > 0) c.flags.relRefl = { u: e.u, n: c.flags.relDmg.n };
    destroy(g, [e], { quietLog: false }); log(g, `${name(c)} survived: the equipped monster was destroyed instead.`); return true; },
});
// Relinquished's reflection (2005 errata: "If this card is destroyed as a result of battle, the equipped monster is destroyed instead, and
// any battle damage you received from the battle is also inflicted to your opponent's Life Points"). Archive: ONLY when the equipped
// monster is destroyed instead (1800 ATK Relinquished into a 3000 DEF monster: 1200 to you, none to them). A Trigger Effect (Barrel
// Behind the Door can answer it). The shared batch-7.js script follows Edison's text (any battle damage while equipped).
const reflect = [
  { type: 'trig', res: function* () {}, on: (g, ev, c) => { if (ev.type === 'damage' && ev.battle && ev.p === c.ctrl && g.battle && (g.battle.a === c || g.battle.t === c)) c.flags.relDmg = { b: g.battle, n: ev.n }; return false; } },
  { type: 'trig', mand: true, label: 'Inflict the same damage to the opponent', on: (g, ev, c) => ev.type === 'move' && ev.destroyed && !!c.flags.relRefl && ev.c.u === c.flags.relRefl.u,
    res: function* (g, c, p) { const r = c.flags.relRefl; c.flags.relRefl = null; if (r && r.n > 0) damage(g, opp(p), r.n, { src: c, srcP: p }); } }];

E.addScripts({
  /* ----- monsters ----- */
  // Kept: it can banish itself whatever else is on the field (ruling; full-03.js only offers itself when it is the only monster), and the
  // attack lock is a lingering rule set on activation, so a chained Skill Drain (which negates the effect, not the activation) keeps it
  // (ruling 4); a negated activation (Divine Wrath) lifts it. Revival only after a proper summon: the engine reads "Must first be".
  'Black Luster Soldier - Envoy of the Beginning': { proc: chaosProc,
    // "Once per turn, you can activate 1 of these effects": one shared use (c.flags.envoyUsed).
    effs: [{ type: 'ign', label: 'Banish a monster', tags: {},
      // not after it declared an attack this turn, even a negated one (rulings)
      cond: (g, c, p) => c.flags.envoyUsed !== g.turnNo && !c.declared && fieldMons(g).length > 0,
      target: function* (g, c, p, L2) { yield* tgt(g, p, L2, 'Banish which monster?', fieldMons(g), 1, 1, 'bad'); },
      after: (g, c, p, L2) => { c.flags.envoyUsed = g.turnNo; const tok = {}; c.flags.envoyTok = tok;
        // c.flags clear when it leaves the field or turns face-down, which ends the lock (ruling 5: a new card)
        addRule(g, (g2, a) => a.type === 'attack' && a.c === c && c.flags.envoyTok === tok, { end: g.turnNo }); },
      res: function* (g, c, p, L2) { const t = live(L2)[0]; if (t && t.zone === 'm') { const n = D(t).n; move(g, t, 'ban', { reason: 'effect', by: p }); log(g, `${n} was banished.`); } } },
    { type: 'trig', label: 'Attack again', on: (g, ev, c) => killedByBattle(ev, c) && !!g.battle && g.battle.a === c,
      cond: (g, c) => c.flags.envoyUsed !== g.turnNo && onField(c),
      after: (g, c) => { c.flags.envoyUsed = g.turnNo; },
      res: function* (g, c) { if (onField(c) && faceUp(c)) { c.flags.extraAttack = g.turnNo; log(g, `${name(c)} can make a second attack in a row.`); } } }] },
  // Kept: Netrep "may be discarded to search for 0" (full-17.js needs one in the Deck): a LIGHT in the GY for the Chaos monsters.
  'Thunder Dragon': { effs: [{ type: 'ign', loc: 'hand', label: 'Discard: add 2 Thunder Dragon',
    cond: (g, c, p) => !forbid(g, { type: 'search', p }),
    cost: function* (g, c, p) { move(g, c, 'gy', { reason: 'discard' }); log(g, `${PN(g, p)} discarded Thunder Dragon.`); },
    res: function* (g, c, p) { if (forbid(g, { type: 'search', p })) return; const cs = g.p[p].deck.filter(x => named(x, 'Thunder Dragon')); const xs = yield* pick(g, p, 'Add up to 2 Thunder Dragon to your hand', cs, 0, 2, 'good'); for (const x of xs) move(g, x, 'hand', { reason: 'effect' }); if (xs.length) log(g, `${PN(g, p)} added ${xs.length} Thunder Dragon to the hand.`); shuffleDeck(g, p); } }] },
  // Kept: a Flip Summon is a position change too (ruling: positions "may not be manually changed"); full-17.js doesn't stop it.
  'Thousand-Eyes Restrict': { self: absorbSelf(false),
    // "Other monsters on the field cannot change their battle positions or attack."
    cont: { forbid: (g, src, a) => (a.type === 'attack' || a.type === 'pos' || a.type === 'flip') && a.c !== src },
    effs: [absorb] },
  // Kept: battle protection as a replacement and the 2005 reflection rule (above); batch-7.js reflects any battle damage (Edison text).
  'Relinquished': { self: absorbSelf(true), effs: [absorb, ...reflect] },

  /* ----- Traps ----- */
  // Kept: 2005 "Destroy 1 face-up monster and inflict damage to both players equal to its ATK." Either turn, either side, no limit,
  // its current ATK (full-13.js is Edison's text: the opponent's turn and monster, once per turn). Not in the Damage Step (engine).
  'Ring of Destruction': { effs: [{ type: 'act', tags: { destroy: 1 }, cond: g => fieldMons(g).some(faceUp),
    target: function* (g, c, p, L2) { yield* tgt(g, p, L2, 'Destroy which face-up monster?', fieldMons(g).filter(faceUp), 1, 1, 'bad'); },
    res: function* (g, c, p, L2) { const t = live(L2)[0]; if (!t || !faceUp(t)) return; const n = stat(g, t, 'atk');
      if (!destroy(g, [t], { by: p, src: c }).length || n <= 0) return;
      L.damageMany(g, [[opp(p), n], [p, n]], { src: c, srcP: p }); } }] },   // both at once, through the damage statics (Des Wombat)
}, 'goat');
})();
