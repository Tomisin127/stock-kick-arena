import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Net, NetMsg } from "@/components/game/Pitch";

export type Opp = { id: string; name: string; ticker: string };
export type Match = { matchId: string; role: "host" | "guest"; opp: Opp; net: Net; oppLeft: boolean };

type Me = { id: string; name: string; ticker: string };

/** Finds an opponent via a shared lobby, then opens a private match channel. */
export function useMatchmaking(me: Me | null, searching: boolean) {
  const [match, setMatch] = useState<Match | null>(null);
  const [queue, setQueue] = useState(0);
  const matchCh = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!me || !searching) return;
    const ts = Date.now();
    const lobby = supabase.channel("stockball-lobby", { config: { presence: { key: me.id } } });
    let done = false;
    lobby.on("presence", { event: "sync" }, () => {
      if (done) return;
      const state = lobby.presenceState<{ id: string; name: string; ticker: string; ts: number }>();
      const list = Object.values(state).map((v) => v[0]!).filter(Boolean).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
      setQueue(list.length); console.log("rt sync", JSON.stringify(list));
      if (list.length < 2) return;
      const [a, b] = list as [typeof list[0], typeof list[0]];
      if (a.id !== me.id && b.id !== me.id) return;
      done = true;
      const role = a.id === me.id ? "host" : "guest";
      const opp = role === "host" ? b : a;
      const matchId = `${a.id}:${b.id}:${a.ts}`;
      openMatch(matchId, role, { id: opp.id, name: opp.name, ticker: opp.ticker });
    });
    lobby.subscribe((s, e) => { console.log("rt lobby", s, e?.message); if (s === "SUBSCRIBED") void lobby.track({ ...me, ts }); });

    const openMatch = (matchId: string, role: "host" | "guest", opp: Opp) => {
      const ch = supabase.channel(`stockball-match-${matchId}`, { config: { broadcast: { self: false }, presence: { key: me.id } } });
      const listeners = new Set<(m: NetMsg) => void>();
      ch.on("broadcast", { event: "m" }, ({ payload }) => listeners.forEach((fn) => fn(payload as NetMsg)));
      let seen = false;
      ch.on("presence", { event: "sync" }, () => {
        const here = Object.keys(ch.presenceState());
        if (here.includes(opp.id)) {
          if (!seen) {
            seen = true;
            void supabase.removeChannel(lobby);
            const net: Net = {
              role,
              send: (m) => void ch.send({ type: "broadcast", event: "m", payload: m }),
              listen: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
            };
            setMatch({ matchId, role, opp, net, oppLeft: false });
          }
        } else if (seen) {
          setMatch((m) => (m ? { ...m, oppLeft: true } : m));
        }
      });
      ch.subscribe((s) => { if (s === "SUBSCRIBED") void ch.track({ id: me.id }); });
      matchCh.current = ch;
    };

    return () => { void supabase.removeChannel(lobby); };
  }, [me?.id, searching]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    if (matchCh.current) void supabase.removeChannel(matchCh.current);
    matchCh.current = null;
    setMatch(null);
  };
  useEffect(() => () => { if (matchCh.current) void supabase.removeChannel(matchCh.current); }, []);

  return { match, queue, leave };
}
