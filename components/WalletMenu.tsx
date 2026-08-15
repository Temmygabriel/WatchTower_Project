"use client";

import { useState } from "react";
import Beacon from "./Beacon";

function truncate(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function WalletMenu({ account }: { account: any }) {
  const [open, setOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  // MetaMask address is DISPLAY ONLY. GenLayer studionet transactions
  // must still be signed by the genlayer-js burner account -- MetaMask
  // itself can't sign for this chain. Showing a MetaMask address next
  // to a burner-signed transaction without saying so would be
  // misleading, so this stays labeled clearly wherever it shows up.
  const [metaMaskAddress, setMetaMaskAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  if (!account?.address) return null;

  const displayAddress = metaMaskAddress || account.address;
  const displayType = metaMaskAddress ? "MetaMask (display only)" : "Watcher identity";

  function toggle() {
    setOpen((o) => !o);
    setShowKey(false);
    setAddrCopied(false);
    setKeyCopied(false);
  }

  function copyAddress() {
    navigator.clipboard.writeText(displayAddress);
    setAddrCopied(true);
    setTimeout(() => setAddrCopied(false), 2000);
  }

  function copyKey() {
    if (!account.privateKey) return;
    navigator.clipboard.writeText(account.privateKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  }

  async function connectMetaMask() {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      alert("MetaMask not detected. Install it and refresh to connect.");
      return;
    }
    setConnecting(true);
    try {
      const accounts: string[] = await (window as any).ethereum.request({
        method: "eth_requestAccounts",
      });
      if (accounts[0]) setMetaMaskAddress(accounts[0]);
    } catch (err: any) {
      if (err?.code !== 4001) {
        alert("Could not connect to MetaMask.");
      }
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border border-line bg-panel hover:border-beacon/50 transition-colors"
      >
        <Beacon size={7} active={false} />
        <span className="text-inkMuted hidden sm:inline">{displayType}</span>
        <span className="font-mono">{truncate(displayAddress)}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[calc(100%+8px)] w-80 bg-panel border border-line rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="p-4">
              <p className="text-xs text-inkMuted mb-1">{displayType}</p>
              <p className="font-mono text-xs break-all mb-3">{displayAddress}</p>
              <button
                onClick={copyAddress}
                className="w-full text-sm py-2 rounded-lg border border-line hover:border-beacon/50 transition-colors"
              >
                {addrCopied ? "Copied!" : "Copy address"}
              </button>
            </div>

            <div className="border-t border-line p-4 bg-beacon/5">
              <p className="text-xs font-medium text-beacon mb-1">
                This is the identity that actually signs
              </p>
              <p className="text-xs text-inkMuted leading-relaxed mb-3">
                Every Watchtower transaction is signed by your browser-stored
                watcher key, not MetaMask -- MetaMask can&apos;t sign for
                GenLayer studionet. If you connected MetaMask above, it&apos;s
                shown for reference only.
              </p>
              {!showKey ? (
                <button
                  onClick={() => setShowKey(true)}
                  className="w-full text-sm py-2 rounded-lg border border-beacon/40 text-beacon hover:bg-beacon/10 transition-colors"
                >
                  Show private key
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="font-mono text-[10px] bg-base border border-line rounded-lg p-2 break-all select-all">
                    {account.privateKey}
                  </div>
                  <button
                    onClick={copyKey}
                    className="w-full text-sm py-2 rounded-lg border border-beacon/40 text-beacon hover:bg-beacon/10 transition-colors"
                  >
                    {keyCopied ? "Copied -- store it safely" : "Copy private key"}
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-line p-4">
              {!metaMaskAddress ? (
                <button
                  onClick={connectMetaMask}
                  disabled={connecting}
                  className="w-full text-sm py-2 rounded-lg border border-line hover:border-beacon/50 transition-colors disabled:opacity-50"
                >
                  {connecting ? "Connecting…" : "Connect MetaMask (display only)"}
                </button>
              ) : (
                <button
                  onClick={() => setMetaMaskAddress(null)}
                  className="w-full text-sm py-2 rounded-lg border border-line hover:border-beacon/50 transition-colors"
                >
                  Hide MetaMask address
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
