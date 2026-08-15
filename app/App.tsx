"use client";

import { useEffect, useState, useCallback } from "react";
import { loadOrCreateAccount } from "@/lib/account";
import { makeClient } from "@/lib/contract";
import LandingScreen from "@/components/LandingScreen";
import Dashboard from "@/components/Dashboard";
import RegisterClaimForm from "@/components/RegisterClaimForm";
import ClaimDetail from "@/components/ClaimDetail";
import Beacon from "@/components/Beacon";
import Logo from "@/components/Logo";
import WalletMenu from "@/components/WalletMenu";

type Screen =
  | { name: "landing" }
  | { name: "dashboard" }
  | { name: "register" }
  | { name: "claim"; claimId: string };

export default function App() {
  const [account, setAccount] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [screen, setScreen] = useState<Screen>({ name: "landing" });

  // Account + client bootstrap happens ONLY inside useEffect --
  // never at module scope or during render. localStorage and the
  // genlayer-js client both require the browser environment, which
  // does not exist during Next.js App Router's server render pass.
  useEffect(() => {
    const acc = loadOrCreateAccount();
    setAccount(acc);
    setClient(makeClient(acc));
  }, []);

  const goDashboard = useCallback(() => setScreen({ name: "dashboard" }), []);
  const goRegister = useCallback(() => setScreen({ name: "register" }), []);
  const goClaim = useCallback(
    (claimId: string) => setScreen({ name: "claim", claimId }),
    []
  );

  // Account not ready yet (first paint before useEffect runs) --
  // show a quiet loading state rather than flashing "landing" then
  // immediately swapping content, which reads as broken.
  if (!account || !client) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-inkMuted">
          <Beacon size={14} />
          <span className="font-mono text-sm">preparing your watcher identity</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-horizon px-6 py-4 backdrop-blur-sm bg-abyss/80 sticky top-0 z-10 flex items-center justify-between">
        <button
          className="flex items-center gap-2.5 font-display text-xl tracking-wide uppercase"
          onClick={goDashboard}
        >
          <Logo size={26} />
          <span>Watchtower</span>
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={goRegister}
            className="text-sm px-3 py-1.5 rounded-md border border-line hover:border-beacon transition-colors"
          >
            Register a claim
          </button>
          <WalletMenu account={account} />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {screen.name === "landing" && (
          <LandingScreen account={account} onContinue={goDashboard} />
        )}
        {screen.name === "dashboard" && (
          <Dashboard client={client} onOpenClaim={goClaim} onRegister={goRegister} />
        )}
        {screen.name === "register" && (
          <RegisterClaimForm client={client} onDone={goClaim} onCancel={goDashboard} />
        )}
        {screen.name === "claim" && (
          <ClaimDetail
            client={client}
            account={account}
            claimId={screen.claimId}
            onBack={goDashboard}
          />
        )}
      </main>
    </div>
  );
}