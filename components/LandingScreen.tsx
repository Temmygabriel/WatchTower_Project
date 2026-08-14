import Beacon from "./Beacon";

export default function LandingScreen({
  account,
  onContinue,
}: {
  account: any;
  onContinue: () => void;
}) {
  const address = account?.address || "";

  return (
    <div className="max-w-lg mx-auto text-center py-12">
      <div className="flex justify-center mb-6">
        <Beacon size={16} />
      </div>
      <h1 className="font-display text-3xl mb-3">Watchtower</h1>
      <p className="text-inkMuted leading-relaxed mb-8">
        Anyone can trigger a surprise check on an AI agent&apos;s claim.
        Independent validators watch at the same moment and decide together
        whether it holds up.
      </p>

      <div className="bg-panel border border-line rounded-xl p-5 text-left mb-6">
        <p className="text-xs uppercase tracking-wide text-inkMuted mb-2">
          Your watcher identity
        </p>
        <p className="text-sm text-ink/80 leading-relaxed mb-3">
          This is a wallet created just for Watchtower and stored only in
          this browser. It is not your main wallet, and it won&apos;t follow
          you to another device.
        </p>
        <div className="font-mono text-sm bg-base border border-line rounded-lg px-3 py-2 break-all">
          {address}
        </div>
      </div>

      <a
        href="https://studio.genlayer.com/"
        target="_blank"
        rel="noreferrer"
        className="text-sm text-beacon hover:underline inline-flex items-center gap-1 mb-8"
      >
        Get testnet GEN from the studionet faucet
        <span aria-hidden="true">&rarr;</span>
      </a>

      <div>
        <button
          onClick={onContinue}
          className="bg-beacon text-base font-medium px-6 py-3 rounded-lg hover:opacity-90 transition-opacity"
        >
          Enter the dashboard
        </button>
      </div>
    </div>
  );
}
