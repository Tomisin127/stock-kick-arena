import { useEffect, useRef, useState } from "react";
import {
  W, H, PITCH, GOAL, MAX_PULL, MAX_SPEED, setup, step, moving, cpuMove, type Body,
} from "@/lib/engine";
import type { Stock } from "@/lib/stocks";
import { sfxBounce, sfxGoal, sfxKick, sfxWhistle, sfxWin, setMuted, isMuted } from "@/lib/audio";

type Fan = { x: number; y: number; c: string; skin: string; phase: number; flag: boolean; hair: string };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; c: string; s: number; rot: number };
const SKINS = ["#f1c27d", "#e0ac69", "#8d5524", "#c68642", "#ffdbac"];
const HAIR = ["#2b1b0e", "#5a3a1a", "#f2d16b", "#1a1a1a", "#a0522d"];
const BLUE = "#3a86ff", BLUE_D = "#1e5bd6", RED = "#ef3b3b", RED_D = "#b81f2a", OUT = "#1a1d33", GOLD = "#ffd23f";
const CONFETTI = [GOLD, "#ffffff", BLUE, RED, "#7CFF6B", "#ff7ad9"];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;

function makeFans(): Fan[] {
  const fans: Fan[] = [];
  const add = (x: number, y: number) => {
    const bottom = y > H / 2;
    const pool = bottom ? [BLUE, BLUE_D, "#ffffff", BLUE] : [RED, RED_D, "#ffffff", RED];
    fans.push({ x, y, c: pick(pool), skin: pick(SKINS), hair: pick(HAIR), phase: Math.random() * 6.28, flag: Math.random() < 0.08 });
  };
  for (let row = 0; row < 3; row++) {
    for (let x = 26; x < W - 16; x += 21) {
      add(x + (row % 2) * 10, 24 + row * 25);
      add(x + (row % 2) * 10, H - 24 - row * 25);
    }
  }
  for (let col = 0; col < 2; col++) {
    for (let y = 118; y < H - 110; y += 21) {
      add(14 + col * 19, y + (col % 2) * 10);
      add(W - 14 - col * 19, y + (col % 2) * 10);
    }
  }
  return fans;
}

const ADS = ["STOCKBALL", "ONCHAIN", "BASE", "KICK = TX", "TOKENIZED", "GOAL!"];

// Online sync: host (team 0) runs physics; guest (team 1) sends kicks and renders snapshots.
export type NetMsg =
  | { t: "kick"; idx: number; vx: number; vy: number }
  | { t: "s"; b: number[]; turn: 0 | 1; phase: string; sc: [number, number]; lk: 0 | 1 }
  | { t: "fx"; k: "kick" | "bounce" | "goal" | "whistle"; x?: number; y?: number; g?: 0 | 1; v?: number }
  | { t: "banner"; text: string | null }
  | { t: "end"; sc: [number, number] };
export type Net = { role: "host" | "guest"; send: (m: NetMsg) => void; listen: (fn: (m: NetMsg) => void) => () => void };

