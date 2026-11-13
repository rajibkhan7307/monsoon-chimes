// Monsoon Chimes — a hands-first WebXR music garden.
// Original work. Three.js (MIT) is vendored in ./vendor/three.module.js.
// All geometry is procedural; all sound is synthesized with WebAudio.
// No downloaded assets, no images, no brand names.

import * as THREE from 'three';

// ---------------------------------------------------------------- notes
// Pentatonic scale (C major pentatonic), two octaves, 8 chimes.
const NOTES = [
  { name: 'C4', freq: 261.63 },
  { name: 'D4', freq: 293.66 },
  { name: 'E4', freq: 329.63 },
  { name: 'G4', freq: 392.00 },
  { name: 'A4', freq: 440.00 },
  { name: 'C5', freq: 523.25 },
  { name: 'D5', freq: 587.33 },
  { name: 'E5', freq: 659.25 },
];

// Three short ORIGINAL melodies (indices into NOTES). Composed for this app.
const MELODIES = [
  { title: 'First Rain',    notes: [0, 2, 4, 3, 2, 4, 5, 4] },
  { title: 'Lotus Bloom',   notes: [4, 5, 4, 3, 2, 3, 4, 2, 0, 2] },
  { title: 'Monsoon Night', notes: [0, 4, 5, 7, 5, 4, 3, 2, 4, 5, 4, 2] },
];

const NOTE_STEP_MS = 620;      // gap between notes during melody playback
const HAND_HIT_RADIUS = 0.17;  // metres — hand joint within this of a chime rings it
const HIT_COOLDOWN_MS = 280;

// ---------------------------------------------------------------- audio
const AudioEngine = {
  ctx: null, master: null, rainGain: null, muted: false,

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.startRain();
  },

  // Soft synthesized rain: looped filtered noise, very quiet.
  startRain() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = 0.4;
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0.035;
    src.connect(filter); filter.connect(this.rainGain); this.rainGain.connect(this.master);
    src.start();
  },

  // Brass-chime tone: fundamental + inharmonic partials, long decay.
  chime(freq, velocity = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const partials = [[1, 0.55], [2.76, 0.28], [5.40, 0.13], [8.90, 0.05]];
    for (const [mult, gain] of partials) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain * velocity, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + 3.0);
    }
  },

  // Short soft "plip" for UI feedback.
  plip(freq = 880) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + 0.45);
  },

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  },
};

// ---------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const scoreEl = $('score'), comboEl = $('combo'), starsEl = $('stars');
const messageEl = $('message'), hintEl = $('hint');
const freeBtn = $('freeBtn'), melodyBtn = $('melodyBtn'), melodyRow = $('melodyRow');
const vrBtn = $('vrBtn'), vrNote = $('vrNote'), soundBtn = $('soundBtn');

// ---------------------------------------------------------------- game state
const Game = {
  mode: 'free',            // 'free' | 'melody'
  melodyIndex: -1,
  playback: false,         // melody is being demonstrated
  expected: 0,             // position inside the melody the player must match
  score: 0, combo: 0, bestCombo: 0, mistakes: 0, stars: 0,
  timers: [],
  comboTimer: null,
  clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers = []; },
  after(ms, fn) { this.timers.push(setTimeout(fn, ms)); },
};

function setMessage(text) { messageEl.textContent = text; }
function updateScoreboard() {
  scoreEl.textContent = String(Game.score);
  comboEl.textContent = String(Game.combo);
  starsEl.textContent = Game.stars > 0 ? '★'.repeat(Game.stars) + '☆'.repeat(3 - Game.stars) : '—';
  drawBoard();
}

// ---------------------------------------------------------------- three setup
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1a2b45, 0.028);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 80);
camera.position.set(0, 1.25, 0); // seated eye height

scene.add(new THREE.AmbientLight(0x8fa8c8, 0.55));
const moonLight = new THREE.DirectionalLight(0xbfd4ff, 0.9);
moonLight.position.set(-3, 6, -4);
scene.add(moonLight);
const warmLight = new THREE.PointLight(0xffc46b, 12, 9, 1.6);
warmLight.position.set(0, 1.6, -1.2);
scene.add(warmLight);

