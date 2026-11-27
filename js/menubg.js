// Menu backgrounds, mock-ups (Zack, 2026-11-26: "new background menu art, we could do rewind but would also like to see some cool
// premium themed backgrounds"). Each one is painted ONCE into a canvas when the page loads and used as a still picture behind the
// menus, so it costs nothing per frame (phone heat rules in CLAUDE.md). All drawn in code: no outside art, no Konami symbols.
// Try one with ?menubg=rewind|vault|shadow|arena|circuit|holo.

const rng = seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const vignette = (g, w, h, a = 0.75) => { const v = g.createRadialGradient(w * 0.6, h * 0.5, Math.min(w, h) * 0.25, w * 0.6, h * 0.5, Math.max(w, h) * 0.85); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${a})`); g.fillStyle = v; g.fillRect(0, 0, w, h); };
const glow = (g, x, y, r, c, a) => { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, c.replace('A', a)); rg.addColorStop(1, c.replace('A', 0)); g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2); };
// the landscape focus point (where the home screen's hero cards sit) and the phone's
const focus = (w, h) => w > h ? [w * 0.68, h * 0.48] : [w * 0.5, h * 0.36];

const PAINT = {
  // Rewind: the duel board's den. Warm plank floor seen at an angle, the striped rug, a lamp's glow, a faint VHS screen over it all.
  rewind(g, w, h, R, s) {
    g.fillStyle = '#170d07'; g.fillRect(0, 0, w, h);
    // planks: rows get taller toward the bottom, so the floor reads as seen from above at an angle
    let y = -10 * s, row = 0;
    while (y < h) { const ph = (34 + (y / h) * 70) * s, off = (row * 137) % 260;
      for (let x = -off * s; x < w; ) { const pw = (220 + R() * 200) * s * (0.6 + y / h * 0.6);
        g.fillStyle = `rgb(${46 + R() * 18},${29 + R() * 10},${17 + R() * 7})`; g.fillRect(x, y, pw - 2 * s, ph - 2 * s);
        g.strokeStyle = 'rgba(255,220,180,.05)'; g.lineWidth = 1 * s; for (let k = 0; k < 3; k++) { const gy = y + R() * ph; g.beginPath(); g.moveTo(x, gy); g.bezierCurveTo(x + pw * 0.3, gy + (R() - 0.5) * 6 * s, x + pw * 0.7, gy + (R() - 0.5) * 6 * s, x + pw, gy); g.stroke(); }
        x += pw; }
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, y + ph - 2 * s, w, 2 * s); y += ph; row++; }
    // the rug: Rewind's bands, as a trapezoid running off the right edge behind the hero cards
    const [fx, fy] = focus(w, h), bands = ['#7a3218', '#d9c3a0', '#4a2416', '#b4532a', '#3a1d13'];
    bands.forEach((c, i) => { const k = i * 26 * s; g.fillStyle = c; g.beginPath();
      g.moveTo(fx - w * 0.2 + k * 1.3, fy - h * 0.18 + k); g.lineTo(w + 200 * s, fy - h * 0.24 + k); g.lineTo(w + 200 * s, h + 200 * s); g.lineTo(fx - w * 0.34 + k * 1.6, h + 200 * s); g.closePath(); g.fill(); });
    g.globalAlpha = 0.18; g.fillStyle = '#d9c3a0'; for (let i = 0; i < 26; i++) { const t = i / 26, x = fx - w * 0.2 + 70 * s + t * (w * 0.6); g.beginPath(); g.moveTo(x, fy - h * 0.18 + 70 * s - t * h * 0.06); g.lineTo(x + 14 * s, fy - h * 0.18 + 58 * s - t * h * 0.06); g.lineTo(x + 28 * s, fy - h * 0.18 + 70 * s - t * h * 0.06); g.fill(); } g.globalAlpha = 1;
    // lamp light and a cool fill from the window side
    g.globalCompositeOperation = 'lighter'; glow(g, fx + w * 0.12, fy - h * 0.25, h * 0.9, 'rgba(255,160,80,A)', 0.22); glow(g, w * 0.05, h * 0.1, h * 0.7, 'rgba(70,110,200,A)', 0.07); g.globalCompositeOperation = 'source-over';
    vignette(g, w, h, 0.7);
    // the VHS screen: faint scan lines, one tracking band, the counter in the corner
    g.fillStyle = 'rgba(0,0,0,.16)'; for (let yy = 0; yy < h; yy += 4 * s) g.fillRect(0, yy, w, 1.4 * s);
    const ty = h * 0.78; g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(0, ty, w, 10 * s); g.fillStyle = 'rgba(255,60,60,.05)'; g.fillRect(6 * s, ty + 3 * s, w, 3 * s); g.fillStyle = 'rgba(60,200,255,.05)'; g.fillRect(-6 * s, ty + 6 * s, w, 3 * s);
    g.font = `700 ${34 * s}px "VT323", monospace`; g.fillStyle = 'rgba(255,255,255,.22)'; g.textAlign = 'right'; g.fillText('◀◀ REW   SP 0:20:10', w - 64 * s, h - (w > h ? 150 : 260) * s);
  },
  // Pharaoh's Vault: a gold-lit tomb chamber. A great engraved sun disc, carved friezes, light shafts and drifting dust.
  vault(g, w, h, R, s) {
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#0a0810'); bg.addColorStop(0.6, '#150e0a'); bg.addColorStop(1, '#22160b'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const [fx, fy] = focus(w, h), r0 = Math.min(w, h) * 0.46;
    // stone blocks in the wall
    g.strokeStyle = 'rgba(255,210,140,.045)'; g.lineWidth = 2 * s; for (let y = 0, i = 0; y < h; y += 90 * s, i++) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); for (let x = (i % 2) * 110 * s; x < w; x += 220 * s) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 90 * s); g.stroke(); } }
    // the sun disc: soft gold, engraved rings and rays
    g.globalCompositeOperation = 'lighter'; glow(g, fx, fy, r0 * 1.5, 'rgba(255,180,60,A)', 0.32); g.globalCompositeOperation = 'source-over';
    g.save(); g.translate(fx, fy);
    for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, l = i % 4 === 0 ? 1.28 : 1.12; g.strokeStyle = `rgba(255,205,120,${i % 4 === 0 ? 0.22 : 0.1})`; g.lineWidth = (i % 4 === 0 ? 3 : 1.5) * s; g.beginPath(); g.moveTo(Math.cos(a) * r0 * 1.02, Math.sin(a) * r0 * 1.02); g.lineTo(Math.cos(a) * r0 * l, Math.sin(a) * r0 * l); g.stroke(); }
    [[1, 4, 0.5], [0.9, 2, 0.35], [0.62, 3, 0.45], [0.56, 1.5, 0.3], [0.3, 2.5, 0.45]].forEach(([k, lw, a]) => { g.strokeStyle = `rgba(255,205,120,${a})`; g.lineWidth = lw * s; g.beginPath(); g.arc(0, 0, r0 * k, 0, Math.PI * 2); g.stroke(); });
    // carved marks in the band between rings: our own simple glyphs (bars, arcs, triangles), not hieroglyphs
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; g.save(); g.rotate(a); g.translate(0, -r0 * 0.76); g.strokeStyle = 'rgba(255,205,120,.32)'; g.lineWidth = 2.2 * s; const t = i % 4, u = 16 * s; g.beginPath();
      if (t === 0) { g.moveTo(-u, u); g.lineTo(0, -u); g.lineTo(u, u); g.closePath(); } else if (t === 1) { g.arc(0, 0, u * 0.8, Math.PI, 0); g.moveTo(-u, u * 0.6); g.lineTo(u, u * 0.6); } else if (t === 2) { g.moveTo(0, -u); g.lineTo(0, u); g.moveTo(-u * 0.7, -u * 0.3); g.lineTo(u * 0.7, -u * 0.3); } else { g.rect(-u * 0.7, -u * 0.7, u * 1.4, u * 1.4); g.moveTo(-u * 0.7, 0); g.lineTo(u * 0.7, 0); }
      g.stroke(); g.restore(); }
    const core = g.createRadialGradient(0, 0, 0, 0, 0, r0 * 0.3); core.addColorStop(0, 'rgba(255,220,150,.32)'); core.addColorStop(1, 'rgba(255,190,90,.06)'); g.fillStyle = core; g.beginPath(); g.arc(0, 0, r0 * 0.3, 0, Math.PI * 2); g.fill();
    g.restore();
    // friezes top and bottom: a gold band with a repeating zigzag and diamonds
    const frieze = y0 => { const fh = 46 * s; const fg = g.createLinearGradient(0, y0, 0, y0 + fh); fg.addColorStop(0, '#3a2810'); fg.addColorStop(0.5, '#6b4a1c'); fg.addColorStop(1, '#2a1c0b'); g.fillStyle = fg; g.fillRect(0, y0, w, fh);
      g.strokeStyle = 'rgba(255,215,140,.55)'; g.lineWidth = 2 * s; g.beginPath(); for (let x = 0; x <= w; x += 30 * s) g.lineTo(x, y0 + (Math.round(x / (30 * s)) % 2 ? 10 : fh - 10) * 1); g.stroke();
      g.fillStyle = 'rgba(255,215,140,.6)'; for (let x = 60 * s; x < w; x += 120 * s) { g.beginPath(); g.moveTo(x, y0 + fh / 2 - 9 * s); g.lineTo(x + 9 * s, y0 + fh / 2); g.lineTo(x, y0 + fh / 2 + 9 * s); g.lineTo(x - 9 * s, y0 + fh / 2); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, y0 + fh, w, 6 * s); };
    frieze(w > h ? 20 * s : 70 * s); frieze(h - (w > h ? 150 : 210) * s);
    // light shafts from above and drifting dust
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) { const x = fx - w * 0.25 + i * w * 0.16 + R() * 60 * s, sg = g.createLinearGradient(0, 0, 0, h); sg.addColorStop(0, 'rgba(255,220,160,.10)'); sg.addColorStop(1, 'rgba(255,220,160,0)'); g.fillStyle = sg; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 70 * s, 0); g.lineTo(x + 260 * s, h); g.lineTo(x + 120 * s, h); g.fill(); }
    for (let i = 0; i < 380; i++) { g.fillStyle = `rgba(255,${200 + R() * 40},140,${0.08 + R() * 0.35})`; g.beginPath(); g.arc(R() * w, R() * h, (0.6 + R() * 1.8) * s, 0, Math.PI * 2); g.fill(); }
    g.globalCompositeOperation = 'source-over'; vignette(g, w, h, 0.72);
  },
  // Shadow Realm: violet fog, a glowing summoning circle of our own design, dark cards drifting in the haze.
  shadow(g, w, h, R, s) {
    g.fillStyle = '#06030b'; g.fillRect(0, 0, w, h);
    const [fx, fy] = focus(w, h), r0 = Math.min(w, h) * 0.4;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) glow(g, R() * w, R() * h, (120 + R() * 380) * s, i % 3 ? 'rgba(110,40,190,A)' : 'rgba(200,40,140,A)', 0.035 + R() * 0.04);
    glow(g, fx, fy, r0 * 1.6, 'rgba(150,70,255,A)', 0.22);
    g.globalCompositeOperation = 'source-over';
    // drifting card backs: dark slabs with a violet rim, some far (soft), some near
    const card = (x, y, cw, a, blur, alpha) => { g.save(); g.translate(x, y); g.rotate(a); if (blur) g.filter = `blur(${blur}px)`; g.globalAlpha = alpha; const ch = cw * 1.46;
      g.fillStyle = '#120a1d'; g.strokeStyle = 'rgba(190,130,255,.7)'; g.lineWidth = 3 * s; g.beginPath(); g.roundRect(-cw / 2, -ch / 2, cw, ch, 8 * s); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(190,130,255,.3)'; g.beginPath(); g.ellipse(0, 0, cw * 0.28, ch * 0.24, 0, 0, Math.PI * 2); g.stroke(); g.restore(); };
    for (let i = 0; i < 9; i++) card(R() * w, R() * h, (60 + R() * 80) * s, (R() - 0.5) * 1.2, 6 * s, 0.35);
    // the circle: rings, a six-point star, a band of our own glyphs; drawn twice for the glow
    const circle = () => { g.save(); g.translate(fx, fy); g.scale(1, 0.92);
      [[1, 3], [0.94, 1.5], [0.7, 2.5], [0.64, 1.2], [0.34, 2]].forEach(([k, lw]) => { g.lineWidth = lw * s; g.beginPath(); g.arc(0, 0, r0 * k, 0, Math.PI * 2); g.stroke(); });
      g.lineWidth = 2 * s; for (let t = 0; t < 2; t++) { g.beginPath(); for (let i = 0; i <= 3; i++) { const a = -Math.PI / 2 + t * Math.PI / 3 + i * Math.PI * 2 / 3; g.lineTo(Math.cos(a) * r0 * 0.7, Math.sin(a) * r0 * 0.7); } g.stroke(); }
      const G = rng(31); for (let i = 0; i < 48; i++) { g.save(); g.rotate(i / 48 * Math.PI * 2); g.translate(0, -r0 * 0.82); g.lineWidth = 2 * s; g.beginPath(); const u = 11 * s; for (let k = 0; k < 3; k++) { const x1 = (G() - 0.5) * u * 2, y1 = (G() - 0.5) * u * 2; g.moveTo(x1, y1); g.lineTo(x1 + (G() - 0.5) * u * 1.6, y1 + (G() - 0.5) * u * 1.6); } g.stroke(); g.restore(); }
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; g.beginPath(); g.arc(Math.cos(a) * r0 * 0.7, Math.sin(a) * r0 * 0.7, 9 * s, 0, Math.PI * 2); g.stroke(); }
      g.restore(); };
    g.strokeStyle = 'rgba(170,90,255,.55)'; g.shadowColor = 'rgba(170,90,255,.9)'; g.shadowBlur = 28 * s; circle(); g.shadowBlur = 0; g.strokeStyle = 'rgba(235,210,255,.75)'; circle();
    for (let i = 0; i < 5; i++) card(fx + (R() - 0.5) * w * 0.7, fy + (R() - 0.5) * h * 0.8, (90 + R() * 60) * s, (R() - 0.5) * 0.8, 0, 0.75);
    g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(200,150,255,${0.1 + R() * 0.4})`; g.beginPath(); g.arc(fx + (R() - 0.5) * r0 * 3, fy + (R() - 0.5) * r0 * 2.4, (0.8 + R() * 2) * s, 0, Math.PI * 2); g.fill(); } g.globalCompositeOperation = 'source-over';
    vignette(g, w, h, 0.8);
  },
  // Championship Arena: a stadium at night. Spotlights cross over a glossy floor, the crowd is a sea of soft lights, the duel lane glows.
  arena(g, w, h, R, s) {
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#04050a'); bg.addColorStop(0.55, '#0a0c16'); bg.addColorStop(1, '#05060a'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const hz = h * (w > h ? 0.56 : 0.5), [fx] = focus(w, h);
    // the crowd: soft lights in tiers above the floor line
    g.globalCompositeOperation = 'lighter'; g.filter = `blur(${2.5 * s}px)`;
    for (let i = 0; i < 900; i++) { const y = hz - R() * hz * 0.75, x = R() * w, warm = R() < 0.6; g.fillStyle = warm ? `rgba(255,${150 + R() * 80},${80 + R() * 60},${0.08 + R() * 0.3})` : `rgba(${110 + R() * 60},${160 + R() * 60},255,${0.08 + R() * 0.3})`; g.beginPath(); g.arc(x, y, (1 + R() * 4) * s * (0.5 + (y / hz)), 0, Math.PI * 2); g.fill(); }
    g.filter = 'none';
    // spotlights from the roof onto the arena's middle
    const spot = (x0, c) => { const sg = g.createLinearGradient(x0, 0, fx, hz); sg.addColorStop(0, c.replace('A', 0.2)); sg.addColorStop(1, c.replace('A', 0)); g.fillStyle = sg; g.beginPath(); g.moveTo(x0 - 18 * s, 0); g.lineTo(x0 + 18 * s, 0); g.lineTo(fx + 240 * s, hz + 40 * s); g.lineTo(fx - 240 * s, hz + 40 * s); g.fill(); };
    spot(w * 0.1, 'rgba(255,140,60,A)'); spot(w * 0.42, 'rgba(255,255,255,A)'); spot(w * 0.98, 'rgba(90,160,255,A)'); spot(w * 0.75, 'rgba(255,255,255,A)');
    glow(g, fx, hz, w * 0.4, 'rgba(255,200,150,A)', 0.14);
    g.globalCompositeOperation = 'source-over';
    // the floor: dark gloss with grid lines that spread toward us, and the lane, orange on our side, blue on theirs
    const fl = g.createLinearGradient(0, hz, 0, h); fl.addColorStop(0, '#0d1018'); fl.addColorStop(1, '#030406'); g.fillStyle = fl; g.fillRect(0, hz, w, h - hz);
    g.strokeStyle = 'rgba(140,170,255,.08)'; g.lineWidth = 1.5 * s; for (let k = 1; k < 18; k++) { const y = hz + (h - hz) * Math.pow(k / 18, 1.8); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let k = -14; k <= 14; k++) { g.beginPath(); g.moveTo(fx + k * 40 * s, hz); g.lineTo(fx + k * 260 * s, h); g.stroke(); }
    g.globalCompositeOperation = 'lighter';
    const lane = (c, dir) => { const lg = g.createLinearGradient(fx, 0, fx + dir * w * 0.6, 0); lg.addColorStop(0, c.replace('A', 0.9)); lg.addColorStop(1, c.replace('A', 0)); g.fillStyle = lg; g.fillRect(dir > 0 ? fx : fx - w * 0.6, hz + 50 * s, w * 0.6, 4 * s); glow(g, fx + dir * 120 * s, hz + 52 * s, 260 * s, c, 0.12); };
    lane('rgba(255,106,31,A)', -1); lane('rgba(90,168,255,A)', 1);
    // reflections of the spotlights on the gloss
    glow(g, fx, hz + 140 * s, 300 * s, 'rgba(255,255,255,A)', 0.06);
    g.globalCompositeOperation = 'source-over'; vignette(g, w, h, 0.7);
  },
  // Night Circuit: a city at night, a highway running to the horizon with light trails, and rings of green light hanging over the road.
  circuit(g, w, h, R, s) {
    const hz = h * (w > h ? 0.55 : 0.46), [fx] = focus(w, h);
    const sky = g.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, '#03040c'); sky.addColorStop(1, '#1a0b2a'); g.fillStyle = sky; g.fillRect(0, 0, w, hz);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${R() * 0.5})`; g.fillRect(R() * w, R() * hz * 0.8, 1.4 * s, 1.4 * s); }
    g.globalCompositeOperation = 'lighter'; glow(g, fx, hz, w * 0.45, 'rgba(255,90,160,A)', 0.18); g.globalCompositeOperation = 'source-over';
    // the skyline: towers with lit windows
    for (let x = 0; x < w; ) { const bw = (30 + R() * 90) * s, bh = (40 + R() * 260) * s * (1 - Math.abs(x - fx) / w * 0.6); g.fillStyle = '#07060f'; g.fillRect(x, hz - bh, bw, bh);
      for (let wy = hz - bh + 8 * s; wy < hz - 6 * s; wy += 10 * s) for (let wx = x + 5 * s; wx < x + bw - 5 * s; wx += 9 * s) if (R() < 0.18) { g.fillStyle = R() < 0.5 ? 'rgba(255,190,110,.6)' : 'rgba(120,220,255,.55)'; g.fillRect(wx, wy, 3 * s, 4 * s); }
      x += bw + 2 * s; }
    // the road
    const rd = g.createLinearGradient(0, hz, 0, h); rd.addColorStop(0, '#0b0a14'); rd.addColorStop(1, '#020205'); g.fillStyle = rd; g.fillRect(0, hz, w, h - hz);
    g.beginPath(); g.moveTo(fx - 30 * s, hz); g.lineTo(fx + 30 * s, hz); g.lineTo(fx + w * 0.9, h); g.lineTo(fx - w * 0.9, h); g.closePath(); g.fillStyle = '#100e1a'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3 * s; g.setLineDash([22 * s, 30 * s]); g.beginPath(); g.moveTo(fx, hz); g.lineTo(fx, h); g.stroke(); g.setLineDash([]);
    // light trails: long streaks toward the horizon, warm on one side, cool on the other
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) { const left = i % 2 === 0, x1 = fx + (left ? -1 : 1) * (80 + R() * w * 0.7) * s / s, c = left ? `rgba(255,${120 + R() * 80},40,` : `rgba(${80 + R() * 80},${200 + R() * 55},255,`;
      const tg = g.createLinearGradient(fx, hz, x1, h); tg.addColorStop(0, c + '0)'); tg.addColorStop(0.5, c + '.25)'); tg.addColorStop(1, c + '.75)'); g.strokeStyle = tg; g.lineWidth = (1.5 + R() * 4) * s; g.beginPath(); g.moveTo(fx + (left ? -1 : 1) * 6 * s, hz + 2 * s); g.lineTo(x1, h); g.stroke(); }
    // rings of light over the road
    for (let i = 0; i < 3; i++) { const ry = hz - (70 + i * 64) * s, rr = (150 - i * 26) * s; g.strokeStyle = 'rgba(110,255,160,.75)'; g.lineWidth = 4 * s; g.shadowColor = 'rgba(110,255,160,1)'; g.shadowBlur = 24 * s; g.beginPath(); g.ellipse(fx, ry, rr, rr * 0.22, 0, 0, Math.PI * 2); g.stroke(); g.shadowBlur = 0; }
    glow(g, fx, hz - 140 * s, 300 * s, 'rgba(110,255,160,A)', 0.12);
    g.globalCompositeOperation = 'source-over'; vignette(g, w, h, 0.7);
  },
  // Holo Foil: the inside of a premium foil card. Prismatic bands, an embossed lattice, starbursts of light.
  holo(g, w, h, R, s) {
    g.fillStyle = '#0a0a12'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    const band = (off, a) => { const lg = g.createLinearGradient(0, h, w, 0); const hues = [0, 40, 80, 160, 200, 260, 310, 360]; hues.forEach((hu, i) => lg.addColorStop(Math.min(1, Math.max(0, i / (hues.length - 1) * 0.6 + off)), `hsla(${hu},90%,60%,${a})`)); g.fillStyle = lg; g.fillRect(0, 0, w, h); };
    band(0.05, 0.16); band(0.45, 0.12);
    const [fx, fy] = focus(w, h); glow(g, fx, fy, Math.max(w, h) * 0.45, 'rgba(255,255,255,A)', 0.1);
    g.globalCompositeOperation = 'source-over';
    // the embossed lattice: diamonds like a foil card's pattern, light edge and dark edge
    const d = 70 * s; for (let y = -d; y < h + d; y += d / 2) for (let x = ((y / (d / 2)) % 2 ? d / 2 : 0) - d; x < w + d; x += d) {
      g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1.2 * s; g.beginPath(); g.moveTo(x, y - d / 2); g.lineTo(x + d / 2, y); g.stroke(); g.beginPath(); g.moveTo(x - d / 2, y); g.lineTo(x, y - d / 2); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.moveTo(x + d / 2, y); g.lineTo(x, y + d / 2); g.lineTo(x - d / 2, y); g.stroke(); }
    // a sheen running diagonally through the middle
    g.globalCompositeOperation = 'lighter'; const sh = g.createLinearGradient(fx - w * 0.3, fy - h * 0.6, fx + w * 0.3, fy + h * 0.6); sh.addColorStop(0.42, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,.14)'); sh.addColorStop(0.58, 'rgba(255,255,255,0)'); g.fillStyle = sh; g.fillRect(0, 0, w, h);
    // starbursts
    const star = (x, y, r, a) => { g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); for (let i = 0; i < 8; i++) { const ang = i * Math.PI / 4, rr = i % 2 ? r * 0.18 : r; g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); } g.closePath(); g.fill(); glow(g, x, y, r * 1.4, 'rgba(255,255,255,A)', a * 0.4); };
    for (let i = 0; i < 70; i++) star(R() * w, R() * h, (4 + R() * 18) * s, 0.15 + R() * 0.6);
    g.globalCompositeOperation = 'source-over'; vignette(g, w, h, 0.72);
  },
};
export const MENU_BGS = Object.keys(PAINT);
export function paintMenuBg(id, w, h) {
  const f = PAINT[id]; if (!f) return null;
  const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h);
  const g = c.getContext('2d'), s = Math.max(w, h) / 1920 * (w > h ? 1 : 1.6);
  f(g, c.width, c.height, rng(1234), s); return c;
}
