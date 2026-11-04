import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from "viem";
import { recordSwap } from "@/lib/api.functions";
import { B20_TOKENS, B20_DECIMALS } from "@/lib/b20";
import { baseClient, useWalletStocks } from "@/lib/wallet-stocks";
import { UNI_QUOTER, UNI_ROUTER, USDC, USDC_DECIMALS, WETH, quoterAbi, uniRouterAbi } from "@/lib/defi";
import type { Profile } from "@/lib/profile";
import type { Wallet } from "@/components/GameApp";

type Hex = `0x${string}`;
type Token = { symbol: string; name: string; address: Hex; decimals: number; color: string; isEth?: boolean };
const ETH: Token = { symbol: "ETH", name: "Ether", address: WETH, decimals: 18, color: "#627eea", isEth: true };
const USDC_T: Token = { symbol: "USDC", name: "USD Coin", address: USDC, decimals: USDC_DECIMALS, color: "#2775ca" };
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

  // Every verified tokenized stock on Base can be swapped in and out.
  const tokens = useMemo<Token[]>(() => [
    ETH, USDC_T,
    ...B20_TOKENS.map((t) => ({ symbol: t.ticker, name: t.name, address: t.address, decimals: B20_DECIMALS, color: t.color })),
  ], []);

  const balances = useMemo(() => {
    const m = new Map<string, number>();
    m.set("ETH", assets.data?.eth ?? 0);
    m.set("USDC", usdc.data ?? 0);
    for (const h of assets.data?.holdings ?? []) m.set(h.ticker, h.balance);
    return m;
  }, [assets.data, usdc.data]);

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

  return (
    <div className="mx-auto w-full max-w-md space-y-4 md:max-w-xl">
      <section className="chunky rounded-2xl bg-card p-4">
        <div className="flex items-center justify-between">
          <p className="font-display text-xl">From</p>
          <p className="text-xs font-bold text-muted-foreground">Balance: {bal.toLocaleString(undefined, { maximumFractionDigits: 6 })} {from.symbol}</p>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input value={amountIn} onChange={(e) => setAmountIn(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0"
            inputMode="decimal" className="chunky w-full rounded-lg bg-muted px-3 py-2 font-display text-2xl outline-none sm:min-w-0 sm:flex-1" />
          <TokenSelect tokens={tokens.filter((t) => t.symbol !== toSym)} balances={balances} value={fromSym} onChange={setFromSym} />
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
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="chunky flex w-full items-center rounded-lg bg-muted px-3 py-2 font-display text-2xl sm:min-w-0 sm:flex-1">
            {quote.isFetching ? "…" : outHuman != null ? outHuman.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0.0"}
          </div>
          <TokenSelect tokens={tokens.filter((t) => t.symbol !== fromSym)} balances={balances} value={toSym} onChange={setToSym} />
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

export function TokenSelect({ tokens, balances, value, onChange }: {
  tokens: Token[]; balances: Map<string, number>; value: string; onChange: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = tokens.find((t) => t.symbol === value) ?? tokens[0]!;
  const list = useMemo(() => tokens
    .filter((t) => (t.symbol + " " + t.name).toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (balances.get(b.symbol) ?? 0) - (balances.get(a.symbol) ?? 0) || a.symbol.localeCompare(b.symbol)),
    [tokens, q, balances]);
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => { setOpen((o) => !o); setQ(""); }}
        className="chunky flex w-32 items-center justify-center gap-1.5 rounded-lg bg-muted px-2 py-2 font-display text-sm sm:py-1.5">
        <span className="grid size-4 shrink-0 place-items-center rounded-full text-[7px] font-black text-foreground" style={{ background: current.color }}>
          {current.symbol.slice(0, 2)}
        </span>
        <span className="truncate">{value}</span>
        <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <>
          <button aria-label="Close token list" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div className="chunky absolute right-0 z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-card p-2">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5">
              <Search size={12} className="shrink-0 text-muted-foreground" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stocks…"
                className="w-full bg-transparent font-display text-sm outline-none placeholder:text-muted-foreground" />
            </div>
            <div className="mt-1 max-h-64 overflow-y-auto">
              {list.map((t) => (
                <button key={t.symbol} onClick={() => { onChange(t.symbol); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full text-[8px] font-black text-foreground" style={{ background: t.color }}>
                    {t.symbol.slice(0, 3)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-sm leading-tight">{t.symbol}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{t.name}</span>
                  </span>
                  <span className="shrink-0 text-[10px] font-bold text-muted-foreground">
                    {(balances.get(t.symbol) ?? 0) > 0 ? (balances.get(t.symbol) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 }) : ""}
                  </span>
                </button>
              ))}
              {!list.length && <p className="px-2 py-3 text-center text-xs text-muted-foreground">No token found</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
