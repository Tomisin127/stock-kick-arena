import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getLeaderboard } from "@/lib/api.functions";
import { TIERS, POINT_RULES, tierFor } from "@/lib/ranks";
import { TierBadge } from "@/components/TierBadge";
import { useProfile } from "@/lib/profile";

const lbQuery = queryOptions({ queryKey: ["leaderboard"], queryFn: () => getLeaderboard(), staleTime: 15_000 });

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Global Leaderboard — StockBall" },
      { name: "description", content: "Top StockBall players ranked by match wins, goals and tokenized stock lending." },
      { property: "og:title", content: "Global Leaderboard — StockBall" },
      { property: "og:description", content: "Climb from Bronze to Legend in onchain football." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(lbQuery),
  component: Leaderboard,
});

function Leaderboard() {
  const { data } = useSuspenseQuery(lbQuery);
  const { profile } = useProfile();
  return (
    <main className="mx-auto max-w-xl space-y-4 px-3 pb-8">
      <h1 className="text-center font-display text-stroke text-4xl text-gold">🏆 GLOBAL RANKS</h1>
      <div className="flex justify-between gap-1 overflow-x-auto">
        {TIERS.map((t) => (
          <div key={t.name} className="flex min-w-12 flex-col items-center">
            <TierBadge points={t.min} size="sm" />
            <span className="mt-1 text-[10px] font-extrabold">{t.name}</span>
            <span className="text-[10px] text-muted-foreground">{t.min}</span>
          </div>
        ))}
      </div>
      <section className="chunky overflow-hidden rounded-2xl bg-card">
        {data.length === 0 && <p className="p-6 text-center text-muted-foreground">No players yet — be the first!</p>}
        {data.map((p, i) => {
          const pts = p.total_points ?? 0;
          const mine = profile?.id === p.id;
          return (
            <div key={p.id} className={`flex items-center gap-3 border-b-2 px-3 py-2 last:border-0 ${mine ? "bg-secondary" : i % 2 ? "bg-muted" : ""}`}>
              <span className={`w-8 text-center font-display text-stroke text-xl ${i < 3 ? "text-gold" : ""}`}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
              <TierBadge points={pts} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg leading-tight">{p.name}{mine && " (you)"}</p>
                <p className="text-[11px] font-bold text-muted-foreground">
                  {tierFor(pts).tier.name} · {p.wins}W {p.losses}L · ⚽ {p.goals} · 🏦 ${Math.round(Number(p.lent_usd ?? 0))}
                </p>
              </div>
              <span className="font-display text-stroke text-xl text-gold">{pts}</span>
            </div>
          );
        })}
      </section>
      <section className="chunky rounded-2xl bg-card p-4">
        <h2 className="font-display text-stroke text-xl">HOW TO EARN POINTS</h2>
        <ul className="mt-2 grid grid-cols-2 gap-2 text-sm font-bold">
          {POINT_RULES.map(([k, v]) => (
            <li key={k} className="flex justify-between rounded-lg bg-muted px-3 py-1"><span>{k}</span><span className="text-gold">{v}</span></li>
          ))}
        </ul>
      </section>
    </main>
  );
}
