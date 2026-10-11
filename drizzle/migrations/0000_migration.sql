CREATE TABLE public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_hash text NOT NULL,
  game_points integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  pvp_wins integer NOT NULL DEFAULT 0,
  goals integer NOT NULL DEFAULT 0,
  kicks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.players TO service_role;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lend_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  protocol text NOT NULL,
  ticker text NOT NULL,
  amount numeric NOT NULL,
  usd_value numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);
GRANT ALL ON public.lend_positions TO service_role;
ALTER TABLE public.lend_positions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.match_reports (
  match_id text NOT NULL,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, player_id)
);
GRANT ALL ON public.match_reports TO service_role;
ALTER TABLE public.match_reports ENABLE ROW LEVEL SECURITY;

CREATE VIEW public.leaderboard AS
SELECT p.id, p.name, p.wins, p.losses, p.pvp_wins, p.goals, p.game_points,
  COALESCE(SUM(l.usd_value) FILTER (WHERE l.withdrawn_at IS NULL), 0)::numeric AS lent_usd,
  COALESCE(FLOOR(SUM(
    l.usd_value / 10 + l.usd_value * 0.05 *
    EXTRACT(EPOCH FROM (COALESCE(l.withdrawn_at, now()) - l.created_at)) / 86400
  )), 0)::integer AS lend_points,
  (p.game_points + COALESCE(FLOOR(SUM(
    l.usd_value / 10 + l.usd_value * 0.05 *
    EXTRACT(EPOCH FROM (COALESCE(l.withdrawn_at, now()) - l.created_at)) / 86400
  )), 0))::integer AS total_points
FROM public.players p
LEFT JOIN public.lend_positions l ON l.player_id = p.id
GROUP BY p.id;

GRANT SELECT ON public.leaderboard TO anon, authenticated, service_role;