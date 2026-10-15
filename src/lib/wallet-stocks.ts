import { useQuery } from "@tanstack/react-query";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { base } from "viem/chains";
import { B20_TOKENS, B20_DECIMALS } from "@/lib/b20";
import type { Stock } from "@/lib/stocks";

export const baseClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org"), batch: { multicall: true } });

export type Holding = Stock & { address: `0x${string}`; balance: number; usd: number };

export async function fetchPrices(addresses: string[]): Promise<Record<string, number>> {
  if (!addresses.length) return {};
  const q = addresses.map((a) => `base:${a}`).join(",");
  const r = await fetch(`https://coins.llama.fi/prices/current/${q}`).then((x) => x.json()).catch(() => null);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries<any>(r?.coins ?? {})) out[k.slice(5).toLowerCase()] = Number(v.price) || 0;
  return out;
}

export function useWalletStocks(address?: string) {
  return useQuery({
    queryKey: ["b20", address],
    enabled: !!address,
    refetchInterval: 30_000,
    queryFn: async () => {
      const owner = address as `0x${string}`;
      const [eth, results] = await Promise.all([
        baseClient.getBalance({ address: owner }),
        baseClient.multicall({
          allowFailure: true,
          contracts: B20_TOKENS.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }) as const),
        }),
      ]);
      const held = B20_TOKENS.map((t, i) => {
        const r = results[i];
        const raw = r && r.status === "success" ? (r.result as bigint) : 0n;
        return { t, balance: Number(formatUnits(raw, B20_DECIMALS)) };
      }).filter((x) => x.balance > 0);
      const prices = await fetchPrices(held.map((h) => h.t.address));
      const holdings: Holding[] = held.map(({ t, balance }) => {
        const price = prices[t.address.toLowerCase()] ?? 0;
        return { ticker: t.ticker, name: t.name, color: t.color, address: t.address, price, balance, usd: balance * price };
      }).sort((a, b) => b.usd - a.usd);
      return { eth: Number(formatUnits(eth, 18)), holdings };
    },
  });
}
