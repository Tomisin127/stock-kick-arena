import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PrivyProvider, usePrivy, useWallets, useSendTransaction } from "@privy-io/react-auth";
import { useServerFn } from "@tanstack/react-start";
import { base } from "viem/chains";
import { parseEther } from "viem";
import { PRIVY_APP_ID } from "@/lib/config";
import { STOCKS, GAME_CREATOR, KICK_USD, type Stock } from "@/lib/stocks";
import { Pitch } from "@/components/game/Pitch";
import { unlock, startMusic } from "@/lib/audio";
import { ProfileGate } from "@/components/ProfileGate";
import { reportMatch } from "@/lib/api.functions";
import { useMatchmaking } from "@/lib/online";
import { useWalletStocks, baseClient } from "@/lib/wallet-stocks";
import type { Profile } from "@/lib/profile";

type Kick = { id: number; status: "pending" | "sent" | "failed"; hash?: string };
export type Wallet = {
  ready: boolean; authed: boolean; address?: string | undefined; email?: string | undefined; login: () => void; logout: () => unknown;
  pay: () => Promise<string>;
  send: (to: `0x${string}`, data: `0x${string}`) => Promise<`0x${string}`>;
};

type View = (w: Wallet | null, p: Profile) => ReactNode;
export default function GameApp({ view }: { view?: View }) {
  if (!PRIVY_APP_ID) return <Shell wallet={null} view={view} />;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google"],
        appearance: { theme: "dark", accentColor: "#f5c542", landingHeader: "Sign in to StockBall" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        defaultChain: base as any,
        supportedChains: [base as any],
      }}
    >
      <PrivyBridge view={view} />
    </PrivyProvider>
  );
}

function PrivyBridge({ view }: { view?: View | undefined }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const ethPrice = useEthPrice();
  const wallet: Wallet = {
    ready, authed: authenticated, address: embedded?.address,
    email: user?.email?.address ?? user?.google?.email, login, logout,
    pay: async () => {
      if (!embedded) throw new Error("No wallet");
      const value = parseEther((KICK_USD / ethPrice.current).toFixed(18));
      const bal = await baseClient.getBalance({ address: embedded.address as `0x${string}` });
      if (bal <= value) throw new Error("Not enough ETH");
      await embedded.switchChain(base.id).catch(() => {});
      const { hash } = await sendTransaction(
        { to: GAME_CREATOR, value, chainId: base.id },
        { address: embedded.address, uiOptions: { showWalletUIs: false } },
      );
      return hash;
    },
    send: async (to, data) => {
      if (!embedded) throw new Error("Wallet not ready yet");
      await embedded.switchChain(base.id).catch(() => {});
      const { hash } = await sendTransaction(
        { to, data, chainId: base.id },
        { address: embedded.address, uiOptions: { showWalletUIs: false } },
      );
      await baseClient.waitForTransactionReceipt({ hash });
      return hash;
    },
  };
  return <Shell wallet={wallet} view={view} />;
}

function useEthPrice() {
  const p = useRef(2500);
  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")
      .then((r) => r.json()).then((j) => { if (j?.ethereum?.usd) p.current = j.ethereum.usd; }).catch(() => {});
  }, []);
  return p;
}

function Shell({ wallet, view }: { wallet: Wallet | null; view?: View | undefined }) {
  return (
    <div className="px-3 pb-6">
      <div className="mx-auto mb-3 flex max-w-xl justify-end"><WalletBadge wallet={wallet} /></div>
      {wallet && !wallet.authed ? (
        <section className="chunky mx-auto max-w-md rounded-2xl bg-card p-5 text-center">
          <p className="text-5xl">⚽</p>
          <p className="mt-2 font-display text-stroke text-3xl text-gold">WELCOME TO STOCKBALL</p>
          <p className="mt-1 text-sm text-muted-foreground">Sign in with email or Google to get your Base wallet and start playing.</p>
          <button onClick={wallet.login} disabled={!wallet.ready}
            className="chunky chunky-press mt-4 w-full rounded-2xl bg-team-blue py-3 font-display text-stroke text-2xl disabled:opacity-50">
            {wallet.ready ? "SIGN IN" : "LOADING…"}
          </button>
        </section>
      ) : (
        <ProfileGate>{(p) => (view ? view(wallet, p) : <Game wallet={wallet} profile={p} />)}</ProfileGate>
      )}
    </div>
  );
}

