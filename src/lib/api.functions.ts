import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { B20_TOKENS, B20_DECIMALS } from "@/lib/b20";

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

// Verifies a real deposit tx on Base and credits its USD value toward lending rank.
export const recordDeposit = createServerFn({ method: "POST" })
  .inputValidator((d) => Cred.extend({
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    protocol: z.string().min(2).max(40),
  }).parse(d))
  .handler(async ({ data }) => {
    const { db } = await verify(data.id, data.key);
    const { createPublicClient, http, decodeEventLog, erc20Abi, formatUnits } = await import("viem");
    const { base: chain } = await import("viem/chains");
    const { USDC, AAVE_POOL, AERO_ROUTER } = await import("@/lib/defi");
    const client = createPublicClient({ chain, transport: http("https://mainnet.base.org") });
    const hash = data.txHash as `0x${string}`;
    const [tx, rc] = await Promise.all([client.getTransaction({ hash }), client.waitForTransactionReceipt({ hash, timeout: 30_000 })]);
    if (rc.status !== "success" || !tx.to) throw new Error("Transaction failed");
    const from = tx.from.toLowerCase(), to = tx.to.toLowerCase();
    const known = [AAVE_POOL, AERO_ROUTER].map((a) => a.toLowerCase()).includes(to);
    const stocks = new Map(B20_TOKENS.map((t) => [t.address.toLowerCase(), t]));
    const moved: { token: string; amount: number; ticker: string }[] = [];
    for (const log of rc.logs) {
      const token = log.address.toLowerCase();
      const isUsdc = token === USDC.toLowerCase();
      if (!isUsdc && !stocks.has(token)) continue;
      try {
        const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
        if (ev.eventName !== "Transfer") continue;
        const a = ev.args as { from: string; to: string; value: bigint };
        if (a.from.toLowerCase() !== from) continue;
        if (!known && a.to.toLowerCase() !== to) continue;
        moved.push({ token, amount: Number(formatUnits(a.value, isUsdc ? 6 : B20_DECIMALS)), ticker: isUsdc ? "USDC" : stocks.get(token)!.ticker });
      } catch { /* not a transfer */ }
    }
    if (!moved.length) throw new Error("No stock or USDC deposit found in this transaction");
    const stockAddrs = moved.filter((m) => m.ticker !== "USDC").map((m) => `base:${m.token}`);
    const prices: Record<string, number> = {};
    if (stockAddrs.length) {
      const r = await fetch(`https://coins.llama.fi/prices/current/${stockAddrs.join(",")}`).then((x) => x.json()).catch(() => null);
      for (const [k, v] of Object.entries<any>(r?.coins ?? {})) prices[k.slice(5).toLowerCase()] = Number(v.price) || 0;
    }
    const usd = moved.reduce((s, m) => s + m.amount * (m.ticker === "USDC" ? 1 : prices[m.token] ?? 0), 0);
    const main = moved.find((m) => m.ticker !== "USDC") ?? moved[0]!;
    const { error } = await db.from("lend_positions").insert({
      player_id: data.id, protocol: data.protocol, ticker: moved.map((m) => m.ticker).filter((v, i, a) => a.indexOf(v) === i).join("+").slice(0, 24),
      amount: main.amount, usd_value: usd, tx_hash: hash.toLowerCase(), wallet: from,
    });
    if (error) throw new Error(error.code === "23505" ? "Deposit already counted" : error.message);
    return { usd };
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
