"use client";

import { useEffect, useState, useCallback } from "react";
import { readContract, writeContract, fromRawGen, toRawGen } from "@/lib/contract";
import { Claim, Challenge, isNotFound } from "@/lib/types";
import Beacon from "./Beacon";

type Stage = "idle" | "submitting" | "confirming" | "error";

function challengeIdFromCount(n: number): string {
  return "CHL" + String(n).padStart(6, "0");
}

function statusColor(status: string): "beacon" | "verified" | "violation" {
  if (status === "violated") return "violation";
  if (status === "active") return "verified";
  return "beacon";
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

  const [resolveStage, setResolveStage] = useState<Stage>("idle");
  const [resolveError, setResolveError] = useState<string | null>(null);

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

  // On open, also check whether this watcher already has a pending
  // challenge in flight on this claim -- so refreshing the page
  // mid-challenge doesn't lose the nonce. Only the most recent few
  // are checked; this is a deliberate scope limit, not an oversight.
  const recoverPendingChallenge = useCallback(async () => {
    try {
      const ids: string[] = await readContract(client, "get_watcher_challenges", [
        account.address,
      ]);
      const recent = ids.slice(-5).reverse();
      for (const id of recent) {
        const ch: Challenge = await readContract(client, "get_challenge", [id]);
        if (!isNotFound(ch) && ch.claim_id === claimId && ch.status === "pending") {
          setActiveChallenge(ch);
          return;
        }
      }
    } catch {
      // best-effort only -- not finding a pending challenge just
      // means the user starts fresh, which is a safe default
    }
  }, [client, account?.address, claimId]);

  useEffect(() => {
    loadClaim();
    if (account?.address) recoverPendingChallenge();
  }, [loadClaim, recoverPendingChallenge, account?.address]);

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
      const countBefore: number = await readContract(client, "get_challenge_counter", []);
      await writeContract(
        client,
        "start_challenge",
        [claimId, stakeRaw.toString()],
        BigInt(challengeFee)
      );
      setStartStage("confirming");

      // Poll until the challenge counter moves, same reasoning as
      // register_claim -- we don't know if writeContract resolved
      // at submit-time or finalize-time, so verify directly.
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

      let resolved: Challenge | null = null;
      for (let i = 0; i < 8; i++) {
        const ch: Challenge = await readContract(client, "get_challenge", [
          activeChallenge.challenge_id,
        ]);
        if (ch.status !== "pending") {
          resolved = ch;
          break;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (resolved) {
        setActiveChallenge(resolved);
      }
      setResolveStage("idle");
      await loadClaim();
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
        <div className="bg-panel border border-line rounded-lg p-4">
          <p className="text-xs text-inkMuted mb-1">Total bond</p>
          <p className="font-mono text-sm">{fromRawGen(claim.bond_total)} GEN</p>
        </div>
        <div className="bg-panel border border-line rounded-lg p-4">
          <p className="text-xs text-inkMuted mb-1">Available</p>
          <p className="font-mono text-sm">{fromRawGen(availableRaw)} GEN</p>
        </div>
        <div className="bg-panel border border-line rounded-lg p-4">
          <p className="text-xs text-inkMuted mb-1">Slashed</p>
          <p className="font-mono text-sm text-violation">{fromRawGen(claim.bond_slashed)} GEN</p>
        </div>
      </div>

      <p className="text-xs text-inkMuted font-mono mb-8">
        Operator {claim.operator.slice(0, 8)}...{claim.operator.slice(-6)}
        {isOperator && " (you)"}
      </p>

      {claim.status !== "active" && (
        <div className="border border-line rounded-xl p-5 text-sm text-inkMuted">
          {claim.status === "violated"
            ? "This claim failed a challenge. Its bond has been slashed and it's no longer active."
            : "This claim has been withdrawn by its operator."}
        </div>
      )}

      {claim.status === "active" && !activeChallenge && (
        <div className="border border-line rounded-xl p-5">
          <h2 className="font-medium mb-1">Start a challenge</h2>
          <p className="text-sm text-inkMuted mb-4">
            Choose how much of the operator&apos;s bond you&apos;re putting on
            the line for this check. If they fail, you win it. If they pass,
            you only lose the challenge fee.
          </p>

          <label className="block text-xs text-inkMuted mb-1">Stake (GEN)</label>
          <input
            type="text"
            value={stakeInput}
            onChange={(e) => setStakeInput(e.target.value)}
            disabled={startStage === "submitting" || startStage === "confirming"}
            className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm font-mono focus:border-beacon outline-none disabled:opacity-50 mb-3"
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
            className="w-full bg-beacon text-base font-medium py-2.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Trigger surprise check
          </button>
        </div>
      )}

      {activeChallenge && activeChallenge.status === "pending" && (
        <div className="border border-beacon/40 bg-beacon/5 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Beacon size={10} />
            <h2 className="font-medium">Challenge in progress</h2>
          </div>

          {claim.claim_type === "liveness" && (
            <div className="mb-4">
              <p className="text-sm text-inkMuted mb-2">
                The agent needs to publish this exact code on their proof page:
              </p>
              <div className="font-mono text-sm bg-base border border-line rounded-lg px-3 py-2 inline-block">
                {activeChallenge.nonce}
              </div>
            </div>
          )}
          {claim.claim_type === "behavior" && (
            <p className="text-sm text-inkMuted mb-4">
              Validators will independently check the live proof page against
              the operator&apos;s promise.
            </p>
          )}

          <p className="text-xs text-inkMuted mb-4">
            There&apos;s no enforced deadline &mdash; you can resolve any time.
            Waiting a few minutes gives the agent a fair chance to respond
            before you check.
          </p>

          {resolveError && <p className="text-xs text-violation mb-3">{resolveError}</p>}

          {(resolveStage === "submitting" || resolveStage === "confirming") && (
            <div className="flex items-center gap-2 text-sm text-inkMuted mb-3">
              <Beacon size={10} />
              {resolveStage === "submitting" ? "Submitting" : "Waiting for consensus"}
            </div>
          )}

          <button
            onClick={handleResolve}
            disabled={resolveStage === "submitting" || resolveStage === "confirming"}
            className="w-full bg-beacon text-base font-medium py-2.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Resolve challenge now
          </button>
        </div>
      )}

      {activeChallenge && activeChallenge.status !== "pending" && (
        <div
          className={`border rounded-xl p-5 ${
            activeChallenge.status === "passed"
              ? "border-verified/40 bg-verified/5"
              : "border-violation/40 bg-violation/5"
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <Beacon
              size={10}
              color={activeChallenge.status === "passed" ? "verified" : "violation"}
              active={false}
            />
            <h2 className="font-medium capitalize">{activeChallenge.status}</h2>
          </div>
          <p className="text-sm text-inkMuted">{activeChallenge.verdict_detail}</p>
        </div>
      )}
    </div>
  );
}