// Dusk sky: vertical gradient painted on a canvas, wrapped on a big sphere.
function makeSkyTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#0a1230');
  grad.addColorStop(0.45, '#1d3357');
  grad.addColorStop(0.72, '#4a5f7d');
  grad.addColorStop(0.88, '#c98a4b');
  grad.addColorStop(1.0, '#e8b64c');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(38, 24, 16),
  new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false })
);
scene.add(sky);

// Pale moon disc.
const moon = new THREE.Mesh(
  new THREE.CircleGeometry(1.6, 32),
  new THREE.MeshBasicMaterial({ color: 0xf4ead0, fog: false })
);
moon.position.set(-9, 11, -26);
moon.lookAt(camera.position);
scene.add(moon);

// Pond.
const pond = new THREE.Mesh(
  new THREE.CircleGeometry(16, 48),
  new THREE.MeshStandardMaterial({ color: 0x0e2a3a, roughness: 0.22, metalness: 0.35 })
);
pond.rotation.x = -Math.PI / 2;
pond.position.y = 0;
scene.add(pond);

// A low stone rim / bank the player sits beside (a flat ring under the arc).
const bank = new THREE.Mesh(
  new THREE.CylinderGeometry(2.6, 2.9, 0.12, 32),
  new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.9 })
);
bank.position.set(0, -0.06, -0.4);
scene.add(bank);

// ---------------------------------------------------------------- lotus flowers
const petalMat = new THREE.MeshStandardMaterial({ color: 0xe58aa8, roughness: 0.55, side: THREE.DoubleSide });
const petalMat2 = new THREE.MeshStandardMaterial({ color: 0xf2b8cc, roughness: 0.55, side: THREE.DoubleSide });
const centreMat = new THREE.MeshStandardMaterial({ color: 0xffd76a, roughness: 0.4 });
const padMat = new THREE.MeshStandardMaterial({ color: 0x2e6b3a, roughness: 0.8, side: THREE.DoubleSide });

function makeLotus(x, z, scale) {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), padMat);
  pad.rotation.x = -Math.PI / 2; pad.position.y = 0.015;
  g.add(pad);
  const centre = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), centreMat);
  centre.scale.y = 0.6; centre.position.y = 0.09;
  g.add(centre);
  for (let i = 0; i < 8; i++) {
    const petal = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.22, 6), i % 2 ? petalMat : petalMat2);
    const a = (i / 8) * Math.PI * 2;
    petal.position.set(Math.cos(a) * 0.13, 0.1, Math.sin(a) * 0.13);
    petal.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
    petal.scale.set(1, 1, 0.45);
    g.add(petal);
  }
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  scene.add(g);
  return g;
}
makeLotus(-1.9, -2.4, 1.1);
makeLotus(2.1, -2.2, 0.9);
makeLotus(-2.6, -0.9, 0.8);
makeLotus(2.7, -1.1, 1.0);
makeLotus(0.4, -3.1, 1.2);

// ---------------------------------------------------------------- chimes
const brassMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.9, roughness: 0.32 });
const brassDark = new THREE.MeshStandardMaterial({ color: 0x8a6d1f, metalness: 0.85, roughness: 0.45 });
const stringMat = new THREE.MeshBasicMaterial({ color: 0xd8cdb2 });
const glowMatBase = new THREE.MeshBasicMaterial({
  color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, side: THREE.DoubleSide,
});

const chimes = [];       // { group, tube, glow, ring, noteIndex, lastHit, swing, baseY }
const chimeHitMeshes = []; // invisible fat spheres for easy pointer/hand hits

