/* Learn Edison rules engine (2026-11-20).
 A full Edison duel as one coroutine: the game runs until it needs a decision, then stops on a prompt
 ({p, type, text, opts, min, max}); E.act(g, keys) answers it and the game runs on to the next prompt.
 Every answer is recorded in g.history, and the duel is deterministic from its seed, so E.clone(g) rebuilds
 any position by replaying the answers. The computer uses that to try lines, and online play can later run
 the same code on a server.

 Rules: the April 2010 rules (see the site's Rules page): the first player draws, no Battle Phase on turn 1,
 chains with Spell Speed, priority, costs and targets, Trigger Effects on one chain in SEGOC order, optional
 "When ... you can" effects missing the timing, summon negation windows, the Damage Step in its steps.
 Card effects are scripted in SCRIPTS by card name; a card without a script plays as a vanilla monster, and a
 Spell or Trap without one can only be Set. E.scripted(name) says whether a card is automated.

 Known simplifications (2026-11-20): one Field Spell per player zone (none in the automated decks); phase
 response windows are offered to the opponent at the start of the Battle Phase and in the End Phase, plus
 after every summon, attack and activation. */
(function (root) {
'use strict';
const E = {};
let DATA = new Map(), BYNAME = new Map();
/* Formats (2026-11-24, for Learn Retro Play): the same core plays Edison and Goat. E.init(cards, {format}) picks the card pool's
 format; E.addScripts(obj, 'goat') adds scripts that only Goat uses (a card whose 2005 behavior differs, or a card Edison never needed),
 and they win over the shared SCRIPTS while that format is loaded. Edison (the default) is unchanged. */
let FMT = 'edison'; const FSCRIPTS = {};
let CARDLIST = [];
E.init = (cards, opts = {}) => {
  FMT = opts.format || 'edison'; CARDLIST = cards;
  DATA = new Map(); BYNAME = new Map(); GEMM.clear();
  // edisonformat.net puts a placeholder ("No Edison-Accurate PSCT available...", "No rulings...") in ps for most cards: drop it, so every
  // reader (Fusion and Synchro materials, summon rules, card scripts) falls back to the real text in tx (2026-11-26)
  for (const c of cards) { if (c.ps && /^No (Edison-Accurate|rulings)/.test(c.ps)) delete c.ps; DATA.set(c.id, c); BYNAME.set(c.n, c); }
  for (const t of TOKENS) { DATA.set(t.id, t); BYNAME.set(t.n, t); }
  for (const t of SS_PROBES) DATA.set(t.id, t);   // not cards: ssBlanket()'s stand-ins (no BYNAME entry, so no card list shows them)
  SSC.clear();
};
const TOKENS = [
  { id: 'tok-sheep', n: 'Sheep Token', k: 'token', a: 'EARTH', r: 'Beast', lv: 1, atk: '0', def: '0' },
  { id: 'tok-gorz', n: 'Emissary of Darkness Token', k: 'token', a: 'LIGHT', r: 'Fairy', lv: 7, atk: '?', def: '?' },
];
const num = v => { const x = parseInt(v, 10); return isNaN(x) ? 0 : x; };
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
class Over { constructor() { this.over = true; } }

/* ---------- card facts ---------- */
const D = c => DATA.get(c.id);
const isMonD = d => d && !['spell', 'trap'].includes(d.k);
const isExtraD = d => d && (d.k === 'synchro' || d.k === 'fusion');
const isSpell = c => D(c).k === 'spell', isTrap = c => D(c).k === 'trap', isST = c => isSpell(c) || isTrap(c);
/* Trap Monsters (2026-11-28 audit, edison-21: Zoma the Spirit, Metal Reflect Slime, Embodiment of Apophis, Cyber Shadow Gardna, Stronghold
 the Moving Fortress, Machine King - 3000 B.C.): in a Monster Zone the card is a monster and still a Trap Card (isMon and isTrap are both
 true), with the Type, Attribute, Level and ATK/DEF its text gives; it keeps its Spell & Trap Zone (Apophis ruling 1); MST and Heavy Storm
 hit it (ruling 5: stOnField lists it); a Trap negator (Jinzo, Royal Decree, Trap Stun) sends it face-up to the Spell & Trap Zone, where it
 stays meaninglessly (ruling 7); turned face-down it goes face-down to the Spell & Trap Zone (ruling 9). Off the field it is a Trap Card. */
let TMPROBE = false;
const isTrapMon = c => !!(c && c.flags && c.flags.trapMon && c.zone === 'm');
const isMon = c => isMonD(D(c)) || (!TMPROBE && isTrapMon(c));
const onField = c => c.zone === 'm' || c.zone === 'st' || c.zone === 'fz';
const faceUp = c => onField(c) && c.pos !== 'set';
const SC = c => (FMT !== 'edison' && FSCRIPTS[FMT] && FSCRIPTS[FMT][D(c).n]) || SCRIPTS[D(c).n] || null;
const scByName = n => (FMT !== 'edison' && FSCRIPTS[FMT] && FSCRIPTS[FMT][n]) || SCRIPTS[n] || null;
/* a card's effects: its own, plus the monster effects it copied (c.flags.copyEffs = a card name: Phantom of Chaos and the like,
   2026-11-26: a launch report found Phantom of Chaos couldn't use Sky Scourge Norleras's effect). Copied effects work from the
   field only and keep their own conditions; summon rules and continuous effects aren't copied. */
const effsOf = c => { const sc = SC(c), own = (sc && sc.effs) || []; const n = c && c.flags && c.flags.copyEffs; if (!n) return own;
  const cs = scByName(n); const cp = ((cs && cs.effs) || []).filter(e => e.type !== 'act' && (e.loc || 'm') === 'm'); return cp.length ? own.concat(cp) : own; };
/* A card's name now (2026-11-28 audit, findings edison-s01 and edison-15): "This card's name is always treated as "X"" everywhere (Harpie Lady
 1/2/3 and Cyber Harpie Lady are "Harpie Lady", A Legendary Ocean is "Umi": Karma Cut ruling 8, Harpies' Hunting Ground: nameIs, so the
 printed name still shows); names an effect
 gives on the field (Dupe Frog, Neos Alius, Proto-Cyber Dragon, Forgotten Temple of the Deep, Cyber Dragon Zwei after its effect) while that
 effect isn't negated; Cyber Dragon Zwei is "Cyber Dragon" in the GY. nameOff(c) is the name it has off the field (Karma Cut ruling 7:
 banishing Proto-Cyber Dragon takes other Proto-Cyber Dragons, not Cyber Dragons). */
const ALWAYS_RE = /This card's name is always treated as "([^"]+)"/;
const alwaysMemo = new Map();
function nameOff(c) { const d = D(c); let v = alwaysMemo.get(d.id); if (v === undefined) { const m = String(d.ps || '').match(ALWAYS_RE) || String(d.tx || '').match(ALWAYS_RE); v = m ? m[1] : null; alwaysMemo.set(d.id, v); } return v || d.n; }
function name(c) { const d = D(c); if (onField(c) && faceUp(c)) { const ng = () => (c.g ? negd(c.g, c) : c.flags.negated);
  if (d.n === 'Dupe Frog' && !ng()) return 'Des Frog';
  if (d.n === 'Elemental HERO Neos Alius' && c.zone === 'm' && c.flags.gemini && !ng()) return 'Elemental HERO Neos';   // its Gemini effect (2026-11-27 audit)
  if ((d.n === 'Proto-Cyber Dragon' || (d.n === 'Cyber Dragon Zwei' && c.flags.f04zwei)) && c.zone === 'm' && !ng()) return 'Cyber Dragon';
  if (d.n === 'Forgotten Temple of the Deep' && !ng()) return 'Umi';
  if (c.zone === 'm' && (c.flags.pocName || c.flags.prismaName) && !ng()) return c.flags.pocName || c.flags.prismaName;   // Phantom of Chaos, Elemental HERO Prisma: a name taken until the End Phase (E4)
  } else if (d.n === 'Cyber Dragon Zwei' && c.zone === 'gy') return 'Cyber Dragon';
  return d.n; }
// does c carry name n? (its current name, or the one its text always gives it: Harpie Lady 1 is a "Harpie Lady", A Legendary Ocean is "Umi")
const nameIs = (c, n) => name(c) === n || nameOff(c) === n;
const isUmi = c => nameIs(c, 'Umi');
const isBW = c => /^Blackwing/.test(name(c));
const isFrog = c => /frog/i.test(name(c));   // "Frog" cards include Unifrog (the word inside the name; 2026-11-28 audit)
const isHERO = c => /HERO/.test(name(c));
const isEHERO = c => /^Elemental HERO/.test(name(c));
/* Type and Attribute changes by a card's lasting effect (2026-11-28 audit, edison-11/goat-11): a static cont.race(g, src, c) or
 cont.attr(g, src, c) returns the new one for c, or null (Zombie World: "All monsters on the field and in the GYs become Zombie"; DNA
 Surgery / DNA Transplant: face-up monsters on the field become the declared Type / Attribute). The last one that applies wins. */
let TYPEDEPTH = 0;
function typeOver(c, k) {
  const g = c && c.g; if (!g || TYPEDEPTH || !c.id || !isMonD(D(c)) && !isTrapMon(c)) return null;
  TYPEDEPTH++; try { let v = null; for (const [s, ct] of statics(g)) if (ct[k]) { const r = ct[k](g, s, c); if (r) v = r; } return v; } finally { TYPEDEPTH--; }
}
const attr = c => typeOver(c, 'attr') || (isTrapMon(c) && c.flags.trapMon.a) || D(c).a || '';
const race = c => typeOver(c, 'race') || (isTrapMon(c) && c.flags.trapMon.r) || D(c).r || '';
/* Levels (2026-11-27, a player report: A Legendary Ocean didn't lower WATER Levels, so a Level 5 still needed a Tribute). A card knows its
 game (mk sets c.g, not enumerable, so it never travels in messages), and lv() applies ongoing Level effects the way stat() applies ATK:
 a face-up card's own self.lv(g, c) sets its Level (Morphtronic Scopen, Apocatequil), then every face-up cont.lv(g, src, c) adds to it
 (A Legendary Ocean, Stygian Dirge, Synchro Boost) for monsters face-up on the field, or in the hand when cont.lvHand is set. Never under 1. */
function lv(c) {
  let L = c.flags.lv || num(D(c).lv); const g = c.g;
  if (!g || !L || !(c.zone === 'hand' || (c.zone === 'm' && c.pos !== 'set'))) return L;
  if (c.zone === 'm' && !negd(g, c)) { const sc = SC(c); if (sc && sc.self && sc.self.lv) { const v = sc.self.lv(g, c); if (v) L = v; } }
  let d = 0; for (const [s, ct] of statics(g)) if (ct.lv && (c.zone === 'm' || ct.lvHand)) d += ct.lv(g, s, c) || 0;
  return d ? Math.max(1, L + d) : L;
}
/* c.flags.ownBaseAtk: the base ATK in c.flags.baseAtk comes from the card's own effect (Chimeratech Fortress Dragon's "its original ATK
 becomes 1000 x the materials"). While its effects are negated the printed ATK counts ("?" = 0), and dropOwnWhenNegated() makes that
 permanent (2026-11-27 audit: Chimeratech kept 3000 ATK under Skill Drain). */
function baseAtk(c) { if (c.flags.baseAtk != null && !(c.flags.ownBaseAtk && c.g && onField(c) && negd(c.g, c))) return c.flags.baseAtk; return num(D(c).atk); }
/* ---------- static effects (scripts' "self" and "cont") ----------
 A script can describe what is always true while its card is face-up:
   self: { piercing, directAttack, noBattleDestroy, noEffectDestroy, cantAttack, noAttackTarget, noBattleDamage,
           cantBeTargeted, unaffectedSpells, unaffectedTraps, atk(g,c), def(g,c) }  (each a value or a function (g,c))
   cont: { atk(g,src,c), def(g,src,c), grant(g,src,c,flag), forbid(g,src,action), dmg(g,src,p,n,o), negates(g,src,c), loc }
 cont works from the field (face-up), or from cont.loc ('gy'/'hand') when set. forbid() blocks actions:
 {type:'activate',c,eff,p}, {type:'ns',c,p}, {type:'set',c,p}, {type:'ss',c,p,how}, {type:'search',p}, {type:'attack',c},
 {type:'setST',c,p}, {type:'draw',p}, {type:'pos',c}. Temporary rules (g.rules) use the same forbid shape. */
function statics(g) {
  if (g._st && g._st.seq === g.seq && g._st.turn === g.turnNo) return g._st.list;
  const out = [];
  // a Continuous/Equip/Field card's lasting effects start once its activation has resolved (2026-11-28 audit, Rainbow Ruins site ruling 5:
  // "This card's effects are not applied until its activation is resolved"; Skill Drain or Gravity Bind with a chained MST)
  const onChain = c => g.chain.some(L => L.c === c && L.cardAct);
  for (const c of allField(g)) { if (!faceUp(c)) continue; const sc = SC(c); if (sc && sc.cont && (!sc.cont.loc || (sc.cont.loc === 'gy' && c.pendLeave)) && !(isMon(c) && c.flags.negated) && !(!sc.cont.loc && onChain(c))) out.push([c, sc.cont]); }
  for (const P of g.p) for (const z of ['gy', 'hand']) for (const c of P[z]) { const sc = SC(c); if (sc && sc.cont && sc.cont.loc === z) out.push([c, sc.cont]); }
  g._st = { seq: g.seq, turn: g.turnNo, list: out };
  // a face-up Spell/Trap whose effects are negated (Jinzo on Traps, flags.negated) stops applying its lasting effect too
  // (2026-11-26: Gravity Bind still stopped attacks under Jinzo). The unfiltered list is cached first, so negates() can read it.
  const nl = negLive(g, out);
  const live = out.filter(([c]) => !(onField(c) && (hardNeg(g, c) || out.some(([s2, ct]) => s2 !== c && ct.negates && nl.has(s2) && ct.negates(g, s2, c)))));   // monsters too (Gora Turtle under Gorgon's Eye)
  g._st.list = live;
  return live;
}
/* Which continuous negators apply (2026-11-28 audit, Skill Drain site ruling: "VS. Jinzo: Whichever card was face-up first applies its
 effect"; Goat Netrep on Royal Decree: Skill Drain face-up, Jinzo summoned, then Royal Decree: Decree negates Skill Drain, so Jinzo applies
 and negates both). A negator that arrives while another one that negates it applies never applies; one that arrives free applies and
 switches off what it negates; a negator whose negator stopped applying comes back. g.negLive remembers the state between looks, keyed by
 the card's visit (c.moved), so the order the cards became face-up decides. Returns the set of negators that apply. */
function negLive(g, out) {
  const negs = out.filter(([c, ct]) => ct.negates), st = g.negLive || (g.negLive = {}), key = c => (c.moved || 0) + ':' + c.zone;
  const cur = new Set(negs.map(([c]) => String(c.u)));
  for (const u of Object.keys(st)) if (!cur.has(u)) delete st[u];
  const by = (c) => negs.filter(([s, ct]) => s !== c && st[s.u] && st[s.u].live && ct.negates(g, s, c));
  const fresh = negs.filter(([c]) => !st[c.u] || st[c.u].k !== key(c)).sort((a, b) => (a[0].moved || 0) - (b[0].moved || 0) || a[0].u - b[0].u);
  for (const [c] of fresh) { st[c.u] = { k: key(c), live: false }; st[c.u].live = !hardNeg(g, c) && !by(c).length; }
  for (let i = 0; i < 6; i++) { let ch = false;
    for (const [c] of negs) { const v = !hardNeg(g, c) && !by(c).length; if (v !== st[c.u].live) { st[c.u].live = v; ch = true; } }
    if (!ch) break; }
  return new Set(negs.filter(([c]) => st[c.u].live).map(([c]) => c));
}
/* Negations that aren't a face-up card's lasting effect: c.flags.negated, and Trap Stun's "Negate all other Trap effects on the field this
 turn" (2026-11-28 audit: it only stopped Trap activations, so face-up Gravity Bind and Skill Drain kept applying; Edison ruling: "This
 effect does not prevent Trap Cards from being activated", they are negated on the field). */
const ruleNeg = (g, c) => g.trapStun === g.turnNo && g.trapStunU !== c.u && onField(c) && isTrap(c);
const hardNeg = (g, c) => !!c.flags.negated || ruleNeg(g, c);
// what negates c now: 'flag', 'rule', a static's source card, or null (resolveChain keeps it for a link whose card leaves: Jinzo ruling)
function negSource(g, c) { if (c.flags.negated) return 'flag'; if (ruleNeg(g, c)) return 'rule'; for (const [s, ct] of statics(g)) if (ct.negates && s !== c && ct.negates(g, s, c)) return s; return null; }
/* A monster negated only by negators whose rulings let it still activate its effects (cont.actOk: Skill Drain, site ruling "Face-up Effect
 Monsters may still activate their effects and pay costs"; Gladiator Beast tag outs, Cyber Valley, Doomcaliber Knight, Silverwind): an
 effect with a cost can be activated, and resolves negated if the monster is still face-up on the field then (resolveChain). Effects
 without a cost would only resolve negated, so they stay off. Morphtronic "While in Attack/Defense Position" effects can't be activated:
 those effects are what is negated (Boomboxen, Celfon, Radion site rulings). 2026-11-28 audit, findings edison-11/12/19. */
const POSFX_RE = /While in (?:Attack|Defense|face-up (?:Attack|Defense)) Position/i;
function negActAllowed(g, c, eff) {
  // a mandatory trigger activates too and resolves negated (the same site ruling; EDOPro): it still makes its chain link (2026-11-28 audit,
  // E3b). "Does not start a chain" self-rules (Cloudians) are the continuous effect itself, which Skill Drain stops.
  const mandTrig = eff && eff.type === 'trig' && eff.mand && !eff.noChain && !eff.rule && (eff.loc || 'm') === 'm';
  // eff.negAct: a cost-less effect its own rulings say is activated under Skill Drain (Silverwind ruling 2, BLS - Envoy Goat ruling 4)
  if (!eff || (!eff.cost && !mandTrig && !eff.negAct) || hardNeg(g, c) || POSFX_RE.test(D(c).ps || D(c).tx || '')) return false;
  let any = false; for (const [s, ct] of statics(g)) if (ct.negates && s !== c && ct.negates(g, s, c)) { if (!ct.actOk) return false; any = true; }
  return any;
}
let NEGDEPTH = 0;
function negd(g, c) { // is this card's effect negated right now?
  if (hardNeg(g, c)) return true;
  if (NEGDEPTH > 2) return false; NEGDEPTH++;
  try { for (const [s, ct] of statics(g)) if (ct.negates && s !== c && ct.negates(g, s, c)) return true; } finally { NEGDEPTH--; }
  return false;
}
/* self.lasting lists the self flags that an already resolved effect gave (Gear Golem's direct attack, Yaichi's and Kamon's "can't declare
 an attack this turn"): later negation doesn't switch them off (2026-11-28 audit; Gear Golem ruling 3, Yaichi/Kamon ruling 8). */
function has(g, c, flag) {
  const sc = SC(c);
  if (sc && sc.self && sc.self[flag] != null && onField(c) && faceUp(c) && (!negd(g, c) || (sc.self.lasting && sc.self.lasting.includes(flag)))) { const v = sc.self[flag]; if (typeof v === 'function' ? v(g, c) : v) return true; }
  if (c.flags[flag]) return true;
  for (const [s, ct] of statics(g)) if (ct.grant && ct.grant(g, s, c, flag)) return true;
  return false;
}
/* "You can only control 1 face-up X" / "There can only be 1 X (monster) on the field" (2026-11-28 audit, edison-20 Grandmaster, edison-16
 Earthbound Immortals): read from a monster's text. Only face-up ones count (Grandmaster PS: "1 face-up"; Aslla piscu site ruling: a Set one
 is fine), so a summon or Flip Summon that would make a second one face-up can't happen, and one turned face-up by an effect while another
 is face-up is destroyed by the rule (uniqSweep; not "by its own effect", so Aslla piscu's effect still activates). A quoted name followed
 by "monster" is an archetype. */
const uniqMemo = new Map();
function uniqOf(c) {
  const d = D(c); if (!isMonD(d)) return null; if (uniqMemo.has(d.n)) return uniqMemo.get(d.n);
  const t = String(d.ps || '') + ' ' + String(d.tx || ''); let u = null;
  let m = /You can only control 1 (?:face-up )?"([^"]+)"( monster)?/i.exec(t), side = 'own';
  if (!m) { m = /There can only be 1 (?:face-up )?"([^"]+)"( monster)? on the field/i.exec(t); side = 'field'; }
  if (m) { const n = m[1], arch = !!m[2]; u = { side, match: x => isMon(x) && (arch ? name(x).includes(n) : name(x) === n) }; }
  uniqMemo.set(d.n, u); return u;
}
function uniqBlocked(g, a) {
  if (!['ns', 'ss', 'flip'].includes(a.type) || !a.c || !a.c.id) return false;
  const u = uniqOf(a.c); if (!u) return false; const p = a.p != null ? a.p : a.c.ctrl;
  return fieldMons(g).some(x => x !== a.c && faceUp(x) && u.match(x) && (u.side === 'field' || x.ctrl === p));
}
function uniqSweep(g) {
  if (g.uqBusy) return; const ms = fieldMons(g).filter(x => faceUp(x) && uniqOf(x)); if (ms.length < 2) return;
  g.uqBusy = true;
  try { const kill = [];
    for (const c of ms) { const u = uniqOf(c); const same = ms.filter(x => u.match(x) && (u.side === 'field' || x.ctrl === c.ctrl)).sort((a, b) => (a.flags.upAt || a.moved || 0) - (b.flags.upAt || b.moved || 0));
      if (same.length > 1 && same[0] !== c && !kill.includes(c)) kill.push(c); }
    if (kill.length) { log(g, `Only one ${kill.map(name).join(', ')} can be face-up.`); destroy(g, kill, { rule: true }); } }
  finally { g.uqBusy = false; }
}
function forbid(g, a) {
  if (a.type === 'ss' && ssLimited(g, a)) return true;
  if (uniqBlocked(g, a)) return true;
  for (const [s, ct] of statics(g)) if (ct.forbid && !(a.type === 'ss' && g.ssBatch && g.ssBatch.cs.includes(s)) && ct.forbid(g, s, a)) return true;
  for (const r of g.rules) if (!(r.L && r.L.actNegated) && !(a.inCond && legacyLock(r)) && r.forbid(g, a)) return true;   // a lock from an activation that was negated is gone
  return false;
}
/* The older per-card summon locks card files still install as permanent rules (their LOCKS tables, full-07's f07Rule, batch-1's hub)
 test the moment of the summon (the enabling Spell face-up, a link resolving), which an effect's activation condition can't see yet. A
 cond's summonability check (ssable, a.inCond) leaves the permanent rules out: the engine's own summoning conditions (ssLimited, read from
 the text) apply there, and the rules still apply when it resolves. Locks with an end (this turn) or from an activation still count. */
const legacyLock = r => r.end == null && r.startOf == null && !r.L;
function stat(g, c, which) { // current ATK or DEF
  const d = D(c); let v = which === 'atk' ? baseAtk(c) : c.flags.baseDef != null ? c.flags.baseDef : num(d.def);
  if (c.flags.tokAtk != null) v = c.flags.tokAtk;
  if (!onField(c) || !faceUp(c) || c.zone !== 'm') return v;
  const nm = d.n, neg = negd(g, c);
  // "its original ATK becomes X" (Shrink): a base mod {base, which} replaces the original value, and every other change still adds to it
  for (const m of c.mods) if (m.base != null && (m.which === which || m.which === 'both') && !(m.own && neg)) v = m.base;
  const sc = SC(c); if (!neg && sc && sc.self && sc.self[which]) v += sc.self[which](g, c) || 0;
  for (const [s, ct] of statics(g)) if (ct[which]) v += ct[which](g, s, c) || 0;
  if (!neg) {
    if (nm === 'Colossal Fighter' && which === 'atk') v += 100 * allCards(g, 'gy').filter(x => isMon(x) && race(x) === 'Warrior').length;
    if (nm === 'Elemental HERO Absolute Zero' && which === 'atk') v += 500 * fieldMons(g).filter(x => faceUp(x) && attr(x) === 'WATER' && D(x).n !== 'Elemental HERO Absolute Zero').length;   // no other Absolute Zero (archive)
    if (nm === 'Tragoedia') v += 600 * g.p[c.ctrl].hand.length;
  }
  for (const m of c.mods) { if (m.own && neg) continue; if (m.set != null && (m.which === which || m.which === 'both')) v = m.set; else if (m.base == null && m[which]) v += m[which]; }
  return Math.max(0, v);
}
E.atk = (g, c) => stat(g, c, 'atk'); E.def = (g, c) => stat(g, c, 'def');
E.name = name; E.data = D; E.lv = lv; E.onField = onField;

/* ---------- zones ---------- */
function allCards(g, zone) { const out = []; for (const P of g.p) { const a = P[zone]; if (Array.isArray(a)) for (const c of a) if (c) out.push(c); else if (a) out.push(a); } return out; }
const fieldMons = g => [...g.p[0].m, ...g.p[1].m].filter(Boolean);
const monsOf = (g, p) => g.p[p].m.filter(Boolean);
const stOf = (g, p) => [...g.p[p].st.filter(Boolean), ...(g.p[p].fz ? [g.p[p].fz] : [])];
const fieldOf = (g, p) => [...monsOf(g, p), ...stOf(g, p)];
const allField = g => [...fieldOf(g, 0), ...fieldOf(g, 1)];
const freeM = (g, p) => g.p[p].m.findIndex(z => !z);
// a Trap Monster's Spell & Trap Zone stays taken (Embodiment of Apophis ruling 1)
const heldST = (g, p) => [...g.p[0].m, ...g.p[1].m].filter(x => isTrapMon(x) && x.flags.trapMon.p === p).map(x => x.flags.trapMon.zi);
const freeST = (g, p) => { const h = heldST(g, p); return g.p[p].st.findIndex((z, i) => !z && !h.includes(i)); };
const nFreeM = (g, p) => g.p[p].m.filter(z => !z).length;
E.fieldOf = fieldOf; E.monsOf = monsOf;

function mk(g, id, owner) { const c = { u: g.nextU++, id, owner, ctrl: owner, zone: 'deck', pos: null, mods: [], flags: {}, used: {}, attacks: 0 }; Object.defineProperty(c, 'g', { value: g }); return c; }
function detach(g, c) {
  if (c.zone === 'm' || c.zone === 'st') { const a = g.p[c.ctrl][c.zone]; const i = a.indexOf(c); if (i >= 0) a[i] = null; }
  else if (c.zone === 'fz') { if (g.p[c.ctrl].fz === c) g.p[c.ctrl].fz = null; }
  else if (g.p[c.owner][c.zone]) { const a = g.p[c.owner][c.zone]; const i = a.indexOf(c); if (i >= 0) a.splice(i, 1); }
}
function snap(g, c) { return { name: name(c), batk: baseAtk(c), atk: onField(c) ? stat(g, c, 'atk') : baseAtk(c), def: onField(c) ? stat(g, c, 'def') : num(D(c).def), attr: attr(c), lv: lv(c), race: race(c), pos: c.pos, ctrl: c.ctrl, faceUp: faceUp(c), mon: isMon(c), negd: onField(c) && faceUp(c) ? negd(g, c) : false, flags: c.flags }; }
/* Move a card. to: hand, deck (shuffled in), deckTop, gy, ban, extra, m, st, fz. o: {reason, by (player), destroyed, battle, killer, ctrl, pos, zi, group, faceDown} */
function move(g, c, to, o = {}) {
  // who moves it: an effect move carries the player whose effect it is, the resolving link's controller (or the player paying a cost),
  // never the turn player by default (2026-11-28 audit, goat-11 and goat-s01: Despair from the Dark, Regenerating Mummy off Morphing Jar)
  if (o.by == null && !o.battle && (o.destroyed || ['effect', 'discard', 'cost', 'tribute'].includes(o.reason))) { const b = g.resolvingL ? g.resolvingL.p : g.inCost && g.costP != null ? g.costP : null; if (b != null) o = { ...o, by: b }; }
  // a monster sent from the field to the GY as the cost of an effect whose text Tributes is Tributed (2026-11-28 audit: about 50 scripts
  // paid "Tribute 1 monster" as a plain cost move, so "if this card is Tributed" cards and the Tribute rules never saw it)
  if (o.reason === 'cost' && g.inCost && to === 'gy' && c.zone === 'm' && g.costEff && costTributes(g.costEff.c, g.costEff.eff)) o = { ...o, reason: 'tribute' };
  // a hand win (Exodia) is checked once the effect adding the card has resolved (2026-11-27 audit, Graceful Charity ruling: drawing the
  // last pieces, "you must discard 2 cards before a victory can be declared"); a draw outside an effect checks at once
  // "Neither player can add cards from their Deck to their hand except by drawing" (Thunder King Rai-Oh, Deck Lockdown): every Deck-to-hand
  // move by an effect asks the search forbid, not only search() (2026-11-28 audit, edison-15: Crystal Seer and other excavations)
  if (to === 'hand' && c.zone === 'deck' && o.reason !== 'draw' && forbid(g, { type: 'search', p: c.owner, c })) { log(g, 'Cards can\u2019t be added from the Deck right now.'); return null; }
  if (to === 'hand' && !o._hw) { const r = move(g, c, to, { ...o, _hw: true }); if (g.resolvingL) (g.hwPend || (g.hwPend = [])).push(c.owner); else handWin(g, c.owner); return r; }
  const from = c.zone, wasField = onField(c), s = wasField ? snap(g, c) : null, prevCtrl = c.ctrl;
  if (from === 'gone') return null;
  // a resolved Normal/Quick-Play Spell or Normal/Counter Trap waiting to leave at the end of the chain (pendLeave) is already treated as
  // gone: only a destruction (or its own leave) moves it (2026-11-28 audit: Giant Trunade "non-continuous cards chained to this are not
  // returned to the hand", Raiza site ruling 1; Heavy Storm and Dust Tornado still destroy it)
  if (c.pendLeave && !o.destroyed && to !== 'gy') return null;
  // a card in a GY an effect can't move (Goat Necrovalley: "Negate any card effect that would move a card in the Graveyard to a different
  // place"; not a cost, not the card's own effect from the GY: Sinister Serpent): static cont.gyHold(g, src, c, to, o)
  if (from === 'gy' && to !== 'gy' && !g.inCost && g.resolvingL) for (const [s2, ct] of statics(g)) if (ct.gyHold && ct.gyHold(g, s2, c, to, o)) { log(g, `${D(s2).n} kept ${D(c).n} in the GY.`); return null; }
  c.pendLeave = false;
  if (wasField && c.flags.banishOnLeave && to !== 'ban' && to !== 'm' && !banBlocked(g, c, from, o)) { o = { ...o, insteadOf: o.insteadOf || to }; to = 'ban'; }
  if (wasField && D(c).k === 'token' && to !== 'm') { detach(g, c); c.zone = 'gone'; emit(g, { type: 'move', c, from, to: 'gone', wasField, snap: s, prevCtrl, ...o }, o.group); return null; }
  // "Any card sent to the GY is banished instead" (Macro Cosmos, Dimensional Fissure, Banisher of the Light/Radiance): a true replacement,
  // so the card never touches the GY and nothing "sent to the GY" happens (2026-11-28 audit). Imperial Iron Wall stops it (site ruling:
  // "Imperial Iron Wall trumps the effect of Macro Cosmos"), and then the card goes to the GY.
  if (to === 'gy' && !o.noRedirect) { const by = gyBanBy(g, c, o); if (by && !banBlocked(g, c, from, o)) { o = { ...o, insteadOf: 'gy', banBy: by.u }; to = 'ban'; } }
  // an Extra Deck monster that would go to the hand or Deck goes back to the Extra Deck, from any zone (A Feather of the Phoenix archive:
  // "it is returned to the Fusion Deck"; Raiza, Brionac and every return from the GY or banished pile)
  if (isExtraD(D(c)) && ['hand', 'deck', 'deckTop'].includes(to)) to = 'extra';
  // "Neither player can banish cards" (Imperial Iron Wall), "from the GY" (Necrovalley, Kycoo): a banish that can't happen. A destroy-and-banish
  // (Nobleman of Crossout, Bottomless Trap Hole) still destroys, and the card goes to the GY (Imperial Iron Wall site ruling); anything else
  // stays where it is (Caius, Allure of Darkness: "reveal it, but it isn't banished")
  if (to === 'ban' && banBlocked(g, c, from, o)) { if (o.destroyed || (o.insteadOf && o.insteadOf !== 'ban')) to = o.insteadOf && o.insteadOf !== 'ban' ? o.insteadOf : 'gy'; else { log(g, `${D(c).n} can't be banished.`); return null; } }
  if (from === 'gy' && to !== 'gy') resetUsed(c);   // a soft once-per-turn GY effect can be used again after the card leaves the GY (Volcanic Shell, 2026-11-28 audit)
  const linkNeg = wasField && c.linkTo ? negd(g, c) : false;   // a negated Call of the Haunted (Jinzo) leaves its monster
  detach(g, c);
  if (wasField && to !== 'm') {
    // equips on it go to the GY; its own equip link ends
    for (const P of g.p) for (const x of P.st) if (x && x.equipTo === c.u) { x.equipTo = null; g.later.push(x); }
    // Call of the Haunted and its kind (2026-11-27 audit): "when that monster is destroyed, destroy this card" only when it is destroyed
    // (Tributed, sent or bounced, the card stays "meaninglessly": archive), or on any move when the text says "leaves the field"; and
    // "when this card leaves the field, destroy that monster" not while this card's effect is negated (Jinzo: archive)
    for (const x of allField(g)) if (x.linkTo === c.u) { x.linkTo = null; if (linkFollows(x, o) && !negd(g, x)) { g.laterDestroy.push(x); (g.laterBy || (g.laterBy = {}))[x.u] = x.ctrl; } }
    if (c.linkTo && !linkNeg) { const t = allField(g).find(x => x.u === c.linkTo); if (t) { g.laterDestroy.push(t); (g.laterBy || (g.laterBy = {}))[t.u] = prevCtrl; } }
    c.mods = []; c.flags = {}; c.attacks = 0; c.negAtk = 0; c.equipTo = null; c.linkTo = null; c.ctr = {};
    if (!['st', 'fz'].includes(to)) resetUsed(c);
  }
  if (to === 'm' || to === 'st' || to === 'fz') {
    const P = g.p[o.ctrl != null ? o.ctrl : c.owner]; c.ctrl = o.ctrl != null ? o.ctrl : c.owner;
    if (to === 'fz') P.fz = c; else {
      // zone: an effect's own pick, else the zone the player chose in the client (E.act's hint), else the first free one
      let i = o.zi != null && !P[to][o.zi] ? o.zi : -1;
      if (i < 0 && g.pz && g.pz.u === c.u && g.pz.to === to && g.pz.zi >= 0 && g.pz.zi < 5 && !P[to][g.pz.zi]) { i = g.pz.zi; g.pz = null; }
      if (i < 0 && to === 'st') i = freeST(g, c.ctrl);
      if (i < 0) i = P[to].findIndex(z => !z);
      P[to][i] = c;
    }
    c.pos = o.pos || (to === 'm' ? 'atk' : 'up'); c.zone = to; c.turnIn = g.turnNo; c.posChanged = false;
  } else {
    c.ctrl = c.owner; c.pos = null; c.zone = to === 'deckTop' ? 'deck' : to;
    if (to !== 'gy' && to !== 'ban') c.proper = false;   // properly summoned: kept on the field, in the GY and banished only
    const P = g.p[c.owner];
    if (to === 'deckTop') P.deck.push(c);
    else if (to === 'deck') { P.deck.push(c); shuffleDeck(g, c.owner); }
    else P[to].push(c);
  }
  c.moved = g.moves = (g.moves || 0) + 1;   // which arrival this is (Stardust Dragon: the same visit to the GY)
  // asCost: the move happened while a cost was paid (a discard for a cost is not "discarded by a card effect": Dark World archive)
  const ev = emit(g, { type: 'move', c, from, to, wasField, snap: s, prevCtrl, ...(g.inCost ? { asCost: true } : null), ...o }, o.group);
  if (!o.noLater) flushLater(g, ev.group);
  return ev;
}
/* Banish-instead replacements (2026-11-28 audit): a face-up static cont.gyBan says which cards it banishes instead of the GY: 'all'
 (Macro Cosmos, Banisher of the Light/Radiance), 'mon' (Dimensional Fissure), or a function (g, src, c, o). A card's own replacement
 doesn't reach itself (Macro Cosmos destroyed goes to the GY). gyLock(g, kind) answers for a cost whose cards aren't known yet. */
