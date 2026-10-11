import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { STOCKS } from "@/lib/stocks";
import { PROTOCOLS } from "@/lib/ranks";

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const Cred = z.object({ id: z.string().uuid(), key: z.string().min(20).max(100) });

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function verify(id: string, key: string) {
  const db = await admin();
  const { data } = await db.from("players").select("*").eq("id", id).maybeSingle();
  if (!data || data.key_hash !== (await sha(key))) throw new Error("Invalid player");
  return { db, player: data };
}

export const registerPlayer = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ name: z.string().trim().min(2).max(16) }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const key = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data: row, error } = await db.from("players")
      .insert({ name: data.name, key_hash: await sha(key) }).select("id, name").single();
    if (error) throw new Error(error.message);
    return { id: row.id, name: row.name, key };
  });

export const getMe = createServerFn({ method: "POST" })
  .inputValidator((d) => Cred.parse(d))
  .handler(async ({ data }) => {
    const { db } = await verify(data.id, data.key);
    const [{ data: stats }, { data: positions }] = await Promise.all([
      db.from("leaderboard").select("*").eq("id", data.id).single(),
      db.from("lend_positions").select("id, protocol, ticker, amount, usd_value, created_at")
        .eq("player_id", data.id).is("withdrawn_at", null).order("created_at", { ascending: false }),
    ]);
    return { stats, positions: positions ?? [] };
  });

export const reportMatch = createServerFn({ method: "POST" })
  .inputValidator((d) => Cred.extend({
    matchId: z.string().min(4).max(120),
    mode: z.enum(["cpu", "pvp"]),
    won: z.boolean(),
    goals: z.number().int().min(0).max(5),
    kicks: z.number().int().min(0).max(200),
  }).parse(d))
  .handler(async ({ data }) => {
    const { db, player } = await verify(data.id, data.key);
    const { error } = await db.from("match_reports").insert({ match_id: data.matchId, player_id: data.id });
    if (error) return { points: 0 };
    const base = data.mode === "pvp" ? (data.won ? 40 : 8) : (data.won ? 20 : 3);
    const points = base + data.goals * 5 + Math.min(data.kicks, 40);
    await db.from("players").update({
      game_points: player.game_points + points,
      wins: player.wins + (data.won ? 1 : 0),
      losses: player.losses + (data.won ? 0 : 1),
      pvp_wins: player.pvp_wins + (data.won && data.mode === "pvp" ? 1 : 0),
      goals: player.goals + data.goals,
      kicks: player.kicks + data.kicks,
    }).eq("id", data.id);
    return { points };
  });

export const lend = createServerFn({ method: "POST" })
  .inputValidator((d) => Cred.extend({
    protocol: z.string(), ticker: z.string(), amount: z.number().positive().max(1000),
  }).parse(d))
  .handler(async ({ data }) => {
    const stock = STOCKS.find((s) => s.ticker === data.ticker);
    if (!stock || !PROTOCOLS.some((p) => p.id === data.protocol)) throw new Error("Invalid choice");
    const { db } = await verify(data.id, data.key);
    await db.from("lend_positions").insert({
      player_id: data.id, protocol: data.protocol, ticker: data.ticker,
      amount: data.amount, usd_value: data.amount * stock.price,
    });
    return { ok: true };
  });

export const withdraw = createServerFn({ method: "POST" })
  .inputValidator((d) => Cred.extend({ positionId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { db } = await verify(data.id, data.key);
    await db.from("lend_positions").update({ withdrawn_at: new Date().toISOString() })
      .eq("id", data.positionId).eq("player_id", data.id).is("withdrawn_at", null);
    return { ok: true };
  });

export const getLeaderboard = createServerFn({ method: "GET" }).handler(async () => {
  const db = await admin();
  const { data } = await db.from("leaderboard")
    .select("id, name, wins, losses, pvp_wins, goals, lent_usd, lend_points, game_points, total_points")
    .order("total_points", { ascending: false }).limit(100);
  return data ?? [];
});
