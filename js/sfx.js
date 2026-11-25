/* Learn Retro Play: sound effects. Original sounds in assets/sfx/<name>.mp3 (made for this game); until a file exists,
 a short synthesized stand-in plays so every action still has a sound. */
const NAMES = ['click', 'nav', 'hover', 'deal', 'draw', 'place', 'set', 'flip', 'summon', 'synchro', 'activate', 'chain', 'resolve', 'attack', 'hit', 'destroy', 'lp', 'heal', 'turn', 'phase', 'win', 'lose', 'shuffle', 'error'];
let ctx = null, vol = 0.7, muted = false; const buf = {}, last = {};
function ac() { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; }
export function setVolume(v) { vol = v; }
export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }
// the game's Broadcast sound set, made for it with ElevenLabs (tools/make_sfx.mjs, the b_ sounds): [file, playback rate, gain].
const MAP = { click: ['b_select', 1, .7], nav: ['b_screen', 1, .6], hover: ['b_tick', 1, .35], deal: ['b_draw', 1.1, .55], draw: ['b_draw', 1, .8], place: ['b_place', 1, .9], set: ['b_set', 1, .85], flip: ['b_flip', 1, .8],
  summon: ['b_summon', 1, .85], synchro: ['b_synchro', 1, .95], activate: ['b_activate', 1, .8], chain: ['b_chain', 1, .85], resolve: ['b_flip', 1.15, .5],
  attack: ['b_attack', 1, .9], hit: ['b_hit', 1, .9], destroy: ['b_destroy', 1, .85], lp: ['b_lp', 1, .55], turn: ['b_turn', 1, .75], phase: ['b_phase', 1, .55], win: ['b_win', 1, .8], lose: ['b_lose', 1, .7], shuffle: ['b_draw', .85, .5], error: ['b_tick', .6, .5] };
export async function load() {
  const files = [...new Set(Object.values(MAP).map(m => m[0]))];
  await Promise.all(files.map(async f => {
    try { const r = await fetch(`assets/sfx/${f}.mp3`); if (!r.ok) return; buf[f] = await ac().decodeAudioData(await r.arrayBuffer()); } catch (e) { /* the synthesized stand-in plays */ }
  }));
}
// synthesized stand-ins: [type, start freq, end freq, length, gain]
const SYN = { click: ['square', 1900, 1500, .028, .12], nav: ['square', 1250, 950, .035, .14], hover: ['square', 2400, 2400, .012, .035], deal: ['noise', 0, 0, .06, .25], draw: ['noise', 0, 0, .09, .3],
  place: ['noise', 0, 0, .12, .45], set: ['noise', 0, 0, .1, .35], flip: ['triangle', 500, 900, .1, .25], summon: ['sawtooth', 220, 660, .35, .22], synchro: ['sawtooth', 160, 990, .7, .26],
  activate: ['square', 520, 880, .18, .14], chain: ['square', 660, 990, .2, .14], resolve: ['triangle', 880, 440, .18, .18], attack: ['sawtooth', 300, 90, .25, .25], hit: ['noise', 0, 0, .25, .55],
  destroy: ['noise', 0, 0, .4, .5], lp: ['triangle', 600, 300, .25, .2], heal: ['sine', 500, 900, .3, .2], turn: ['sine', 440, 660, .35, .2], phase: ['sine', 660, 660, .12, .12],
  win: ['triangle', 440, 1320, 1.0, .25], lose: ['sawtooth', 330, 110, 1.0, .2], shuffle: ['noise', 0, 0, .5, .2], error: ['square', 200, 160, .15, .12] };
export function play(name, o = {}) {
  if (muted || vol <= 0) return;
  const now = performance.now(); if (last[name] && now - last[name] < (o.gap || 45)) return; last[name] = now;
  const c = ac(), g = c.createGain(); g.connect(c.destination);
  const mp = MAP[name]; if (mp && buf[mp[0]]) { const s = c.createBufferSource(); s.buffer = buf[mp[0]]; s.playbackRate.value = (o.rate || 1) * mp[1]; g.gain.value = vol * (o.gain || 1) * mp[2]; s.connect(g); s.start(); return; }
  const [type, f0, f1, len, gain] = SYN[name] || SYN.click; const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * vol * (o.gain || 1)), t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  if (type === 'noise') {
    const n = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate), d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource(); s.buffer = n; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = name === 'hit' || name === 'destroy' ? 900 : 2600; s.connect(f); f.connect(g); s.start(t);
  } else { const o2 = c.createOscillator(); o2.type = type; o2.frequency.setValueAtTime(f0, t); o2.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len); o2.connect(g); o2.start(t); o2.stop(t + len + .02); }
}
export function unlock() { ac(); }
