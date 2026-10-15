import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { getMe, lend, withdraw } from "@/lib/api.functions";
import { B20_TOKENS } from "@/lib/b20";
import { useWalletStocks } from "@/lib/wallet-stocks";
import { TierProgress } from "@/components/TierBadge";
import type { Profile } from "@/lib/profile";
import type { Wallet } from "@/components/GameApp";

type Pool = { pool: string; project: string; symbol: string; tvlUsd: number; apy: number; tickers: string[] };
const byAddr = new Map(B20_TOKENS.map((t) => [t.address.toLowerCase(), t.ticker]));
const PROTOCOL_URL: Record<string, string> = {
  "aerodrome-slipstream": "https://aerodrome.finance/liquidity", "aerodrome-v1": "https://aerodrome.finance/liquidity",
  "morpho-blue": "https://app.morpho.org/base/earn", "aave-v3": "https://app.aave.com/?marketName=proto_base_v3",
  beefy: "https://app.beefy.com/", superform: "https://www.superform.xyz/", "uniswap-v4": "https://app.uniswap.org/positions/create",
  "uniswap-v3": "https://app.uniswap.org/positions/create", makina: "https://makina.finance/", "fusion-by-ipor": "https://app.ipor.io/fusion",
};
const nice = (p: string) => p.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

function usePools() {
  return useQuery({
    queryKey: ["b20-pools"], staleTime: 300_000,
    queryFn: async (): Promise<Pool[]> => {
      const j = await fetch("https://yields.llama.fi/pools").then((r) => r.json());
      return (j.data as any[]).filter((x) => x.chain === "Base").map((x) => ({
        pool: x.pool, project: x.project, symbol: x.symbol, tvlUsd: x.tvlUsd, apy: x.apy ?? 0,
        tickers: ((x.underlyingTokens ?? []) as string[]).map((u) => byAddr.get((u ?? "").toLowerCase())).filter(Boolean) as string[],
      })).filter((p) => p.tickers.length && p.tvlUsd > 1000).sort((a, b) => b.tvlUsd - a.tvlUsd);
    },
  });
}

