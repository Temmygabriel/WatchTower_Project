import Beacon from "./Beacon";

const FEATURES: [string, string][] = [
  ["Live checks", "Validators fetch evidence themselves"],
  ["Real GEN", "Bonds and payouts move on-chain"],
  ["Consensus verdict", "No single party decides"],
  ["Permissionless", "Anyone can trigger a check"],
];

const STEPS: [string, string, string][] = [
  ["📝", "An agent posts a claim", "A promise, a live proof URL, and a GEN bond locked behind it."],
  ["🎲", "Anyone triggers a check", "Pay a small fee to demand proof, right now, unannounced."],
  ["🔍", "Validators check independently", "Each one fetches the live evidence at the same moment."],
  ["⚖️", "Consensus decides", "Only a shared, independent verdict moves the bond."],
  ["💰", "Cheaters pay watchers", "A failed claim slashes the bond straight to whoever caught it."],
];

export default function LandingScreen({
  account,
  onContinue,
}: {
  account: any;
  onContinue: () => void;
}) {
  return (
    <div className="max-w-lg mx-auto py-8">
      <div className="text-center mb-10">
        <div className="flex justify-center mb-6">
          <Beacon size={18} />
        </div>
        <h1 className="font-display text-4xl tracking-wide uppercase mb-3">Watchtower</h1>
        <p className="text-inkMuted leading-relaxed">
          Anyone can trigger a surprise check on an AI agent&apos;s claim.
          Independent validators watch at the same moment and decide
          together whether it holds up.
        </p>

        <div className="flex flex-wrap justify-center gap-2 mt-6">
          {FEATURES.map(([name, desc]) => (
            <div
              key={name}
              className="flex items-center gap-1.5 text-xs wt-card px-3 py-1.5 rounded-full"
            >
              <span className="font-medium text-beacon">{name}</span>
              <span className="text-inkMuted">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="wt-card p-5 mb-8">
        <p className="text-xs uppercase tracking-wide text-inkMuted mb-2">
          About your watcher identity
        </p>
        <p className="text-sm text-ink/80 leading-relaxed">
          Your wallet address is shown in the top right of the app.
          Studionet uses a free test environment -- registering a claim
          or triggering a challenge doesn&apos;t require funding this
          address with real GEN first.
        </p>
      </div>

      <div className="mb-10">
        <p className="text-xs uppercase tracking-wide text-inkMuted mb-4 text-center">
          How it works
        </p>
        <div className="space-y-4">
          {STEPS.map(([emoji, title, desc]) => (
            <div key={title} className="flex gap-3">
              <span className="text-xl shrink-0">{emoji}</span>
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-inkMuted mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center">
        <button
          onClick={onContinue}
          className="wt-btn-primary px-6 py-3 rounded-lg font-medium"
        >
          Enter the dashboard
        </button>
      </div>
    </div>
  );
}