function makeChime(noteIndex, x, y, z, tubeLen) {
  const group = new THREE.Group();
  group.position.set(x, y, z);

  // Hanging string.
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.35, 6), stringMat);
  str.position.y = 0.32;
  group.add(str);

  // Brass tube (open-ended cylinder reads as a chime tube).
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, tubeLen, 20, 1, true), brassMat);
  group.add(tube);
  const rimTop = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 20), brassDark);
  rimTop.rotation.x = Math.PI / 2; rimTop.position.y = tubeLen / 2;
  group.add(rimTop);
  const rimBottom = rimTop.clone(); rimBottom.position.y = -tubeLen / 2;
  group.add(rimBottom);
  // Clapper ball inside the bottom.
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), brassDark);
  clapper.position.y = -tubeLen / 2 - 0.02;
  group.add(clapper);

  // Glow halo (fades in on hit / while lit in melody mode).
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), glowMatBase.clone());
  group.add(glow);

  // Ripple ring on the pond below, shown briefly on a hit.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.09, 0.12, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.02, z);
  scene.add(ring);

  // Invisible fat hit sphere (generous target for hands and pointer).
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hit);
  hit.userData.chimeIndex = noteIndex;
  chimeHitMeshes.push(hit);

  scene.add(group);
  chimes.push({ group, tube, glow, ring, noteIndex, lastHit: 0, swing: 0, ringT: 1, baseY: y });
}

// Arc of 8 chimes across the comfortable central field of view, ~1.4 m away.
const ARC = [
  [-1.15, 1.52, -1.30, 0.34], [-0.82, 1.44, -1.42, 0.40], [-0.49, 1.38, -1.50, 0.46],
  [-0.16, 1.34, -1.54, 0.52], [ 0.16, 1.34, -1.54, 0.52], [ 0.49, 1.38, -1.50, 0.46],
  [ 0.82, 1.44, -1.42, 0.40], [ 1.15, 1.52, -1.30, 0.34],
];
ARC.forEach(([x, y, z, len], i) => makeChime(i, x, y, z, len));

// ---------------------------------------------------------------- in-world scoreboard (canvas texture)
const boardCanvas = document.createElement('canvas');
boardCanvas.width = 512; boardCanvas.height = 192;
const boardCtx = boardCanvas.getContext('2d');
const boardTex = new THREE.CanvasTexture(boardCanvas);
boardTex.colorSpace = THREE.SRGBColorSpace;
const board = new THREE.Mesh(
  new THREE.PlaneGeometry(1.0, 0.375),
  new THREE.MeshBasicMaterial({ map: boardTex, transparent: true, side: THREE.DoubleSide })
);
board.position.set(0, 0.62, -2.35);
scene.add(board);

function drawBoard() {
  const g = boardCtx;
  g.clearRect(0, 0, 512, 192);
  g.fillStyle = 'rgba(10, 20, 40, 0.55)';
  if (typeof g.roundRect === 'function') { g.beginPath(); g.roundRect(6, 6, 500, 180, 24); g.fill(); }
  else g.fillRect(6, 6, 500, 180);
  g.strokeStyle = 'rgba(255, 233, 168, 0.6)'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#ffe9a8'; g.textAlign = 'center';
  g.font = '34px Georgia, serif';
  const modeText = Game.mode === 'melody'
    ? 'Follow the Melody — ' + (Game.melodyIndex >= 0 ? MELODIES[Game.melodyIndex].title : '')
    : 'Free Play';
  g.fillText(modeText, 256, 52);
  g.font = '30px Georgia, serif'; g.fillStyle = '#f5ead2';
  g.fillText('Score ' + Game.score + '    Combo ' + Game.combo, 256, 112);
  if (Game.mode === 'melody' && Game.melodyIndex >= 0) {
    const done = Game.expected;
    const total = MELODIES[Game.melodyIndex].notes.length;
    g.fillStyle = '#cfe3d8'; g.font = '26px Georgia, serif';
    g.fillText('Notes: ' + done + ' / ' + total, 256, 158);
  } else {
    g.fillStyle = '#cfe3d8'; g.font = '26px Georgia, serif';
    g.fillText('Strike a chime to play', 256, 158);
  }
  boardTex.needsUpdate = true;
}
drawBoard();

