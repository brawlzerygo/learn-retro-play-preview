// Release notes, newest first (Zack, 2026-11-26: a "latest release notes" page next to the version in the home screen's corner).
// v is the version players see (167 shows as 1.67); the newest entry is the version on the home screen. The ?v= cache number can be
// higher (a small change added to the current version's notes still needs new cache numbers). Written for players: what changed in the game, plain words, no code.
export const NOTES = [
  { v: 169, date: 'Nov 27, 2026', items: [
    'The computer plays much sharper on Advanced and Tournament: it no longer skips direct attacks, passes on attacks it would win, or misses lethal when it is holding a card it could respond with.',
    'It now judges each play by where the whole turn ends up, so it sees the damage a summon will deal and the damage it is open to next turn, and it stops going back and forth on Set cards in Goat.',
    'You choose Attack or Defense Position when you Special Summon, unless the card says which: Monster Reborn, Polymerization, Cyber Dragon, contact Fusions and the rest.',
    'Gaia Knight, the Force of Earth is a Synchro monster again: it goes in the Extra Deck in drafts and can be Synchro Summoned.',
    'Phones: when you can Synchro Summon or use a Graveyard effect, tap the words "Extra Deck" or "Graveyard" in the prompt to open it. On short phone screens the piles are small and easy to miss.',
    'Playing a new Field Spell over your old one now destroys the old one, as the rules say: Set a Field Spell over Geartown and its effect Special Summons an Ancient Gear monster (activating one over it still misses the timing).',
  ] },
  { v: 168, date: 'Nov 26, 2026', items: [
    'Your hand fans out again, in a clean arc: the cards overlap evenly and tilt to follow the curve. The computer\'s hand fans the same way.',
    'A new table picker in Settings: see every table at once, look at one big, and pick it with one tap.',
    'Lighter on phones and laptops: the duel table now rests while it waits for you instead of redrawing all the time, and the table pictures load smaller.',
  ] },
  { v: 167, date: 'Nov 26, 2026', items: [
    'Every Edison and Goat legal card is now in the Deck Builder: 3,673 cards for Edison and 1,691 for Goat.',
    'Every card was checked a second time against its own text, and over 30 cards that didn\'t work as written were fixed.',
    'Cards play the way they did in their format, without limits added years later: Witch of the Black Forest, Sinister Serpent, Dark Magician of Chaos, Makyura the Destructor, Exchange of the Spirit, D.D. Survivor and Destiny HERO - Disk Commander. Crush Card Virus works like the original card.',
    'New duel boards. Pick one in Settings > Table, with a preview: Rewind, Runestone, Dragon, Spellcaster, Fiend, Light and Dark. Each one reacts to the plays in your duel.',
    'Card Shop is retired. If you had it picked, you\'ll now see Rewind.',
    'The cards in each hand now lie level instead of fanned.',
    'Phones: buttons near the bottom of short screens work again (some players couldn\'t pick Gladiator Beast Darius in a draft).',
    'The version number and these notes now sit in the corner of the home screen.',
  ] },
  { v: 160, date: 'Nov 26, 2026', items: [
    'The Extra Deck works: Synchro Summons and contact Fusions can now be picked.',
    'Graveyard and banished effects can be used, like Vayu, Plaguespreader Zombie and Necro Gardna. A pile that has a play lights up, and opening it shows the play.',
    'Phantom of Chaos now copies the effect of the monster it copies, like Norleras.',
    'The Edison deck list no longer comes up empty after you pick a filter in Goat.',
  ] },
];
export const verLabel = v => 'v' + (v / 100).toFixed(2);
