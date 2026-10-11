import { useEffect, useState } from "react";

export type Profile = { id: string; name: string; key: string };
const KEY = "stockball-profile";

export function loadProfile(): Profile | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; }
}
export function saveProfile(p: Profile | null) {
  if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("stockball-profile"));
}
export function useProfile() {
  const [p, setP] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const f = () => setP(loadProfile());
    f(); setReady(true);
    window.addEventListener("stockball-profile", f);
    return () => window.removeEventListener("stockball-profile", f);
  }, []);
  return { profile: p, ready };
}