// ---------------------------------------------------------------- rain (falling points)
const RAIN_COUNT = 700;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_COUNT * 3);
const rainSpeed = new Float32Array(RAIN_COUNT);
for (let i = 0; i < RAIN_COUNT; i++) {
  rainPos[i * 3] = (Math.random() - 0.5) * 24;
  rainPos[i * 3 + 1] = Math.random() * 10;
  rainPos[i * 3 + 2] = (Math.random() - 0.5) * 24 - 2;
  rainSpeed[i] = 2.2 + Math.random() * 2.0;
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
  color: 0xaecbe8, size: 0.025, transparent: true, opacity: 0.45, sizeAttenuation: true,
}));
scene.add(rain);

// ---------------------------------------------------------------- fireflies
const FLY_COUNT = 70;
const flyGeo = new THREE.BufferGeometry();
const flyPos = new Float32Array(FLY_COUNT * 3);
const flySeed = new Float32Array(FLY_COUNT * 3);
for (let i = 0; i < FLY_COUNT; i++) {
  flyPos[i * 3] = (Math.random() - 0.5) * 8;
  flyPos[i * 3 + 1] = 0.4 + Math.random() * 2.2;
  flyPos[i * 3 + 2] = -0.5 - Math.random() * 4;
  flySeed[i * 3] = Math.random() * Math.PI * 2;
  flySeed[i * 3 + 1] = 0.3 + Math.random() * 0.7;
  flySeed[i * 3 + 2] = Math.random() * Math.PI * 2;
}
flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
const flyMat = new THREE.PointsMaterial({
  color: 0xffe27a, size: 0.06, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
});
const fireflies = new THREE.Points(flyGeo, flyMat);
scene.add(fireflies);

// Stars high in the sky.
const STAR_COUNT = 220;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++) {
  const a = Math.random() * Math.PI * 2, e = 0.25 + Math.random() * 1.1, r = 34;
  starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
  starPos[i * 3 + 1] = Math.sin(e) * r;
  starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
  color: 0xffffff, size: 0.12, transparent: true, opacity: 0.8, fog: false,
})));

// ---------------------------------------------------------------- note particles (burst on each hit)
const bursts = []; // { points, vel, life }
function spawnBurst(worldPos) {
  const n = 26;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = worldPos.x; pos[i * 3 + 1] = worldPos.y; pos[i * 3 + 2] = worldPos.z;
    const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
    const s = 0.5 + Math.random() * 0.9;
    vel[i * 3] = Math.cos(a) * Math.cos(b) * s;
    vel[i * 3 + 1] = Math.abs(Math.sin(b)) * s + 0.4;
    vel[i * 3 + 2] = Math.sin(a) * Math.cos(b) * s;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffe9a8, size: 0.055, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  bursts.push({ points, vel, life: 1 });
}

// Completion fireworks: a big golden burst above the pond.
function celebrationBurst() {
  for (let k = 0; k < 3; k++) {
    const p = new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.9 + Math.random() * 0.5, -1.6);
    spawnBurst(p);
  }
}