function gyBanBy(g, c, o = {}) {
  for (const [s, ct] of statics(g)) {
    if (!ct.gyBan || s === c) continue;
    const v = typeof ct.gyBan === 'function' ? ct.gyBan(g, s, c, o) : ct.gyBan === 'all' || (ct.gyBan === 'mon' && isMon(c));
    if (v) return s;
  }
  return null;
}
function gyLock(g, kind) {   // kind: 'mon' a monster, 'deck' unknown cards (could be monsters), 'st' Spells/Traps, 'any' cards the player picks
  for (const [, ct] of statics(g)) { const k = ct.gyBan; if (!k) continue; if (k === 'all') return true; if (k === 'mon' && (kind === 'mon' || kind === 'deck')) return true; }
  return false;
}
// who banishes: the move's player, else the resolving link's, else the player paying a cost (Kycoo only stops the opponent)
const banBlocked = (g, c, from, o = {}) => forbid(g, { type: 'banish', c, from, p: o.by != null ? o.by : g.resolvingL ? g.resolvingL.p : g.costP != null ? g.costP : null });
/* Costs that send cards "to the GY" can't be paid while those cards would be banished instead (Dimensional Fissure and Macro Cosmos
 rulings: "Cards/effects whose cost send/discard a monster(s) 'to the Graveyard' CANNOT activate": Card Trooper, Charge of the Light
 Brigade, D.D. Crow, Brionac, Zombie Master, Thunder King Rai-Oh, Rescue Cat, Chimeratech Fortress Dragon's summon), while a plain
 "Discard 1 card" cost can (Magic Jammer, Trade-In, Dark Grepher). Read from the card's text: the phrase that sends to the GY as a cost,
 and what it sends (a monster, unknown cards from the Deck, Spells/Traps, or cards the player picks). */
const GYCOST_RE = /(?:\b(?:send|sending|discard|discarding)\b[^.;:]{0,140}?\bto the (?:Graveyard|GY)\b\s*(?:;|:|,? then\b|,? to (?!the\b|your\b|their\b|its\b)[a-z]+)|\bby (?:sending|discarding)\b[^.]{0,140}?\bto the (?:Graveyard|GY)\b)/i;
const gyCostMemo = new Map();
function gyCostKind(c) {
  const d = D(c), k = d.n + '|' + FMT; if (gyCostMemo.has(k)) return gyCostMemo.get(k);
  const m = String(d.ps || d.tx || '').match(GYCOST_RE); let v = null;
  if (m) { const s = m[0];
    v = /\btop\b|from (?:the top of )?(?:your|their) Deck|cards? of your Deck/i.test(s) ? 'deck'
      : /\bmonsters?\b|\b(?:LIGHT|DARK|WATER|FIRE|WIND|EARTH|Dragon|Machine|Fairy|Zombie|Fiend|Warrior|Spellcaster|Beast|Plant|Insect|Gemini|Tuner)s?\b/.test(s) || (isMonD(d) && /\b(?:this|equipped) (?:face-up )?card\b|\bit\b/i.test(s)) ? 'mon'
      : /\b(?:Spell|Trap|Equip|Field)\b/.test(s) || /\bthis (?:face-up )?card\b/i.test(s) ? 'st' : 'any'; }
  gyCostMemo.set(k, v); return v;
}
/* A cost that banishes can't be paid while banishing is forbidden (2026-11-28 audit, edison-20/18: Psychic Lifetrancer, Djinn for Black
 Illusion Ritual, Maximus, Rooklord, Aztekipede under Imperial Iron Wall, Kycoo or Necrovalley): checked when the effect or the summon
 procedure is offered. The cost's script says it banishes ('ban'); its text says whether from the GY (banishesFromGY). */
