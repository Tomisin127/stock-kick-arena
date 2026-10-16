import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits, zeroAddress } from "viem";
import { getMe, recordDeposit, withdraw } from "@/lib/api.functions";
import { B20_TOKENS, B20_DECIMALS } from "@/lib/b20";
import { baseClient, useWalletStocks } from "@/lib/wallet-stocks";
import { AAVE_POOL, AERO_FACTORY, AERO_ROUTER, USDC, USDC_DECIMALS, aaveAbi, aeroFactoryAbi, aeroRouterAbi, vaultAbi } from "@/lib/defi";
import { TierProgress } from "@/components/TierBadge";
import type { Profile } from "@/lib/profile";
import type { Wallet } from "@/components/GameApp";

type Hex = `0x${string}`;
type Opp = {
  id: string; kind: "aave" | "morpho" | "aerodrome"; protocol: string; title: string; sub: string; apy?: number | undefined; tvl?: number | undefined;
  asset: Hex; decimals: number; symbol: string; target: Hex;
};

const lc = (s: string) => s.toLowerCase();

function useOpportunities() {
  return useQuery({
    queryKey: ["defi-opps"], staleTime: 300_000,
    queryFn: async (): Promise<Opp[]> => {
      const out: Opp[] = [{
        id: "aave-usdc", kind: "aave", protocol: "aave-v3", title: "Aave V3", sub: "Supply USDC", asset: USDC, decimals: USDC_DECIMALS, symbol: "USDC", target: AAVE_POOL,
      }];
      // Aerodrome stock/USDC volatile pools
      const pools = await baseClient.multicall({
        allowFailure: true,
        contracts: B20_TOKENS.map((t) => ({ address: AERO_FACTORY, abi: aeroFactoryAbi, functionName: "getPool", args: [t.address, USDC, false] }) as const),
      }).catch(() => []);
      B20_TOKENS.forEach((t, i) => {
        const r = pools[i];
        const p = r && r.status === "success" ? (r.result as Hex) : zeroAddress;
        if (p !== zeroAddress) out.push({ id: `aero-${t.ticker}`, kind: "aerodrome", protocol: "aerodrome-v1", title: "Aerodrome", sub: `${t.ticker} / USDC pool`, asset: t.address, decimals: B20_DECIMALS, symbol: t.ticker, target: p });
      });
      // Morpho ERC-4626 vaults for USDC + stocks
      const q = `{ vaults(first: 30, orderBy: TotalAssetsUsd, orderDirection: Desc, where: { chainId_in: [8453], whitelisted: true, assetAddress_in: ${JSON.stringify([USDC, ...B20_TOKENS.map((t) => t.address)])} }) { items { address name asset { address symbol decimals } state { netApy totalAssetsUsd } } } }`;
      const m = await fetch("https://blue-api.morpho.org/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) })
        .then((r) => r.json()).catch(() => null);
      for (const v of m?.data?.vaults?.items ?? []) {
        out.push({ id: `morpho-${v.address}`, kind: "morpho", protocol: "morpho", title: "Morpho", sub: v.name, apy: (v.state?.netApy ?? 0) * 100, tvl: v.state?.totalAssetsUsd,
          asset: v.asset.address, decimals: v.asset.decimals, symbol: v.asset.symbol, target: v.address });
      }
      // APYs from DeFiLlama where available
      const y = await fetch("https://yields.llama.fi/pools").then((r) => r.json()).catch(() => null);
      for (const p of (y?.data ?? []) as any[]) {
        if (p.chain !== "Base") continue;
        if (p.project === "aave-v3" && p.symbol === "USDC") { out[0]!.apy = p.apy; out[0]!.tvl = p.tvlUsd; }
        const o = out.find((x) => x.kind === "aerodrome" && lc(p.pool ?? "").includes(lc(x.target)));
        if (o) { o.apy = p.apy; o.tvl = p.tvlUsd; }
      }
      return out;
    },
  });
}

export function LendPanel({ wallet, profile }: { wallet: Wallet | null; profile: Profile }) {
  const qc = useQueryClient();
  const me = useServerFn(getMe), record = useServerFn(recordDeposit), doWithdraw = useServerFn(withdraw);
  const { data } = useQuery({ queryKey: ["me", profile.id], queryFn: () => me({ data: { id: profile.id, key: profile.key } }), refetchInterval: 30_000 });
  const owner = wallet?.authed ? (wallet.address as Hex | undefined) : undefined;
  const assets = useWalletStocks(owner);
  const usdc = useQuery({
    queryKey: ["usdc", owner], enabled: !!owner, refetchInterval: 30_000,
    queryFn: async () => Number(formatUnits(await baseClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner!] }), USDC_DECIMALS)),
  });
  const opps = useOpportunities();
  const [pct, setPct] = useState(100);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; ok?: boolean } | null>(null);

  const bal = (asset: string) => lc(asset) === lc(USDC) ? usdc.data ?? 0 : assets.data?.holdings.find((h) => lc(h.address) === lc(asset))?.balance ?? 0;
  const sorted = useMemo(() => [...(opps.data ?? [])].sort((a, b) => (bal(b.asset) > 0 ? 1 : 0) - (bal(a.asset) > 0 ? 1 : 0)),
    [opps.data, assets.data, usdc.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => ["me", "leaderboard", "b20", "usdc"].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));

  const approve = async (token: Hex, spender: Hex, amount: bigint) => {
    const cur = await baseClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner!, spender] });
    if (cur >= amount) return;
    await wallet!.send(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }));
  };

  const deposit = async (o: Opp) => {
    if (!wallet?.authed || !owner) { setMsg({ id: o.id, text: "Sign in first" }); return; }
    const human = (bal(o.asset) * pct) / 100;
    if (human <= 0) { setMsg({ id: o.id, text: `You have no ${o.symbol}` }); return; }
    const amount = parseUnits(human.toFixed(o.decimals), o.decimals);
    setBusy(o.id); setMsg({ id: o.id, text: "Depositing on Base…" });
    try {
      let hash: Hex;
      if (o.kind === "aave") {
        await approve(o.asset, AAVE_POOL, amount);
        hash = await wallet.send(AAVE_POOL, encodeFunctionData({ abi: aaveAbi, functionName: "supply", args: [o.asset, amount, owner, 0] }));
      } else if (o.kind === "morpho") {
        await approve(o.asset, o.target, amount);
        hash = await wallet.send(o.target, encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [amount, owner] }));
      } else {
        const usdcBal = parseUnits((usdc.data ?? 0).toFixed(USDC_DECIMALS), USDC_DECIMALS);
        const [a, b] = await baseClient.readContract({ address: AERO_ROUTER, abi: aeroRouterAbi, functionName: "quoteAddLiquidity",
          args: [o.asset, USDC, false, AERO_FACTORY, amount, 10n ** 30n] });
        let amtA = a, amtB = b;
        if (amtB > usdcBal) { // scale down to what USDC allows
          if (usdcBal === 0n) throw new Error("This pool also needs USDC in your wallet");
          amtA = (a * usdcBal) / b; amtB = usdcBal;
        }
        await approve(o.asset, AERO_ROUTER, amtA);
        await approve(USDC, AERO_ROUTER, amtB);
        hash = await wallet.send(AERO_ROUTER, encodeFunctionData({ abi: aeroRouterAbi, functionName: "addLiquidity",
          args: [o.asset, USDC, false, amtA, amtB, (amtA * 97n) / 100n, (amtB * 97n) / 100n, owner, BigInt(Math.floor(Date.now() / 1000) + 1200)] }));
      }
      setMsg({ id: o.id, text: "Verifying deposit…" });
      const r = await record({ data: { id: profile.id, key: profile.key, txHash: hash, protocol: o.protocol } });
      setMsg({ id: o.id, text: `Deposited $${r.usd.toFixed(2)} · rank boosted!`, ok: true });
      refresh();
    } catch (e) {
      const t = e instanceof Error ? e.message : "Failed";
      setMsg({ id: o.id, text: /insufficient funds|gas/i.test(t) ? "Need a little ETH on Base for gas" : t.slice(0, 120) });
    } finally { setBusy(null); }
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

      <section className="chunky sticky top-2 z-10 rounded-2xl bg-card p-3">
        <div className="flex items-center justify-between text-xs font-bold">
          <span>Wallet: {(usdc.data ?? 0).toFixed(2)} USDC · {assets.data?.holdings.length ?? 0} stocks</span>
          <span className="text-muted-foreground">Deposit size</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {[25, 50, 75, 100].map((p) => (
            <button key={p} onClick={() => setPct(p)}
              className={`chunky chunky-press rounded-lg py-1 font-display ${pct === p ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{p === 100 ? "MAX" : `${p}%`}</button>
          ))}
        </div>
      </section>

      {!wallet?.authed && <p className="text-center text-sm text-muted-foreground">Sign in to deposit from your game wallet.</p>}
      {opps.isLoading && <p className="text-center text-sm text-muted-foreground">Loading pools on Base…</p>}

      <div className="grid grid-cols-2 gap-3">
        {sorted.map((o) => {
          const b = bal(o.asset);
          return (
            <div key={o.id} className={`chunky flex flex-col rounded-2xl p-3 ${b > 0 ? "bg-card" : "bg-muted"}`}>
              <p className="font-display text-lg leading-tight">{o.title}</p>
              <p className="truncate text-[11px] font-bold text-muted-foreground">{o.sub}</p>
              <p className="mt-1 font-display text-2xl text-accent">{o.apy != null ? `${o.apy.toFixed(1)}%` : "—"}</p>
              <p className="text-[11px] text-muted-foreground">{o.tvl ? `TVL $${Math.round(o.tvl).toLocaleString()}` : "APY"}</p>
              <p className="mt-1 text-[11px] font-bold">You: {b.toLocaleString(undefined, { maximumFractionDigits: 4 })} {o.symbol}</p>
              <button onClick={() => void deposit(o)} disabled={!!busy || b <= 0}
                className="chunky chunky-press mt-2 rounded-lg bg-accent py-1.5 font-display text-sm disabled:opacity-40">
                {busy === o.id ? "…" : "DEPOSIT"}
              </button>
              {msg?.id === o.id && <p className={`mt-1 text-[11px] font-bold ${msg.ok ? "text-accent" : "text-muted-foreground"}`}>{msg.text}</p>}
            </div>
          );
        })}
      </div>

      <section className="chunky rounded-2xl bg-card p-4">
        <h2 className="font-display text-stroke text-xl">Your deposits</h2>
        {!data?.positions.length && <p className="mt-2 text-sm text-muted-foreground">Nothing deposited yet.</p>}
        <div className="mt-2 space-y-2">
          {data?.positions.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2">
              <div>
                <p className="font-display">{Number(p.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} {p.ticker} → {p.protocol}</p>
                <p className="text-xs text-muted-foreground">${Number(p.usd_value).toFixed(2)} · since {new Date(p.created_at).toLocaleDateString()}</p>
              </div>
              <button onClick={async () => { await doWithdraw({ data: { id: profile.id, key: profile.key, positionId: p.id } }); refresh(); }}
                className="chunky chunky-press rounded-lg bg-secondary px-3 py-1 text-xs font-black">I WITHDREW</button>
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
