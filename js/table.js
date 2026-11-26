/* Learn Retro Play: the 3D table (three.js). The backdrop is a Blender render; this draws the cards on it with a camera that
 matches the render exactly (assets/scenes/<scene>-camera.json), so a card here sits where the mat is in the picture.
 Coordinates: board units as in Blender (x right, y away from you, z up), converted with B(). Side 1 is you, -1 the computer. */
import * as THREE from '../vendor/three.module.min.js';

const B = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
const ease = { out: k => 1 - Math.pow(1 - k, 3), inOut: k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2, lin: k => k,
  quint: k => 1 - Math.pow(1 - k, 5), sine: k => -(Math.cos(Math.PI * k) - 1) / 2, in: k => k * k * k,
  back: k => { const c = 1.4; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); } };

export class Table {
  constructor(canvas, cam, opts = {}) {
    this.cam = cam; this.speed = 1; this.tokenArt = opts.tokenArt || {};
    // the view: the canvas's size on the stage and where it sits (desktop 1920x1080 at 0,0; the phone layout draws the upright
    // render at the phone's width and moves it up on short phones). project() and pointer picks work in stage pixels.
    this.V = Object.assign({ w: 1920, h: 1080, ox: 0, oy: 0, dpr: Math.min(2, window.devicePixelRatio || 1) }, opts.view || {});
    const b = cam.board; Object.assign(this, { CW: b.CW, CH: b.CH, G: b.G, MID: b.MID });
    this.GPAD = 0.16;   // how far the card glow reaches past the card
    this.DEF_S = 0.8;   // a Defense Position card's size on the table
    this.COLX = i => (i - 3) * (this.CW + this.G);
    this.ROW_M = -(this.MID / 2 + this.CH / 2); this.ROW_S = this.ROW_M - (this.CH + this.G);

    // phones (Zack, 2026-11-25: the phone ran hot): no forced high-power GPU, a smaller shadow map, and frames only when something changes (loop)
    this.phone = !!opts.phone;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: this.phone ? 'default' : 'high-performance' });
    r.setPixelRatio(this.V.dpr); r.setSize(this.V.w, this.V.h, false);
    r.outputColorSpace = THREE.SRGBColorSpace; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    // the Blender camera: lens over a 36 mm sensor, fitted to the width
    const hfov = 2 * Math.atan(cam.sensor / 2 / cam.lens), vfov = 2 * Math.atan(Math.tan(hfov / 2) * this.V.h / this.V.w);
    this.camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(vfov), this.V.w / this.V.h, 0.05, 100);
    const [lx, ly, lz] = cam.loc, [tx, ty, tz] = cam.target;
    this.camera.position.copy(B(lx, ly, lz)); this.camera.up.set(0, 1, 0); this.camera.lookAt(B(tx, ty, tz)); this.camera.updateMatrixWorld();

    // light that matches the lamp-lit render: warm key from above, soft fill
    this.scene.add(new THREE.HemisphereLight(0xfff1e0, 0x3a2a20, 1.55));
    const key = new THREE.DirectionalLight(0xffe2c2, 1.35); key.position.copy(B(0.6, -1.2, 7)); key.target.position.copy(B(0, 0, 0));
    key.castShadow = true; key.shadow.mapSize.set(this.phone ? 1024 : 2048, this.phone ? 1024 : 2048); const sc = key.shadow.camera; sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 1; sc.far = 14;
    key.shadow.radius = 5; key.shadow.bias = -0.0008; this.scene.add(key, key.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.42 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = 0.001; ground.receiveShadow = true; this.scene.add(ground);

    this.loader = new THREE.TextureLoader(); this.tex = new Map();
    // draw on demand: anything that changes the scene marks it dirty (adds, removes, a texture arriving, any table method that isn't a read)
    this.hot = 0; this.wake = () => { this.hot = performance.now() + 350; };
    { const sa = this.scene.add.bind(this.scene), sr = this.scene.remove.bind(this.scene); this.scene.add = (...a) => { this.wake(); return sa(...a); }; this.scene.remove = (...a) => { this.wake(); return sr(...a); }; }
    { const ld = this.loader.load.bind(this.loader); this.loader.load = (u, ok, pr, er) => ld(u, t => { this.wake(); if (ok) ok(t); }, pr, er); }
    const READS = new Set(['constructor', 'url', 'slot', 'pileTop', 'screenToWorld', 'ndc', 'project', 'cardScreen', 'where', 'has', 'loop', 'step', 'wait', 'bindPointer', 'dispose']);
    for (const k of Object.getOwnPropertyNames(Table.prototype)) if (!READS.has(k) && typeof this[k] === 'function') { const f = this[k]; this[k] = function (...a) { this.wake(); return f.apply(this, a); }; }
    this.cardGeo = new THREE.BoxGeometry(this.CW, 0.008, this.CH);
    this.edgeMat = new THREE.MeshLambertMaterial({ color: 0x0c0a09 });
    this.backMat = this.faceMat('back');   // pile tops
    // a card turned face-down shows its underside, whose texture runs the other way: turn it 180° so the back reads upright
    { const t = this.loader.load(this.url('back')); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); t.center.set(0.5, 0.5); t.rotation = Math.PI; this.backDown = new THREE.MeshLambertMaterial({ map: t }); }
    this.cards = new Map();       // u -> {g (pivot group), m (mesh), id, up, def, side}
    this.piles = new Map();       // 'side:kind' -> {m, n, top}
    this.zones = [];              // highlight planes
    this.glows = new Map();       // u -> halo mesh
    this.rings = [];
    this.fx = [];
    this.tweens = [];
    this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2();
    this.onHover = () => {}; this.onClick = () => {}; this.onFrame = () => {};
    this.buildZones();
    this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
    this.lastFrame = performance.now(); this.tick = setInterval(() => { const now = performance.now(); if (now - this.lastFrame > 250) this.step(now); }, 100);
    document.addEventListener('visibilitychange', () => { if (document.hidden) for (const tw of this.tweens.splice(0)) { tw.fn(1); tw.res(); } });
  }

  /* ---------- textures and meshes ---------- */
  url(id) { if (id === 'back') return 'img/back.webp'; if (typeof id === 'string' && this.tokenArt[id]) return `img/${this.tokenArt[id][0]}.webp`; return `img/${id}.webp`; }
  faceMat(id) {
    if (this.tex.has(id)) return this.tex.get(id);
    const t = this.loader.load(this.url(id)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const m = new THREE.MeshLambertMaterial({ map: t }); this.tex.set(id, m); return m;
  }
  makeCard(id, up) {
    const face = id != null ? this.faceMat(id) : this.backMat;
    // BoxGeometry faces: +x, -x, +y (top), -y (bottom), +z, -z
    const m = new THREE.Mesh(this.cardGeo, [this.edgeMat, this.edgeMat, face, this.backDown, this.edgeMat, this.edgeMat]);
    m.castShadow = true; m.rotation.z = up ? 0 : Math.PI;
    const g = new THREE.Group(); g.add(m); this.scene.add(g); return { g, m };
  }
  setFace(c, id) { if (id == null || c.id === id) return; c.id = id; c.m.material[2] = this.faceMat(id); }

  /* ---------- where things are ---------- */
  slot(side, zone, i) {
    const s = side, C = this.COLX, M = this.ROW_M, S = this.ROW_S;
    const at = { m: [C(i + 1), M], st: [C(i + 1), S], fz: [C(0), M], extra: [C(0), S], gy: [C(6), M], deck: [C(6), S], ban: [C(6) + this.CW + this.G + 0.2, M] }[zone];
    return B(at[0] * s, at[1] * s, 0.006);
  }
  pileTop(side, kind) { const p = this.piles.get(side + ':' + kind); const v = this.slot(side, kind); v.y = (p ? p.h : 0) + 0.008; return v; }
  screenToWorld(x, y, height = 1.2) {
    this.ndc(x, y); this.ray.setFromCamera(this.ptr, this.camera);
    const t = (height - this.ray.ray.origin.y) / this.ray.ray.direction.y; return this.ray.ray.origin.clone().add(this.ray.ray.direction.clone().multiplyScalar(t));
  }
  ndc(x, y) { const V = this.V; this.ptr.set((x - V.ox) / V.w * 2 - 1, -((y - V.oy) / V.h) * 2 + 1); }
  project(v) { const p = v.clone().project(this.camera), V = this.V; return { x: V.ox + (p.x + 1) / 2 * V.w, y: V.oy + (1 - p.y) / 2 * V.h }; }
  setView(o) { const resize = (o.w && o.w !== this.V.w) || (o.h && o.h !== this.V.h); Object.assign(this.V, o); if (resize) this.renderer.setSize(this.V.w, this.V.h, false); }   // the same shape, so the camera stays
  cardScreen(u, edge = 0) { const c = this.cards.get(u); if (!c) return null; const v = c.g.position.clone(); if (edge) v.add(new THREE.Vector3(0, 0, edge * (c.def ? this.CW : this.CH) / 2)); return this.project(v); }

  /* ---------- tweens ---------- */
  tween(dur, fn, e = ease.out) {
    dur = dur * this.speed;
    // a hidden tab gets no animation frames: finish at once so the duel never stalls in the background
    return new Promise(res => { if (dur < 8 || document.hidden) { fn(1); res(); return; } this.tweens.push({ t0: performance.now(), dur, fn, e, res }); });
  }
  wait(ms) { return this.tween(ms, () => {}); }
  // moves a card group to a pose along a lifted arc
  async glide(c, pos, rotY, up, dur = 420, lift = 0.5, o = {}) {
    const p0 = c.g.position.clone(), r0 = c.g.rotation.y, z0 = c.m.rotation.z, z1 = up ? 0 : Math.PI, s0 = c.g.scale.x, s1 = c.base || 1;
    let dr = rotY - r0; while (dr > Math.PI) dr -= 2 * Math.PI; while (dr < -Math.PI) dr += 2 * Math.PI;
    const peak = o.peak || 0.42;  // where the arc is highest (0..1)
    await this.tween(dur, k => {
      const m = o.smooth ? ease.inOut(k) : ease.sine(k);
      c.g.position.lerpVectors(p0, pos, m);
      const h = k < peak ? Math.sin(Math.PI / 2 * k / peak) : Math.cos(Math.PI / 2 * (k - peak) / (1 - peak));
      c.g.position.y += h * lift;
      c.g.rotation.y = r0 + dr * ease.inOut(Math.min(1, k * (o.smooth ? 1 : 1.15)));
      { const sc = s0 + (s1 - s0) * ease.inOut(k); c.g.scale.set(sc, 1, sc); }
      c.m.rotation.z = z0 + (z1 - z0) * ease.inOut(Math.min(1, Math.max(0, (k - 0.1) / 0.7)));
      if (o.tilt) c.g.rotation.x = Math.sin(Math.PI * k) * o.tilt;
    }, ease.lin);
    c.g.position.copy(pos); c.g.rotation.y = rotY; c.m.rotation.z = z1; c.g.rotation.x = 0;
    if (o.settle !== false) await this.settle(c, o.settle || 0.06);
  }
  // a small landing: the card touches down and eases flat (no jump in size)
  settle(c, amt = 0.06) {
    const y = c.g.position.y, b = c.base || 1;
    return this.tween(170, k => { const s = b * (1 + amt * (1 - ease.out(k))); c.g.scale.set(s, 1, s); c.g.position.y = y + 0.03 * (1 - ease.out(k)); }, ease.lin).then(() => { c.g.scale.set(b, 1, b); c.g.position.y = y; });
  }
  pose(side, def) { return (side === 1 ? 0 : Math.PI) + (def ? Math.PI / 2 : 0); }

  /* ---------- field cards ---------- */
  // place or move a field card (zone m/st/fz) for card u; from: a world point to start at when it is new
  async place(u, side, zone, i, o) {
    const pos = this.slot(side, zone, i); pos.y = 0.012;
    let c = this.cards.get(u); const def = zone === 'm' && (o.pos === 'def' || o.pos === 'set'); const rotY = this.pose(side, def);
    if (!c) {
      const made = this.makeCard(o.id, false); c = { ...made, id: o.id, up: false, def, side, zone, i };
      this.cards.set(u, c); this.setFace(c, o.id);
      const from = o.from || pos.clone().add(new THREE.Vector3(0, 0.8, 0));
      c.g.position.copy(from); c.g.rotation.y = o.fromRotY != null ? o.fromRotY : rotY; c.m.rotation.z = o.fromUp ? 0 : Math.PI;
      if (o.fromUp == null) c.m.rotation.z = o.up ? 0 : Math.PI;
    }
    if (o.id != null) this.setFace(c, o.id);
    Object.assign(c, { def, side, zone, i, up: !!o.up, base: def ? this.DEF_S : 1 });
    const set = !o.up;
    await this.glide(c, pos, rotY, !!o.up, o.dur || (set ? 380 : 480), o.lift != null ? o.lift : (set ? 0.3 : 0.6), { peak: set ? 0.4 : 0.45, tilt: set ? 0 : -0.18, settle: set ? 0.03 : 0.06, smooth: true });
  }
  // take a card off the field to a point, then remove it
  async remove(u, to, o = {}) {
    const c = this.cards.get(u); if (!c) return; this.cards.delete(u); this.unglow(u);
    if (to) await this.glide(c, to, o.rotY != null ? o.rotY : c.g.rotation.y, o.up != null ? o.up : c.up, o.dur || 420, 0.45, { settle: false, peak: 0.4 });
    this.scene.remove(c.g);
  }
  // a card that only passes over the table (Deck to hand, hand to GY...)
  async fly(id, from, to, o = {}) {
    const c = this.makeCard(id, o.up !== false && id != null); c.g.position.copy(from); c.g.rotation.y = o.rotY || 0;
    const card = { ...c, up: o.up !== false && id != null };
    await this.glide(card, to, o.rotY || 0, o.toUp != null ? o.toUp : card.up, o.dur || 400, o.lift != null ? o.lift : 0.4, { settle: false, peak: 0.45 });
    this.scene.remove(c.g);
  }
  async flip(u, id, up = true) {
    const c = this.cards.get(u); if (!c) return; const z0 = c.m.rotation.z, z1 = up ? 0 : Math.PI, y0 = c.g.position.y;
    let swapped = false;
    await this.tween(380, k => {
      if (!swapped && k > 0.5) { swapped = true; if (id != null) this.setFace(c, id); }
      c.m.rotation.z = z0 + (z1 - z0) * ease.inOut(k); c.g.position.y = y0 + Math.sin(Math.PI * k) * 0.32;
    }, ease.lin);
    if (!swapped && id != null) this.setFace(c, id);
    c.up = up; c.g.position.y = y0; await this.settle(c, 0.03);
  }
  async turnTo(u, def) {
    const c = this.cards.get(u); if (!c) return; const r0 = c.g.rotation.y, r1 = this.pose(c.side, def);
    const y0 = c.g.position.y; await this.tween(320, k => { c.g.rotation.y = r0 + (r1 - r0) * ease.inOut(k); c.g.position.y = y0 + Math.sin(Math.PI * k) * 0.08; }, ease.lin); c.g.position.y = y0; c.def = def;
  }
  async lunge(u, to) {
    const c = this.cards.get(u); if (!c) return; const p0 = c.g.position.clone();
    const dir = to.clone().sub(p0); dir.y = 0; const back = p0.clone().sub(dir.clone().normalize().multiplyScalar(0.18)); back.y = 0.45;
    const hit = p0.clone().add(dir.clone().multiplyScalar(0.82)); hit.y = 0.25;
    const tiltTo = Math.atan2(dir.x, dir.z) * 0.12;
    await this.tween(240, k => { c.g.position.lerpVectors(p0, back, k); c.g.rotation.x = -0.35 * k; c.g.rotation.z = tiltTo * k; }, ease.out);          // wind up
    await this.tween(170, k => { c.g.position.lerpVectors(back, hit, k); c.g.rotation.x = -0.35 + 0.55 * k; }, ease.in);                                   // strike
    this.burst(to, 0xffe0b8, 1.1); this.shakeCam(0.06);
    await this.tween(320, k => { c.g.position.lerpVectors(hit, p0, k); c.g.rotation.x = 0.2 * (1 - k); c.g.rotation.z = tiltTo * (1 - k); }, ease.quint); // recoil home
    c.g.position.copy(p0); c.g.rotation.x = 0; c.g.rotation.z = 0;
  }
  where(u) { const c = this.cards.get(u); return c ? c.g.position.clone() : null; }
  has(u) { return this.cards.has(u); }
  clearField(keep) { for (const [u, c] of this.cards) if (!keep.has(u)) { this.scene.remove(c.g); this.cards.delete(u); this.unglow(u); } }

  /* ---------- piles: Deck, Extra, GY, banished ---------- */
  setPile(side, kind, n, topId) {
    const k = side + ':' + kind; let p = this.piles.get(k);
    if (!p) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(this.CW, 1, this.CH), [this.edgeMat, this.edgeMat, this.backMat, this.edgeMat, this.edgeMat, this.edgeMat]);
      m.castShadow = true; m.rotation.y = side === 1 ? 0 : Math.PI; m.userData.pile = { side, kind }; this.scene.add(m); p = { m, n: -1, top: undefined, h: 0 }; this.piles.set(k, p);
    }
    const h = n ? Math.max(0.006, n * 0.0036) : 0;
    p.m.visible = n > 0; p.m.scale.y = Math.max(h, 0.0001); const pos = this.slot(side, kind); p.m.position.set(pos.x, h / 2 + 0.002, pos.z); p.h = h;
    if (p.top !== topId) { p.top = topId; p.m.material[2] = topId != null ? this.faceMat(topId) : this.backMat; }
    p.n = n;
  }

  /* ---------- highlights ---------- */
  buildZones() {
    this.GPAD = this.GPAD || 0.16;
    const geo = new THREE.PlaneGeometry(this.CW + 2 * this.GPAD, this.CH + 2 * this.GPAD);
    for (const side of [1, -1]) for (const zone of ['m', 'st']) for (let i = 0; i < 5; i++) {
      const mat = this.glowMat(0xff7a30, 0.2);
      const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.copy(this.slot(side, zone, i)); m.position.y = 0.004;
      m.userData.zone = { side, zone, i }; m.visible = false; this.scene.add(m); this.zones.push(m);
    }
  }
  lightZones(list) { // [{side, zone, i}]
    for (const z of this.zones) { const d = z.userData.zone; z.visible = !!list.find(l => l.side === d.side && l.zone === d.zone && l.i === d.i); }
  }
  // the card glow (Zack, 2026-11-24: "soup that up and make it pretty"): a soft bloom around the card, a bright rim on its edge,
  // and a light that travels around the border; the color fades toward white in the moving highlight. One shader for cards and zones.
  glowMat(color, fill = 0) {
    const c = new THREE.Color(color);
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: c }, uHalf: { value: new THREE.Vector2(this.CW / 2, this.CH / 2) }, uPad: { value: this.GPAD }, uFill: { value: fill }, uAmp: { value: 1 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uTime, uPad, uFill, uAmp; uniform vec3 uColor; uniform vec2 uHalf; varying vec2 vP;
        float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
        void main(){
          float d = sdBox(vP, uHalf, 0.03);
          float bloom = exp(-max(d, 0.0) / 0.06) * smoothstep(uPad, uPad * 0.55, d) * smoothstep(-0.012, 0.0, d);
          float rim = smoothstep(0.016, 0.0, abs(d - 0.004));
          float ang = atan(vP.y / uHalf.y, vP.x / uHalf.x);
          float sweep = pow(0.5 + 0.5 * cos(ang - uTime * 1.9), 14.0) + 0.6 * pow(0.5 + 0.5 * cos(ang - uTime * 1.9 + 3.14159), 18.0);
          float breathe = 0.82 + 0.18 * sin(uTime * 2.6);
          float inside = d < 0.0 ? uFill * (0.55 + 0.45 * breathe) * (0.35 + 0.65 * smoothstep(-0.12, 0.0, d)) : 0.0;
          vec3 col = mix(uColor, vec3(1.0, 0.97, 0.9), clamp(sweep * rim * 0.9, 0.0, 1.0));
          float a = (bloom * 0.85 * breathe + rim * (0.65 + 0.35 * breathe) + sweep * (rim * 1.2 + bloom * 0.5)) * uAmp + inside;
          gl_FragColor = vec4(col * a, a);
        }`,
    });
  }
  glow(u, color = 0xff7a30) {
    const c = this.cards.get(u); if (!c) return; if (this.glows.has(u)) { this.glows.get(u).material.uniforms.uColor.value.setHex(color); return; }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(this.CW + 2 * this.GPAD, this.CH + 2 * this.GPAD), this.glowMat(color));
    m.rotation.x = -Math.PI / 2; m.userData.halo = u; m.userData.t0 = performance.now(); this.scene.add(m); this.glows.set(u, m);
  }
  unglow(u) { const m = this.glows.get(u); if (m) { this.scene.remove(m); this.glows.delete(u); } }
  unglowAll() { for (const u of [...this.glows.keys()]) this.unglow(u); }
  ringOn(u, color) {
    const c = this.cards.get(u); if (!c) return;
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.02, 8, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.userData.follow = u; this.scene.add(m); this.rings.push(m);
  }
  ringsOff() { for (const m of this.rings) this.scene.remove(m); this.rings = []; }

  /* ---------- effects ---------- */
  burst(pos, color = 0xff9a50, size = 1) {
    const geo = new THREE.RingGeometry(0.05, 0.12, 48);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y = 0.03; this.scene.add(m);
    const flash = new THREE.PointLight(color, 6 * size, 3.5); flash.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0)); this.scene.add(flash);
    this.tween(520, k => { const s = 1 + k * 9 * size; m.scale.set(s, s, s); m.material.opacity = 1 - k; flash.intensity = 6 * size * (1 - k); }).then(() => { this.scene.remove(m, flash); });
  }
  pillar(pos, color = 0xffb070) { // a column of light for big summons
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 3.2, 40, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(pos); m.position.y = 1.6; this.scene.add(m);
    this.tween(900, k => { m.material.opacity = Math.sin(Math.PI * k) * 0.45; m.scale.set(1 - k * .4, 1, 1 - k * .4); }).then(() => this.scene.remove(m));
  }
  async shatter(u) { // a destroyed card: a flash and it sinks away
    const c = this.cards.get(u); if (!c) return; const p = c.g.position.clone(); this.burst(p, 0xff5a3c, 0.8);
    await this.tween(260, k => { c.g.scale.setScalar(1 + k * 0.08); c.g.position.y = p.y + k * 0.15; });
  }
  shakeCam(a = 0.04) {
    const base = this.camera.position.clone();
    this.tween(300, k => { const d = (1 - k) * a; this.camera.position.set(base.x + (Math.random() - .5) * d, base.y + (Math.random() - .5) * d, base.z); }, ease.lin).then(() => { this.camera.position.copy(base); });
  }

  /* ---------- pointer ---------- */
  bindPointer(el, toStage) {
    const pick = e => {
      const p = toStage(e); this.ndc(p.x, p.y); this.ray.setFromCamera(this.ptr, this.camera);
      const objs = [...[...this.cards.values()].map(c => c.m), ...[...this.piles.values()].map(p => p.m), ...this.zones.filter(z => z.visible)];
      // while you pick a target, a tap goes to the pickable card whose middle is nearest the finger (within about a card's width),
      // so a tap near the edge of a card never lands on its neighbour (Zack, 2026-11-24)
      if (this.prefer && this.prefer.size) {
        let best = null, bd = Infinity; const lim = 0.7 * Math.abs(this.project(new THREE.Vector3(this.CW, 0, 0)).x - this.project(new THREE.Vector3(0, 0, 0)).x);
        for (const u of this.prefer) { const c = this.cards.get(u); if (!c) continue; const q = this.project(c.g.position); const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = u; } }
        if (best != null && bd <= lim) return { u: best };
      }
      const hit = this.ray.intersectObjects(objs, false)[0]; if (!hit) return null;
      const o = hit.object; if (o.userData.zone) return { zone: o.userData.zone };
      if (o.userData.pile) return { pile: o.userData.pile };
      for (const [u, c] of this.cards) if (c.m === o) return { u };
      return null;
    };
    el.addEventListener('pointermove', e => this.onHover(pick(e), e));
    // a touch has no hover: the finger going down shows the card the same way a mouse over it would (Zack, 2026-11-24: touch)
    el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') this.onHover(pick(e), e); });
    el.addEventListener('click', e => this.onClick(pick(e), e));
  }

  // tweens advance here; a fallback clock calls it too when the browser stops sending frames (a background tab or window)
  step(now) { for (const tw of [...this.tweens]) { const k = Math.min(1, (now - tw.t0) / tw.dur); tw.fn(tw.e(k)); if (k >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.res(); } } }
  canvasHidden() { const c = this.renderer.domElement; return document.hidden || !c.isConnected || c.offsetParent === null; }
  dispose() { this.dead = true; clearInterval(this.tick); this.renderer.dispose(); }
  loop(t) {
    if (this.dead) return;
    requestAnimationFrame(this.loop);
    const now = performance.now(); this.lastFrame = now;
    if (this.tweens.length) this.wake();
    this.step(now);
    // nothing moving: skip the frame. Glows, rings and lit zones only shimmer, so they draw at 30 fps (20 on phones) without the shadow pass
    const busy = now < this.hot, ambient = this.glows.size || this.rings.length || this.zones.some(z => z.visible);
    if (!busy) { if (!ambient || this.canvasHidden() || now - (this.lastDraw || 0) < (this.phone ? 50 : 33)) return; }
    this.lastDraw = now; if (busy) this.renderer.shadowMap.needsUpdate = true;
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    const T = now / 1000; for (const z of this.zones) if (z.visible) z.material.uniforms.uTime.value = T + z.userData.zone.i * 0.7;
    for (const [u, m] of this.glows) { const c = this.cards.get(u); if (!c) continue; m.position.set(c.g.position.x, 0.005, c.g.position.z); m.rotation.z = c.def ? Math.PI / 2 : 0; m.scale.setScalar(c.g.scale.x); m.material.uniforms.uTime.value = T + (u % 7) * 0.9; m.material.uniforms.uAmp.value = Math.min(1, (now - m.userData.t0) / 220); }
    for (const m of this.rings) { const c = this.cards.get(m.userData.follow); if (c) m.position.set(c.g.position.x, c.g.position.y + 0.03, c.g.position.z); m.rotation.z = now / 900; }
    this.onFrame();
    this.renderer.render(this.scene, this.camera);
  }
}
