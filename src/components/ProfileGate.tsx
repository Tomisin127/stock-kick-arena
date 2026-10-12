import { useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { registerPlayer } from "@/lib/api.functions";
import { saveProfile, useProfile, type Profile } from "@/lib/profile";

export function ProfileGate({ children }: { children: (p: Profile) => ReactNode }) {
  const { profile, ready } = useProfile();
  const register = useServerFn(registerPlayer);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!ready) return null;
  if (profile) return <>{children(profile)}</>;
  const submit = async () => {
    setBusy(true); setErr(null);
    try { saveProfile(await register({ data: { name } })); }
    catch { setErr("Pick a name between 2 and 16 characters."); }
    finally { setBusy(false); }
  };
  return (
    <section className="chunky mx-auto max-w-md rounded-2xl bg-card p-5 text-center">
      <p className="font-display text-stroke text-3xl text-gold">CHOOSE YOUR NAME</p>
      <p className="mt-1 text-sm text-muted-foreground">Your name appears on the global leaderboard.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} placeholder="e.g. StonksFC"
        className="chunky mt-4 w-full rounded-xl bg-input px-4 py-3 text-center font-display text-xl outline-none placeholder:text-muted-foreground" />
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      <button onClick={submit} disabled={busy || name.trim().length < 2}
        className="chunky chunky-press mt-4 w-full rounded-2xl bg-accent py-3 font-display text-stroke text-2xl disabled:opacity-50">
        {busy ? "..." : "LET'S GO"}
      </button>
    </section>
  );
}
