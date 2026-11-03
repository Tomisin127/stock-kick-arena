import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { erc20Abi, formatUnits } from "viem";
import { getMe } from "@/lib/api.functions";
import { baseClient, useWalletStocks } from "@/lib/wallet-stocks";
import { USDC, USDC_DECIMALS } from "@/lib/defi";
import { TierProgress } from "@/components/TierBadge";
import type { Profile } from "@/lib/profile";
import type { Wallet } from "@/components/GameApp";

type Hex = `0x${string}`;

export function PortfolioPanel({ wallet, profile }: { wallet: Wallet | null; profile: Profile }) {
  const me = useServerFn(getMe);
  const { data } = useQuery({ queryKey: ["me", profile.id], queryFn: () => me({ data: { id: profile.id, key: profile.key } }), refetchInterval: 30_000 });
  const owner = wallet?.authed ? (wallet.address as Hex | undefined) : undefined;
  const assets = useWalletStocks(owner);
  const usdc = useQuery({
    queryKey: ["usdc", owner], enabled: !!owner, refetchInterval: 30_000,
    queryFn: async () => Number(formatUnits(await baseClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner!] }), USDC_DECIMALS)),
  });
  const ethUsd = useQuery({
    queryKey: ["eth-price"], staleTime: 60_000,
    queryFn: () => fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")
      .then((r) => r.json()).then((j) => Number(j?.ethereum?.usd) || 0).catch(() => 0),
  });

  const s = data?.stats;
  const eth = assets.data?.eth ?? 0;
  const holdings = assets.data?.holdings ?? [];
  const stocksUsd = holdings.reduce((sum, h) => sum + h.usd, 0);
  const totalUsd = eth * (ethUsd.data ?? 0) + (usdc.data ?? 0) + stocksUsd;
  const lentUsd = Number(s?.lent_usd ?? 0);

  return (
    <div className="space-y-4">
      <section className="chunky rounded-2xl bg-card p-4 text-center">
        <p className="font-display text-lg text-muted-foreground">{profile.name}</p>
        <p className="font-display text-stroke text-5xl text-gold">${totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
        <p className="text-xs font-bold text-muted-foreground">Wallet value on Base{lentUsd > 0 ? ` · $${Math.round(lentUsd)} lent out` : ""}</p>
        <div className="mt-3"><TierProgress points={s?.total_points ?? 0} /></div>
      </section>

      <section className="chunky rounded-2xl bg-card p-4">
        <h2 className="font-display text-stroke text-xl">Assets</h2>
        {!wallet?.authed && <p className="mt-2 text-sm text-muted-foreground">Sign in to see your wallet.</p>}
        {wallet?.authed && assets.isLoading && <p className="mt-2 text-sm text-muted-foreground">Reading your wallet on Base…</p>}
        <div className="mt-2 space-y-2">
          {wallet?.authed && (
            <Row color="#627eea" ticker="ETH" name="Ether" amount={eth} usd={eth * (ethUsd.data ?? 0)} />
          )}
          {wallet?.authed && (usdc.data ?? 0) > 0 && (
            <Row color="#2775ca" ticker="USDC" name="USD Coin" amount={usdc.data ?? 0} usd={usdc.data ?? 0} />
          )}
          {holdings.map((h) => (
            <Row key={h.address} color={h.color} ticker={h.ticker} name={h.name} amount={h.balance} usd={h.usd} />
          ))}
          {wallet?.authed && !assets.isLoading && !holdings.length && !(usdc.data ?? 0) && eth === 0 && (
            <p className="text-sm text-muted-foreground">No ETH, USDC or tokenized stocks in this wallet yet.</p>
          )}
        </div>
      </section>

      <section className="chunky rounded-2xl bg-card p-4">
        <h2 className="font-display text-stroke text-xl">Lending positions</h2>
        {!data?.positions.length && <p className="mt-2 text-sm text-muted-foreground">Nothing lent yet — head to Lend to earn rank points.</p>}
        <div className="mt-2 space-y-2">
          {data?.positions.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2">
              <div>
                <p className="font-display">{Number(p.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} {p.ticker} → {p.protocol}</p>
                <p className="text-xs text-muted-foreground">${Number(p.usd_value).toFixed(2)} · since {new Date(p.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="chunky rounded-2xl bg-card p-4">
        <h2 className="font-display text-stroke text-xl">Rank breakdown</h2>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
          <Stat label="Game pts" value={s?.game_points ?? 0} />
          <Stat label="Lend pts" value={s?.lend_points ?? 0} />
          <Stat label="Swap pts" value={s?.swap_points ?? 0} />
        </div>
      </section>
    </div>
  );
}

function Row({ color, ticker, name, amount, usd }: { color: string; ticker: string; name: string; amount: number; usd: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-muted px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full font-display text-[10px]" style={{ background: color }}>{ticker.slice(0, 4)}</span>
        <div>
          <p className="font-display leading-tight">{ticker}</p>
          <p className="text-[11px] text-muted-foreground">{name}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-display">{amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</p>
        <p className="text-[11px] font-bold text-gold">${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-muted py-2"><div className="font-display text-xl text-gold">{value}</div>{label}</div>;
}
