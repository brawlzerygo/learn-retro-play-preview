/* Goat 1: the four tier A Goat decks (Goat Control, Chaos Turbo, Thunder Dragon Chaos Control, Chaos Control).
 Card scripts for js/engine.js (see build/CARD_SCRIPTS.md), registered for Goat only (E.addScripts(obj, 'goat')),
 so they win over the shared Edison SCRIPTS of the same name while Goat is loaded and Edison never sees them.
 Each card is written from its 2005 (summer Goat format) behavior, not today's text in goat/data/cards.js:
 Ring of Destruction and Sinister Serpent have no once-per-turn limits (goat/data/lessons-101.js), and so on.
 Thousand-Eyes Restrict is here for Metamorphosis (the guide lists keep it in the Fusion Deck). */
(function () {
'use strict';
const E = window.EdisonEngine, L = E.lib;
const { pick, tgt, yn, choose, move, destroy, ss, draw, damage, gain, pay, search, takeControl, setFaceDown, addMod,
  addCtr, ctr, addRule, name, D, isMon, isSpell, isST, onField, faceUp, attr, race, lv, baseAtk, monsOf, stOf, allField,
  fieldMons, freeM, freeST, nFreeM, allCards, shuffleDeck, log, PN, live, opp, oppFaceUp, emit, forbid, stat } = L;

const named = (c, n) => D(c).n === n;
const discardRandom = (g, p) => { const h = g.p[p].hand; if (!h.length) return null; const x = h[Math.floor(g.rnd() * h.length)]; move(g, x, 'gy', { reason: 'discard' }); log(g, `${PN(g, p)} discarded ${name(x)} at random.`); return x; };
function* discardPick(g, p, n, text) { const h = g.p[p].hand; if (!h.length) return []; const xs = yield* pick(g, p, text, h, Math.min(n, h.length), Math.min(n, h.length), 'cost'); for (const x of xs) move(g, x, 'gy', { reason: 'discard' }); if (xs.length) log(g, `${PN(g, p)} discarded ${xs.map(name).join(', ')}.`); return xs; }
// "Cannot be Special Summoned": blocks a revival from the GY (Call of the Haunted, Premature Burial), the only way these decks could try.
// PARTIAL: one cont per card, so it works from the GY only (the engine has no single "can't be Special Summoned" flag yet, build/ENGINE_TODO.md).
const noSSFromGY = { loc: 'gy', forbid: (g, src, a) => a.type === 'ss' && a.c === src };
// Spirit-style return: "During the End Phase of the turn this card is Normal Summoned or flipped face-up: return it to the hand."
// The summon or flip is noted on the card (flags clear when it leaves the field or is turned face-down).
const spiritReturn = { type: 'trig', mand: true, label: 'Return to the hand',
  on: (g, ev, c) => {
    if ((ev.type === 'summon' && ev.cs.includes(c) && ['normal', 'tribute'].includes(ev.how)) || (ev.type === 'flip' && ev.c === c)) c.flags.spirit = g.turnNo;
    return ev.type === 'phase' && ev.ph === 'end' && c.flags.spirit === g.turnNo;
  },
  res: function* (g, c, p) { if (onField(c) && faceUp(c)) { move(g, c, 'hand', { reason: 'effect' }); log(g, `${name(c)} returned to the hand.`); } } };
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
const absorb = { type: 'ign', opt: true, label: 'Equip an opponent’s monster',
  cond: (g, c, p) => !eyeEquip(g, c) && freeST(g, p) >= 0 && monsOf(g, opp(p)).length > 0,
  target: function* (g, c, p, L2) { yield* tgt(g, p, L2, 'Equip which of their monsters to this card?', monsOf(g, opp(p)), 1, 1, 'bad'); },
  res: function* (g, c, p, L2) {
    const t = live(L2)[0]; if (!t || t.zone !== 'm' || !onField(c) || eyeEquip(g, c) || freeST(g, p) < 0) return;
    const nm = D(t).n; move(g, t, 'st', { ctrl: p, pos: 'up', reason: 'equip', by: p });
    t.equipTo = c.u; t.flags.negated = true; // an Equip Card now: its monster effects don't apply
    log(g, `${nm} was equipped to ${name(c)}.`);
  } };
const absorbSelf = {
  atk: (g, c) => { const e = eyeEquip(g, c); return e ? stat(g, e, 'atk') : 0; },
  def: (g, c) => { const e = eyeEquip(g, c); return e ? stat(g, e, 'def') : 0; },
  // "If this card would be destroyed by battle, destroy the equipped monster instead."
  replaceDestroy: (g, c, o) => { if (!o.battle) return false; const e = eyeEquip(g, c); if (!e) return false; destroy(g, [e], { quietLog: false }); log(g, `${name(c)} survived: the equipped monster was destroyed instead.`); return true; },
};

E.addScripts({
  /* ----- monsters ----- */
  'Airknight Parshath': { self: { piercing: true },
    effs: [{ type: 'trig', mand: true, label: 'Draw 1 card', on: (g, ev, c) => ev.type === 'damage' && ev.battle && ev.src === c && ev.p !== c.ctrl,
      res: function* (g, c, p) { draw(g, p, 1); } }] },
  // 2005: Spirit-like return, attacks every opponent's monster once each (engine hooks self.maxAttacks / self.attackOk).
  'Asura Priest': { cont: noSSFromGY,
    self: L.attackEach,   // each monster once; no attack after a direct one (ruling)
    effs: [spiritReturn] },
  'Black Luster Soldier - Envoy of the Beginning': { proc: chaosProc,
    self: { cantAttack: (g, c) => c.flags.envoyBanish === g.turnNo && !(c.flags.envoyL && c.flags.envoyL.actNegated) },   // no lock if the activation was negated (Divine Wrath)
    // "Once per turn, you can activate 1 of these effects": one shared use (c.flags.envoyUsed).
    effs: [{ type: 'ign', label: 'Banish a monster', tags: {},
      // it can banish itself, and not after it declared an attack this turn, even a negated one (rulings)
      cond: (g, c, p) => c.flags.envoyUsed !== g.turnNo && !c.declared && fieldMons(g).length > 0,
      target: function* (g, c, p, L2) { yield* tgt(g, p, L2, 'Banish which monster?', fieldMons(g), 1, 1, 'bad'); },
      after: (g, c, p, L2) => { c.flags.envoyUsed = g.turnNo; c.flags.envoyBanish = g.turnNo; c.flags.envoyL = L2; },
      res: function* (g, c, p, L2) { const t = live(L2)[0]; if (t) { const n = D(t).n; move(g, t, 'ban', { reason: 'effect', by: p }); log(g, `${n} was banished.`); } } },
    { type: 'trig', label: 'Attack again', on: (g, ev, c) => ev.type === 'move' && ev.battle && ev.killer === c && ev.to === 'gy' && g.battle && g.battle.a === c && ev.prevCtrl !== c.ctrl,
      cond: (g, c) => c.flags.envoyUsed !== g.turnNo && onField(c),
      after: (g, c) => { c.flags.envoyUsed = g.turnNo; },
      res: function* (g, c) { if (onField(c)) { c.flags.extraAttack = g.turnNo; log(g, `${name(c)} can attack again.`); } } }] },
  'Dark Mimic LV1': { effs: [
    { type: 'trig', mand: true, faceDownOk: true, label: 'Draw 1 card', on: (g, ev, c) => ev.type === 'flip' && ev.c === c,
      res: function* (g, c, p) { draw(g, p, 1); } },
    { type: 'trig', tags: { ss: 1 }, label: 'Send it: summon Dark Mimic LV3', on: (g, ev, c) => ev.type === 'phase' && ev.ph === 'standby' && ev.tp === c.ctrl,
      cond: (g, c, p) => [...g.p[p].hand, ...g.p[p].deck].some(x => named(x, 'Dark Mimic LV3')),
      cost: function* (g, c) { move(g, c, 'gy', { reason: 'cost' }); },
      res: function* (g, c, p) { const cs = [...g.p[p].hand, ...g.p[p].deck].filter(x => named(x, 'Dark Mimic LV3')); const [x] = yield* pick(g, p, 'Special Summon Dark Mimic LV3', cs, 1, 1, 'good'); if (x) { const fromDeck = x.zone === 'deck'; if (ss(g, p, x)) x.flags.mimic = true; if (fromDeck) shuffleDeck(g, p); } } }] },
  'Dark Mimic LV3': { effs: [{ type: 'trig', loc: 'gy', mand: true, label: 'Draw', on: (g, ev, c) => ev.type === 'move' && ev.c === c && ev.battle && ev.destroyed && ev.to === 'gy',
    res: function* (g, c, p, L2) { const n = L2.ev.snap && L2.ev.snap.flags && L2.ev.snap.flags.mimic ? 2 : 1; draw(g, p, n); } }] },
  'Magician of Faith': { effs: [{ type: 'trig', mand: true, faceDownOk: true, label: 'Add a Spell from the GY', on: (g, ev, c) => ev.type === 'flip' && ev.c === c,
    cond: (g, c, p) => g.p[p].gy.some(isSpell),
    target: function* (g, c, p, L2) { yield* tgt(g, p, L2, 'Add which Spell from your GY to your hand?', g.p[p].gy.filter(isSpell), 1, 1, 'good'); },
    res: function* (g, c, p, L2) { const t = L2.t[0]; if (t && t.zone === 'gy') { move(g, t, 'hand', { reason: 'effect' }); log(g, `${PN(g, p)} added ${name(t)} to the hand.`); } } }] },
  // 2005: "During your Standby Phase, if this card is in your Graveyard, you can return it to your hand." No limit, no banish.
  'Sinister Serpent': { effs: [{ type: 'trig', loc: 'gy', label: 'Return to the hand', on: (g, ev, c) => ev.type === 'phase' && ev.ph === 'standby' && ev.tp === c.owner,
    res: function* (g, c, p) { if (c.zone === 'gy') { move(g, c, 'hand', { reason: 'effect' }); log(g, `${PN(g, p)} returned Sinister Serpent to the hand.`); } } }] },
  'Thunder Dragon': { effs: [{ type: 'ign', loc: 'hand', label: 'Discard: add 2 Thunder Dragon',
    cond: (g, c, p) => !forbid(g, { type: 'search', p }),   // it can be discarded to search for 0 (Netrep): a LIGHT for the Chaos monsters
    cost: function* (g, c, p) { move(g, c, 'gy', { reason: 'cost' }); log(g, `${PN(g, p)} discarded Thunder Dragon.`); },
    res: function* (g, c, p) { if (forbid(g, { type: 'search', p })) return; const cs = g.p[p].deck.filter(x => named(x, 'Thunder Dragon')); const xs = yield* pick(g, p, 'Add up to 2 Thunder Dragon to your hand', cs, 0, 2, 'good'); for (const x of xs) move(g, x, 'hand', { reason: 'effect' }); if (xs.length) log(g, `${PN(g, p)} added ${xs.length} Thunder Dragon to the hand.`); shuffleDeck(g, p); } }] },
  // 2005: "By discarding 1 card from your hand, declare 1 Type of monster. Destroy all face-up monsters of the declared Type on the field."
  'Tribe-Infecting Virus': { effs: [{ type: 'ign', tags: { destroy: 1 }, label: 'Discard: destroy a Type',
    cond: (g, c, p) => g.p[p].hand.length > 0 && fieldMons(g).some(faceUp),
    cost: function* (g, c, p) { yield* discardPick(g, p, 1, 'Discard 1 card'); },
    target: function* (g, c, p, L2) { const types = [...new Set(fieldMons(g).filter(faceUp).map(race))]; // PARTIAL: you declare from the Types face-up on the field (any Type is legal; the others would do nothing)
      const i = types.length > 1 ? yield* choose(g, p, 'Declare which Type?', types) : 0; L2.data.type = types[i]; log(g, `${PN(g, p)} declared ${types[i]}.`); },
    res: function* (g, c, p, L2) { destroy(g, fieldMons(g).filter(x => faceUp(x) && race(x) === L2.data.type), { by: p }); } }] },
  // 2005: mandatory; "change 1 face-up monster on the field to face-down Defense Position", itself included.
  'Tsukuyomi': { cont: noSSFromGY,
    effs: [{ type: 'trig', mand: true, label: 'Turn a monster face-down',
      on: (g, ev, c) => (ev.type === 'summon' && ev.cs.includes(c) && ['normal', 'tribute'].includes(ev.how)) || (ev.type === 'flip' && ev.c === c),
      cond: (g, c) => fieldMons(g).some(x => L.canFaceDown(x) && !(x === c && c.flags.battleDoomed)),   // Tokens can't be turned face-down (2026-11-27 audit)
      // not itself once the attack that flipped it destroyed it by damage calculation (ruling; 2026-11-28 audit)
      target: function* (g, c, p, L2) { yield* tgt(g, p, L2, 'Change which face-up monster to face-down Defense Position?', fieldMons(g).filter(x => L.canFaceDown(x) && !(x === c && c.flags.battleDoomed)), 1, 1, 'bad'); },
      res: function* (g, c, p, L2) { const t = live(L2)[0]; if (t && faceUp(t) && t.zone === 'm') setFaceDown(g, t); } },
    spiritReturn] },
  // A counter as each Spell Card activation resolves, Continuous, Equip and Field Spells and Swords included, if SWM was face-up when it was
  // activated and still is (2026-11-27 audit, SWM rulings; the engine's spellResolved event), no chain link.
  'Skilled White Magician': { effs: [
    { type: 'trig', on: (g, ev, c) => { if (L.spellCtrEv(g, ev, c) >= 0 && ctr(c, 'spell') < 3) { addCtr(g, c, 'spell', 1); log(g, `${name(c)} got a Spell Counter (${ctr(c, 'spell')}).`); } return false; }, res: function* () {} },
    { type: 'ign', tags: { ss: 1 }, label: 'Tribute: summon Buster Blader',
      cond: (g, c, p) => ctr(c, 'spell') >= 3 && [...g.p[p].hand, ...g.p[p].deck, ...g.p[p].gy].some(x => named(x, 'Buster Blader')),
      cost: function* (g, c, p) { move(g, c, 'gy', { reason: 'cost' }); log(g, `${PN(g, p)} Tributed Skilled White Magician.`); },
      res: function* (g, c, p) { const cs = [...g.p[p].hand, ...g.p[p].deck, ...g.p[p].gy].filter(x => named(x, 'Buster Blader')); const [x] = yield* pick(g, p, 'Special Summon Buster Blader from your hand, Deck or GY', cs, 1, 1, 'good'); if (x) { const fromDeck = x.zone === 'deck'; ss(g, p, x); if (fromDeck) shuffleDeck(g, p); } } }] },
  'Buster Blader': { self: { atk: (g, c) => 500 * [...monsOf(g, opp(c.ctrl)).filter(faceUp), ...g.p[opp(c.ctrl)].gy].filter(x => isMon(x) && race(x) === 'Dragon').length } },
  'Thousand-Eyes Restrict': { self: absorbSelf,
    // "Other monsters on the field cannot change their battle positions or attack."
    // a Flip Summon is a position change too (ruling: "may not be manually changed")
    cont: { forbid: (g, src, a) => (a.type === 'attack' || a.type === 'pos' || a.type === 'flip') && a.c !== src },
    effs: [absorb] },
  'Relinquished': { self: absorbSelf, effs: [absorb] }, // PARTIAL: the battle damage reflection isn't done (not in the tier A decks)

  /* ----- Spells ----- */
  'Delinquent Duo': { effs: [{ type: 'act', cond: (g, c, p) => g.p[p].lp > 1000 && g.p[opp(p)].hand.length > 0,
    cost: function* (g, c, p) { pay(g, p, 1000); },
    res: function* (g, c, p) { const o = opp(p); discardRandom(g, o); yield* discardPick(g, o, 1, 'Discard 1 card of your choice'); } }] },
  'Graceful Charity': { effs: [{ type: 'act', cond: (g, c, p) => g.p[p].deck.length >= 3,
    res: function* (g, c, p) { draw(g, p, 3); yield* discardPick(g, p, 2, 'Discard 2 cards'); } }] },
  'Pot of Greed': { effs: [{ type: 'act', cond: (g, c, p) => g.p[p].deck.length >= 2, res: function* (g, c, p) { draw(g, p, 2); } }] },
  // 2005: "Offer 1 monster on your side of the field as a Tribute. Special Summon 1 Fusion Monster with the same Level ... from your Fusion Deck."
  // The Tribute is a cost, so Sheep Tokens and face-down monsters can be used.
  'Metamorphosis': { effs: [{ type: 'act', tags: { ss: 1 },
    cond: (g, c, p) => L.tribPool(g, p, { known: true }).some(m => metaTargets(g, p, lv(m)).length),   // not Mind Control's monster; a Soul Exchange target if face-up (rulings)
    cost: function* (g, c, p, L2) { const [m] = yield* pick(g, p, 'Tribute which monster?', L.tribPool(g, p, { known: true }).filter(m => metaTargets(g, p, lv(m)).length), 1, 1, 'cost'); L2.data.lv = lv(m); const nm = m.pos === 'set' ? 'a face-down monster' : name(m); move(g, m, 'gy', { reason: 'cost', by: p }); log(g, `${PN(g, p)} Tributed ${nm}.`); },
    res: function* (g, c, p, L2) { const fs = metaTargets(g, p, L2.data.lv); if (!fs.length || freeM(g, p) < 0) return; const [f] = yield* pick(g, p, `Special Summon which Level ${L2.data.lv} Fusion Monster?`, fs, 1, 1, 'good'); if (f) ss(g, p, f, 'atk'); } }] },
  // 2005: "Equip only to a monster your opponent controls. Take control of the equipped monster.
  // During each of your opponent's Standby Phases, they gain 1000 Life Points." Control lasts while it stays equipped.
  // no room for the stolen monster: it is destroyed (Ojama Trio ruling); no room to return: destroyed (Netrep)
  'Snatch Steal': { effs: [
    { type: 'act', cond: (g, c, p) => oppFaceUp(g, p).length > 0 && freeM(g, p) >= 0,
      target: function* (g, c, p, L2) { yield* tgt(g, p, L2, 'Take control of which monster?', oppFaceUp(g, p), 1, 1, 'bad'); },
      res: function* (g, c, p, L2) { const t = live(L2)[0]; if (!t || !faceUp(t) || t.ctrl === p || !onField(c)) return; const from = t.ctrl; if (!takeControl(g, p, t, false)) { if (freeM(g, p) < 0) { destroy(g, [t], { by: p, src: c }); log(g, `${name(t)} had no room and was destroyed.`); } return; } c.equipTo = t.u; c.flags.snatch = { u: t.u, from }; log(g, `Snatch Steal was equipped to ${name(t)}.`); } },
    { type: 'trig', loc: 'st', mand: true, label: 'Opponent gains 1000 LP', on: (g, ev, c) => ev.type === 'phase' && ev.ph === 'standby' && ev.tp !== c.ctrl && !!c.equipTo,
      res: function* (g, c, p) { gain(g, opp(p), 1000); } },
    { type: 'trig', loc: 'any', mand: true, label: 'Control returns', on: (g, ev, c) => ev.type === 'move' && ev.c === c && ev.wasField && !ev.lostTarget && ev.snap && ev.snap.flags && ev.snap.flags.snatch,   // turned face-down: control stays (ruling)
      res: function* (g, c, p, L2) { const s = L2.ev.snap.flags.snatch; const t = fieldMons(g).find(x => x.u === s.u); if (!t || t.ctrl === s.from) return;
        if (freeM(g, s.from) >= 0) takeControl(g, s.from, t, false); else { move(g, t, 'gy', { reason: 'rule', destroyed: true }); log(g, `${name(t)} had no room to return and was destroyed.`); } } }] },

  /* ----- Traps ----- */
  // 2005: "Destroy 1 face-up monster and inflict damage to both players equal to its ATK." Either turn, either side, no limit.
  'Ring of Destruction': { effs: [{ type: 'act', tags: { destroy: 1 }, cond: g => fieldMons(g).some(faceUp),
    target: function* (g, c, p, L2) { yield* tgt(g, p, L2, 'Destroy which face-up monster?', fieldMons(g).filter(faceUp), 1, 1, 'bad'); },
    res: function* (g, c, p, L2) { const t = live(L2)[0]; if (!t || !faceUp(t)) return; const n = stat(g, t, 'atk');
      if (!destroy(g, [t], { by: p, src: c }).length || n <= 0) return;
      // both players take it at the same time: lower the opponent's LP first, then damage() checks both
      L.damageMany(g, [[opp(p), n], [p, n]], { src: c, srcP: p }); } }] },   // both at once, through the damage statics (Des Wombat)
  'Sakuretsu Armor': { effs: [{ type: 'act', tags: { destroy: 1 }, cond: (g, c, p) => !!g.aw && g.aw.a.ctrl !== p && L.canTarget(g, g.aw.a, { c, p }),
    target: function* (g, c, p, L2) { yield* L.tgt(g, p, L2, 'Target the attacking monster', [g.aw.a], 1, 1, 'bad'); },
    res: function* (g, c, p, L2) { destroy(g, live(L2).filter(t => L.attackingNow(g, t)), { by: p, src: c }); } }] },

  /* ----- 2005 overrides of shared Edison scripts ----- */
  // Scapegoat (2005): "You cannot Normal Summon, Flip Summon or Special Summon the turn you activate this card (you can Set)."
  // The shared script does exactly that now (2026-11-27 audit: Sets allowed, Flip Summons blocked, lifted if the activation is negated),
  // so Goat uses it; this override is gone.
  // Kycoo (2005): "Your opponent cannot remove cards from play from either Graveyard." This includes summons that banish from the GY
  // as their cost (the Chaos monsters, Gigantes: archive), so the Goat version also stops those procedures.
  'Kycoo the Ghost Destroyer': { cont: { forbid: (g, src, a) => a.p != null && a.p !== src.ctrl && ((a.type === 'banish' && a.from === 'gy') || (!!a.c &&
      ((a.type === 'activate' && L.banishesFromGY(a.c, a.eff)) || (a.type === 'ss' && a.proc && L.banishesFromGY(a.c, 'proc'))))) },   // read from the text (engine banishesFromGY)
    get effs() { const s = E.SCRIPTS['Kycoo the Ghost Destroyer']; return s && s.effs ? s.effs : []; } }, // the shared battle-damage banish (batch-1.js), read lazily so load order doesn't matter
}, 'goat');

function metaTargets(g, p, L0) { return g.p[p].extra.filter(f => D(f).k === 'fusion' && lv(f) === L0 && !forbid(g, { type: 'ss', c: f, p, how: 'special' })); }
})();
