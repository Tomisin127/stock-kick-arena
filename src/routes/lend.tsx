import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { LendPanel } from "@/components/LendPanel";

const GameApp = lazy(() => import("@/components/GameApp"));

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
      <ClientOnly fallback={null}><Suspense fallback={null}>
        <GameApp view={(w, p) => <LendPanel wallet={w} profile={p} />} />
      </Suspense></ClientOnly>
    </main>
  ),
});