function banCostBlocked(g, p, c, eff) {
  if (!eff || !eff.cost || !/['"]ban['"]/.test(String(eff.cost))) return false;
  const fromGY = banishesFromGY(c, eff === (SC(c) || {}).proc ? 'proc' : eff);
  return forbid(g, { type: 'banish', p, from: fromGY ? 'gy' : 'any', inCond: true });
}
function gyCostBlocked(g, c, eff) {   // eff: an effect, or a summon procedure (proc / 'cf')
  let kind = gyCostKind(c); if (!kind) return false;
  if (eff === 'cf' && kind === 'any') kind = 'mon';   // a contact Fusion's "above cards" are its monsters (Chimeratech under Dimensional Fissure: archive)
  if (eff && eff !== 'cf' && !(eff.cost && /'gy'|mill|discard|Cost\(/i.test(String(eff.cost)))) return false;
  return gyLock(g, kind);
}
// When does a linked card (Call of the Haunted) go when its monster leaves the field? Read from its text: "that monster leaves the field"
// on any move, "that monster is destroyed" only when destroyed, only "this card leaves the field, destroy that monster" (D.D.R.) never;
// other wording keeps the old rule (any move).
function linkFollows(x, o) {
  const t = String(D(x).ps || D(x).tx || '');
  if (/(?:when|if) (?:that|the) (?:monster|target|equipped monster) leaves the field,? destroy this card/i.test(t)) return true;
  if (/(?:when|if) (?:that|the) (?:monster|target|equipped monster) is destroyed,? destroy this card/i.test(t)) return !!o.destroyed;
  if (/(?:when|if) this card leaves the field,? destroy (?:that|the)/i.test(t)) return false;
  return true;
}
function flushLater(g, group) {
  for (let i = 0; i < 6 && (g.later.length || g.laterDestroy.length); i++) {
    const l = g.later; g.later = []; for (const x of l) if (onField(x)) move(g, x, 'gy', { reason: 'rule', group, noLater: true });
    // a linked card's destroy (Call of the Haunted and its monster) goes through destroy()'s checks (2026-11-28 audit, Imperial Custom ruling:
    // "Continuous Traps which destroy themselves (ex: Call of the Haunted) are not destroyed"; a "can't be destroyed by card effects" monster
    // stays), by the player whose card's effect it is (the link's controller)
    const d = g.laterDestroy; g.laterDestroy = []; const lb = g.laterBy || {}; g.laterBy = {};
    for (const x of d) if (onField(x)) destroy(g, [x], { group, by: lb[x.u] != null ? lb[x.u] : x.ctrl, src: x, quietLog: true, noFlush: true });
  }
}
function shuffleDeck(g, p) { const a = g.p[p].deck; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }

/* ---------- events and triggers ---------- */
function beginOp(g) { g.group++; g.sw = null; }
/* A monster's ATK/DEF changes from its own effect (addMod with own: true, and c.flags.ownBaseAtk) are lost for good once its effects are
 negated (Card Trooper ruling: "Even if Skill Drain leaves play, the increase in ATK will not return"; Chimeratech Fortress Dragon:
 "its ATK becomes 0 (permanently)"). stat() skips them while negated; this sweep, run on every event, makes it permanent. */
function dropOwnWhenNegated(g) {
  for (const c of fieldMons(g)) {
    // a monster whose effects are negated can't hold Spell Counters and loses them (2026-11-28 audit; Skill Drain Edison ruling, Arcanite
    // Magician and Skilled Dark Magician archive: "Any Spell Counters that are on this monster are removed")
    if (c.ctr && c.ctr.spell > 0 && faceUp(c) && negd(g, c)) { c.ctr.spell = 0; log(g, `${D(c).n} lost its Spell Counters.`); }
    // a gain the card's own effect keeps in its flags (Bazoo, Gladiator Beast Laquari and Hoplomus): self.onNegated drops it for good
    // (2026-11-28 audit, goat-07 Bazoo and edison-11 Hoplomus site ruling 2: "Even if Skill Drain is later ... removed ... will remain")
    { const sc = SC(c); if (sc && sc.self && sc.self.onNegated && faceUp(c) && negd(g, c)) sc.self.onNegated(g, c); }
    if (!c.flags.ownBaseAtk && !c.mods.some(m => m.own)) continue;
    if (!faceUp(c) || !negd(g, c)) continue;
    c.mods = c.mods.filter(m => !m.own); if (c.flags.ownBaseAtk) { c.flags.baseAtk = null; c.flags.ownBaseAtk = false; }
  }
}
/* Superalloy Beast Raptinus (2026-11-27 audit): "All Gemini Monsters on the field are treated as Effect Monsters, and gain their effects".
 While a face-up Raptinus applies, every face-up Gemini on the field gets c.flags.gemini = 'rap' (scripts read c.flags.gemini as "is an
 Effect Monster"); once none applies, the ones it gave go back to Normal Monsters. Run on every event, like dropOwnWhenNegated. */
function raptinusSweep(g) {
  const ms = fieldMons(g); let on = null;
  for (const x of ms) if (D(x).n === 'Superalloy Beast Raptinus' && faceUp(x)) { if (on === null) on = false; if (!negd(g, x)) { on = true; break; } }
  for (const x of ms) { if (!isGemini(x)) continue; if (on && faceUp(x) && !x.flags.gemini) x.flags.gemini = 'rap'; else if (!on && x.flags.gemini === 'rap') x.flags.gemini = false; }
}
const TM_RE = /\(([A-Za-z -]+?)(?:-Type)?\/(DARK|LIGHT|EARTH|WATER|FIRE|WIND|DIVINE)\/Level (\d+)\/ATK (\d+|\?)\/DEF (\d+|\?)\)/i;
// Special Summon a face-up Trap Card from its Spell & Trap Zone as a monster; st overrides what the text gives ({atk, def, lv, a, r, pos})
function trapMonster(g, c, p, st = {}) {
  if (!onField(c) || c.zone !== 'st' || freeM(g, p) < 0) return false;
  const m = TM_RE.exec(String(D(c).tx || '')), zi = g.p[c.ctrl].st.indexOf(c), owner = c.ctrl;
  const s = { ...(m ? { r: m[1].trim(), a: m[2].toUpperCase(), lv: +m[3], atk: num(m[4]), def: num(m[5]) } : {}), ...st };
  if (!ss(g, p, c, s.pos || 'def')) return false;
  c.flags.baseAtk = s.atk || 0; c.flags.baseDef = s.def || 0; c.flags.lv = s.lv; c.flags.trapMon = { a: s.a, r: s.r, zi, p: owner };
  g.seq++; return true;
}
// is a Trap negator (not a monster negator like Skill Drain) negating this Trap Monster?
function trapNegated(g, c) {
  if (ruleNeg(g, c)) return true;
  TMPROBE = true; try { for (const [s, ct] of statics(g)) if (ct.negates && s !== c && ct.negates(g, s, c)) return true; } finally { TMPROBE = false; }
  return false;
}
// the Trap Monster goes back to the Spell & Trap Zone: face-up when a Trap negator applies (rule), face-down when turned face-down
function trapMonBack(g, c, pos) {
  const tm = c.flags.trapMon, p = c.ctrl, zi = tm.p === p && !g.p[p].st[tm.zi] ? tm.zi : null;
  if (zi == null && freeST(g, p) < 0) { move(g, c, 'gy', { reason: 'rule' }); return; }
  move(g, c, 'st', { ctrl: p, pos, reason: 'rule', zi: zi != null ? zi : undefined, trapBack: true });
  if (pos === 'up') c.flags.trapDone = true;   // "remains on the field meaninglessly"
  log(g, `${D(c).n} went back to the Spell & Trap Zone${pos === 'set' ? ' face-down' : ''}.`);
}
function trapMonSweep(g) {
  if (g.tmBusy) return; g.tmBusy = true;
  try { for (const c of fieldMons(g)) if (isTrapMon(c) && faceUp(c) && trapNegated(g, c)) trapMonBack(g, c, 'up'); } finally { g.tmBusy = false; }
}
/* "Equip only to X" (2026-11-28 audit, goat-11 Lightning Blade, Machina rulings: "If the target is no longer Machine-Type, it is destroyed by
 game mechanic"): an Equip Spell whose equipped monster stops being an X is destroyed. X read from the text: a Type and/or Attribute, an
 archetype in quotes, or a list of card names; other wordings (Levels, who controls it) aren't rechecked. */
const EQ_TYPES = ['Warrior', 'Machine', 'Psychic', 'Fairy', 'Insect', 'Reptile', 'Beast-Warrior', 'Beast', 'Aqua', 'Dinosaur', 'Zombie', 'Dragon', 'Plant', 'Spellcaster', 'Fiend', 'Pyro', 'Rock', 'Thunder', 'Sea Serpent', 'Fish', 'Winged Beast'];
const eqReqMemo = new Map();
function equipReq(c) {
  const d = D(c); if (eqReqMemo.has(d.n)) return eqReqMemo.get(d.n);
  let f = null; const m = /Equip only to ([^.;]*?)(?:[.;]|$)/i.exec(String(d.tx || '')), s = m ? m[1].trim() : '';
  if (s && /^"[^"]+"(?:,? (?:or )?"[^"]+")*$/.test(s)) { const ns = [...s.matchAll(/"([^"]+)"/g)].map(x => x[1]); f = x => ns.includes(name(x)); }
  else if (s) { const mm = /^an? (?:(DARK|LIGHT|EARTH|WATER|FIRE|WIND) )?(?:"([^"]+)" |([A-Z][A-Za-z-]*(?: [A-Z][a-z]+)?) )?monster$/.exec(s);
    if (mm && (mm[1] || mm[2] || (mm[3] && EQ_TYPES.includes(mm[3])))) { const [, at, arch, ty] = mm; f = x => (!at || attr(x) === at) && (!arch || name(x).includes(arch)) && (!ty || race(x) === ty); } }
  eqReqMemo.set(d.n, f); return f;
}
function equipSweep(g) {
  if (g.eqBusy) return; g.eqBusy = true;
  try { for (const P of g.p) for (const x of P.st) { if (!x || !x.equipTo || !faceUp(x) || !isSpell(x) || D(x).sub !== 'Equip') continue; const req = equipReq(x); if (!req) continue;
    const m = fieldMons(g).find(y => y.u === x.equipTo); if (m && faceUp(m) && !req(m)) { log(g, `${D(x).n} can't stay equipped to ${name(m)}.`); destroy(g, [x], { rule: true }); } } }
  finally { g.eqBusy = false; }
}
function emit(g, ev, group) {
  g.seq++; dropOwnWhenNegated(g); raptinusSweep(g); trapMonSweep(g); equipSweep(g); uniqSweep(g); reaperSweep(g);   // the sweeps read the state as it is now (fresh statics)
  if (g.flipWatch && ev.c && (ev.type === 'flip' || ev.type === 'move')) g.flipWatch.push(ev.c.u);
  if (g.posWatch && ev.c && ev.type === 'pos') g.posWatch.push(ev.c.u);
  ev.group = group != null ? group : g.group; ev.seq = ++g.seq; ev.turn = g.turnNo; ev.phase = g.phase;
  if (ev.type === 'summon') g.summoned[ev.p] = true;
  if (ev.type === 'flip' && ev.c && ev.c.flags) { ev.c.flags.flippedUp = true; ev.c.flags.upAt = g.seq; }
  g.events.push(ev); if (g.events.length > 120) g.events.splice(0, 40);
  if (g.hooks) g.hooks.ev(g, ev); // a client watching the live duel (Learn Retro Play); clones and tests have none
  // collect triggers from every card that can see it (g.inEmit: a rule a watcher installs here is never tied to an activation, see addRule)
  const prevE = g.inEmit; g.inEmit = true;
  try { for (const P of g.p) for (const z of ['m', 'st', 'fz', 'hand', 'gy', 'ban', 'deck', 'extra']) {
    const arr = z === 'fz' ? (P.fz ? [P.fz] : []) : P[z]; if (!arr) continue;
    for (const c of arr) {
      if (!c) continue; const es = effsOf(c); if (!es.length) continue;
      es.forEach((eff, ei) => {
        if (eff.type !== 'trig') return;
        const loc = eff.loc || 'm';
        if (loc === 'any' ? false : loc === 'm' ? c.zone !== 'm' || !faceUp(c) && !eff.faceDownOk : loc !== c.zone || ((loc === 'st' || loc === 'fz') && !faceUp(c))) return;
        // eff.rule: not an effect at all (a maintenance cost: Koa'ki Meiru, Iron Core Specimen Lab; Skill Drain ruling "Maintenance costs
        // must still be paid"), so negation doesn't stop it (2026-11-28 audit, edison-18)
        if (loc === 'm' && negd(g, c) && !negActAllowed(g, c, eff) && !eff.rule) return;
        // a negated face-up Spell/Trap: its optional triggers and the lasting effects scripts run inside on() stop (2026-11-28 audit, goat-03:
        // Level Limit - Area B under Imperial Order, Swords of Revealing Light's count, Mirror Wall); mandatory ones resolve negated
        // a negated Spell/Trap's "does not start a chain" continuous-like effects stop too (Code A's counters, Swords of Concealing Light)
        if ((loc === 'st' || loc === 'fz') && (!eff.mand || eff.noChain) && !eff.rule && isST(c) && negd(g, c)) return;
        try { if (eff.on(g, ev, c)) g.pend.push({ c, eff, ei, ev, p: onField(c) ? c.ctrl : c.owner }); } catch (e) { throw e; }
      });
    }
  } } finally { g.inEmit = prevE; }
  return ev;
}
const lastGroup = g => g.events.length ? g.events[g.events.length - 1].group : -1;

/* ---------- logging ---------- */
function log(g, t) { if (g.quiet) return; g.log.push(t); if (g.log.length > 300) g.log.splice(0, 100); }
const PN = (g, p) => g.cfg.names ? g.cfg.names[p] : 'Player ' + (p + 1);
const shown = (g, c) => (c.zone === 'm' || c.zone === 'st') && c.pos === 'set' ? 'a face-down card' : name(c);

/* ---------- prompts ---------- */
function* ask(g, p, type, text, opts, min = 1, max = 1, extra = {}) {
  if (!opts.length) return [];
  if (type === 'pick' && min >= opts.length && max >= opts.length && !extra.always) return opts.map(o => o.key);
  const r = yield { p, type, text, opts, min: Math.min(min, opts.length), max: Math.min(max, opts.length), ...extra };
  return r;
}
function* pick(g, p, text, cards, min = 1, max = 1, hint) {
  cards = ssPickable(g, p, text, cards);
  if (!cards.length) return [];
  const r = yield* ask(g, p, 'pick', text, cards.map(c => ({ key: 'u' + c.u, u: c.u, label: shown(g, c) === 'a face-down card' && c.ctrl !== p ? 'Face-down card' : name(c) })), min, max, { hint });
  return r.map(k => cards.find(c => 'u' + c.u === k)).filter(Boolean);
}
/* A choice of what an effect Special Summons lists only monsters that can be Special Summoned now (2026-11-28 audit, findings edison-05..21,
 goat-05/06/11: Call of the Haunted, Mystic Tomato, Pyramid Turtle, Book of Life and about 380 scripts offered Judgment Dragon, Tsukuyomi or
 Spirit of the Pharaoh and then summoned nothing). While a link is being activated or resolves (not its cost), a pick whose prompt says
 "Special Summon" drops the hand, Deck, GY and banished monsters forbid() refuses (summoning conditions, Vanity's Fiend, Koa'ki Meiru
 Drago). Extra Deck monsters are left to the script, which knows whether it is a Fusion or Synchro Summon. Zones are not checked here. */
function ssPickable(g, p, text, cards) {
  // a cost that Tributes doesn't offer a monster that can't be Tributed (Mind Control's monster for Metamorphosis, Summoner Monk)
  if (g.inCost && g.costEff && /Tribut/i.test(text || '') && costTributes(g.costEff.c, g.costEff.eff)) cards = cards.filter(x => !x || !x.flags || !noTribCost(x));
  // a pick made while a link is being activated (its target step) chooses targets: "can't be targeted" cards and Aurkus' Lightsworn are
  // left out, so the about 45 scripts that pick and fill L.t by hand target through the same check as tgt() (2026-11-28 audit)
  if (g.lockL && !g.inCost && !g.pickNoTarget) cards = cards.filter(x => !x || !x.id || canTarget(g, x, g.lockL));
  if (g.inCost || !(g.resolvingL || g.lockL) || !/Special Summon/i.test(text || '')) return cards;
  return cards.filter(x => !(x && x.id && isMon(x) && ['hand', 'deck', 'gy', 'ban'].includes(x.zone)) || !forbid(g, { type: 'ss', c: x, p, how: 'special', inCond: true }));   // inCond: see legacyLock
}
function* yn(g, p, text) { const r = yield* ask(g, p, 'yesno', text, [{ key: 'y', label: 'Yes' }, { key: 'n', label: 'No' }]); return r[0] === 'y'; }
function* choose(g, p, text, labels) { const r = yield* ask(g, p, 'choose', text, labels.map((l, i) => ({ key: 'c' + i, label: l }))); return +r[0].slice(1); }

/* ---------- life points, drawing, moving by effects ---------- */
function checkLP(g) {
  const a = g.p[0].lp <= 0, b = g.p[1].lp <= 0;
  if (a || b) { g.p[0].lp = Math.max(0, g.p[0].lp); g.p[1].lp = Math.max(0, g.p[1].lp); g.winner = a && b ? -1 : a ? 1 : 0; g.why = a && b ? 'Both players hit 0 LP' : `${PN(g, a ? 0 : 1)} hit 0 LP`; log(g, g.why + '.'); throw new Over(); }
}
// the damage p takes after every "damage" static (Des Wombat, Ring of Defense, Prime Material Dragon): a number, or {gain}
function dmgAmount(g, p, n, o) { for (const [s, ct] of statics(g)) if (ct.dmg) { const r = ct.dmg(g, s, p, n, o); if (r && r.gain) return { gain: r.gain }; if (typeof r === 'number') n = r; } return n; }
function damage(g, p, n, o = {}) { return damageMany(g, [[p, n]], o)[0]; }
/* Damage to several players at once (Ring of Destruction, Fairy Wind, Snake Deity...): every amount goes through the damage statics, all
 LP drop together, then one LP check, so both at 0 is a draw (2026-11-27 audit: Ring of Destruction lowered the opponent's LP by hand,
 skipping Des Wombat and Ring of Defense). Returns the damage each took. */
function damageMany(g, list, o = {}) {
  const amts = list.map(([p, n]) => [p, dmgAmount(g, p, n, o)]), out = [];
  for (const [p, r] of amts) { if (r && r.gain) { gain(g, p, r.gain); out.push(0); continue; } const n = r > 0 ? r : 0; out.push(n); if (!n) continue;
    g.p[p].lp -= n; log(g, `${PN(g, p)} took ${n} ${o.battle ? 'battle ' : ''}damage.`); }
  amts.forEach(([p], i) => { if (out[i]) emit(g, { type: 'damage', p, n: out[i], battle: !!o.battle, src: o.src, srcP: o.srcP, direct: !!o.direct }); });
  if (out.some(Boolean)) checkLP(g); return out;
}
// a card that wins the duel (Exodia, Destiny Board): p wins, why says how (Classic cards, 2026-11-25)
// "you win when you have all of these in your hand": a script's self.handWin(g, c, p) on any card in that hand
function handWin(g, p) { if (g.p[p].lp <= 0) return; for (const x of g.p[p].hand) { const sc = SC(x); if (sc && sc.self && sc.self.handWin && sc.self.handWin(g, x, p)) winDuel(g, p, `${PN(g, p)} won with ${D(x).n}`); } }
function winDuel(g, p, why) { g.winner = p; g.why = why; log(g, why + '.'); throw new Over(); }
// coin tosses and dice rolls, from the duel's own seeded random (replays and the computer's copies stay the same)
function coin(g, p) { const h = g.rnd() < 0.5; log(g, `${PN(g, p)} tossed a coin: ${h ? 'Heads' : 'Tails'}.`); return h; }
function dice(g, p) { const n = 1 + Math.floor(g.rnd() * 6); log(g, `${PN(g, p)} rolled a ${n}.`); return n; }
/* One shared die roll (2026-11-28 audit, goat-07): rolls k dice for player p and lets a player with an unused Dice Re-Roll this turn
 (g.reroll[q] = {turn, used}) have them rolled again, every die of that roll together (Dice Re-Roll ruling 4: Roulette Barrel's two dice).
 Returns the number (k = 1) or the list. Card scripts call yield* L.roll(g, p) in place of dice(). */
function* roll(g, p, k = 1) {
  let ns = []; for (let i = 0; i < k; i++) ns.push(dice(g, p));
  for (const q of [p, 1 - p]) {
    const r = g.reroll && g.reroll[q];
    if (r && r.turn === g.turnNo && !r.used && (yield* yn(g, q, `${PN(g, p)} rolled ${ns.join(' and ')}. Use Dice Re-Roll to roll again?`))) { r.used = true; log(g, `${PN(g, q)} used Dice Re-Roll.`); ns = []; for (let i = 0; i < k; i++) ns.push(dice(g, p)); }
  }
  return k === 1 ? ns[0] : ns;
}
/* Gaining or paying LP is something that happens: an 'lp' event in its own group, so a "when ... you can" trigger on an earlier event of the
 same effect misses its timing (2026-11-28 audit, Upstart Goblin site ruling: "If Infernity Archfiend is drawn by this effect, it misses its
 timing"), and LP watchers can read it. */
function lpEv(g, p, n, kind) { g.group++; emit(g, { type: 'lp', p, n, kind }); }
function gain(g, p, n) { if (n <= 0) return; g.p[p].lp += n; log(g, `${PN(g, p)} gained ${n} LP.`); lpEv(g, p, n, 'gain'); }
/* An LP payment hook (2026-11-28 audit, goat-09: Spell Economics, "You don't pay LP to activate Spell Cards"): while a Spell Card's
 activation pays its cost, a face-up, not negated static cont.noSpellLP(g, src, p) waives it (ruling 1: not a Spell's effect like
 Archfiend's Oath; ruling 2: only its controller). spellLPFree(g, p) answers for a cond. */
const spellLPFree = (g, p) => statics(g).some(([s, ct]) => ct.noSpellLP && ct.noSpellLP(g, s, p));
/* Can player p pay n LP as a cost (2026-11-28 audit, E4)? Goat: no payment may bring the LP to 0 (Netrep Q&A on Imperial Order, Curtis
 Schultz 2003: "They cannot choose to pay if it would make their Life Points become 0"; Skull Archfiend of Lightning: "enough Life Points to
 remain above 0"). Edison: the site and archive are silent, so EDOPro's Duel.CheckLPCost applies (a cost up to the current LP can be paid,
 and the player then loses). c (optional): the Spell Card whose activation pays, which Spell Economics makes free. */
/* The most LP player p can pay (lpPayable): all of it in Edison, all but 1 in Goat. */
const lpPayable = (g, p) => FMT === 'goat' ? g.p[p].lp - 1 : g.p[p].lp;
const canPay = (g, p, n, c) => (c && isSpell(c) && spellLPFree(g, p)) || (FMT === 'goat' ? g.p[p].lp > n : g.p[p].lp >= n);
function pay(g, p, n) {
  if (n > 0 && g.inCost && g.costEff && g.costEff.eff && g.costEff.eff.type === 'act' && isSpell(g.costEff.c) && spellLPFree(g, p)) { log(g, `${PN(g, p)} paid no LP (Spell Economics).`); return; }
  g.p[p].lp -= n; log(g, `${PN(g, p)} paid ${n} LP.`); if (n > 0) lpEv(g, p, n, 'pay'); }
/* Lingering effects that check drawn cards (Deck Devastation Virus: "is destroyed immediately and cannot chain its effect (because this
 does not start a Chain)"; a draw by an effect is checked once that effect has resolved: archive) register with E.lib.onDraw(f), called
 as f(g, cards) with no chain link. */
const DRAW_HOOKS = [];
function drawnCheck(g, cs) { for (const f of DRAW_HOOKS) f(g, cs); }
function draw(g, p, n = 1) {
  const drawn = [];
  try {
    for (let i = 0; i < n; i++) {
      if (forbid(g, { type: 'draw', p })) return;
      const P = g.p[p]; if (!P.deck.length) { g.winner = 1 - p; g.why = `${PN(g, p)} couldn't draw`; log(g, g.why + '.'); throw new Over(); }
      const c = P.deck[P.deck.length - 1]; move(g, c, 'hand', { reason: 'draw' }); drawn.push(c);
    }
    if (n) log(g, `${PN(g, p)} drew ${n === 1 ? 'a card' : n + ' cards'}.`);
  } finally { if (drawn.length && DRAW_HOOKS.length && g.winner == null) { if (g.resolvingL) (g.drawPend || (g.drawPend = [])).push(...drawn); else drawnCheck(g, drawn); } }
}
function mill(g, p, n, o = {}) { const out = []; for (let i = 0; i < n && g.p[p].deck.length; i++) { const c = g.p[p].deck[g.p[p].deck.length - 1]; move(g, c, 'gy', { reason: o.reason || 'effect' }); out.push(c); } if (out.length) log(g, `${PN(g, p)} sent ${out.map(name).join(', ')} from the Deck to the GY.`); return out; }
function* search(g, p, filter, text, to = 'hand') {
  if (to === 'hand' && forbid(g, { type: 'search', p })) { log(g, 'Cards can\u2019t be added from the Deck right now.'); return null; }
  const cands = g.p[p].deck.filter(filter); if (!cands.length) { shuffleDeck(g, p); return null; }
  const [c] = yield* pick(g, p, text, cands, 1, 1, 'good');
  if (c) { if (to === 'hand') { move(g, c, 'hand', { reason: 'effect' }); log(g, `${PN(g, p)} added ${name(c)} from the Deck to the hand.`); } else { move(g, c, to, { reason: 'effect' }); log(g, `${PN(g, p)} sent ${name(c)} from the Deck to the GY.`); } }
  shuffleDeck(g, p); return c;
}
/* Destroy: checks "can't be destroyed", returns the cards destroyed. */
function destroy(g, cards, o = {}) {
  const out = [], moved = []; const group = o.group != null ? o.group : g.group;
  const by = o.by != null ? o.by : !o.battle && g.resolvingL ? g.resolvingL.p : undefined;   // the player whose effect destroys (move's by)
  const ro = { ...o, by, batch: o.batch || cards };
  for (const c of cards) {
    if (!c || !onField(c)) continue;
    // a monster already destroyed by this battle (waiting to leave after damage calculation) isn't destroyed again by an effect: it is
    // destroyed by battle (2026-11-28 audit, edison-21: Red Dragon Archfiend's effect and XX-Saber Emmersblade)
    if (!o.battle && c.flags.battleDoomed) continue;
    if (o.battle && cantBattleDestroy(g, c)) continue;
    if (!o.battle && !o.rule && faceUp(c) && has(g, c, 'noEffectDestroy')) continue;
    const rp = replaced(g, c, ro); if (rp === 'moved') { moved.push(c); continue; } if (rp) continue;
    // the card doing the destroying: the script's src, else the chain link resolving now (2026-11-26: Mirror Force passed no src,
    // so "unaffected by Traps" monsters like Wildheart were still destroyed)
    const src = o.src || (!o.battle && !o.rule && g.resolvingL ? g.resolvingL.c : null);
    if (!o.battle && src && faceUp(c) && isST(src) && has(g, c, isSpell(src) ? 'unaffectedSpells' : 'unaffectedTraps')) continue;
    out.push(c);
  }
  // cards destroyed together leave together: every protection is checked first, while all of them are still on the field
  // (2026-11-26: a Dark Hole that removed The Lady in Wight or Orichalcos Shunoros first also destroyed what they protect)
  for (const c of out) move(g, c, o.banish ? 'ban' : 'gy', { reason: o.battle ? 'battle' : 'effect', destroyed: true, battle: !!o.battle, killer: o.killer, by, group, noLater: true, ...(o.rule ? { rule: true } : null) });
  if (!o.noFlush) flushLater(g, group);
  if (out.length && !o.quietLog) log(g, `${out.map(x => x.snapName || name(x)).join(', ')} ${out.length > 1 ? 'were' : 'was'} destroyed${o.banish ? ' and banished' : ''}.`);
  return moved.length ? [...out, ...moved] : out;   // a card destroyed that went elsewhere instead of the GY still counts as destroyed
}
function replaced(g, c, o) { // "destroy X instead" style effects
  const sc = SC(c); if (sc && sc.self && sc.self.replaceDestroy && faceUp(c) && !negd(g, c) && sc.self.replaceDestroy(g, c, o)) return true;
  for (const [s, ct] of statics(g)) if (ct.replaceDestroy && ct.replaceDestroy(g, s, c, o)) return true;
  // optional replacements the player chooses ("you can destroy another ... instead"): the answer askReplace got, else the first option
  for (const [h, r] of replAsks(g, c)) {
    if (g.replBusy && g.replBusy.length) break;   // the card destroyed instead doesn't use a replacement of its own (no replacement loops)
    const xs = r.opts(g, h, c, o); if (!xs || !xs.length) continue;
    const plan = g.replPlan && g.replPlan[h.u + ':' + c.u];
    if (plan && plan.no) continue;
    if (!plan && r.unasked === 'no') continue;
    const x = plan && xs.includes(plan.pick) ? plan.pick : xs[0];
    (g.replBusy || (g.replBusy = [])).push(h);
    try { const v = r.apply(g, h, c, o, x); if (v) return v; } finally { g.replBusy.pop(); }
  }
  return false;
}
/* Optional "instead" replacements (2026-11-28 audit, E3b: Six Samurai, Nettles, Clear Vice Dragon, Morphtronic Slingen, Power Tool Dragon,
 Crystal Beasts). A card describes one as self.replaceAsk (while it is face-up and not negated) or cont.replaceAsk (a static, for any card):
   { opts(g, h, c, o): the cards it could use instead (or [true] for a plain yes/no), empty when it can't apply to c now; o.batch is every
     card destroyed together, which can't stand in for each other (Six Samurai ruling 14);
     text(g, h, c): the question; pickText; who(g, h, c): who answers (default the controller of h);
     apply(g, h, c, o, x): does it, true when c is no longer destroyed (or went elsewhere instead) }
 destroy() is synchronous, so the engine asks before the destruction while it still can (askReplace): when a chain link is about to
 resolve, for the cards it would destroy (wouldDestroy), and in the Damage Step before battle destruction. The answers sit in g.replPlan
 for that destruction; a destruction the engine couldn't foresee applies the first option (unasked: 'no' leaves it off instead).
 Rulings: Six Samurai "you choose ... when the destruction occurs", each protected one needs its own substitute (rulings 12 to 14); Crystal
 Beasts "you choose ... at the time the destroyed monster would be sent to the Graveyard" (ruling 3), no chain (ruling 4). */
function replAsks(g, c) {
  const out = []; const sc = SC(c);
  if (sc && sc.self && sc.self.replaceAsk && onField(c) && faceUp(c) && !negd(g, c)) out.push([c, sc.self.replaceAsk]);
  for (const [s, ct] of statics(g)) if (ct.replaceAsk) out.push([s, ct.replaceAsk]);
  return out;
}
/* The common shape: "if this card would be destroyed, you can <destroy / discard / send to the GY> <a card from pool> instead". how: 'destroy'
 (default), 'discard' (from the hand) or 'gy'. A card destroyed in the same destruction can't stand in (o.batch). */
function replaceOther(pool, text, pickText, how = 'destroy', cond) {
  return { opts: (g, h, c, o) => h !== c || (cond && !cond(g, c, o)) ? [] : (pool(g, c, o) || []).filter(x => x && x !== c && !(o.batch && o.batch.includes(x)) && (how === 'discard' ? x.zone === 'hand' : onField(x))),
    text: (g, h, c) => text.replace('%s', name(c)), pickText: () => pickText,
    apply: (g, h, c, o, x) => {
      if (how === 'destroy') { if (!destroy(g, [x], { by: c.ctrl, src: c, quietLog: true }).length) return false; }
      else { move(g, x, 'gy', { reason: how === 'discard' ? 'discard' : 'effect', by: c.ctrl }); if (onField(x) || x.zone === 'hand') return false; }
      log(g, `${PN(g, c.ctrl)} ${how === 'destroy' ? 'destroyed' : how === 'discard' ? 'discarded' : 'sent'} ${name(x)} instead of ${name(c)}${how === 'gy' ? ' to the GY' : ''}.`); return true; } };
}
// A Union Monster equipped by its own effect: "If the equipped monster would be destroyed, destroy this card instead" (cont.replaceDestroy)
const unionStandIn = (g, src, m, o) => {
  if (o.rule || src.zone !== 'st' || src.equipTo !== m.u || !src.flags.union || !faceUp(src)) return false;
  move(g, src, 'gy', { reason: o.battle ? 'battle' : 'effect', destroyed: true, by: o.by }); log(g, `${D(src).n} was destroyed instead of ${name(m)}.`); return true; };
/* The Crystal Beast rule: "If this face-up card in your possession is destroyed in a Monster Zone, you can place it face-up in your Spell &
 Trap Zone as a Continuous Spell Card, instead of sending it to the GY" (2026-11-28 audit, edison-16): an optional replacement with no chain
 (rulings 3 and 4), chosen when it would go to the GY, by its controller then (ruling 7); not while negated (Skill Drain, ruling 11), not
 when it is banished instead (Bottomless Trap Hole, Dark Magician of Chaos: rulings 9 and 10); Macro Cosmos doesn't stop it (ruling 8).
 It is still destroyed (destroy() counts it). placed(g, p) tells the card file (Crystal Tree's event). */
const cbReplace = placed => ({ opts: (g, h, c, o) => h === c && c.zone === 'm' && !o.banish && !(o.battle && o.killer && onField(o.killer) && faceUp(o.killer) && has(g, o.killer, 'battleBanish')) && freeST(g, c.ctrl) >= 0 ? [true] : [],
  text: (g, h, c) => `Place ${name(c)} face-up in your Spell & Trap Zone instead of sending it to the GY?`,
  apply: (g, h, c, o) => { const p = c.ctrl; move(g, c, 'st', { ctrl: p, pos: 'up', reason: o.battle ? 'battle' : 'effect', destroyed: true, battle: !!o.battle, killer: o.killer, by: o.by, noLater: true });
    if (c.zone !== 'st') return false; log(g, `${PN(g, p)} placed ${D(c).n} in the Spell & Trap Zone as a Continuous Spell instead.`); if (placed) placed(g, p); return 'moved'; } });
function* askReplace(g, cs, o = {}) {
  const plan = {}, used = new Set(); cs = [...new Set((cs || []).filter(c => c && onField(c)))];
  for (const c of cs) {
    if (!o.battle && faceUp(c) && has(g, c, 'noEffectDestroy')) continue;
    for (const [h, r] of replAsks(g, c)) {
      const xs = (r.opts(g, h, c, { ...o, batch: o.batch || cs }) || []).filter(x => x === true || !used.has(x)); if (!xs.length) continue;
      const p = r.who ? r.who(g, h, c) : h.ctrl, key = h.u + ':' + c.u;
      if (!(yield* yn(g, p, r.text(g, h, c)))) { plan[key] = { no: true }; continue; }
      let x = xs[0]; if (xs.length > 1) [x] = yield* pick(g, p, r.pickText ? r.pickText(g, h, c) : 'Use which card instead?', xs, 1, 1, 'cost');
      plan[key] = { pick: x }; if (x !== true) used.add(x); break;
    }
  }
  return plan;
}
/* What a chain link would destroy when it resolves (2026-11-27 audit: Starlight Road, My Body as a Shield, Prime Material Dragon and
 Stardust Dragon asked a hand-written list in batch-1.js, so Dark Hole, Raigeki, Fissure and Judgment Dragon read as "destroys nothing",
 and Stardust's own check only read the static destroy tag, so it could negate Red Dragon Archfiend's End Phase with nothing to destroy).
 Only what is certain counts (Stardust ruling 6: not "Barrel Dragon" or "Snipe Hunter", which may or may not destroy). In order:
 1. the effect's own eff.destroys(g, c, p, L), for effects whose cards the text can't name (Red Dragon Archfiend, Bottomless Trap Hole);
 2. a card that negates an activation "and destroys it" destroys the card below it on the chain, if that card is on the field
    (Solemn Judgment or Magic Jammer on a Spell/Trap; EDOPro's Solemn declares the destroy only then, and a summon isn't on the field yet,
    Stardust ruling 8);
 3. a destroy effect's one "destroy all ..." (or "the face-up monster ... with the lowest/highest ATK/DEF") sentence, read from the text,
    plus its targets; 4. its targets on the field; 5. the monster it battles or the monsters just summoned, when the text says "that monster". */
const DW_SUFFIX = [
  [/^on the field\b/, null], [/^(?:that )?(?:your opponent|they) controls?\b|^on your opponent's side of the field\b|^in your opponent's spell (?:&|and) trap (?:card )?zones\b/, 'opp'],
  [/^(?:that )?you control\b|^on your side of the field\b/, 'me'], [/^each player controls\b/, null],
];
function dwParse(g, L, phrase) {
  let s = phrase.toLowerCase().replace(/"/g, '').replace(/\s+/g, ' ').trim()
    .replace(/(?:,| and (?:inflict|draw|then|if|take|gain|you|your|banish|send|return|special)| then | also\b| \(| except this card| other than this card| during the end phase).*$/, '').trim();
  let other = /^other\b/.test(s); if (other) s = s.slice(6).trim();
  let own = null; let m;
  if ((m = s.match(/^(?:of )?(?:your opponent's|their|the opponent's)\s+/))) { own = 'opp'; s = s.slice(m[0].length); }
  else if ((m = s.match(/^(?:of )?your\s+/))) { own = 'me'; s = s.slice(m[0].length); }
  if (/^other\b/.test(s)) { other = true; s = s.slice(6).trim(); }
  let face = null, pos = null, kind = null;
  if ((m = s.match(/^(face-up|face-down|set)\s+/))) { face = m[1] === 'face-up' ? 'up' : 'down'; s = s.slice(m[0].length); }
  if ((m = s.match(/^(attack|defense) position\s+/))) { pos = m[1] === 'attack' ? 'atk' : 'def'; s = s.slice(m[0].length); }
  const quals = [];   // words before the noun: a Level, an Attribute, a Type, "Special Summoned", "Normal", "Continuous" ...
  if ((m = s.match(/^and non-(dark|light|earth|water|fire|wind) /)) && face === 'down') { const a = m[1].toUpperCase(); face = null; quals.push(x => !faceUp(x) || attr(x) !== a); s = s.slice(m[0].length); }
  for (let k = 0; k < 4; k++) {
    if ((m = s.match(/^level (\d+)(?: or (lower|less|higher|more))? /))) { const n = +m[1], dir = m[2]; quals.push(x => faceUp(x) && (!dir ? lv(x) === n : /lower|less/.test(dir) ? lv(x) <= n : lv(x) >= n)); }
    else if ((m = s.match(/^(dark|light|earth|water|fire|wind|divine) /))) { const a = m[1].toUpperCase(); quals.push(x => faceUp(x) && attr(x) === a); }
    else if ((m = s.match(/^(warrior|spellcaster|fairy|fiend|zombie|machine|aqua|pyro|rock|winged beast|plant|insect|thunder|dragon|beast-warrior|beast|dinosaur|fish|sea serpent|reptile|psychic)(?:-type)? /))) { const r = m[1]; quals.push(x => faceUp(x) && race(x).toLowerCase() === r); }
    else if ((m = s.match(/^special summoned /))) quals.push(x => ['special', 'synchro', 'fusion', 'ritual'].includes(x.summonType) || D(x).k === 'token');
    else if ((m = s.match(/^normal (?=monsters?)/))) quals.push(x => D(x).k === 'normal');
    else if ((m = s.match(/^(continuous|equip|field|quick-play) (?=spell|trap|cards?)/))) { const sub = m[1][0].toUpperCase() + m[1].slice(1); quals.push(x => faceUp(x) && D(x).sub === sub); }
    else break;
    s = s.slice(m[0].length);
  }
  if ((m = s.match(/^monsters equipped with (?:an )?equip cards?(?:\(s\))?/))) { quals.push(x => allField(g).some(y => y.equipTo === x.u)); s = 'monsters' + s.slice(m[0].length); }
  if ((m = s.match(/^monster cards?\b/))) s = 'monsters' + s.slice(m[0].length);
  if ((m = s.match(/^tokens?\b/))) { quals.push(x => D(x).k === 'token'); s = 'monsters' + s.slice(m[0].length); }
  if ((m = s.match(/^spells? ?(?:and|or|&|\/) ?traps?(?: cards?)?\b/))) kind = 'st';
  else if ((m = s.match(/^spells?(?: cards?)?\b/))) kind = 'spell';
  else if ((m = s.match(/^traps?(?: cards?)?\b/))) kind = 'trap';
  else if ((m = s.match(/^monsters?\b/))) kind = 'mon';
  else if ((m = s.match(/^cards?\b/))) kind = 'card';
  if (!kind) return null; s = s.slice(m[0].length).trim();
  for (let k = 0; k < 2; k++) for (const [re, o] of DW_SUFFIX) if ((m = s.match(re))) { if (o) own = o; s = s.slice(m[0].length).trim(); break; }
  let filt = null;
  if ((m = s.match(/^(?:with|that have) (\d+) or (less|lower|more|higher) (atk|def)\b/)) || (m = s.match(/^(?:with|that have) (atk|def) (\d+) or (less|lower|more|higher)\b/))) {
    const [n, dir, st] = /\d/.test(m[1]) ? [+m[1], m[2], m[3]] : [+m[2], m[3], m[1]];
    filt = x => faceUp(x) && (/less|lower/.test(dir) ? stat(g, x, st) <= n : stat(g, x, st) >= n); s = s.slice(m[0].length).trim();
  } else if ((m = s.match(/^(?:that are )?level (\d+) or (lower|less|higher|more)\b/))) {
    const n = +m[1], dir = m[2]; filt = x => faceUp(x) && (/lower|less/.test(dir) ? lv(x) <= n : lv(x) >= n); s = s.slice(m[0].length).trim();
  }
  if (s) return null;   // a condition the reader doesn't know (Ojamuscle's names, Makiu's "DEF less than that monster's ATK"): not certain
  let cs = kind === 'mon' ? fieldMons(g) : kind === 'card' ? allField(g) : stOnField(g);
  if (kind === 'spell') cs = cs.filter(isSpell); if (kind === 'trap') cs = cs.filter(isTrap);
  if (own) cs = cs.filter(x => (x.ctrl === L.p) === (own === 'me'));
  if (face) cs = cs.filter(x => faceUp(x) === (face === 'up'));
  if (pos) cs = cs.filter(x => (pos === 'atk' ? x.pos === 'atk' : x.pos !== 'atk'));
  if (filt) cs = cs.filter(filt);
  for (const q of quals) cs = cs.filter(q);
  if (other || L.cardAct) cs = cs.filter(x => x !== L.c);
  return cs;
}
function dwText(g, L) {
  const t = String(D(L.c).ps || D(L.c).tx || '').replace(/\n/g, ' ');
  const found = [];
  for (const m of t.matchAll(/\bdestroy (?:all|every) ([^.;:]*)/gi)) found.push(dwParse(g, L, m[1]));
  for (const m of t.matchAll(/\bdestroy the (?:1 )?face-up monsters? (your opponent controls|you control|on the field) (?:that has|with) the (lowest|highest) (ATK|DEF)/gi)) {
    let cs = fieldMons(g).filter(faceUp); if (m[1] !== 'on the field') cs = cs.filter(x => (x.ctrl === L.p) === (m[1] === 'you control'));
    // which one is decided at resolution, so no single card is certain (Morphtronic Forcefield ruling 2: "uncertain to destroy" a given
    // monster, "like Fissure or Smashing Ground"), but one of them will be (My Body as a Shield ruling 1 lists Fissure): maybe + n
    found.push(Object.assign([], cs.length ? { maybe: cs, n: 1 } : {}));
  }
  return found.length === 1 ? found[0] : (found.length ? null : undefined);   // undefined: no such sentence; null: can't tell
}
const COINDIE_RE = /\b(?:toss|tosses|tossed|roll|rolls|rolled)\b[^.]{0,40}\b(?:coins?|dice|a die|die)\b/i;
function wouldDestroy(g, L) {
  if (!L || L.negated) return [];
  const on = xs => [...new Set((xs || []).filter(x => x && onField(x)))];
  if (L.eff.destroys) { const r = L.eff.destroys(g, L.c, L.p, L) || []; return Object.assign(on(r), r.maybe ? { maybe: on(r.maybe), n: r.n } : {}); }
  // a coin toss or die roll decides it: never certain (Stardust Dragon ruling 6: not "Barrel Dragon"; 2026-11-28 audit)
  if (COINDIE_RE.test(String(D(L.c).ps || D(L.c).tx || ''))) return [];
  const t = String(D(L.c).ps || D(L.c).tx || '');
  if (/negate (?:the|its|that|their)? ?(?:activation|summon)[^.]*\bdestroy (?:it|that card|the card|them)\b/i.test(t)) {
    const below = g.chain[g.chain.indexOf(L) - 1], ref = (L.data && L.data.L) || below;
    if (ref && ref !== L && L.data && L.data.mode !== 'summon') return on([ref.c]);
  }
  if (!(L.tags && L.tags.destroy)) return [];
  const tg = on(L.t), txt = dwText(g, L);
  if (txt) return Object.assign(on([...txt, ...tg]), txt.maybe ? { maybe: on(txt.maybe), n: txt.n } : {});
  if (tg.length) return tg;
  if (txt === null) return [];
  const ev = L.ev;
  if (ev && /\bdestroy (?:that|the|those) (?:opponent's |attacking |battling |summoned )?monsters?\b|\bdestroy it\b/i.test(t)) {
    if (ev.a && (ev.a === L.c || ev.t === L.c)) return on([ev.a === L.c ? ev.t : ev.a]);
    if (ev.type === 'summon' && ev.cs) return on(ev.cs);
  }
  return [];
}
// Will the link certainly destroy at least one card that passes f (default: any card)? Counts a "the 1 monster with the lowest ATK" pick
// when every card it could pick passes f.
function destroysSome(g, L, f = () => true) { const r = wouldDestroy(g, L); return r.some(f) || !!(r.maybe && r.n > 0 && r.maybe.length && r.maybe.every(f)); }
function cantBattleDestroy(g, c) {
  if (!faceUp(c) && c.pos !== 'def') return false;
  const n = D(c).n, neg = negd(g, c);
  if (!neg && (n === 'Spirit Reaper' || n === 'Blackwing Armor Master')) return true;
  if (has(g, c, 'noBattleDestroy')) return true;
  if (isFrog(c) && D(c).n !== 'Frog the Jam' && fieldMons(g).some(x => faceUp(x) && D(x).n === 'Substitoad' && !negd(g, x))) return true;   // both players' Frogs (site ruling)
  if (isBW(c) && g.tp !== c.ctrl && !g.silverwindUsed[c.ctrl] && monsOf(g, c.ctrl).some(x => faceUp(x) && D(x).n === 'Blackwing - Silverwind the Ascendant' && !negd(g, x))) { g.silverwindUsed[c.ctrl] = true; return true; }
  return false;
}
/* Position choice (2026-11-27, a player report: "you can't choose the position of the monster you are Special Summoning"): with cfg.askPos
 (the play client), a monster Special Summoned by an effect whose text names no position asks its controller Attack or Defense once the
 effect has resolved (askPositions), and inherent Special Summons (contact Fusion, a summon from the hand) ask before they happen, like
 Synchro Summons always have. Off by default, so tests and the Edison site's duel play as before. */
const POS_RE = /Attack Position|Defense Position|face-down|face-up Defense|in Defense|in Attack/i;
// Only the sentences that Special Summon count (2026-11-27, a second report: a position named anywhere else in the text, like Red-Eyes
// Zombie Dragon's or Infernity Necromancer's, used to skip the question). A text with no "Special Summon" sentence falls back to all of it.
function namesPos(tx) { const ss = String(tx || '').split(/(?<=[.:;])\s+|\n/).filter(x => /Special Summon/i.test(x)); return (ss.length ? ss : [String(tx || '')]).some(x => POS_RE.test(x)); }
E.namesPos = namesPos;
function askPosFor(g) { const L = g.resolvingL; if (!g.cfg.askPos || !L) return false; const d = D(L.c); return !namesPos(d.ps || d.tx || ''); }
E.askPosQueue = (g, c, p, pos) => { if (pos !== 'set' && askPosFor(g)) (g.posAsk = g.posAsk || []).push({ c, p }); };
function* askPositions(g) {
  const q = g.posAsk; g.posAsk = null; if (!q) return;
  for (const { c, p } of q) { if (c.zone !== 'm' || c.pos === 'set' || c.ctrl !== p) continue;
    const i = yield* choose(g, p, `${name(c)}: which position?`, ['Attack Position', 'Defense Position']);
    const pos = i ? 'def' : 'atk'; if (pos !== c.pos) { c.pos = pos; log(g, `${PN(g, p)} put ${name(c)} in ${i ? 'Defense' : 'Attack'} Position.`); } }
}
/* ---------- summoning conditions (2026-11-27 audit, Group B) ----------
 Read from the card's own text, so every card with the line gets it (Blizzard, Tsukuyomi, Dark Armed Dragon, Chaos Sorcerer, BLS -
 Envoy, Absolute Zero, Gaia...). forbid() applies them to every Special Summon by an effect (ss) and to the idle procedures:
 - "Cannot be Special Summoned." (never): from anywhere, by anything (Blizzard's own effect can't revive another Blizzard).
 - "Cannot be Special Summoned from the GY / hand / Deck": that place only.
 - Summon-only monsters (nomi): "Must be Special Summoned (from your hand) by ...", "Must be Special Summoned with/by "X"",
   "Must be Fusion/Synchro Summoned", "Cannot be Special Summoned except ...", "... and Cannot be Special Summoned by other ways":
   only their own way, and never back from the GY or banished pile, even after a proper summon (Dark Armed Dragon ruling 3, the
   Edison archive on Absolute Zero and Gaia, the Goat archive on Dark Paladin; EDOPro's summon condition says the same).
 - "Must first be Special Summoned ..." and "This card can only be Special Summoned by ..." (the older wording the 2010 text
   rewrote as "Must first be": Silpheed, Fenrir, Soul of Purity and Light, Air Neos): their own way first; once properly summoned
   they can come back from the GY or banished pile (Chaos Sorcerer archive: "If successfully summoned ... Call of the Haunted").
 - By rule, Fusion, Synchro and Ritual Monsters in the GY or banished come back only if they were properly summoned
   (Metamorphosis ruling: it "does not properly Summon a Fusion Monster, so you cannot use Monster Reborn on it afterwards").
 A summon is "its own way" when it is the card's procedure (specialProc, the idle option: a.proc), a Fusion/Synchro/Ritual Summon
 its text asks for (a.how), an effect of the card itself, or an effect of a card its condition names ("with "Dark Fusion"", "by
 "Armed Dragon LV5""), found from a.src, the card activating now (g.ssSrc) or the link resolving. c.proper marks a proper summon;
 it lasts through the field, GY and banished pile and is lost in the hand, Deck or Extra Deck. o.proper on ss() forces it. */
const SSC = new Map();
const SS_PROBES = [
  { id: 'probe-ss-a', n: '(any monster)', k: 'token', a: 'EARTH', r: 'Beast', lv: 1, atk: '0', def: '0' },
  { id: 'probe-ss-b', n: '(any monster)', k: 'effect', a: 'DARK', r: 'Fiend', lv: 8, atk: '2500', def: '2000' },
];
function ssCond(c) {
  const d = D(c); if (!d) return null; if (SSC.has(d.id)) return SSC.get(d.id);
  const r = { never: false, nomi: false, first: false, how: null, names: [], zones: [] };
  const sents = String(d.ps || d.tx || '').replace(/[\u24b8\u24c8\u00a9\u25cf\u2460-\u2469]/g, ' ').split(/(?<=[.;])\s+|\n/).map(x => x.trim()).filter(Boolean);
  if (isMonD(d) && d.k !== 'token') for (const s of sents) {
    if (!/Special Summon|Fusion Summon|Synchro Summon|Ritual Summon/i.test(s)) continue;
    if (/^(?:This (?:card|monster) )?Cannot be Special Summoned\.?$/i.test(s)) { r.never = true; continue; }
    const fz = s.match(/^(?:This card )?Cannot be Special Summoned from (?:the |your )?(GY|Graveyard|hand\/Deck|hand or Deck|Deck|hand)\.?$/i);
    if (fz) { const z = fz[1].toLowerCase(); if (/gy|graveyard/.test(z)) r.zones.push('gy'); if (/hand/.test(z)) r.zones.push('hand'); if (/deck/.test(z)) r.zones.push('deck'); continue; }
    // conditions their own scripts handle (Felgrand Dragon, Vennominon, Tyrant Dragon, Destiny HERO - Disk Commander)
    if (/except from the (?:GY|Graveyard)|by another Effect Monster|unless|the turn this card/i.test(s)) continue;
    const nomi = /Must be (?:Special|Fusion|Synchro|Ritual) Summoned|Cannot be Special Summoned,? except|cannot be Special Summoned by other ways/i.test(s);
    const first = /Must first be (?:Special|Fusion|Synchro|Ritual) Summoned|can only be Special Summoned/i.test(s);
    if (!nomi && !first) continue;
    if (nomi) r.nomi = true; else r.first = true;
    const h = s.match(/Must be (Fusion|Synchro|Ritual) Summoned|except by (Fusion|Synchro|Ritual) Summon/i); if (h) r.how = (h[1] || h[2]).toLowerCase();
    for (const m of s.matchAll(/"([^"]+)"/g)) r.names.push(m[1]);
  }
  if (r.nomi && SS_AS_FIRST.includes(d.n)) { r.nomi = false; r.first = true; }
  SSC.set(d.id, r); return r;
}
// Texts that read "Must be Special Summoned" but were ruled revivable once properly summoned: Chaos Emperor Dragon (the format sites and
// archives are silent; its 2005 text read "can only be Special Summoned by", like BLS - Envoy, and EDOPro's pre-errata version only
// limits revival to a proper summon first).
const SS_AS_FIRST = ['Chaos Emperor Dragon - Envoy of the End'];
const ssSrcOf = (g, a) => a.src || g.ssSrc || (g.resolvingL && g.resolvingL.c) || null;
function ssOwnWay(g, c, a, k) {   // is this Special Summon the card's own way (its procedure, its Fusion/Synchro/Ritual Summon, its enabler)?
  if (a.proc || a.proper) return true;
  if (k.how && a.how === k.how) return true;
  const src = ssSrcOf(g, a); if (!src || !src.id) return false;
  if (src === c || k.names.includes(D(src).n)) return true;
  // a card whose summon "is treated as a Fusion Summon with "Dark Fusion"" (Dark Calling) counts as the card it names
  const as = String(D(src).ps || D(src).tx || '').match(/treated as (?:a |an )?(?:Special|Fusion|Synchro|Ritual) Summon (?:with|by) "([^"]+)"/i);
  return !!as && k.names.includes(as[1]);
}
function ssLimited(g, a) {   // a summoning condition stops this Special Summon (a: the forbid() action, type 'ss')
  const c = a.c; if (!c || !c.id || a.probe) return false;
  const d = D(c); if (!d || !isMonD(d) || d.k === 'token') return false;
  const k = ssCond(c), dead = c.zone === 'gy' || c.zone === 'ban';
  const src = ssSrcOf(g, a);   // "Special Summon ... ignoring its Summoning conditions" (Assault Revival) sets them all aside
  if (src && src.id && /ignoring (?:its|their|the) Summoning conditions/i.test(String(D(src).ps || D(src).tx || ''))) return false;
  if (k.never) return !a.proper && !a.proc;   // a procedure its own script gives it (The Wicked Avatar's 3-Tribute summon) is its own way
  if (k.zones.includes(c.zone)) return true;
  const own = ssOwnWay(g, c, a, k);
  if (k.nomi) return !own;
  if (dead && (k.first || isExtraD(d) || d.k === 'ritual')) return !own && !c.proper;
  if (k.first) return !own;
  return false;
}
function properSummon(g, c, o) {   // does this effect Special Summon count as properly summoning it (for a later revival)?
  const d = D(c), k = ssCond(c); if (!d || !k) return false;
  if (o.proper || (o.how && o.how === d.k)) return true;
  return (k.nomi || k.first) && ssOwnWay(g, c, { how: o.how, src: o.src }, k);
}
/* Can nothing be Special Summoned by p right now (Vanity's Fiend, the turn of Scapegoat)? Two unlike stand-in monsters are tried, so a
 lock on some monsters only (DARK only, no Tokens) doesn't count. Cards and effects that Special Summon can't be activated then
 (Vanity's Fiend rulings: "Scapegoat and Premature Burial cannot be activated"; mandatory effects still activate and summon nothing). */
function ssBlanket(g, p, src) {
  return SS_PROBES.every(pr => forbid(g, { type: 'ss', c: { id: pr.id, owner: p, ctrl: p, flags: {}, used: {}, zone: 'probe' }, p, how: 'special', src, probe: true }));
}
const canSS = (g, p, c, o = {}) => freeM(g, p) >= 0 && !forbid(g, { type: 'ss', c, p, how: o.how || 'special', src: o.src });
// can p Special Summon this monster by an effect (summoning conditions and locks; zones not counted)? Used by effects' conds
const ssable = (g, p, c, o = {}) => !!c && isMon(c) && !forbid(g, { type: 'ss', c, p, how: o.how || 'special', src: o.src, inCond: true });
function ss(g, p, c, pos = 'atk', o = {}) { // Special Summon by an effect (no negation window of its own)
  const zi = freeM(g, p); if (zi < 0) return false;
  if (forbid(g, { type: 'ss', c, p, how: o.how || 'special', src: o.src, proper: o.proper })) { log(g, `${name(c)} can\u2019t be Special Summoned right now.`); return false; }
  const proper = properSummon(g, c, o);
  move(g, c, 'm', { ctrl: p, pos, reason: 'summon', group: o.group });
  if (proper) c.proper = true;
  c.summonType = o.how || 'special'; c.attacks = 0;
  if (o.negate) { c.flags.negated = true; const rt = g.resolvingL ? String(D(g.resolvingL.c).ps || D(g.resolvingL.c).tx || '') : ''; if (!/effects? can(?:'t|not) be activated/i.test(rt)) c.flags.negActOk = true; }   // "it has its effects negated": they can still be activated, costs paid, and resolve negated (Junk Synchron site ruling)
  if (o.banishOnLeave) c.flags.banishOnLeave = true;
  // a text that names no position asks, whatever the script defaulted to (2026-11-27: Destiny HERO - Malicious's script forced Defense)
  if (pos !== 'set' && askPosFor(g)) (g.posAsk = g.posAsk || []).push({ c, p });
  log(g, `${PN(g, p)} Special Summoned ${pos === 'set' ? 'a monster face-down' : name(c)}${pos === 'def' ? ' in Defense Position' : ''}.`);
  if (ssBatchAdd(g, c, p, o.how || 'special', o.group)) return true;
  const ev = emit(g, { type: 'summon', cs: [c], how: o.how || 'special', p, byEffect: true }, o.group);
  g.sw = { cs: [c], p, how: o.how || 'special', group: ev.group, by: { [p]: [c] } };
  return true;
}
/* One effect that Special Summons several monsters summons them at the same time (2026-11-28 audit, findings goat-06 and edison-10: Cyber
 Jar, Return from the Different Dimension, Coelacanth, Rekindling, Rescue Cat; the King Tiger Wanghu and Bottomless Trap Hole archive
 rulings: "applies to both sides"). While a chain link resolves, every ss()/tokens() it makes joins one batch: one summon event per player
 after the link has resolved, and g.sw lists them all (g.sw.by[player] for each side's part). A summon lock from a monster placed by the
 same batch (Jowgen the Spiritualist flipped out of a Cyber Jar) doesn't stop the others (forbid skips the batch's own cards). */
function ssBatchAdd(g, c, p, how, group) {
  const b = g.ssBatch; if (!b || b.L !== g.resolvingL) return false;
  if (b.group == null) b.group = group != null ? group : g.group;
  let part = b.parts.find(x => x.p === p && x.how === how); if (!part) b.parts.push(part = { p, how, cs: [] });
  part.cs.push(c); b.cs.push(c); return true;
}
function ssBatchFlush(g, b) {
  if (!b || !b.parts.length) return;
  const by = {}; let ev = null;
  for (const part of b.parts) { ev = emit(g, { type: 'summon', cs: part.cs, all: b.cs.slice(), how: part.how, p: part.p, byEffect: true }, b.group);   /* ev.all: both players' monsters in the same summon */ (by[part.p] = by[part.p] || []).push(...part.cs); }
  g.sw = b.noSw ? null : { cs: b.cs.slice(), p: b.parts[0].p, how: b.parts[0].how, group: ev.group, by };   // noSw: summoned in the Damage Step (ssx), no window
}
// the monsters player q summoned in the current summon moment (g.sw), or [] (both players' parts of a Cyber Jar are kept apart)
const swOf = (g, q) => !g.sw ? [] : g.sw.by ? (g.sw.by[q] || []) : g.sw.p === q ? g.sw.cs : [];
function takeControl(g, p, c, untilEnd) {
  const zi = freeM(g, p); if (zi < 0 || !onField(c)) return false;
  // "Control of this card can't switch" (self.noCtrlSwitch while face-up and not negated: Botanical Lion, Horus LV4, Mataza, Blindly Loyal
  // Goblin; 2026-11-28 audit, edison-09)
  if (c.ctrl !== p && faceUp(c) && has(g, c, 'noCtrlSwitch')) { log(g, `Control of ${name(c)} can't switch.`); return false; }
  detach(g, c); c.ctrl = p; g.p[p].m[zi] = c; c.flags.ctrlUntil = untilEnd ? g.turnNo : null; if (untilEnd) c.flags.ctrlFrom = 1 - p;
  log(g, `${PN(g, p)} took control of ${name(c)}.`); return true;
}
/* Turning a monster face-down (2026-11-27 audit; Book of Moon, Snatch Steal, Premature Burial, Mind Control, Card Trooper and Call of the
 Haunted rulings). It forgets the lingering effects on it (mods, flags), its counters, its once-per-turn uses and "banish it when it
 leaves the field" (Plaguespreader, Battle Fader). It keeps the control changes and the locks that come with them (KEEP_FACE_DOWN):
 Brain Control, Change of Heart and Mind Control still give it back in the End Phase, and Mind Control's no-Tribute lock lasts to then.
 Equip Cards on it go to the GY, their target lost (move option lostTarget: Snatch Steal's control stays), and Call of the Haunted's
 link to it is cut for good. Its summon type, the turn it came out and its attacks are remembered (they live outside flags). */
const KEEP_FACE_DOWN = ['ctrlUntil', 'ctrlFrom', 'b1mc', 'f19charm', 'f19charmFrom', 'f29charm', 'f29charmFrom', 'f37charm', 'f37charmFrom',
  'f29hypno', 'f29hypnoFrom', 'f41mind', 'f41hyp', 'f34sc'];
/* Tokens can't be turned face-down (2026-11-27 audit, Book of Moon rulings 9 and 11, the Goat archive: "Tokens may not be turned face
 down"): effects that turn a monster face-down target face-up non-Tokens (canFaceDown), and setFaceDown leaves a Token as it is. */
const canFaceDown = c => faceUp(c) && c.zone === 'm' && D(c).k !== 'token';
function setFaceDown(g, c) {
  if (D(c).k === 'token') return false;
  if (isTrapMon(c)) { trapMonBack(g, c, 'set'); return true; }   // Embodiment of Apophis ruling 9
  g.seq++; c.pos = 'set'; c.mods = []; c.ctr = {};
  const keep = {}; for (const k of KEEP_FACE_DOWN) if (c.flags[k] != null) keep[k] = c.flags[k];
  if (c.flags.b1mc != null && c.flags.noTribute) keep.noTribute = true;   // Mind Control: can't be Tributed until the End Phase
  if (c.flags.battleDoomed) keep.battleDoomed = true;   // already destroyed by battle: turning it face-down doesn't save it (2026-11-28 audit, Tsukuyomi ruling)
  c.flags = keep; resetUsed(c);
  for (const x of allField(g)) if (x.linkTo === c.u) x.linkTo = null;
  log(g, `${D(c).n} was turned face-down.`);
  for (const P of g.p) for (const x of P.st) if (x && x.equipTo === c.u) { x.equipTo = null; move(g, x, 'gy', { reason: 'rule', lostTarget: true }); }
  return true;
}
/* "You can't conduct your Battle Phase the turn you activate this card" (Soul Exchange and the like): the lock belongs to the link, so a
 negated activation lifts it and a negated effect doesn't (Soul Exchange site rulings 9). g.noBP stays for locks with no link. */
function lockBP(g, p, L) { L = L || g.afterL || g.lockL; if (!L) { g.noBP[p] = true; return; } (g.noBPL || (g.noBPL = [])).push({ p, L, turn: g.turnNo }); }
const bpLocked = (g, p) => !!g.noBP[p] || !!(g.noBPL && g.noBPL.some(x => x.p === p && x.turn === g.turnNo && !x.L.actNegated));
/* Once-per-turn uses (c.used[effect index]) belong to one stay on the field: a card that leaves the field or is turned face-down can use
 them again (2026-11-27 audit: Swap Frog, Card Trooper). Script keys (c.used.union, .bjack, .proper...) and the uses of cards whose text
 says "You can only use this effect ... once per turn" (a hard once per turn) are kept. */
const HARD_OPT_RE = /only (use|activate) this effect( of "[^"]+")? once per (turn|Duel)|use this effect only once per turn/i;
function resetUsed(c) { const d = D(c); if (HARD_OPT_RE.test(d.ps || d.tx || '')) return; for (const k of Object.keys(c.used)) if (/^\d+$/.test(k)) delete c.used[k]; }
/* Negation (2026-11-27 audit): L.negated means nothing of the link resolves; L.actNegated means the activation itself was negated, so
 "the turn you activate this card" locks don't apply (Scapegoat, Soul Exchange, Sirocco site rulings; Spirit Reaper ruling 5). The
 negating card's text tells which: "negate the activation" (Solemn Judgment, Magic Jammer, Dark Bribe, Divine Wrath, Stardust Dragon)
 or only its effect (Royal Oppression, Pulling the Rug). Imperial Order sets L.negated alone, so it negates the effect only. o.effect
 or o.activation overrides the text. */
function negate(g, L, destroyIt, o = {}) {
  const by = g.resolvingL && g.resolvingL !== L ? g.resolvingL.c : null, bt = by ? String(D(by).ps || D(by).tx || '') : '';
  const effOnly = o.effect || (!o.activation && by && !/activation/i.test(bt) && /negat\w*[^.]*\beffects?\b/i.test(bt));
  L.negated = true; if (!effOnly) L.actNegated = true;
  log(g, `${name(L.c)}'s ${L.eff.type === 'act' && !effOnly ? 'activation' : 'effect'} was negated.`);
  emit(g, { type: 'negated', c: L.c, L, p: L.p });   // a card whose rulings let it activate again after a negation reads this (Treeborn Frog ruling 6)
  if (destroyIt && onField(L.c)) { const got = destroy(g, [L.c], { by: L.negBy != null ? L.negBy : by ? g.resolvingL.p : undefined });
    // a Spell/Trap whose activation was negated never was face-up on the field: it goes to the GY even if "can't be destroyed" protects it
    // (2026-11-28 audit, Imperial Custom site ruling: "If the activation of a Continuous Trap Card is negated, it is sent to the GY")
    if (!got.length && onField(L.c) && isST(L.c) && L.cardAct && !effOnly) move(g, L.c, 'gy', { reason: 'rule', by: L.negBy }); }
  // "negate ... and destroy it" destroys the card wherever it is: in the hand or the Extra Deck too (2026-11-28 audit, pass2 edison-03:
  // Battle Fader's hand effect, Absolute Zero), never in the GY or banished
  else if (destroyIt && ['hand', 'extra', 'deck'].includes(L.c.zone)) { move(g, L.c, 'gy', { reason: 'effect', destroyed: true, by: L.negBy != null ? L.negBy : by ? g.resolvingL.p : undefined }); log(g, `${D(L.c).n} was destroyed.`); }
}
function addMod(g, c, m) { c.mods.push({ ...m, turn: g.turnNo }); }

/* ---------- Synchro and summon rules ---------- */
/* Material lines (2026-11-28 audit, findings edison-17 and edison-10). A Synchro's or Fusion's materials are read from the first line of its
 Edison text that is a material line, else from its TCG text (tx): Underground Arachnid, Zeman, Red Dragon Archfiend and Iron Chain Dragon
 open their Edison text with an effect, and Revived King Ha Des' Edison line lost its opening quote. One reader for Synchro (synReq) and
 Fusion (fusionRecipe) materials. */
const textOf = d => String(d.ps && !/No Edison-Accurate/i.test(d.ps) ? d.ps : d.tx || '');
function matLine(c, kind) {
  const d = D(c); if (!d) return '';
  const ok = l => /\s\+\s|"\s*\+/.test(l) && (kind !== 'synchro' || /Tuner/.test(l)) && ((l.match(/"/g) || []).length % 2 === 0);
  for (const src of [d.ps, d.tx]) { if (!src || /No Edison-Accurate/i.test(src)) continue; const l = String(src).split('\n')[0].replace(/^[\u2460\s]+/, '').trim(); if (ok(l)) return l; }
  return '';
}
const RACES = ['Beast-Warrior', 'Winged Beast', 'Sea Serpent', 'Divine-Beast', 'Beast', 'Insect', 'Fish', 'Spellcaster', 'Machine', 'Fiend', 'Fairy', 'Aqua', 'Reptile', 'Rock', 'Warrior', 'Dragon', 'Plant', 'Thunder', 'Zombie', 'Psychic', 'Dinosaur', 'Pyro'];
// one material part ("1 DARK Tuner", "1 or more non-Tuner Zombies", "1 Level 3 non-Tuner", '1 "Blackwing" Tuner') as a test on a card
function matPred(part) {
  const fs = [], q = part.match(/"\s*([^"]+?)\s*"/);
  if (q) { const nm = q[1]; if (/^\s*"[^"]+"\s*$/.test(part)) fs.push(c => name(c) === nm); else fs.push(c => name(c).includes(nm)); }
  const at = ATTRS.find(a => new RegExp('\\b' + a + 's?\\b').test(part)); if (at) fs.push(c => attr(c) === at);
  const rc = RACES.find(r => new RegExp('\\b' + r + '(?:s|-Type)?\\b').test(part.replace(/"[^"]*"/g, ''))); if (rc) fs.push(c => race(c) === rc);
  const lm = part.match(/Level (\d+)/); if (lm) fs.push(c => lv(c) === +lm[1]);
  if (/\bGemini\b/.test(part)) fs.push(c => isGemini(c));
  return c => fs.every(f => f(c));
}
function synReq(sx) {
  const line = matLine(sx, 'synchro');
  const r = { tuner: () => true, non: () => true, minNon: 1, maxNon: 99, line, tunerName: null };
  if (!line) return r;
  const parts = line.split(/\s+\+\s+|(?<=")\s*\+\s*/).filter(Boolean); if (parts.length !== 2) return r;   // "Majestic Dragon" + "Stardust Dragon" + 1 non-Tuner: their own procedures
  const [tp, np] = parts;
  r.tuner = matPred(tp);
  const named = tp.match(/^\s*"([^"]+)"\s*$/); if (named) r.tunerName = named[1];
  const cm = np.match(/^(\d+)\s*(\+|or more)?/); if (cm) { r.minNon = +cm[1]; r.maxNon = cm[2] ? 99 : +cm[1]; }
  r.non = matPred(np.replace(/^(\d+)\s*(\+|or more)?\s*/, '').replace(/\bnon-Tuners?\b/, ''));
  return r;
}
/* A material's own rules (its text): "can't be used as Synchro Material" (Blackwing - Vayu), "..., except for a Dragon Synchro / the Synchro
 Summon of a Warrior Synchro Monster / a "Majestic" monster / a monster that lists a "Synchron" Tuner" (Debris Dragon, Torapart, Majestic
 Dragon, Quickdraw Synchron), "all other Materials must be WATER / Fish" (Fishborg Blaster, Royal Swamp Eel), "the other Material(s) can't be
 Level 4" (Debris Dragon). Quickdraw Synchron stands in for a named "Synchron" Tuner. */
const MATRULE = new Map();
function matRules(c) {
  const d = D(c); if (MATRULE.has(d.id)) return MATRULE.get(d.id);
  const srcs = [d.ps, d.tx].filter(x => x && !/No Edison-Accurate/i.test(x)).map(x => String(x).replace(/\s*\n\s*/g, ' ')), r = [];
  const first = re => { for (const t of srcs) { const m = t.match(re); if (m && ((m[0].match(/"/g) || []).length % 2 === 0)) return m; } return null; };   // a cut-off Edison line (Quickdraw Synchron) falls back to tx
  const ex = first(/can(?:'t|not) be used as (?:a )?Synchro Material(?: Monster)?(?:,? except for (?:the Synchro Summon of )?(?:an? )?([^.]+))?\./i);
  if (ex) {
    const what = ex[1] || '';
    if (!what) r.push((sx, mats, m, g) => !!g && negd(g, m));   // Vayu's is an effect: Skill Drain lifts it (EDOPro: no CANNOT_DISABLE); the others are rules
    else if (/lists a "([^"]+)" Tuner/i.test(what)) { const a = what.match(/"([^"]+)"/)[1]; r.push(sx => (synReq(sx).tunerName || '').includes(a) || /"[^"]*" Tuner/.test(synReq(sx).line) && synReq(sx).line.includes(a)); }
    else { const q = what.match(/"([^"]+)"/), rc = RACES.find(x => new RegExp('\\b' + x + '\\b').test(what)); r.push(sx => (!q || name(sx).includes(q[1])) && (!rc || race(sx) === rc)); }
  }
  const oth = first(/all (?:the )?other (?:Synchro )?Material(?: Monster)?s must be ([A-Za-z-]+)/i);
  if (oth) { const w = oth[1], at = ATTRS.includes(w.toUpperCase()) ? w.toUpperCase() : null; r.push((sx, mats, me) => mats.every(m => m === me || (at ? attr(m) === at : race(m) === w.replace(/s$/, '')))); }
  const nl = first(/the other (?:Synchro )?Material(?: Monster)?\(?s?\)? can(?:'t|not) be Level (\d+)/i);
  if (nl) r.push((sx, mats, me) => mats.every(m => m === me || lv(m) !== +nl[1]));
  const v = r.length ? (sx, mats, me, g) => r.every(f => f(sx, mats, me, g)) : null; MATRULE.set(d.id, v); return v;
}
const isQuickdraw = c => D(c).n === 'Quickdraw Synchron';
// are these materials legal for this Synchro? (the Synchro's material line, and every material's own rules); line: false checks the
// material rules only (a script's own procedure reads the line itself: batch-2 synMats, batch-3 synSets...)
/* A Tuner right now: its card says so, or a Gemini Summoned Tuned Magician ("is treated as a Tuner", not negated: edison-12). */
function isTunerNow(g, c) { return !!D(c).tu || (D(c).n === 'Tuned Magician' && c.zone === 'm' && faceUp(c) && !!c.flags.gemini && !negd(g, c)); }
function synOk(g, sx, mats, o = {}) {
  if (o.line !== false) {
    const r = synReq(sx), tun = mats.filter(c => isTunerNow(g, c)), non = mats.filter(c => !isTunerNow(g, c));
    if (tun.length !== 1 || non.length < r.minNon || non.length > r.maxNon) return false;
    const t = tun[0], qd = isQuickdraw(t) && r.tunerName && /Synchron/.test(r.tunerName);
    if (!qd && !r.tuner(t)) return false;
    if (!non.every(r.non)) return false;
  }
  for (const m of mats) { const f = matRules(m); if (f && !f(sx, mats, m, g)) return false; }
  return true;
}
function synCombos(g, p, sx) {
  const d = D(sx); if (d.k !== 'synchro') return [];
  const mons = monsOf(g, p).filter(c => faceUp(c) && !(D(c).n === 'Blackwing - Vayu the Emblem of Honor' && !negd(g, c)));
  const out = [], n = mons.length, L = num(d.lv);
  for (let mask = 1; mask < (1 << n); mask++) {
    const mats = mons.filter((_, i) => mask & (1 << i)); if (mats.length < 2) continue;
    if (mats.reduce((s, c) => s + lv(c), 0) !== L) continue;
    if (!synOk(g, sx, mats)) continue;
    out.push(mats);
  }
  return out;
}
const GEMM = new Map();
const isGemini = c => { let v = GEMM.get(c.id); if (v === undefined) { v = /treated as a Normal Monster while face-up on the field or in the GY/.test(D(c).tx || ''); GEMM.set(c.id, v); } return v; };
/* Contact fusions (2026-11-27 audit): the player chooses the materials. Chimeratech Fortress Dragon: "Cyber Dragon" + 1 or more Machines
 from either field, your face-down monsters too (not the opponent's), never a Token or a Chimeratech (it can't be Fusion Material), and a
 second Cyber Dragon counts as a Machine (site rulings, archive). Superalloy Beast Raptinus: 2 Gemini monsters you control.
 cfPool lists who may be used; cfCombos says whether a summon is possible (one sample combination). */
function cfPool(g, p, fx) {
  const n = D(fx).n, okMat = c => D(c).k !== 'token' && (faceUp(c) || c.ctrl === p) && !/can(?:'t|not) be used as(?: a)? Fusion Material/i.test(D(c).ps || D(c).tx || '');
  if (n === 'Chimeratech Fortress Dragon') { const all = fieldMons(g).filter(okMat); return { first: all.filter(c => D(c).n === 'Cyber Dragon'), rest: all.filter(c => race(c) === 'Machine'), restMin: 1, restMax: 99 }; }
  if (n === 'Superalloy Beast Raptinus') { const gem = monsOf(g, p).filter(c => okMat(c) && isGemini(c)); return { first: gem, rest: gem, restMin: 1, restMax: 1 }; }
  return null;
}
function cfCombos(g, p, fx) {
  const P = cfPool(g, p, fx); if (!P) return [];
  for (const a of P.first) { const r = P.rest.filter(x => x !== a); if (r.length >= P.restMin && (monsOf(g, p).some(x => x === a || r.includes(x)) || freeM(g, p) >= 0)) return [[a, r[0]]]; }
  return [];
}
/* Can it be Normal Summoned (kind 'ns') or Set ('set') from the hand? (2026-11-26: "Cannot be Normal Summoned" was read as a full ban,
   so Cave Dragon could never be summoned and Mystic Swordsman LV4/LV6 couldn't be Set.) */
function canNormal(c, kind, g, p) { const d = D(c); if (!isMonD(d) || isExtraD(d) || d.k === 'token' || d.k === 'ritual') return false; const t = d.ps || d.tx || '';
  if (!/Cannot be Normal Summoned/i.test(t)) return true;
  if (/Cannot be Normal Summoned\s*\(but can be Normal Set\)/i.test(t)) return kind === 'set';
  if (/Cannot be Normal Summoned while you control a monster/i.test(t)) return kind === 'set' || !g || !monsOf(g, p).length;   // Cave Dragon: the ruling allows the Set
  // Terrorking Archfiend: "unless you have an Archfiend Monster Card on your side of the field" (a Set is allowed either way)
  if (/Cannot be Normal Summoned or Flip Summoned unless you have an Archfiend/i.test(t)) return kind === 'set' || !g || monsOf(g, p).some(x => faceUp(x) && /Archfiend/.test(name(x)));
  return false; }
function tribNeed(g, p, c, set) { // [standard, alternatives...]; set: for a Set (Malicious Edge's 1 Tribute is for a face-up Tribute Summon only)
  const L = lv(c), need = L >= 7 ? 2 : L >= 5 ? 1 : 0, n = D(c).n, oppHas = monsOf(g, 1 - p).length > 0;
  const alts = [need];
  const sc0 = SC(c); if (sc0 && sc0.self && sc0.self.tribExact) return [sc0.self.tribExact];
  if (sc0 && sc0.self && sc0.self.tributes) for (const n2 of [].concat(sc0.self.tributes(g, c, p) || [])) alts.push(n2);
  for (const [s, ct] of statics(g)) if (ct.tributes) { const n2 = ct.tributes(g, s, c, p, need); if (n2 != null) alts.push(n2); }
  if (n === 'Blackwing - Sirocco the Dawn' && !monsOf(g, p).length && oppHas) alts.push(0);
  if (n === 'Evil HERO Malicious Edge' && oppHas && !set) alts.push(1);
  return [...new Set(alts)];
}
function tributeCands(g, p) {
  if (forbid(g, { type: 'tribute', p, summon: true })) return [];   // Mask of Restrict: "Monsters can't be Tributed"
  const own = monsOf(g, p).filter(c => D(c).n !== 'Sheep Token' && !noTribOf(c));
  return [...own, ...soulExOf(g, p)];
}
/* Tributes (2026-11-28 audit, findings edison-05/08/12..21, goat-03..11). c.flags.noTribute is true for "can't be Tributed" (Mind Control,
 Summoner Monk, Archfiend's Roar) and 'summon' for "can't be Tributed for a Tribute Summon" (Fluff, Ojama, Metabo, Kuriboh, Seed,
 Rockstone and Thunder Option Tokens, Fox Fire, Nimble Musasabi): those can still pay a Tribute cost (Ojama Trio Netrep Q&A, EDOPro's
 EFFECT_UNRELEASABLE_SUM only). A Tribute forbid ({type: 'tribute'}, Mask of Restrict) empties both lists. Does this effect Tribute,
 read from the card's text (a Tribute that isn't the Tribute Summon rule) and the effect's own script (its prompts say Tribute)? */
// a script's self.noTribute is a continuous effect read live: face-up and not negated (Summoner Monk site ruling: "① is a continuous
// effect. It can be negated"; 2026-11-28 audit, edison-09)
const noTribOf = c => { if (c.flags.noTribute) return c.flags.noTribute; const sc = SC(c), g = c.g;
  if (!(sc && sc.self && sc.self.noTribute && g && onField(c) && faceUp(c) && !negd(g, c))) return false; const v = sc.self.noTribute; return typeof v === 'function' ? v(g, c) : v; };
const noTribCost = c => { const v = noTribOf(c); return !!v && v !== 'summon'; };
const TRIB_TXT = /\bTribut(?:e|ing)\b|\bas (?:a )?Tributes?\b/;
const tribTxtMemo = new Map();
function textTributes(c) {
  const d = D(c); if (!d) return false; const k = d.n + '|' + FMT; if (tribTxtMemo.has(k)) return tribTxtMemo.get(k);
  const t = String(d.ps || d.tx || '').replace(/Tribute Summon(?:ed|s)?|Tribute Set|can(?:'t|not) be Tributed[^.]*|(?:is|was|are|were|been) Tributed[^.]*|Tributed for[^.]*|requires? \d+ Tributes?|\d+ Tributes? to|for (?:1|one|2|two|3|three) (?:less |fewer )?Tributes?|Tribute(?:s)? (?:of|for) (?:a|an|1)/gi, ' ');
  const v = TRIB_TXT.test(t); tribTxtMemo.set(k, v); return v;
}
// an effect that Tributes is blocked by a Tribute forbid; one whose script takes its Tributes from tribPool/tributeCands already finds them
// empty there (Enemy Controller keeps its position mode under Mask of Restrict)
const tribBlocked = (g, p, c, eff) => costTributes(c, eff) && !/tribPool|tributeCands/.test(['cost', 'target', 'res', 'cond'].map(k => String(eff[k] || '')).join('\n')) && forbid(g, { type: 'tribute', p, c, eff });
function costTributes(c, eff) {
  if (!c || !textTributes(c)) return false;
  if (eff === 'proc') { const o = (SC(c) || {}).proc; return !!o && /Tribut/.test(Object.values(o).filter(f => typeof f === 'function').map(String).join('\n')); }
  return !!eff && /Tribut|tribPool|tributeCands|'tribute'/.test(['cost', 'target', 'res', 'cond'].map(k => String(eff[k] || '')).join('\n'));
}
/* Soul Exchange (2026-11-27 audit, site rulings 3 and 5): each copy adds its target, so two copies let you Tribute both, and the target can
 be Tributed for any Tribute, costs included (Enemy Controller, Substitoad, Metamorphosis), not only a Tribute Summon. A face-down target
 has no Level, Type or Attribute (rulings 7, Goat archive). tribPool: what you may Tribute for a cost (Mind Control's monster can't be). */
const soulExOf = (g, p) => { const us = g.soulEx[p] || []; return us.length ? monsOf(g, 1 - p).filter(c => us.includes(c.u)) : []; };
const tribPool = (g, p, o = {}) => forbid(g, { type: 'tribute', p }) ? [] : [...monsOf(g, p).filter(c => !noTribCost(c)), ...soulExOf(g, p).filter(c => !o.known || faceUp(c))];
function combos(arr, k) { const out = []; const rec = (s, cur) => { if (cur.length === k) { out.push(cur.slice()); return; } for (let i = s; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1, cur); cur.pop(); } }; rec(0, []); return out; }

/* ---------- what a player may activate now ---------- */
function speedOf(c, eff) {
  if (eff.speed) return eff.speed;
  if (eff.type === 'act') { const d = D(c); if (d.k === 'trap') return d.sub === 'Counter' ? 3 : 2; return d.sub === 'Quick-Play' ? 2 : 1; }
  if (eff.type === 'quick') return 2;
  return 1;
}
/* An effect whose only job is adding a card from the Deck to the hand can't be activated while that is forbidden (2026-11-28 audit,
 pass2 edison-03: Rai-Oh is checked at activation, not only in search(); Sangan, Witch of the Black Forest, Reinforcement of the Army).
 Read from the text ("add ... from your Deck to your hand") and the effect's script (it searches, and offers no other choice). */
const SEARCH_TXT = /\badd\b[^.;]{0,120}\bfrom (?:your|their|his) Deck to (?:your|their|his) hand/i;
function searchLocked(g, p, c, eff) {
  if (!eff || !SEARCH_TXT.test(D(c).ps || D(c).tx || '')) return false;
  const src = ['res', 'target'].map(k => String(eff[k] || '')).join('\n');
  if (!/search\(|searchN|addFromDeck/.test(src) || /choose\(|yn\(/.test(src)) return false;
  return forbid(g, { type: 'search', p });
}
function usable(g, p, c, eff, ei, mode) {
  if (eff.type === 'trig' || !eff.res) return false;
  const d = D(c), top = g.chain[g.chain.length - 1], sp = speedOf(c, eff);
  const holder = onField(c) ? c.ctrl : c.owner;
  if (!eff.anyPlayer && holder !== p) return false;
  // the same effect of the same card can't be activated twice in one chain (2026-11-26: Toon Defense and Winged Kuriboh LV9 could chain to themselves)
  // eff.sameChain: its rulings let it be activated again in the same chain (Dark Paladin ruling 4, Horus LV8 ruling 3, Rainbow Ruins ruling 9)
  if (!eff.sameChain && g.chain.some(L => L.c === c && L.eff === eff)) return false;
  if (eff.anyPlayer && !(onField(c) && faceUp(c))) return false;
  if (eff.opt && c.used[ei] === g.turnNo) return false;
  if (top) { if (sp < 2 || sp < top.speed) return false; }
  else if (mode !== 'idle' && sp < 2 && !(mode === 'ign' && g.tp === p)) return false;
  if (sp === 1 && (g.tp !== p || !['main1', 'main2'].includes(g.phase))) return false;
  if (g.inDS && !(eff.ds || (eff.type === 'act' && d.sub === 'Counter') || eff.speed === 3)) return false;
  if (g.attempt && !top && !eff.negSummon) return false;
  if (eff.type === 'act') {
    if (c.zone === 'hand') {
      if (d.k === 'trap') return false;
      if (g.tp !== p) return false;
      if (d.sub === 'Field' ? false : freeST(g, p) < 0) return false;
    } else if ((c.zone === 'st' || c.zone === 'fz') && c.ctrl === p && c.pos === 'set') {
      if ((d.k === 'trap' || d.sub === 'Quick-Play') && c.turnIn === g.turnNo) return false;
      if (d.k === 'spell' && d.sub !== 'Quick-Play' && (g.tp !== p)) return false;
    } else return false;
  } else {
    if (isMonD(d) && (eff.loc || 'm') === 'm' && negd(g, c) && !c.flags.negActOk && !negActAllowed(g, c, eff)) return false;
    // a monster destroyed by battle, waiting to leave after damage calculation, can't activate its effects on the field (2026-11-28 audit,
    // Stardust Dragon ruling 14: a Stardust destroyed by Red Dragon Archfiend's attack can't negate its effect); its triggers still can
    if ((eff.loc || 'm') === 'm' && c.zone === 'm' && c.flags.battleDoomed) return false;
    if (isMonD(d) && c.flags.gemini === false && eff.gemini) return false;
    const loc = eff.loc || 'm';
    if (loc === 'm') { if (c.zone !== 'm' || !faceUp(c)) return false; }
    else if (loc === 'st' || loc === 'fz') { if (c.zone !== loc || !faceUp(c)) return false; }
    else if (c.zone !== loc) return false;
  }
  if (eff.type === 'ign' && (mode !== 'idle' && mode !== 'ign')) return false;
  if (eff.gemini && !c.flags.gemini) return false;
  // Cold Wave (2026-11-27 audit: its lock tested an object as a number, so nothing was ever blocked): until its controller's next turn,
  // no Spell/Trap Card can be activated, and no effect of a Spell/Trap on the field (Royal Oppression, Armory Arm as an Equip) either.
  if (g.coldWave && (isST(c) || (isMon(c) && c.zone === 'st')) && (eff.type === 'act' || onField(c))) return false;   // a Monster Card equipped (Armory Arm, Unions) counts as an Equip Spell (archive)
  if (g.aw && attackMoment(c, eff) && !(p === g.aw.ctrl ? g.aw.tpOpen : g.aw.open)) return false;
  if (forbid(g, { type: 'activate', c, eff, p })) return false;
  if (gyCostBlocked(g, c, eff)) return false;   // its cost sends cards to the GY that would be banished instead (Dimensional Fissure, Macro Cosmos)
  if (banCostBlocked(g, p, c, eff)) return false;   // its cost banishes, and banishing is forbidden (Imperial Iron Wall, Kycoo, Necrovalley)
  if (tribBlocked(g, p, c, eff)) return false;   // Mask of Restrict: an effect that Tributes can't be activated (archive)
  if (searchLocked(g, p, c, eff)) return false;   // Rai-Oh: an effect that adds from the Deck can't be activated
  const prevS = g.ssSrc; g.ssSrc = c;
  try {
    if (eff.tags && eff.tags.ss && !eff.tags.ssOpt && ssBlanket(g, p, c)) return false;
    return eff.cond ? !!eff.cond(g, c, p, { top, mode }) : true;
  } finally { g.ssSrc = prevS; }
}
/* Cards that answer an attack declaration ("When an opponent's monster declares an attack": Mirror Force, Sakuretsu Armor, Magic Cylinder,
 Dimensional Prison, Negate Attack...) can only be activated in the first chain right after it, and not once a player has passed on it
 (2026-11-27 audit, Mirror Force forum rulings 1 to 3: after a pass, an MST from the attacker gets no Mirror Force; after Solemn negates one
 Mirror Force, no second). g.aw stays set until the Damage Step for "the attacking monster"; g.aw.open is that first moment. Read from the
 card's text, for the effect whose condition reads g.aw. */
const ATK_MOMENT = /declares? (?:an|a direct) attack|declared an attack|attack declaration|(?:is|are) (?:selected as an attack target|targeted for an attack)|an attack is declared/i;
const atkMomentMemo = new WeakMap();
// The engine asks the attacked player first. Their pass ends the moment for their cards (the attacker had priority before it, so an MST
// the attacker plays after that pass gets no Mirror Force: ruling 2's example); the attacker's own "when your monster declares an attack"
// cards (Strike Slash) stay open until the attacker passes, and a chain the attacker starts with one is still the first chain.
function awPass(g, p) { if (g.aw && !g.chain.length) { if (p === g.aw.ctrl) g.aw.tpOpen = false; else g.aw.open = false; } }
function attackMoment(c, eff) {
  if (atkMomentMemo.has(eff)) { const m = atkMomentMemo.get(eff); if (m.has(D(c).n)) return m.get(D(c).n); }
  const v = ATK_MOMENT.test(D(c).ps || D(c).tx || '') && /g\.aw\b/.test(String(eff.cond || ''));
  if (!atkMomentMemo.has(eff)) atkMomentMemo.set(eff, new Map()); atkMomentMemo.get(eff).set(D(c).n, v); return v;
}
// Is t still "the attacking monster"? Not once it changed position, was turned face-down, changed control, its attack was negated or the
// Battle Phase ended (Dimensional Prison site ruling; Sakuretsu Armor and Dimensional Prison archive: Book of Moon, Enemy Controller, Scrubbed Raid).
// Did c declare an attack this turn that wasn't negated? (Red Dragon Archfiend ruling 4: a monster whose attack Magic Cylinder negated is
// destroyed by its End Phase effect.) c.declared alone stays true for "declared an attack" texts (Chaos Sorcerer, BLS: negated counts).
const attackWent = c => !!c.declared && (c.negAtk || 0) < c.attacks;
const attackingNow = (g, t) => !!(g.aw && t && g.aw.a === t && onField(t) && faceUp(t) && t.pos === 'atk' && t.ctrl === g.aw.ctrl && !g.attackNegated && !g.bpEnd);
function activatable(g, p, mode) {
  const out = [];
  const seen = new Set();
  const consider = (c) => { if (!c || seen.has(c.u)) return; seen.add(c.u); const es = effsOf(c); if (!es.length) return; es.forEach((eff, ei) => { if (usable(g, p, c, eff, ei, mode)) out.push({ c, eff, ei }); }); };
  const P = g.p[p];
  P.hand.forEach(consider); P.st.forEach(consider); P.m.forEach(consider); P.gy.forEach(consider); if (P.fz) consider(P.fz); P.ban.forEach(consider);
  // the opponent's face-up "either player" cards (Royal Oppression); your own were already considered above, so they aren't listed twice
  for (const x of [...g.p[1 - p].st, g.p[1 - p].fz]) if (x && faceUp(x) && effsOf(x).some(e => e.anyPlayer)) consider(x);
  return out;
}
function actLabel(g, a) { const sc = SC(a.c); const lab = a.eff.label || (a.eff.type === 'act' ? (a.c.zone === 'hand' || a.c.pos === 'set' ? 'Activate' : 'Activate') : 'Use effect'); return `${lab}: ${name(a.c)}`; }

/* ---------- activation, chains ---------- */
function* activate(g, p, c, eff, ei) {
  const d = D(c);
  const L = { c, eff, ei, p, speed: speedOf(c, eff), t: [], data: {}, negated: false, cardAct: eff.type === 'act', tags: eff.tags || {}, link: g.chain.length + 1 };
  if (eff.type === 'act' && d.k === 'spell') L.upAt = allField(g).filter(faceUp).map(x => x.u);   // who saw the Spell activated (spellCtrEv)
  if (eff.type === 'act') {
    if (c.zone === 'hand') { if (d.sub === 'Field') { if (g.p[p].fz) { destroy(g, [g.p[p].fz], { rule: true, by: p }); const sw = g.sw; beginOp(g); g.sw = sw; } move(g, c, 'fz', { ctrl: p, pos: 'up', reason: 'activate' }); } else move(g, c, 'st', { ctrl: p, pos: 'up', reason: 'activate' }); }
    else { c.pos = 'up'; g.seq++; }
  }
  c.used[ei] = g.turnNo;
  if (g.aw && !g.chain.length && p === g.aw.ctrl && g.aw.tpOpen && attackMoment(c, eff)) g.aw.open = true;
  log(g, `${PN(g, p)} activated ${name(c)}${eff.type !== 'act' ? "'s effect" : ''}${g.chain.length ? ` (Chain Link ${g.chain.length + 1})` : ''}.`);
  const prevS = g.ssSrc; g.ssSrc = c;
  try {
    if (eff.cost) { const pc = g.inCost, pp = g.costP, pe = g.costEff; g.inCost = true; g.costP = p; g.costEff = { c, eff }; try { yield* eff.cost(g, c, p, L); } finally { g.inCost = pc; g.costP = pp; g.costEff = pe; } }
    g.lockL = L; if (eff.target) yield* eff.target(g, c, p, L);   // lockBP() in a target reads the link from g.lockL
  } finally { g.ssSrc = prevS; g.lockL = null; }
  L.offAtAct = !onField(c);   // its own cost sent it away (Wave-Motion Cannon): it still resolves
  L.tUp = L.t.filter(x => x && onField(x) && faceUp(x)).map(x => x.u);   // targets face-up on the field when it was activated (Spirit Reaper ruling 7)
  L.tGY = L.t.filter(x => x && x.zone === 'gy');   // targets in a GY when it was activated (Necrovalley)
  L.gyAt = new Set([...g.p[0].gy, ...g.p[1].gy].map(x => x.u));   // what was in the GYs then (Goat Necrovalley: gyHold)
  if (isST(c) && onField(c) && (eff.loc || c.zone) === c.zone) L.negSrc = negSource(g, c);   // negated as it was activated (resolveChain)
  g.chain.push(L); g.seq++;   // statics() reads the chain (a card's lasting effects wait for its activation)
  if (g.hooks) g.hooks.note(g, { type: 'chain', L });
  if (eff.after) { g.afterL = L; try { eff.after(g, c, p, L); } finally { g.afterL = null; } }
  return L;
}
function* orderTrigs(g, p, ts) {
  const nc = ts.filter(t => t.eff.noChain || t.eff.ownChain), ch = ts.filter(t => !t.eff.noChain && !t.eff.ownChain);
  // asked in the play game (cfg.askPos, the game's "ask the player" mode, or cfg.askOrder); scripted tests keep the event order
  if (!(g.cfg.askOrder != null ? g.cfg.askOrder : g.cfg.askPos) || ch.length < 2 || new Set(ch.map(t => t.c.u + ':' + t.ei)).size < 2) return [...nc, ...ch];
  const out = [], rest = ch.slice();
  while (rest.length > 1) { const i = yield* choose(g, p, 'These effects activate at the same time. Which goes on the chain first? (the last one resolves first)', rest.map(t => `${name(t.c)}${t.eff.label ? ' (' + t.eff.label + ')' : ''}`)); out.push(rest.splice(i, 1)[0]); }
  return [...nc, ...out, ...rest];
}
function* respondLoop(g, p, mode) { // players respond to the chain until both pass
  let passes = 0;
  while (passes < 2) {
    const acts = activatable(g, p, 'respond');
    if (!acts.length) { passes++; p = 1 - p; continue; }
    const top = g.chain[g.chain.length - 1];
    const k = (yield* ask(g, p, 'respond', top ? `${name(top.c)} was activated. Respond?` : 'Respond?', [...acts.map(a => ({ key: `a:${a.c.u}:${a.ei}`, u: a.c.u, label: actLabel(g, a) })), { key: 'pass', label: 'Pass' }]))[0];
    if (k === 'pass') { passes++; p = 1 - p; continue; }
    const [, u, ei] = k.split(':'); const a = acts.find(x => x.c.u === +u && x.ei === +ei);
    yield* activate(g, p, a.c, a.eff, a.ei); passes = 0; p = 1 - p;
  }
}
/* A face-down monster an effect turns face-up activates its Flip effect after that effect resolves (2026-11-27 audit, Black Rose Dragon
 ruling 4: Black Rose's ② on a Set Morphing Jar never let the Jar's effect activate). Scripts only set c.pos, so the engine compares the
 face-down monsters from before the link with after it and emits the flip event for any it turned face-up, unless the script emitted
 one itself or the card moved (g.flipWatch collects those), or the resolving card's text says Flip effects are not activated. */
const NO_FLIP_RE = /Flip(?: monsters'?| monster's)? effects? (are not|aren't|is not|isn't) activated/i;   // the Goat wording too: "Flip monsters' effects are not activated" (Ceasefire, 2026-11-28 audit)
/* A face-up monster an effect changed between Attack and Defense Position gets its 'pos' event (2026-11-28 audit: about 100 scripts set c.pos
 by hand, so "when this card is changed to Defense Position" cards like Dream Clown and Gravekeeper's Assailant never saw it). Unless the
 script emitted one itself, or the card left and came back (c.moved). */
function posByEffect(g, posAt, seen) {
  for (const [x, from, mv] of posAt) if (x.zone === 'm' && x.moved === mv && x.pos !== 'set' && x.pos !== from && !seen.includes(x.u)) { g.seq++; emit(g, { type: 'pos', c: x, p: x.ctrl, from, byEffect: true }); }
}
function flipsByEffect(g, L, downs, seen) {
  if (!downs.length) return; for (const x of downs) if (x.zone === 'm' && faceUp(x)) x.flags.flippedUp = true;   // "was flipped face-up", whatever flipped it (Ceasefire: Batteryman Micro-Cell ruling)
  const d = D(L.c); if (NO_FLIP_RE.test(d.ps || d.tx || '')) return;
  for (const x of downs) if (x.zone === 'm' && faceUp(x) && !seen.includes(x.u)) emit(g, { type: 'flip', c: x, p: x.ctrl, byEffect: true });
}
const MAINT_RE = /\bor destroy this card\b/i;
function* resolveChain(g) {
  const leave = [], links = g.chain.slice(), reapEnd = [];   // Normal and Quick-Play Spells, Normal and Counter Traps: on the field until the whole chain has resolved
  while (g.chain.length) {
    const L = g.chain.pop(); g.seq++; beginOp(g);
    if (g.hooks) g.hooks.note(g, { type: 'resolve', L });
    // Necrovalley: "Negate any card effect that targets a card(s) in the GY" (Edison), "...that would move a card in the GY" (Goat); a
    // static cont.gyNegate(g, src, L) says when (2026-11-28 audit: Call of the Haunted, Premature Burial, Monster Reborn, Monster Reincarnation)
    if (!L.negated) for (const [s, ct] of statics(g)) if (ct.gyNegate && s !== L.c && ct.gyNegate(g, s, L)) { L.negated = true; log(g, `${D(s).n} negated ${name(L.c)}'s effect.`); break; }
    // a Spell/Trap link whose card is negated when it resolves (Jinzo, Royal Decree, Trap Stun, Spell Canceller, Imperial Order summoned or
    // activated mid-chain: 2026-11-28 audit, goat-08; Jinzo and Trap Stun rulings: "Negate the effect(s) of a Trap Card that activates on
    // the field, even if it is removed from the field"). Effects that work in the GY or hand aren't touched (Royal Decree ruling: Dark Coffin).
    if (!L.negated && isST(L.c) && !['gy', 'hand', 'ban', 'deck'].includes(L.eff.loc) && !MAINT_RE.test(L.eff.label || '')) {   // a maintenance cost is still paid (Skill Drain ruling: "Maintenance costs must still be paid")
      const ns = onField(L.c) ? negSource(g, L.c) : L.negSrc && (L.negSrc === 'flag' || (L.negSrc === 'rule' ? g.trapStun === g.turnNo : statics(g).some(([s2]) => s2 === L.negSrc))) ? L.negSrc : null;
      if (ns) { L.negated = true; log(g, `${name(L.c)}'s effect was negated${ns !== 'flag' && ns !== 'rule' ? ' by ' + D(ns).n : ''}.`); }
    }
    if (!L.negated) {
      const d = D(L.c);
      // a Continuous/Equip/Field card that left the field doesn't resolve its activation, nor any effect it uses from the S/T or Field Zone
      // (2026-11-28 audit, edison-12: Ultimate Offering and Mausoleum of the Emperor after a chained MST)
      const stillThere = L.eff.type !== 'act' ? !(['st', 'fz'].includes(L.eff.loc) && !onField(L.c) && !L.offAtAct) : onField(L.c) || !['Continuous', 'Equip', 'Field'].includes(d.sub);
      const monGone = isMonD(d) && L.eff.type !== 'trig' && L.eff.needsSelf && !onField(L.c);
      if (stillThere && !monGone && !(isMonD(d) && onField(L.c) && negd(g, L.c) && L.eff.loc !== 'gy' && L.eff.loc !== 'hand')) { const prevPlan = g.replPlan, wd = wouldDestroy(g, L); g.replPlan = (wd.length || (wd.maybe && wd.maybe.length)) ? yield* askReplace(g, [...wd, ...(wd.maybe || [])], { by: L.p, src: L.c, batch: [...wd] }) : null; const prevR = g.resolvingL, prevW = g.flipWatch, downs = fieldMons(g).filter(x => x.pos === 'set'), posAt = fieldMons(g).filter(x => x.pos !== 'set').map(x => [x, x.pos, x.moved]), prevP = g.posWatch; g.flipWatch = []; g.posWatch = []; g.resolvingL = L; const prevB = g.ssBatch, bat = g.ssBatch = { L, parts: [], cs: [], group: null }; try { yield* L.eff.res(g, L.c, L.p, L); } finally { g.ssBatch = prevB; } ssBatchFlush(g, bat); g.replPlan = prevPlan; g.resolvingL = prevR; if (!prevR && g.hwPend) { const ps = [...new Set(g.hwPend)]; g.hwPend = null; for (const q of ps) handWin(g, q); } if (!prevR && g.drawPend) { const ds = g.drawPend; g.drawPend = null; drawnCheck(g, ds); } const seen = g.flipWatch; g.flipWatch = prevW; flipsByEffect(g, L, downs, seen); const pw = g.posWatch; g.posWatch = prevP; posByEffect(g, posAt, pw); yield* askPositions(g); }
    }
    // a Spell Card activation has resolved (its effect may have been negated, its activation wasn't): Spell Counter cards and the like read
    // this event (spellCtrEv), Continuous/Equip/Field Spells and Set Spells flipped up included (2026-11-27 audit, Skilled White Magician ruling)
    if (L.cardAct && isSpell(L.c) && !L.actNegated) { const pr = g.resolvingL; g.resolvingL = L; try { emit(g, { type: 'spellResolved', sc: L.c, p: L.p, L }); } finally { g.resolvingL = pr; } }   // seen as part of the link
    // (2026-11-27 audit, Heavy Storm site ruling and Dust Tornado: a chained Normal Trap that was targeted is still there to destroy)
    if (L.eff.type === 'act' && onField(L.c) && L.c.zone === 'st' && !['Continuous', 'Equip', 'Field'].includes(D(L.c).sub) && !L.keep) { leave.push([L.c, L.link]); L.c.pendLeave = true; g.seq++; }   // a lasting effect it left (a 'gy' static, Damage Translation) applies already
    if (L.eff.type === 'act' && onField(L.c) && D(L.c).sub === 'Equip' && !L.c.equipTo && !L.c.linkTo) move(g, L.c, 'gy', { reason: 'rule' });
    if (L.eff.type === 'act' && !L.negated && onField(L.c) && D(L.c).sub === 'Field') { const o = g.p[1 - L.p].fz; if (o && o.pos !== 'set') destroy(g, [o], { rule: true }); }
    // Spirit Reaper: destroyed after an effect that targeted it resolves, even one whose effect was negated (ruling 5: Imperial Order); after
    // the whole chain when an Equip Spell targeted it, after damage calculation in the Damage Step (archive)
    // ruling 7: only a Reaper face-up on the field when the effect was activated (Monster Reborn on it, Book of Taiyou on a Set one don't
    // count); ruling 14: Premature Burial and Call of the Haunted target it in the GY and still destroy it once it is on the field.
    // ruling 20: an Equip Spell on a negated Reaper destroys it once the negation ends (flags.reapLater, reaperSweep).
    for (const t of L.t) if (t && D(t).n === 'Spirit Reaper' && onField(t) && faceUp(t) && !L.actNegated && ((L.tUp || []).includes(t.u) || /^(Premature Burial|Call of the Haunted)$/.test(D(L.c).n))) {
      const eq = D(L.c).sub === 'Equip' && L.eff.type === 'act'; if (negd(g, t) && !eq) continue;
      if (g.inDS && !g.dsCalcDone && !negd(g, t)) (g.dsReap || (g.dsReap = [])).push(t); else if (eq) reapEnd.push(t); else destroy(g, [t]); }
  }
  // they leave together; the move says which link each was and the whole chain (chainLinks), for scripts that count links or read what
  // a Counter Trap negated (Blast Asmodian, Iris, Van'Dalgyon)
  if (leave.length) { const grp = g.group; for (const [x, link] of leave) { const was = x.pendLeave; x.pendLeave = false; if (was && onField(x) && x.zone === 'st') move(g, x, 'gy', { reason: 'rule', chainEnd: true, link, chainLinks: links, group: grp }); } }
  reapSpirit(g, reapEnd);
  if (g.aw) { if (g.aw.reopen) g.aw.reopen = false; else g.aw.open = g.aw.tpOpen = false; }   // a chain has resolved: the attack declaration's moment is over (Jetroid's readied Traps keep it: reopen)
}
function reapSpirit(g, xs) { const all = (xs || []).filter(t => onField(t) && faceUp(t) && D(t).n === 'Spirit Reaper'); for (const t of all) if (negd(g, t)) t.flags.reapLater = true;
  const ts = all.filter(t => !negd(g, t)); if (ts.length) destroy(g, [...new Set(ts)]); }
function reaperSweep(g) { if (g.reapBusy || g.resolvingL) return; const ts = fieldMons(g).filter(t => t.flags.reapLater && faceUp(t) && D(t).n === 'Spirit Reaper' && !negd(g, t)); if (!ts.length) return;
  g.reapBusy = true; try { for (const t of ts) delete t.flags.reapLater; log(g, 'Spirit Reaper is destroyed: it was targeted while negated.'); destroy(g, ts); } finally { g.reapBusy = false; } }
/* Effects that can't share a chain (2026-11-27 audit): only one effect that Special Summons a card from the hand by itself (Gorz,
 Tragoedia: site rulings, "only one hand trigger that Special Summons itself per chain"), and eff.oneName: one copy of the card per
 chain (Treeborn Frog: "You cannot activate two copies of Treeborn Frog in the same chain"). */
const handSelfSS = eff => eff.type === 'trig' && eff.loc === 'hand' && !!(eff.tags && eff.tags.ss);
function onePerChain(g, t) {
  if (handSelfSS(t.eff) && g.chain.some(L => handSelfSS(L.eff))) return true;
  if (t.eff.oneName && g.chain.some(L => L.eff === t.eff && D(L.c).n === D(t.c).n)) return true;
  return false;
}
/* A "when/if this card is sent to the GY" trigger still activates when the card has left the GY before its chain was built (2026-11-28
 audit, Dandylion rulings: "activates even if Dandylion is moved from the Graveyard during the chain": discarded for Monster
 Reincarnation and returned by it, banished by D.D. Crow, shuffled into the Deck by The Transmigration Prophecy). Only for a GY trigger
 set off by the card's own arrival in the GY, and not once it is back on the field. */
const gyLeft = t => (t.eff.loc === 'gy') && t.ev && t.ev.type === 'move' && t.ev.c === t.c && t.ev.to === 'gy' && ['hand', 'ban', 'deck', 'extra'].includes(t.c.zone);
/* Effects the rulings say "do not start a Chain" (2026-11-28 audit, findings edison-09/14/15: Alien Ammonite's End Phase destroy, Junk Archer's
 return, the Cloudians' self-destruction): a trigger with eff.noChain (mandatory) happens at once, as part of the game state, with no chain
 link: no one can respond to it and nothing negates it at resolution (Junk Archer flipped face-down or negated still returns the monster). */
function* runNoChain(g, t) {
  const L = { c: t.c, eff: t.eff, ei: t.ei, p: t.p, t: [], data: {}, ev: t.ev, tags: t.eff.tags || {}, noChain: true, link: 0 };
  const prevR = g.resolvingL; g.resolvingL = L; beginOp(g);
  try { yield* t.eff.res(g, t.c, t.p, L); } finally { g.resolvingL = prevR; }
  if (!prevR && g.hwPend) { const ps = [...new Set(g.hwPend)]; g.hwPend = null; for (const q of ps) handWin(g, q); }
}
function* processTriggers(g) {
  let guard = 0;
  while (g.pend.length && guard++ < 30) {
    const last = lastGroup(g); let list = g.pend; g.pend = [];
    const seen = new Set();
    list = list.filter(t => {
      const k = t.c.u + ':' + t.ei; if (seen.has(k)) return false; seen.add(k);
      if (t.eff.when && !t.eff.mand && t.ev.group !== last && !t.held) return false; // missed the timing (a held battle Flip effect doesn't)
      const loc = t.eff.loc || 'm'; if (loc !== 'any' && !(t.held && ['gy', 'ban'].includes(t.c.zone)) && !gyLeft(t) && (loc === 'm' ? t.c.zone !== 'm' : t.c.zone !== loc)) return false;
      if (t.eff.cost && gyCostBlocked(g, t.c, t.eff)) return false;
      if (tribBlocked(g, t.p, t.c, t.eff)) return false;   // Mask of Restrict
      if (searchLocked(g, t.p, t.c, t.eff)) return false;   // Rai-Oh
      if (t.eff.opt && t.c.used[t.ei] === g.turnNo) return false;
      if (g.coldWave && (isST(t.c) || (isMon(t.c) && t.c.zone === 'st')) && onField(t.c)) return false;   // Cold Wave: no Spell/Trap effects on the field either
      const prevS = g.ssSrc; g.ssSrc = t.c;
      try {
        if (!t.eff.mand && t.eff.tags && t.eff.tags.ss && !t.eff.tags.ssOpt && ssBlanket(g, t.p, t.c)) return false;   // Vanity's Fiend: optional summoners stay off
        return !t.eff.cond || t.eff.cond(g, t.c, t.p, { ev: t.ev });
      } finally { g.ssSrc = prevS; }
    });
    if (!list.length) continue;
    // a player puts their own simultaneous mandatory triggers on the chain in the order they choose (Solemn Wishes + Skull Invitation, Goat
    // ruling 2: gain before the damage; pass2 goat-01). The default (the first option each time) is the event order, as before.
    const tp = g.tp, order = [...(yield* orderTrigs(g, tp, list.filter(t => t.eff.mand && t.p === tp))), ...(yield* orderTrigs(g, 1 - tp, list.filter(t => t.eff.mand && t.p !== tp))), ...list.filter(t => !t.eff.mand && t.p === tp), ...list.filter(t => !t.eff.mand && t.p !== tp)];
    let ownDone = false;
    for (const t of order) {
      if (t.eff.noChain) { yield* runNoChain(g, t); continue; }
      // eff.ownChain: each such effect activates on its own chain (Gladiator Beast end-of-Battle-Phase effects, site ruling): the chain
      // built so far resolves first, and a later one checks again that it can still activate
      if (t.eff.ownChain && g.chain.length) { yield* respondLoop(g, 1 - g.chain[g.chain.length - 1].p); yield* resolveChain(g); ownDone = true; }
      if (t.eff.ownChain && ownDone) { const loc = t.eff.loc || 'm'; if ((loc === 'm' ? t.c.zone !== 'm' : loc !== 'any' && t.c.zone !== loc) || (t.eff.cond && !t.eff.cond(g, t.c, t.p, { ev: t.ev }))) continue; }
      if (!t.eff.mand && !(yield* yn(g, t.p, `Use ${name(t.c)}'s effect?${t.eff.label ? ' (' + t.eff.label + ')' : ''}`))) continue;
      if (t.eff.ok && !t.eff.ok(g, t.c, t.p, { ev: t.ev })) continue;
      if (forbid(g, { type: 'activate', c: t.c, eff: t.eff, p: t.p })) continue;
      if (onePerChain(g, t)) continue;
      const L = yield* activate(g, t.p, t.c, t.eff, t.ei); L.ev = t.ev;
      if (t.eff.ownChain && g.chain.length) { yield* respondLoop(g, 1 - g.chain[g.chain.length - 1].p); yield* resolveChain(g); ownDone = true; }
    }
    if (g.chain.length) { yield* respondLoop(g, 1 - g.chain[g.chain.length - 1].p); yield* resolveChain(g); }
  }
}
/* A response window with an empty chain (after a summon, an attack, at a phase). */
function* openWindow(g, first, o = {}) {
  let p = first, passes = 0, guard = 0;
  while (passes < 2 && guard++ < 40) {
    const mode = o.ign && p === g.tp ? 'ign' : 'respond';
    const acts = activatable(g, p, mode);
    if (!acts.length) { if (o.oppOnly) return; passes++; awPass(g, p); p = 1 - p; continue; }
    const k = (yield* ask(g, p, 'respond', o.text || 'Activate a card or effect?', [...acts.map(a => ({ key: `a:${a.c.u}:${a.ei}`, u: a.c.u, label: actLabel(g, a) })), { key: 'pass', label: 'Pass' }]))[0];
    if (k === 'pass') { if (o.oppOnly) return; passes++; awPass(g, p); p = 1 - p; continue; }
    const [, u, ei] = k.split(':'); const a = acts.find(x => x.c.u === +u && x.ei === +ei);
    yield* activate(g, p, a.c, a.eff, a.ei);
    yield* respondLoop(g, 1 - p); yield* resolveChain(g); yield* processTriggers(g);
    if (o.oppOnly) return;   // one chain: the turn player then acts from the idle prompt
    if (g.attempt) return; // a summon negation window ends after one chain
    passes = 0; p = g.tp;
  }
}
function* afterAction(g) { yield* processTriggers(g); if (g.sw) yield* openWindow(g, g.tp, { ign: true, text: 'Respond to the summon?' }); }

/* ---------- summoning ---------- */
function* summonAttempt(g, p, cs, how) {
  g.attempt = { cs, how, p, negated: false };
  yield* openWindow(g, 1 - p, { text: `${PN(g, p)} is summoning ${cs.map(name).join(', ')}. Negate it?` });
  const neg = g.attempt.negated; g.attempt = null;
  if (neg) {
    // the Summon never happened, so the monster wasn't on the field: "sent from the field" and "leaves the field" effects don't activate
    // (2026-11-27 audit, Sangan ruling: "If the Summon of this card is negated with Horn of Heaven or Solemn Judgment you do not get its
    // effect"; Witch of the Black Forest, Absolute Zero alike). It is destroyed, so "destroyed"/"sent to the GY" effects still can.
    const grp = g.group, out = cs.filter(onField);
    for (const c of out) move(g, c, 'gy', { reason: 'effect', destroyed: true, by: 1 - p, group: grp, noLater: true, wasField: false, from: 'summon', negSummon: true });
    flushLater(g, grp); if (out.length) log(g, `${out.map(name).join(', ')} ${out.length > 1 ? 'were' : 'was'} destroyed.`);
    return false;
  }
  return true;
}
function* normalSummon(g, p, c, set) {
  const alts = tribNeed(g, p, c, set); let need = Math.min(...alts);
  const cands = tributeCands(g, p);
  const usable = alts.filter(n => cands.length >= n);
  if (usable.length > 1) { const i = yield* choose(g, p, `Summon ${name(c)} with how many Tributes?`, usable.map(n => n ? `${n} Tribute${n > 1 ? 's' : ''}` : 'No Tribute')); need = usable[i]; } else need = usable[0];
  let tribs = [];
  if (need) { tribs = yield* pick(g, p, `Choose ${need} monster${need > 1 ? 's' : ''} to Tribute`, cands, need, need, 'cost'); }
  // the Tributes are sent before the monster is summoned (2026-11-27 audit, Dupe Frog archive: its "when" effect doesn't activate when it is
  // Tributed for a Tribute Summon), so they get their own event group and a "when ... you can" effect on a Tribute misses the timing
  const tg = g.group; if (tribs.length) g.group++; const group = g.group;
  for (const t of tribs) { const wasOpp = t.ctrl !== p; move(g, t, 'gy', { reason: 'tribute', by: p, group: tg, tributeFor: c.u }); if (wasOpp) g.soulEx[p] = (g.soulEx[p] || []).filter(u => u !== t.u); }
  if (tribs.length) log(g, `${PN(g, p)} Tributed ${tribs.map(x => x.snapName || D(x).n).join(', ')}.`);
  if (!set && g.frogNS[p] && isFrog(c) && !['Swap Frog', 'Frog the Jam'].includes(D(c).n)) g.frogNS[p] = false; else g.ns[p]++;
  const zi = freeM(g, p); if (zi < 0) return;
  move(g, c, 'm', { ctrl: p, pos: set ? 'set' : 'atk', reason: set ? 'set' : 'summon', group });
  c.summonType = tribs.length ? 'tribute' : 'normal'; c.tributes = tribs.map(t => t.u);
  if (set) { log(g, `${PN(g, p)} Set a monster.`); emit(g, { type: 'set', c, p }, group); yield* processTriggers(g); return; }
  log(g, `${PN(g, p)} ${tribs.length ? 'Tribute' : 'Normal'} Summoned ${name(c)}.`);
  if (!(yield* summonAttempt(g, p, [c], c.summonType))) { yield* processTriggers(g); return; }
  const ev = emit(g, { type: 'summon', cs: [c], how: c.summonType, p, tribs }, group);
  g.sw = { cs: [c], p, how: c.summonType, group: ev.group };
  yield* afterAction(g);
}
function* specialProc(g, p, c, how, cost, pos = 'atk') { // inherent Special Summons: from the hand, Synchro, contact Fusion
  const group = g.group;
  if (cost) { const pc = g.inCost, pp = g.costP, pe = g.costEff; g.inCost = true; g.costP = p; g.costEff = { c, eff: 'proc' }; try { yield* cost(group); } finally { g.inCost = pc; g.costP = pp; g.costEff = pe; } }
  const zi = freeM(g, p); if (zi < 0) return;
  move(g, c, 'm', { ctrl: p, pos, reason: 'summon', group }); c.summonType = how; c.attacks = 0;
  log(g, `${PN(g, p)} ${how === 'synchro' ? 'Synchro' : how === 'fusion' ? 'Fusion' : 'Special'} Summoned ${name(c)}${pos === 'def' ? ' in Defense Position' : ''}.`);
  if (!(yield* summonAttempt(g, p, [c], how))) { yield* processTriggers(g); return; }
  c.proper = true;   // its own procedure (or a Synchro / contact Fusion Summon): it can be revived later where its text allows
  const ev = emit(g, { type: 'summon', cs: [c], how, p }, group);
  g.sw = { cs: [c], p, how, group: ev.group };
  yield* afterAction(g);
}

/* ---------- the duel ---------- */
E.newDuel = function (cfg) {
  const seed = cfg.seed != null ? cfg.seed : Math.floor(Math.random() * 2 ** 31);
  cfg = { ...cfg, seed };
  const g = {
    cfg, rnd: mulberry(seed), nextU: 1, p: [], tp: cfg.first || 0, turnNo: 0, phase: 'start', chain: [], events: [], pend: [], later: [], laterDestroy: [], rules: [],
    group: 0, seq: 0, summoned: [false, false], history: [], log: [], winner: null, why: '', ns: [0, 0], frogNS: [false, false], soulEx: [[], []],
    noBP: [false, false], noSummon: [false, false], onlyAttacker: [null, null], silverwindUsed: [false, false], roar: null,
    coldWave: null, flipWatch: null, goldSarc: [], attempt: null, sw: null, aw: null, inDS: false, battle: null, quiet: !!cfg.quiet,
  };
  for (const pi of [0, 1]) {
    const dk = cfg.decks[pi];
    const P = { lp: 8000, deck: [], hand: [], gy: [], ban: [], extra: [], m: [null, null, null, null, null], st: [null, null, null, null, null], fz: null, name: PN(g, pi), deckName: dk.name };
    g.p.push(P);
    for (const id of dk.main) { if (!DATA.has(id)) continue; const c = mk(g, id, pi); P.deck.push(c); }
    for (const id of dk.extra || []) { if (!DATA.has(id)) continue; const c = mk(g, id, pi); c.zone = 'extra'; P.extra.push(c); }
  }
  g.gen = duel(g); step(g, undefined); return g;
};
function step(g, input) {
  try { const r = g.gen.next(input); g.prompt = r.done ? null : r.value; }
  catch (e) { if (e instanceof Over || (e && e.over)) { g.prompt = null; } else throw e; }
}
E.act = function (g, keys, pz) { // pz: optional zone hint {u, to: 'm'|'st', zi} for where the player put the card
  const pr = g.prompt; if (!pr) throw new Error('No prompt');
  if (!Array.isArray(keys)) keys = [keys];
  const valid = new Set(pr.opts.map(o => o.key));
  if (keys.length < pr.min || keys.length > pr.max || keys.some(k => !valid.has(k)) || new Set(keys).size !== keys.length) throw new Error('Bad answer ' + JSON.stringify(keys) + ' to ' + pr.type + ': ' + pr.text);
  g.history.push(keys); (g.pzs || (g.pzs = []))[g.history.length - 1] = pz || null; if (pz) g.pz = pz; step(g, keys);
};
E.clone = function (g, quiet = true) {
  const h = E.newDuel({ ...g.cfg, quiet });
  g.history.forEach((k, i) => E.act(h, k, g.pzs && g.pzs[i]));
  return h;
};
E.scripted = n => { if (SCRIPTS[n] || (FMT !== 'edison' && FSCRIPTS[FMT] && FSCRIPTS[FMT][n])) return true; const d = BYNAME.get(n); return !!d && (d.k === 'normal' || d.k === 'token'); };
E.hasScript = n => !!SCRIPTS[n];

/* A preset position (tutorials, tests): cfg.board = [side0, side1], each {hand, m, st, gy, ban, extra, lp, turn}
 with card names or {n, pos}. Listed hand cards replace the drawn hand; new cards are made for every list. */
function applyBoard(g, board) {
  const idOf = n => { const d = BYNAME.get(n); if (!d) throw new Error('Unknown card ' + n); return d.id; };
  board.forEach((b, p) => {
    if (!b) return; const P = g.p[p];
    if (b.lp != null) P.lp = b.lp;
    const make = (x, zone) => { const nm = typeof x === 'string' ? x : x.n; const c = mk(g, idOf(nm), p); c.zone = zone; return c; };
    if (b.hand) { for (const c of P.hand.splice(0)) { c.zone = 'deck'; P.deck.unshift(c); } for (const x of b.hand) P.hand.push(make(x, 'hand')); }
    // a monster placed in the GY or banished counts as properly summoned before ({n, proper: false} for one that never was), so a preset
    // position can revive its Fusions, Synchros and Ritual Monsters (summoning conditions, 2026-11-27)
    for (const z of ['gy', 'ban', 'extra']) if (b[z]) for (const x of b[z]) { const c = make(x, z); if (z !== 'extra' && !(typeof x === 'object' && x.proper === false)) c.proper = true; P[z].push(c); }
    if (b.deckTop) for (const x of b.deckTop.slice().reverse()) P.deck.push(make(x, 'deck'));
    (b.m || []).forEach((x, i) => { if (!x) return; const c = make(x, 'm'); c.pos = x.pos || 'atk'; c.turnIn = 0; P.m[x.zi != null ? x.zi : i] = c; });
    (b.st || []).forEach((x, i) => { if (!x) return; const c = make(x, 'st'); c.pos = x.pos || 'set'; c.turnIn = 0; P.st[x.zi != null ? x.zi : i] = c; });
    if (b.fz) { const c = make(b.fz, 'fz'); c.pos = b.fz.pos || 'up'; c.turnIn = 0; P.fz = c; }   // a Field Spell (face-up unless {pos: 'set'})
  });
  const tn = board.turn || (board[0] && board[0].turn); if (tn) g.turnNo = tn - 1;
}
function* duel(g) {
  if (!g.cfg.noShuffle) { shuffleDeck(g, 0); shuffleDeck(g, 1); } else for (const P of g.p) P.deck.reverse();
  for (let i = 0; i < 5; i++) { for (const p of [0, 1]) move(g, g.p[p].deck[g.p[p].deck.length - 1], 'hand', { reason: 'draw' }); }
  if (g.cfg.board) applyBoard(g, g.cfg.board);
  log(g, `${PN(g, g.tp)} ${g.tp === 0 && g.cfg.names && g.cfg.names[0] === 'You' ? 'go' : 'goes'} first.`);
  for (;;) { yield* turn(g); g.tp = 1 - g.tp; }
}
function* turn(g) {
  const tp = g.tp; g.turnNo++; g.ns = [0, 0]; g.summoned = [false, false]; g.frogNS = [false, false]; g.noBP = [false, false]; g.noSummon = [false, false]; g.onlyAttacker = [null, null]; g.silverwindUsed = [false, false]; g.roar = null; g.bpEnd = false; g.goBattle = false; g.soulEx = [[], []];
  if (g.coldWave && g.coldWave.p === tp) g.coldWave = null;
  g.rules = g.rules.filter(r => r.startOf !== tp);
  for (const c of fieldMons(g)) { c.attacks = 0; c.posChanged = false; c.declared = false; c.negAtk = 0; }
  log(g, `— Turn ${g.turnNo}: ${PN(g, tp)} —`);
  g.phase = 'draw'; beginOp(g); draw(g, tp, 1); yield* processTriggers(g);
  g.phase = 'standby'; beginOp(g);
  // Gold Sarcophagus: the card comes to the hand in the activator's second Standby Phase
  for (const gs of g.goldSarc.filter(x => x.p === tp)) { gs.n++; if (gs.n >= 2 && gs.c.zone === 'ban') { move(g, gs.c, 'hand', { reason: 'effect' }); log(g, `${PN(g, tp)} added ${name(gs.c)} to the hand (Gold Sarcophagus).`); gs.done = true; } }
  g.goldSarc = g.goldSarc.filter(x => !x.done);
  emit(g, { type: 'phase', ph: 'standby', tp }); yield* processTriggers(g);
  g.phase = 'main1'; g.mainStart = true; yield* mainPhase(g);
  if (g.goBattle) { yield* battlePhase(g); g.phase = 'main2'; g.mainStart = false; yield* mainPhase(g); }
  g.phase = 'end'; beginOp(g); emit(g, { type: 'phase', ph: 'end', tp }); yield* processTriggers(g);
  yield* openWindow(g, 1 - tp, { text: 'End Phase. Activate a card or effect?' });
  // end of turn: "until the End Phase" effects end, control returns
  for (const c of fieldMons(g)) { c.mods = c.mods.filter(m => !m.end); if (c.flags.lvUntil) { c.flags.lv = null; c.flags.lvUntil = null; } }
  g.rules = g.rules.filter(r => !(r.end != null && r.end <= g.turnNo));
  for (const c of fieldMons(g)) if (c.flags.ctrlUntil != null) { const back = c.flags.ctrlFrom; c.flags.ctrlUntil = null; c.flags.ctrlFrom = null; const zi = freeM(g, back); if (zi >= 0) { detach(g, c); c.ctrl = back; g.p[back].m[zi] = c; log(g, `${name(c)} returned to ${PN(g, back)}.`); } else move(g, c, 'gy', { reason: 'rule' }); }
  // hand limit
  const P = g.p[tp];
  if (P.hand.length > 6) { const n = P.hand.length - 6; const ds = yield* pick(g, tp, `Discard ${n} card${n > 1 ? 's' : ''} (hand limit 6)`, P.hand, n, n, 'cost'); beginOp(g); for (const c of ds) move(g, c, 'gy', { reason: 'discard' }); log(g, `${PN(g, tp)} discarded ${ds.map(name).join(', ')} for the hand limit.`); yield* processTriggers(g); }
  for (const c of fieldMons(g)) c.flags.wedgeZero = false;
}

/* Main Phase: the turn player's free actions */
function idleOpts(g) {
  const p = g.tp, P = g.p[p], out = [], main = ['main1', 'main2'].includes(g.phase);
  if (!main) return out;
  const nsLeft = g.ns[p] < 1 || g.frogNS[p];
  if (!g.noSummon[p]) for (const c of P.hand) {
    if (!isMon(c)) continue;
    const nsOk = canNormal(c, 'ns', g, p), setOk = canNormal(c, 'set', g, p);
    // Swap Frog's extra Normal Summon is for a Frog's Summon only, never a Set (site rulings)
    const frogX = g.frogNS[p] && isFrog(c) && !['Swap Frog', 'Frog the Jam'].includes(D(c).n);
    if ((nsOk || setOk) && (g.ns[p] < 1 || frogX)) {
      const cands = tributeCands(g, p), fits = alts => alts.some(n => cands.length >= n && (n > 0 || freeM(g, p) >= 0));
      const altsN = tribNeed(g, p, c), altsS = tribNeed(g, p, c, true);
      if (nsOk && fits(altsN) && !forbid(g, { type: 'ns', c, p })) out.push({ key: 'ns:' + c.u, u: c.u, kind: 'ns', label: Math.min(...altsN.filter(n => cands.length >= n)) ? 'Tribute Summon' : 'Normal Summon' });
      if (setOk && g.ns[p] < 1 && fits(altsS) && !forbid(g, { type: 'set', c, p })) out.push({ key: 'set:' + c.u, u: c.u, kind: 'set', label: 'Set face-down' });
    }
    const sc = SC(c);
    if (sc && sc.proc && !sc.proc.extra && freeM(g, p) >= 0 && sc.proc.cond(g, c, p) && (sc.proc.how === 'normal' || !forbid(g, { type: 'ss', c, p, how: 'special', proc: true })) && !(sc.proc.cost && (gyCostBlocked(g, c, sc.proc) || banCostBlocked(g, p, c, sc.proc)))) out.push({ key: 'sp:' + c.u, u: c.u, kind: 'sp', label: sc.proc.label || 'Special Summon' });
  }
  if (!g.noSummon[p] && freeM(g, p) >= 0 || monsOf(g, p).length) {
    for (const x of P.extra) {
      if (g.noSummon[p]) break;
      if (forbid(g, { type: 'ss', c: x, p, how: D(x).k, proc: true })) continue;
      const xs = SC(x); if (xs && xs.proc && xs.proc.extra && xs.proc.cond(g, x, p) && !(xs.proc.cost && (gyCostBlocked(g, x, xs.proc) || banCostBlocked(g, p, x, xs.proc)))) out.push({ key: 'sp:' + x.u, u: x.u, kind: 'sp', label: xs.proc.label || 'Special Summon' });
      if (D(x).k === 'synchro' && !(xs && xs.noSynchro) && synCombos(g, p, x).length) out.push({ key: 'syn:' + x.u, u: x.u, kind: 'syn', label: 'Synchro Summon' });
      if (D(x).k === 'fusion' && !gyCostBlocked(g, x, 'cf') && cfCombos(g, p, x).length) out.push({ key: 'cf:' + x.u, u: x.u, kind: 'cf', label: 'Special Summon' });
    }
  }
  for (const c of monsOf(g, p)) {
    // an attacker turned face-down can't be Flip Summoned in Main Phase 2 (Book of Moon Goat ruling: no position change after attacking)
    if (c.pos === 'set' && c.turnIn !== g.turnNo && !c.posChanged && !c.attacks && !forbid(g, { type: 'flip', c, p })) out.push({ key: 'flip:' + c.u, u: c.u, kind: 'flip', label: 'Flip Summon' });
    if (faceUp(c) && isGemini(c) && !c.flags.gemini && (g.ns[p] < 1) && !g.noSummon[p] && !forbid(g, { type: 'ns', c, p })) out.push({ key: 'gem:' + c.u, u: c.u, kind: 'gem', label: 'Gemini Summon (gain its effect)' });
    if (c.pos !== 'set' && c.turnIn !== g.turnNo && !c.posChanged && !c.attacks && !forbid(g, { type: 'pos', c })) out.push({ key: 'pos:' + c.u, u: c.u, kind: 'pos', label: c.pos === 'atk' ? 'Change to Defense' : 'Change to Attack' });
  }
  for (const a of activatable(g, p, 'idle')) out.push({ key: `a:${a.c.u}:${a.ei}`, u: a.c.u, kind: 'act', label: a.eff.label || (a.eff.type === 'act' ? 'Activate' : 'Use effect') });
  if (!g.coldWave) for (const c of P.hand) if (isST(c) && D(c).sub === 'Field' && !forbid(g, { type: 'setST', c, p })) out.push({ key: 'setst:' + c.u, u: c.u, kind: 'setst', label: 'Set' });
  if (freeST(g, p) >= 0 && !(g.coldWave)) for (const c of P.hand) if (isST(c) && D(c).sub !== 'Field' && !forbid(g, { type: 'setST', c, p })) out.push({ key: 'setst:' + c.u, u: c.u, kind: 'setst', label: 'Set' });
  if (g.phase === 'main1' && g.turnNo > 1 && !bpLocked(g, p)) out.push({ key: 'bp', kind: 'phase', label: 'Battle Phase' });
  out.push({ key: 'end', kind: 'phase', label: 'End turn' });
  return out;
}
E.idleOpts = idleOpts;
function* mainPhase(g) {
  for (let guard = 0; guard < 200; guard++) {
    g.sw = null;   // the last summon's moment passed in its own response window (afterAction); a fresh prompt doesn't reopen it
    const opts = idleOpts(g);
    const k = (yield* ask(g, g.tp, 'idle', g.phase === 'main1' ? 'Main Phase 1' : 'Main Phase 2', opts))[0];
    if (k === 'bp') { g.goBattle = true; return; }
    if (k === 'end') return;
    // A new action ends the last summon's moment (2026-11-27, a player report: Bottomless Trap Hole was offered against a later card after
    // both players had passed on the summon). The summon's own window (afterAction) already let the turn player act first, then the opponent.
    g.mainStart = false; beginOp(g);
    yield* doIdle(g, k);
  }
}
function* doIdle(g, k) {
  const p = g.tp, P = g.p[p]; const [kind, a, b] = k.split(':'); const u = +a;
  const find = u => [...P.hand, ...P.extra, ...monsOf(g, p), ...stOf(g, p), ...P.gy, ...P.ban, ...fieldOf(g, 1 - p)].find(c => c.u === u);
  const c = find(u);
  if (kind === 'ns' || kind === 'set') return yield* normalSummon(g, p, c, kind === 'set');
  if (kind === 'sp') { const pr = SC(c).proc; let pos = pr.pos || 'atk'; if (!pr.pos && g.cfg.askPos) pos = (yield* choose(g, p, `${name(c)}: which position?`, ['Attack Position', 'Defense Position'])) ? 'def' : 'atk'; return yield* specialProc(g, p, c, pr.how || 'special', pr.cost ? (grp) => pr.cost(g, c, p, grp) : null, pos); }
  if (kind === 'syn') {
    const cs = synCombos(g, p, c); let mats = cs[0];
    if (cs.length > 1) { const i = yield* choose(g, p, `Synchro Summon ${name(c)} with which monsters?`, cs.map(m => m.map(name).join(' + '))); mats = cs[i]; }
    const posI = yield* choose(g, p, `${name(c)}: which position?`, ['Attack Position', 'Defense Position']);
    return yield* specialProc(g, p, c, 'synchro', function* (grp) { for (const m of mats) move(g, m, 'gy', { reason: 'synchro', by: p, group: grp }); log(g, `${PN(g, p)} sent ${mats.map(m => m.snapName || D(m).n).join(' + ')} to the GY for a Synchro Summon.`); }, posI ? 'def' : 'atk');
  }
  if (kind === 'cf') {
    const P = cfPool(g, p, c), firstOk = P.first.filter(a => P.rest.some(x => x !== a));
    const [a1] = firstOk.length > 1 ? yield* pick(g, p, D(c).n === 'Chimeratech Fortress Dragon' ? 'Send which "Cyber Dragon"?' : 'Send which Gemini monster?', firstOk, 1, 1, 'cost') : firstOk;
    const rest = P.rest.filter(x => x !== a1);
    const more = rest.length > P.restMin || P.restMax > 1 && rest.length > 1 ? yield* pick(g, p, D(c).n === 'Chimeratech Fortress Dragon' ? 'Send which Machine monsters (1 or more)?' : 'Send which other Gemini monster?', rest, P.restMin, Math.min(P.restMax, rest.length), 'cost') : rest.slice(0, P.restMin);
    const mats = [a1, ...more];
    const pos = g.cfg.askPos && (yield* choose(g, p, `${name(c)}: which position?`, ['Attack Position', 'Defense Position'])) ? 'def' : 'atk';
    return yield* specialProc(g, p, c, 'fusion', function* (grp) { for (const m of mats) move(g, m, 'gy', { reason: 'fusion', by: p, group: grp }); if (D(c).n === 'Chimeratech Fortress Dragon') { c.flags.baseAtk = 1000 * mats.length; c.flags.ownBaseAtk = true; } }, pos);
  }
  if (kind === 'flip') {
    const group = g.group; c.pos = 'atk'; c.posChanged = true; log(g, `${PN(g, p)} Flip Summoned ${name(c)}.`);
    if (!(yield* summonAttempt(g, p, [c], 'flip'))) { yield* processTriggers(g); return; }
    emit(g, { type: 'flip', c, p }, group); const ev = emit(g, { type: 'summon', cs: [c], how: 'flip', p }, group);
    g.sw = { cs: [c], p, how: 'flip', group: ev.group }; return yield* afterAction(g);
  }
  if (kind === 'gem') {
    const group = g.group; g.ns[p]++; log(g, `${PN(g, p)} Gemini Summoned ${name(c)}.`);
    if (!(yield* summonAttempt(g, p, [c], 'normal'))) { yield* processTriggers(g); return; }
    c.flags.gemini = true; const ev = emit(g, { type: 'summon', cs: [c], how: 'gemini', p }, group);
    g.sw = { cs: [c], p, how: 'gemini', group: ev.group }; return yield* afterAction(g);
  }
  if (kind === 'pos') { c.pos = c.pos === 'atk' ? 'def' : 'atk'; c.posChanged = true; log(g, `${PN(g, p)} changed ${name(c)} to ${c.pos === 'atk' ? 'Attack' : 'Defense'} Position.`); emit(g, { type: 'pos', c, p, from: c.pos === 'atk' ? 'def' : 'atk' }); yield* processTriggers(g); return; }
  if (kind === 'setst') { if (D(c).sub === 'Field') { if (P.fz) destroy(g, [P.fz], { rule: true, by: p }); // replacing your Field Spell destroys it (Geartown rulings: its effect can activate when you Set over it, misses the timing when you activate over it)
 move(g, c, 'fz', { ctrl: p, pos: 'set', reason: 'set' }); log(g, `${PN(g, p)} Set a Field Spell.`); yield* processTriggers(g); return; } move(g, c, 'st', { ctrl: p, pos: 'set', reason: 'set' }); log(g, `${PN(g, p)} Set a card.`);
    // the opponent may respond to a Set before the turn player's next action, e.g. MST it before a Synchro Summon (MST site ruling 1)
    yield* openWindow(g, 1 - p, { text: `${PN(g, p)} Set a card. Respond?`, oppOnly: true }); return; }
  if (kind === 'a') {
    const ei = +b; const eff = effsOf(c)[ei];
    yield* activate(g, p, c, eff, ei); yield* respondLoop(g, 1 - p); yield* resolveChain(g); yield* afterAction(g);
  }
}

/* ---------- battle ---------- */
/* Goat hook (2026-11-24): a script's self.maxAttacks(g, c) sets how many attacks it has this turn, and self.attackOk(g, c, t)
 filters its attack targets (Asura Priest: each opponent's monster once). No Edison script uses either key. */
const selfFn = (g, c, k) => { const sc = SC(c); return sc && sc.self && typeof sc.self[k] === 'function' && faceUp(c) && !negd(g, c) ? sc.self[k] : null; };
function canAttack(g, c) {
  const mx = selfFn(g, c, 'maxAttacks');
  if (c.ctrl !== g.tp || c.pos !== 'atk' || c.attacks >= (mx ? mx(g, c) : c.flags.maxAttacks && c.flags.maxAttacksTurn === g.turnNo ? c.flags.maxAttacks : c.flags.extraAttack && c.flags.extraAttack === g.turnNo ? 2 : 1)) return false;
  if (has(g, c, 'cantAttack') || forbid(g, { type: 'attack', c })) return false;
  { const ac = selfFn(g, c, 'attackCost'); if (ac && g.p[c.ctrl].lp <= ac(g, c)) return false; }
  if (g.onlyAttacker[g.tp] && g.onlyAttacker[g.tp] !== c.u) return false;
  return true;
}
function attackTargets(g, c) {
  const opp = monsOf(g, 1 - g.tp);
  const dupe = opp.filter(x => faceUp(x) && D(x).n === 'Dupe Frog' && !negd(g, x));
  const aok = selfFn(g, c, 'attackOk');
  const targetable = opp.filter(t => !(faceUp(t) && has(g, t, 'noAttackTarget')) && (!aok || aok(g, c, t)));
  // "can't target any monsters for attacks, except this one": with two face-up Dupe Frogs, each excepts only itself, so none can be attacked (pass2 edison-04)
  const out = (dupe.length === 1 ? dupe : dupe.length ? [] : targetable).map(t => t.u);
  if (!opp.length || (D(c).n === 'Unifrog' && !negd(g, c)) || has(g, c, 'directAttack') || (!targetable.length && !dupe.length)) out.push('d');
  if (has(g, c, 'noDirect')) return out.filter(x => x !== 'd');   // "cannot attack directly" (Zombyra the Dark, even with a direct-attack grant: goat-04)
  return out;
}
function battleOpts(g) {
  const out = [];
  if (g.roar == null || g.roar !== g.tp) for (const c of monsOf(g, g.tp)) if (canAttack(g, c)) for (const t of attackTargets(g, c)) {
    const tc = t === 'd' ? null : fieldMons(g).find(x => x.u === t);
    out.push({ key: `atk:${c.u}:${t}`, u: c.u, t: t === 'd' ? null : t, kind: 'atk', label: t === 'd' ? 'Attack directly' : `Attack ${tc.pos === 'set' ? 'the face-down monster' : name(tc)}` });
  }
  for (const a of activatable(g, g.tp, 'respond')) out.push({ key: `a:${a.c.u}:${a.ei}`, u: a.c.u, kind: 'act', label: a.eff.label || 'Activate' });
  out.push({ key: 'endbp', kind: 'phase', label: 'End Battle Phase' });
  return out;
}
E.battleOpts = battleOpts;
function* battlePhase(g) {
  g.phase = 'battle'; beginOp(g); log(g, `${PN(g, g.tp)} entered the Battle Phase.`);
  yield* openWindow(g, 1 - g.tp, { text: 'Start of the Battle Phase. Activate a card or effect?' });
  for (let guard = 0; guard < 60 && !g.bpEnd; guard++) {
    g.sw = null;   // as in mainPhase: "when a monster is Summoned" cards were offered here and crashed once beginOp cleared it (test_engine)
    const k = (yield* ask(g, g.tp, 'idle', 'Battle Phase', battleOpts(g)))[0];
    if (k === 'endbp') break;
    beginOp(g);   // a new action ends the last summon's moment (see mainPhase)
    if (k.startsWith('a:')) { const [, u, ei] = k.split(':'); const c = [...g.p[g.tp].hand, ...allField(g), ...g.p[g.tp].gy, ...g.p[g.tp].ban].find(x => x.u === +u); yield* activate(g, g.tp, c, effsOf(c)[+ei], +ei); yield* respondLoop(g, 1 - g.tp); yield* resolveChain(g); yield* processTriggers(g); continue; }
    const [, au, tu] = k.split(':'); const a = fieldMons(g).find(x => x.u === +au); const t = tu === 'd' ? null : fieldMons(g).find(x => x.u === +tu);
    yield* attack(g, a, t);
  }
  g.bpEnd = false; beginOp(g); emit(g, { type: 'phase', ph: 'bpEnd', tp: g.tp }); yield* processTriggers(g);
}
function* attack(g, a, t) {
  const tp = g.tp, op = 1 - tp;
  for (let replay = 0; replay < 4; replay++) {
    if (!replay) { const ac = selfFn(g, a, 'attackCost'); if (ac) pay(g, tp, ac(g, a)); }
    a.attacks++; a.declared = true; g.attackStopped = false;
    log(g, `${name(a)} attacks ${t ? (t.pos === 'set' ? 'a face-down monster' : name(t)) : 'directly'}.`);
    const before = monsOf(g, op).length; beginOp(g);
    const ev = emit(g, { type: 'attack', a, t, p: tp, direct: !t });
    g.aw = { a, t, group: ev.group, ctrl: tp, open: true, tpOpen: true };   // the attack declaration's own moment, per side (see attackMoment)
    yield* processTriggers(g);
    if (g.aw) yield* openWindow(g, op, { text: `${name(a)} is attacking. Respond?` });
    g.aw = null;
    if (g.attackNegated) { g.attackNegated = false; g.attackStopped = false; a.negAtk = (a.negAtk || 0) + 1; log(g, 'The attack was negated.'); return; }
    if (g.attackStopped) { g.attackStopped = false; log(g, 'The attack stopped.'); return; }   // "can't attack" applied mid-attack: stopped, not negated (Gravity Bind)
    if (g.bpEnd || !onField(a) || a.ctrl !== tp || a.pos !== 'atk') return;
    const now = monsOf(g, op).length;
    if (now !== before || (t && (!onField(t) || t.ctrl !== op))) { // replay
      const tg = attackTargets(g, a); if (g.roar === tp) return;
      const opts = tg.map(x => x === 'd' ? { key: 'd', label: 'Attack directly' } : { key: 'u' + x, label: 'Attack ' + shown(g, fieldMons(g).find(m => m.u === x)) });
      opts.push({ key: 'stop', label: "Don't attack" });
      const k = (yield* ask(g, tp, 'choose', 'The opponent’s monsters changed: choose a new target (replay)', opts))[0];
      if (k === 'stop') return;
      t = k === 'd' ? null : fieldMons(g).find(m => 'u' + m.u === k); a.attacks--; continue;
    }
    break;
  }
  yield* damageStep(g, a, t);
}
function* damageStep(g, a, t) {
  const tp = g.tp, op = 1 - tp;
  g.inDS = true; g.dsCalcDone = false; g.dsReap = null; g.battle = { a, t }; beginOp(g);
  emit(g, { type: 'dsStart', a, t }); yield* processTriggers(g);
  yield* openWindow(g, op, { text: 'Damage Step. Activate a card or effect?' });
  const alive = () => onField(a) && a.ctrl === tp && (!t || (onField(t) && t.ctrl === op));
  if (!alive()) { g.inDS = false; g.battle = null; if (g.dsReap) { const r = g.dsReap; g.dsReap = null; reapSpirit(g, r); } return; }
  let flipped = false;
  if (t && t.pos === 'set') { t.pos = 'def'; flipped = true; g.battle.flipped = t; g.seq++; log(g, `The face-down monster was ${name(t)}.`); }
  yield* openWindow(g, op, { text: 'Before damage calculation. Activate a card or effect?' });
  if (!alive()) { g.inDS = false; g.battle = null; if (g.dsReap) { const r = g.dsReap; g.dsReap = null; reapSpirit(g, r); } return; }
  beginOp(g);
  const A = stat(g, a, 'atk') + (t && t.pos !== 'atk' && D(a).n === 'Blackwing Armed Wing' && !negd(g, a) ? 500 : 0);
  const pierce = c => (!negd(g, c) && ['Blackwing - Bora the Spear', 'Blackwing Armed Wing', 'Flamvell Uruquizas', 'Evil HERO Malicious Edge'].includes(D(c).n)) || has(g, c, 'piercing');
  const noDmg = (p, c1, c2) => [c1, c2].some(c => c && c.ctrl === p && faceUp(c) && ((D(c).n === 'Blackwing Armor Master' && !negd(g, c)) || has(g, c, 'noBattleDamage'))) || g.p[p].noBattleDamage === g.turnNo;
  let killA = false, killT = false, dmgTo = null, dmg = 0;
  const tDef = t && t.pos !== 'atk';
  if (!t) { dmgTo = op; dmg = A; }
  else if (t.pos === 'atk') { const T = stat(g, t, 'atk'); if (A > T) { killT = true; dmgTo = op; dmg = A - T; } else if (A < T) { killA = true; dmgTo = tp; dmg = T - A; } else if (A > 0) { killA = killT = true; } }   // equal ATK: both destroyed, but two 0 ATK monsters both survive (2026-11-26)
  else { const Dv = stat(g, t, 'def'); if (A > Dv) { killT = true; if (pierce(a)) { dmgTo = op; dmg = A - Dv; } } else if (A < Dv) { dmgTo = tp; dmg = Dv - A; } }
  if (dmgTo != null && noDmg(dmgTo, a, t)) dmg = 0;
  if (dmg > 0) damage(g, dmgTo, dmg, { battle: true, src: dmgTo === op ? a : t, srcP: 1 - dmgTo, direct: !t });
  g.dsCalcDone = true; if (g.dsReap) { const r = g.dsReap; g.dsReap = null; reapSpirit(g, r); }   // Spirit Reaper targeted earlier in the Damage Step
  const victims = [];
  if (killT && t && !cantBattleDestroy(g, t)) victims.push([t, a]);
  if (killA && !cantBattleDestroy(g, a)) victims.push([a, t]);
  for (const [v] of victims) v.flags.battleDoomed = true;
  emit(g, { type: 'afterCalc', a, t, tWasDef: tDef, flipped });
  // the battle's own triggers (damage, after damage calculation) activate and resolve before the flipped monster's Flip effect, which
  // starts a new chain (2026-11-27 audit: Red Dragon Archfiend site ruling 1 and archive; Airknight Parshath draws before the Flip effect)
  // (the Flip effect is collected now, while the monster is on the field, and held back: it still activates if the first chain destroyed it)
  if (flipped && onField(t)) emit(g, { type: 'flip', c: t, p: op, battle: true });
  if (flipped) { const held = g.pend.filter(x => x.ev.type === 'flip' && x.ev.battle); if (held.length) { g.pend = g.pend.filter(x => !held.includes(x)); yield* processTriggers(g); for (const x of held) x.held = true; g.pend.push(...held); } }
  yield* processTriggers(g);
  beginOp(g);
  const grp = g.group;
  // "A monster destroyed by this monster as a result of battle is removed from play instead of going to the Graveyard" (Goat Dark Magician
  // of Chaos, self.battleBanish): read for every victim before any leaves, so two that destroy each other are both banished (archive)
  const banV = victims.filter(([v, k]) => k && k.ctrl !== v.ctrl && onField(k) && faceUp(k) && has(g, k, 'battleBanish')).map(([v]) => v);
  // optional "instead" replacements are asked now, before any victim leaves (askReplace)
  const prevPlan = g.replPlan, vs = victims.filter(([v]) => onField(v) && v.flags.battleDoomed && !banV.includes(v)).map(([v]) => v);
  g.replPlan = vs.length ? yield* askReplace(g, vs, { battle: true }) : null;
  // the killer's ATK at the battle, for effects that read it after it left (Zoma the Spirit; 2026-11-28 audit, edison-21)
  const kAtk = new Map(victims.map(([v, k]) => [v, k && onField(k) ? stat(g, k, 'atk') : null]));
  for (const [v, k] of victims) if (onField(v) && v.flags.battleDoomed) { v.flags.battleDoomed = false; if (replaced(g, v, { battle: true, killer: k, batch: vs })) continue; if (banV.includes(v)) { move(g, v, 'ban', { reason: 'battle', destroyed: true, battle: true, killer: k, killerAtk: kAtk.get(v), insteadOf: 'gy', group: grp, noLater: true }); log(g, `${D(v).n} was destroyed by battle and banished.`); continue; } move(g, v, 'gy', { reason: 'battle', destroyed: true, battle: true, killer: k, killerAtk: kAtk.get(v), group: grp, noLater: true }); log(g, `${D(v).n} was destroyed by battle.`); }
  g.replPlan = prevPlan; flushLater(g, grp);
  emit(g, { type: 'dsEnd', a, t, attackedMonster: !!t });
  yield* processTriggers(g);
  g.inDS = false; g.battle = null; if (g.dsReap) { const r = g.dsReap; g.dsReap = null; reapSpirit(g, r); }
}

/* ---------- card scripts ---------- */
const swapRet = x => !isExtraD(D(x)) && D(x).k !== 'token' && !x.flags.banishOnLeave;   // a monster that can go back to the hand as a cost
const opp = p => 1 - p;
const evSummoned = (ev, c, hows) => ev.type === 'summon' && ev.cs.includes(c) && (!hows || hows.includes(ev.how));
const fromFieldToGY = (ev, c) => ev.type === 'move' && ev.c === c && ev.wasField && ev.to === 'gy';
/* c destroyed ev.c by battle. Texts that say "destroys ... by battle and sends it to the Graveyard" need it to land in the GY; plain "destroys ... by battle" texts count a Token or a monster banished instead (2026-11-28 audit,
 findings edison-17 and goat-10: Spyder Spider, Horus LV6, Mystic Swordsman LV2, Nitro Warrior, Brain Golem...; EDOPro EVENT_BATTLE_DESTROYING). */
const BK_GY_RE = /\bdestroys? [^.]{0,80}by battle and sends? (?:it|that monster|the monster|them) to (?:the|its owner's|their owner's|your opponent's) (?:GY|Graveyard)/i;
const bkGY = new Map();
const battleKill = (ev, c) => { if (!(ev.type === 'move' && ev.battle && ev.killer === c && ev.destroyed !== false)) return false;
  const d = D(c); let need = bkGY.get(d.n + FMT); if (need === undefined) { need = BK_GY_RE.test(d.ps || d.tx || ''); bkGY.set(d.n + FMT, need); }
  return need ? ev.to === 'gy' && ev.c.zone === 'gy' : ['gy', 'ban', 'gone', 'hand', 'deck', 'extra'].includes(ev.to); };
/* "Can attack all your opponent's monsters once each" (Asura Priest, Berserk Dragon, Gemini Asura copies): each monster once, a direct
 attack only before it attacked a monster, and none after a direct attack (2026-11-27 audit, Asura ruling 2: a monster that appears
 after its direct attack, from Scapegoat or Call of the Haunted, can't be attacked). For self.maxAttacks / self.attackOk. */
const attacksThisTurn = (g, c) => g.events.filter(e => e.type === 'attack' && e.a === c && e.turn === g.turnNo);
const attackEach = {
  maxAttacks: (g, c) => { const es = attacksThisTurn(g, c); if (es.some(e => e.direct)) return c.attacks; const hit = new Set(es.filter(e => e.t).map(e => e.t.u));
    const rest = monsOf(g, opp(c.ctrl)).filter(m => !hit.has(m.u)).length; return c.attacks + (rest || (c.attacks ? 0 : 1)); },
  attackOk: (g, c, t) => !attacksThisTurn(g, c).some(e => e.t && e.t.u === t.u),
};
// can L (a link, or {c, p} before one exists) target x? ("cannot be targeted", narrowed by the card's own targetFilter)
/* Does this effect (or 'proc', the card's own Special Summon procedure) banish cards from a GY, as a cost or as its effect? Read from the
 card's text, for the effect whose script moves a card to the banished pile (2026-11-27 audit: Kycoo the Ghost Destroyer listed card names,
 so it blocked D.D. Survivor and Burial from a Different Dimension and missed Gigantes, Dark Necrofear, Inferno, Silpheed and Soul of
 Purity and Light; archive: "cannot activate cards/effects that remove cards in the GY from play, whether as cost or as part of their
 effect" and "cannot Summon monsters like Chaos Sorcerer"). */
const GYBAN_RE = /(?:banish|remov\w* from play)[^.;]*?\b(?:from|in) (?:your|their|your opponent's|the opponent's|his|its owner's|either player's|either|each player's|any|both players') (?:own )?(?:GY|Graveyard)|(?:from|in) (?:your|their|your opponent's|either player's|either|any) (?:GY|Graveyard)s?\b[^.]*?;\s*(?:banish|remove)|(?:GY|Graveyard)s?\b[^.]*?\b(?:also banish the second target|and remove them from play)/i;   // the last two: Book of Life, Goat Dark Blade (goat-05)
const PROC_SENT = /[^.]*\bSpecial Summon(?:ed)?\b[^.]*\bby (?:banishing|remov\w*)[^.]*\.?/gi;
const gybanMemo = new Map();
function banishesFromGY(c, eff) {
  if (eff && eff.kycooOk) return false;   // its rulings let it be activated under Kycoo; the GY banish then doesn't happen (Karma Cut)
  if (eff && eff.gyOpt) return false;   // it can use the field instead (Miracle Fusion under Kycoo: site ruling 1); the script asks forbid({type:'banish', from:'gy'})
  const d = D(c), k = d.n + '|' + (eff === 'proc' ? 'proc' : effsOf(c).indexOf(eff)) + '|' + FMT; if (gybanMemo.has(k)) return gybanMemo.get(k);
  // the summon condition ("Must first be Special Summoned ... by banishing ... from your GY") belongs to 'proc', the rest to the effects
  const t = String(d.ps || d.tx || '').replace(/\n/g, ' '), procS = (t.match(PROC_SENT) || []).join(' ');
  let v = GYBAN_RE.test(eff === 'proc' ? procS : t.replace(PROC_SENT, ' '));
  if (v) { const o = eff === 'proc' ? (SC(c) || {}).proc : eff; const src = o ? Object.values(o).filter(f => typeof f === 'function').map(String).join('\n') : ''; v = /['"]ban['"]/.test(src); }
  gybanMemo.set(k, v); return v;
}
/* Can this card be targeted (2026-11-28 audit)? A face-up card on the field with "can't be targeted" (its own or granted), and a card in
 the GY or banished that a static grants it to (Aurkus, Lightsworn Druid: "Neither player can target Lightsworn monsters", site ruling 1:
 on the field, in the GY and banished too). */
const canTarget = (g, x, L) => !(x && (onField(x) ? faceUp(x) : ['gy', 'ban'].includes(x.zone)) && has(g, x, 'cantBeTargeted') && (!L || !L.c || !(SC(x) && SC(x).self && SC(x).self.targetFilter) || SC(x).self.targetFilter(g, x, L)));
function* tgt(g, p, L, text, cands, min = 1, max = 1, hint) { cands = cands.filter(x => canTarget(g, x, L)); const t = yield* pick(g, p, text, cands, min, max, hint); L.t = t; return t; }
const live = (L) => L.t.filter(x => onField(x));
const oppFaceUp = (g, p) => monsOf(g, opp(p)).filter(faceUp);
const stOnField = g => [...stOf(g, 0), ...stOf(g, 1), ...fieldMons(g).filter(isTrapMon)];   // Trap Monsters are Trap Cards too
const lastSummonOk = (g, f) => g.sw && f(g.sw);
const spellTrapAct = L => L && L.cardAct && isST(L.c);

const SCRIPTS = {
  /* ----- Blackwing ----- */
  'Blackwing - Blizzard the Far North': { effs: [{ type: 'trig', when: true, tags: { ss: 1 },
    on: (g, ev, c) => evSummoned(ev, c, ['normal', 'tribute']),
    cond: (g, c, p) => g.p[p].gy.some(x => isBW(x) && isMon(x) && lv(x) <= 4 && canSS(g, p, x)),
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Special Summon a Level 4 or lower Blackwing from your GY', g.p[p].gy.filter(x => isBW(x) && isMon(x) && lv(x) <= 4 && canSS(g, p, x)), 1, 1, 'good'); },
    res: function* (g, c, p, L) { const t = L.t[0]; if (t && t.zone === 'gy') ss(g, p, t, 'def'); } }] },
  'Blackwing - Bora the Spear': { proc: { cond: (g, c, p) => monsOf(g, p).some(x => faceUp(x) && isBW(x) && D(x).n !== 'Blackwing - Bora the Spear'), label: 'Special Summon (you control a Blackwing)' } },
  'Blackwing - Gale the Whirlwind': { proc: { cond: (g, c, p) => monsOf(g, p).some(x => faceUp(x) && isBW(x) && D(x).n !== 'Blackwing - Gale the Whirlwind'), label: 'Special Summon (you control a Blackwing)' },
    effs: [{ type: 'ign', opt: true, label: 'Halve ATK/DEF',
      cond: (g, c, p) => oppFaceUp(g, p).length > 0,
      target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Halve the ATK and DEF of', oppFaceUp(g, p), 1, 1, 'bad'); },
      res: function* (g, c, p, L) { const t = live(L)[0]; if (t && faceUp(t)) { const A = stat(g, t, 'atk'), Dv = stat(g, t, 'def'); addMod(g, t, { set: Math.floor(A / 2), which: 'atk' }); addMod(g, t, { set: Math.floor(Dv / 2), which: 'def' }); log(g, `${name(t)}'s ATK and DEF were halved.`); } } }] },
  'Blackwing - Kalut the Moon Shadow': { effs: [{ type: 'quick', loc: 'hand', ds: true, label: '+1400 ATK',
    cond: (g, c, p) => g.inDS && g.battle && [g.battle.a, g.battle.t].some(x => x && x.ctrl === p && faceUp(x) && isBW(x)),
    cost: function* (g, c, p, L) { L.data.m = [g.battle.a, g.battle.t].find(x => x && x.ctrl === p && isBW(x)); move(g, c, 'gy', { reason: 'cost' }); },
    res: function* (g, c, p, L) { const m = L.data.m; if (m && onField(m) && faceUp(m)) { addMod(g, m, { atk: 1400, end: true }); log(g, `${name(m)} gained 1400 ATK.`); } } }] },
  'Blackwing - Shura the Blue Flame': { effs: [{ type: 'trig', tags: { ss: 1 },
    on: (g, ev, c) => battleKill(ev, c), cond: (g, c, p) => freeM(g, p) >= 0 && g.p[p].deck.filter(x => ssable(g, p, x)).some(x => isBW(x) && isMon(x) && baseAtk(x) <= 1500),
    res: function* (g, c, p, L) { const cands = g.p[p].deck.filter(x => isBW(x) && isMon(x) && baseAtk(x) <= 1500); const [x] = yield* pick(g, p, 'Special Summon a Blackwing with 1500 or less ATK from your Deck', cands, 1, 1, 'good'); if (x) ss(g, p, x, 'atk', { negate: true }); shuffleDeck(g, p); } }] },
  'Blackwing - Sirocco the Dawn': { effs: [{ type: 'ign', opt: true, label: 'Pump a Blackwing',
    cond: (g, c, p) => g.phase === 'main1' && monsOf(g, p).some(x => faceUp(x) && isBW(x)),   // itself alone is fine (ruling 3)
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Which Blackwing gains the ATK?', monsOf(g, p).filter(x => faceUp(x) && isBW(x)), 1, 1, 'good'); },
    after: (g, c, p, L) => { const u = L.t[0] && L.t[0].u; addRule(g, (g2, a) => a.type === 'attack' && a.c && a.c.ctrl === p && a.c.u !== u, { end: g.turnNo }); },   // only the target can attack; gone if the activation is negated (ruling 8)
    res: function* (g, c, p, L) { const t = live(L)[0]; if (!t || !faceUp(t)) return; const add = fieldMons(g).filter(x => x !== t && faceUp(x) && isBW(x)).reduce((s, x) => s + stat(g, x, 'atk'), 0); addMod(g, t, { atk: add, end: true }); log(g, `${name(t)} gained ${add} ATK.`); } }] },
  'Blackwing - Vayu the Emblem of Honor': { effs: [{ type: 'ign', loc: 'gy', tags: { ss: 1 }, label: 'Summon a Blackwing Synchro',
    cond: (g, c, p) => freeM(g, p) >= 0 && g.p[p].gy.filter(x => ssable(g, p, x)).some(x => x !== c && isBW(x) && isMon(x) && !D(x).tu && g.p[p].extra.some(e => D(e).k === 'synchro' && isBW(e) && num(D(e).lv) === lv(x) + lv(c))),
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Banish which non-Tuner Blackwing with Vayu?', g.p[p].gy.filter(x => x !== c && isBW(x) && isMon(x) && !D(x).tu && g.p[p].extra.some(e => D(e).k === 'synchro' && isBW(e) && num(D(e).lv) === lv(x) + lv(c))), 1, 1, 'cost'); },
    res: function* (g, c, p, L) { const t = L.t[0]; if (!t || t.zone !== 'gy' || c.zone !== 'gy') return; const L2 = lv(t) + lv(c); move(g, c, 'ban', { reason: 'effect' }); move(g, t, 'ban', { reason: 'effect' }); const cands = g.p[p].extra.filter(e => D(e).k === 'synchro' && isBW(e) && num(D(e).lv) === L2); const [x] = yield* pick(g, p, 'Special Summon which Blackwing Synchro?', cands, 1, 1, 'good'); if (x) ss(g, p, x, 'atk', { negate: true }); } }] },
  'Dark Armed Dragon': { proc: { cond: (g, c, p) => g.p[p].gy.filter(x => isMon(x) && attr(x) === 'DARK').length === 3, label: 'Special Summon (exactly 3 DARKs in your GY)' },
    effs: [{ type: 'ign', tags: { destroy: 1 }, label: 'Banish a DARK: destroy a card',
      cond: (g, c, p) => g.p[p].gy.some(x => isMon(x) && attr(x) === 'DARK') && allField(g).some(x => x !== c),
      cost: function* (g, c, p, L) { const [x] = yield* pick(g, p, 'Banish a DARK from your GY', g.p[p].gy.filter(x => isMon(x) && attr(x) === 'DARK'), 1, 1, 'cost'); move(g, x, 'ban', { reason: 'cost' }); },
      target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Destroy which card?', allField(g).filter(x => x !== c), 1, 1, 'bad'); },
      res: function* (g, c, p, L) { destroy(g, live(L), { by: p }); } }] },
  'Allure of Darkness': { effs: [{ type: 'act', cond: (g, c, p) => g.p[p].deck.length >= 2,
    res: function* (g, c, p, L) { draw(g, p, 2); const darks = g.p[p].hand.filter(x => isMon(x) && attr(x) === 'DARK'); if (darks.length) { const [x] = yield* pick(g, p, 'Banish a DARK from your hand', darks, 1, 1, 'cost'); if (move(g, x, 'ban', { reason: 'effect' })) log(g, `${PN(g, p)} banished ${name(x)}.`); else log(g, `${PN(g, p)} revealed ${name(x)}.`); } else {   // Imperial Iron Wall chained: revealed, not banished (site ruling)
       const h = g.p[p].hand.slice(); for (const x of h) move(g, x, 'gy', { reason: 'effect' }); log(g, `${PN(g, p)} had no DARK and sent the whole hand to the GY.`); } } }] },
  'Black Whirlwind': { effs: [{ type: 'act', res: function* () {} },
    { type: 'trig', loc: 'st', when: true,
      on: (g, ev, c) => ev.type === 'summon' && ['normal', 'tribute'].includes(ev.how) && ev.p === c.ctrl && ev.cs.some(isBW),
      res: function* (g, c, p, L) { const m = L.ev.cs.find(isBW) || L.ev.cs[0]; if (!onField(m) || !faceUp(m)) return; const A = stat(g, m, 'atk'); yield* search(g, p, x => isBW(x) && isMon(x) && baseAtk(x) < A, `Add a Blackwing with less than ${A} ATK`); } }] },
  'Book of Moon': { effs: [{ type: 'act', cond: (g) => fieldMons(g).some(canFaceDown),
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Turn which monster face-down?', fieldMons(g).filter(canFaceDown), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { const t = live(L)[0]; if (t && faceUp(t)) setFaceDown(g, t); } }] },
  'Brain Control': { effs: [{ type: 'act', cond: (g, c, p) => canPay(g, p, 800, c) && oppFaceUp(g, p).length && freeM(g, p) >= 0,
    cost: function* (g, c, p) { pay(g, p, 800); },
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Take control of which monster?', oppFaceUp(g, p), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { const t = live(L)[0]; if (t && faceUp(t) && t.ctrl !== p) takeControl(g, p, t, true); } }] },
  'Heavy Storm': { effs: [{ type: 'act', tags: { destroy: 1 }, cond: (g, c) => stOnField(g).some(x => x !== c),
    res: function* (g, c, p) { destroy(g, stOnField(g).filter(x => x !== c), { by: p }); } }] },
  'Mystical Space Typhoon': { effs: [{ type: 'act', tags: { destroy: 1 }, cond: (g, c) => stOnField(g).some(x => x !== c),
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Destroy which Spell/Trap?', stOnField(g).filter(x => x !== c), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { destroy(g, live(L), { by: p }); } }] },
  'Bottomless Trap Hole': { effs: [{ type: 'act', tags: { destroy: 1 },
    cond: (g, c, p) => swOf(g, opp(p)).some(x => onField(x) && faceUp(x) && stat(g, x, 'atk') >= 1500),
    target: function* (g, c, p, L) { L.data.cs = swOf(g, opp(p)).slice(); },
    destroys: (g, c, p, L) => (L.data.cs || []).filter(x => onField(x) && faceUp(x) && stat(g, x, 'atk') >= 1500),
    res: function* (g, c, p, L) { destroy(g, L.data.cs.filter(x => onField(x) && faceUp(x) && stat(g, x, 'atk') >= 1500), { by: p, banish: true }); } }] },
  'Dimensional Prison': { effs: [{ type: 'act', cond: (g, c, p) => !!g.aw && g.aw.a.ctrl !== p && canTarget(g, g.aw.a, { c, p }),
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Target the attacking monster', [g.aw.a], 1, 1, 'bad'); },
    res: function* (g, c, p, L) { const t = live(L)[0]; if (attackingNow(g, t)) { move(g, t, 'ban', { reason: 'effect', by: p }); log(g, `${D(t).n} was banished.`); } } }] },
  'Icarus Attack': { effs: [{ type: 'act', tags: { destroy: 1 }, cond: (g, c, p) => tribPool(g, p, { known: true }).some(x => race(x) === 'Winged Beast' && allField(g).filter(y => y !== c && y !== x).length >= 2),   // 2 targets left after the Tribute, face-down Winged Beasts count
    cost: function* (g, c, p) { const [x] = yield* pick(g, p, 'Tribute a Winged Beast', tribPool(g, p, { known: true }).filter(x => race(x) === 'Winged Beast'), 1, 1, 'cost'); move(g, x, 'gy', { reason: 'cost' }); },
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Destroy which 2 cards?', allField(g).filter(x => x !== c), 2, 2, 'bad'); },
    res: function* (g, c, p, L) { destroy(g, live(L), { by: p }); } }] },
  // the effect is chosen on activation; "draw 2" only while the opponent controls a face-up Spirit, and it still draws 2 if the Spirit leaves (site ruling)
  'Legacy of Yata-Garasu': { effs: [{ type: 'act', cond: (g, c, p) => g.p[p].deck.length >= 1,
    target: function* (g, c, p, L) { L.data.n = 1; if (oppFaceUp(g, p).some(x => /\bSpirit\b/.test(D(x).ab || '')) && g.p[p].deck.length >= 2 && (yield* choose(g, p, 'Legacy of Yata-Garasu: which effect?', ['Draw 1 card', 'Draw 2 cards (your opponent controls a Spirit)'])) === 1) L.data.n = 2; },
    res: function* (g, c, p, L) { draw(g, p, L.data.n || 1); } }] },
  'Mirror Force': { effs: [{ type: 'act', tags: { destroy: 1 }, cond: (g, c, p) => g.aw && g.aw.a.ctrl !== p,
    res: function* (g, c, p) { destroy(g, monsOf(g, opp(p)).filter(x => x.pos === 'atk'), { by: p }); } }] },
  'Solemn Judgment': { effs: [{ type: 'act', negSummon: true,
    cond: (g, c, p, x) => (!x.top && g.attempt) || spellTrapAct(x.top),
    cost: function* (g, c, p, L) { pay(g, p, Math.floor(g.p[p].lp / 2)); },
    target: function* (g, c, p, L) { L.data.mode = g.chain.length ? 'link' : 'summon'; L.data.L = g.chain[g.chain.length - 1]; },
    res: function* (g, c, p, L) { if (L.data.mode === 'summon') { if (g.attempt) { g.attempt.negated = true; log(g, 'The summon was negated.'); } } else { L.data.L.negBy = p; negate(g, L.data.L, true); } } }] },
  // Trap Dustshoot shows the whole hand, monsters or not (forum ruling 2)
  'Trap Dustshoot': { effs: [{ type: 'act', cond: (g, c, p) => g.p[opp(p)].hand.length >= 4,
    res: function* (g, c, p) { const h = g.p[opp(p)].hand; log(g, `${PN(g, opp(p))}'s hand: ${h.map(x => D(x).n).join(', ')}.`); const mons = h.filter(isMon); if (!mons.length) return; const [x] = yield* pick(g, p, 'Shuffle which monster into the Deck?', mons, 1, 1, 'bad'); move(g, x, 'deck', { reason: 'effect' }); log(g, `${name(x)} was shuffled into the Deck.`); } }] },
  'Ally of Justice Catastor': { effs: [{ type: 'trig', mand: true, tags: { destroy: 1 },
    on: (g, ev, c) => ev.type === 'dsStart' && (ev.a === c || ev.t === c) && (() => { const o = ev.a === c ? ev.t : ev.a; return o && faceUp(o) && faceUp(c) && attr(o) !== 'DARK'; })(),   // face-down at the start of the Damage Step: no effect (site rulings 1-2, archive)
    res: function* (g, c, p, L) { const o = L.ev.a === c ? L.ev.t : L.ev.a; if (o && onField(o)) destroy(g, [o], { by: p }); } }] },
  'Black Rose Dragon': { effs: [
    { type: 'trig', when: true, tags: { destroy: 1 }, label: 'Destroy all cards on the field', on: (g, ev, c) => evSummoned(ev, c, ['synchro']),
      res: function* (g, c, p) { destroy(g, allField(g), { by: p }); } },
    { type: 'ign', opt: true, label: 'Make a Defense monster 0 ATK',
      cond: (g, c, p) => g.p[p].gy.some(x => isMon(x) && race(x) === 'Plant') && monsOf(g, opp(p)).some(x => x.pos !== 'atk'),
      cost: function* (g, c, p) { const [x] = yield* pick(g, p, 'Banish a Plant from your GY', g.p[p].gy.filter(x => isMon(x) && race(x) === 'Plant'), 1, 1, 'cost'); move(g, x, 'ban', { reason: 'cost' }); },
      target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Change which Defense Position monster?', monsOf(g, opp(p)).filter(x => x.pos !== 'atk'), 1, 1, 'bad'); },
      res: function* (g, c, p, L) { const t = live(L)[0]; if (t && t.pos !== 'atk') { if (t.pos === 'set') log(g, `It was ${name(t)}.`); t.pos = 'atk'; addMod(g, t, { set: 0, which: 'atk', end: true }); log(g, `${name(t)} is in Attack Position with 0 ATK.`); } } }] },
  // ruling 2: under Skill Drain it can still be activated (resolves negated, and the Battle Phase is still locked); the lock goes through
  // lockBP, so a negated activation (Divine Wrath) lifts it (pass2 edison-03)
  'Blackwing - Silverwind the Ascendant': { effs: [{ type: 'trig', when: true, negAct: true, tags: { destroy: 1 }, label: 'Destroy up to 2 monsters',
    on: (g, ev, c) => evSummoned(ev, c, ['synchro']),
    cond: (g, c, p) => fieldMons(g).some(x => x !== c && faceUp(x) && stat(g, x, 'def') < stat(g, c, 'atk')),
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Destroy up to 2 face-up monsters', fieldMons(g).filter(x => x !== c && faceUp(x) && stat(g, x, 'def') < stat(g, c, 'atk')), 1, 2, 'bad'); lockBP(g, p, L); },
    res: function* (g, c, p, L) { destroy(g, live(L).filter(x => faceUp(x) && onField(c) && faceUp(c) && stat(g, x, 'def') < stat(g, c, 'atk')), { by: p }); } }] },   // turned face-down: nothing (ruling 5)
  'Blackwing Armor Master': { effs: [
    { type: 'trig', when: true, on: (g, ev, c) => ev.type === 'dsEnd' && ev.a === c && ev.t && onField(ev.t), label: 'Place a Wedge Counter',
      res: function* (g, c, p, L) { const t = L.ev.t; if (t && onField(t)) { t.flags.wedge = 1; log(g, `${name(t)} got a Wedge Counter.`); } } },
    // ④ is an Ignition Effect; removing the counters is its cost (text, archive), so only the monsters that had them become 0
    { type: 'ign', label: 'Remove Wedge Counters', cond: (g, c, p) => monsOf(g, opp(p)).some(x => x.flags.wedge),
      cost: function* (g, c, p, L) { L.data.had = monsOf(g, opp(p)).filter(x => x.flags.wedge); for (const x of L.data.had) x.flags.wedge = 0; log(g, `${PN(g, p)} removed the Wedge Counters.`); },
      res: function* (g, c, p, L) { for (const x of L.data.had) if (onField(x) && faceUp(x)) { addMod(g, x, { set: 0, which: 'both', end: true }); log(g, `${name(x)}'s ATK and DEF became 0.`); } } }] },
  'Brionac, Dragon of the Ice Barrier': { effs: [{ type: 'ign', label: 'Discard to bounce cards',
    cond: (g, c, p) => g.p[p].hand.length > 0 && allField(g).length > 0,
    cost: function* (g, c, p, L) { const n = yield* choose(g, p, 'Discard how many cards?', [...Array(Math.min(g.p[p].hand.length, allField(g).length)).keys()].map(i => String(i + 1))); const ds = yield* pick(g, p, `Discard ${n + 1} card${n ? 's' : ''}`, g.p[p].hand, n + 1, n + 1, 'cost'); for (const x of ds) move(g, x, 'gy', { reason: 'cost' }); L.data.n = n + 1; },
    target: function* (g, c, p, L) { yield* tgt(g, p, L, `Return ${L.data.n} card(s) to the hand`, allField(g), L.data.n, L.data.n, 'bad'); },
    res: function* (g, c, p, L) { for (const t of live(L)) move(g, t, 'hand', { reason: 'effect', by: p }); log(g, `${L.t.map(D).map(d => d.n).join(', ')} returned to the hand.`); } }] },
  'Colossal Fighter': { effs: [{ type: 'trig', loc: 'gy', tags: { ss: 1 },
    on: (g, ev, c) => ev.type === 'move' && ev.c === c && ev.battle && ev.to === 'gy',
    cond: (g, c, p) => freeM(g, p) >= 0 && allCards(g, 'gy').filter(x => ssable(g, p, x)).some(x => isMon(x) && race(x) === 'Warrior'),
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Special Summon which Warrior from either GY?', allCards(g, 'gy').filter(x => isMon(x) && race(x) === 'Warrior'), 1, 1, 'good'); },
    res: function* (g, c, p, L) { const t = L.t[0]; if (t && t.zone === 'gy') ss(g, p, t); } }] },
  'Dark End Dragon': { effs: [{ type: 'ign', opt: true, label: 'Send a monster to the GY', cond: (g, c, p) => monsOf(g, opp(p)).length > 0 && stat(g, c, 'atk') >= 500 && stat(g, c, 'def') >= 500,
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Send which monster to the GY?', monsOf(g, opp(p)), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { if (!onField(c) || !faceUp(c) || stat(g, c, 'atk') < 500 || stat(g, c, 'def') < 500) return; addMod(g, c, { atk: -500, def: -500, own: true }); const t = live(L)[0]; if (t) { move(g, t, 'gy', { reason: 'effect', by: p }); log(g, `${D(t).n} was sent to the GY.`); } } }] },
  'Goyo Guardian': { effs: [{ type: 'trig', tags: { ss: 1 }, on: (g, ev, c) => battleKill(ev, c), cond: (g, c, p, x) => freeM(g, p) >= 0 && x.ev.c.zone === 'gy',
    res: function* (g, c, p, L) { const t = L.ev.c; if (t.zone === 'gy') ss(g, p, t, 'def'); } }] },
  'Magical Android': { effs: [{ type: 'trig', mand: true, on: (g, ev, c) => ev.type === 'phase' && ev.ph === 'end' && ev.tp === c.ctrl,
    res: function* (g, c, p) { gain(g, p, 600 * monsOf(g, p).filter(x => faceUp(x) && race(x) === 'Psychic').length); } }] },
  'Stardust Dragon': { effs: [
    // usable in the Damage Step (ruling 2); the End Phase summon needs the negation to have resolved (ruling 17: not after Divine Wrath)
    // and Stardust still in the GY it went to (rulings 10, 19)
    { type: 'quick', ds: true, label: 'Tribute to negate', speed: 2,
      cond: (g, c, p, x) => destroysSome(g, x.top),   // only what will certainly destroy a card (rulings 6, 9)
      cost: function* (g, c, p, L) { L.data.L = g.chain[g.chain.length - 1]; move(g, c, 'gy', { reason: 'cost' }); L.data.at = c.moved; },
      res: function* (g, c, p, L) { L.data.L.negBy = p; negate(g, L.data.L, true); if (c.zone === 'gy' && c.moved === L.data.at) (g.stardust || (g.stardust = {}))[c.u] = { t: g.turnNo, at: c.moved }; } },
    { type: 'trig', loc: 'gy', tags: { ss: 1 }, on: (g, ev, c) => ev.type === 'phase' && ev.ph === 'end' && g.stardust && g.stardust[c.u] && g.stardust[c.u].t === g.turnNo && g.stardust[c.u].at === c.moved,
      cond: (g, c, p) => freeM(g, p) >= 0, res: function* (g, c, p) { if (c.zone === 'gy') ss(g, p, c); } }] },
  'Thought Ruler Archfiend': { effs: [
    { type: 'trig', mand: true, on: (g, ev, c) => battleKill(ev, c), res: function* (g, c, p, L) { gain(g, p, baseAtk(L.ev.c)); } },
    { type: 'quick', ds: true, label: 'Pay 1000 to negate', cond: (g, c, p, x) => spellTrapAct(x.top) && x.top.t.length === 1 && isMon(x.top.t[0]) && race(x.top.t[0]) === 'Psychic' && canPay(g, p, 1000),
      cost: function* (g, c, p, L) { pay(g, p, 1000); L.data.L = g.chain[g.chain.length - 1]; }, res: function* (g, c, p, L) { L.data.L.negBy = p; negate(g, L.data.L, true); } }] },
  /* ----- Hybrid / Dark ----- */
  'Armageddon Knight': { effs: [{ type: 'trig', when: true, on: (g, ev, c) => evSummoned(ev, c), cond: (g, c, p) => g.p[p].deck.some(x => isMon(x) && attr(x) === 'DARK'),
    res: function* (g, c, p) { yield* search(g, p, x => isMon(x) && attr(x) === 'DARK', 'Send a DARK monster from your Deck to the GY', 'gy'); } }] },
  'Plaguespreader Zombie': { effs: [{ type: 'ign', loc: 'gy', tags: { ss: 1 }, label: 'Special Summon from the GY', cond: (g, c, p) => freeM(g, p) >= 0 && g.p[p].hand.length > 0,
    cost: function* (g, c, p) { const [x] = yield* pick(g, p, 'Put a card from your hand on top of your Deck', g.p[p].hand, 1, 1, 'cost'); move(g, x, 'deckTop', { reason: 'cost' }); },
    res: function* (g, c, p) { if (c.zone === 'gy') ss(g, p, c, 'atk', { banishOnLeave: true }); } }] },
  'Caius the Shadow Monarch': { effs: [{ type: 'trig', mand: true, on: (g, ev, c) => evSummoned(ev, c, ['tribute']), cond: (g) => allField(g).length > 0,
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Banish which card?', allField(g), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { const t = live(L)[0]; if (!t) return; const o = t.ctrl, cond = !!t.flags.banishOnLeave; move(g, t, 'ban', { reason: 'effect', by: p }); log(g, `${D(t).n} was banished.`);
      // a DARK Monster Card in the banished pile, a face-down one too; not a Token or one banished by its own condition (archive, Plaguespreader and Caius rulings)
      const dark = t.zone === 'ban' && isMon(t) && D(t).k !== 'token' && attr(t) === 'DARK' && !cond; if (dark) damage(g, o === p ? opp(p) : o, 1000, { src: c, srcP: p }); } }] },
  'Card Trooper': { effs: [
    { type: 'ign', opt: true, label: 'Send 1-3 cards to the GY for ATK', cond: (g, c, p) => g.p[p].deck.length > 0,
      // sending the cards is the cost (site ruling, archive): they are sent even if the effect is negated, and are in the GY while the chain builds
      cost: function* (g, c, p, L) { const n = yield* choose(g, p, 'Send how many cards from the top of your Deck?', ['1', '2', '3'].slice(0, Math.min(3, g.p[p].deck.length))); L.data.n = mill(g, p, n + 1, { reason: 'cost' }).filter(x => x.zone === 'gy').length; },   // "for each card sent to the GY this way"
      res: function* (g, c, p, L) { if (onField(c) && faceUp(c)) addMod(g, c, { atk: 500 * L.data.n, end: true, own: true }); } },
    { type: 'trig', loc: 'gy', mand: true, on: (g, ev, c) => ev.type === 'move' && ev.c === c && ev.destroyed && ev.wasField && ev.to === 'gy' && ev.prevCtrl === c.owner,
      res: function* (g, c, p) { draw(g, p, 1); } }] },
  'Dark Grepher': { proc: { label: 'Special Summon (discard a Level 5+ DARK)', cond: (g, c, p) => g.p[p].hand.some(x => x !== c && isMon(x) && lv(x) >= 5 && attr(x) === 'DARK'),
      cost: function* (g, c, p, grp) { const [x] = yield* pick(g, p, 'Discard a Level 5 or higher DARK', g.p[p].hand.filter(x => x !== c && isMon(x) && lv(x) >= 5 && attr(x) === 'DARK'), 1, 1, 'cost'); move(g, x, 'gy', { reason: 'discard', group: grp }); log(g, `${PN(g, p)} discarded ${name(x)}.`); } },
    effs: [{ type: 'ign', opt: true, label: 'Discard a DARK: send a DARK', cond: (g, c, p) => g.p[p].hand.some(x => isMon(x) && attr(x) === 'DARK') && g.p[p].deck.some(x => isMon(x) && attr(x) === 'DARK'),
      cost: function* (g, c, p) { const [x] = yield* pick(g, p, 'Discard a DARK monster', g.p[p].hand.filter(x => isMon(x) && attr(x) === 'DARK'), 1, 1, 'cost'); move(g, x, 'gy', { reason: 'cost' }); },
      res: function* (g, c, p) { yield* search(g, p, x => isMon(x) && attr(x) === 'DARK', 'Send a DARK monster from your Deck to the GY', 'gy'); } }] },
  // the Flip effect activates even with no Beast left; whether to summon is chosen on resolution (rulings)
  'Super-Nimble Mega Hamster': { effs: [{ type: 'trig', mand: true, tags: { ss: 1, ssOpt: 1 }, faceDownOk: true, on: (g, ev, c) => ev.type === 'flip' && ev.c === c,
    res: function* (g, c, p) { const cands = g.p[p].deck.filter(x => isMon(x) && race(x) === 'Beast' && lv(x) <= 3 && canSS(g, p, x)); if (!cands.length || !(yield* yn(g, p, 'Special Summon a Level 3 or lower Beast from your Deck face-down?'))) return; const [x] = yield* pick(g, p, 'Special Summon a Level 3 or lower Beast face-down', cands, 1, 1, 'good'); if (x) ss(g, p, x, 'set'); shuffleDeck(g, p); } }] },
  'Ryko, Lightsworn Hunter': { effs: [{ type: 'trig', mand: true, tags: { destroy: 1 }, on: (g, ev, c) => ev.type === 'flip' && ev.c === c,
    target: function* (g, c, p, L) { const cands = allField(g).filter(x => x !== c && canTarget(g, x, L)); if (cands.length && (yield* yn(g, p, 'Ryko: target a card to destroy?'))) yield* tgt(g, p, L, 'Destroy which card?', cands, 1, 1, 'bad'); },
    res: function* (g, c, p, L) { destroy(g, live(L), { by: p }); mill(g, p, 3); } }] },
  'Spirit Reaper': { effs: [{ type: 'trig', mand: true, on: (g, ev, c) => ev.type === 'damage' && ev.battle && ev.direct && ev.src === c,
    res: function* (g, c, p) { const h = g.p[opp(p)].hand; if (!h.length) return; const x = h[Math.floor(g.rnd() * h.length)]; move(g, x, 'gy', { reason: 'discard' }); log(g, `${PN(g, opp(p))} discarded ${name(x)} at random.`); } }] },
  'Reinforcement of the Army': { effs: [{ type: 'act', cond: (g, c, p) => g.p[p].deck.some(x => isMon(x) && race(x) === 'Warrior' && lv(x) <= 4),
    res: function* (g, c, p) { yield* search(g, p, x => isMon(x) && race(x) === 'Warrior' && lv(x) <= 4, 'Add a Level 4 or lower Warrior'); } }] },
  'Burial from a Different Dimension': { effs: [{ type: 'act', cond: (g) => allCards(g, 'ban').some(isMon),
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Return up to 3 banished monsters to the GY', allCards(g, 'ban').filter(isMon), 1, 3, 'good'); },
    res: function* (g, c, p, L) { for (const t of L.t) if (t.zone === 'ban') move(g, t, 'gy', { reason: 'effect' }); log(g, `${L.t.map(x => D(x).n).join(', ')} returned to the GY.`); } }] },
  'Dust Tornado': { effs: [{ type: 'act', tags: { destroy: 1 }, cond: (g, c, p) => stOf(g, opp(p)).length > 0,
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Destroy which Spell/Trap?', stOf(g, opp(p)), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { if (!destroy(g, live(L), { by: p }).length) return;   // you may Set only if this destroyed it (site and archive)
      const st = g.p[p].hand.filter(isST); if (st.length && freeST(g, p) >= 0 && (yield* yn(g, p, 'Set a Spell/Trap from your hand?'))) { const [x] = yield* pick(g, p, 'Set which card?', st, 1, 1, 'good'); move(g, x, 'st', { ctrl: p, pos: 'set', reason: 'set' }); log(g, `${PN(g, p)} Set a card.`); } } }] },
  'Royal Oppression': { effs: [{ type: 'act', res: function* () {} },
    { type: 'quick', loc: 'st', anyPlayer: true, negSummon: true, label: 'Pay 800: negate the Special Summon',
      cond: (g, c, p, x) => canPay(g, p, 800) && !g.chain.some(L => L.c === c && L.eff.type === 'act') && ((!x.top && g.attempt && !['normal', 'tribute', 'flip'].includes(g.attempt.how)) || (x.top && x.top.tags && x.top.tags.ss && !x.top.negated)),
      cost: function* (g, c, p, L) { pay(g, p, 800); L.data.mode = g.chain.length ? 'link' : 'summon'; L.data.L = g.chain[g.chain.length - 1]; },
      res: function* (g, c, p, L) { if (L.data.mode === 'summon') { if (g.attempt) { g.attempt.negated = true; log(g, 'The Special Summon was negated.'); } } else { L.data.L.negBy = p; negate(g, L.data.L, true); } } }] },
  'Compulsory Evacuation Device': { effs: [{ type: 'act', cond: (g) => fieldMons(g).length > 0,
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Return which monster to the hand?', fieldMons(g), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { const t = live(L)[0]; if (t) { move(g, t, 'hand', { reason: 'effect', by: p }); log(g, `${D(t).n} returned to the ${isExtraD(D(t)) ? 'Extra Deck' : 'hand'}.`); } } }] },
  'Torrential Tribute': { effs: [{ type: 'act', tags: { destroy: 1 }, cond: (g) => !!g.sw,
    res: function* (g, c, p) { destroy(g, fieldMons(g), { by: p }); } }] },
  'Dark Bribe': { effs: [{ type: 'act', cond: (g, c, p, x) => spellTrapAct(x.top) && x.top.p !== p && g.p[x.top.p].deck.length > 0,   // not when they can't draw (site ruling 2)
    target: function* (g, c, p, L) { L.data.L = g.chain[g.chain.length - 1]; },
    res: function* (g, c, p, L) { const o = L.data.L.p; draw(g, o, 1); L.data.L.negBy = p; negate(g, L.data.L, true); } }] },
  'Battle Fader': { effs: [{ type: 'trig', loc: 'hand', tags: { ss: 1 }, on: (g, ev, c) => ev.type === 'attack' && ev.direct && ev.p !== c.owner,
    cond: (g, c, p) => freeM(g, p) >= 0,
    res: function* (g, c, p) { if (c.zone === 'hand' && ss(g, p, c, 'def', { banishOnLeave: true })) { g.bpEnd = true; g.aw = null; log(g, 'The Battle Phase ended.'); } } }] },
  /* ----- Frogs and HEROes ----- */
  'Dupe Frog': { effs: [{ type: 'trig', loc: 'gy', when: true, on: (g, ev, c) => fromFieldToGY(ev, c),
    cond: (g, c, p) => [...g.p[p].deck, ...g.p[p].gy].some(x => isMon(x) && /frog/i.test(D(x).n) && D(x).n !== 'Dupe Frog'),
    res: function* (g, c, p) { const cands = [...g.p[p].deck, ...g.p[p].gy].filter(x => isMon(x) && /frog/i.test(D(x).n) && D(x).n !== 'Dupe Frog'); const [x] = yield* pick(g, p, 'Add a Frog from your Deck or GY to your hand', cands, 1, 1, 'good'); if (x) { const fromDeck = x.zone === 'deck'; move(g, x, 'hand', { reason: 'effect' }); log(g, `${PN(g, p)} added ${name(x)} to the hand.`); if (fromDeck) shuffleDeck(g, p); } } }] },
  'Elemental HERO Ocean': { effs: [{ type: 'trig', opt: true, on: (g, ev, c) => ev.type === 'phase' && ev.ph === 'standby' && ev.tp === c.ctrl,
    cond: (g, c, p) => [...monsOf(g, p).filter(faceUp), ...g.p[p].gy].some(x => isMon(x) && isHERO(x)),
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Return which HERO to your hand?', [...monsOf(g, p).filter(faceUp), ...g.p[p].gy].filter(x => isMon(x) && isHERO(x)), 1, 1, 'good'); },
    res: function* (g, c, p, L) { const t = L.t[0]; if (t && (t.zone === 'gy' || onField(t))) { move(g, t, 'hand', { reason: 'effect' }); log(g, `${D(t).n} returned to the hand.`); } } }] },
  // the effect is declared on activation (site ruling, archive); "destroy" needs another face-up HERO then, counts them on resolution and may
  // destroy 0; it picks on resolution, so nothing is certain to be destroyed (Starlight Road and Stardust can't answer it: site)
  'Elemental HERO Stratos': { effs: [{ type: 'trig', when: true, on: (g, ev, c) => evSummoned(ev, c) && ev.how !== 'flip',
    cond: (g, c, p) => monsOf(g, p).some(x => x !== c && faceUp(x) && isHERO(x)) || g.p[p].deck.some(x => isMon(x) && isHERO(x)),
    destroys: () => [],
    target: function* (g, c, p, L) { const canD = monsOf(g, p).some(x => x !== c && faceUp(x) && isHERO(x)), canS = g.p[p].deck.some(x => isMon(x) && isHERO(x));
      L.data.mode = canD && canS ? yield* choose(g, p, 'Stratos: choose an effect', ['Destroy Spells/Traps', 'Add a HERO from your Deck']) : canD ? 0 : 1; log(g, `Stratos: ${L.data.mode ? 'add a HERO' : 'destroy Spells/Traps'}.`); },
    res: function* (g, c, p, L) { if (L.data.mode === 0) { const heroes = monsOf(g, p).filter(x => x !== c && faceUp(x) && isHERO(x)).length; const st = stOnField(g); if (!heroes || !st.length) return; const ts = yield* pick(g, p, `Destroy up to ${heroes} Spell/Trap card(s)`, st, 0, Math.min(heroes, st.length), 'bad'); if (ts.length) destroy(g, ts, { by: p }); }
      else yield* search(g, p, x => isMon(x) && isHERO(x), 'Add a HERO from your Deck'); } }] },
  'Evil HERO Infernal Prodigy': { proc: { cond: (g, c, p) => monsOf(g, p).length === 0, label: 'Special Summon (you control no monsters)' },
    // ② draws in the End Phase if it was Tributed for a HERO's Tribute Summon this turn and is in the GY or banished: banished when Tributed
    // (Macro Cosmos) or later (Soul Release) still draws; back in the GY from banished, or anywhere else, doesn't (site rulings 2, 3)
    effs: [{ type: 'trig', loc: 'any', mand: true, on: (g, ev, c) => ev.type === 'phase' && ev.ph === 'end' && c.flags.prodigy === g.turnNo && (c.zone === 'gy' || c.zone === 'ban'), res: function* (g, c, p) { draw(g, p, 1); } },
      { type: 'trig', loc: 'any', mand: true, on: (g, ev, c) => { if (ev.type === 'summon' && ev.how === 'tribute' && ev.tribs && ev.tribs.includes(c) && ev.cs.some(isHERO) && (c.zone === 'gy' || c.zone === 'ban')) c.flags.prodigy = g.turnNo;
        else if (ev.type === 'move' && ev.c === c && c.flags.prodigy && !(ev.from === 'gy' && ev.to === 'ban')) c.flags.prodigy = 0; return false; }, res: function* () {} }] },
  'Gorz the Emissary of Darkness': { effs: [{ type: 'trig', loc: 'hand', when: true, tags: { ss: 1 },
    on: (g, ev, c) => ev.type === 'damage' && ev.p === c.owner && ev.srcP === 1 - c.owner,
    cond: (g, c, p) => fieldOf(g, p).length === 0,
    res: function* (g, c, p, L) { if (c.zone !== 'hand' || fieldOf(g, p).length) return; if (!ss(g, p, c)) return; const ev = L.ev;
      if (ev.battle) { if (freeM(g, p) >= 0) { const t = mk(g, 'tok-gorz', p); t.zone = 'tok'; t.flags.tokAtk = ev.n; move(g, t, 'm', { ctrl: p, pos: 'atk', reason: 'summon' }); t.flags.tokAtk = ev.n; t.flags.tokDef = ev.n; addMod(g, t, { set: ev.n, which: 'def' }); log(g, `${PN(g, p)} Special Summoned an Emissary of Darkness Token with ${ev.n} ATK.`); } }
      else damage(g, opp(p), ev.n, { src: c, srcP: p }); } }] },
  'Junk Synchron': { effs: [{ type: 'trig', when: true, tags: { ss: 1 }, on: (g, ev, c) => evSummoned(ev, c, ['normal']),
    cond: (g, c, p) => g.p[p].gy.some(x => isMon(x) && lv(x) <= 2 && canSS(g, p, x)),
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Special Summon a Level 2 or lower monster from your GY', g.p[p].gy.filter(x => isMon(x) && lv(x) <= 2 && canSS(g, p, x)), 1, 1, 'good'); },
    res: function* (g, c, p, L) { const t = L.t[0]; if (t && t.zone === 'gy') ss(g, p, t, 'def', { negate: true }); } }] },
  'Raiza the Storm Monarch': { effs: [{ type: 'trig', mand: true, on: (g, ev, c) => evSummoned(ev, c, ['tribute']), cond: g => allField(g).length > 0,
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Return which card to the top of the Deck?', allField(g), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { const t = live(L)[0]; if (t && move(g, t, 'deckTop', { reason: 'effect', by: p })) log(g, `${D(t).n} was put on top of the Deck.`); } }] },   // a chained Spell/Trap that resolved stays (site ruling 1)
  'Substitoad': { effs: [{ type: 'ign', tags: { ss: 1 }, label: 'Tribute a monster: summon a Frog', cond: (g, c, p) => tribPool(g, p).length > 0 && g.p[p].deck.filter(x => ssable(g, p, x)).some(x => isMon(x) && /frog/i.test(D(x).n)),
    cost: function* (g, c, p) { const [x] = yield* pick(g, p, 'Tribute a monster', tribPool(g, p), 1, 1, 'cost'); move(g, x, 'gy', { reason: 'cost', by: p }); log(g, `${PN(g, p)} Tributed ${D(x).n}.`); },
    res: function* (g, c, p) { const cands = g.p[p].deck.filter(x => isMon(x) && /frog/i.test(D(x).n)); const [x] = yield* pick(g, p, 'Special Summon a Frog from your Deck', cands, 1, 1, 'good'); if (x) ss(g, p, x); shuffleDeck(g, p); } }] },
  'Swap Frog': { proc: { label: 'Special Summon (discard a WATER)', cond: (g, c, p) => g.p[p].hand.some(x => x !== c && isMon(x) && attr(x) === 'WATER'),
      cost: function* (g, c, p, grp) { const [x] = yield* pick(g, p, 'Discard a WATER monster', g.p[p].hand.filter(x => x !== c && isMon(x) && attr(x) === 'WATER'), 1, 1, 'cost'); move(g, x, 'gy', { reason: 'discard', group: grp }); log(g, `${PN(g, p)} discarded ${name(x)}.`); } },
    effs: [{ type: 'trig', when: true, on: (g, ev, c) => evSummoned(ev, c), cond: (g, c, p) => [...g.p[p].deck, ...monsOf(g, p).filter(x => x !== c && faceUp(x))].some(x => isMon(x) && lv(x) <= 2 && attr(x) === 'WATER' && race(x) === 'Aqua'),
      res: function* (g, c, p) { const cands = [...g.p[p].deck, ...monsOf(g, p).filter(x => faceUp(x))].filter(x => isMon(x) && lv(x) <= 2 && attr(x) === 'WATER' && race(x) === 'Aqua'); const [x] = yield* pick(g, p, 'Send a Level 2 or lower WATER Aqua to the GY', cands, 1, 1, 'cost'); if (x) { const fromDeck = x.zone === 'deck'; move(g, x, 'gy', { reason: 'effect' }); log(g, `${PN(g, p)} sent ${D(x).n} to the GY.`); if (fromDeck) shuffleDeck(g, p); } } },
      { type: 'ign', opt: true, label: 'Return a monster: extra Frog summon', cond: (g, c, p) => monsOf(g, p).some(swapRet),
        cost: function* (g, c, p) { const [x] = yield* pick(g, p, 'Return a monster you control to the hand', monsOf(g, p).filter(swapRet), 1, 1, 'cost'); move(g, x, 'hand', { reason: 'cost' }); log(g, `${PN(g, p)} returned ${D(x).n} to the hand.`); },
        // "you can't gain more than 1 additional Summon this way" (site, ruling 5, archive): one per turn
        res: function* (g, c, p) { g.frogGiven = g.frogGiven || [null, null]; if (g.frogGiven[p] === g.turnNo) { log(g, `${PN(g, p)} already gained an extra Frog summon this turn.`); return; }
          g.frogGiven[p] = g.turnNo; g.frogNS[p] = true; log(g, `${PN(g, p)} can Normal Summon a Frog once more this turn.`); } }] },
  // also when it is sent to the GY again during that same Standby Phase (site ruling 1)
  'Treeborn Frog': { effs: [{ type: 'trig', loc: 'gy', tags: { ss: 1 }, oneName: true, on: (g, ev, c) => (ev.type === 'phase' && ev.ph === 'standby' && ev.tp === c.owner) || (ev.type === 'move' && ev.c === c && ev.to === 'gy' && g.phase === 'standby' && g.tp === c.owner)
      || (ev.type === 'negated' && ev.c === c && c.zone === 'gy' && g.phase === 'standby' && g.tp === c.owner),   // ruling 6: negated, it can activate again in that phase
    cond: (g, c, p) => freeM(g, p) >= 0 && stOf(g, p).length === 0 && !monsOf(g, p).some(x => faceUp(x) && D(x).n === 'Treeborn Frog'),
    res: function* (g, c, p) { if (c.zone === 'gy' && stOf(g, p).length === 0 && !monsOf(g, p).some(x => faceUp(x) && D(x).n === 'Treeborn Frog')) ss(g, p, c); } }] },
  'E - Emergency Call': { effs: [{ type: 'act', cond: (g, c, p) => g.p[p].deck.some(x => isMon(x) && /^Elemental HERO/.test(D(x).n)),
    res: function* (g, c, p) { yield* search(g, p, x => isMon(x) && /^Elemental HERO/.test(D(x).n), 'Add an Elemental HERO'); } }] },
  'Enemy Controller': { effs: [{ type: 'act', cond: (g, c, p) => oppFaceUp(g, p).length > 0,
    cost: function* (g, c, p, L) { const canTake = tribPool(g, p).length > 0; L.data.mode = canTake ? yield* choose(g, p, 'Enemy Controller: choose', ['Change its battle position', 'Tribute a monster and take control']) : 0;
      if (L.data.mode === 1) { const [x] = yield* pick(g, p, 'Tribute a monster', tribPool(g, p), 1, 1, 'cost'); move(g, x, 'gy', { reason: 'cost', by: p }); } },
    target: function* (g, c, p, L) { yield* tgt(g, p, L, L.data.mode ? 'Take control of which monster?' : 'Change the position of which monster?', oppFaceUp(g, p), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { const t = live(L)[0]; if (!t || !faceUp(t)) return; if (L.data.mode) takeControl(g, p, t, true); else { t.pos = t.pos === 'atk' ? 'def' : 'atk'; log(g, `${name(t)} changed to ${t.pos === 'atk' ? 'Attack' : 'Defense'} Position.`); } } }] },
  /* Miracle Fusion (2026-11-27 audit): any "Elemental HERO" Fusion whose listed materials are on your field (face-down ones too) or in your
   GY, banished on resolution (not a cost); under Kycoo only field materials (site ruling 1, archive). The generic fusionSummon reads each
   Fusion's material line, so every E-HERO Fusion in the pool works, not only Absolute Zero and Gaia. */
  'Miracle Fusion': { effs: [{ type: 'act', tags: { ss: 1 }, gyOpt: true, cond: (g, c, p) => canFusion(g, p, mfOpts(g, p)),
    res: function* (g, c, p) { yield* fusionSummon(g, p, mfOpts(g, p)); } }] },
  // a Level 1 to Summon must be left once the cost is paid (ruling 3): some monster to send that isn't the only Level 1
  'One for One': { effs: [{ type: 'act', tags: { ss: 1 }, cond: (g, c, p) => { if (freeM(g, p) < 0) return false; const l1 = [...g.p[p].hand, ...g.p[p].deck].filter(x => x !== c && isMon(x) && lv(x) === 1 && !isExtraD(D(x)) && canSS(g, p, x)); return g.p[p].hand.some(x => x !== c && isMon(x) && l1.some(y => y !== x)); },
    cost: function* (g, c, p, L) { const [x] = yield* pick(g, p, 'Send a monster from your hand to the GY', g.p[p].hand.filter(x => x !== c && isMon(x)), 1, 1, 'cost'); move(g, x, 'gy', { reason: 'cost' }); },
    res: function* (g, c, p) { const cands = [...g.p[p].hand, ...g.p[p].deck].filter(x => isMon(x) && lv(x) === 1 && canSS(g, p, x)); const [x] = yield* pick(g, p, 'Special Summon a Level 1 monster from your hand or Deck', cands, 1, 1, 'good'); if (x) { const fromDeck = x.zone === 'deck'; ss(g, p, x); if (fromDeck) shuffleDeck(g, p); } } }] },
  'Soul Exchange': { effs: [{ type: 'act', cond: (g, c, p) => monsOf(g, opp(p)).length > 0 && g.phase === 'main1',
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Tribute which of their monsters this turn?', monsOf(g, opp(p)), 1, 1, 'bad'); lockBP(g, p, L); },
    res: function* (g, c, p, L) { const t = live(L)[0]; if (t) { g.soulEx[p] = [...(g.soulEx[p] || []), t.u]; log(g, `${PN(g, p)} can Tribute ${shown(g, t)} this turn.`); } } }] },
  'Raigeki Break': { effs: [{ type: 'act', tags: { destroy: 1 }, cond: (g, c, p) => g.p[p].hand.length > 0 && allField(g).some(x => x !== c),
    cost: function* (g, c, p) { const [x] = yield* pick(g, p, 'Discard a card', g.p[p].hand, 1, 1, 'cost'); move(g, x, 'gy', { reason: 'cost' }); },
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Destroy which card?', allField(g).filter(x => x !== c), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { destroy(g, live(L), { by: p }); } }] },
  'Elemental HERO Absolute Zero': { effs: [{ type: 'trig', loc: 'any', mand: true, tags: { destroy: 1 }, on: (g, ev, c) => ev.type === 'move' && ev.c === c && ev.wasField && ev.snap && ev.snap.faceUp,   // not when it left face-down (site, archive)
    res: function* (g, c, p) { destroy(g, monsOf(g, opp(p)), { by: p }); } }] },
  'Elemental HERO Gaia': { effs: [{ type: 'trig', mand: true, on: (g, ev, c) => evSummoned(ev, c, ['fusion']), cond: (g, c, p) => oppFaceUp(g, p).length > 0,
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Halve the ATK of which monster?', oppFaceUp(g, p), 1, 1, 'bad'); },
    res: function* (g, c, p, L) { const t = live(L)[0]; if (!t || !faceUp(t) || !onField(c) || !faceUp(c)) return; const A = stat(g, t, 'atk'), h = A - Math.floor(A / 2); addMod(g, t, { set: Math.floor(A / 2), which: 'atk', end: true }); addMod(g, c, { atk: h, end: true }); log(g, `${name(t)} lost ${h} ATK and Gaia gained it.`); } }] },
  /* Armory Arm (2026-11-27 audit; site rulings and archive): once per turn either equip (effect 0, from the Monster Zone) or unequip and
   Special Summon itself in Attack Position (effect 2, from the Spell/Trap Zone), one or the other; the +1000 is its own lasting effect
   (cont.atk), on whichever player's monster it is equipped to, and it stays in your zone; your opponent takes the damage (it is still your
   card). If the target leaves before the equip resolves, Armory Arm is destroyed. While equipped its effects are an Equip Spell's (Cold Wave). */
  'Armory Arm': { cont: { atk: (g, s, m) => s.zone === 'st' && s.equipTo === m.u ? 1000 : 0 },
    effs: [{ type: 'ign', opt: true, label: 'Equip to a monster', cond: (g, c, p) => c.used[2] !== g.turnNo && fieldMons(g).some(x => x !== c && faceUp(x)) && freeST(g, p) >= 0,
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Equip Armory Arm to which monster?', fieldMons(g).filter(x => x !== c && faceUp(x)), 1, 1, 'good'); },
    res: function* (g, c, p, L) { if (!onField(c)) return; const t = live(L)[0]; if (!t || !faceUp(t)) { destroy(g, [c], { by: p }); log(g, 'Armory Arm had nothing to equip to and was destroyed.'); return; } if (freeST(g, p) < 0) return; move(g, c, 'st', { ctrl: p, pos: 'up', reason: 'equip' }); c.used[0] = g.turnNo; c.equipTo = t.u; log(g, `Armory Arm was equipped to ${name(t)} (+1000 ATK).`); } },
    { type: 'trig', loc: 'st', mand: true, on: (g, ev, c) => ev.type === 'move' && ev.battle && ev.killer && ev.killer.u === c.equipTo && ev.to === 'gy',
      res: function* (g, c, p, L) { damage(g, opp(p), L.ev.snap ? L.ev.snap.atk : 0, { src: c, srcP: p }); } },   // the ATK it had on the field, even if it left the GY (site ruling, archive)
    { type: 'ign', loc: 'st', opt: true, tags: { ss: 1 }, label: 'Unequip and Special Summon', cond: (g, c, p) => c.used[0] !== g.turnNo && !!c.equipTo && freeM(g, p) >= 0 && canSS(g, p, c),
      res: function* (g, c, p) { if (c.zone !== 'st' || !faceUp(c)) return; c.equipTo = null; if (ss(g, p, c, 'atk')) { c.used[2] = g.turnNo; log(g, 'Armory Arm was unequipped and Special Summoned.'); } } }] },
  'Junk Warrior': { effs: [{ type: 'trig', mand: true, on: (g, ev, c) => evSummoned(ev, c, ['synchro']),
    res: function* (g, c, p) { if (!onField(c)) return; const add = monsOf(g, p).filter(x => faceUp(x) && lv(x) <= 2).reduce((s, x) => s + stat(g, x, 'atk'), 0); addMod(g, c, { atk: add }); log(g, `Junk Warrior gained ${add} ATK.`); } }] },
  'Mist Wurm': { effs: [{ type: 'trig', mand: true, on: (g, ev, c) => evSummoned(ev, c, ['synchro']), cond: (g, c, p) => fieldOf(g, opp(p)).length > 0,
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Return up to 3 of their cards to the hand', fieldOf(g, opp(p)), 1, 3, 'bad'); },
    res: function* (g, c, p, L) { const ts = live(L); for (const t of ts) move(g, t, 'hand', { reason: 'effect', by: p }); if (ts.length) log(g, `${ts.length} card(s) returned to the hand.`); } }] },
  'Unifrog': { effs: [{ type: 'trig', on: (g, ev, c) => ev.type === 'damage' && ev.battle && ev.direct && ev.src === c,
    cond: (g, c, p) => monsOf(g, p).some(x => faceUp(x) && isFrog(x) && !['Unifrog', 'Frog the Jam'].includes(D(x).n)) && stOf(g, opp(p)).length > 0,
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Destroy which Spell/Trap?', stOf(g, opp(p)), 1, 1, 'bad'); },
    tags: { destroy: 1 }, res: function* (g, c, p, L) { destroy(g, live(L), { by: p }); } }] },
  // a "when ... you can" effect: it misses the timing when Tribute Summoned mid-chain (Ultimate Offering: site ruling 4, archive; RULINGS_DECIDED)
  'Mobius the Frost Monarch': { effs: [{ type: 'trig', when: true, tags: { destroy: 1 }, on: (g, ev, c) => evSummoned(ev, c, ['tribute']), cond: g => stOnField(g).length > 0,
    target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Destroy up to 2 Spells/Traps', stOnField(g), 1, 2, 'bad'); },
    res: function* (g, c, p, L) { destroy(g, live(L), { by: p }); } }] },
  'Tragoedia': { effs: [
    { type: 'trig', loc: 'hand', tags: { ss: 1 }, on: (g, ev, c) => ev.type === 'damage' && ev.battle && ev.p === c.owner, cond: (g, c, p) => freeM(g, p) >= 0,
      res: function* (g, c, p) { if (c.zone === 'hand') ss(g, p, c); } },
    { type: 'ign', opt: true, label: 'Take control of a monster', cond: (g, c, p) => freeM(g, p) >= 0 && g.p[p].hand.some(x => isMon(x) && oppFaceUp(g, p).some(t => lv(t) === lv(x))),
      cost: function* (g, c, p, L) { const [x] = yield* pick(g, p, 'Send a monster from your hand to the GY', g.p[p].hand.filter(x => isMon(x) && oppFaceUp(g, p).some(t => lv(t) === lv(x))), 1, 1, 'cost'); L.data.lv = lv(x); move(g, x, 'gy', { reason: 'cost' }); },
      target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Take control of which monster?', oppFaceUp(g, p).filter(t => lv(t) === L.data.lv), 1, 1, 'bad'); },
      res: function* (g, c, p, L) { const t = live(L)[0]; if (t && faceUp(t)) takeControl(g, p, t, false); } },
    { type: 'ign', opt: true, label: 'Copy a Level', cond: (g, c, p) => g.p[p].gy.some(isMon),
      target: function* (g, c, p, L) { yield* tgt(g, p, L, 'Copy the Level of which monster in your GY?', g.p[p].gy.filter(isMon), 1, 1, 'good'); },
      res: function* (g, c, p, L) { const t = L.t[0]; if (t && t.zone === 'gy' && onField(c) && faceUp(c)) { c.flags.lv = lv(t); c.flags.lvUntil = true; log(g, `Tragoedia's Level became ${lv(t)}.`); } } }] },
  'Gold Sarcophagus': { effs: [{ type: 'act', cond: (g, c, p) => g.p[p].deck.length > 0,
    res: function* (g, c, p) { const [x] = yield* pick(g, p, 'Banish which card from your Deck?', g.p[p].deck, 1, 1, 'good'); if (x) { move(g, x, 'ban', { reason: 'effect' }); g.goldSarc.push({ c: x, p, n: 0 }); log(g, `${PN(g, p)} banished ${name(x)} face-up with Gold Sarcophagus.`); } shuffleDeck(g, p); } }] },
  'Scapegoat': { effs: [{ type: 'act', tags: { ss: 1 }, cond: (g, c, p) => nFreeM(g, p) >= 4 && !g.summoned[p],
    // "You can't Summon other monsters the turn you activate this card" (2026-11-27 audit): Normal, Flip and Special Summons, not Sets
    // (ruling 7); from the activation on, and gone if the activation is negated but not if only its effect is (site rulings, ruling 3,
    // ruling 5: Royal Oppression). The rule is added in `after`, so it belongs to this link (addRule).
    after: (g, c, p) => { addRule(g, (g2, a) => ['ns', 'flip', 'ss'].includes(a.type) && a.p === p && ssSrcOf(g2, a) !== c, { end: g.turnNo }); },
    res: function* (g, c, p) { const grp = g.group; const toks = []; for (let i = 0; i < 4; i++) { if (freeM(g, p) < 0) break; if (forbid(g, { type: 'ss', c: { id: 'tok-sheep', owner: p, flags: {}, used: {}, zone: 'tok' }, p, how: 'special', src: c })) break; const t = mk(g, 'tok-sheep', p); t.zone = 'tok'; move(g, t, 'm', { ctrl: p, pos: 'def', reason: 'summon', group: grp }); toks.push(t); } if (!toks.length) return; log(g, `${PN(g, p)} Special Summoned ${toks.length} Sheep Tokens.`); const ev = emit(g, { type: 'summon', cs: toks, how: 'special', p, byEffect: true }, grp); g.sw = { cs: toks, p, how: 'special', group: ev.group }; } }] },
  'Cold Wave': { effs: [{ type: 'act', cond: (g, c, p) => g.phase === 'main1' && g.mainStart,
    res: function* (g, c, p) { g.coldWave = { p }; log(g, 'Until their next turn, no Spells or Traps can be Set or activated.'); } }] },
  'Threatening Roar': { effs: [{ type: 'act', cond: (g, c, p) => g.tp !== p && ['standby', 'main1', 'battle', 'draw'].includes(g.phase) && !g.inDS,
    res: function* (g, c, p) { g.roar = opp(p); log(g, `${PN(g, opp(p))} can't declare an attack this turn.`); } }] },
  'Flamvell Uruquizas': { effs: [{ type: 'trig', mand: true, on: (g, ev, c) => ev.type === 'damage' && ev.battle && ev.src === c && ev.p !== c.ctrl, res: function* (g, c) { if (onField(c)) { addMod(g, c, { atk: 300, own: true }); log(g, 'Flamvell Uruquizas gained 300 ATK.'); } } }] },
  'X-Saber Urbellum': { effs: [{ type: 'trig', mand: true, on: (g, ev, c) => ev.type === 'damage' && ev.battle && ev.src === c && ev.p !== c.ctrl && g.p[ev.p].hand.length >= 4,
    res: function* (g, c, p) { const h = g.p[opp(p)].hand; if (!h.length) return; const x = h[Math.floor(g.rnd() * h.length)]; move(g, x, 'deckTop', { reason: 'effect' }); log(g, `A random card from ${PN(g, opp(p))}'s hand went on top of the Deck.`); } }] },
  'Red Dragon Archfiend': { effs: [
    { type: 'trig', mand: true, tags: { destroy: 1 }, on: (g, ev, c) => ev.type === 'afterCalc' && ev.a === c && ev.t && ev.tWasDef,
      destroys: (g, c, p) => monsOf(g, opp(p)).filter(x => x.pos !== 'atk'),
      res: function* (g, c, p) { destroy(g, monsOf(g, opp(p)).filter(x => x.pos !== 'atk'), { by: p }); } },
    { type: 'trig', mand: true, tags: { destroy: 1 }, on: (g, ev, c) => ev.type === 'phase' && ev.ph === 'end' && ev.tp === c.ctrl,
      destroys: (g, c, p) => onField(c) && faceUp(c) ? monsOf(g, p).filter(x => x !== c && !attackWent(x)) : [],
      res: function* (g, c, p) { if (onField(c) && faceUp(c)) destroy(g, monsOf(g, p).filter(x => x !== c && !attackWent(x)), { by: p }); } }] },
};
const mfOpts = (g, p) => ({ from: forbid(g, { type: 'banish', from: 'gy', p }) ? ['m'] : ['m', 'gy'], banish: true, filter: fx => /^Elemental HERO/.test(D(fx).n) });
SCRIPTS['Chimeratech Fortress Dragon'] = { effs: [] }; // its summon rule is in cfCombos
// Cyber Dragon and Neos Alius: no script needed for the Best decks beyond their summon rule.
SCRIPTS['Cyber Dragon'] = { proc: { cond: (g, c, p) => monsOf(g, p).length === 0 && monsOf(g, opp(p)).length > 0, label: 'Special Summon (only they control a monster)' } };
// Gemini (Neos Alius) and the 2010-only monsters plays as their printed stats.
['Elemental HERO Neos Alius', 'Evil HERO Malicious Edge', 'Superalloy Beast Raptinus', 'Blackwing Armed Wing', 'Blackwing - Bora the Spear'].forEach(n => { SCRIPTS[n] = SCRIPTS[n] || { effs: [] }; });
SCRIPTS['Blackwing - Bora the Spear'].effs = SCRIPTS['Blackwing - Bora the Spear'].effs || [];

/* ---------- helpers for card scripts (also used by js/cards/*.js) ---------- */
function equip(g, eq, target) { if (!onField(eq) || !onField(target)) return false; eq.equipTo = target.u; emit(g, { type: 'equip', c: eq, t: target }); /* an event: refreshes the cached lasting effects and lets equip triggers (Gearfried) fire at once (2026-11-26) */ log(g, `${name(eq)} was equipped to ${name(target)}.`); return true; }
const equippedTo = (g, eq) => eq.equipTo ? fieldMons(g).find(x => x.u === eq.equipTo) || null : null;
function link(g, st, m) { st.linkTo = m.u; g.seq++; }
function addCtr(g, c, kind, n = 1) { c.ctr = c.ctr || {}; c.ctr[kind] = Math.max(0, (c.ctr[kind] || 0) + n); }
const ctr = (c, kind) => (c.ctr && c.ctr[kind]) || 0;
function negateAttack(g) { g.attackNegated = true; }
// "can't attack" from a card activated during the attack (Gravity Bind, Wall of Revealing Light): the attack stops after the chain but isn't
// negated, so the monster is still the attacking monster for the rest of it (2026-11-28 audit, Gravity Bind site ruling: "If you chain this
// to Dimensional Prison, Dimensional Prison still banishes the attacking monster"; archive: "the attack stops but is not negated")
function stopAttack(g) { g.attackStopped = true; }
function endBattle(g) { g.bpEnd = true; g.aw = null; g.attackNegated = true; log(g, 'The Battle Phase ended.'); }
/* A temporary rule: forbid(g, action) like cont.forbid; end: the turn number at whose End Phase it ends; startOf: the player whose next turn ends it */
/* A rule added while a card is being activated (its `after`) belongs to that chain link: if the activation is negated, the rule is
 gone ("If this card's activation is negated, you can still summon", Scapegoat; Soul Exchange, Sirocco, Chaos Sorcerer). A negated
 effect keeps it (Imperial Order, Royal Oppression). o.L names the link, o.L === null opts out. */
function addRule(g, forbidFn, o = {}) { g.rules.push({ forbid: forbidFn, end: o.end, startOf: o.startOf, L: o.L !== undefined ? o.L : (!g.inEmit && g.afterL) || null }); }
function token(g, p, t, pos = 'def', o = {}) {
  const id = 'tok-' + t.n.replace(/\s+/g, '-').toLowerCase();
  if (!DATA.has(id)) { const d = { id, n: t.n, k: 'token', a: t.a || 'EARTH', r: t.r || 'Fiend', lv: t.lv || 1, atk: String(t.atk || 0), def: String(t.def || 0) }; DATA.set(id, d); BYNAME.set(d.n, d); }
  if (freeM(g, p) < 0) return null;
  if (forbid(g, { type: 'ss', c: { id, owner: p, flags: {}, zone: 'tok' }, p, how: 'special' })) return null;
  const c = mk(g, id, p); c.zone = 'tok'; move(g, c, 'm', { ctrl: p, pos, reason: 'summon', group: o.group });
  if (o.noTribute) c.flags.noTribute = o.noTribute;   // true, or 'summon' ("can't be Tributed for a Tribute Summon")
  return c;
}
function tokens(g, p, t, n, pos = 'def', o = {}) {
  const grp = g.group, out = [];
  for (let i = 0; i < n; i++) { const c = token(g, p, t, pos, { ...o, group: grp }); if (c) out.push(c); }
  if (out.length) { log(g, `${PN(g, p)} Special Summoned ${out.length} ${t.n}${out.length > 1 ? 's' : ''}.`); if (!out.every(x => ssBatchAdd(g, x, p, 'special', grp))) { const ev = emit(g, { type: 'summon', cs: out, how: 'special', p, byEffect: true }, grp); g.sw = { cs: out, p, how: 'special', group: ev.group, by: { [p]: out } }; } }
  return out;
}
/* Fusion materials: a script's `mats` (array of predicates) or the first line of the Fusion's text. */
const ATTRS = ['DARK', 'LIGHT', 'FIRE', 'WATER', 'EARTH', 'WIND'];
function fusionRecipe(fx) {
  const sc = SCRIPTS[D(fx).n]; if (sc && sc.mats) return sc.mats;
  const first = matLine(fx, 'fusion'); if (!first) return null;   // the shared material-line reader (Edison text, else tx)
  const parts = first.split(/\s\+\s/); const out = [];
  for (let part of parts) {
    part = part.trim(); let n = 1; const m = part.match(/^(\d+)\s+/); if (m) { n = +m[1]; part = part.slice(m[0].length); }
    let f = null; const q = part.match(/^"([^"]+)"$/) || part.match(/^"?([^"]+?)"?$/);
    const qq = part.match(/"([^"]+)"/);
    if (/^"[^"]+"$/.test(part) || (!/monster/i.test(part) && qq)) { const nm = qq ? qq[1] : q[1]; f = c => D(c).n === nm || name(c) === nm; f.named = nm; }
    else if (qq && /monster/i.test(part)) { const nm = qq[1]; f = c => name(c).includes(nm); }
    else { const at = ATTRS.find(a => part.includes(a)); const rc = part.match(/([A-Z][a-z]+(?: [A-Z][a-z]+)?)-Type/); if (at) f = c => attr(c) === at; else if (rc) f = c => race(c) === rc[1]; }
    if (!f || /or more/.test(part)) return null;
    for (let i = 0; i < n; i++) out.push(f);
  }
  return out.length >= 2 ? out : null;
}
/* Fusion substitutes (King of the Swamp, Goddess with the Third Eye: "can be used as a substitute for any 1 Fusion Material Monster"): one of
 them can stand in for 1 named material, not for a material given by Attribute or Type, and not for a Fusion that can only be Fusion
 Summoned with its listed materials (2026-11-28 audit, E4; pass2 edison-03, goat-05). fx: the Fusion being made. */
const SUB_RE = /substitute for any 1 (?:Specifically Listed )?Fusion Material/i;
const isFusionSub = c => SUB_RE.test(D(c).ps || D(c).tx || '');
const namedMat = f => !!f.named || /\bD\(\w+\)\.n === '|\bname\(\w+\) === '|\bnamed\(\w+, '|\bnm\(\w+\) === '/.test(String(f));
function assignMats(preds, pool, limit = 12, fx) {
  const out = [], sub = !!fx && !/can only be (?:conducted|Fusion Summoned) with the above/i.test(D(fx).tx || '') && pool.some(isFusionSub);
  const rec = (i, used, subUsed) => { if (out.length >= limit) return; if (i === preds.length) { out.push(used.slice()); return; }
    for (const c of pool) { if (used.includes(c) || !isMon(c)) continue; const asSub = !preds[i](c);
      if (asSub && !(sub && !subUsed && isFusionSub(c) && namedMat(preds[i]))) continue; used.push(c); rec(i + 1, used, subUsed || asSub); used.pop(); } };
  rec(0, [], false);
  const seen = new Set(); return out.filter(m => { const k = m.map(c => c.u).sort().join(','); if (seen.has(k)) return false; seen.add(k); return true; });
}
// face-down monsters you control can be Fusion Material (Miracle Fusion and Chimeratech site rulings, archive: "You can always use face-down monsters")
function fusionPool(g, p, from) { const out = []; for (const z of from) { if (z === 'hand') out.push(...g.p[p].hand); else if (z === 'm') out.push(...monsOf(g, p)); else if (z === 'gy') out.push(...g.p[p].gy); else if (z === 'deck') out.push(...g.p[p].deck); } return out; }
function canFusion(g, p, o = {}) { const from = o.from || ['hand', 'm']; const pool = fusionPool(g, p, from); return g.p[p].extra.some(fx => D(fx).k === 'fusion' && (!o.filter || o.filter(fx)) && !forbid(g, { type: 'ss', c: fx, p, how: 'fusion' }) && fusionRecipe(fx) && assignMats(fusionRecipe(fx), pool, 1, fx).length); }
function* fusionSummon(g, p, o = {}) {
  const from = o.from || ['hand', 'm']; const pool = fusionPool(g, p, from);
  // a Fusion its summoning condition keeps out (Evil HEROes need "Dark Fusion") isn't offered, so no Fusion Material is lost
  const fs = g.p[p].extra.filter(fx => D(fx).k === 'fusion' && (!o.filter || o.filter(fx)) && !forbid(g, { type: 'ss', c: fx, p, how: 'fusion' }) && fusionRecipe(fx) && assignMats(fusionRecipe(fx), pool, 1, fx).length);
  if (!fs.length) return null;
  const [fx] = yield* pick(g, p, 'Fusion Summon which monster?', fs, 1, 1, 'good');
  const cs = assignMats(fusionRecipe(fx), pool, 12, fx); let mats = cs[0];
  if (cs.length > 1) { const i = yield* choose(g, p, 'Use which Fusion Materials?', cs.map(m => m.map(c => D(c).n + (c.zone === 'hand' ? ' (hand)' : c.zone === 'm' ? ' (field)' : c.zone === 'gy' ? ' (GY)' : ' (Deck)')).join(' + '))); mats = cs[i]; }
  const grp = g.group; for (const m of mats) move(g, m, o.banish ? 'ban' : 'gy', { reason: 'fusion', group: grp });
  log(g, `${PN(g, p)} used ${mats.map(c => D(c).n).join(' + ')} as Fusion Material.`);
  if (freeM(g, p) < 0) return null;
  ss(g, p, fx, 'atk', { how: 'fusion', group: grp }); return fx;
}
/* Ritual Summon: o.monster (predicate for the Ritual Monster), o.exact (levels must equal) or at least its Level. */
function ritualCombos(g, p, rm, o = {}) {
  const L = lv(rm); const pool = [...g.p[p].hand.filter(c => c !== rm && isMon(c)), ...monsOf(g, p)];
  const out = []; const rec = (i, cur, sum) => { if (out.length > 10) return; if (o.exact ? sum === L : sum >= L) { if (cur.length) out.push(cur.slice()); if (!o.exact) return; } if (sum >= L) return; for (let j = i; j < pool.length; j++) { cur.push(pool[j]); rec(j + 1, cur, sum + lv(pool[j])); cur.pop(); } };
  rec(0, [], 0); return out;
}
function canRitual(g, p, o) { return g.p[p].hand.some(c => isMon(c) && D(c).k === 'ritual' && o.monster(c) && ritualCombos(g, p, c, o).length); }
function* ritualSummon(g, p, o) {
  const rms = g.p[p].hand.filter(c => isMon(c) && D(c).k === 'ritual' && o.monster(c) && ritualCombos(g, p, c, o).length); if (!rms.length) return null;
  const [rm] = yield* pick(g, p, 'Ritual Summon which monster?', rms, 1, 1, 'good');
  const cs = ritualCombos(g, p, rm, o); let trib = cs[0];
  if (cs.length > 1) { const i = yield* choose(g, p, 'Tribute which monsters?', cs.map(m => m.map(c => `${D(c).n} (Lv ${lv(c)})`).join(' + '))); trib = cs[i]; }
  const grp = g.group; for (const t of trib) move(g, t, 'gy', { reason: 'ritual', group: grp });
  if (freeM(g, p) < 0) return null;
  ss(g, p, rm, 'atk', { how: 'ritual', group: grp }); return rm;
}
E.lib = {
  trapMonster, isTrapMon, replAsks, askReplace, replaceOther, unionStandIn, cbReplace, gyBanBy, gyLock, banBlocked, gyCostBlocked, nameOff, nameIs, isUmi, NO_FLIP_RE, negSource, negActAllowed, hardNeg,
  stopAttack, ask, pick, yn, choose, tgt: null, move, destroy, ss, draw, damage, gain, pay, mill, search, takeControl, setFaceDown, negate, addMod,
  equip, equippedTo, link, addCtr, ctr, negateAttack, endBattle, addRule, token, tokens, fusionSummon, canFusion, fusionRecipe, ritualSummon, canRitual,
  damageMany, stat, atk: (g, c) => stat(g, c, 'atk'), def: (g, c) => stat(g, c, 'def'), name, D, isMon, isMonD, isST, isSpell, isTrap, isExtraD, onField, faceUp, attr, race, lv, baseAtk,
  monsOf, stOf, fieldOf, allField, fieldMons, freeM, freeST, nFreeM, allCards, shuffleDeck, log, PN, has, forbid, negd, num, shown, emit, beginOp,
  noTribOf, canSS, canFaceDown, lockBP, bpLocked, ssCond, wouldDestroy, destroysSome, attackEach, attackingNow, attackWent, canTarget, banishesFromGY, winDuel, coin, dice, roll, spellLPFree, canPay, lpPayable, isBW, isFrog, isHERO, isEHERO, isGemini, evSummoned, fromFieldToGY, battleKill, oppFaceUp, stOnField, spellTrapAct, live, opp, tributeCands, tribPool, cantBattleDestroy, synCombos, swOf, synOk, synReq, matLine, ssable, costTributes, noTribCost,
};
E.lib.tgt = tgt;
E.lib.assignMats = assignMats;   // Fusion material sets (with a Fusion substitute: pass the Fusion as fx)
/* "Each time a Spell Card is activated" (Spell Counters): the activation resolved (not negated), and the card c was face-up on the field
 both when it was activated and now (Skilled White Magician rulings: one Special Summoned in a chain to it gets none). Returns the activator or -1. */
E.lib.spellCtrEv = (g, ev, c) => ev.type === 'spellResolved' && ev.sc !== c && onField(c) && faceUp(c) && (!ev.L.upAt || ev.L.upAt.includes(c.u)) ? ev.p : -1;
E.lib.spellResolvedBy = ev => ev.type === 'spellResolved' ? ev.p : -1;
E.lib.onDraw = f => { if (!DRAW_HOOKS.includes(f)) DRAW_HOOKS.push(f); };
E.lib.effsOf = effsOf;   // a card's effects, copied ones included (set c.flags.copyEffs = name to copy a monster's effects)
E.addScripts = (obj, format) => { const into = format && format !== 'edison' ? (FSCRIPTS[format] || (FSCRIPTS[format] = {})) : SCRIPTS; for (const k in obj) into[k] = obj[k]; };
E.format = () => FMT;
E.cards = () => CARDLIST;   // the card list E.init loaded (the computer re-inits with it plus its stand-ins)
E.SCRIPTS = SCRIPTS;
root.EdisonEngine = E;
E._internal = { dwText, stat, synCombos, activatable, fieldMons, monsOf, stOf, faceUp, isMon, isST, D, ssBatchFlush, resolveChain };
})(typeof window !== 'undefined' ? window : globalThis);
