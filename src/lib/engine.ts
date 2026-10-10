export const W = 600;
export const H = 900;
export const PITCH = { l: 70, r: 530, t: 120, b: 780 };
export const GOAL = { x1: 235, x2: 365, depth: 34 };
export const DISC_R = 24;
export const BALL_R = 15;
export const MAX_PULL = 130;
export const MAX_SPEED = 24;

export type Body = { x: number; y: number; vx: number; vy: number; r: number; m: number; team: 0 | 1 | -1 };

const cx = (PITCH.l + PITCH.r) / 2;
const cy = (PITCH.t + PITCH.b) / 2;

// team 0 = player (bottom, attacks top). team 1 = CPU (top, attacks bottom).
const FORMATION: [number, number][] = [
  [0, 0.42], [-0.32, 0.26], [0.32, 0.26], [-0.18, 0.1], [0.18, 0.1],
];

export function setup(): Body[] {
  const bodies: Body[] = [];
  const hw = (PITCH.r - PITCH.l) / 2;
  const hh = (PITCH.b - PITCH.t) / 2;
  for (const team of [0, 1] as const) {
    for (const [fx, fy] of FORMATION) {
      const s = team === 0 ? 1 : -1;
      bodies.push({ x: cx + fx * hw * s, y: cy + fy * hh * 2 * s * 0.9, vx: 0, vy: 0, r: DISC_R, m: 2, team });
    }
  }
  bodies.push({ x: cx, y: cy, vx: 0, vy: 0, r: BALL_R, m: 1, team: -1 });
  return bodies;
}

const POSTS = [
  { x: GOAL.x1, y: PITCH.t }, { x: GOAL.x2, y: PITCH.t },
  { x: GOAL.x1, y: PITCH.b }, { x: GOAL.x2, y: PITCH.b },
];

/** Steps physics; returns 0/1 for the team that scored, or null. */
export function step(bodies: Body[]): 0 | 1 | null {
  for (const b of bodies) {
    b.x += b.vx; b.y += b.vy;
    b.vx *= 0.984; b.vy *= 0.984;
    if (Math.hypot(b.vx, b.vy) < 0.06) { b.vx = 0; b.vy = 0; }
    walls(b);
  }
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) collide(bodies[i], bodies[j]);
  for (const b of bodies) for (const p of POSTS) collidePost(b, p);

  const ball = bodies[bodies.length - 1];
  if (ball.y < PITCH.t - ball.r) return 0;
  if (ball.y > PITCH.b + ball.r) return 1;
  return null;
}

function walls(b: Body) {
  const e = 0.75;
  if (b.x - b.r < PITCH.l) { b.x = PITCH.l + b.r; b.vx = Math.abs(b.vx) * e; }
  if (b.x + b.r > PITCH.r) { b.x = PITCH.r - b.r; b.vx = -Math.abs(b.vx) * e; }
  const inMouth = b.team === -1 && b.x > GOAL.x1 && b.x < GOAL.x2;
  if (!inMouth) {
    if (b.y - b.r < PITCH.t && b.y > PITCH.t - 2) { b.y = PITCH.t + b.r; b.vy = Math.abs(b.vy) * e; }
    if (b.y + b.r > PITCH.b && b.y < PITCH.b + 2) { b.y = PITCH.b - b.r; b.vy = -Math.abs(b.vy) * e; }
  }
}

function collide(a: Body, b: Body) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy), min = a.r + b.r;
  if (d === 0 || d >= min) return;
  const nx = dx / d, ny = dy / d;
  const overlap = (min - d) / 2;
  a.x -= nx * overlap; a.y -= ny * overlap;
  b.x += nx * overlap; b.y += ny * overlap;
  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rv > 0) return;
  const j = (-(1 + 0.9) * rv) / (1 / a.m + 1 / b.m);
  a.vx -= (j / a.m) * nx; a.vy -= (j / a.m) * ny;
  b.vx += (j / b.m) * nx; b.vy += (j / b.m) * ny;
}

function collidePost(b: Body, p: { x: number; y: number }) {
  const dx = b.x - p.x, dy = b.y - p.y;
  const d = Math.hypot(dx, dy), min = b.r + 5;
  if (d === 0 || d >= min) return;
  const nx = dx / d, ny = dy / d;
  b.x = p.x + nx * min; b.y = p.y + ny * min;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) { b.vx -= 1.8 * vn * nx; b.vy -= 1.8 * vn * ny; }
}

export const moving = (bodies: Body[]) => bodies.some((b) => b.vx !== 0 || b.vy !== 0);

/** CPU picks a disc + velocity aimed at pushing the ball toward the bottom goal. */
export function cpuMove(bodies: Body[]): { idx: number; vx: number; vy: number } {
  const ball = bodies[bodies.length - 1];
  const gx = cx, gy = PITCH.b + 20;
  const gdx = gx - ball.x, gdy = gy - ball.y, gd = Math.hypot(gdx, gdy);
  const ux = gdx / gd, uy = gdy / gd;
  let best = { idx: 5, score: -Infinity, tx: ball.x, ty: ball.y };
  bodies.forEach((b, idx) => {
    if (b.team !== 1) return;
    const hx = ball.x - ux * (b.r + ball.r - 2), hy = ball.y - uy * (b.r + ball.r - 2);
    const dx = hx - b.x, dy = hy - b.y, d = Math.hypot(dx, dy);
    const align = (dx * ux + dy * uy) / (d || 1);
    const score = align * 2 - d / 300;
    if (score > best.score) best = { idx, score, tx: hx, ty: hy };
  });
  const b = bodies[best.idx];
  let ang = Math.atan2(best.ty - b.y, best.tx - b.x) + (Math.random() - 0.5) * 0.12;
  const d = Math.hypot(best.tx - b.x, best.ty - b.y);
  const speed = Math.min(MAX_SPEED, 11 + d * 0.035 + Math.random() * 4);
  return { idx: best.idx, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed };
}
