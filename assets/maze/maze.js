// superhard.quest: today's maze, in the dark. You see a step or two around you; somewhere is a
// door, and it opens onto monolito.dev. A new maze every day, the same one for everyone. Plain canvas.

const COLS = 19, ROWS = 19;
const SIGHT = 2.4;            // how many cells the light reaches
const GLOW = 7;               // how near the door must be before its glow shows through the walls
const STEP = 0.1;             // seconds a step takes
const N = 1, E = 2, S = 4, W = 8;
const DIRS = { N: [0, -1, N, S], E: [1, 0, E, W], S: [0, 1, S, N], W: [-1, 0, W, E] };
const KEYS = {
  ArrowUp: 'N', KeyW: 'N', ArrowRight: 'E', KeyD: 'E', ArrowDown: 'S', KeyS: 'S', ArrowLeft: 'W', KeyA: 'W',
};
const INK = [236, 233, 226], RED = [224, 49, 43];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const ui = {
  root: $('quest'), canvas: $('maze'), moves: $('moves'), clock: $('clock'), card: $('card'),
  kicker: $('kicker'), title: $('title'), text: $('text'), actions: $('actions'), small: $('small'), go: $('go'),
};
const ctx = ui.canvas.getContext('2d');
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

// ------------------------------------------------------------------ the maze

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const day = new Date().toISOString().slice(0, 10);
let seed = 2166136261;
for (const ch of `superhard:${day}`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);

const at = (x, y) => y * COLS + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;

// a depth-first maze, then a few walls knocked through so it has loops and no single wall to follow
function carve(rand) {
  const open = new Uint8Array(COLS * ROWS), seen = new Uint8Array(COLS * ROWS);
  const stack = [[0, 0]];
  seen[0] = 1;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const ways = Object.values(DIRS).filter(([dx, dy]) => inside(x + dx, y + dy) && !seen[at(x + dx, y + dy)]);
    if (!ways.length) { stack.pop(); continue; }
    const [dx, dy, bit, back] = ways[Math.floor(rand() * ways.length)];
    open[at(x, y)] |= bit;
    open[at(x + dx, y + dy)] |= back;
    seen[at(x + dx, y + dy)] = 1;
    stack.push([x + dx, y + dy]);
  }
  for (let i = 0; i < COLS * ROWS * 0.05; i++) {
    const x = 1 + Math.floor(rand() * (COLS - 2)), y = 1 + Math.floor(rand() * (ROWS - 2));
    const [dx, dy, bit, back] = Object.values(DIRS)[Math.floor(rand() * 4)];
    open[at(x, y)] |= bit;
    open[at(x + dx, y + dy)] |= back;
  }
  return open;
}

// the door goes where the walk from the start is longest
function farthest(open, sx, sy) {
  const dist = new Int32Array(COLS * ROWS).fill(-1);
  const queue = [[sx, sy]];
  dist[at(sx, sy)] = 0;
  let far = [sx, sy];
  while (queue.length) {
    const [x, y] = queue.shift();
    if (dist[at(x, y)] > dist[at(...far)]) far = [x, y];
    for (const [dx, dy, bit] of Object.values(DIRS)) {
      if (!(open[at(x, y)] & bit) || dist[at(x + dx, y + dy)] >= 0) continue;
      dist[at(x + dx, y + dy)] = dist[at(x, y)] + 1;
      queue.push([x + dx, y + dy]);
    }
  }
  return far;
}

const START = [Math.floor(COLS / 2), Math.floor(ROWS / 2)];
const open = carve(rng(seed >>> 0));
const DOOR = farthest(open, ...START);

// ------------------------------------------------------------------ state

let state = 'title';                      // title, play, won
const me = { x: START[0], y: START[1], fx: START[0], fy: START[1], t: 1, px: START[0], py: START[1] };
let held = null, queued = null;
let moves = 0, started = 0, elapsed = 0;
let bump = { dx: 0, dy: 0, t: 1 };
let reveal = 0;                           // 0 in the dark, 1 with the whole maze lit after the door
const seen = new Uint8Array(COLS * ROWS);
const trail = new Uint8Array(COLS * ROWS);
const cam = { x: START[0], y: START[1], cs: 60 };

function look() {
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (Math.hypot(x - me.x, y - me.y) <= SIGHT) seen[at(x, y)] = 1;
  }
  trail[at(me.x, me.y)] = 1;
}

function tryMove(dir) {
  if (state !== 'play') return;
  if (me.t < 1) { queued = dir; return; }
  const [dx, dy, bit] = DIRS[dir];
  if (!(open[at(me.x, me.y)] & bit)) {
    bump = { dx, dy, t: 0 };
    if (navigator.vibrate && matchMedia('(hover: none)').matches) navigator.vibrate(6);
    return;
  }
  Object.assign(me, { fx: me.x, fy: me.y, x: me.x + dx, y: me.y + dy, t: 0 });
  moves++;
  ui.moves.textContent = `${moves} move${moves === 1 ? '' : 's'}`;
}

