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

  function storageGet(key, fallback) {
    try {
      const value = window.localStorage && window.localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (_) {
      /* Some in-app browsers disable storage. The game can run without it. */
    }
  }

  const CHARACTERS = [
    { id:'dino', name:'薄荷小龙', color:'#32c77a' },
    { id:'pig', name:'珊瑚小猪', color:'#ff6574' },
    { id:'mouse', name:'飞行小鼠', color:'#53bfe8' },
    { id:'rabbit', name:'紫巾小兔', color:'#9a6bea' },
    { id:'fox', name:'橙尾小狐', color:'#ff9138' },
    { id:'robot', name:'圆头小机', color:'#ffc928' },
  ];
  const POSES = ['idle','run','jump','stunned'];
  const images = {};
  const assetStatus = { loaded:0, failed:0 };
  const imageSources = {};
  CHARACTERS.forEach(character => POSES.forEach(pose => {
    const key = `${character.id}-${pose}`;
    const cacheVersion = window.location.protocol === 'file:' ? '' : '?v=20260818e';
    imageSources[key] = `assets/characters/${key}.png${cacheVersion}`;
  }));

  const PIECES = {
    platform: { name: '2×1平台', color: '#14c8ed', w: 92, h: 24 },
    spring: { name: '弹簧', color: '#ffcf1b', w: 46, h: 36 },
    spikes: { name: '地刺', color: '#ffcf1b', w: 70, h: 26 },
    moving: { name: '移动平台', color: '#19c8ed', w: 96, h: 22 },
    conveyor: { name: '传送带', color: '#4c9fff', w: 92, h: 28 },
    fan: { name: '传送风扇', color: '#5bd9ef', w: 56, h: 56 },
    crusher: { name: '压砸机', color: '#ff5b50', w: 42, h: 84 },
    laser: { name: '激光栅', color: '#ff4b65', w: 76, h: 28 },
    bomb: { name: '定时炸弹', color: '#ffb52e', w: 42, h: 42 },
  };

  const MAPS = [
    { id:'sky', name:'天空城堡', colors:['#19b9d8','#9ae5e8','#d6f4e3'], style:'stone', platforms:[
      { x:0,y:535,w:255,h:250,castle:true },{ x:330,y:505,w:105,h:22,orange:true },{ x:475,y:570,w:185,h:220,castle:true },
      { x:705,y:510,w:115,h:22,orange:true },{ x:875,y:570,w:180,h:220,castle:true },{ x:1090,y:510,w:95,h:22,orange:true },
      { x:1200,y:455,w:88,h:22,orange:true },{ x:1320,y:400,w:320,h:390,castle:true,finish:true },
    ]},
    { id:'canyon', name:'赤岩峡谷', colors:['#f07e62','#f6c27b','#ffe6b0'], style:'sand', platforms:[
      { x:0,y:535,w:270,h:250,castle:true },{ x:300,y:470,w:130,h:22,orange:true },{ x:475,y:535,w:125,h:255,castle:true },
      { x:650,y:450,w:110,h:22,orange:true },{ x:820,y:530,w:155,h:260,castle:true },{ x:1030,y:465,w:120,h:22,orange:true },
      { x:1190,y:400,w:95,h:22,orange:true },{ x:1320,y:350,w:320,h:440,castle:true,finish:true },
    ]},
    { id:'factory', name:'霓虹工坊', colors:['#26345f','#40548b','#8ab6d9'], style:'steel', platforms:[
      { x:0,y:535,w:220,h:250,castle:true },{ x:260,y:520,w:95,h:22,orange:true },{ x:400,y:460,w:110,h:22,orange:true },
      { x:560,y:560,w:180,h:230,castle:true },{ x:780,y:475,w:100,h:22,orange:true },{ x:940,y:420,w:110,h:22,orange:true },
      { x:1100,y:540,w:140,h:250,castle:true },{ x:1300,y:380,w:340,h:410,castle:true,finish:true },
    ]},
  ];

  const state = {
    mode: 'menu',
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
    soundOn: storageGet('party-maker-sound', 'off') === 'on',
    buildElapsed: 0,
    botClock: 0,
    botBuild: [],
    humanReady: false,
    startCountdown: 0,
    lastManualPan: -99,
    highScore: Number(storageGet('party-maker-high-score', '0') || 0),
    playerCount: clamp(Number(storageGet('party-maker-player-count', '4') || 4), 1, 4),
    selectedCharacter: storageGet('party-maker-character', 'dino'),
    selectedMap: clamp(Number(storageGet('party-maker-map', '0') || 0), 0, MAPS.length - 1),
    player: null,
    bots: [],
  };

  function freshPlayer() {
    return {
      x: 82, y: 480, prevX: 82, prevY: 480, w: 35, h: 49,
      vx: 0, vy: 0, grounded: false, coyote: 0,
      face: 1, dead: false, respawn: 0, invincible: 0,
      finished: false, deaths: 0, anim: 0, safeX:82, safeY:480, groundedTime:0, fallGuards:0, fallGuardCooldown:0,
    };
  }

  function characterImage(characterId, pose = 'idle') {
    return images[`${characterId}-${pose}`] || images[`${characterId}-idle`];
  }

  function selectedCharacterName() {
    const character = CHARACTERS.find(item => item.id === state.selectedCharacter);
    return character ? character.name : CHARACTERS[0].name;
  }

  function currentMap() { return MAPS[state.selectedMap] || MAPS[0]; }
  function currentPlatforms() { return currentMap().platforms; }
  function finishPlatform() { return currentPlatforms().find(platform => platform.finish) || currentPlatforms()[currentPlatforms().length-1]; }

  function resetBots() {
    const names = ['团冬','肖亚兴','伦敦'];
    const colors = ['#ff4861','#ffb51c','#8f68ee'];
    const available = CHARACTERS.filter(character => character.id !== state.selectedCharacter);
    state.bots = Array.from({ length: Math.max(0, state.playerCount - 1) }, (_, i) => ({
      name:names[i], color:colors[i], charId:available[i % available.length].id,
      x:60-i*16, speed:87-i*11, seed:.4+i*1.4, finished:false,
    }));
  }

  function loadAssets() {
    return Promise.all(Object.keys(imageSources).map(key => new Promise(resolve => {
      const src = imageSources[key];
      const img = new Image();
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(settle, 1800);
      img.onload = () => {
        if (!images[key]) assetStatus.loaded += 1;
        images[key] = img;
        settle();
      };
      img.onerror = () => { assetStatus.failed += 1; settle(); };
      img.src = src;
    })));
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function isFullSolid(solid) {
    return !!solid.castle || ['platform','moving','conveyor'].includes(solid.type);
  }

  function supportFor(player, platforms) {
    const foot=player.y+player.h;
    return platforms.find(platform => Math.abs(foot-platform.y)<2 &&
      player.x+player.w>platform.x+2 && player.x<platform.x+platform.w-2) || null;
  }

  function resolveSolidHorizontal(player, solids, previousX) {
    for (const solid of solids) {
      if (!rects(player, solid)) continue;
      const previousRight = previousX + player.w;
      if (player.vx > 0 && previousRight <= solid.x + 3) player.x = solid.x - player.w;
      else if (player.vx < 0 && previousX >= solid.x + solid.w - 3) player.x = solid.x + solid.w;
      else {
        const pushLeft = player.x + player.w - solid.x;
        const pushRight = solid.x + solid.w - player.x;
        player.x += pushLeft < pushRight ? -pushLeft : pushRight;
      }
      player.vx = 0;
    }
  }

  function resolveSolidVertical(player, solids, previousY, movementY) {
    player.grounded = false;
    for (const solid of solids) {
      const overlapsX = player.x + player.w > solid.x + 1 && player.x < solid.x + solid.w - 1;
      if (!overlapsX) continue;
      const previousBottom = previousY + player.h;
      const currentBottom = player.y + player.h;
      const crossedTop = movementY >= 0 && previousBottom <= solid.y + 2 && currentBottom >= solid.y;
      const crossedBottom = movementY < 0 && previousY >= solid.y + solid.h - 2 && player.y <= solid.y + solid.h;
      if (crossedTop || (movementY >= 0 && rects(player, solid))) {
        player.y = solid.y - player.h;
        player.vy = 0;
        player.grounded = true;
      } else if (isFullSolid(solid) && (crossedBottom || (movementY < 0 && rects(player, solid)))) {
        player.y = solid.y + solid.h;
        player.vy = 0;
      }
    }
  }
  function roundedRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    const radius = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
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
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
    storageSet('party-maker-sound', state.soundOn ? 'on' : 'off');
    if (state.soundOn) sound('click');
    state.toast = { text: state.soundOn ? '柔和音效已开启' : '音效已关闭', time: 1.3 };
  }

  function inventory() {
    if (state.round === 1) return ['platform', 'spring', 'spikes', 'fan'];
    if (state.round === 2) return ['moving', 'conveyor', 'crusher', 'laser'];
    return ['spring', 'bomb', 'platform', 'fan'];
  }

  function pieceSize(type, rotation = 0) {
    const spec = PIECES[type];
    return rotation % 2 ? { w:spec.h, h:spec.w } : { w:spec.w, h:spec.h };
  }

  function rotationVector(rotation = 0, naturalDirection = 0) {
    const vectors = [{ x:1, y:0 }, { x:0, y:1 }, { x:-1, y:0 }, { x:0, y:-1 }];
    return vectors[(rotation + naturalDirection + 4) % 4];
  }

  function createPiece(type, x, y, rotation = 0, extra = {}) {
    const size = pieceSize(type, rotation);
    return { type, x, y, w:size.w, h:size.h, rotation, ...extra };
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

  function startGame() {
    storageSet('party-maker-player-count', String(state.playerCount));
    storageSet('party-maker-character', state.selectedCharacter);
    state.round = 1;
    state.score = 0;
    state.placed = [];
    state.player = freshPlayer();
    resetBots();
    startBuild();
    sound('click');
  }

  function showMenu() {
    releaseAllControls();
    state.mode = 'menu';
    state.toast = { text:'', time:0 };
    state.particles = [];
  }

  function createBotPlans() {
    const layouts = {
      1: [
        { type:'spring', x:430, y:440, rotation:0 },
        { type:'spikes', x:545, y:544, rotation:0 },
        { type:'platform', x:675, y:415, rotation:1 },
      ],
      2: [
        { type:'moving', x:790, y:405, rotation:1 },
        { type:'spikes', x:930, y:500, rotation:3 },
        { type:'spring', x:1110, y:470, rotation:0 },
      ],
      3: [
        { type:'platform', x:1135, y:345, rotation:1 },
        { type:'spring', x:1240, y:408, rotation:3 },
        { type:'spikes', x:1400, y:374, rotation:2 },
      ],
    };
    return layouts[state.round].slice(0, Math.max(0, state.playerCount - 1)).map((p, i) => ({
      ...p, name:state.bots[i].name, color:state.bots[i].color, charId:state.bots[i].charId,
      rotation:p.rotation||0, start:1.7 + i * 2.05, duration:1.05, placed:false, index:i,
    }));
  }

  function startRace() {
    if (state.mode !== 'build') return;
    if (!state.selected) {
      const type = inventory()[0];
      const fallback=findSafePiece(type);
      if(fallback){state.selected=fallback;state.placed.push(fallback);}
    }
    state.humanReady = true;
    const remaining = state.playerCount - 1;
    state.toast = { text: remaining ? `已确认，等待另外${remaining}位玩家放置…` : '已确认，准备开跑！', time: 2.2 };
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
      storageSet('party-maker-high-score', String(state.highScore));
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
    state.toast = { text: `${selectedCharacterName()}${reason}`, time: 1.4 };
    burst(p.x - state.cameraX + p.w / 2, p.y + p.h / 2, '#ff4b55', 18);
    sound('hurt');
  }

  function respawn() {
    const p = state.player;
    p.x = p.safeX ?? 82; p.y = p.safeY ?? 472; p.prevX = p.x; p.prevY = p.y;
    p.vx = 0; p.vy = 0; p.dead = false; p.groundedTime=.2; p.fallGuardCooldown=.45; p.invincible = 1.2;
  }

  function recoverFromFall() {
    const p=state.player;
    p.x=p.safeX??82;p.y=p.safeY??472;p.prevX=p.x;p.prevY=p.y;
    p.vx=0;p.vy=0;p.grounded=true;p.groundedTime=.2;p.dead=false;p.fallGuardCooldown=.45;p.invincible=1.05;p.fallGuards=(p.fallGuards||0)+1;
    state.toast={text:'已回到最近的平台',time:1.2};
    burst(p.x-state.cameraX+p.w/2,p.y+p.h/2,'#ffe029',12);
    state.cameraX=clamp(p.x-130,0,WORLD_W-W);
  }

  function getPlatforms(time, animateMoving = state.mode === 'race') {
    const all = currentPlatforms().map(p => ({ ...p }));
    for (const piece of state.placed) {
      if (piece.type === 'platform') all.push({ ...piece, orange: false });
      if (piece.type === 'conveyor') all.push({ ...piece, conveyor: true, orange: false });
      if (piece.type === 'moving') {
        const offset = animateMoving ? Math.sin(time * 1.7 + (piece.phase || 0)) * 54 : 0;
        const horizontal = (piece.rotation || 0) % 2 === 1;
        all.push({ ...piece, x:piece.x+(horizontal?offset:0), y:piece.y+(horizontal?0:offset), moving: true, animateMoving });
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
    const size = pieceSize(plan.type, plan.rotation || 0);
    const candidates = [
      { x:plan.x, y:plan.y },
      { x:plan.x + 42, y:plan.y - 70 },
      { x:plan.x - 56, y:plan.y - 90 },
    ];
    const target = candidates.find(c => !state.placed.some(p => rects(
      { x:c.x-10, y:c.y-10, w:size.w+20, h:size.h+20 }, p
    ))) || candidates[1];
    plan.x = clamp(target.x,260,WORLD_W-180-size.w); plan.y = clamp(target.y,135,590-size.h); plan.placed = true;
    state.placed.push(createPiece(plan.type, plan.x, plan.y, plan.rotation || 0, {
      phase:plan.index*1.7, bot:true, botName:plan.name, botColor:plan.color
    }));
    state.toast = { text:`${plan.name} 放置了「${PIECES[plan.type].name}」`, time:1.35 };
    burst(plan.x - state.buildCameraX + size.w/2, plan.y + size.h/2, plan.color, 11);
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
    const everyoneReady = state.botBuild.every(p => p.placed);
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
    p.fallGuardCooldown = Math.max(0, (p.fallGuardCooldown||0) - dt);
    p.prevX = p.x;
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
    const platforms = getPlatforms(time);
    p.x += p.vx * dt;
    resolveSolidHorizontal(p, platforms.filter(isFullSolid), p.prevX);
    const movementY = p.vy * dt;
    p.y += movementY;
    resolveSolidVertical(p, platforms, p.prevY, movementY);
    p.x = Math.max(0, p.x);
    const support=supportFor(p,platforms);
    const safeLeft=support ? support.x+12 : 0;
    const safeRight=support ? support.x+support.w-p.w-12 : -1;
    const stableOnSupport=!!support && safeRight>=safeLeft && p.x>=safeLeft && p.x<=safeRight;
    p.groundedTime=stableOnSupport ? (p.groundedTime||0)+dt : 0;
    if(stableOnSupport && p.groundedTime>=.18){p.safeX=clamp(p.x,safeLeft,safeRight);p.safeY=p.y;}

    for (const piece of state.placed) {
      if (piece.type === 'conveyor' && rects(p, { x:piece.x-2, y:piece.y-2, w:piece.w+4, h:piece.h+4 })) {
        const direction = rotationVector(piece.rotation || 0);
        p.vx += direction.x * 240 * dt;
        p.vy += direction.y * 240 * dt;
        if (direction.y < 0) p.grounded = false;
      }
      if (piece.type === 'fan' && rects(p, piece)) {
        const direction = rotationVector(piece.rotation || 0, 3);
        p.vx += direction.x * 340 * dt;
        p.vy += direction.y * 340 * dt;
        if (direction.y < 0) p.grounded = false;
      }
      if (piece.type === 'crusher' && rects(p, piece)) death('被压砸机击中了！');
      if (piece.type === 'laser' && Math.sin(time * 2.4 + (piece.phase || 0)) > -.15 && rects(p, piece)) death('碰到了激光栅！');
      if (piece.type === 'bomb' && rects(p, piece)) death('引爆了定时炸弹！');
      if (piece.type === 'spikes' && rects(p, { x: piece.x + 6, y: piece.y + 5, w: piece.w - 12, h: piece.h - 4 })) {
        death('撞上了地刺！');
      }
      if (piece.type === 'spring' && p.vy >= 0 && rects(p, { x: piece.x, y: piece.y, w: piece.w, h: piece.h })) {
        const rotation = piece.rotation || 0;
        if (rotation === 0) { p.y = piece.y - p.h; p.vy = -720; }
        else if (rotation === 1) { p.x = piece.x + piece.w + 2; p.vx = 720; p.vy = -160; }
        else if (rotation === 2) { p.y = piece.y + piece.h + 2; p.vy = 620; }
        else { p.x = piece.x - p.w - 2; p.vx = -720; p.vy = -160; }
        p.grounded = false;
        burst(p.x - state.cameraX + p.w / 2, p.y + p.h, '#ffdc22', 12);
        sound('spring');
      }
    }

    if (p.y > H + 24 && p.fallGuardCooldown<=0) recoverFromFall();
    const goal=finishPlatform();
    if (p.x > goal.x + goal.w - 150 && p.y + p.h < goal.y + 32) {
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
    const sky=currentMap().colors;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky[0]); g.addColorStop(.7, sky[1]); g.addColorStop(1, sky[2]);
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
    const style=currentMap().style;
    ctx.fillStyle = style==='sand' ? '#8c654c' : style==='steel' ? '#26334d' : '#3d4b4e'; ctx.fillRect(x, y, w, h);
    const bw = 52, bh = 32;
    for (let row = 0; row < Math.ceil(h / bh); row++) {
      for (let col = -1; col < Math.ceil(w / bw) + 1; col++) {
        const ox = row % 2 ? bw / 2 : 0;
        const bx = x + col * bw + ox, by = y + row * bh;
        ctx.fillStyle = style==='sand' ? ((row+col)%3===0?'#b98b62':'#9b7355') : style==='steel' ? ((row+col)%3===0?'#465b7d':'#334766') : ((row + col) % 3 === 0 ? '#586466' : '#4a5759');
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
      const rotation=p.rotation||0, cx=x+p.w/2, cy=y+p.h/2;
      const anchors=[[35,-120],[120,35],[-35,120],[-120,-35]][rotation];
      ctx.strokeStyle = '#5b5960'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+anchors[0],cy+anchors[1]); ctx.stroke();
      ctx.fillStyle = '#ef4a4f'; ctx.fillRect(cx+anchors[0]-4,cy+anchors[1]-4,8,8);
    }
    ctx.fillStyle = p.conveyor ? '#438cf0' : (p.orange ? '#ff9d1c' : '#92999a');
    roundedRect(x, y, p.w, p.h, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)'; roundedRect(x+5,y+4,p.w-10,5,3); ctx.fill();
    ctx.strokeStyle = p.orange ? '#dd7615' : '#737a7c'; ctx.lineWidth = 2; roundedRect(x,y,p.w,p.h,7); ctx.stroke();
    if(p.conveyor){
      ctx.save();ctx.translate(x+p.w/2,y+p.h/2);ctx.rotate((p.rotation||0)*Math.PI/2);
      ctx.strokeStyle='rgba(255,255,255,.88)';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
      for(let i=-1;i<=1;i++){const ax=i*21;ctx.beginPath();ctx.moveTo(ax-5,-6);ctx.lineTo(ax+3,0);ctx.lineTo(ax-5,6);ctx.stroke();}
      ctx.restore();
    }
    ctx.restore();
  }

  function drawPieceShape(type,x,y,w,h) {
    if (type === 'platform') {
      ctx.fillStyle = '#92999a'; roundedRect(x,y,w,h,7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.25)'; roundedRect(x+5,y+4,w-10,5,3); ctx.fill();
    } else if (type === 'spikes') {
      ctx.fillStyle = '#5a5d63'; ctx.fillRect(x,y+h-7,w,7);
      ctx.fillStyle = '#e8edf0';
      const n = 5, sw = w / n;
      for (let i=0;i<n;i++) { ctx.beginPath(); ctx.moveTo(x+i*sw,y+h-7); ctx.lineTo(x+i*sw+sw/2,y); ctx.lineTo(x+(i+1)*sw,y+h-7); ctx.fill(); }
    } else if (type === 'spring') {
      ctx.fillStyle = '#ffd41b'; ctx.fillRect(x,y,w,6); ctx.fillRect(x,y+h-6,w,6);
      ctx.strokeStyle = '#b83262'; ctx.lineWidth = 4; ctx.beginPath();
      ctx.moveTo(x+7,y+7); ctx.lineTo(x+w-7,y+13); ctx.lineTo(x+7,y+20); ctx.lineTo(x+w-7,y+h-7); ctx.stroke();
    } else if (type === 'moving') {
      ctx.fillStyle='#ff9d1c';roundedRect(x,y,w,h,7);ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.28)';roundedRect(x+5,y+4,w-10,5,3);ctx.fill();
    } else if (type === 'fan') {
      ctx.fillStyle='#47cce6';ctx.beginPath();ctx.arc(x+w/2,y+h/2,Math.min(w,h)*.42,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#0c738e';ctx.lineWidth=Math.max(2,w*.06);ctx.beginPath();ctx.arc(x+w/2,y+h/2,Math.min(w,h)*.12,0,Math.PI*2);ctx.stroke();
      for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.beginPath();ctx.moveTo(x+w/2,y+h/2);ctx.quadraticCurveTo(x+w/2+Math.cos(a+.5)*w*.35,y+h/2+Math.sin(a+.5)*h*.35,x+w/2+Math.cos(a)*w*.4,y+h/2+Math.sin(a)*h*.4);ctx.stroke();}
    } else if (type === 'crusher') {
      ctx.fillStyle='#d83e4b';roundedRect(x,y,w,h,5);ctx.fill();ctx.fillStyle='#ffad32';ctx.fillRect(x+5,y+8,w-10,7);ctx.fillRect(x+5,y+h-16,w-10,7);ctx.fillStyle='#782b3b';ctx.fillRect(x+w*.35,y+15,w*.3,h-31);
    } else if (type === 'laser') {
      ctx.fillStyle='#782b4b';roundedRect(x,y,w,h,5);ctx.fill();ctx.fillStyle='#ff4664';ctx.fillRect(x+6,y+h/2-3,w-12,6);ctx.fillStyle='#fff3f5';ctx.fillRect(x+w*.2,y+h/2-1,w*.6,2);
    } else if (type === 'bomb') {
      ctx.fillStyle='#2c3850';ctx.beginPath();ctx.arc(x+w/2,y+h/2,w*.37,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ffb52e';ctx.lineWidth=Math.max(2,w*.07);ctx.stroke();ctx.fillStyle='#ffb52e';ctx.fillRect(x+w*.62,y+w*.05,w*.12,w*.2);ctx.strokeStyle='#ff7a28';ctx.beginPath();ctx.moveTo(x+w*.68,y+w*.06);ctx.quadraticCurveTo(x+w*.9,y-w*.1,x+w*.85,y-w*.25);ctx.stroke();
    }
  }

  function drawPiece(piece, cam, alpha = 1) {
    let x = piece.x - cam, y = piece.y;
    const spec = PIECES[piece.type];
    const rotation=piece.rotation||0;
    const natural=pieceSize(piece.type,rotation);
    const scale=Math.min(piece.w/natural.w,piece.h/natural.h);
    if(piece.type==='moving'&&state.mode==='race'){
      const offset=Math.sin(performance.now()*.0017+(piece.phase||0))*54;
      if(rotation%2)x+=offset;else y+=offset;
    }
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(x+piece.w/2,y+piece.h/2);ctx.rotate(rotation*Math.PI/2);
    drawPieceShape(piece.type,-spec.w*scale/2,-spec.h*scale/2,spec.w*scale,spec.h*scale);
    ctx.restore();ctx.save();ctx.globalAlpha=alpha;
    if (piece.bot) {
      ctx.fillStyle = piece.botColor || 'rgba(255,66,92,.9)'; roundedRect(x+piece.w-16,y-11,26,20,6);ctx.fill();
      text((piece.botName || '机').slice(0,1),x+piece.w-3,y-1,11,'#fff');
    }
    ctx.restore();
  }

  function drawWorld(cam, build, now) {
    drawSky(build);
    for (const p of getPlatforms(now, !build)) drawPlatform(p, cam, now);
    for (const p of state.placed) if (!['platform','moving','conveyor'].includes(p.type)) drawPiece(p, cam);
    if (!build) {
      drawFinish(cam);
      drawBots(cam, now);
      drawPlayer(cam);
    }
  }

  function drawFinish(cam) {
    const goal=finishPlatform(),x = goal.x + goal.w - 150 - cam;
    if (x < -80 || x > W + 80) return;
    ctx.save();
    const poleY=goal.y-95;
    ctx.fillStyle = '#eef4ef'; ctx.fillRect(x, poleY, 8, 95);
    ctx.fillStyle = '#ff3f54'; ctx.beginPath(); ctx.moveTo(x+8,poleY+5); ctx.lineTo(x+62,poleY+21); ctx.lineTo(x+8,poleY+39); ctx.closePath(); ctx.fill();
    text('终点', x+31, poleY+22, 14, '#fff');
    ctx.restore();
  }

  function drawFallbackCharacter(characterId, x, y, w, h, face = 1, alpha = 1, pose = 'idle') {
    const character = CHARACTERS.find(item => item.id === characterId) || CHARACTERS[0];
    ctx.save();ctx.globalAlpha=alpha;ctx.translate(x+(face<0?w:0),y);ctx.scale((face<0?-1:1)*w/64,h/72);
    const jump = pose === 'jump' ? -3 : 0;
    if(characterId==='robot'){
      ctx.fillStyle=character.color;roundedRect(16,19+jump,36,29,10);ctx.fill();roundedRect(20,45+jump,28,20,8);ctx.fill();
      ctx.fillStyle='#163e58';roundedRect(21,25+jump,26,16,7);ctx.fill();ctx.fillStyle='#7ff7ff';ctx.beginPath();ctx.arc(29,33+jump,2.5,0,Math.PI*2);ctx.arc(40,33+jump,2.5,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#ea7b22';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(22,49+jump);ctx.lineTo(10,55+jump);ctx.moveTo(46,49+jump);ctx.lineTo(56,55+jump);ctx.stroke();
    }else{
      ctx.fillStyle=character.color;ctx.beginPath();ctx.ellipse(31,49+jump,17,19,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(36,27+jump,20,18,0,0,Math.PI*2);ctx.fill();
      if(characterId==='rabbit'){ctx.beginPath();ctx.ellipse(27,8+jump,5,17,-.18,0,Math.PI*2);ctx.ellipse(42,7+jump,5,17,.18,0,Math.PI*2);ctx.fill();}
      else if(characterId==='mouse'){ctx.beginPath();ctx.arc(20,18+jump,10,0,Math.PI*2);ctx.arc(49,18+jump,10,0,Math.PI*2);ctx.fill();}
      else if(characterId==='fox'){ctx.beginPath();ctx.moveTo(18,19+jump);ctx.lineTo(23,2+jump);ctx.lineTo(32,16+jump);ctx.moveTo(41,15+jump);ctx.lineTo(51,3+jump);ctx.lineTo(54,22+jump);ctx.fill();ctx.beginPath();ctx.ellipse(10,51+jump,12,20,-.8,0,Math.PI*2);ctx.fill();}
      else if(characterId==='pig'){ctx.beginPath();ctx.moveTo(21,15+jump);ctx.lineTo(17,4+jump);ctx.lineTo(31,14+jump);ctx.fill();ctx.fillStyle='#ff9bab';ctx.beginPath();ctx.ellipse(53,31+jump,10,7,0,0,Math.PI*2);ctx.fill();}
      else {ctx.beginPath();ctx.moveTo(15,44+jump);ctx.lineTo(2,54+jump);ctx.lineTo(20,57+jump);ctx.fill();ctx.fillStyle='#33404e';for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(17+i*5,18+i*8+jump);ctx.lineTo(10+i*5,22+i*8+jump);ctx.lineTo(18+i*5,26+i*8+jump);ctx.fill();}}
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(39,24+jump,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#17323f';ctx.beginPath();ctx.arc(41,25+jump,2.6,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=character.color;ctx.lineWidth=6;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(23,57+jump);ctx.lineTo(pose==='run'?13:20,68);ctx.moveTo(40,57+jump);ctx.lineTo(pose==='run'?52:43,68);ctx.stroke();
    }
    ctx.restore();
  }

  function drawDino(img, x, y, w, h, face = 1, alpha = 1, characterId = 'dino', pose = 'idle') {
    if (!img || !img.complete || !img.naturalWidth) return drawFallbackCharacter(characterId,x,y,w,h,face,alpha,pose);
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(x + (face < 0 ? w : 0), y);
    ctx.scale(face < 0 ? -1 : 1, 1);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.restore();
  }

  function drawPlayer(cam) {
    const p = state.player;
    if (!p || p.dead) return;
    const sx = p.x - cam - 20, sy = p.y - 27;
    const pose = !p.grounded ? 'jump' : Math.abs(p.vx) > 30 ? 'run' : 'idle';
    const img = characterImage(state.selectedCharacter,pose);
    const bob = p.grounded && Math.abs(p.vx)>30 ? Math.sin(p.anim*15)*2 : 0;
    drawDino(img, sx, sy+bob, 76, 84, p.face, p.invincible > 0 && Math.floor(p.invincible*12)%2 ? .35 : 1,state.selectedCharacter,pose);
    ctx.fillStyle = '#ffe326'; ctx.beginPath(); ctx.moveTo(sx+38,sy-8);ctx.lineTo(sx+26,sy-30);ctx.lineTo(sx+50,sy-30);ctx.closePath();ctx.fill();
  }

  function drawBuildAvatar() {
    const bob = Math.sin(performance.now() * .003) * 3;
    ctx.save();
    ctx.fillStyle = 'rgba(13,40,48,.78)'; roundedRect(54,392,92,28,10); ctx.fill();
    text(selectedCharacterName(),100,406,12,'#fff');
    drawDino(characterImage(state.selectedCharacter,'idle'),52,426+bob,92,102,1,1,state.selectedCharacter,'idle');
    ctx.fillStyle='#ffe326';ctx.beginPath();ctx.moveTo(98,423+bob);ctx.lineTo(84,399+bob);ctx.lineTo(112,399+bob);ctx.closePath();ctx.fill();
    ctx.restore();
  }

  function drawBots(cam, now) {
    for (const bot of state.bots) {
      if (bot.finished) continue;
      const x = bot.x - cam;
      if (x < -70 || x > W+70) continue;
      const ground = bot.x < 255 ? 535 : bot.x < 475 ? 505 : bot.x < 660 ? 570 : bot.x < 875 ? 510 : bot.x < 1055 ? 570 : bot.x < 1320 ? 490 : 400;
      const hop = Math.max(0, Math.sin(now*2.6 + bot.seed))*42;
      ctx.save();ctx.globalAlpha=.88;
      drawDino(characterImage(bot.charId,'run'),x-20,ground-84-hop,76,84,1,1,bot.charId,'run');
      ctx.shadowColor='rgba(0,0,0,.55)';ctx.shadowBlur=4;text(bot.name,x+18,ground-92-hop,10,bot.color);ctx.restore();
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
    const participants=[{charId:state.selectedCharacter,color:'#31c871'},...state.bots];
    for(let i=0;i<participants.length;i++) {
      const participant=participants[i];
      const y=92+i*37;
      drawDino(characterImage(participant.charId,'idle'),7,y-2,38,38,1,1,participant.charId,'idle');
      let badge='…', badgeColor='#ff3c52';
      if(i===0&&state.mode==='build'&&state.humanReady){badge='✓';badgeColor='#25c94c';}
      if(i>0&&state.mode==='build'){
        const plan=state.botBuild[i-1];
        if(plan && plan.placed){badge='✓';badgeColor='#25c94c';}
        else if(plan&&state.botClock>=plan.start){badge='手';badgeColor=plan.color;}
      }
      ctx.fillStyle=badgeColor;ctx.beginPath();ctx.arc(43,y+25,9,0,Math.PI*2);ctx.fill();text(badge,43,y+25,9,'#fff');
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
    const spec=PIECES[active.type],size=pieceSize(active.type,active.rotation||0);
    const raw=clamp((state.botClock-active.start)/active.duration,0,1);
    const t=raw*raw*(3-2*raw);
    const targetX=active.x-cam+size.w/2;
    const sx=lerp(42,targetX,t), sy=lerp(152+active.index*37,active.y+size.h/2,t);
    drawPiece(createPiece(active.type,sx+cam-size.w/2,sy-size.h/2,active.rotation||0,{phase:active.index}),cam,.86);
    ctx.save();ctx.fillStyle='rgba(12,42,53,.9)';roundedRect(98,132,298,39,10);ctx.fill();
    ctx.fillStyle=active.color;ctx.beginPath();ctx.arc(118,151,9,0,Math.PI*2);ctx.fill();
    text(`${active.name} 正在拖动「${spec.name}」`,137,152,13,'#fff','left');ctx.restore();
  }

  function drawBuild() {
    const cam = state.buildCameraX;
    drawWorld(cam, true, performance.now()*.001);
    drawBuildAvatar();
    drawPlayerRail();
    drawBuildNavigator();
    drawBotBuildAction(cam);

    if (state.selected) {
      drawPiece(state.selected, cam, .9);
      ctx.strokeStyle='#6aff8e';ctx.lineWidth=3;ctx.setLineDash([8,5]);roundedRect(state.selected.x-cam-5,state.selected.y-5,state.selected.w+10,state.selected.h+10,8);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=state.humanReady?'#66777c':'#ffad13';roundedRect(211,72,49,46,8);ctx.fill();ctx.strokeStyle=state.humanReady?'#43545a':'#b96e08';ctx.lineWidth=3;ctx.stroke();
      text('↻',235,94,28,'#fff');
      ctx.fillStyle=state.humanReady?'#66777c':'#24c643';roundedRect(270,72,125,46,8);ctx.fill();ctx.strokeStyle=state.humanReady?'#43545a':'#0d7f25';ctx.lineWidth=3;ctx.stroke();
      text(state.humanReady?'等待中…':'✓ 确定',333,95,state.humanReady?16:20);
    }

    if (state.dragging) {
      const spec=PIECES[state.dragging.type];
      drawPiece(createPiece(state.dragging.type,state.dragging.x+cam-spec.w/2,state.dragging.y-spec.h/2,0),cam,.72);
    }

    ctx.fillStyle='rgba(33,52,64,.92)';ctx.fillRect(0,615,W,145);
    text(state.humanReady?'已确认 · 正在等待其他玩家':'拖到网格里 · 所有人的机关都会保留',W/2,633,12,'#d8edf0');
    const cards=inventory();
    cards.forEach((type,i)=>{ctx.save();ctx.globalAlpha=state.humanReady ? .46 : 1;drawCard(type,12+i*102,650,96,96);ctx.restore();});
    drawHud();
  }

  function drawCard(type,x,y,w,h) {
    const spec=PIECES[type];
    ctx.save();
    ctx.fillStyle=spec.color;roundedRect(x,y,w,h,8);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.2)';roundedRect(x+5,y+5,w-10,24,6);ctx.fill();
    const mini={type,x:x+40,y:y+28,w:Math.min(spec.w*.5,58),h:Math.min(spec.h*.7,28),rotation:0};
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

  function drawMenu() {
    drawSky(false);
    ctx.fillStyle='rgba(11,38,50,.9)';roundedRect(24,20,372,100,22);ctx.fill();
    text('派对制造',W/2,67,35,'#ffe021');
    text('制造机关 · 冲向终点',W/2,100,14,'#c9f4f2');
    ctx.fillStyle='rgba(255,255,255,.92)';roundedRect(12,135,396,235,18);ctx.fill();
    text('选择你的角色模型',W/2,153,16,'#183b49');
    CHARACTERS.forEach((character,i)=>{
      const col=i%3,row=Math.floor(i/3),x=25+col*124,y=168+row*96,selected=state.selectedCharacter===character.id;
      ctx.fillStyle=selected?'#e8fff2':'#e9f1f3';roundedRect(x,y,112,86,13);ctx.fill();
      if(selected){ctx.strokeStyle='#22c55e';ctx.lineWidth=4;roundedRect(x,y,112,86,13);ctx.stroke();}
      drawDino(characterImage(character.id,'idle'),x+4,y+3,62,70,1,1,character.id,'idle');
      text(character.name,x+78,y+45,11,'#163643');
      if(selected){ctx.fillStyle='#22c55e';ctx.beginPath();ctx.arc(x+99,y+14,9,0,Math.PI*2);ctx.fill();text('✓',x+99,y+14,9,'#fff');}
    });
    ctx.fillStyle='rgba(11,38,50,.86)';roundedRect(20,382,380,112,18);ctx.fill();
    text('选择参赛人数',W/2,401,17,'#fff');
    for(let count=1;count<=4;count++){
      const x=36+(count-1)*88,selected=state.playerCount===count;
      ctx.fillStyle=selected?'#ffe021':'rgba(255,255,255,.16)';roundedRect(x,424,70,46,12);ctx.fill();
      text(`${count}人`,x+35,447,17,selected?'#173744':'#fff');
    }
    const botCount=Math.max(0,state.playerCount-1);
    text(botCount?`你 + ${botCount}名不同角色的人机`:'单人练习模式',W/2,484,12,'#bde8ea');
    ctx.fillStyle='rgba(11,38,50,.86)';roundedRect(20,505,380,55,16);ctx.fill();
    text('地图',47,532,14,'#fff','left');
    MAPS.forEach((map,i)=>{const x=88+i*98,selected=state.selectedMap===i;ctx.fillStyle=selected?'#ffe021':'rgba(255,255,255,.16)';roundedRect(x,518,87,30,9);ctx.fill();text(map.name,x+43,533,11,selected?'#173744':'#fff');});
    ctx.fillStyle='#23c94d';roundedRect(60,580,300,66,15);ctx.fill();ctx.strokeStyle='#0b7f28';ctx.lineWidth=4;ctx.stroke();
    text('开始制造',W/2,613,24,'#fff');
    text(`最高纪录  ★ ${state.highScore}`,W/2,683,14,'#173744');
    ctx.fillStyle='rgba(8,29,38,.75)';roundedRect(W-70,12,58,37,12);ctx.fill();
    text(state.soundOn?'声':'静',W-41,31,13,'#fff');
  }

  function drawComplete() {
    drawSky(false);
    drawCastle(34,395,352,365);
    drawDino(characterImage(state.selectedCharacter,'idle'),125,210,170,190,1,1,state.selectedCharacter,'idle');
    ctx.fillStyle='rgba(13,40,48,.92)';roundedRect(34,40,352,152,22);ctx.fill();
    text('派对完成！',W/2,79,32,'#ffe021');text(`总得分  ${state.score}`,W/2,127,25);text(`最高纪录  ${state.highScore}`,W/2,163,14,'#b8e8ec');
    ctx.fillStyle='#24c643';roundedRect(78,620,264,66,12);ctx.fill();ctx.strokeStyle='#0b7c25';ctx.lineWidth=4;ctx.stroke();text('再玩一局',W/2,653,24);
  }

  function draw() {
    ctx.clearRect(0,0,W,H);
    if(state.mode==='menu') drawMenu();
    else if(state.mode==='build') drawBuild();
    else if(state.mode==='race') drawRace();
    else if(state.mode==='result') drawResult();
    else drawComplete();
    drawParticles(); if(state.mode!=='menu')drawToast();
  }

  function pointFromEvent(e) {
    const r=canvas.getBoundingClientRect();
    return {x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};
  }

  function cardAt(x,y) {
    if(y<645) return null;
    const i=Math.floor((x-12)/102);
    return i>=0&&i<4?inventory()[i]:null;
  }

  function validPiece(piece,ignore=null) {
    if(piece.y<135||piece.y+piece.h>600)return false;
    if(piece.x<260||piece.x+piece.w>WORLD_W-180)return false;
    if(currentPlatforms().some(platform=>rects(piece,platform)))return false;
    return !state.placed.some(other=>other!==ignore&&rects({x:piece.x-12,y:piece.y-12,w:piece.w+24,h:piece.h+24},other));
  }

  function findSafePiece(type) {
    const candidates=[
      {x:state.buildCameraX+250,y:430},
      {x:state.buildCameraX+90,y:180},
      {x:280,y:160},
      {x:260,y:135},
    ];
    for(const candidate of candidates){
      const piece=createPiece(type,Math.round(candidate.x/14)*14,Math.round(candidate.y/14)*14,0,{phase:Math.random()*3});
      if(validPiece(piece))return piece;
    }
    return null;
  }

  function commitPlacement(type,x,y) {
    const spec=PIECES[type];
    const placed=createPiece(type,Math.round((x+state.buildCameraX-spec.w/2)/14)*14,Math.round((y-spec.h/2)/14)*14,0,{phase:Math.random()*3});
    if(!validPiece(placed,state.selected)){state.toast={text:'这里放不下，换个空位试试',time:1.6};sound('hurt');return false;}
    if(state.selected){const idx=state.placed.indexOf(state.selected);if(idx>=0)state.placed.splice(idx,1);}
    state.placed.push(placed);state.selected=placed;state.toast={text:`已放置「${spec.name}」，可旋转后再确定`,time:2};sound('place');return true;
  }

  function rotateSelected() {
    if(!state.selected||state.humanReady)return false;
    const current=state.selected,next=(current.rotation+1)%4,size=pieceSize(current.type,next);
    const cx=current.x+current.w/2,cy=current.y+current.h/2;
    const rotated=createPiece(current.type,Math.round((cx-size.w/2)/7)*7,Math.round((cy-size.h/2)/7)*7,next,{phase:current.phase});
    if(!validPiece(rotated,current)){state.toast={text:'旋转后会碰到其他机关',time:1.5};sound('hurt');return false;}
    const idx=state.placed.indexOf(current);if(idx>=0)state.placed[idx]=rotated;
    state.selected=rotated;state.toast={text:`已旋转 ${next*90}°`,time:1.2};sound('click');return true;
  }

  function pointerDown(e) {
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); canvas.focus();
    const p=pointFromEvent(e);
    if(state.mode==='menu'){
      if(p.x>=W-70&&p.y<=55){toggleSound();return;}
      if(p.y>=165&&p.y<=350){const col=Math.floor((p.x-25)/124),row=Math.floor((p.y-168)/96),i=row*3+col;if(col>=0&&col<3&&row>=0&&row<2&&i>=0&&i<CHARACTERS.length){state.selectedCharacter=CHARACTERS[i].id;resetBots();sound('click');return;}}
      if(p.y>=408&&p.y<=474){const count=Math.floor((p.x-30)/88)+1;if(count>=1&&count<=4){state.playerCount=count;resetBots();sound('click');return;}}
      if(p.y>=512&&p.y<=558&&p.x>=80&&p.x<=405){const i=Math.floor((p.x-88)/98);if(i>=0&&i<MAPS.length){state.selectedMap=i;storageSet('party-maker-map',String(i));sound('click');return;}}
      if(p.x>=55&&p.x<=365&&p.y>=570&&p.y<=650){startGame();return;}
    } else if(state.mode==='build'){
      if(p.x>=W-70&&p.y<=55){toggleSound();return;}
      if(!state.humanReady&&state.selected&&p.x>=207&&p.x<=264&&p.y>=68&&p.y<=122){rotateSelected();return;}
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
    } else if(state.mode==='complete'&&p.x>=78&&p.x<=342&&p.y>=610&&p.y<=700){showMenu();sound('click');}
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
    if(e.code==='Space'&&state.mode==='build'){
      if(!e.repeat)rotateSelected();
      return;
    }
    if(!state.keys.has(e.code)&&(e.code==='ArrowUp'||e.code==='Space'||e.code==='KeyW'))queueJump();
    if(e.code==='KeyR'&&state.mode==='race')death('选择了快速重生');
    if(e.code==='Enter'&&state.mode==='menu')startGame();
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
      playerCount:state.playerCount,selectedCharacter:state.selectedCharacter,selectedMap:state.selectedMap,
      availableCharacters:CHARACTERS.map(character=>character.id),assetsLoaded:assetStatus.loaded,assetsFailed:assetStatus.failed,
      selectedRotation:state.selected?state.selected.rotation:null,
      botsPlaced:state.botBuild.filter(p=>p.placed).length,
      placedDetails:state.placed.map(p=>{const offset=p.type==='moving'&&state.mode==='race'?Math.sin(performance.now()*.0017+(p.phase||0))*54:0;return{type:p.type,rotation:p.rotation||0,x:p.x,y:p.y,renderX:p.x+((p.rotation||0)%2?offset:0),renderY:p.y+((p.rotation||0)%2?0:offset)}}),
      player:state.player?{x:state.player.x,y:state.player.y,vx:state.player.vx,vy:state.player.vy,grounded:state.player.grounded,dead:state.player.dead,fallGuards:state.player.fallGuards}:null}),
    restart,
  };

  const initialize = () => {
    if(!CHARACTERS.some(character=>character.id===state.selectedCharacter))state.selectedCharacter='dino';
    state.player=freshPlayer();resetBots();state.mode='menu';loading.classList.add('hidden');
    requestAnimationFrame(now=>{state.lastTime=now;loop(now);});
  };
  loadAssets().then(initialize, initialize);
})();