function Game({ wallet, profile }: { wallet: Wallet | null; profile: Profile }) {
  const [screen, setScreen] = useState<"lobby" | "search" | "match" | "result">("lobby");
  const [mode, setMode] = useState<"cpu" | "pvp">("cpu");
  const assets = useWalletStocks(wallet?.authed ? wallet.address : undefined);
  const holdings = assets.data?.holdings ?? [];
  const balls: Stock[] = holdings.length ? holdings : STOCKS;
  const [pickRaw, setPick] = useState<Stock | null>(null);
  const ball = balls.find((b) => b.ticker === pickRaw?.ticker) ?? balls[0]!;
  const pick = ball;
  const held = holdings.find((h) => h.ticker === ball.ticker);
  const [stake, setStake] = useState(1);
  const overStake = !!held && stake > held.balance;
  const [cpu, setCpu] = useState<Stock>(STOCKS[1]!);
  const [kicks, setKicks] = useState<Kick[]>([]);
  const [result, setResult] = useState<{ my: number; opp: number; points: number; forfeit?: boolean } | null>(null);
  const [cpuMatchId, setCpuMatchId] = useState("");
  const kid = useRef(0);
  const kickCount = useRef(0);
  const report = useServerFn(reportMatch);

  const me = useMemo(() => ({ id: profile.id, name: profile.name, ticker: pick.ticker }), [profile.id, profile.name, pick.ticker]);
  const { match, queue, leave } = useMatchmaking(me, screen === "search");

  useEffect(() => { if (match && screen === "search") { kickCount.current = 0; setKicks([]); setScreen("match"); } }, [match, screen]);

  const onKick = useCallback(() => {
    kickCount.current += 1;
    if (!wallet?.authed) return;
    const id = ++kid.current;
    setKicks((k) => [{ id, status: "pending" as const }, ...k].slice(0, 30));
    wallet.pay()
      .then((hash) => setKicks((k) => k.map((x) => (x.id === id ? { ...x, status: "sent", hash } : x))))
      .catch(() => setKicks((k) => k.map((x) => (x.id === id ? { ...x, status: "failed" } : x))));
  }, [wallet]);

  const finish = async (my: number, opp: number, matchId: string, m: "cpu" | "pvp", forfeit = false) => {
    setResult({ my, opp, points: 0, forfeit });
    setScreen("result");
    try {
      const r = await report({ data: { id: profile.id, key: profile.key, matchId, mode: m, won: my > opp || forfeit, goals: Math.min(my, 5), kicks: Math.min(kickCount.current, 200) } });
      setResult((x) => (x ? { ...x, points: r.points } : x));
    } catch { /* ignore */ }
  };

  const start = () => {
    unlock(); startMusic();
    kickCount.current = 0; setKicks([]);
    if (mode === "pvp") { setScreen("search"); return; }
    const others = STOCKS.filter((s) => s.ticker !== pick.ticker);
    setCpu(others[Math.floor(Math.random() * others.length)]!);
    setCpuMatchId(`cpu:${profile.id}:${Date.now()}`);
    setScreen("match");
  };

  // forfeit if opponent leaves mid-match
  useEffect(() => {
    if (screen === "match" && match?.oppLeft) { void finish(1, 0, match.matchId, "pvp", true); leave(); }
  }, [match?.oppLeft, screen]); // eslint-disable-line react-hooks/exhaustive-deps

  const stockOf = (t: string) => STOCKS.find((s) => s.ticker === t) ?? STOCKS[0]!;

  return (
    <>
      {screen === "lobby" && (
        <main className="mx-auto max-w-xl space-y-4">
          <Panel>
            <h2 className="font-display text-stroke text-xl">1. Choose a mode</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {([["cpu", "🤖", "VS CPU", "Practice & earn"], ["pvp", "⚔️", "ONLINE PVP", "Double points"]] as const).map(([m, icon, label, sub]) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`chunky chunky-press rounded-2xl p-3 text-center ${mode === m ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                  <div className="text-3xl">{icon}</div>
                  <div className="font-display text-xl">{label}</div>
                  <div className="text-xs font-bold opacity-80">{sub}</div>
                </button>
              ))}
            </div>
          </Panel>
          {wallet?.authed && (
            <Panel>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-stroke text-xl">💼 Your assets</h2>
                <button onClick={() => void assets.refetch()} className="text-xs font-bold text-muted-foreground underline">refresh</button>
              </div>
              {assets.isLoading ? <p className="mt-2 text-sm text-muted-foreground">Reading your wallet on Base…</p> : (
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between rounded-lg bg-muted px-3 py-1.5 font-bold"><span>ETH</span><span>{(assets.data?.eth ?? 0).toFixed(6)}</span></div>
                  {holdings.map((h) => (
                    <div key={h.ticker} className="flex justify-between rounded-lg bg-muted px-3 py-1.5 font-bold">
                      <span>{h.ticker} <span className="font-normal text-muted-foreground">{h.name}</span></span>
                      <span>{h.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} · ${h.usd.toFixed(2)}</span>
                    </div>
                  ))}
                  {!holdings.length && <p className="text-muted-foreground">No tokenized stocks in this wallet yet. Send some to the address above to use them as your ball.</p>}
                  {(assets.data?.eth ?? 0) === 0 && <p className="text-destructive">Add a little ETH on Base so your kicks can be paid.</p>}
                </div>
              )}
            </Panel>
          )}
          <Panel>
            <h2 className="font-display text-stroke text-xl">2. Pick your stock ball</h2>
            <p className="text-sm text-muted-foreground">{holdings.length ? "Tokenized stocks in your wallet" : "Practice balls — hold tokenized stocks to play with your own"}</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {balls.map((s) => (
                <button key={s.ticker} onClick={() => setPick(s)}
                  className={`chunky chunky-press flex flex-col items-center rounded-xl p-2 ${ball.ticker === s.ticker ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                  <span className="chunky grid size-10 place-items-center rounded-full bg-foreground text-[9px] font-black text-outline" style={{ boxShadow: `inset 0 0 0 4px ${s.color}` }}>{s.ticker}</span>
                  <span className="mt-1 text-[11px] font-bold">${s.price.toFixed(0)}</span>
                </button>
              ))}
            </div>
          </Panel>
          <Panel>
            {mode === "pvp" ? (
              <>
                <h2 className="font-display text-stroke text-xl">3. Set your PvP stake</h2>
                <div className="mt-2 flex items-center gap-2">
                  <input type="number" min={0} step="any" value={stake} max={held?.balance}
                    onChange={(e) => setStake(Math.max(0, Number(e.target.value) || 0))}
                    className="chunky w-full rounded-xl bg-secondary px-3 py-2 font-display text-lg outline-none" />
                  {held && <button onClick={() => setStake(held.balance)} className="chunky chunky-press rounded-xl bg-secondary px-3 py-2 font-display">MAX</button>}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {stake} {ball.ticker} ≈ ${(stake * ball.price).toFixed(2)}{held ? ` · you hold ${held.balance}` : " · practice"}
                </p>
                {overStake && <p className="mt-1 text-sm text-destructive">That's more than you hold.</p>}
              </>
            ) : (
              <>
                <h2 className="font-display text-stroke text-xl">3. Ready?</h2>
                <p className="mt-1 text-sm text-muted-foreground">No stake in CPU mode — just play, score and earn rank points.</p>
              </>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Every kick sends ${KICK_USD} in ETH on Base to the game creator.</p>
            <button onClick={start} disabled={mode === "pvp" && overStake} className="chunky chunky-press mt-3 w-full rounded-2xl bg-accent py-3 font-display text-stroke text-2xl text-foreground disabled:opacity-50">
              {mode === "pvp" ? "LOCK STAKE & FIND OPPONENT" : "KICK OFF!"}
            </button>
          </Panel>
        </main>
      )}

      {screen === "search" && (
        <main className="mx-auto max-w-md pt-10 text-center">
          <Panel>
            <div className="mx-auto size-16 animate-spin rounded-full border-8 border-muted border-t-primary" />
            <p className="mt-4 font-display text-stroke text-3xl text-gold">FINDING OPPONENT…</p>
            <p className="mt-2 text-sm text-muted-foreground">{queue <= 1 ? "Waiting for another player to join" : `${queue} players in queue`}</p>
            <button onClick={() => setScreen("lobby")} className="chunky chunky-press mt-5 w-full rounded-2xl bg-secondary py-3 font-display text-xl">CANCEL</button>
          </Panel>
        </main>
      )}

      {screen === "match" && mode === "cpu" && (
        <main className="mx-auto max-w-xl">
          <Pitch player={pick} cpu={cpu} onKick={onKick} onEnd={(s) => void finish(s[0], s[1], cpuMatchId, "cpu")} />
          <KickFeed kicks={kicks} />
        </main>
      )}

      {screen === "match" && mode === "pvp" && match && (
        <main className="mx-auto max-w-xl">
          <Pitch
            key={match.matchId}
            player={match.role === "host" ? pick : stockOf(match.opp.ticker)}
            cpu={match.role === "host" ? stockOf(match.opp.ticker) : pick}
            net={match.net} oppName={match.opp.name} onKick={onKick}
            onEnd={(s) => {
              const my = match.role === "host" ? s[0] : s[1], opp = match.role === "host" ? s[1] : s[0];
              void finish(my, opp, match.matchId, "pvp"); leave();
            }}
          />
          <KickFeed kicks={kicks} />
        </main>
      )}

      {screen === "result" && result && (
        <main className="mx-auto max-w-md pt-10 text-center">
          <Panel>
            <p className="animate-pop font-display text-stroke text-5xl text-gold">{result.my > result.opp || result.forfeit ? "VICTORY!" : "DEFEAT"}</p>
            <p className="mt-2 font-display text-3xl">{result.forfeit ? "Opponent left" : `${result.my} – ${result.opp}`}</p>
            <p className="chunky mx-auto mt-4 inline-block rounded-xl bg-primary px-4 py-2 font-display text-2xl text-primary-foreground">+{result.points} RANK PTS</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {mode === "cpu" ? "CPU match · no stake on the line" : result.my > result.opp || result.forfeit ? `You win the ${stake} ${pick.ticker} stake` : `Opponent wins your ${stake} ${pick.ticker} stake`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{kicks.filter((k) => k.status === "sent").length} kicks paid onchain</p>
            <button onClick={() => setScreen("lobby")} className="chunky chunky-press mt-5 w-full rounded-2xl bg-accent py-3 font-display text-stroke text-2xl">PLAY AGAIN</button>
          </Panel>
        </main>
      )}
    </>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <section className="chunky rounded-2xl bg-card p-4">{children}</section>;
}

function WalletBadge({ wallet }: { wallet: Wallet | null }) {
  if (!wallet) return <span className="chunky rounded-xl bg-muted px-3 py-1 text-xs font-bold">Practice mode · no payments</span>;
  if (!wallet.authed) return null;
  const a = wallet.address;
  return (
    <button onClick={wallet.logout} className="chunky chunky-press rounded-xl bg-muted px-3 py-1 text-left text-xs font-bold">
      <div>{wallet.email}</div>
      <div className="text-muted-foreground">{a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "creating wallet…"} · Sign out</div>
    </button>
  );
}

function KickFeed({ kicks }: { kicks: Kick[] }) {
  const summary = useMemo(() => ({
    sent: kicks.filter((k) => k.status === "sent").length,
    failed: kicks.filter((k) => k.status === "failed").length,
    pending: kicks.filter((k) => k.status === "pending").length,
  }), [kicks]);
  if (!kicks.length) return null;
  return (
    <div className="chunky mt-3 rounded-xl bg-card p-3 text-xs font-bold">
      <div className="flex gap-3">
        <span className="text-accent">✓ {summary.sent} paid</span>
        <span className="text-gold">… {summary.pending} sending</span>
        <span className="text-destructive">✕ {summary.failed} failed</span>
      </div>
      {kicks[0]?.hash && (
        <a className="mt-1 block truncate text-muted-foreground underline" target="_blank" rel="noreferrer" href={`https://basescan.org/tx/${kicks[0].hash}`}>
          Last kick: {kicks[0].hash}
        </a>
      )}
      {summary.failed > 0 && <p className="mt-1 text-muted-foreground">Failed kicks usually mean the wallet needs ETH on Base for fees.</p>}
    </div>
  );
}