function arrive() {
  look();
  if (me.x === DOOR[0] && me.y === DOOR[1]) return win();
  const next = queued || held;
  queued = null;
  if (next) tryMove(next);
}

const clockText = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function begin() {
  Object.assign(me, { x: START[0], y: START[1], fx: START[0], fy: START[1], t: 1, px: START[0], py: START[1] });
  seen.fill(0); trail.fill(0);
  moves = 0; elapsed = 0; reveal = 0; held = null; queued = null;
  started = performance.now();
  ui.moves.textContent = '0 moves';
  ui.clock.textContent = '0:00';
  look();
  state = 'play';
  ui.root.classList.add('is-play');
  ui.card.classList.add('away');
  ui.card.inert = true;
  document.activeElement?.blur();
}

function win() {
  state = 'won';
  held = null;
  elapsed = (performance.now() - started) / 1000;
  const key = `superhard.best.${day}`, best = Number(store.get(key)) || 0;
  if (!best || elapsed < best) store.set(key, String(elapsed));
  ui.root.classList.remove('is-play');
  setTimeout(() => {
    ui.kicker.textContent = 'out';
    ui.title.textContent = 'You found the door.';
    ui.text.textContent = 'It opens onto monolito.dev.';
    ui.actions.innerHTML = '<a class="q-go red" href="https://monolito.dev">Go through →</a><button class="q-link" type="button" id="again">Walk it again</button>';
    $('again').addEventListener('click', begin);
    const bestNow = Math.min(elapsed, best || elapsed);
    ui.small.textContent = `${clockText(elapsed)} · ${moves} moves${bestNow < elapsed ? ` · your best today ${clockText(bestNow)}` : ''} · a new maze tomorrow`;
    ui.card.classList.remove('away');
    ui.card.inert = false;
  }, 1300);
}

// ------------------------------------------------------------------ input

addEventListener('keydown', (e) => {
  const dir = KEYS[e.code];
  if (!dir) {
    if ((e.code === 'Enter' || e.code === 'Space') && state === 'title' && !e.target.closest?.('a, button')) { e.preventDefault(); begin(); }
    return;
  }
  e.preventDefault();
  if (state === 'title') begin();
  held = dir;
  if (!e.repeat) tryMove(dir);
});
addEventListener('keyup', (e) => { if (KEYS[e.code] === held) held = null; });
addEventListener('blur', () => { held = null; });

// on a touch screen, drag in a direction to walk that way, and keep dragging to keep walking
const drag = { on: false, x: 0, y: 0 };
ui.canvas.addEventListener('pointerdown', (e) => {
  Object.assign(drag, { on: true, x: e.clientX, y: e.clientY });
  ui.canvas.setPointerCapture(e.pointerId);
});
ui.canvas.addEventListener('pointermove', (e) => {
  if (!drag.on || state !== 'play') return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y, reach = Math.max(18, cam.cs * 0.35);
  if (Math.max(Math.abs(dx), Math.abs(dy)) < reach) return;
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
  drag.x = e.clientX; drag.y = e.clientY;
  held = dir;
  tryMove(dir);
});
const letGo = () => { drag.on = false; held = null; };
ui.canvas.addEventListener('pointerup', letGo);
ui.canvas.addEventListener('pointercancel', letGo);
ui.go.addEventListener('click', begin);

// ------------------------------------------------------------------ drawing

let dpr = 1, vw = 0, vh = 0;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  vw = innerWidth; vh = innerHeight;
  ui.canvas.width = Math.round(vw * dpr);
  ui.canvas.height = Math.round(vh * dpr);
}
addEventListener('resize', resize);

const ease = (t) => 1 - (1 - t) ** 3;
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function light(d, sight) {
  // full light near you, fading to nothing at the edge of sight
  return Math.max(0, Math.min(1, (sight + 0.6 - d) / 1.6));
}

