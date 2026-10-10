import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PrivyProvider, usePrivy, useWallets, useSendTransaction } from "@privy-io/react-auth";
import { base } from "viem/chains";
import { parseEther } from "viem";
import { PRIVY_APP_ID } from "@/lib/config";
import { STOCKS, GAME_CREATOR, KICK_USD, type Stock } from "@/lib/stocks";
import { Pitch } from "@/components/game/Pitch";

type Kick = { id: number; status: "pending" | "sent" | "failed"; hash?: string };
type Wallet = { ready: boolean; authed: boolean; address?: string; email?: string; login: () => void; logout: () => void; pay: () => Promise<string> };

export default function GameApp() {
  if (!PRIVY_APP_ID) return <Shell wallet={null} />;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "dark", accentColor: "#f5c542" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        defaultChain: base,
        supportedChains: [base],
      }}
    >
      <PrivyBridge />
    </PrivyProvider>
  );
}

function PrivyBridge() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const ethPrice = useEthPrice();
  const wallet: Wallet = {
    ready, authed: authenticated, address: embedded?.address, email: user?.email?.address, login, logout,
    pay: async () => {
      if (!embedded) throw new Error("No wallet");
      const eth = (KICK_USD / ethPrice.current).toFixed(18);
      const { hash } = await sendTransaction(
        { to: GAME_CREATOR, value: parseEther(eth), chainId: base.id },
        { address: embedded.address, uiOptions: { showWalletUIs: false } },
      );
      return hash;
    },
  };
  return <Shell wallet={wallet} />;
}

function useEthPrice() {
  const p = useRef(2500);
  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")
      .then((r) => r.json()).then((j) => { if (j?.ethereum?.usd) p.current = j.ethereum.usd; }).catch(() => {});
  }, []);
  return p;
}

function Shell({ wallet }: { wallet: Wallet | null }) {
  const [screen, setScreen] = useState<"lobby" | "match" | "result">("lobby");
  const [pick, setPick] = useState<Stock>(STOCKS[0]!);
  const [stake, setStake] = useState(1);
  const [cpu, setCpu] = useState<Stock>(STOCKS[1]!);
  const [kicks, setKicks] = useState<Kick[]>([]);
  const [final, setFinal] = useState<[number, number]>([0, 0]);
  const kid = useRef(0);

  const onKick = useCallback(() => {
    if (!wallet?.authed) return;
    const id = ++kid.current;
    setKicks((k) => [{ id, status: "pending" as const }, ...k].slice(0, 30));
    wallet.pay()
      .then((hash) => setKicks((k) => k.map((x) => (x.id === id ? { ...x, status: "sent", hash } : x))))
      .catch(() => setKicks((k) => k.map((x) => (x.id === id ? { ...x, status: "failed" } : x))));
  }, [wallet]);

  const start = () => {
    const others = STOCKS.filter((s) => s.ticker !== pick.ticker);
    setCpu(others[Math.floor(Math.random() * others.length)]!);
    setKicks([]);
    setScreen("match");
  };

  return (
    <div className="min-h-dvh px-3 pb-6 pt-3">
      <header className="mx-auto mb-3 flex max-w-xl items-center justify-between gap-2">
        <h1 className="font-display text-stroke text-2xl leading-none text-gold">STOCK<span className="text-foreground">BALL</span></h1>
        <WalletBadge wallet={wallet} />
      </header>

      {screen === "lobby" && (
        <main className="mx-auto max-w-xl space-y-4">
          <Panel>
            <h2 className="font-display text-stroke text-xl">1. Pick your stock ball</h2>
            <p className="text-sm text-muted-foreground">Coinbase Tokenized Stocks on Base</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {STOCKS.map((s) => (
                <button key={s.ticker} onClick={() => setPick(s)}
                  className={`chunky chunky-press flex flex-col items-center rounded-xl p-2 ${pick.ticker === s.ticker ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                  <span className="chunky grid size-10 place-items-center rounded-full bg-foreground text-[10px] font-black text-outline" style={{ boxShadow: `inset 0 0 0 4px ${s.color}` }}>{s.ticker}</span>
                  <span className="mt-1 text-[11px] font-bold">${s.price.toFixed(0)}</span>
                </button>
              ))}
            </div>
          </Panel>
          <Panel>
            <h2 className="font-display text-stroke text-xl">2. Lock your stake</h2>
            <div className="mt-2 flex items-center gap-3">
              {[0.5, 1, 2, 5].map((n) => (
                <button key={n} onClick={() => setStake(n)}
                  className={`chunky chunky-press flex-1 rounded-xl py-2 font-display text-lg ${stake === n ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{n}</button>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {stake} {pick.ticker} ≈ ${(stake * pick.price).toFixed(2)} · Practice lock (no funds held yet)
            </p>
          </Panel>
          <Panel>
            <h2 className="font-display text-stroke text-xl">3. Kick off vs CPU</h2>
            <p className="text-sm text-muted-foreground">
              Every kick sends ${KICK_USD} in ETH on Base to the game creator. Keep a little ETH in your wallet for network fees.
            </p>
            {wallet && !wallet.authed ? (
              <button onClick={wallet.login} disabled={!wallet.ready}
                className="chunky chunky-press mt-3 w-full rounded-2xl bg-team-blue py-3 font-display text-stroke text-2xl">SIGN IN WITH EMAIL</button>
            ) : (
              <button onClick={start} className="chunky chunky-press mt-3 w-full rounded-2xl bg-accent py-3 font-display text-stroke text-2xl text-foreground">
                LOCK IN & PLAY
              </button>
            )}
            {!wallet && <p className="mt-2 text-xs text-muted-foreground">Sign-in is not set up yet. Practice mode, no payments.</p>}
          </Panel>
        </main>
      )}

      {screen === "match" && (
        <main className="mx-auto max-w-xl">
          <Pitch player={pick} cpu={cpu} onKick={onKick} onEnd={(s) => { setFinal(s); setScreen("result"); }} />
          <KickFeed kicks={kicks} />
        </main>
      )}

      {screen === "result" && (
        <main className="mx-auto max-w-md pt-10 text-center">
          <Panel>
            <p className="animate-pop font-display text-stroke text-5xl text-gold">{final[0] > final[1] ? "VICTORY!" : "DEFEAT"}</p>
            <p className="mt-2 font-display text-3xl">{final[0]} – {final[1]}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {final[0] > final[1] ? `You win ${stake} ${pick.ticker} back + the CPU's ${cpu.ticker} stake` : `CPU takes your ${stake} ${pick.ticker} stake`} (practice)
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{kicks.filter((k) => k.status === "sent").length} kicks paid onchain</p>
            <button onClick={() => setScreen("lobby")} className="chunky chunky-press mt-5 w-full rounded-2xl bg-primary py-3 font-display text-2xl text-primary-foreground">PLAY AGAIN</button>
          </Panel>
        </main>
      )}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <section className="chunky rounded-2xl bg-card p-4">{children}</section>;
}

function WalletBadge({ wallet }: { wallet: Wallet | null }) {
  if (!wallet) return <span className="chunky rounded-xl bg-muted px-3 py-1 text-xs font-bold">Practice mode</span>;
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
