export type Tier = { name: string; min: number; color: string; icon: string };

export const TIERS: Tier[] = [
  { name: "Bronze", min: 0, color: "#cd7f32", icon: "🥉" },
  { name: "Silver", min: 300, color: "#c0c7d1", icon: "🥈" },
  { name: "Gold", min: 800, color: "#ffd23f", icon: "🥇" },
  { name: "Platinum", min: 1500, color: "#5ee0d0", icon: "💠" },
  { name: "Diamond", min: 3000, color: "#6fb7ff", icon: "💎" },
  { name: "Champion", min: 5000, color: "#ff7ad9", icon: "👑" },
  { name: "Legend", min: 8000, color: "#ff8a3d", icon: "🔥" },
];

export function tierFor(points: number) {
  let i = 0;
  TIERS.forEach((t, k) => { if (points >= t.min) i = k; });
  const tier = TIERS[i]!;
  const next = TIERS[i + 1];
  const progress = next ? (points - tier.min) / (next.min - tier.min) : 1;
  return { tier, next, progress };
}

export const PROTOCOLS = [
  { id: "aerodrome", name: "Aerodrome", apy: 8.4, desc: "Base's main trading hub" },
  { id: "morpho", name: "Morpho", apy: 6.1, desc: "Lending vaults on Base" },
  { id: "moonwell", name: "Moonwell", apy: 5.3, desc: "Lend & borrow markets" },
  { id: "aave", name: "Aave", apy: 4.7, desc: "Blue-chip lending" },
];

export const POINT_RULES = [
  ["Win vs CPU", "+20"], ["Win online PvP", "+40"], ["Loss", "+3 / +8 PvP"],
  ["Each goal", "+5"], ["Each kick (max 40)", "+1"],
  ["Lend", "+1 per $10 lent"], ["Keep lending", "+0.05 per $ per day"],
] as const;
