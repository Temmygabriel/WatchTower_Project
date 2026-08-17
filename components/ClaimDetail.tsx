"use client";

import { useEffect, useState, useCallback } from "react";
import { readContract, writeContract, fromRawGen, toRawGen } from "@/lib/contract";
import { Claim, Challenge, isNotFound, isTerminalChallenge } from "@/lib/types";
import { randomSecret, sha256Hex, saveSecret, loadSecret } from "@/lib/nonce";
import Beacon from "./Beacon";

type Stage = "idle" | "submitting" | "confirming" | "error";

function challengeIdFromCount(n: number): string {
  return "CHL" + String(n).padStart(6, "0");
}

function statusColor(status: string): "signal" | "verified" | "alarm" {
  if (status === "violated") return "alarm";
  if (status === "active") return "verified";
  return "signal";
}

// A challenge is "in flight" (resumable, still needs watcher action)
// while it is committed, revealed, or pending.
function isActiveChallenge(status: string): boolean {
  return status === "committed" || status === "revealed" || status === "pending";
}

function fmtDuration(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m <= 0) return `${rem}s`;
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

export default function ClaimDetail({
  client,
  account,
  claimId,
  onBack,
}: {
  client: any;
  account: any;
  claimId: string;
  onBack: () => void;
}) {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [challengeFee, setChallengeFee] = useState<number>(0);

  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
  const [stakeInput, setStakeInput] = useState("0.5");
  const [startStage, setStartStage] = useState<Stage>("idle");
  const [startError, setStartError] = useState<string | null>(null);

  const [revealStage, setRevealStage] = useState<Stage>("idle");
  const [revealError, setRevealError] = useState<string | null>(null);
  const [cancelStage, setCancelStage] = useState<Stage>("idle");

  const [resolveStage, setResolveStage] = useState<Stage>("idle");
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Live clock for the enforced-window countdowns. The contract
  // compares against the transaction timestamp; the browser clock is
  // close enough to render a countdown, and the contract is the real
  // gate -- if the user resolves a second early the contract rejects it.
  const [nowSec, setNowSec] = useState<number>(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const loadClaim = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [c, fee] = await Promise.all([
        readContract(client, "get_claim", [claimId]),
        readContract(client, "get_challenge_fee", []),
      ]);
      if (isNotFound(c)) {
        setLoadError("No claim found with this ID.");
      } else {
        setClaim(c as Claim);
      }
      setChallengeFee(fee);
    } catch (err: any) {
      setLoadError(err?.message || "Could not load this claim");
    } finally {
      setLoading(false);
    }
  }, [client, claimId]);

  // On open, also check whether this watcher already has a challenge
  // in flight on this claim -- so refreshing the page mid-challenge
  // doesn't lose the commit-reveal thread. Only the most recent few
  // are checked; this is a deliberate scope limit, not an oversight.
  const recoverPendingChallenge = useCallback(async () => {
    try {
      const ids: string[] = await readContract(client, "get_watcher_challenges", [
        account.address,
      ]);
      const recent = ids.slice(-5).reverse();
      for (const id of recent) {
        const ch: Challenge = await readContract(client, "get_challenge", [id]);
        if (!isNotFound(ch) && ch.claim_id === claimId && isActiveChallenge(ch.status)) {
          setActiveChallenge(ch);
          return;
        }
      }
    } catch {
      // best-effort only -- not finding a challenge just means the
      // user starts fresh, which is a safe default
    }
  }, [client, account?.address, claimId]);

  useEffect(() => {
    loadClaim();
    if (account?.address) recoverPendingChallenge();
  }, [loadClaim, recoverPendingChallenge, account?.address]);

  // Poll a single challenge until `done(ch)` is true (or we give up).
  const pollChallenge = useCallback(
    async (
      challengeId: string,
      done: (ch: Challenge) => boolean,
      attempts = 90,
      delayMs = 4000
    ): Promise<Challenge | null> => {
      for (let i = 0; i < attempts; i++) {
        const ch: Challenge = await readContract(client, "get_challenge", [challengeId]);
        if (!isNotFound(ch) && done(ch)) return ch;
        await new Promise((r) => setTimeout(r, delayMs));
      }
      return null;
    },
    [client]
  );

  async function handleStartChallenge() {
    if (!claim) return;
    const stakeNum = Number(stakeInput);
    const availableRaw = claim.bond_total - claim.bond_locked - claim.bond_slashed;
    if (!stakeInput || isNaN(stakeNum) || stakeNum <= 0) {
      setStartError("Enter a stake amount greater than 0");
      return;
    }
    const stakeRaw = toRawGen(stakeInput);
    if (stakeRaw > BigInt(availableRaw)) {
      setStartError(`Only ${fromRawGen(availableRaw)} GEN is available to challenge`);
      return;
    }

    setStartStage("submitting");
    setStartError(null);
    try {
      // AUDIT FIX #1: for liveness, generate a high-entropy secret and
      // commit only its sha256. The raw nonce stays in this browser
      // until we reveal it, so the agent cannot pre-publish it.
      let commitment = "";
      if (claim.claim_type === "liveness") {
        const secret = randomSecret();
        commitment = await sha256Hex(secret);
        saveSecret(commitment, secret); // persist BEFORE the tx (survives refresh)
      }

      const countBefore: number = await readContract(client, "get_challenge_counter", []);
      await writeContract(
        client,
        "start_challenge",
        [claimId, stakeRaw.toString(), commitment],
        BigInt(challengeFee)
      );
      setStartStage("confirming");

      // Poll until the challenge counter moves, then read the new
      // challenge. We don't know if writeContract resolved at
      // submit-time or finalize-time, so verify directly.
      let newCount = countBefore;
      for (let i = 0; i < 8; i++) {
        newCount = await readContract(client, "get_challenge_counter", []);
        if (newCount > countBefore) break;
        await new Promise((r) => setTimeout(r, 2500));
      }
      const newId = challengeIdFromCount(newCount);
      const ch: Challenge = await readContract(client, "get_challenge", [newId]);
      setActiveChallenge(ch);
      setStartStage("idle");
      await loadClaim();
    } catch (err: any) {
      setStartError(err?.message || "Could not start the challenge");
      setStartStage("error");
    }
  }

  // AUDIT FIX #1/#2: reveal the secret nonce. The contract checks it
  // against the commitment, publishes it, and starts the fair response
  // window that must elapse before resolution is allowed.
  async function handleReveal() {
    if (!activeChallenge) return;
    const secret = loadSecret(activeChallenge.commitment);
    if (!secret) {
      setRevealError(
        "The secret for this challenge isn't in this browser. Reveal from the same browser/device you opened it on."
      );
      return;
    }
    setRevealStage("submitting");
    setRevealError(null);
    try {
      await writeContract(client, "reveal_nonce", [activeChallenge.challenge_id, secret]);
      setRevealStage("confirming");
      const revealed = await pollChallenge(
        activeChallenge.challenge_id,
        (ch) => ch.status !== "committed",
        20,
        3000
      );
      if (revealed) {
        setActiveChallenge(revealed);
        setRevealStage("idle");
      } else {
        setRevealError("Still confirming the reveal on-chain. Give it a moment and refresh.");
        setRevealStage("error");
      }
    } catch (err: any) {
      setRevealError(err?.message || "Could not reveal the nonce");
      setRevealStage("error");
    }
  }

  // Anti-grief: release the agent's bond if the reveal window lapsed
  // without a reveal. No slash happens here.
  async function handleCancel() {
    if (!activeChallenge) return;
    setCancelStage("submitting");
    try {
      await writeContract(client, "cancel_challenge", [activeChallenge.challenge_id]);
      setCancelStage("confirming");
      const cancelled = await pollChallenge(
        activeChallenge.challenge_id,
        (ch) => isTerminalChallenge(ch.status),
        20,
        3000
      );
      if (cancelled) {
        setActiveChallenge(cancelled);
        await loadClaim();
      }
      setCancelStage("idle");
    } catch (err: any) {
      setRevealError(err?.message || "Could not cancel the challenge");
      setCancelStage("error");
    }
  }

  async function handleResolve() {
    if (!activeChallenge || !claim) return;
    const method =
      claim.claim_type === "liveness"
        ? "resolve_liveness_challenge"
        : "resolve_behavior_challenge";

    setResolveStage("submitting");
    setResolveError(null);
    try {
      await writeContract(client, method, [activeChallenge.challenge_id]);
      setResolveStage("confirming");

      // resolve runs gl.nondet.web.request + eq_principle consensus --
      // measured at 3-5 minutes on studionet. Wait for a TERMINAL
      // status (passed | failed | inconclusive | cancelled), not just
      // "not pending", since the hardened lifecycle has more states.
      const resolved = await pollChallenge(
        activeChallenge.challenge_id,
        (ch) => isTerminalChallenge(ch.status),
        90,
        4000
      );

      if (resolved) {
        setActiveChallenge(resolved);
        setResolveStage("idle");
        await loadClaim();
      } else {
        setResolveError(
          "Still waiting for validator consensus. This can take a few minutes on studionet -- click Resolve again in a moment to check the latest status."
        );
        setResolveStage("error");
      }
    } catch (err: any) {
      setResolveError(err?.message || "Could not resolve the challenge");
      setResolveStage("error");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-inkMuted py-16 justify-center">
        <Beacon size={12} />
        <span className="text-sm">Loading claim</span>
      </div>
    );
  }

  if (loadError || !claim) {
    return (
      <div>
        <button onClick={onBack} className="text-sm text-inkMuted hover:text-ink mb-6">
          &larr; Back
        </button>
        <div className="border border-violation/40 bg-violation/5 rounded-xl p-5 text-sm text-violation">
          {loadError}
        </div>
      </div>
    );
  }

  const availableRaw = claim.bond_total - claim.bond_locked - claim.bond_slashed;
  const isOperator = account?.address?.toLowerCase() === claim.operator?.toLowerCase();

  const busyReveal = revealStage === "submitting" || revealStage === "confirming";
  const busyResolve = resolveStage === "submitting" || resolveStage === "confirming";
  const busyCancel = cancelStage === "submitting" || cancelStage === "confirming";

  // countdowns derived from the on-chain timestamps
  const resolveIn = activeChallenge ? activeChallenge.resolve_not_before - nowSec : 0;
  const revealIn = activeChallenge ? activeChallenge.reveal_deadline - nowSec : 0;
  const windowOpen = resolveIn > 0;
  const revealExpired = revealIn <= 0;

  return (
    <div className="max-w-xl mx-auto">
      <button onClick={onBack} className="text-sm text-inkMuted hover:text-ink mb-6">
        &larr; Back to all claims
      </button>

      <div className="flex items-start gap-3 mb-2">
        <Beacon size={11} color={statusColor(claim.status)} active={claim.status === "active"} />
        <div>
          <h1 className="font-display text-2xl leading-snug">{claim.claim_text}</h1>
          <p className="text-xs text-inkMuted font-mono mt-1">
            {claim.claim_id} &middot; {claim.claim_type} claim &middot; {claim.status}
          </p>
        </div>
      </div>

      <a
        href={claim.proof_url}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-beacon hover:underline break-all inline-block mt-3 mb-6"
      >
        {claim.proof_url}
      </a>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="wt-card p-4">
          <p className="text-xs text-inkMuted mb-1">Total bond</p>
          <p className="font-mono text-sm">{fromRawGen(claim.bond_total)} GEN</p>
        </div>
        <div className="wt-card p-4">
          <p className="text-xs text-inkMuted mb-1">Available</p>
          <p className="font-mono text-sm">{fromRawGen(availableRaw)} GEN</p>
        </div>
        <div className="wt-card p-4">
          <p className="text-xs text-inkMuted mb-1">Slashed</p>
          <p className="font-mono text-sm text-violation">{fromRawGen(claim.bond_slashed)} GEN</p>
        </div>
      </div>

      <p className="text-xs text-inkMuted font-mono mb-8">
        Operator {claim.operator.slice(0, 8)}...{claim.operator.slice(-6)}
        {isOperator && " (you)"}
      </p>

      {claim.status !== "active" && (
        <div className="wt-card p-5 text-sm text-inkMuted">
          {claim.status === "violated"
            ? "This claim failed a challenge. Its bond has been slashed and it's no longer active."
            : "This claim has been withdrawn by its operator."}
        </div>
      )}

      {claim.status === "active" && !activeChallenge && (
        <div className="wt-card p-5">
          <h2 className="font-medium mb-1">Start a challenge</h2>
          <p className="text-sm text-inkMuted mb-4">
            Choose how much of the operator&apos;s bond you&apos;re putting on
            the line for this check. If they fail, you win it. If they pass,
            you only lose the challenge fee.
          </p>

          {claim.claim_type === "liveness" && (
            <p className="text-xs text-inkMuted mb-4">
              This opens with a hidden, committed surprise code. You&apos;ll
              reveal it in a second step, which starts a fair window for the
              agent to publish it before you can resolve.
            </p>
          )}

          <label className="block text-xs text-inkMuted mb-1">Stake (GEN)</label>
          <input
            type="text"
            value={stakeInput}
            onChange={(e) => setStakeInput(e.target.value)}
            disabled={startStage === "submitting" || startStage === "confirming"}
            className="w-full wt-input rounded-lg px-3 py-2 text-sm font-mono outline-none disabled:opacity-50 mb-3"
          />

          <p className="text-xs text-inkMuted mb-4">
            Challenge fee: {fromRawGen(challengeFee)} GEN, paid whether or not
            you catch anything.
          </p>

          {startError && <p className="text-xs text-violation mb-3">{startError}</p>}

          {(startStage === "submitting" || startStage === "confirming") && (
            <div className="flex items-center gap-2 text-sm text-inkMuted mb-3">
              <Beacon size={10} />
              {startStage === "submitting" ? "Submitting" : "Waiting for consensus"}
            </div>
          )}

          <button
            onClick={handleStartChallenge}
            disabled={startStage === "submitting" || startStage === "confirming"}
            className="w-full wt-btn-primary py-2.5 rounded-lg font-medium disabled:opacity-50"
          >
            Trigger surprise check
          </button>
        </div>
      )}

      {/* STEP: liveness challenge opened, awaiting reveal */}
      {activeChallenge && activeChallenge.status === "committed" && (
        <div className="border border-beacon/40 bg-beacon/5 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Beacon size={10} />
            <h2 className="font-medium">Surprise code committed</h2>
          </div>

          {!revealExpired ? (
            <>
              <p className="text-sm text-inkMuted mb-3">
                The surprise code is committed but still hidden, so the agent
                can&apos;t pre-publish it. Reveal it to publish the code and
                start the agent&apos;s fair response window.
              </p>
              <p className="text-xs text-inkMuted mb-4 font-mono">
                Reveal window closes in {fmtDuration(revealIn)}
              </p>

              {!loadSecret(activeChallenge.commitment) && (
                <p className="text-xs text-signal mb-3">
                  Heads up: the secret for this challenge isn&apos;t stored in
                  this browser, so it must be revealed from the device you
                  opened it on.
                </p>
              )}
              {revealError && <p className="text-xs text-violation mb-3">{revealError}</p>}

              {busyReveal && (
                <div className="flex items-center gap-2 text-sm text-inkMuted mb-3">
                  <Beacon size={10} />
                  {revealStage === "submitting" ? "Submitting reveal" : "Confirming reveal"}
                </div>
              )}

              <button
                onClick={handleReveal}
                disabled={busyReveal || !loadSecret(activeChallenge.commitment)}
                className="w-full wt-btn-primary py-2.5 rounded-lg font-medium disabled:opacity-50"
              >
                Reveal surprise code
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-inkMuted mb-4">
                The reveal window expired without a reveal, so this challenge
                can&apos;t proceed. Cancel it to release the agent&apos;s
                reserved bond (no slash occurs).
              </p>
              {revealError && <p className="text-xs text-violation mb-3">{revealError}</p>}
              <button
                onClick={handleCancel}
                disabled={busyCancel}
                className="w-full wt-btn-primary py-2.5 rounded-lg font-medium disabled:opacity-50"
              >
                {busyCancel ? "Cancelling" : "Cancel & release bond"}
              </button>
            </>
          )}
        </div>
      )}

      {/* STEP: revealed (liveness) or pending (behavior) -> enforced window then resolve */}
      {activeChallenge &&
        (activeChallenge.status === "revealed" || activeChallenge.status === "pending") && (
          <div className="border border-beacon/40 bg-beacon/5 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Beacon size={10} />
              <h2 className="font-medium">Challenge in progress</h2>
            </div>

            {activeChallenge.status === "revealed" && (
              <div className="mb-4">
                <p className="text-sm text-inkMuted mb-2">
                  The agent needs to publish this exact code on their proof page:
                </p>
                <div className="font-mono text-sm bg-base border border-line rounded-lg px-3 py-2 inline-block break-all">
                  {activeChallenge.nonce}
                </div>
              </div>
            )}
            {activeChallenge.status === "pending" && (
              <p className="text-sm text-inkMuted mb-4">
                Validators will independently check the live proof page against
                the operator&apos;s promise.
              </p>
            )}

            {/* AUDIT FIX #2: the enforced, on-chain response window. */}
            {windowOpen ? (
              <p className="text-xs text-signal mb-4 font-mono">
                Fair response window: {fmtDuration(resolveIn)} remaining before
                this can be resolved.
              </p>
            ) : (
              <p className="text-xs text-inkMuted mb-4">
                Response window elapsed &mdash; the agent had a fair chance to
                respond. You can resolve now.
              </p>
            )}

            {resolveError && <p className="text-xs text-violation mb-3">{resolveError}</p>}

            {busyResolve && (
              <div className="flex items-center gap-2 text-sm text-inkMuted mb-3">
                <Beacon size={10} />
                {resolveStage === "submitting"
                  ? "Submitting"
                  : "Waiting for validator consensus — this genuinely takes a few minutes, it's not frozen"}
              </div>
            )}

            <button
              onClick={handleResolve}
              disabled={busyResolve || windowOpen}
              className="w-full wt-btn-primary py-2.5 rounded-lg font-medium disabled:opacity-50"
            >
              {windowOpen ? `Resolve unlocks in ${fmtDuration(resolveIn)}` : "Resolve challenge now"}
            </button>
          </div>
        )}

      {/* TERMINAL: passed | failed | inconclusive | cancelled */}
      {activeChallenge && isTerminalChallenge(activeChallenge.status) && (
        <div
          className={`border rounded-xl p-5 ${
            activeChallenge.status === "passed"
              ? "border-verified/40 bg-verified/5"
              : activeChallenge.status === "failed"
              ? "border-violation/40 bg-violation/5"
              : "border-line bg-panel/40"
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <Beacon
              size={10}
              color={
                activeChallenge.status === "passed"
                  ? "verified"
                  : activeChallenge.status === "failed"
                  ? "alarm"
                  : "signal"
              }
              active={false}
            />
            <h2 className="font-medium capitalize">{activeChallenge.status}</h2>
          </div>
          <p className="text-sm text-inkMuted">{activeChallenge.verdict_detail}</p>

          {/* Show the authenticated-evidence binding the slash decision rests on. */}
          {activeChallenge.evidence_status && (
            <p className="text-xs text-inkMuted font-mono mt-3 break-all">
              Evidence: {activeChallenge.evidence_status}
              {activeChallenge.evidence_digest
                ? ` · sha256 ${activeChallenge.evidence_digest.slice(0, 16)}…`
                : ""}
            </p>
          )}
          {activeChallenge.status === "inconclusive" && (
            <p className="text-xs text-inkMuted mt-2">
              No authenticated evidence of a violation was observed, so no bond
              was slashed. You can open a fresh challenge.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
