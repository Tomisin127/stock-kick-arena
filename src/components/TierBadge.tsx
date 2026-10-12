import { tierFor } from "@/lib/ranks";

export function TierBadge({ points, size = "md" }: { points: number; size?: "sm" | "md" | "lg" }) {
  const { tier } = tierFor(points);
  const s = size === "lg" ? "size-20 text-4xl" : size === "sm" ? "size-8 text-base" : "size-12 text-2xl";
  return (
    <span className={`chunky grid shrink-0 place-items-center rounded-full ${s}`} style={{ background: tier.color }} title={tier.name}>
      {tier.icon}
    </span>
  );
}

export function TierProgress({ points }: { points: number }) {
  const { tier, next, progress } = tierFor(points);
  return (
    <div className="flex items-center gap-3">
      <TierBadge points={points} size="lg" />
      <div className="flex-1">
        <p className="font-display text-stroke text-2xl" style={{ color: tier.color }}>{tier.name.toUpperCase()}</p>
        <div className="chunky mt-1 h-5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className="mt-1 text-xs font-bold text-muted-foreground">
          {points} pts {next ? `· ${next.min - points} to ${next.name}` : "· Max tier!"}
        </p>
      </div>
    </div>
  );
}