// ---------------------------------------------------------------- striking a chime
const _v = new THREE.Vector3();
function strikeChime(index, { fromPlayer = true, silent = false } = {}) {
  const chime = chimes[index];
  if (!chime) return;
  const now = performance.now();
  if (fromPlayer && now - chime.lastHit < HIT_COOLDOWN_MS) return;
  chime.lastHit = now;
  chime.swing = 1;
  chime.ringT = 0;
  chime.glow.material.opacity = 0.85;
  chime.group.getWorldPosition(_v);
  spawnBurst(_v);
  if (!silent) AudioEngine.chime(NOTES[index].freq, 1);

  if (Game.mode === 'melody' && fromPlayer && !Game.playback && Game.melodyIndex >= 0) {
    const melody = MELODIES[Game.melodyIndex];
    if (index === melody.notes[Game.expected]) {
      Game.expected++;
      Game.combo++;
      Game.bestCombo = Math.max(Game.bestCombo, Game.combo);
      Game.score += 100;
      if (Game.expected >= melody.notes.length) {
        const stars = Game.mistakes === 0 ? 3 : Game.mistakes <= 2 ? 2 : 1;
        Game.stars = stars;
        setMessage('Beautiful! "' + melody.title + '" complete — ' + stars + ' star' + (stars > 1 ? 's' : '') + '!');
        celebrationBurst();
        AudioEngine.plip(1046); Game.after(180, () => AudioEngine.plip(1318));
        Game.after(360, () => AudioEngine.plip(1568));
        Game.melodyIndex = -1; Game.expected = 0; Game.combo = 0;
      } else {
        setMessage('Lovely — ' + (melody.notes.length - Game.expected) + ' more note' +
          (melody.notes.length - Game.expected > 1 ? 's' : '') + ' to go.');
      }
    } else {
      Game.mistakes++;
      Game.combo = 0;
      setMessage('Not quite — listen again, then try from the start.');
      Game.expected = 0;
      AudioEngine.plip(220);
    }
  } else if (Game.mode === 'free' && fromPlayer) {
    Game.score += 10;
    Game.combo++;
    Game.bestCombo = Math.max(Game.bestCombo, Game.combo);
    clearTimeout(Game.comboTimer);
    Game.comboTimer = setTimeout(() => { Game.combo = 0; updateScoreboard(); }, 2500);
    const newStars = Game.bestCombo >= 20 ? 3 : Game.bestCombo >= 10 ? 2 : Game.bestCombo >= 5 ? 1 : 0;
    if (newStars > Game.stars) {
      Game.stars = newStars;
      setMessage(newStars >= 3 ? 'Amazing! 3 stars — you are a monsoon maestro!' : 'Star earned! Keep the rhythm going!');
      if (newStars >= 3) celebrationBurst();
    }
  }
  updateScoreboard();
}

// Light a chime during melody demonstration (no scoring).
function lightChime(index) {
  const chime = chimes[index];
  chime.swing = 0.7;
  chime.glow.material.opacity = 0.9;
  chime.group.getWorldPosition(_v);
  spawnBurst(_v);
  AudioEngine.chime(NOTES[index].freq, 0.9);
}

// ---------------------------------------------------------------- melody mode
function startMelody(index) {
  Game.clearTimers();
  clearTimeout(Game.comboTimer);
  Game.mode = 'melody';
  Game.melodyIndex = index;
  Game.expected = 0;
  Game.mistakes = 0;
  Game.combo = 0;
  Game.stars = 0;
  Game.playback = true;
  const melody = MELODIES[index];
  setMessage('Listen to "' + melody.title + '"…');
  updateScoreboard();
  melody.notes.forEach((noteIdx, i) => {
    Game.after(700 + i * NOTE_STEP_MS, () => lightChime(noteIdx));
  });
  Game.after(700 + melody.notes.length * NOTE_STEP_MS + 300, () => {
    Game.playback = false;
    setMessage('Your turn — repeat "' + melody.title + '"!');
    AudioEngine.plip(660);
  });
}

function setFreeMode() {
  Game.clearTimers();
  clearTimeout(Game.comboTimer);
  Game.mode = 'free';
  Game.melodyIndex = -1;
  Game.expected = 0;
  Game.combo = 0;
  Game.playback = false;
  melodyRow.classList.remove('show');
  freeBtn.classList.add('active');
  melodyBtn.classList.remove('active');
  setMessage('Free Play — strike any chime.');
  updateScoreboard();
}

// ---------------------------------------------------------------- DOM wiring
freeBtn.addEventListener('click', () => { AudioEngine.ensure(); AudioEngine.plip(); setFreeMode(); });
melodyBtn.addEventListener('click', () => {
  AudioEngine.ensure(); AudioEngine.plip();
  const open = melodyRow.classList.toggle('show');
  melodyBtn.classList.toggle('active', open);
  freeBtn.classList.toggle('active', !open);
  if (open) { Game.mode = 'melody'; setMessage('Choose a melody to learn.'); }
  else setFreeMode();
  updateScoreboard();
});
melodyRow.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => { AudioEngine.ensure(); startMelody(Number(btn.dataset.melody)); });
});
soundBtn.addEventListener('click', () => {
  AudioEngine.ensure();
  AudioEngine.setMuted(!AudioEngine.muted);
  soundBtn.textContent = AudioEngine.muted ? 'Sound: Off' : 'Sound: On';
});
window.addEventListener('pointerdown', () => AudioEngine.ensure(), { once: true });

