/*
 * Bolt Run — a tiny endless runner.
 * Vanilla JS + Canvas 2D. No libraries, no build step.
 *
 * Sections:
 *   1. Config & utilities
 *   2. Sprites (pixel maps -> offscreen canvases + collision masks)
 *   3. Collision (AABB broad phase + per-pixel narrow phase)
 *   4. Sound (WebAudio synth, no audio files)
 *   5. World state: player, obstacles, particles, scenery
 *   6. Game flow: start / pause / game over / restart
 *   7. Input (keyboard, pointer/touch, buttons)
 *   8. Layout (responsive canvas) & main loop (fixed timestep)
 */
(() => {
  'use strict';

  // ===================================================================
  // 1. Config & utilities
  // ===================================================================
  const CFG = {
    VIEW_H: 260,          // logical world height (px); width adapts to screen
    GROUND_Y: 222,        // y of the ground line
    SCALE: 3,             // each sprite pixel = 3x3 logical px
    PLAYER_X: 64,

    GRAVITY: 2600,        // px/s²
    JUMP_V: 860,          // initial jump velocity (px/s)
    JUMP_CUT_V: 380,      // upward speed is capped to this when jump is released early
    FAST_FALL: 2.6,       // gravity multiplier while holding ↓
    JUMP_BUFFER: 0.12,    // s — a press just before landing still counts
    MIN_JUMP_TIME: 0.08,  // s — even the quickest tap gives a jump that clears tall crystals

    SPEED_START: 380,     // px/s
    SPEED_MAX: 960,
    SPEED_ACCEL: 9,       // px/s gained per second

    SCORE_RATE: 0.025,    // points per px travelled
    MILESTONE: 100,
    DRONE_SCORE: 250,     // drones appear after this score
    DAY_LENGTH: 1400,     // score for a full day/night cycle

    STEP: 1 / 120,        // fixed simulation step (s)
    RESTART_DELAY: 450,   // ms before a game over can be dismissed
    STORAGE_HI: 'boltrun.hi',
    STORAGE_MUTE: 'boltrun.muted',
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  // Deterministic hash -> [0,1). Used to place scenery so it never "pops".
  function hash(n) {
    n = (n | 0) ^ 0x9e3779b9;
    n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
    n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }

  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',')})`;
  }

  // localStorage can throw (private mode, blocked storage) — never let it break the game.
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } },
  };

  // ===================================================================
  // 2. Sprites
  // ===================================================================
  // One character per pixel; '.' is transparent. Letters map to PALETTE.
  const PALETTE = {
    k: '#1d1b2e', // outline
    w: '#e8e4d8', // robot shell
    v: '#26304f', // visor
    e: '#5ff2e6', // eyes
    x: '#ff4d4d', // dead eyes
    r: '#e8574a', // scarf
    b: '#f2a93b', // chest plate
    y: '#ffe066', // antenna light (ignored by collision)
    C: '#c9b8ff', // crystal highlight
    c: '#7b5cff', // crystal body
    m: '#6d6a7c', // rock base
    d: '#a3acc0', // drone body
    l: '#ff3b3b', // drone eye
    p: '#d8dde8', // propeller
  };
  const NO_COLLIDE = new Set(['y', 'p']); // forgiving: antenna tip & spinning blades

  const HEAD = [
    '.....yy.......',
    '......k.......',
    '..kkkkkkkkk...',
    '.kwwwwwwwwwk..',
    '.kwvvvvvvvwk..',
    '.kwvvvevevwk..',
    '.kwvvvvvvvwk..',
    '.kwwwwwwwwwk..',
  ];
  const HEAD_DEAD = HEAD.map((r, i) => (i === 5 ? '.kwvvvxvxvwk..' : r));
  const BODY_A = [
    '..kkrrrrrkk...',
    '.rrkbbbbbk....',
    'r..kbwwwbk....',
    '...kbbbbbk....',
    '....kkkkk.....',
  ];
  const BODY_B = [
    '..kkrrrrrkk...',
    '...kbbbbbk....',
    '.rrkbwwwbk....',
    'r..kbbbbbk....',
    '....kkkkk.....',
  ];
  const LEGS_A = ['....kk.kk.....', '...kk...kk....', '..kk......k...'];
  const LEGS_B = ['.....kkk......', '.....kk.......', '.....kkk......'];
  const LEGS_JUMP = ['....kk.kk.....', '....k...k.....', '..............'];

  const CRYSTAL_S = [
    '...kk...',
    '..kCck..',
    '..kCck..',
    '.kCCcck.',
    '.kCccck.',
    '.kCccck.',
    '.kCccck.',
    '.kCccck.',
    '.kCccck.',
    '.kCccck.',
    '.kmmmmk.',
    'kmmmmmmk',
    'kkkkkkkk',
  ];
  const CRYSTAL_T = [
    '....kk....',
    '...kCck...',
    '...kCck...',
    '..kCCcck..',
    '..kCccck..',
    '..kCccck..',
    '..kCccck.k',
    '..kCccckCk',
    'k.kCccckck',
    'CkkCccckck',
    'CckCccckck',
    'CckCccckk.',
    'CckCccck..',
    'kckCccck..',
    '.kkCccck..',
    '.kmmmmmmk.',
    'kmmmmmmmmk',
    'kkkkkkkkkk',
  ];
  const DRONE_BODY = [
    '...k........k...',
    '..kkkkkkkkkkkk..',
    '.kddddddddddddk.',
    'kddvvvvvvvvvvddk',
    'kddvlvvvvvvvvddk',
    '.kddddddddddddk.',
    '..kkk.kkkk.kkk..',
    '....k......k....',
  ];
  const DRONE_1 = ['ppppp......ppppp', ...DRONE_BODY];
  const DRONE_2 = ['..ppp......ppp..', ...DRONE_BODY];

  const repeatRows = (rows, n) => rows.map((r) => r.repeat(n));

  function makeSprite(name, rows) {
    const h = rows.length, w = rows[0].length;
    rows.forEach((r, i) => {
      if (r.length !== w) throw new Error(`Sprite "${name}" row ${i} is ${r.length} wide, expected ${w}`);
    });
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        if (!PALETTE[ch]) throw new Error(`Sprite "${name}" uses unknown colour "${ch}"`);
        g.fillStyle = PALETTE[ch];
        g.fillRect(x, y, 1, 1);
        if (!NO_COLLIDE.has(ch)) mask[y * w + x] = 1;
      }
    }
    return { name, canvas, mask, w, h, pw: w * CFG.SCALE, ph: h * CFG.SCALE };
  }

  const SPR = {
    runA: makeSprite('runA', [...HEAD, ...BODY_A, ...LEGS_A]),
    runB: makeSprite('runB', [...HEAD, ...BODY_B, ...LEGS_B]),
    jump: makeSprite('jump', [...HEAD, ...BODY_A, ...LEGS_JUMP]),
    dead: makeSprite('dead', [...HEAD_DEAD, ...BODY_B, ...LEGS_A]),
    crystalS: makeSprite('crystalS', CRYSTAL_S),
    crystalT: makeSprite('crystalT', CRYSTAL_T),
    cluster2: makeSprite('cluster2', repeatRows(CRYSTAL_S, 2)),
    cluster3: makeSprite('cluster3', repeatRows(CRYSTAL_S, 3)),
    drone1: makeSprite('drone1', DRONE_1),
    drone2: makeSprite('drone2', DRONE_2),
  };

  // ===================================================================
  // 3. Collision
  // ===================================================================
  // Broad phase: rectangle overlap. Narrow phase: walk the overlapping
  // logical pixels and test both sprites' opaque masks. Positions are
  // rounded exactly the same way the renderer rounds them, so what you
  // see is what collides.
  function pixelCollide(a, ax, ay, b, bx, by) {
    ax = Math.round(ax); ay = Math.round(ay); bx = Math.round(bx); by = Math.round(by);
    const left = Math.max(ax, bx), right = Math.min(ax + a.pw, bx + b.pw);
    const top = Math.max(ay, by), bottom = Math.min(ay + a.ph, by + b.ph);
    if (left >= right || top >= bottom) return false;
    const S = CFG.SCALE;
    for (let y = top; y < bottom; y++) {
      const ar = ((y - ay) / S | 0) * a.w;
      const br = ((y - by) / S | 0) * b.w;
      for (let x = left; x < right; x++) {
        if (a.mask[ar + ((x - ax) / S | 0)] && b.mask[br + ((x - bx) / S | 0)]) return true;
      }
    }
    return false;
  }

  // ===================================================================
  // 4. Sound — synthesized with WebAudio, created on first user gesture
  // ===================================================================
  const Sound = {
    ctx: null,
    master: null,
    muted: store.get(CFG.STORAGE_MUTE, '0') === '1',
    VOLUME: 0.3,

    // iOS Safari: the context must be created/resumed inside a user gesture,
    // can be 'interrupted' (calls, Siri, app switch), and only fully unlocks
    // once a sound has actually been played inside a touch handler.
    init() {
      if (this.ctx) {
        if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.VOLUME;
        this.master.connect(this.ctx.destination);
        // Play one silent sample to fully unlock audio on iOS.
        const src = this.ctx.createBufferSource();
        src.buffer = this.ctx.createBuffer(1, 1, 22050);
        src.connect(this.ctx.destination);
        src.start(0);
        if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      } catch { this.ctx = null; }
    },

    setMuted(m) {
      this.muted = m;
      store.set(CFG.STORAGE_MUTE, m ? '1' : '0');
      if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.VOLUME, this.ctx.currentTime, 0.01);
    },

    tone(freq, dur, { type = 'square', vol = 0.5, slide = null, delay = 0 } = {}) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },

    noise(dur, vol) {
      if (!this.ctx || this.muted) return;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 1800;
      g.gain.value = vol;
      src.buffer = buf;
      src.connect(f).connect(g).connect(this.master);
      src.start();
    },

    jump()  { this.tone(300, 0.15, { vol: 0.32, slide: 760 }); },
    land()  { this.tone(150, 0.05, { type: 'triangle', vol: 0.35, slide: 80 }); },
    point() { this.tone(880, 0.07, { vol: 0.25 }); this.tone(1320, 0.14, { vol: 0.25, delay: 0.07 }); },
    hit()   { this.noise(0.28, 0.7); this.tone(240, 0.4, { type: 'sawtooth', vol: 0.35, slide: 50 }); },
  };

  // ===================================================================
  // 5. World state
  // ===================================================================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const ui = {
    score: document.getElementById('score'),
    hi: document.getElementById('hiScore'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('ovTitle'),
    sub: document.getElementById('ovSub'),
    badge: document.getElementById('ovBadge'),
    restart: document.getElementById('restartBtn'),
    mute: document.getElementById('muteBtn'),
    pause: document.getElementById('pauseBtn'),
  };

  let viewW = 800;           // logical width, set by layout()
  let renderScale = 1;       // device px per logical px

  const game = {
    state: 'ready',          // ready | running | paused | over
    speed: CFG.SPEED_START,
    score: 0,
    hi: parseInt(store.get(CFG.STORAGE_HI, '0'), 10) || 0,
    distance: 0,             // total px scrolled (drives parallax)
    time: 0,
    gapLeft: 0,              // px until next obstacle spawns
    nextMilestone: CFG.MILESTONE,
    overAt: 0,
    newBest: false,
    shake: 0,
  };

  const input = { jumpHeld: false, downHeld: false };

  // ---------- Player ----------
  const player = {
    x: CFG.PLAYER_X,
    y: 0,
    vy: 0,
    onGround: true,
    buffer: 0,
    airTime: 0,
    stride: 0,               // distance accumulator for the run cycle
    dead: false,

    get groundTop() { return CFG.GROUND_Y - SPR.runA.ph; },

    get sprite() {
      if (this.dead) return SPR.dead;
      if (!this.onGround) return SPR.jump;
      if (game.state === 'ready') return (game.time * 2 | 0) % 2 ? SPR.runA : SPR.runB;
      return (this.stride / 30 | 0) % 2 ? SPR.runB : SPR.runA;
    },

    reset() {
      this.y = this.groundTop; this.vy = 0; this.onGround = true;
      this.buffer = 0; this.stride = 0; this.dead = false;
    },

    requestJump() { this.buffer = CFG.JUMP_BUFFER; },

    update(dt) {
      if (this.buffer > 0) {
        this.buffer -= dt;
        if (this.onGround) {
          this.vy = -CFG.JUMP_V;
          this.onGround = false;
          this.airTime = 0;
          this.buffer = 0;
          Sound.jump();
          burst(this.x + 18, CFG.GROUND_Y, 5, '#c9a27a', -60, 0);
        }
      }
      if (!this.onGround) {
        // Variable jump height: releasing early cuts the ascent.
        this.airTime += dt;
        if (!input.jumpHeld && this.airTime > CFG.MIN_JUMP_TIME && this.vy < -CFG.JUMP_CUT_V) this.vy = -CFG.JUMP_CUT_V;
        const g = CFG.GRAVITY * (input.downHeld ? CFG.FAST_FALL : 1);
        // Semi-implicit Euler: stable and frame-rate independent at a fixed step.
        this.vy += g * dt;
        this.y += this.vy * dt;
        if (this.y >= this.groundTop) {
          this.y = this.groundTop;
          this.vy = 0;
          this.onGround = true;
          Sound.land();
          burst(this.x + 20, CFG.GROUND_Y, 6, '#c9a27a', -80, 0);
        }
      } else {
        this.stride += game.speed * dt;
      }
    },
  };

  // ---------- Obstacles ----------
  const OBSTACLES = {
    crystalS: { frames: [SPR.crystalS], weight: 3, minScore: 0 },
    crystalT: { frames: [SPR.crystalT], weight: 2, minScore: 0 },
    cluster2: { frames: [SPR.cluster2], weight: 2, minScore: 80 },
    cluster3: { frames: [SPR.cluster3], weight: 1, minScore: 450 },
    // Low drone: must be jumped. High drone: run under it — jumping hits it.
    droneLow:  { frames: [SPR.drone1, SPR.drone2], weight: 1.2, minScore: CFG.DRONE_SCORE, fly: 14 },
    droneHigh: { frames: [SPR.drone1, SPR.drone2], weight: 1.0, minScore: CFG.DRONE_SCORE + 150, fly: 62 },
  };

  const obstacles = [];

  function pickObstacleType() {
    const pool = Object.entries(OBSTACLES).filter(([, t]) => game.score >= t.minScore);
    let r = Math.random() * pool.reduce((s, [, t]) => s + t.weight, 0);
    for (const [name, t] of pool) { r -= t.weight; if (r <= 0) return name; }
    return pool[0][0];
  }

  function spawnObstacle(typeName = pickObstacleType(), x = viewW + 12) {
    const type = OBSTACLES[typeName];
    const s = type.frames[0];
    const baseY = type.fly ? CFG.GROUND_Y - type.fly - s.ph : CFG.GROUND_Y - s.ph;
    const o = { type: typeName, frames: type.frames, x, y: baseY, baseY, fly: !!type.fly, t: rand(0, 6), extraV: type.fly ? 45 : 0 };
    obstacles.push(o);
    return o;
  }

  // Gap is expressed as time-at-current-speed so the game stays fair as it speeds up:
  // airtime ≈ 2·JUMP_V/GRAVITY ≈ 0.66 s, so ≥ 0.85 s of runway always allows a re-jump.
  function nextGap(width) {
    const t = rand(0.85, 1.65) - Math.min(0.25, game.score / 6000);
    return width + game.speed * t + 30;
  }

  function obstacleSprite(o) { return o.frames.length > 1 ? o.frames[(o.t * 18 | 0) % o.frames.length] : o.frames[0]; }

  // ---------- Particles ----------
  const particles = [];
  function burst(x, y, n, color, vy0, vx0) {
    for (let i = 0; i < n; i++) {
      particles.push({ x, y, vx: vx0 + rand(-90, 40), vy: vy0 * rand(0.4, 1.2), life: rand(0.25, 0.5), max: 0.5, color, size: rand(2, 4) | 0 });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += 900 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > CFG.GROUND_Y) { p.y = CFG.GROUND_Y; p.vy *= -0.3; p.vx *= 0.7; }
    }
  }

  // ---------- Simulation step ----------
  function update(dt) {
    game.time += dt;
    game.speed = Math.min(CFG.SPEED_MAX, game.speed + CFG.SPEED_ACCEL * dt);
    const dx = game.speed * dt;
    game.distance += dx;
    game.score += dx * CFG.SCORE_RATE;

    if (game.score >= game.nextMilestone) {
      game.nextMilestone += CFG.MILESTONE;
      Sound.point();
      ui.score.classList.remove('flash'); void ui.score.offsetWidth; ui.score.classList.add('flash');
    }

    player.update(dt);

    game.gapLeft -= dx;
    if (game.gapLeft <= 0) {
      const o = spawnObstacle();
      game.gapLeft = nextGap(obstacleSprite(o).pw);
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.t += dt;
      o.x -= dx + o.extraV * dt;
      if (o.fly) o.y = o.baseY + Math.sin(o.t * 5) * 2;
      if (o.x + obstacleSprite(o).pw < -20) obstacles.splice(i, 1);
    }

    const ps = player.sprite;
    for (const o of obstacles) {
      if (pixelCollide(ps, player.x, player.y, obstacleSprite(o), o.x, o.y)) { gameOver(); return; }
    }

    updateHud();
  }

  // ===================================================================
  // 6. Game flow
  // ===================================================================
  function pad(n) { return String(Math.floor(n)).padStart(5, '0'); }
  let lastShownScore = -1;
  function updateHud() {
    const s = Math.floor(game.score);
    if (s !== lastShownScore) { ui.score.textContent = pad(s); lastShownScore = s; }
  }
  function updateHi() { ui.hi.textContent = 'HI ' + pad(game.hi); }

  function showOverlay(title, subHtml, { badge = false, restart = false } = {}) {
    ui.title.textContent = title;
    ui.sub.innerHTML = subHtml;
    ui.badge.hidden = !badge;
    ui.restart.hidden = !restart;
    ui.overlay.classList.remove('hidden');
  }
  const hideOverlay = () => ui.overlay.classList.add('hidden');

  function resetWorld() {
    game.speed = CFG.SPEED_START;
    game.score = 0;
    game.distance = 0;
    game.time = 0;
    game.gapLeft = viewW * 0.6;
    game.nextMilestone = CFG.MILESTONE;
    game.newBest = false;
    game.shake = 0;
    obstacles.length = 0;
    particles.length = 0;
    player.reset();
    lastShownScore = -1;
    updateHud();
  }

  function start() {
    resetWorld();
    game.state = 'running';
    hideOverlay();
  }

  function pause() {
    if (game.state !== 'running') return;
    game.state = 'paused';
    showOverlay('PAUSED', 'Press <kbd>P</kbd> or tap to resume');
  }
  function resume() {
    if (game.state !== 'paused') return;
    game.state = 'running';
    input.jumpHeld = false;
    hideOverlay();
  }
  const togglePause = () => (game.state === 'running' ? pause() : resume());

  function gameOver() {
    game.state = 'over';
    game.overAt = performance.now();
    player.dead = true;
    game.shake = 0.35;
    Sound.hit();
    burst(player.x + 22, player.y + 20, 16, '#ffe066', -320, 60);
    burst(player.x + 22, player.y + 20, 10, '#e8574a', -260, 30);
    const final = Math.floor(game.score);
    if (final > game.hi) {
      game.hi = final;
      game.newBest = true;
      store.set(CFG.STORAGE_HI, final);
      updateHi();
    }
    updateHud();
    showOverlay('GAME OVER', 'Press <kbd>Space</kbd> or tap to retry', { badge: game.newBest, restart: true });
  }

  function restart() {
    if (game.state !== 'over') return;
    if (performance.now() - game.overAt < CFG.RESTART_DELAY) return;
    start();
  }

  // ===================================================================
  // 7. Input
  // ===================================================================
  function pressJump() {
    Sound.init();
    switch (game.state) {
      case 'ready': start(); break;
      case 'paused': resume(); return;
      case 'over': restart(); if (game.state !== 'running') return; break;
    }
    input.jumpHeld = true;
    player.requestJump();
  }
  const releaseJump = () => { input.jumpHeld = false; };

  const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
  const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return; // let buttons work
    if (JUMP_KEYS.has(e.code)) { e.preventDefault(); if (!e.repeat) pressJump(); }
    else if (DOWN_KEYS.has(e.code)) { e.preventDefault(); input.downHeld = true; }
    else if (e.code === 'Enter' && game.state === 'over') restart();
    else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    else if (e.code === 'KeyM') toggleMute();
  });
  window.addEventListener('keyup', (e) => {
    if (JUMP_KEYS.has(e.code)) releaseJump();
    else if (DOWN_KEYS.has(e.code)) input.downHeld = false;
  });

  // Pointer events cover mouse, touch and pen with one code path.
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    pressJump();
  });
  window.addEventListener('pointerup', releaseJump);
  window.addEventListener('pointercancel', releaseJump);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  // iOS Safari specifics:
  //  - touchend is a guaranteed "user activation" for unlocking WebAudio.
  //  - stop pinch-zoom / double-tap zoom / long-press magnifier on the game.
  //  - non-passive touchstart lets preventDefault() suppress the delayed mouse/click emulation.
  window.addEventListener('touchend', () => Sound.init(), { passive: true });
  stage.addEventListener('touchstart', (e) => { if (!e.target.closest('button')) e.preventDefault(); }, { passive: false });
  stage.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  // Returning to the tab (iOS suspends audio in background).
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Sound.ctx) Sound.ctx.resume().catch(() => {}); });

  function toggleMute() {
    Sound.init();
    Sound.setMuted(!Sound.muted);
    syncMuteButton();
  }
  function syncMuteButton() {
    ui.mute.setAttribute('aria-pressed', String(Sound.muted));
    ui.mute.setAttribute('aria-label', Sound.muted ? 'Unmute sound' : 'Mute sound');
  }
  ui.mute.addEventListener('click', (e) => { toggleMute(); e.currentTarget.blur(); });
  ui.pause.addEventListener('click', (e) => { if (game.state === 'running' || game.state === 'paused') togglePause(); e.currentTarget.blur(); });
  ui.restart.addEventListener('click', () => { Sound.init(); restart(); });

  // Auto-pause when the tab/app loses focus.
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);

  // ===================================================================
  // 8. Rendering
  // ===================================================================
  const SKY = {
    dayTop: '#6ec6ff', dayBot: '#d4f1ff', nightTop: '#0d1030', nightBot: '#3a2f6b',
    farDay: '#9fb7e0', farNight: '#2a2a5a',
    nearDay: '#5fae7a', nearNight: '#1f3d45',
    treeDay: '#2f7a55', treeNight: '#122a30',
    groundDay: '#d9a86c', groundNight: '#5b4568',
    dirtDay: '#b9834f', dirtNight: '#3f2f4d',
  };

  function nightAmount() {
    // 0 = midday, 1 = midnight; eased so dusk/dawn are brief-ish.
    const c = (1 - Math.cos((game.score / CFG.DAY_LENGTH) * Math.PI * 2)) / 2;
    return clamp((c - 0.25) * 2, 0, 1);
  }

  // Blocky silhouette from summed sines, quantized to a pixel grid.
  function drawRidge(offset, baseY, amp, freqs, color, step) {
    ctx.fillStyle = color;
    const start = -((offset % step) + step) % step;
    for (let sx = start; sx < viewW + step; sx += step) {
      const wx = sx + offset;
      let h = 0;
      for (const [f, a, p] of freqs) h += Math.sin(wx * f + p) * a;
      const top = Math.round((baseY - amp * (h + 1)) / step) * step;
      ctx.fillRect(sx, top, step + 1, CFG.GROUND_Y - top); // +1 hides seams at fractional scales
    }
  }

  function drawPixelCircle(cx, cy, r, color) {
    ctx.fillStyle = color;
    for (let y = -r; y <= r; y += 3) {
      const w = Math.round(Math.sqrt(r * r - y * y) / 3) * 3;
      ctx.fillRect(cx - w, cy + y, w * 2, 3);
    }
  }

  function drawCloud(x, y, s) {
    ctx.fillRect(x + 3 * s, y, 6 * s, 2 * s);
    ctx.fillRect(x + s, y + 2 * s, 12 * s, 2 * s);
    ctx.fillRect(x, y + 4 * s, 16 * s, 2 * s);
  }

  function render() {
    const n = nightAmount();
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
    ctx.imageSmoothingEnabled = false;

    if (game.shake > 0) {
      const m = game.shake * 14;
      ctx.translate(Math.round(rand(-m, m)), Math.round(rand(-m, m)));
    }

    const d = game.distance;

    // Sky
    const grad = ctx.createLinearGradient(0, 0, 0, CFG.GROUND_Y);
    grad.addColorStop(0, mix(SKY.dayTop, SKY.nightTop, n));
    grad.addColorStop(1, mix(SKY.dayBot, SKY.nightBot, n));
    ctx.fillStyle = grad;
    ctx.fillRect(-20, -20, viewW + 40, CFG.VIEW_H + 40);

    // Stars (very slow parallax)
    if (n > 0.05) {
      ctx.globalAlpha = n;
      ctx.fillStyle = '#fff6d8';
      const off = d * 0.02, cell = 37;
      for (let i = Math.floor(off / cell); i * cell - off < viewW; i++) {
        if (hash(i) > 0.55) continue;
        const twinkle = hash(i * 7 + (game.time * 2 | 0)) > 0.9 ? 1 : 2;
        ctx.fillRect(Math.round(i * cell - off + hash(i + 99) * cell), Math.round(hash(i + 7) * 130) + 6, twinkle, twinkle);
      }
      ctx.globalAlpha = 1;
    }

    // Sun / moon
    const cx = Math.round(viewW * 0.78);
    if (n < 0.6) { ctx.globalAlpha = 1 - n / 0.6; drawPixelCircle(cx, 52 + n * 60, 18, '#ffe48a'); ctx.globalAlpha = 1; }
    if (n > 0.4) {
      ctx.globalAlpha = (n - 0.4) / 0.6;
      drawPixelCircle(cx, 48, 15, '#f4efe1');
      drawPixelCircle(cx + 7, 42, 12, mix(SKY.dayTop, SKY.nightTop, n));
      ctx.globalAlpha = 1;
    }

    // Clouds
    ctx.fillStyle = n > 0.5 ? 'rgba(200,200,255,0.18)' : 'rgba(255,255,255,0.85)';
    {
      const off = d * 0.08 + game.time * 6, cell = 230;
      for (let i = Math.floor(off / cell) - 1; i * cell - off < viewW + 60; i++) {
        if (hash(i * 3) > 0.7) continue;
        drawCloud(Math.round(i * cell - off + hash(i) * 120), 20 + Math.round(hash(i + 5) * 60), 3);
      }
    }

    // Far mountains & near hills
    drawRidge(d * 0.15, 150, 30, [[0.011, 0.6, 0], [0.027, 0.3, 1.7], [0.061, 0.1, 4]], mix(SKY.farDay, SKY.farNight, n), 6);
    drawRidge(d * 0.4, 196, 14, [[0.019, 0.6, 2], [0.043, 0.4, 0.5]], mix(SKY.nearDay, SKY.nearNight, n), 4);

    // Pixel pines on the hills (same parallax as hills)
    {
      ctx.fillStyle = mix(SKY.treeDay, SKY.treeNight, n);
      const off = d * 0.4, cell = 70;
      for (let i = Math.floor(off / cell) - 1; i * cell - off < viewW + cell; i++) {
        if (hash(i + 1234) > 0.45) continue;
        const x = Math.round(i * cell - off + hash(i + 77) * 40);
        const h = 4 + (hash(i + 3) * 4 | 0);
        const base = 206;
        for (let k = 0; k < h; k++) {
          const w = (Math.floor((h - k) / 1.6) + 1) * 3;
          ctx.fillRect(x - w + 3, base - k * 4 - 4, w * 2, 4);
        }
        ctx.fillRect(x, base, 6, CFG.GROUND_Y - base);
      }
    }

    // Ground
    ctx.fillStyle = mix(SKY.groundDay, SKY.groundNight, n);
    ctx.fillRect(-20, CFG.GROUND_Y, viewW + 40, CFG.VIEW_H - CFG.GROUND_Y + 20);
    ctx.fillStyle = '#1d1b2e';
    ctx.fillRect(-20, CFG.GROUND_Y, viewW + 40, 3);
    ctx.fillStyle = mix(SKY.dirtDay, SKY.dirtNight, n);
    {
      const cell = 22;
      for (let i = Math.floor(d / cell); i * cell - d < viewW + cell; i++) {
        const h = hash(i);
        const x = Math.round(i * cell - d + h * 10);
        if (h < 0.5) ctx.fillRect(x, CFG.GROUND_Y + 8 + (hash(i + 1) * 22 | 0), h < 0.2 ? 9 : 3, 3);
      }
    }

    // Obstacles
    for (const o of obstacles) {
      const s = obstacleSprite(o);
      if (!o.fly) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(Math.round(o.x) + 3, CFG.GROUND_Y + 3, s.pw - 6, 3); }
      ctx.drawImage(s.canvas, Math.round(o.x), Math.round(o.y), s.pw, s.ph);
    }

    // Player shadow shrinks with height
    const air = clamp((player.groundTop - player.y) / 140, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    const sw = Math.round(30 * (1 - air * 0.6));
    ctx.fillRect(Math.round(player.x + 21 - sw / 2), CFG.GROUND_Y + 3, sw, 3);

    const ps = player.sprite;
    ctx.drawImage(ps.canvas, Math.round(player.x), Math.round(player.y), ps.pw, ps.ph);

    // Particles
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // ===================================================================
  // 9. Layout & main loop
  // ===================================================================
  // The world is always VIEW_H tall; its width follows the screen's aspect
  // ratio (clamped) so phones see a little less ahead but sprites stay big.
  function layout() {
    const cssW = stage.clientWidth;
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    // Leave room for the header/help; on short landscape phones the game takes most of the screen.
    let cssH = Math.min(Math.max(cssW / 2.6, 200), Math.max(150, vh - (vh < 480 ? 70 : 140)));
    viewW = clamp(Math.round(CFG.VIEW_H * cssW / cssH), 420, 1100);
    cssH = cssW * CFG.VIEW_H / viewW;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    renderScale = canvas.width / viewW;
    render();
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 250)); // iOS reports sizes late
  if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); // clamp after tab switches
    last = now;
    if (game.state === 'running') {
      acc += dt;
      while (acc >= CFG.STEP) {
        update(CFG.STEP);
        acc -= CFG.STEP;
        if (game.state !== 'running') { acc = 0; break; }
      }
    } else if (game.state !== 'paused') {
      game.time += dt;     // idle animation on ready / game-over screens
    }
    if (game.state !== 'paused') {
      updateParticles(dt);
      game.shake = Math.max(0, game.shake - dt);
    }
    render();
    requestAnimationFrame(frame);
  }

  // Boot
  syncMuteButton();
  updateHi();
  resetWorld();
  layout();
  requestAnimationFrame(frame);

  // Small hook for automated tests / debugging in the console.
  window.__boltRun = {
    CFG, SPR, game, player, obstacles, input,
    pixelCollide, spawnObstacle, update, pressJump, releaseJump, togglePause, restart,
    get viewW() { return viewW; },
  };
})();
