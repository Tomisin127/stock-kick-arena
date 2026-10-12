import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getMe, lend, withdraw } from "@/lib/api.functions";
import { PROTOCOLS } from "@/lib/ranks";
import { STOCKS } from "@/lib/stocks";
import { ProfileGate } from "@/components/ProfileGate";
import { TierProgress } from "@/components/TierBadge";
import type { Profile } from "@/lib/profile";

export const Route = createFileRoute("/lend")({
  head: () => ({
    meta: [
      { title: "Lend Stocks — StockBall" },
      { name: "description", content: "Lend tokenized stocks to Base protocols like Aerodrome and Morpho to boost your global rank." },
      { property: "og:title", content: "Lend Stocks — StockBall" },
      { property: "og:description", content: "Lend tokenized stocks on Base and climb the StockBall leaderboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <main className="mx-auto max-w-xl space-y-4 px-3 pb-8">
      <h1 className="text-center font-display text-stroke text-4xl text-gold">🏦 LEND & RANK UP</h1>
      <ProfileGate>{(p) => <LendPage profile={p} />}</ProfileGate>
    </main>
  ),
});

function LendPage({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const me = useServerFn(getMe), doLend = useServerFn(lend), doWithdraw = useServerFn(withdraw);
  const { data } = useQuery({
    queryKey: ["me", profile.id],
    queryFn: () => me({ data: { id: profile.id, key: profile.key } }),
    refetchInterval: 30_000,
  });
  const [protocol, setProtocol] = useState(PROTOCOLS[0]!.id);
  const [ticker, setTicker] = useState(STOCKS[0]!.ticker);
  const [amount, setAmount] = useState(1);
  const [busy, setBusy] = useState(false);
  const stock = STOCKS.find((s) => s.ticker === ticker)!;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["me"] }); void qc.invalidateQueries({ queryKey: ["leaderboard"] }); };

  const submit = async () => {
    setBusy(true);
    try { await doLend({ data: { id: profile.id, key: profile.key, protocol, ticker, amount } }); refresh(); }
    finally { setBusy(false); }
  };

  const s = data?.stats;
  return (
    <>
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
        <h2 className="font-display text-stroke text-xl">1. Pick a protocol</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {PROTOCOLS.map((p) => (
            <button key={p.id} onClick={() => setProtocol(p.id)}
              className={`chunky chunky-press rounded-xl p-3 text-left ${protocol === p.id ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
              <div className="font-display text-lg">{p.name}</div>
              <div className="text-xs font-bold opacity-80">{p.desc}</div>
              <div className="mt-1 font-display text-accent">{p.apy}% APY</div>
            </button>
          ))}
        </div>
        <h2 className="mt-4 font-display text-stroke text-xl">2. Stock & amount</h2>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {STOCKS.map((st) => (
            <button key={st.ticker} onClick={() => setTicker(st.ticker)}
              className={`chunky chunky-press rounded-xl py-2 text-xs font-black ${ticker === st.ticker ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{st.ticker}</button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          {[0.5, 1, 5, 10].map((n) => (
            <button key={n} onClick={() => setAmount(n)}
              className={`chunky chunky-press flex-1 rounded-xl py-2 font-display text-lg ${amount === n ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{n}</button>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {amount} {ticker} ≈ ${(amount * stock.price).toFixed(2)} · +{Math.floor((amount * stock.price) / 10)} pts now, then more every day
        </p>
        <button onClick={submit} disabled={busy}
          className="chunky chunky-press mt-3 w-full rounded-2xl bg-accent py-3 font-display text-stroke text-2xl disabled:opacity-50">
          {busy ? "LENDING…" : "LEND"}
        </button>
        <p className="mt-2 text-center text-xs text-muted-foreground">Practice lending — no tokens move yet.</p>
      </section>

      <section className="chunky rounded-2xl bg-card p-4">
        <h2 className="font-display text-stroke text-xl">Your positions</h2>
        {!data?.positions.length && <p className="mt-2 text-sm text-muted-foreground">Nothing lent yet.</p>}
        <div className="mt-2 space-y-2">
          {data?.positions.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2">
              <div>
                <p className="font-display">{p.amount} {p.ticker} → {PROTOCOLS.find((x) => x.id === p.protocol)?.name}</p>
                <p className="text-xs text-muted-foreground">${Number(p.usd_value).toFixed(2)} · since {new Date(p.created_at).toLocaleDateString()}</p>
              </div>
              <button onClick={async () => { await doWithdraw({ data: { id: profile.id, key: profile.key, positionId: p.id } }); refresh(); }}
                className="chunky chunky-press rounded-lg bg-secondary px-3 py-1 text-xs font-black">WITHDRAW</button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-muted py-2"><div className="font-display text-xl text-gold">{value}</div>{label}</div>;
}