// ---------------------------------------------------------------- desktop fallback: pointer as a virtual hand
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const virtualHand = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 })
);
virtualHand.visible = false;
scene.add(virtualHand);
const handGlow = new THREE.Mesh(
  new THREE.SphereGeometry(0.11, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending, depthWrite: false })
);
virtualHand.add(handGlow);

const chimePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1.45); // z = -1.45
const planeHit = new THREE.Vector3();

function pointerToRay(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function pickChime(e) {
  pointerToRay(e);
  const hits = raycaster.intersectObjects(chimeHitMeshes, false);
  return hits.length ? hits[0].object.userData.chimeIndex : -1;
}

canvas.addEventListener('pointermove', (e) => {
  if (renderer.xr.isPresenting) return;
  AudioEngine.ensure();
  pointerToRay(e);
  // Place the glowing virtual hand where the pointer ray meets the chime plane.
  if (raycaster.ray.intersectPlane(chimePlane, planeHit)) {
    virtualHand.visible = true;
    virtualHand.position.copy(planeHit);
  }
  // Hover-pass strike: moving the hand through a chime rings it.
  const idx = pickChime(e);
  if (idx >= 0) strikeChime(idx);
});
canvas.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting) return;
  AudioEngine.ensure();
  const idx = pickChime(e);
  if (idx >= 0) strikeChime(idx, { fromPlayer: true });
  else { // tap anywhere: soft plip so the first touch always answers
    AudioEngine.plip(523);
  }
});
canvas.addEventListener('pointerleave', () => { virtualHand.visible = false; });

// ---------------------------------------------------------------- WebXR: hands + controllers
const HAND_JOINTS = ['index-finger-tip', 'thumb-tip', 'middle-finger-tip', 'index-finger-phalanx-proximal', 'palm'];
const _jointPos = new THREE.Vector3();
const _chimePos = new THREE.Vector3();

function checkHands(frame, refSpace) {
  const session = renderer.xr.getSession();
  if (!session) return;
  for (const source of session.inputSources) {
    if (source.hand) {
      for (const jointName of HAND_JOINTS) {
        let joint;
        try { joint = source.hand.get(jointName); } catch (err) { continue; }
        if (!joint) continue;
        const pose = frame.getJointPose(joint, refSpace);
        if (!pose) continue;
        _jointPos.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
        for (let i = 0; i < chimes.length; i++) {
          chimes[i].group.getWorldPosition(_chimePos);
          if (_jointPos.distanceTo(_chimePos) < HAND_HIT_RADIUS) strikeChime(i);
        }
      }
    }
  }
}

// Controllers as optional pointers (not required — hands are the primary input).
function setupController(i) {
  const controller = renderer.xr.getController(i);
  controller.addEventListener('selectstart', () => {
    const tempMatrix = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    const hits = raycaster.intersectObjects(chimeHitMeshes, false);
    if (hits.length) strikeChime(hits[0].object.userData.chimeIndex);
  });
  scene.add(controller);
}
setupController(0);
setupController(1);

async function enterVR() {
  AudioEngine.ensure();
  if (!navigator.xr) { setMessage('WebXR is not available in this browser.'); return; }
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'hand-tracking', 'dom-overlay'],
      domOverlay: { root: document.body },
    });
    await renderer.xr.setSession(session);
    hintEl.textContent = 'Reach out and touch a chime with your hand.';
    session.addEventListener('end', () => {
      hintEl.textContent = 'Move your hand across a chime to ring it — or click / tap one.';
    });
  } catch (err) {
    setMessage('Could not start VR: ' + (err && err.message ? err.message : 'unknown error'));
  }
}
vrBtn.addEventListener('click', enterVR);

