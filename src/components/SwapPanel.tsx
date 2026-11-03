import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from "viem";
import { recordSwap } from "@/lib/api.functions";
import { B20_DECIMALS } from "@/lib/b20";
import { baseClient, useWalletStocks } from "@/lib/wallet-stocks";
import { UNI_QUOTER, UNI_ROUTER, USDC, USDC_DECIMALS, WETH, quoterAbi, uniRouterAbi } from "@/lib/defi";
import type { Profile } from "@/lib/profile";
import type { Wallet } from "@/components/GameApp";

type Hex = `0x${string}`;
type Token = { symbol: string; address: Hex; decimals: number; isEth?: boolean };
const ETH: Token = { symbol: "ETH", address: WETH, decimals: 18, isEth: true };
const USDC_T: Token = { symbol: "USDC", address: USDC, decimals: USDC_DECIMALS };
const FEES = [500, 3000, 10000] as const;

export function SwapPanel({ wallet, profile }: { wallet: Wallet | null; profile: Profile }) {
  const qc = useQueryClient();
  const record = useServerFn(recordSwap);
  const owner = wallet?.authed ? (wallet.address as Hex | undefined) : undefined;
  const assets = useWalletStocks(owner);
  const usdc = useQuery({
    queryKey: ["usdc", owner], enabled: !!owner, refetchInterval: 30_000,
    queryFn: async () => Number(formatUnits(await baseClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner!] }), USDC_DECIMALS)),
  });

  const tokens = useMemo<Token[]>(() => [
    ETH, USDC_T,
    ...(assets.data?.holdings ?? []).map((h) => ({ symbol: h.ticker, address: h.address, decimals: B20_DECIMALS })),
  ], [assets.data]);

  const [fromSym, setFromSym] = useState("ETH");
  const [toSym, setToSym] = useState("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);

  const from = tokens.find((t) => t.symbol === fromSym) ?? ETH;
  const to = tokens.find((t) => t.symbol === toSym) ?? USDC_T;
  const bal = from.isEth ? assets.data?.eth ?? 0
    : from.symbol === "USDC" ? usdc.data ?? 0
    : assets.data?.holdings.find((h) => h.ticker === from.symbol)?.balance ?? 0;

  const parsedIn = (() => { try { return amountIn && Number(amountIn) > 0 ? parseUnits(amountIn, from.decimals) : 0n; } catch { return 0n; } })();

  const quote = useQuery({
    queryKey: ["uni-quote", from.symbol, to.symbol, amountIn],
    enabled: !!owner && parsedIn > 0n && from.symbol !== to.symbol,
    refetchInterval: 15_000,
    queryFn: async () => {
      for (const fee of FEES) {
        try {
          const r = await baseClient.simulateContract({
            address: UNI_QUOTER, abi: quoterAbi, functionName: "quoteExactInputSingle",
            args: [{ tokenIn: from.address, tokenOut: to.address, amountIn: parsedIn, fee, sqrtPriceLimitX96: 0n }],
          });
          if (r.result[0] > 0n) return { out: r.result[0], fee };
        } catch { /* no pool at this fee tier */ }
      }
      throw new Error("No Uniswap pool for this pair");
    },
  });

  const swap = async () => {
    if (!wallet?.authed || !owner) { setMsg({ text: "Sign in first" }); return; }
    if (parsedIn <= 0n || parsedIn > parseUnits(bal.toFixed(from.decimals), from.decimals)) { setMsg({ text: `Check your ${from.symbol} balance` }); return; }
    if (!quote.data) { setMsg({ text: "Waiting for a quote…" }); return; }
    setBusy(true); setMsg({ text: "Swapping on Uniswap…" });
    try {
      const minOut = (quote.data.out * 97n) / 100n; // 3% slippage
      if (!from.isEth) {
        const cur = await baseClient.readContract({ address: from.address, abi: erc20Abi, functionName: "allowance", args: [owner, UNI_ROUTER] });
        if (cur < parsedIn) await wallet.send(from.address, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [UNI_ROUTER, parsedIn] }));
      }
      const data = encodeFunctionData({ abi: uniRouterAbi, functionName: "exactInputSingle",
        args: [{ tokenIn: from.address, tokenOut: to.address, fee: quote.data.fee, recipient: owner, amountIn: parsedIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
      const hash = await wallet.send(UNI_ROUTER, data, from.isEth ? parsedIn : undefined);
      setMsg({ text: "Counting your points…" });
      const r = await record({ data: { id: profile.id, key: profile.key, txHash: hash, fromTicker: from.symbol, toTicker: to.symbol } });
      setMsg({ text: `Swapped $${r.usd.toFixed(2)} · +${r.points} rank points!`, ok: true });
      setAmountIn("");
      ["me", "leaderboard", "b20", "usdc"].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) {
      const t = e instanceof Error ? e.message : "Failed";
      setMsg({ text: /insufficient funds|gas/i.test(t) ? "Need a little ETH on Base for gas" : t.slice(0, 120) });
    } finally { setBusy(false); }
  };

  const outHuman = quote.data ? Number(formatUnits(quote.data.out, to.decimals)) : null;
  const selectCls = "chunky w-full rounded-lg bg-muted px-2 py-1.5 font-display text-sm";

  return (
    <div className="space-y-4">
      <section className="chunky rounded-2xl bg-card p-4">
        <div className="flex items-center justify-between">
          <p className="font-display text-xl">From</p>
          <p className="text-xs font-bold text-muted-foreground">Balance: {bal.toLocaleString(undefined, { maximumFractionDigits: 6 })} {from.symbol}</p>
        </div>
        <div className="mt-2 flex gap-2">
          <input value={amountIn} onChange={(e) => setAmountIn(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0"
            inputMode="decimal" className="chunky w-full rounded-lg bg-muted px-3 py-2 font-display text-2xl outline-none" />
          <select value={fromSym} onChange={(e) => setFromSym(e.target.value)} className={selectCls} style={{ maxWidth: "7.5rem" }}>
            {tokens.filter((t) => t.symbol !== toSym).map((t) => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
          </select>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {[25, 50, 75, 100].map((p) => (
            <button key={p} onClick={() => setAmountIn(((bal * p) / 100).toFixed(6).replace(/\.?0+$/, ""))}
              className="chunky chunky-press rounded-lg bg-secondary py-1 font-display text-xs">{p === 100 ? "MAX" : `${p}%`}</button>
          ))}
        </div>
      </section>

      <div className="flex justify-center">
        <button onClick={() => { setFromSym(toSym); setToSym(fromSym); setAmountIn(""); }}
          className="chunky chunky-press rounded-full bg-primary px-4 py-1 font-display text-primary-foreground">⇅ FLIP</button>
      </div>

      <section className="chunky rounded-2xl bg-card p-4">
        <p className="font-display text-xl">To</p>
        <div className="mt-2 flex gap-2">
          <div className="chunky flex w-full items-center rounded-lg bg-muted px-3 py-2 font-display text-2xl">
            {quote.isFetching ? "…" : outHuman != null ? outHuman.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0.0"}
          </div>
          <select value={toSym} onChange={(e) => setToSym(e.target.value)} className={selectCls} style={{ maxWidth: "7.5rem" }}>
            {tokens.filter((t) => t.symbol !== fromSym).map((t) => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
          </select>
        </div>
        {quote.isError && parsedIn > 0n && <p className="mt-2 text-xs font-bold text-muted-foreground">No Uniswap pool found for this pair on Base.</p>}
      </section>

      <button onClick={() => void swap()} disabled={busy || !wallet?.authed || parsedIn <= 0n}
        className="chunky chunky-press w-full rounded-2xl bg-accent py-3 font-display text-2xl disabled:opacity-40">
        {busy ? "SWAPPING…" : "⚡ SWAP"}
      </button>
      {msg && <p className={`text-center text-sm font-bold ${msg.ok ? "text-accent" : "text-muted-foreground"}`}>{msg.text}</p>}
      <p className="text-center text-xs text-muted-foreground">Swaps route through Uniswap V3 on Base. Every $1 swapped earns +1 rank point.</p>
      {!wallet?.authed && <p className="text-center text-sm text-muted-foreground">Sign in to swap from your game wallet.</p>}
    </div>
  );
}