function draw() {
  const sight = SIGHT + reveal * 40;
  const fit = Math.min(vw, vh) * 0.86 / Math.max(COLS, ROWS);
  const near = Math.max(40, Math.min(84, Math.min(vw, vh) / 7.2));
  const cs = cam.cs = near + (fit - near) * ease(reveal);
  const b = bump.t < 1 ? Math.sin(bump.t * Math.PI) * 0.12 : 0;
  const ox = vw / 2 - (cam.x + 0.5 + bump.dx * b) * cs, oy = vh / 2 - (cam.y + 0.5 + bump.dy * b) * cs;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d0d0e';
  ctx.fillRect(0, 0, vw, vh);

  const sx = (x) => ox + x * cs, sy = (y) => oy + y * cs;
  const pcx = me.px + 0.5, pcy = me.py + 0.5;

  // the lamp around you
  const lamp = ctx.createRadialGradient(sx(pcx), sy(pcy), 0, sx(pcx), sy(pcy), (SIGHT + 1) * cs);
  lamp.addColorStop(0, 'rgba(236,233,226,0.07)');
  lamp.addColorStop(1, 'rgba(236,233,226,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, vw, vh);

  // the door's glow, felt through the walls before it can be seen
  const dd = Math.hypot(DOOR[0] - me.px, DOOR[1] - me.py);
  const glow = Math.max(0, 1 - dd / GLOW) * 0.55 + reveal * 0.3;
  if (glow > 0) {
    const g = ctx.createRadialGradient(sx(DOOR[0] + 0.5), sy(DOOR[1] + 0.5), 0, sx(DOOR[0] + 0.5), sy(DOOR[1] + 0.5), cs * 3.2);
    g.addColorStop(0, rgba(RED, glow * 0.5));
    g.addColorStop(1, rgba(RED, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
  }

  // the way you came
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!trail[at(x, y)]) continue;
    const a = Math.max(light(Math.hypot(x - me.px, y - me.py), sight) * 0.5, 0.12 + reveal * 0.5);
    ctx.fillStyle = rgba(RED, a);
    ctx.beginPath();
    ctx.arc(sx(x + 0.5), sy(y + 0.5), Math.max(1.5, cs * 0.05), 0, Math.PI * 2);
    ctx.fill();
  }

  // walls: each cell draws its top and left, the edge cells their bottom and right
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, cs * 0.06);
  const wall = (x1, y1, x2, y2, known) => {
    const d = Math.hypot((x1 + x2) / 2 - pcx, (y1 + y2) / 2 - pcy);
    const a = Math.max(light(d, sight), known ? 0.13 : 0);
    if (a <= 0.01) return;
    ctx.strokeStyle = rgba(INK, a);
    ctx.beginPath();
    ctx.moveTo(sx(x1), sy(y1));
    ctx.lineTo(sx(x2), sy(y2));
    ctx.stroke();
  };
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const o = open[at(x, y)], known = seen[at(x, y)];
    if (!(o & N)) wall(x, y, x + 1, y, known);
    if (!(o & W)) wall(x, y, x, y + 1, known);
    if (x === COLS - 1 && !(o & E)) wall(x + 1, y, x + 1, y + 1, known);
    if (y === ROWS - 1 && !(o & S)) wall(x, y + 1, x + 1, y + 1, known);
  }

  // the door
  const doorLit = Math.max(light(dd, sight), seen[at(...DOOR)] ? 0.4 : 0);
  if (doorLit > 0.01) {
    const s = cs * 0.34, x = sx(DOOR[0] + 0.5) - s / 2, y = sy(DOOR[1] + 0.5) - s * 0.62;
    ctx.fillStyle = rgba(RED, doorLit);
    ctx.beginPath();
    ctx.roundRect(x, y, s, s * 1.3, [s * 0.5, s * 0.5, 2, 2]);
    ctx.fill();
  }

  // you
  const r = cs * 0.17;
  ctx.fillStyle = rgba(INK, 1);
  ctx.shadowColor = 'rgba(236,233,226,0.6)';
  ctx.shadowBlur = cs * 0.4;
  ctx.beginPath();
  ctx.arc(sx(pcx), sy(pcy), r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

// ------------------------------------------------------------------ loop

let last = 0;
function frame(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0;
  last = now;
  if (me.t < 1) {
    me.t = Math.min(1, me.t + dt / (reduceMotion ? 0.06 : STEP));
    const k = me.t;
    me.px = me.fx + (me.x - me.fx) * k;
    me.py = me.fy + (me.y - me.fy) * k;
    if (me.t >= 1) arrive();
  }
  if (bump.t < 1) bump.t = Math.min(1, bump.t + dt / 0.16);
  if (state === 'won') reveal = Math.min(1, reveal + dt / 1.6);
  const target = state === 'won' ? [(COLS - 1) / 2, (ROWS - 1) / 2] : [me.px, me.py];
  const k = 1 - Math.exp(-dt * (state === 'won' ? 3 : 9));
  cam.x += (target[0] - cam.x) * k;
  cam.y += (target[1] - cam.y) * k;
  if (state === 'play') {
    elapsed = (now - started) / 1000;
    ui.clock.textContent = clockText(elapsed);
  }
  draw();
  requestAnimationFrame(frame);
}

resize();
look();
const bestToday = Number(store.get(`superhard.best.${day}`)) || 0;
if (bestToday) ui.small.textContent = `you've been out once today, in ${clockText(bestToday)}`;
requestAnimationFrame(frame);
