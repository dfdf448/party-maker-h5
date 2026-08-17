(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const loading = document.querySelector('#loading');
  const ctx = canvas.getContext('2d');
  const W = 420;
  const H = 760;
  const WORLD_W = 1640;
  const FLOOR_Y = 570;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.scale(DPR, DPR);

  const CONFIG = {
    buildSeconds: 18,
    raceSeconds: 30,
    rounds: 3,
    gravity: 1420,
    runSpeed: 235,
    jumpSpeed: 520,
    respawnDelay: 0.72,
  };

  const images = {};
  const imageSources = {
    idle: 'assets/dino-idle.png',
    run: 'assets/dino-run.png',
    jump: 'assets/dino-jump.png',
    stunned: 'assets/dino-stunned.png',
  };

  const PIECES = {
    platform: { name: '2×1平台', color: '#14c8ed', w: 92, h: 24 },
    spring: { name: '弹簧', color: '#ffcf1b', w: 46, h: 36 },
    spikes: { name: '地刺', color: '#ffcf1b', w: 70, h: 26 },
    moving: { name: '移动平台', color: '#19c8ed', w: 96, h: 22 },
  };

  const basePlatforms = [
    { x: 0, y: 535, w: 255, h: 250, castle: true },
    { x: 330, y: 505, w: 105, h: 22, orange: true },
    { x: 475, y: 570, w: 185, h: 220, castle: true },
    { x: 705, y: 510, w: 115, h: 22, orange: true },
    { x: 875, y: 570, w: 180, h: 220, castle: true },
    { x: 1090, y: 510, w: 95, h: 22, orange: true },
    { x: 1200, y: 455, w: 88, h: 22, orange: true },
    { x: 1320, y: 400, w: 320, h: 390, castle: true, finish: true },
  ];

  const state = {
    mode: 'build',
    round: 1,
    score: 0,
    buildTime: CONFIG.buildSeconds,
    raceTime: CONFIG.raceSeconds,
    resultTime: 0,
    resultTitle: '',
    resultSub: '',
    cameraX: 0,
    buildCameraX: 265,
    placed: [],
    selected: null,
    dragging: null,
    viewDrag: null,
    pointerControls: new Map(),
    keys: new Set(),
    particles: [],
    toast: { text: '拖动一张机关卡牌到关卡里', time: 3.2 },
    lastTime: performance.now(),
    soundOn: localStorage.getItem('party-maker-sound') === 'on',
    buildElapsed: 0,
    botClock: 0,
    botBuild: [],
    humanReady: false,
    startCountdown: 0,
    lastManualPan: -99,
    highScore: Number(localStorage.getItem('party-maker-high-score') || 0),
    player: null,
    bots: [],
  };

  function freshPlayer() {
    return {
      x: 82, y: 480, prevY: 480, w: 35, h: 49,
      vx: 0, vy: 0, grounded: false, coyote: 0,
      face: 1, dead: false, respawn: 0, invincible: 0,
      finished: false, deaths: 0, anim: 0,
    };
  }

  function resetBots() {
    state.bots = [
      { name: '团冬', color: '#ff4861', x: 60, speed: 87, seed: .4, finished: false },
      { name: '肖亚兴', color: '#ffb51c', x: 44, speed: 73, seed: 1.8, finished: false },
      { name: '伦敦', color: '#8f68ee', x: 28, speed: 65, seed: 3.2, finished: false },
    ];
  }

  function loadAssets() {
    return Promise.all(Object.entries(imageSources).map(([key, src]) => new Promise(resolve => {
      const img = new Image();
      img.onload = () => { images[key] = img; resolve(); };
      img.onerror = resolve;
      img.src = src;
    })));
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }
  function text(t, x, y, size, color = '#fff', align = 'center', weight = 800) {
    ctx.save();
    ctx.font = `${weight} ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
    ctx.restore();
  }

  let audioCtx;
  function sound(kind) {
    if (!state.soundOn) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      const profiles = {
        click:  { notes:[520], type:'sine',     length:.05, gain:.014 },
        jump:   { notes:[330,440], type:'triangle', length:.09, gain:.018 },
        spring: { notes:[390,585,780], type:'sine', length:.13, gain:.022 },
        hurt:   { notes:[220,165], type:'triangle', length:.16, gain:.021 },
        finish: { notes:[523,659,784,1047], type:'sine', length:.28, gain:.022 },
        place:  { notes:[440,660], type:'triangle', length:.11, gain:.016 },
      };
      const profile = profiles[kind] || profiles.click;
      profile.notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();
        const start = now + i * .045;
        osc.type = profile.type;
        osc.frequency.setValueAtTime(freq, start);
        filter.type = 'lowpass'; filter.frequency.value = 1800;
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(profile.gain, start + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, start + profile.length);
        osc.connect(filter).connect(gain).connect(audioCtx.destination);
        osc.start(start); osc.stop(start + profile.length + .02);
      });
    } catch (_) { /* Audio is optional. */ }
  }

  function toggleSound() {
    state.soundOn = !state.soundOn;
    localStorage.setItem('party-maker-sound', state.soundOn ? 'on' : 'off');
    if (state.soundOn) sound('click');
    state.toast = { text: state.soundOn ? '柔和音效已开启' : '音效已关闭', time: 1.3 };
  }

  function inventory() {
    if (state.round === 1) return ['platform', 'spring', 'spikes'];
    if (state.round === 2) return ['moving', 'platform', 'spikes'];
    return ['spring', 'moving', 'platform'];
  }

  function focusForRound() {
    return [0, 300, 720, 1040][state.round] || 1040;
  }

  function startBuild() {
    state.mode = 'build';
    state.buildTime = CONFIG.buildSeconds;
    state.buildCameraX = focusForRound();
    state.selected = null;
    state.dragging = null;
    state.viewDrag = null;
    state.buildElapsed = 0;
    state.botClock = 0;
    state.humanReady = false;
    state.startCountdown = 0;
    state.botBuild = createBotPlans();
    state.toast = { text: `第${state.round}轮：给所有人添点“惊喜”`, time: 2.4 };
    state.pointerControls.clear();
  }

  function createBotPlans() {
    const layouts = {
      1: [
        { type:'spring', x:430, y:440 },
        { type:'spikes', x:545, y:544 },
        { type:'platform', x:675, y:415 },
      ],
      2: [
        { type:'moving', x:790, y:405 },
        { type:'spikes', x:930, y:544 },
        { type:'spring', x:1110, y:470 },
      ],
      3: [
        { type:'platform', x:1135, y:345 },
        { type:'spring', x:1240, y:408 },
        { type:'spikes', x:1400, y:374 },
      ],
    };
    const names = ['团冬','肖亚兴','伦敦'];
    const colors = ['#ff4861','#ffb51c','#8f68ee'];
    return layouts[state.round].map((p, i) => ({
      ...p, name:names[i], color:colors[i], start:1.7 + i * 2.05,
      duration:1.05, placed:false, index:i,
    }));
  }

  function startRace() {
    if (state.mode !== 'build') return;
    if (!state.selected) {
      const type = inventory()[0];
      const spec = PIECES[type];
      state.selected = { type, x: state.buildCameraX + 250, y: 430, w: spec.w, h: spec.h };
      state.placed.push({ ...state.selected });
    }
    state.humanReady = true;
    state.toast = { text: '已确认，等待另外三位玩家放置…', time: 2.2 };
    sound('click');
  }

  function beginRace() {
    if (state.mode !== 'build') return;
    state.mode = 'race';
    state.raceTime = CONFIG.raceSeconds;
    state.cameraX = 0;
    state.player = freshPlayer();
    resetBots();
    state.toast = { text: '冲向右侧终点！小心大家放下的机关', time: 2.8 };
    state.pointerControls.clear();
  }

  function finishRace(success, reason = '') {
    if (state.mode !== 'race') return;
    state.mode = 'result';
    state.resultTime = 2.6;
    if (success) {
      const bonus = 100 + Math.ceil(state.raceTime) * 4;
      state.score += bonus;
      state.resultTitle = '抵达终点！';
      state.resultSub = `本轮 +${bonus} 星`;
      burst(W / 2, H / 2 - 50, '#ffe029', 38);
      sound('finish');
    } else {
      state.resultTitle = '本轮时间到';
      state.resultSub = reason || '下一轮继续制造机会';
      sound('hurt');
    }
  }

  function nextRound() {
    if (state.round >= CONFIG.rounds) {
      state.mode = 'complete';
      state.highScore = Math.max(state.highScore, state.score);
      localStorage.setItem('party-maker-high-score', String(state.highScore));
      burst(W / 2, 280, '#ffda18', 60);
    } else {
      state.round += 1;
      startBuild();
    }
  }

  function restart() {
    state.round = 1;
    state.score = 0;
    state.placed = [];
    state.player = freshPlayer();
    resetBots();
    startBuild();
  }

  function death(reason = '飞出了边界！') {
    const p = state.player;
    if (!p || p.dead || p.invincible > 0) return;
    p.dead = true;
    p.respawn = CONFIG.respawnDelay;
    p.deaths += 1;
    p.vx = 0; p.vy = 0;
    state.toast = { text: `小恐龙${reason}`, time: 1.4 };
    burst(p.x - state.cameraX + p.w / 2, p.y + p.h / 2, '#ff4b55', 18);
    sound('hurt');
  }

  function respawn() {
    const p = state.player;
    p.x = 82; p.y = 472; p.prevY = p.y;
    p.vx = 0; p.vy = 0; p.dead = false; p.invincible = 1.2;
  }

  function getPlatforms(time, animateMoving = state.mode === 'race') {
    const all = basePlatforms.map(p => ({ ...p }));
    for (const piece of state.placed) {
      if (piece.type === 'platform') all.push({ ...piece, orange: false });
      if (piece.type === 'moving') {
        const offset = animateMoving ? Math.sin(time * 1.7 + (piece.phase || 0)) * 54 : 0;
        all.push({ ...piece, y: piece.y + offset, moving: true, animateMoving });
      }
    }
    return all;
  }

  function inputAxis() {
    const leftKey = state.keys.has('ArrowLeft') || state.keys.has('KeyA');
    const rightKey = state.keys.has('ArrowRight') || state.keys.has('KeyD');
    let leftTouch = false, rightTouch = false;
    for (const type of state.pointerControls.values()) {
      if (type === 'left') leftTouch = true;
      if (type === 'right') rightTouch = true;
    }
    return (rightKey || rightTouch ? 1 : 0) - (leftKey || leftTouch ? 1 : 0);
  }

  let jumpBuffer = 0;
  function queueJump() { jumpBuffer = .14; }

  function placeBotPlan(plan) {
    const spec = PIECES[plan.type];
    const candidates = [
      { x:plan.x, y:plan.y },
      { x:plan.x + 42, y:plan.y - 70 },
      { x:plan.x - 56, y:plan.y - 90 },
    ];
    const target = candidates.find(c => !state.placed.some(p => rects(
      { x:c.x-10, y:c.y-10, w:spec.w+20, h:spec.h+20 }, p
    ))) || candidates[1];
    plan.x = target.x; plan.y = target.y; plan.placed = true;
    state.placed.push({ type:plan.type, x:plan.x, y:plan.y, w:spec.w, h:spec.h,
      phase:plan.index*1.7, bot:true, botName:plan.name, botColor:plan.color });
    state.toast = { text:`${plan.name} 放置了「${spec.name}」`, time:1.35 };
    burst(plan.x - state.buildCameraX + spec.w/2, plan.y + spec.h/2, plan.color, 11);
    sound('place');
  }

  function updateBuild(dt, now) {
    state.buildTime -= dt;
    state.buildElapsed += dt;
    state.botClock += dt * (state.humanReady ? 2.35 : 1);

    let pan = 0;
    if (state.keys.has('ArrowLeft') || state.keys.has('KeyA')) pan -= 1;
    if (state.keys.has('ArrowRight') || state.keys.has('KeyD')) pan += 1;
    for (const control of state.pointerControls.values()) {
      if (control === 'panLeft') pan -= 1;
      if (control === 'panRight') pan += 1;
    }
    if (pan) {
      state.buildCameraX = clamp(state.buildCameraX + pan * 340 * dt, 0, WORLD_W - W);
      state.lastManualPan = now;
    }

    for (const plan of state.botBuild) {
      if (!plan.placed && state.botClock >= plan.start + plan.duration) placeBotPlan(plan);
    }
    const active = state.botBuild.find(p => !p.placed && state.botClock >= p.start && state.botClock < p.start + p.duration);
    if (active && now - state.lastManualPan > 2.2) {
      const target = clamp(active.x - W * .55, 0, WORLD_W - W);
      state.buildCameraX = lerp(state.buildCameraX, target, 1 - Math.pow(.003, dt));
    }

    if (state.buildTime <= 0 && !state.humanReady) startRace();
    const everyoneReady = state.botBuild.length && state.botBuild.every(p => p.placed);
    if (state.humanReady && everyoneReady) {
      if (state.startCountdown <= 0) state.startCountdown = 1.05;
      state.startCountdown -= dt;
      if (state.startCountdown <= .001) beginRace();
    }
  }

  function updateRace(dt, time) {
    const p = state.player;
    state.raceTime -= dt;
    if (state.raceTime <= 0) return finishRace(false);

    for (const bot of state.bots) {
      if (bot.finished) continue;
      bot.x += bot.speed * dt * (1 + state.round * .08);
      if (bot.x > 1530) bot.finished = true;
    }

    if (p.dead) {
      p.respawn -= dt;
      if (p.respawn <= 0) respawn();
      return;
    }
    p.invincible = Math.max(0, p.invincible - dt);
    p.prevY = p.y;
    p.anim += dt;

    const axis = inputAxis();
    const desired = axis * CONFIG.runSpeed;
    const accel = p.grounded ? 1550 : 780;
    p.vx += clamp(desired - p.vx, -accel * dt, accel * dt);
    if (!axis && p.grounded) {
      p.vx *= Math.pow(.00000001, dt);
      if (Math.abs(p.vx) < 8) p.vx = 0;
    }
    if (axis) p.face = axis;

    p.coyote = p.grounded ? .1 : Math.max(0, p.coyote - dt);
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    if (jumpBuffer > 0 && p.coyote > 0) {
      p.vy = -CONFIG.jumpSpeed;
      p.grounded = false;
      p.coyote = 0; jumpBuffer = 0;
      burst(p.x - state.cameraX + p.w / 2, p.y + p.h, '#ffffff', 7);
      sound('jump');
    }
    p.vy += CONFIG.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = Math.max(0, p.x);
    p.grounded = false;

    const platforms = getPlatforms(time);
    for (const plat of platforms) {
      const prevBottom = p.prevY + p.h;
      const nowBottom = p.y + p.h;
      const overlapsX = p.x + p.w > plat.x + 4 && p.x < plat.x + plat.w - 4;
      if (overlapsX && p.vy >= 0 && prevBottom <= plat.y + 8 && nowBottom >= plat.y) {
        p.y = plat.y - p.h;
        p.vy = 0;
        p.grounded = true;
      }
    }

    for (const piece of state.placed) {
      if (piece.type === 'spikes' && rects(p, { x: piece.x + 6, y: piece.y + 5, w: piece.w - 12, h: piece.h - 4 })) {
        death('撞上了地刺！');
      }
      if (piece.type === 'spring' && p.vy >= 0 && rects(p, { x: piece.x, y: piece.y, w: piece.w, h: piece.h })) {
        p.y = piece.y - p.h;
        p.vy = -720;
        p.grounded = false;
        burst(p.x - state.cameraX + p.w / 2, p.y + p.h, '#ffdc22', 12);
        sound('spring');
      }
    }

    if (p.y > H + 120) death('飞出了边界！');
    if (p.x > 1500 && p.y + p.h < 430) {
      p.finished = true;
      finishRace(true);
    }

    const targetCamera = clamp(p.x - 130, 0, WORLD_W - W);
    state.cameraX = lerp(state.cameraX, targetCamera, 1 - Math.pow(.001, dt));
  }

  function update(dt, now) {
    dt = Math.min(dt, .034);
    if (state.toast.time > 0) state.toast.time -= dt;
    if (state.mode === 'build') {
      updateBuild(dt, now);
    } else if (state.mode === 'race') {
      updateRace(dt, now);
    } else if (state.mode === 'result') {
      state.resultTime -= dt;
      if (state.resultTime <= 0) nextRound();
    }

    for (const p of state.particles) {
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 450 * dt; p.rot += p.vr * dt;
    }
    state.particles = state.particles.filter(p => p.life > 0);
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 45 + Math.random() * 210;
      state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 50,
        life: .45 + Math.random() * .7, max: 1, color, size: 3 + Math.random() * 6, rot: 0, vr: -5 + Math.random() * 10 });
    }
  }

  function drawSky(build = false) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#19b9d8'); g.addColorStop(.7, '#9ae5e8'); g.addColorStop(1, '#d6f4e3');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.save();
    const drift = (performance.now() * .006) % 620;
    [[50,150,1.1],[280,105,.72],[420,255,1.25],[185,335,.85]].forEach(([x,y,s], i) => {
      x = ((x - drift * (i % 2 ? .08 : .04) + 80) % 600) - 80;
      drawCloud(x, y, s);
    });
    ctx.restore();

    ctx.fillStyle = 'rgba(52,99,103,.12)';
    ctx.beginPath(); ctx.moveTo(0, 640); ctx.lineTo(100, 530); ctx.lineTo(180, 610); ctx.lineTo(280, 500); ctx.lineTo(420, 625); ctx.lineTo(420,760); ctx.lineTo(0,760); ctx.fill();

    if (build) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.26)'; ctx.lineWidth = 1;
      for (let x = 0; x <= W; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 615); ctx.stroke(); }
      for (let y = 0; y <= 615; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.lineWidth = 2;
      for (let x = 0; x <= W; x += 112) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 615); ctx.stroke(); }
      for (let y = 0; y <= 615; y += 112) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.restore();
    }
  }

  function drawCloud(x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    ctx.beginPath();
    ctx.arc(0, 18, 30, 0, Math.PI * 2); ctx.arc(34, 0, 38, 0, Math.PI * 2); ctx.arc(74, 18, 27, 0, Math.PI * 2);
    ctx.fill(); ctx.fillRect(-2, 17, 78, 28);
    ctx.restore();
  }

  function drawCastle(x, y, w, h) {
    ctx.save();
    ctx.fillStyle = '#3d4b4e'; ctx.fillRect(x, y, w, h);
    const bw = 52, bh = 32;
    for (let row = 0; row < Math.ceil(h / bh); row++) {
      for (let col = -1; col < Math.ceil(w / bw) + 1; col++) {
        const ox = row % 2 ? bw / 2 : 0;
        const bx = x + col * bw + ox, by = y + row * bh;
        ctx.fillStyle = (row + col) % 3 === 0 ? '#586466' : '#4a5759';
        roundedRect(bx + 2, by + 2, bw - 4, bh - 4, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(19,30,33,.38)'; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    ctx.fillStyle = '#f8fbf4';
    ctx.beginPath(); ctx.moveTo(x, y+4); ctx.bezierCurveTo(x+25,y-7,x+44,y+8,x+68,y); ctx.bezierCurveTo(x+92,y-6,x+114,y+9,x+142,y); ctx.lineTo(x+w,y); ctx.lineTo(x+w,y+13); ctx.lineTo(x,y+13); ctx.fill();
    ctx.fillStyle = '#ff3940'; ctx.fillRect(x + 26, y + 30, 36, Math.min(140,h*.45));
    ctx.beginPath(); ctx.moveTo(x+26,y+155); ctx.lineTo(x+44,y+137); ctx.lineTo(x+62,y+155); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawPlatform(p, cam, now) {
    const x = p.x - cam, y = p.y;
    if (x + p.w < -20 || x > W + 20) return;
    if (p.castle) return drawCastle(x, y, p.w, p.h);
    ctx.save();
    if (p.moving) {
      ctx.strokeStyle = '#5b5960'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + p.w/2, y); ctx.lineTo(x + p.w/2 + 35, y - 120); ctx.stroke();
      ctx.fillStyle = '#ef4a4f'; ctx.fillRect(x+p.w/2+31,y-124,8,8);
    }
    ctx.fillStyle = p.orange ? '#ff9d1c' : '#92999a';
    roundedRect(x, y, p.w, p.h, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)'; roundedRect(x+5,y+4,p.w-10,5,3); ctx.fill();
    ctx.strokeStyle = p.orange ? '#dd7615' : '#737a7c'; ctx.lineWidth = 2; roundedRect(x,y,p.w,p.h,7); ctx.stroke();
    ctx.restore();
  }

  function drawPiece(piece, cam, alpha = 1) {
    const x = piece.x - cam, y = piece.y;
    const spec = PIECES[piece.type];
    ctx.save(); ctx.globalAlpha = alpha;
    if (piece.type === 'platform') {
      ctx.fillStyle = '#92999a'; roundedRect(x,y,piece.w,piece.h,7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.25)'; roundedRect(x+5,y+4,piece.w-10,5,3); ctx.fill();
    } else if (piece.type === 'spikes') {
      ctx.fillStyle = '#5a5d63'; ctx.fillRect(x,y+piece.h-7,piece.w,7);
      ctx.fillStyle = '#e8edf0';
      const n = 5, sw = piece.w / n;
      for (let i=0;i<n;i++) { ctx.beginPath(); ctx.moveTo(x+i*sw,y+piece.h-7); ctx.lineTo(x+i*sw+sw/2,y); ctx.lineTo(x+(i+1)*sw,y+piece.h-7); ctx.fill(); }
    } else if (piece.type === 'spring') {
      ctx.fillStyle = '#ffd41b'; ctx.fillRect(x,y,piece.w,6); ctx.fillRect(x,y+piece.h-6,piece.w,6);
      ctx.strokeStyle = '#b83262'; ctx.lineWidth = 4; ctx.beginPath();
      ctx.moveTo(x+7,y+7); ctx.lineTo(x+piece.w-7,y+13); ctx.lineTo(x+7,y+20); ctx.lineTo(x+piece.w-7,y+29); ctx.stroke();
    } else if (piece.type === 'moving') {
      const py = y + (state.mode === 'race' ? Math.sin(performance.now()*.0017 + (piece.phase||0))*54 : 0);
      ctx.strokeStyle='#5b5960';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x+piece.w/2,py);ctx.lineTo(x+piece.w/2+35,py-120);ctx.stroke();
      ctx.fillStyle='#ff9d1c';roundedRect(x,py,piece.w,piece.h,7);ctx.fill();
    }
    if (piece.bot) {
      ctx.fillStyle = piece.botColor || 'rgba(255,66,92,.9)'; roundedRect(x+piece.w-16,y-11,26,20,6);ctx.fill();
      text((piece.botName || '机').slice(0,1),x+piece.w-3,y-1,11,'#fff');
    }
    ctx.restore();
  }

  function drawWorld(cam, build, now) {
    drawSky(build);
    for (const p of getPlatforms(now, !build)) drawPlatform(p, cam, now);
    for (const p of state.placed) if (p.type === 'spikes' || p.type === 'spring') drawPiece(p, cam);
    if (!build) {
      drawFinish(cam);
      drawBots(cam, now);
      drawPlayer(cam);
    }
  }

  function drawFinish(cam) {
    const x = 1488 - cam;
    if (x < -80 || x > W + 80) return;
    ctx.save();
    ctx.fillStyle = '#eef4ef'; ctx.fillRect(x, 305, 8, 95);
    ctx.fillStyle = '#ff3f54'; ctx.beginPath(); ctx.moveTo(x+8,310); ctx.lineTo(x+62,326); ctx.lineTo(x+8,344); ctx.closePath(); ctx.fill();
    text('终点', x+31, 327, 14, '#fff');
    ctx.restore();
  }

  function drawDino(img, x, y, w, h, face = 1, alpha = 1) {
    if (!img) return;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(x + (face < 0 ? w : 0), y);
    ctx.scale(face < 0 ? -1 : 1, 1);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.restore();
  }

  function drawPlayer(cam) {
    const p = state.player;
    if (!p || p.dead) return;
    const sx = p.x - cam - 13, sy = p.y - 16;
    const img = !p.grounded ? images.jump : Math.abs(p.vx) > 30 ? images.run : images.idle;
    const bob = p.grounded && Math.abs(p.vx)>30 ? Math.sin(p.anim*15)*2 : 0;
    drawDino(img, sx, sy+bob, 61, 68, p.face, p.invincible > 0 && Math.floor(p.invincible*12)%2 ? .35 : 1);
    ctx.fillStyle = '#ffe326'; ctx.beginPath(); ctx.moveTo(sx+31,sy-8);ctx.lineTo(sx+20,sy-27);ctx.lineTo(sx+42,sy-27);ctx.closePath();ctx.fill();
  }

  function drawBots(cam, now) {
    for (const bot of state.bots) {
      if (bot.finished) continue;
      const x = bot.x - cam;
      if (x < -70 || x > W+70) continue;
      const ground = bot.x < 255 ? 535 : bot.x < 475 ? 505 : bot.x < 660 ? 570 : bot.x < 875 ? 510 : bot.x < 1055 ? 570 : bot.x < 1320 ? 490 : 400;
      const hop = Math.max(0, Math.sin(now*2.6 + bot.seed))*42;
      ctx.save(); ctx.globalAlpha=.64; ctx.fillStyle=bot.color; roundedRect(x-3,ground-57-hop,42,42,10);ctx.fill();
      drawDino(images.run,x-6,ground-65-hop,48,54,1,.75);
      ctx.strokeStyle=bot.color;ctx.lineWidth=3;roundedRect(x-4,ground-59-hop,44,44,10);ctx.stroke();ctx.restore();
    }
  }

  function drawHud() {
    ctx.save();
    ctx.fillStyle = 'rgba(13,40,48,.94)'; ctx.beginPath(); ctx.arc(W/2, 22, 48, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#ffda16'; ctx.lineWidth=6; ctx.stroke();
    const seconds = Math.max(0, Math.ceil(state.mode === 'build' ? state.buildTime : state.raceTime));
    text(`第${state.round}轮`,W/2,9,11,'#d7eef1');
    text(String(seconds).padStart(2,'0'),W/2,29,25,'#adfff0');
    text(`共${CONFIG.rounds}轮`,W/2,48,10,'#fff');

    ctx.fillStyle='rgba(8,29,38,.75)';roundedRect(12,12,104,37,12);ctx.fill();
    text(`★ ${state.score}`,27,31,15,'#ffe023','left');
    ctx.fillStyle='rgba(8,29,38,.75)';roundedRect(W-70,12,58,37,12);ctx.fill();
    text(state.soundOn?'声':'静',W-41,31,13,'#fff');
    ctx.restore();
  }

  function drawPlayerRail() {
    const colors=['#31c871','#ff4861','#ffb51c','#8f68ee'];
    for(let i=0;i<4;i++) {
      const y=92+i*37;
      ctx.fillStyle='rgba(12,41,52,.72)';roundedRect(8,y,39,31,7);ctx.fill();
      ctx.strokeStyle=colors[i];ctx.lineWidth=3;roundedRect(8,y,39,31,7);ctx.stroke();
      if(i===0) drawDino(images.idle,11,y+2,28,28,1); else {ctx.fillStyle=colors[i];ctx.beginPath();ctx.arc(27,y+14,8,0,Math.PI*2);ctx.fill();}
      let badge='…', badgeColor='#ff3c52';
      if(i===0&&state.mode==='build'&&state.humanReady){badge='✓';badgeColor='#25c94c';}
      if(i>0&&state.mode==='build'){
        const plan=state.botBuild[i-1];
        if(plan?.placed){badge='✓';badgeColor='#25c94c';}
        else if(plan&&state.botClock>=plan.start){badge='手';badgeColor=plan.color;}
      }
      ctx.fillStyle=badgeColor;roundedRect(35,y+18,18,15,4);ctx.fill();text(badge,44,y+25,9,'#fff');
    }
  }

  function drawBuildNavigator() {
    ctx.save();
    ctx.fillStyle='rgba(10,36,46,.78)';roundedRect(56,580,308,28,10);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.22)';roundedRect(76,591,268,6,3);ctx.fill();
    const thumbW=Math.max(30,268*W/WORLD_W);
    const thumbX=76+(268-thumbW)*state.buildCameraX/(WORLD_W-W);
    ctx.fillStyle='#ffe021';roundedRect(thumbX,587,thumbW,14,7);ctx.fill();
    text('拖动空白处浏览关卡',W/2,573,11,'#173a49');
    ctx.fillStyle='rgba(11,38,48,.72)';roundedRect(5,270,42,118,10);ctx.fill();roundedRect(W-47,270,42,118,10);ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=7;ctx.lineJoin='miter';
    ctx.beginPath();ctx.moveTo(34,300);ctx.lineTo(17,329);ctx.lineTo(34,358);ctx.stroke();
    ctx.beginPath();ctx.moveTo(W-34,300);ctx.lineTo(W-17,329);ctx.lineTo(W-34,358);ctx.stroke();
    ctx.restore();
  }

  function drawBotBuildAction(cam) {
    const active=state.botBuild.find(p=>!p.placed&&state.botClock>=p.start&&state.botClock<p.start+p.duration);
    if(!active)return;
    const spec=PIECES[active.type];
    const raw=clamp((state.botClock-active.start)/active.duration,0,1);
    const t=raw*raw*(3-2*raw);
    const targetX=active.x-cam+spec.w/2;
    const sx=lerp(42,targetX,t), sy=lerp(152+active.index*37,active.y+spec.h/2,t);
    drawPiece({type:active.type,x:sx+cam-spec.w/2,y:sy-spec.h/2,w:spec.w,h:spec.h,phase:active.index},cam,.86);
    ctx.save();ctx.fillStyle='rgba(12,42,53,.9)';roundedRect(98,132,298,39,10);ctx.fill();
    ctx.fillStyle=active.color;ctx.beginPath();ctx.arc(118,151,9,0,Math.PI*2);ctx.fill();
    text(`${active.name} 正在拖动「${spec.name}」`,137,152,13,'#fff','left');ctx.restore();
  }

  function drawBuild() {
    const cam = state.buildCameraX;
    drawWorld(cam, true, performance.now()*.001);
    drawPlayerRail();
    drawBuildNavigator();
    drawBotBuildAction(cam);

    if (state.selected) {
      drawPiece(state.selected, cam, .9);
      ctx.strokeStyle='#6aff8e';ctx.lineWidth=3;ctx.setLineDash([8,5]);roundedRect(state.selected.x-cam-5,state.selected.y-5,state.selected.w+10,state.selected.h+10,8);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=state.humanReady?'#66777c':'#24c643';roundedRect(270,72,125,46,8);ctx.fill();ctx.strokeStyle=state.humanReady?'#43545a':'#0d7f25';ctx.lineWidth=3;ctx.stroke();
      text(state.humanReady?'等待中…':'✓ 确定',333,95,state.humanReady?16:20);
    }

    if (state.dragging) {
      const spec=PIECES[state.dragging.type];
      drawPiece({type:state.dragging.type,x:state.dragging.x+cam-spec.w/2,y:state.dragging.y-spec.h/2,w:spec.w,h:spec.h},cam,.72);
    }

    ctx.fillStyle='rgba(33,52,64,.92)';ctx.fillRect(0,615,W,145);
    text(state.humanReady?'已确认 · 正在等待其他玩家':'拖到网格里 · 所有人的机关都会保留',W/2,633,12,'#d8edf0');
    const cards=inventory();
    cards.forEach((type,i)=>{ctx.save();ctx.globalAlpha=state.humanReady ? .46 : 1;drawCard(type,12+i*136,650,124,96);ctx.restore();});
    drawHud();
  }

  function drawCard(type,x,y,w,h) {
    const spec=PIECES[type];
    ctx.save();
    ctx.fillStyle=spec.color;roundedRect(x,y,w,h,8);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.2)';roundedRect(x+5,y+5,w-10,24,6);ctx.fill();
    const mini={type,x:x+40,y:y+28,w:Math.min(spec.w*.5,58),h:Math.min(spec.h*.7,28)};
    drawPiece(mini,0);
    ctx.fillStyle='rgba(12,34,45,.82)';roundedRect(x+30,y+h-30,w-30,30,0);ctx.fill();
    text(spec.name,x+w-8,y+h-15,14,'#fff','right');
    ctx.restore();
  }

  function drawControls() {
    const y=646;
    ctx.save();
    ctx.fillStyle='rgba(16,28,34,.62)';ctx.fillRect(0,630,W,130);
    controlButton(16,y,78,88,'left'); controlButton(100,y,78,88,'right');
    ctx.fillStyle='rgba(16,28,34,.72)';roundedRect(320,y,84,88,10);ctx.fill();
    ctx.strokeStyle='#1896ff';ctx.lineWidth=11;ctx.lineCap='square';ctx.beginPath();ctx.moveTo(340,y+56);ctx.lineTo(362,y+32);ctx.lineTo(385,y+56);ctx.stroke();
    text('跳跃',362,y+76,12,'#fff');
    ctx.restore();
  }

  function controlButton(x,y,w,h,dir) {
    ctx.fillStyle='rgba(16,28,34,.72)';roundedRect(x,y,w,h,10);ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=9;ctx.lineJoin='miter';ctx.beginPath();
    if(dir==='left'){ctx.moveTo(x+51,y+21);ctx.lineTo(x+28,y+44);ctx.lineTo(x+51,y+67);}
    else{ctx.moveTo(x+27,y+21);ctx.lineTo(x+50,y+44);ctx.lineTo(x+27,y+67);}ctx.stroke();
    text(dir==='left'?'左移':'右移',x+w/2,y+77,11,'#fff');
  }

  function drawRace() {
    drawWorld(state.cameraX,false,performance.now()*.001);
    drawPlayerRail(); drawHud(); drawControls();
  }

  function drawToast() {
    if (state.toast.time <= 0) return;
    const alpha=clamp(state.toast.time/.35,0,1);
    ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle='rgba(16,43,54,.86)';roundedRect(40,78,W-80,43,10);ctx.fill();text(state.toast.text,W/2,100,14);ctx.restore();
  }

  function drawParticles() {
    for(const p of state.particles){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.globalAlpha=clamp(p.life*2,0,1);ctx.fillStyle=p.color;ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size);ctx.restore();}
  }

  function drawResult() {
    drawRace();
    ctx.fillStyle='rgba(7,20,30,.66)';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#fff';roundedRect(42,240,W-84,210,18);ctx.fill();
    ctx.fillStyle='#16bdd7';roundedRect(42,240,W-84,68,18);ctx.fill();ctx.fillRect(42,284,W-84,24);
    text(state.resultTitle,W/2,277,29,'#fff');text(state.resultSub,W/2,350,21,'#173a49');
    text(state.round<CONFIG.rounds?'准备进入下一轮建造…':'正在统计最终得分…',W/2,401,14,'#62757d');
  }

  function drawComplete() {
    drawSky(false);
    drawCastle(34,395,352,365);
    drawDino(images.idle,125,210,170,190,1);
    ctx.fillStyle='rgba(13,40,48,.92)';roundedRect(34,40,352,152,22);ctx.fill();
    text('派对完成！',W/2,79,32,'#ffe021');text(`总得分  ${state.score}`,W/2,127,25);text(`最高纪录  ${state.highScore}`,W/2,163,14,'#b8e8ec');
    ctx.fillStyle='#24c643';roundedRect(78,620,264,66,12);ctx.fill();ctx.strokeStyle='#0b7c25';ctx.lineWidth=4;ctx.stroke();text('再玩一局',W/2,653,24);
  }

  function draw() {
    ctx.clearRect(0,0,W,H);
    if(state.mode==='build') drawBuild();
    else if(state.mode==='race') drawRace();
    else if(state.mode==='result') drawResult();
    else drawComplete();
    drawParticles(); drawToast();
  }

  function pointFromEvent(e) {
    const r=canvas.getBoundingClientRect();
    return {x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};
  }

  function cardAt(x,y) {
    if(y<645) return null;
    const i=Math.floor((x-8)/136);
    return i>=0&&i<3?inventory()[i]:null;
  }

  function validPlacement(type,x,y) {
    const spec=PIECES[type];
    if(y<135||y+spec.h>600) return false;
    const wx=x+state.buildCameraX-spec.w/2;
    if(wx<260||wx+spec.w>WORLD_W-180) return false;
    return !state.placed.some(p=>rects({x:wx-12,y:y-spec.h/2-12,w:spec.w+24,h:spec.h+24},p));
  }

  function commitPlacement(type,x,y) {
    const spec=PIECES[type];
    if(!validPlacement(type,x,y)){state.toast={text:'这里放不下，换个空位试试',time:1.6};sound('hurt');return false;}
    const placed={type,x:Math.round((x+state.buildCameraX-spec.w/2)/14)*14,y:Math.round((y-spec.h/2)/14)*14,w:spec.w,h:spec.h,phase:Math.random()*3};
    if(state.selected){const idx=state.placed.indexOf(state.selected);if(idx>=0)state.placed.splice(idx,1);}
    state.placed.push(placed);state.selected=placed;state.toast={text:`已放置「${spec.name}」，点击确定开跑`,time:2};sound('place');return true;
  }

  function pointerDown(e) {
    canvas.setPointerCapture?.(e.pointerId); canvas.focus();
    const p=pointFromEvent(e);
    if(state.mode==='build'){
      if(p.x>=W-70&&p.y<=55){toggleSound();return;}
      if(!state.humanReady&&state.selected&&p.x>=270&&p.x<=395&&p.y>=72&&p.y<=118){startRace();return;}
      if(p.y>=270&&p.y<=388&&p.x<=52){state.pointerControls.set(e.pointerId,'panLeft');state.lastManualPan=performance.now()/1000;return;}
      if(p.y>=270&&p.y<=388&&p.x>=W-52){state.pointerControls.set(e.pointerId,'panRight');state.lastManualPan=performance.now()/1000;return;}
      const type=cardAt(p.x,p.y);
      if(type&&!state.humanReady){state.dragging={type,x:p.x,y:p.y,pointerId:e.pointerId};sound('click');return;}
      if(p.y<615){state.viewDrag={pointerId:e.pointerId,lastX:p.x,moved:false};state.lastManualPan=performance.now()/1000;}
    } else if(state.mode==='race') {
      if(p.x>=W-70&&p.y<=55){toggleSound();return;}
      let control=null;
      if(p.y>=625&&p.x<95)control='left'; else if(p.y>=625&&p.x<195)control='right'; else if(p.y>=615&&p.x>292)control='jump';
      if(control){state.pointerControls.set(e.pointerId,control);if(control==='jump')queueJump();}
    } else if(state.mode==='complete'&&p.x>=78&&p.x<=342&&p.y>=610&&p.y<=700){restart();sound('click');}
  }

  function pointerMove(e) {
    const p=pointFromEvent(e);
    if(state.dragging&&state.dragging.pointerId===e.pointerId){state.dragging.x=p.x;state.dragging.y=p.y;return;}
    if(state.viewDrag&&state.viewDrag.pointerId===e.pointerId){
      const dx=p.x-state.viewDrag.lastX;
      if(Math.abs(dx)>1)state.viewDrag.moved=true;
      state.buildCameraX=clamp(state.buildCameraX-dx*1.35,0,WORLD_W-W);
      state.viewDrag.lastX=p.x;state.lastManualPan=performance.now()/1000;
    }
  }

  function pointerUp(e) {
    if(state.dragging&&state.dragging.pointerId===e.pointerId){const d=state.dragging;commitPlacement(d.type,d.x,d.y);state.dragging=null;}
    if(state.viewDrag&&state.viewDrag.pointerId===e.pointerId)state.viewDrag=null;
    const released=state.pointerControls.get(e.pointerId);
    state.pointerControls.delete(e.pointerId);
    if(state.mode==='race'&&(released==='left'||released==='right')&&state.player)state.player.vx=0;
  }

  function releaseAllControls(){
    state.keys.clear();state.pointerControls.clear();state.viewDrag=null;
    if(state.mode==='race'&&state.player)state.player.vx=0;
  }

  canvas.addEventListener('pointerdown',pointerDown);
  canvas.addEventListener('pointermove',pointerMove);
  canvas.addEventListener('pointerup',pointerUp);
  canvas.addEventListener('pointercancel',pointerUp);
  canvas.addEventListener('lostpointercapture',pointerUp);
  canvas.addEventListener('wheel',e=>{
    if(state.mode!=='build')return;
    e.preventDefault();
    state.buildCameraX=clamp(state.buildCameraX+(e.deltaX||e.deltaY)*.7,0,WORLD_W-W);
    state.lastManualPan=performance.now()/1000;
  },{passive:false});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('keydown',e=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','Space','KeyA','KeyD','KeyW','KeyR'].includes(e.code))e.preventDefault();
    if(!state.keys.has(e.code)&&(e.code==='ArrowUp'||e.code==='Space'||e.code==='KeyW'))queueJump();
    if(e.code==='KeyR'&&state.mode==='race')death('选择了快速重生');
    state.keys.add(e.code);
  });
  window.addEventListener('keyup',e=>state.keys.delete(e.code));
  window.addEventListener('blur',releaseAllControls);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAllControls();});

  function loop(now) {
    const dt=(now-state.lastTime)/1000;state.lastTime=now;
    update(dt,now*.001);draw();requestAnimationFrame(loop);
  }

  window.__partyGame = {
    getState: () => ({mode:state.mode,round:state.round,score:state.score,placed:state.placed.length,
      buildCameraX:state.buildCameraX,humanReady:state.humanReady,soundOn:state.soundOn,
      botsPlaced:state.botBuild.filter(p=>p.placed).length,
      placedDetails:state.placed.map(p=>({type:p.type,y:p.y,renderY:p.y+(p.type==='moving'&&state.mode==='race'?Math.sin(performance.now()*.0017+(p.phase||0))*54:0)})),
      player:state.player?{x:state.player.x,y:state.player.y,vx:state.player.vx,vy:state.player.vy,dead:state.player.dead}:null}),
    restart,
  };

  loadAssets().finally(()=>{
    state.player=freshPlayer();resetBots();startBuild();loading.classList.add('hidden');
    requestAnimationFrame(now=>{state.lastTime=now;loop(now);});
  });
})();