export function LendPanel({ wallet, profile }: { wallet: Wallet | null; profile: Profile }) {
  const qc = useQueryClient();
  const me = useServerFn(getMe), doLend = useServerFn(lend), doWithdraw = useServerFn(withdraw);
  const { data } = useQuery({ queryKey: ["me", profile.id], queryFn: () => me({ data: { id: profile.id, key: profile.key } }), refetchInterval: 30_000 });
  const assets = useWalletStocks(wallet?.authed ? wallet.address : undefined);
  const holdings = assets.data?.holdings ?? [];
  const pools = usePools();
  const [onlyMine, setOnlyMine] = useState(true);
  const [sel, setSel] = useState<{ pool: Pool; ticker: string } | null>(null);
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mine = new Set(holdings.map((h) => h.ticker));
  const list = useMemo(() => (pools.data ?? []).filter((p) => !onlyMine || !holdings.length || p.tickers.some((t) => mine.has(t))).slice(0, 40),
    [pools.data, onlyMine, holdings.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const held = sel ? holdings.find((h) => h.ticker === sel.ticker) : undefined;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["me"] }); void qc.invalidateQueries({ queryKey: ["leaderboard"] }); };

  const record = async () => {
    if (!sel) return;
    setErr(""); setBusy(true);
    try { await doLend({ data: { id: profile.id, key: profile.key, protocol: sel.pool.project, ticker: sel.ticker, amount } }); setSel(null); refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  };

  const s = data?.stats;
  return (
    <div className="space-y-4">
      <section className="chunky rounded-2xl bg-card p-4">
        <p className="mb-2 font-display text-xl">{profile.name}</p>
        <TierProgress points={s?.total_points ?? 0} />
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
          <Stat label="Game pts" value={s?.game_points ?? 0} />
          <Stat label="Lend pts" value={s?.lend_points ?? 0} />
          <Stat label="Lent" value={`$${Math.round(Number(s?.lent_usd ?? 0))}`} />
        </div>
      </section>

      <section className="chunky rounded-2xl bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-stroke text-xl">Live stock pools on Base</h2>
          {holdings.length > 0 && (
            <button onClick={() => setOnlyMine(!onlyMine)} className="text-xs font-bold underline">{onlyMine ? "show all" : "only my stocks"}</button>
          )}
        </div>
        {!wallet?.authed && <p className="mt-1 text-xs text-muted-foreground">Sign in on the Play page to match pools to your wallet.</p>}
        {pools.isLoading && <p className="mt-2 text-sm text-muted-foreground">Loading pools…</p>}
        <div className="mt-3 space-y-2">
          {list.map((p) => (
            <div key={p.pool} className="rounded-xl bg-muted p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-lg">{nice(p.project)}</p>
                  <p className="text-xs font-bold text-muted-foreground">{p.symbol} · TVL ${Math.round(p.tvlUsd).toLocaleString()}</p>
                </div>
                <p className="font-display text-xl text-accent">{p.apy.toFixed(1)}%</p>
              </div>
              <div className="mt-2 flex gap-2">
                <a href={PROTOCOL_URL[p.project] ?? `https://defillama.com/yields/pool/${p.pool}`} target="_blank" rel="noreferrer"
                  className="chunky chunky-press flex-1 rounded-lg bg-primary py-1.5 text-center text-xs font-black text-primary-foreground">DEPOSIT ↗</a>
                <button onClick={() => { const t = p.tickers.find((x) => mine.has(x)) ?? p.tickers[0]!; setSel({ pool: p, ticker: t }); setAmount(holdings.find((h) => h.ticker === t)?.balance ?? 0); }}
                  className="chunky chunky-press flex-1 rounded-lg bg-secondary py-1.5 text-xs font-black">I DEPOSITED</button>
              </div>
              {sel?.pool.pool === p.pool && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <select value={sel.ticker} onChange={(e) => setSel({ pool: p, ticker: e.target.value })} className="rounded-lg bg-secondary px-2 text-sm font-bold">
                      {p.tickers.map((t) => <option key={t}>{t}</option>)}
                    </select>
                    <input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)}
                      className="w-full rounded-lg bg-secondary px-2 py-1 font-bold outline-none" />
                  </div>
                  <button onClick={record} disabled={busy || amount <= 0}
                    className="chunky chunky-press w-full rounded-lg bg-accent py-2 font-display disabled:opacity-50">{busy ? "SAVING…" : "ADD TO MY RANK"}</button>
                  {held === undefined && <p className="text-xs text-muted-foreground">Tip: hold {sel.ticker} in your game wallet first.</p>}
                  {err && <p className="text-xs text-destructive">{err}</p>}
                </div>
              )}
            </div>
          ))}
          {!pools.isLoading && !list.length && <p className="text-sm text-muted-foreground">No pools found for your stocks.</p>}
        </div>
      </section>

      <section className="chunky rounded-2xl bg-card p-4">
        <h2 className="font-display text-stroke text-xl">Your positions</h2>
        {!data?.positions.length && <p className="mt-2 text-sm text-muted-foreground">Nothing lent yet.</p>}
        <div className="mt-2 space-y-2">
          {data?.positions.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2">
              <div>
                <p className="font-display">{p.amount} {p.ticker} → {nice(p.protocol)}</p>
                <p className="text-xs text-muted-foreground">${Number(p.usd_value).toFixed(2)} · since {new Date(p.created_at).toLocaleDateString()}</p>
              </div>
              <button onClick={async () => { await doWithdraw({ data: { id: profile.id, key: profile.key, positionId: p.id } }); refresh(); }}
                className="chunky chunky-press rounded-lg bg-secondary px-3 py-1 text-xs font-black">WITHDRAWN</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-muted py-2"><div className="font-display text-xl text-gold">{value}</div>{label}</div>;
}
