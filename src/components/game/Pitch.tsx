import { useEffect, useRef, useState } from "react";
import {
  W, H, PITCH, GOAL, MAX_PULL, MAX_SPEED, setup, step, moving, cpuMove, type Body,
} from "@/lib/engine";
import type { Stock } from "@/lib/stocks";

type Fan = { x: number; y: number; c: string; skin: string; phase: number; team: 0 | 1 };
const SHIRTS = ["#3b82f6", "#ef4444", "#facc15", "#ffffff", "#2563eb", "#dc2626"];
const SKINS = ["#f1c27d", "#e0ac69", "#8d5524", "#c68642", "#ffdbac"];
const BLUE = "#3a86ff", RED = "#ef3b3b", OUT = "#1a1d33";

function makeFans(): Fan[] {
  const fans: Fan[] = [];
  const add = (x: number, y: number) => {
    const team = (y > H / 2 ? 0 : 1) as 0 | 1;
    const pool = team === 0 ? [BLUE, "#2563eb", "#ffffff", "#facc15"] : [RED, "#dc2626", "#ffffff", "#facc15"];
    fans.push({ x, y, c: pool[Math.floor(Math.random() * pool.length)], skin: SKINS[Math.floor(Math.random() * SKINS.length)], phase: Math.random() * 6.28, team });
  };
  for (let row = 0; row < 3; row++) {
    for (let x = 30; x < W - 20; x += 22) { add(x + (row % 2) * 11, 30 + row * 24); add(x + (row % 2) * 11, H - 30 - row * 24); }
    for (let y = 130; y < H - 120; y += 22) { add(18 + row * 0, y); }
  }
  for (let y = 130; y < H - 120; y += 24) { add(W - 20, y + 6); add(20, y + 12); }
  void SHIRTS;
  return fans;
}

