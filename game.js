(() => {
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.querySelector('#score');
  const highScoreEl = document.querySelector('#high-score');
  const livesEl = document.querySelector('#lives');
  const intro = document.querySelector('#intro');
  const startButton = document.querySelector('#start-button');
  const message = document.querySelector('#message');
  const skillCards = [...document.querySelectorAll('[data-skill]')];

  const tile = 32, cols = 21, rows = 21;
  // #: wall, .: dot, o: power pellet, S: player, G: ghost spawn, space: empty path
  const template = [
    '#####################',
    '#o.................o#',
    '#.###.###.#.###.###.#',
    '#.###.###.#.###.###.#',
    '#.###.###. .###.###.#',
    '#.................#.#',
    '###.#.#####.#####.#.#',
    '#...#...#     #...#.#',
    '#.#####.# ### #.###.#',
    '#.......#GGGGG#.....#',
    '######.### # ########',
    '#...#...#     #...#.#',
    '###.#.#####.#####.#.#',
    '#........#........#.#',
    '#.###.##.#.##.###.#.#',
    '#o..#....S....#..o..#',
    '###.#.#####.#####.###',
    '#........#........#.#',
    '#.######.#.######.#.#',
    '#...................#',
    '#####################'
  ];
  const DIRS = { left: { x: -1, y: 0, a: Math.PI }, right: { x: 1, y: 0, a: 0 }, up: { x: 0, y: -1, a: -Math.PI / 2 }, down: { x: 0, y: 1, a: Math.PI / 2 } };
  const keys = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', s: 'down', A: 'left', D: 'right', S: 'down' };
  const ghostColors = ['#ff5c68', '#55e3ff', '#ff9bc5', '#ff9f43', '#b78cff'];
  const skills = { jump: { cooldown: 10000, readyAt: 0 }, freeze: { cooldown: 20000, readyAt: 0 }, warp: { cooldown: 30000, readyAt: 0 } };
  const WARP_TARGET = { x: 10, y: 10 };
  let maze, dots, player, ghosts, score, lives, poweredUntil, ghostChain, running = false, paused = false, lastTime = 0, highScore = +localStorage.getItem('pac-maze-high-score') || 0;
  highScoreEl.textContent = String(highScore).padStart(5, '0');

  const inside = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols;
  const isWall = (x, y) => !inside(x, y) || maze[y][x] === '#';
  // Actors are snapped only after they cross a tile centre. A wide "near centre"
  // tolerance made ghosts jump back to their previous position every frame.
  const atCenter = p => Math.abs(p.x - Math.round(p.x)) < .001 && Math.abs(p.y - Math.round(p.y)) < .001;
  function resetBoard(full = true) {
    maze = template.map(r => r.split(''));
    dots = new Map();
    ghosts = [];
    template.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.' || ch === 'o') dots.set(`${x},${y}`, ch);
      if (ch === 'S') player = { x, y, spawnX: x, spawnY: y, dir: DIRS.left, next: DIRS.left, mouth: 0, dead: false };
      if (ch === 'G') ghosts.push({ x, y, spawnX: x, spawnY: y, dir: DIRS.up, color: ghostColors[ghosts.length], eyes: false, frozenUntil: 0 });
      if (ch === 'S' || ch === 'G') maze[y][x] = ' ';
    }));
    if (full) { score = 0; lives = 3; Object.values(skills).forEach(skill => { skill.readyAt = 0; }); }
    poweredUntil = 0; ghostChain = 0;
    updateHUD();
  }
  function resetActors() {
    player.x = player.spawnX; player.y = player.spawnY; player.dir = player.next = DIRS.left; player.dead = false;
    ghosts.forEach((g, i) => Object.assign(g, { x: g.spawnX, y: g.spawnY, dir: i === 1 ? DIRS.left : DIRS.up, eyes: false, frozenUntil: 0 }));
    poweredUntil = 0; ghostChain = 0;
  }
  function updateHUD() {
    scoreEl.textContent = String(score).padStart(5, '0');
    livesEl.textContent = '● '.repeat(lives).trim() || '—';
    if (score > highScore) { highScore = score; localStorage.setItem('pac-maze-high-score', highScore); highScoreEl.textContent = String(highScore).padStart(5, '0'); }
  }
  function updateSkills(now = performance.now()) {
    skillCards.forEach(card => {
      const skill = skills[card.dataset.skill], remaining = Math.max(0, skill.readyAt - now), ready = remaining <= 0;
      card.classList.toggle('ready', ready);
      card.querySelector('.skill-status').textContent = ready ? '사용 가능' : `${(remaining / 1000).toFixed(1)}초`;
    });
  }
  function useSkill(name, now = performance.now()) {
    if (!running || paused) { show(paused ? '일시 정지 중입니다' : '게임을 시작하세요', 650); return false; }
    const skill = skills[name];
    if (skill.readyAt > now) { show(`재사용까지 ${Math.ceil((skill.readyAt - now) / 1000)}초`, 700); return false; }
    skill.readyAt = now + skill.cooldown; updateSkills(now); return true;
  }
  function jump() {
    const now = performance.now();
    if (!running || paused) return useSkill('jump', now);
    const x = Math.round(player.x), y = Math.round(player.y), direction = player.dir, landingX = x + direction.x * 2, landingY = y + direction.y * 2;
    if (!isWall(x + direction.x, y + direction.y)) { show('앞에 넘을 벽이 없어요', 700); return; }
    if (isWall(landingX, landingY)) { show('벽 너머에 착지할 길이 없어요', 850); return; }
    if (!useSkill('jump', now)) return;
    player.x = landingX; player.y = landingY; show('점프!', 600);
  }
  function freeze() {
    const now = performance.now();
    if (!running || paused) return useSkill('freeze', now);
    const targets = ghosts.filter(g => Math.abs(Math.round(g.x) - Math.round(player.x)) <= 2 && Math.abs(Math.round(g.y) - Math.round(player.y)) <= 2);
    if (!targets.length) { show('얼릴 몬스터가 반경 안에 없어요', 850); return; }
    if (!useSkill('freeze', now)) return;
    targets.forEach(g => { g.frozenUntil = now + 3000; }); show(`${targets.length}마리 얼리기!`, 750);
  }
  function warp() {
    if (!useSkill('warp')) return;
    player.x = WARP_TARGET.x; player.y = WARP_TARGET.y; show('중앙으로 워프!', 700);
  }
  function show(text, duration = 900) { message.textContent = text; message.classList.add('visible'); window.setTimeout(() => message.classList.remove('visible'), duration); }
  function canMove(p, direction) { return !isWall(Math.round(p.x) + direction.x, Math.round(p.y) + direction.y); }
  function moveEntity(p, speed, dt) {
    if (atCenter(p)) {
      p.x = Math.round(p.x); p.y = Math.round(p.y);
      if (p.next && canMove(p, p.next)) p.dir = p.next;
      if (!canMove(p, p.dir)) return;
    }
    const previousX = p.x, previousY = p.y;
    p.x += p.dir.x * speed * dt; p.y += p.dir.y * speed * dt;
    // Keep grid decisions exact without pulling an actor backwards just after it leaves a tile.
    if (p.dir.x > 0 && Math.floor(p.x) > Math.floor(previousX)) p.x = Math.round(p.x);
    if (p.dir.x < 0 && Math.ceil(p.x) < Math.ceil(previousX)) p.x = Math.round(p.x);
    if (p.dir.y > 0 && Math.floor(p.y) > Math.floor(previousY)) p.y = Math.round(p.y);
    if (p.dir.y < 0 && Math.ceil(p.y) < Math.ceil(previousY)) p.y = Math.round(p.y);
    if (p.x < -.45) p.x = cols - .55;
    if (p.x > cols - .55) p.x = -.45;
  }
  function eat() {
    if (!atCenter(player)) return;
    const key = `${Math.round(player.x)},${Math.round(player.y)}`;
    const item = dots.get(key);
    if (!item) return;
    dots.delete(key); score += item === 'o' ? 50 : 10;
    if (item === 'o') { poweredUntil = performance.now() + 6800; ghostChain = 0; show('파워 업!', 500); }
    updateHUD();
    if (!dots.size) { running = false; show('라운드 클리어!', 1300); window.setTimeout(() => { resetBoard(true); running = true; }, 1350); }
  }
  function chooseGhostDirection(g) {
    if (!atCenter(g)) return;
    g.x = Math.round(g.x); g.y = Math.round(g.y);
    const choices = Object.values(DIRS).filter(d => canMove(g, d) && !(d.x === -g.dir.x && d.y === -g.dir.y));
    if (!choices.length) { g.dir = { x: -g.dir.x, y: -g.dir.y, a: g.dir.a + Math.PI }; return; }
    const target = poweredUntil > performance.now() ? player : { x: player.x + (Math.random() - .5) * 7, y: player.y + (Math.random() - .5) * 7 };
    choices.sort((a, b) => ((g.x+a.x-target.x)**2+(g.y+a.y-target.y)**2) - ((g.x+b.x-target.x)**2+(g.y+b.y-target.y)**2));
    g.dir = (poweredUntil > performance.now() && Math.random() < .68) ? choices[choices.length - 1] : choices[0];
  }
  function collide() {
    ghosts.forEach(g => {
      const dx = player.x - g.x, dy = player.y - g.y;
      if (dx * dx + dy * dy > .42) return;
      if (poweredUntil > performance.now()) {
        ghostChain++; score += 200 * 2 ** (ghostChain - 1); updateHUD(); show(`${200 * 2 ** (ghostChain - 1)} 점!`, 600);
        g.x = g.spawnX; g.y = g.spawnY; g.dir = DIRS.up;
      } else if (!player.dead) {
        player.dead = true; running = false; lives--; updateHUD(); show('잡혔어요!', 1000);
        window.setTimeout(() => { if (lives > 0) { resetActors(); running = true; } else { intro.classList.remove('hidden'); startButton.innerHTML = '새 게임 <span>→</span>'; } }, 1050);
      }
    });
  }
  function drawWall(x, y) {
    ctx.fillStyle = '#0a1440'; ctx.fillRect(x * tile, y * tile, tile, tile);
    ctx.strokeStyle = '#285eea'; ctx.lineWidth = 3; ctx.strokeRect(x * tile + 1.5, y * tile + 1.5, tile - 3, tile - 3);
  }
  function drawPlayer(t) {
    const x = (player.x + .5) * tile, y = (player.y + .5) * tile;
    const mouth = .18 + Math.abs(Math.sin(t / 110)) * .23;
    ctx.fillStyle = '#ffdf30'; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, 13, player.dir.a + mouth, player.dir.a + Math.PI * 2 - mouth); ctx.closePath(); ctx.fill();
  }
  function drawGhost(g, t) {
    const x = (g.x + .5) * tile, y = (g.y + .53) * tile, frightened = poweredUntil > performance.now(), frozen = g.frozenUntil > performance.now();
    ctx.fillStyle = frozen ? '#69d8ff' : frightened ? (Math.floor(t / 180) % 2 && poweredUntil - performance.now() < 1800 ? '#f6f6f6' : '#376af5') : g.color;
    ctx.beginPath(); ctx.arc(x, y - 4, 12, Math.PI, 0); ctx.lineTo(x + 12, y + 11); ctx.lineTo(x + 6, y + 7); ctx.lineTo(x, y + 11); ctx.lineTo(x - 6, y + 7); ctx.lineTo(x - 12, y + 11); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x - 4.5, y - 3, 3.7, 4.7, 0, 0, Math.PI * 2); ctx.ellipse(x + 4.5, y - 3, 3.7, 4.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#16224e'; ctx.beginPath(); ctx.arc(x - 4.5 + g.dir.x * 1.5, y - 3 + g.dir.y * 1.5, 1.8, 0, Math.PI*2); ctx.arc(x + 4.5 + g.dir.x * 1.5, y - 3 + g.dir.y * 1.5, 1.8, 0, Math.PI*2); ctx.fill();
    if (frozen) { ctx.strokeStyle = '#e5fbff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - 1, 15, 0, Math.PI * 2); ctx.stroke(); }
  }
  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (maze[y][x] === '#') drawWall(x, y);
      const d = dots.get(`${x},${y}`);
      if (d) { ctx.fillStyle = d === 'o' ? '#ffb6d9' : '#ffeaca'; ctx.beginPath(); ctx.arc((x+.5)*tile, (y+.5)*tile, d === 'o' ? 6 + Math.sin(t/180)*1.5 : 2.1, 0, Math.PI*2); ctx.fill(); }
    }
    ghosts.forEach(g => drawGhost(g, t)); drawPlayer(t);
  }
  function loop(t) {
    const dt = Math.min((t - lastTime) / 1000 || 0, .045); lastTime = t;
    if (running && !paused) {
      moveEntity(player, 4.25, dt); eat();
      ghosts.forEach(g => { if (g.frozenUntil <= t) { chooseGhostDirection(g); moveEntity(g, poweredUntil > t ? 2.35 : 3.05, dt); } });
      collide();
    }
    draw(t); updateSkills(t); requestAnimationFrame(loop);
  }
  document.addEventListener('keydown', e => {
    if (!intro.classList.contains('hidden')) return;
    const key = e.key.toLowerCase();
    if (key === 'q') { jump(); e.preventDefault(); return; }
    if (key === 'w') { freeze(); e.preventDefault(); return; }
    if (key === 'e') { warp(); e.preventDefault(); return; }
    if (keys[e.key]) { player.next = DIRS[keys[e.key]]; e.preventDefault(); }
    if (e.code === 'Space' && !intro.classList.contains('hidden')) return;
    if (e.code === 'Space' && lives > 0) { paused = !paused; show(paused ? '일시 정지' : '계속!', 600); e.preventDefault(); }
    if (key === 'r') { resetBoard(true); running = true; paused = false; intro.classList.add('hidden'); }
  });
  startButton.addEventListener('click', () => { resetBoard(true); intro.classList.add('hidden'); running = true; paused = false; lastTime = performance.now(); show('READY!', 700); });
  resetBoard(true); draw(0); requestAnimationFrame(loop);
})();
