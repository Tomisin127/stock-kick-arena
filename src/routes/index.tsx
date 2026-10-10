import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const GameApp = lazy(() => import("@/components/GameApp"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "StockBall — Onchain football with tokenized stocks" },
      { name: "description", content: "Top-down onchain football on Base. Lock a tokenized stock, flick your 5 players, and every kick is a transaction." },
      { property: "og:title", content: "StockBall — Onchain football with tokenized stocks" },
      { property: "og:description", content: "Lock a tokenized stock and play football against the CPU on Base." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Loading() {
  return <div className="grid min-h-dvh place-items-center font-display text-stroke text-3xl text-gold">LOADING STADIUM…</div>;
}

function Index() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <GameApp />
      </Suspense>
    </ClientOnly>
  );
}
