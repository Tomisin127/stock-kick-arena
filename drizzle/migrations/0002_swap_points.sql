ALTER TABLE public.players ADD COLUMN swap_points integer NOT NULL DEFAULT 0;

CREATE TABLE public.swaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  tx_hash text NOT NULL UNIQUE,
  from_ticker text NOT NULL,
  to_ticker text NOT NULL,
  usd_value numeric NOT NULL,
  points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.swaps TO service_role;
ALTER TABLE public.swaps ENABLE ROW LEVEL SECURITY;

DROP VIEW public.leaderboard;
CREATE VIEW public.leaderboard AS
SELECT p.id, p.name, p.wins, p.losses, p.pvp_wins, p.goals, p.game_points, p.swap_points,
  COALESCE(SUM(l.usd_value) FILTER (WHERE l.withdrawn_at IS NULL), 0)::numeric AS lent_usd,
  COALESCE(FLOOR(SUM(
    l.usd_value / 10 + l.usd_value * 0.05 *
    EXTRACT(EPOCH FROM (COALESCE(l.withdrawn_at, now()) - l.created_at)) / 86400
  )), 0)::integer AS lend_points,
  (p.game_points + p.swap_points + COALESCE(FLOOR(SUM(
    l.usd_value / 10 + l.usd_value * 0.05 *
    EXTRACT(EPOCH FROM (COALESCE(l.withdrawn_at, now()) - l.created_at)) / 86400
  )), 0))::integer AS total_points
FROM public.players p
LEFT JOIN public.lend_positions l ON l.player_id = p.id
GROUP BY p.id;
GRANT SELECT ON public.leaderboard TO anon, authenticated, service_role;