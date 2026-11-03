import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PortfolioPanel } from "@/components/PortfolioPanel";

const GameApp = lazy(() => import("@/components/GameApp"));

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio — StockBall" },
      { name: "description", content: "Your StockBall wallet on Base: ETH, USDC, tokenized stocks, lending positions and rank breakdown." },
      { property: "og:title", content: "Portfolio — StockBall" },
      { property: "og:description", content: "Track your tokenized stocks, lending positions and rank points on StockBall." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <main className="mx-auto max-w-xl space-y-4 px-3 pb-8">
      <h1 className="text-center font-display text-stroke text-4xl text-gold">💼 PORTFOLIO</h1>
      <ClientOnly fallback={null}><Suspense fallback={null}>
        <GameApp view={(w, p) => <PortfolioPanel wallet={w} profile={p} />} />
      </Suspense></ClientOnly>
    </main>
  ),
});