export function Pitch({
  player, cpu, onKick, onGoal, onEnd, target = 3,
}: {
  player: Stock; cpu: Stock; onKick: () => void;
  onGoal?: (team: 0 | 1) => void; onEnd: (score: [number, number]) => void; target?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bodies = useRef<Body[]>([]);
  const fans = useRef<Fan[]>([]);
  const turn = useRef<0 | 1>(0);
  const phase = useRef<"aim" | "moving" | "goal" | "over">("aim");
  const drag = useRef<{ idx: number; px: number; py: number } | null>(null);
  const cheer = useRef(0);
  const lastKicker = useRef<0 | 1>(0);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const scoreRef = useRef<[number, number]>([0, 0]);
  const [turnUi, setTurnUi] = useState<0 | 1>(0);
  const [banner, setBanner] = useState<string | null>(null);
  const cb = useRef({ onKick, onGoal, onEnd });
  cb.current = { onKick, onGoal, onEnd };

  useEffect(() => {
    bodies.current = setup();
    fans.current = makeFans();
    const ctx = canvas.current!.getContext("2d")!;
    let raf = 0, t = 0, cpuTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleCpu = () => {
      cpuTimer = setTimeout(() => {
        if (phase.current !== "aim" || turn.current !== 1) return;
        const m = cpuMove(bodies.current);
        const b = bodies.current[m.idx];
        b.vx = m.vx; b.vy = m.vy;
        lastKicker.current = 1;
        phase.current = "moving";
      }, 900);
    };

    const loop = () => {
      t += 1;
      if (cheer.current > 0) cheer.current -= 1;
      if (phase.current === "moving") {
        for (let s = 0; s < 2; s++) {
          const g = step(bodies.current);
          if (g !== null) {
            const sc: [number, number] = [...scoreRef.current] as [number, number];
            sc[g] += 1; scoreRef.current = sc; setScore(sc);
            cheer.current = 150;
            cb.current.onGoal?.(g);
            if (sc[g] >= target) {
              phase.current = "over";
              setBanner(g === 0 ? "YOU WIN!" : "CPU WINS!");
              setTimeout(() => cb.current.onEnd(sc), 1800);
            } else {
              phase.current = "goal";
              setBanner("GOAL!");
              setTimeout(() => {
                setBanner(null);
                bodies.current = setup();
                turn.current = g === 0 ? 1 : 0; setTurnUi(turn.current);
                phase.current = "aim";
                if (turn.current === 1) scheduleCpu();
              }, 1600);
            }
            break;
          }
        }
        if (phase.current === "moving" && !moving(bodies.current)) {
          turn.current = turn.current === 0 ? 1 : 0; setTurnUi(turn.current);
          phase.current = "aim";
          if (turn.current === 1) scheduleCpu();
        }
      }
      draw(ctx, t);
      raf = requestAnimationFrame(loop);
    };

    const draw = (c: CanvasRenderingContext2D, t: number) => {
      // stands
      c.fillStyle = "#5b4a8a"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#8b6b4a"; c.fillRect(0, 0, W, 100); c.fillRect(0, H - 100, W, 100);
      c.fillStyle = "#6e5a9c"; c.fillRect(0, 100, 44, H - 200); c.fillRect(W - 44, 100, 44, H - 200);
      const excited = cheer.current > 0;
      for (const f of fans.current) {
        const amp = excited ? 6 : 1.4;
        const by = Math.sin(t * (excited ? 0.35 : 0.06) + f.phase) * amp;
        c.fillStyle = f.c; c.strokeStyle = OUT; c.lineWidth = 2;
        c.beginPath(); c.arc(f.x, f.y + 4 + by * 0.5, 8, 0, 6.29); c.fill(); c.stroke();
        c.fillStyle = f.skin; c.beginPath(); c.arc(f.x, f.y - 3 + by, 5.5, 0, 6.29); c.fill(); c.stroke();
        if (excited) {
          c.strokeStyle = f.skin; c.lineWidth = 3;
          c.beginPath(); c.moveTo(f.x - 6, f.y + by); c.lineTo(f.x - 9, f.y - 9 + by);
          c.moveTo(f.x + 6, f.y + by); c.lineTo(f.x + 9, f.y - 9 + by); c.stroke();
        }
      }
      // pitch border
      c.fillStyle = OUT; roundRect(c, PITCH.l - 16, PITCH.t - 16, PITCH.r - PITCH.l + 32, PITCH.b - PITCH.t + 32, 18); c.fill();
      c.fillStyle = "#c2a36b"; roundRect(c, PITCH.l - 12, PITCH.t - 12, PITCH.r - PITCH.l + 24, PITCH.b - PITCH.t + 24, 14); c.fill();
      const stripes = 10, sh = (PITCH.b - PITCH.t) / stripes;
      for (let i = 0; i < stripes; i++) {
        c.fillStyle = i % 2 ? "#5cbf4a" : "#4fae3e";
        c.fillRect(PITCH.l, PITCH.t + i * sh, PITCH.r - PITCH.l, sh + 1);
      }
      c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 4;
      c.strokeRect(PITCH.l + 2, PITCH.t + 2, PITCH.r - PITCH.l - 4, PITCH.b - PITCH.t - 4);
      const mx = (PITCH.l + PITCH.r) / 2, my = (PITCH.t + PITCH.b) / 2;
      c.beginPath(); c.moveTo(PITCH.l, my); c.lineTo(PITCH.r, my); c.stroke();
      c.beginPath(); c.arc(mx, my, 70, 0, 6.29); c.stroke();
      c.strokeRect(mx - 120, PITCH.t, 240, 110); c.strokeRect(mx - 120, PITCH.b - 110, 240, 110);
      // goals
      for (const [y, dir, col] of [[PITCH.t, -1, RED], [PITCH.b, 1, BLUE]] as const) {
        c.fillStyle = "rgba(255,255,255,0.25)";
        c.fillRect(GOAL.x1, dir < 0 ? y - GOAL.depth : y, GOAL.x2 - GOAL.x1, GOAL.depth);
        c.strokeStyle = "rgba(255,255,255,0.5)"; c.lineWidth = 1;
        for (let x = GOAL.x1; x <= GOAL.x2; x += 10) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + dir * GOAL.depth); c.stroke(); }
        c.fillStyle = col; c.strokeStyle = OUT; c.lineWidth = 3;
        for (const x of [GOAL.x1, GOAL.x2]) { c.beginPath(); c.arc(x, y, 7, 0, 6.29); c.fill(); c.stroke(); }
      }
      // aim line
      const dr = drag.current;
      if (dr) {
        const b = bodies.current[dr.idx];
        let dx = b.x - dr.px, dy = b.y - dr.py; const len = Math.min(Math.hypot(dx, dy), MAX_PULL);
        const a = Math.atan2(dy, dx);
        dx = Math.cos(a) * len; dy = Math.sin(a) * len;
        c.strokeStyle = "#ffe14d"; c.lineWidth = 6; c.setLineDash([10, 8]);
        c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x + dx * 1.6, b.y + dy * 1.6); c.stroke(); c.setLineDash([]);
        c.fillStyle = "#ffe14d"; c.strokeStyle = OUT; c.lineWidth = 3;
        c.beginPath(); c.arc(b.x + dx * 1.6, b.y + dy * 1.6, 9, 0, 6.29); c.fill(); c.stroke();
      }
      // bodies
      const ballStock = lastKicker.current === 0 ? player : cpu;
      for (const [i, b] of bodies.current.entries()) {
        c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(b.x + 3, b.y + 6, b.r, b.r * 0.8, 0, 0, 6.29); c.fill();
        if (b.team === -1) {
          c.fillStyle = "#fff"; c.strokeStyle = OUT; c.lineWidth = 3;
          c.beginPath(); c.arc(b.x, b.y, b.r, 0, 6.29); c.fill(); c.stroke();
          c.strokeStyle = ballStock.color; c.lineWidth = 4;
          c.beginPath(); c.arc(b.x, b.y, b.r - 4, 0, 6.29); c.stroke();
          c.fillStyle = OUT; c.font = `bold ${ballStock.ticker.length > 4 ? 7 : 8}px sans-serif`;
          c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(ballStock.ticker, b.x, b.y + 1);
        } else {
          const col = b.team === 0 ? BLUE : RED;
          const active = phase.current === "aim" && turn.current === 0 && b.team === 0;
          if (active) {
            c.strokeStyle = `rgba(255,225,77,${0.5 + Math.sin(t * 0.15) * 0.4})`; c.lineWidth = 4;
            c.beginPath(); c.arc(b.x, b.y, b.r + 6, 0, 6.29); c.stroke();
          }
          c.fillStyle = col; c.strokeStyle = OUT; c.lineWidth = 4;
          c.beginPath(); c.arc(b.x, b.y, b.r, 0, 6.29); c.fill(); c.stroke();
          c.fillStyle = "rgba(255,255,255,0.35)"; c.beginPath(); c.arc(b.x - 7, b.y - 8, 8, 0, 6.29); c.fill();
          c.fillStyle = "#fff"; c.font = "bold 16px 'Lilita One', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
          c.lineWidth = 3; c.strokeText(String((i % 5) + 1), b.x, b.y + 1); c.fillText(String((i % 5) + 1), b.x, b.y + 1);
        }
      }
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
    const b = bodies.current[d.idx];
    const dx = b.x - d.px, dy = b.y - d.py, len = Math.hypot(dx, dy);
    if (len < 12) return;
    const sp = (Math.min(len, MAX_PULL) / MAX_PULL) * MAX_SPEED;
    b.vx = (dx / len) * sp; b.vy = (dy / len) * sp;
    lastKicker.current = 0;
    phase.current = "moving";
    cb.current.onKick();
  };

  return (
    <div className="relative mx-auto w-full max-w-[min(100%,calc((100dvh-150px)*0.667))]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <ScoreChip label={`YOU · ${player.ticker}`} value={score[0]} tone="blue" active={turnUi === 0} />
        <span className="font-display text-stroke text-lg text-gold">FIRST TO {target}</span>
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
        {turnUi === 0 ? "Your turn — drag back from a blue player and release to kick" : "CPU is thinking…"}
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