// Show the Enter VR button only when immersive-vr is actually supported.
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (supported) {
      vrBtn.style.display = '';
      vrNote.textContent = '';
    } else {
      vrNote.textContent = 'No headset detected — playing in the browser. Click or tap the chimes.';
    }
  }).catch(() => {
    vrNote.textContent = 'No headset detected — playing in the browser. Click or tap the chimes.';
  });
} else {
  vrNote.textContent = 'No headset detected — playing in the browser. Click or tap the chimes.';
}

// ---------------------------------------------------------------- resize + animation
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let firstFrame = true;

function animate(time, frame) {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // Rain falls and recycles.
  const rp = rainGeo.attributes.position.array;
  for (let i = 0; i < RAIN_COUNT; i++) {
    rp[i * 3 + 1] -= rainSpeed[i] * dt;
    if (rp[i * 3 + 1] < 0) {
      rp[i * 3 + 1] = 9 + Math.random();
      rp[i * 3] = (Math.random() - 0.5) * 24;
      rp[i * 3 + 2] = (Math.random() - 0.5) * 24 - 2;
    }
  }
  rainGeo.attributes.position.needsUpdate = true;

  // Fireflies drift and twinkle.
  const fp = flyGeo.attributes.position.array;
  for (let i = 0; i < FLY_COUNT; i++) {
    fp[i * 3] += Math.sin(t * flySeed[i * 3 + 1] + flySeed[i * 3]) * 0.0016;
    fp[i * 3 + 1] += Math.cos(t * 0.5 + flySeed[i * 3 + 2]) * 0.0012;
    fp[i * 3 + 2] += Math.sin(t * 0.4 + flySeed[i * 3]) * 0.0016;
  }
  flyGeo.attributes.position.needsUpdate = true;
  flyMat.opacity = 0.65 + Math.sin(t * 1.7) * 0.25;

  // Chime swing + glow decay + ripple rings.
  for (const chime of chimes) {
    if (chime.swing > 0.001) {
      chime.group.rotation.z = Math.sin(t * 6) * 0.12 * chime.swing;
      chime.swing *= Math.pow(0.25, dt); // decay
    } else {
      chime.group.rotation.z = 0;
    }
    const gm = chime.glow.material;
    if (gm.opacity > 0.01) gm.opacity *= Math.pow(0.12, dt);
    if (chime.ringT < 1) {
      chime.ringT = Math.min(1, chime.ringT + dt * 0.9);
      const s = 0.3 + chime.ringT * 2.4;
      chime.ring.scale.set(s, s, s);
      chime.ring.material.opacity = 0.7 * (1 - chime.ringT);
    } else {
      chime.ring.material.opacity = 0;
    }
  }

  // Note-particle bursts rise and fade.
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.life -= dt * 0.8;
    const bp = b.points.geometry.attributes.position.array;
    for (let j = 0; j < bp.length / 3; j++) {
      bp[j * 3] += b.vel[j * 3] * dt;
      bp[j * 3 + 1] += b.vel[j * 3 + 1] * dt;
      bp[j * 3 + 2] += b.vel[j * 3 + 2] * dt;
      b.vel[j * 3 + 1] -= dt * 0.3;
    }
    b.points.geometry.attributes.position.needsUpdate = true;
    b.points.material.opacity = Math.max(0, b.life);
    if (b.life <= 0) {
      scene.remove(b.points);
      b.points.geometry.dispose();
      b.points.material.dispose();
      bursts.splice(i, 1);
    }
  }

  // Virtual hand gently pulses.
  if (virtualHand.visible) {
    const s = 1 + Math.sin(t * 4) * 0.12;
    virtualHand.scale.setScalar(s);
  }

  // Hand tracking (only while presenting; frame comes from setAnimationLoop).
  if (renderer.xr.isPresenting && frame) {
    const refSpace = renderer.xr.getReferenceSpace();
    if (refSpace) checkHands(frame, refSpace);
  }

  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    const loading = $('loading');
    if (loading) loading.remove();
  }
}

renderer.setAnimationLoop(animate);
updateScoreboard();
