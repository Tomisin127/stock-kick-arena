import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { SwapPanel } from "@/components/SwapPanel";

const GameApp = lazy(() => import("@/components/GameApp"));

export const Route = createFileRoute("/swap")({
  head: () => ({
    meta: [
      { title: "Swap — StockBall" },
      { name: "description", content: "Instantly swap ETH, USDC and tokenized stocks on Base via Uniswap and earn rank points." },
      { property: "og:title", content: "Swap — StockBall" },
      { property: "og:description", content: "Swap ETH, USDC and tokenized stocks on Base and climb the StockBall leaderboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <main className="mx-auto max-w-xl space-y-4 px-3 pb-8">
      <h1 className="text-center font-display text-stroke text-4xl text-gold">⚡ SWAP & SCORE</h1>
      <ClientOnly fallback={null}><Suspense fallback={null}>
        <GameApp view={(w, p) => <SwapPanel wallet={w} profile={p} />} />
      </Suspense></ClientOnly>
    </main>
  ),
});