export function Pitch({
  player, cpu, onKick, onGoal, onEnd, target = 3, net, oppName = "CPU",
}: {
  player: Stock; cpu: Stock; onKick: () => void;
  onGoal?: (team: 0 | 1) => void; onEnd: (score: [number, number]) => void; target?: number;
  net?: Net; oppName?: string;
}) {
  // In online mode `player` = host's stock (team 0), `cpu` = guest's stock (team 1).
  const myTeam: 0 | 1 = net?.role === "guest" ? 1 : 0;
  const flip = myTeam === 1;
  const canvas = useRef<HTMLCanvasElement>(null);
  const bodies = useRef<Body[]>([]);
  const fans = useRef<Fan[]>([]);
  const parts = useRef<Particle[]>([]);
  const trail = useRef<{ x: number; y: number }[]>([]);
  const turn = useRef<0 | 1>(0);
  const phase = useRef<"aim" | "moving" | "goal" | "over">("aim");
  const drag = useRef<{ idx: number; px: number; py: number } | null>(null);
  const cheer = useRef(0);
  const shake = useRef(0);
  const flash = useRef(0);
  const ballSpin = useRef(0);
  const lastKicker = useRef<0 | 1>(0);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const scoreRef = useRef<[number, number]>([0, 0]);
  const [turnUi, setTurnUi] = useState<0 | 1>(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [muted, setMutedUi] = useState(isMuted());
  const cb = useRef({ onKick, onGoal, onEnd });
  cb.current = { onKick, onGoal, onEnd };

  const burst = (x: number, y: number, n: number, colors: string[], speed: number, size = 4) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
      parts.current.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 40 + Math.random() * 40, c: pick(colors), s: size * (0.5 + Math.random()), rot: Math.random() * 6 });
    }
  };
  const fxKick = (x: number, y: number, v: number) => { sfxKick(v); burst(x, y, 10, ["#e9f5d0", "#b9e08a"], 3, 3); };
  const fxGoal = (g: 0 | 1) => {
    cheer.current = 180; shake.current = 14; flash.current = 1;
    burst((GOAL.x1 + GOAL.x2) / 2, g === 0 ? PITCH.t : PITCH.b, 90, CONFETTI, 9, 6);
    for (let k = 0; k < 6; k++) burst(60 + Math.random() * (W - 120), g === 0 ? 60 : H - 60, 15, CONFETTI, 6, 5);
    sfxGoal();
  };
  const sendRef = useRef(net);
  sendRef.current = net;

  useEffect(() => {
    bodies.current = setup();
    fans.current = makeFans();
    const ctx = canvas.current!.getContext("2d")!;
    let raf = 0, t = 0, cpuTimer: ReturnType<typeof setTimeout> | null = null;
    const isGuest = net?.role === "guest";
    const isHost = net?.role === "host";
    const send = (m: NetMsg) => sendRef.current?.send(m);
    sfxWhistle();

    const showBanner = (text: string | null) => { setBanner(text); if (isHost) send({ t: "banner", text }); };
    const snapshot = () => {
      if (!isHost) return;
      send({ t: "s", b: bodies.current.flatMap((b) => [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, +(b.vx !== 0 || b.vy !== 0)]),
        turn: turn.current, phase: phase.current, sc: scoreRef.current, lk: lastKicker.current });
    };

    const applyKick = (team: 0 | 1, idx: number, vx: number, vy: number) => {
      const b = bodies.current[idx];
      if (!b || b.team !== team || phase.current !== "aim" || turn.current !== team) return;
      const sp = Math.hypot(vx, vy);
      if (!isFinite(sp) || sp === 0) return;
      const k = Math.min(1, MAX_SPEED / sp);
      b.vx = vx * k; b.vy = vy * k;
      fxKick(b.x, b.y, Math.min(sp, MAX_SPEED) / MAX_SPEED);
      if (isHost) send({ t: "fx", k: "kick", x: b.x, y: b.y, v: Math.min(sp, MAX_SPEED) / MAX_SPEED });
      lastKicker.current = team;
      phase.current = "moving";
      snapshot();
    };

    const opponentTurn = () => {
      if (net) return; // online: wait for opponent's kick message
      cpuTimer = setTimeout(() => {
        if (phase.current !== "aim" || turn.current !== 1) return;
        const m = cpuMove(bodies.current);
        applyKick(1, m.idx, m.vx, m.vy);
      }, 900);
    };

    const unlisten = net?.listen((m) => {
      if (isHost && m.t === "kick") applyKick(1, m.idx, m.vx, m.vy);
      if (!isGuest) return;
      if (m.t === "s") {
        m.b.forEach((v, i) => {
          const b = bodies.current[Math.floor(i / 3)]; if (!b) return;
          const f = i % 3;
          if (f === 0) b.x = v; else if (f === 1) b.y = v; else { b.vx = v ? 1 : 0; b.vy = 0; }
        });
        if (turn.current !== m.turn) { turn.current = m.turn; setTurnUi(m.turn); }
        phase.current = m.phase as typeof phase.current;
        lastKicker.current = m.lk;
        if (m.sc[0] !== scoreRef.current[0] || m.sc[1] !== scoreRef.current[1]) { scoreRef.current = m.sc; setScore(m.sc); }
      } else if (m.t === "fx") {
        if (m.k === "kick" && lastKicker.current !== 1) fxKick(m.x ?? 0, m.y ?? 0, m.v ?? 1);
        if (m.k === "kick") lastKicker.current = 0;
        if (m.k === "bounce") { sfxBounce(m.v ?? 2); burst(m.x ?? 0, m.y ?? 0, 4, ["#ffffff", GOLD], 2, 2.5); }
        if (m.k === "goal" && m.g !== undefined) { fxGoal(m.g); cb.current.onGoal?.(m.g); }
        if (m.k === "whistle") sfxWhistle();
      } else if (m.t === "banner") {
        setBanner(m.text === "YOU WIN!" ? "YOU LOSE" : m.text === "THEY WIN!" ? "YOU WIN!" : m.text);
      } else if (m.t === "end") {
        sfxWin(m.sc[1] > m.sc[0]);
        setTimeout(() => cb.current.onEnd(m.sc), 1500);
      }
    });

    const loop = () => {
      t += 1;
      if (cheer.current > 0) cheer.current -= 1;
      if (shake.current > 0) shake.current *= 0.9;
      if (flash.current > 0) flash.current -= 0.04;
      if (phase.current === "moving" && !isGuest) {
        for (let s = 0; s < 2; s++) {
          const ball = bodies.current[bodies.current.length - 1]!;
          const pvx = ball.vx, pvy = ball.vy;
          const g = step(bodies.current);
          const dv = Math.hypot(ball.vx - pvx * 0.984, ball.vy - pvy * 0.984);
          if (dv > 1.5) {
            sfxBounce(dv); burst(ball.x, ball.y, 4, ["#ffffff", GOLD], 2, 2.5);
            if (isHost) send({ t: "fx", k: "bounce", x: ball.x, y: ball.y, v: dv });
          }
          if (g !== null) {
            const sc: [number, number] = [...scoreRef.current] as [number, number];
            sc[g] += 1; scoreRef.current = sc; setScore(sc);
            fxGoal(g);
            if (isHost) send({ t: "fx", k: "goal", g });
            cb.current.onGoal?.(g);
            if (sc[g] >= target) {
              phase.current = "over";
              showBanner(g === 0 ? "YOU WIN!" : net ? "THEY WIN!" : "CPU WINS!");
              if (isHost) setBanner(g === 0 ? "YOU WIN!" : "YOU LOSE");
              snapshot();
              setTimeout(() => sfxWin(g === 0), 700);
              if (isHost) send({ t: "end", sc });
              setTimeout(() => cb.current.onEnd(sc), 2200);
            } else {
              phase.current = "goal";
              showBanner("GOAL!");
              snapshot();
              setTimeout(() => {
                showBanner(null);
                bodies.current = setup(); trail.current = [];
                turn.current = g === 0 ? 1 : 0; setTurnUi(turn.current);
                phase.current = "aim";
                sfxWhistle();
                if (isHost) send({ t: "fx", k: "whistle" });
                snapshot();
                if (turn.current === 1) opponentTurn();
              }, 1800);
            }
            break;
          }
        }
        if (isHost && t % 3 === 0) snapshot();
        if (phase.current === "moving" && !moving(bodies.current)) {
          turn.current = turn.current === 0 ? 1 : 0; setTurnUi(turn.current);
          phase.current = "aim";
          snapshot();
          if (turn.current === 1) opponentTurn();
        }
      }
      if (isHost && t % 60 === 0) snapshot(); // heartbeat so late joiners sync
      const ball = bodies.current[bodies.current.length - 1]!;
      const sp = isGuest ? (ball.vx ? 4 : 0) : Math.hypot(ball.vx, ball.vy);
      ballSpin.current += sp * 0.08;
      if (sp > 2) trail.current.push({ x: ball.x, y: ball.y });
      if (trail.current.length > 14 || (sp <= 2 && trail.current.length)) trail.current.shift();
      for (const p of parts.current) { p.x += p.vx; p.y += p.vy; p.vx *= 0.96; p.vy = p.vy * 0.96 + 0.08; p.life -= 1; p.rot += 0.2; }
      parts.current = parts.current.filter((p) => p.life > 0);
      draw(ctx, t);
      raf = requestAnimationFrame(loop);
    };

    const draw = (c: CanvasRenderingContext2D, t: number) => {
      c.save();
      if (shake.current > 0.5) c.translate((Math.random() - 0.5) * shake.current, (Math.random() - 0.5) * shake.current);

      // stadium base + tiered stands
      const bg = c.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#3b2a6b"); bg.addColorStop(0.5, "#2a2050"); bg.addColorStop(1, "#1f3a7a");
      c.fillStyle = bg; c.fillRect(-20, -20, W + 40, H + 40);
      for (let row = 0; row < 4; row++) {
        c.fillStyle = row % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.12)";
        c.fillRect(0, row * 25, W, 25); c.fillRect(0, H - (row + 1) * 25, W, 25);
        c.fillRect(row * 19, 100, 19, H - 200); c.fillRect(W - (row + 1) * 19, 100, 19, H - 200);
      }
      // team colored seat sections
      c.fillStyle = "rgba(239,59,59,0.18)"; c.fillRect(0, 0, W, 98);
      c.fillStyle = "rgba(58,134,255,0.2)"; c.fillRect(0, H - 98, W, 98);

      const excited = cheer.current > 0;
      for (const f of fans.current) {
        const amp = excited ? 7 : 1.3;
        const by = Math.sin(t * (excited ? 0.38 : 0.05) + f.phase) * amp;
        // body
        c.fillStyle = f.c; c.strokeStyle = OUT; c.lineWidth = 2;
        c.beginPath(); c.ellipse(f.x, f.y + 5 + by * 0.4, 8.5, 7, 0, 0, 6.29); c.fill(); c.stroke();
        // head
        c.fillStyle = f.skin; c.beginPath(); c.arc(f.x, f.y - 3 + by, 6, 0, 6.29); c.fill(); c.stroke();
        c.fillStyle = f.hair; c.beginPath(); c.arc(f.x, f.y - 5 + by, 5, Math.PI, 0); c.fill();
        if (excited || f.flag) {
          c.strokeStyle = f.skin; c.lineWidth = 3;
          const wave = Math.sin(t * 0.4 + f.phase) * 3;
          c.beginPath(); c.moveTo(f.x - 6, f.y + 1 + by); c.lineTo(f.x - 9 + wave, f.y - 11 + by);
          c.moveTo(f.x + 6, f.y + 1 + by); c.lineTo(f.x + 9 - wave, f.y - 11 + by); c.stroke();
        }
        if (f.flag) {
          const fx = f.x + 9, fy = f.y - 22 + by, w = Math.sin(t * 0.15 + f.phase) * 4;
          c.strokeStyle = "#ddd"; c.lineWidth = 2; c.beginPath(); c.moveTo(fx, fy + 12); c.lineTo(fx, fy - 4); c.stroke();
          c.fillStyle = f.y > H / 2 ? BLUE : RED; c.strokeStyle = OUT; c.lineWidth = 1.5;
          c.beginPath(); c.moveTo(fx, fy - 4); c.quadraticCurveTo(fx + 8, fy - 6 + w, fx + 16, fy - 2 + w); c.lineTo(fx + 16, fy + 6 + w); c.quadraticCurveTo(fx + 8, fy + 3 + w, fx, fy + 4); c.closePath(); c.fill(); c.stroke();
        }
      }

      // floodlight glows
      for (const [lx, ly] of [[0, 0], [W, 0], [0, H], [W, H]] as const) {
        const gl = c.createRadialGradient(lx, ly, 0, lx, ly, 260);
        gl.addColorStop(0, "rgba(255,245,200,0.35)"); gl.addColorStop(1, "rgba(255,245,200,0)");
        c.fillStyle = gl; c.fillRect(lx - 260, ly - 260, 520, 520);
        c.fillStyle = "#2b2f4a"; c.strokeStyle = OUT; c.lineWidth = 3;
        const px = lx === 0 ? 4 : W - 34, py = ly === 0 ? 4 : H - 24;
        roundRect(c, px, py, 30, 20, 5); c.fill(); c.stroke();
        c.fillStyle = `rgba(255,250,210,${0.8 + Math.sin(t * 0.05) * 0.2})`;
        for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(px + 7 + k * 8, py + 10, 3, 0, 6.29); c.fill(); }
      }

      // pitch wall + LED ad boards
      c.fillStyle = OUT; roundRect(c, PITCH.l - 22, PITCH.t - 22, PITCH.r - PITCH.l + 44, PITCH.b - PITCH.t + 44, 22); c.fill();
      const led = c.createLinearGradient(0, PITCH.t - 20, 0, PITCH.b + 20);
      led.addColorStop(0, "#1a0f3a"); led.addColorStop(1, "#0f1f4a");
      c.fillStyle = led; roundRect(c, PITCH.l - 18, PITCH.t - 18, PITCH.r - PITCH.l + 36, PITCH.b - PITCH.t + 36, 18); c.fill();
      c.font = "13px 'Lilita One', sans-serif"; c.textBaseline = "middle"; c.textAlign = "center";
      const scroll = (t * 0.6) % 90;
      c.save();
      c.beginPath(); c.rect(PITCH.l - 18, PITCH.t - 18, PITCH.r - PITCH.l + 36, PITCH.b - PITCH.t + 36); c.clip();
      for (let i = -1; i < 8; i++) {
        const label = ADS[(i + 60) % ADS.length]!;
        const hue = excited ? (t * 8 + i * 40) % 360 : 45;
        c.fillStyle = excited ? `hsl(${hue} 100% 65%)` : GOLD;
        const x = PITCH.l + i * 90 + scroll;
        if (x < GOAL.x1 - 30 || x > GOAL.x2 + 30) { c.fillText(label, x, PITCH.t - 9); c.fillText(label, W - x, PITCH.b + 9); }
      }
      c.restore();

      // grass
      const stripes = 12, sh = (PITCH.b - PITCH.t) / stripes;
      for (let i = 0; i < stripes; i++) {
        c.fillStyle = i % 2 ? "#5fc94b" : "#51b63f";
        c.fillRect(PITCH.l, PITCH.t + i * sh, PITCH.r - PITCH.l, sh + 1);
      }
      for (let i = 0; i < 8; i++) {
        c.fillStyle = "rgba(255,255,255,0.03)";
        if (i % 2) c.fillRect(PITCH.l + i * ((PITCH.r - PITCH.l) / 8), PITCH.t, (PITCH.r - PITCH.l) / 8, PITCH.b - PITCH.t);
      }
      const vg = c.createRadialGradient(W / 2, H / 2, 150, W / 2, H / 2, 480);
      vg.addColorStop(0, "rgba(255,255,220,0.08)"); vg.addColorStop(1, "rgba(0,20,0,0.28)");
      c.fillStyle = vg; c.fillRect(PITCH.l, PITCH.t, PITCH.r - PITCH.l, PITCH.b - PITCH.t);

      // lines
      c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = 4;
      c.strokeRect(PITCH.l + 2, PITCH.t + 2, PITCH.r - PITCH.l - 4, PITCH.b - PITCH.t - 4);
      const mx = (PITCH.l + PITCH.r) / 2, my = (PITCH.t + PITCH.b) / 2;
      c.beginPath(); c.moveTo(PITCH.l, my); c.lineTo(PITCH.r, my); c.stroke();
      c.beginPath(); c.arc(mx, my, 72, 0, 6.29); c.stroke();
      c.fillStyle = "rgba(255,255,255,0.9)"; c.beginPath(); c.arc(mx, my, 5, 0, 6.29); c.fill();
      c.strokeRect(mx - 125, PITCH.t, 250, 115); c.strokeRect(mx - 125, PITCH.b - 115, 250, 115);
      c.strokeRect(mx - 60, PITCH.t, 120, 45); c.strokeRect(mx - 60, PITCH.b - 45, 120, 45);
      c.beginPath(); c.arc(mx, PITCH.t + 115, 40, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
      c.beginPath(); c.arc(mx, PITCH.b - 115, 40, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke();
      for (const [x, y, a0] of [[PITCH.l, PITCH.t, 0], [PITCH.r, PITCH.t, 0.5], [PITCH.r, PITCH.b, 1], [PITCH.l, PITCH.b, 1.5]] as const) {
        c.beginPath(); c.arc(x, y, 14, a0 * Math.PI, (a0 + 0.5) * Math.PI); c.stroke();
        // corner flags
        const w = Math.sin(t * 0.12 + x) * 3;
        c.strokeStyle = "#eee"; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 18); c.stroke();
        c.fillStyle = y < H / 2 ? RED : BLUE; c.beginPath(); c.moveTo(x, y - 18); c.lineTo(x + 12, y - 14 + w); c.lineTo(x, y - 10); c.fill();
        c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = 4;
      }

      // goals
      for (const [y, dir, col] of [[PITCH.t, -1, RED], [PITCH.b, 1, BLUE]] as const) {
        const gy = dir < 0 ? y - GOAL.depth : y;
        c.fillStyle = "rgba(10,15,40,0.55)"; c.fillRect(GOAL.x1, gy, GOAL.x2 - GOAL.x1, GOAL.depth);
        c.strokeStyle = "rgba(255,255,255,0.55)"; c.lineWidth = 1;
        for (let x = GOAL.x1; x <= GOAL.x2; x += 9) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + dir * GOAL.depth); c.stroke(); }
        for (let d = 0; d <= GOAL.depth; d += 9) { c.beginPath(); c.moveTo(GOAL.x1, y + dir * d); c.lineTo(GOAL.x2, y + dir * d); c.stroke(); }
        c.strokeStyle = "#ffffff"; c.lineWidth = 6;
        c.beginPath(); c.moveTo(GOAL.x1, y); c.lineTo(GOAL.x1, y + dir * GOAL.depth); c.lineTo(GOAL.x2, y + dir * GOAL.depth); c.lineTo(GOAL.x2, y); c.stroke();
        c.fillStyle = col; c.strokeStyle = OUT; c.lineWidth = 3;
        for (const x of [GOAL.x1, GOAL.x2]) { c.beginPath(); c.arc(x, y, 8, 0, 6.29); c.fill(); c.stroke(); }
      }

      // aim line
      const dr = drag.current;
      if (dr) {
        const b = bodies.current[dr.idx]!;
        let dx = b.x - dr.px, dy = b.y - dr.py; const len = Math.min(Math.hypot(dx, dy), MAX_PULL);
        const a = Math.atan2(dy, dx);
        dx = Math.cos(a) * len; dy = Math.sin(a) * len;
        const pw = len / MAX_PULL;
        c.strokeStyle = `hsl(${60 - pw * 60} 100% 60%)`; c.lineWidth = 7; c.setLineDash([12, 8]); c.lineDashOffset = -t;
        c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x + dx * 1.7, b.y + dy * 1.7); c.stroke(); c.setLineDash([]);
        c.fillStyle = c.strokeStyle; c.strokeStyle = OUT; c.lineWidth = 3;
        c.save(); c.translate(b.x + dx * 1.7, b.y + dy * 1.7); c.rotate(a);
        c.beginPath(); c.moveTo(14, 0); c.lineTo(-8, -11); c.lineTo(-8, 11); c.closePath(); c.fill(); c.stroke(); c.restore();
        // power ring
        c.strokeStyle = GOLD; c.lineWidth = 5;
        c.beginPath(); c.arc(b.x, b.y, b.r + 10, -Math.PI / 2, -Math.PI / 2 + pw * Math.PI * 2); c.stroke();
      }

      // ball trail
      const ballStock = lastKicker.current === 0 ? player : cpu;
      trail.current.forEach((p, i) => {
        c.fillStyle = `rgba(255,255,255,${(i / trail.current.length) * 0.4})`;
        c.beginPath(); c.arc(p.x, p.y, 4 + (i / trail.current.length) * 9, 0, 6.29); c.fill();
      });

      // bodies
      for (const [i, b] of bodies.current.entries()) {
        c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(b.x + 4, b.y + 7, b.r, b.r * 0.8, 0, 0, 6.29); c.fill();
        if (b.team === -1) {
          const bg2 = c.createRadialGradient(b.x - 5, b.y - 5, 2, b.x, b.y, b.r);
          bg2.addColorStop(0, "#ffffff"); bg2.addColorStop(1, "#cfd6e6");
          c.fillStyle = bg2; c.strokeStyle = OUT; c.lineWidth = 3;
          c.beginPath(); c.arc(b.x, b.y, b.r, 0, 6.29); c.fill(); c.stroke();
          c.save(); c.translate(b.x, b.y); c.rotate(ballSpin.current);
          c.strokeStyle = ballStock.color; c.lineWidth = 4;
          c.beginPath(); c.arc(0, 0, b.r - 4, 0, 6.29); c.stroke();
          c.fillStyle = OUT; c.font = `900 ${ballStock.ticker.length > 4 ? 7 : 8}px Nunito, sans-serif`;
          c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(ballStock.ticker, 0, 1);
          c.restore();
        } else {
          const [col, dark] = b.team === 0 ? [BLUE, BLUE_D] : [RED, RED_D];
          const active = phase.current === "aim" && turn.current === 0 && b.team === 0;
          if (active) {
            c.strokeStyle = `rgba(255,225,77,${0.5 + Math.sin(t * 0.15) * 0.4})`; c.lineWidth = 4;
            c.beginPath(); c.arc(b.x, b.y, b.r + 6, 0, 6.29); c.stroke();
          }
          c.fillStyle = dark; c.strokeStyle = OUT; c.lineWidth = 4;
          c.beginPath(); c.arc(b.x, b.y + 3, b.r, 0, 6.29); c.fill(); c.stroke();
          const dg = c.createRadialGradient(b.x - 6, b.y - 8, 2, b.x, b.y, b.r);
          dg.addColorStop(0, "#ffffff"); dg.addColorStop(0.25, col); dg.addColorStop(1, dark);
          c.fillStyle = dg;
          c.beginPath(); c.arc(b.x, b.y, b.r, 0, 6.29); c.fill(); c.stroke();
          c.strokeStyle = GOLD; c.lineWidth = 2.5; c.beginPath(); c.arc(b.x, b.y, b.r - 5, 0, 6.29); c.stroke();
          c.fillStyle = "#fff"; c.font = "17px 'Lilita One', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
          c.strokeStyle = OUT; c.lineWidth = 3.5; c.strokeText(String((i % 5) + 1), b.x, b.y + 1); c.fillText(String((i % 5) + 1), b.x, b.y + 1);
        }
      }

      // particles
      for (const p of parts.current) {
        c.save(); c.globalAlpha = Math.min(1, p.life / 30); c.translate(p.x, p.y); c.rotate(p.rot);
        c.fillStyle = p.c; c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); c.restore();
      }

      if (flash.current > 0) { c.fillStyle = `rgba(255,240,180,${flash.current * 0.35})`; c.fillRect(-20, -20, W + 40, H + 40); }
      c.restore();
    };

    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); if (cpuTimer) clearTimeout(cpuTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toLocal = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const down = (e: React.PointerEvent) => {
    if (phase.current !== "aim" || turn.current !== 0) return;
    const p = toLocal(e);
    const idx = bodies.current.findIndex((b) => b.team === 0 && Math.hypot(b.x - p.x, b.y - p.y) < b.r + 14);
    if (idx < 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { idx, px: p.x, py: p.y };
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = toLocal(e); drag.current.px = p.x; drag.current.py = p.y;
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    const b = bodies.current[d.idx]!;
    const dx = b.x - d.px, dy = b.y - d.py, len = Math.hypot(dx, dy);
    if (len < 12) return;
    const sp = (Math.min(len, MAX_PULL) / MAX_PULL) * MAX_SPEED;
    b.vx = (dx / len) * sp; b.vy = (dy / len) * sp;
    sfxKick(sp / MAX_SPEED);
    burst(b.x, b.y, 12, ["#e9f5d0", "#b9e08a"], 3, 3);
    lastKicker.current = 0;
    phase.current = "moving";
    cb.current.onKick();
  };

  const toggleMute = () => { const m = !muted; setMuted(m); setMutedUi(m); };

  return (
    <div className="relative mx-auto w-full max-w-[min(100%,calc((100dvh-150px)*0.667))]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <ScoreChip label={`YOU · ${player.ticker}`} value={score[0]} tone="blue" active={turnUi === 0} />
        <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}
          className="chunky chunky-press grid size-10 place-items-center rounded-xl bg-primary text-lg">
          {muted ? "🔇" : "🔊"}
        </button>
        <ScoreChip label={`CPU · ${cpu.ticker}`} value={score[1]} tone="red" active={turnUi === 1} />
      </div>
      <canvas
        ref={canvas} width={W} height={H}
        className="chunky block w-full touch-none select-none rounded-2xl"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      />
      {banner && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span key={banner + score.join()} className="animate-pop font-display text-stroke text-7xl text-gold">{banner}</span>
        </div>
      )}
      <p className="mt-2 text-center text-sm font-bold text-muted-foreground">
        {turnUi === 0 ? `Your turn — drag back from a blue player and release · First to ${target}` : "CPU is thinking…"}
      </p>
    </div>
  );
}

function ScoreChip({ label, value, tone, active }: { label: string; value: number; tone: "blue" | "red"; active: boolean }) {
  return (
    <div className={`chunky flex items-center gap-2 rounded-xl px-3 py-1 transition-transform ${tone === "blue" ? "bg-team-blue" : "bg-team-red"} ${active ? "scale-105" : "opacity-75"}`}>
      <span className="text-xs font-extrabold">{label}</span>
      <span className="font-display text-stroke text-2xl">{value}</span>
    </div>
  );
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.roundRect(x, y, w, h, r);
}
