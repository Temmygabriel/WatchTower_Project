"use client";

import { useState } from "react";
import { writeContract, readContract, pollForCounterIncrease, toRawGen } from "@/lib/contract";
import { ClaimType } from "@/lib/types";
import Beacon from "./Beacon";

type Stage = "idle" | "submitting" | "confirming" | "done" | "error";

function claimId(n: number): string {
  return "CLM" + String(n).padStart(6, "0");
}

export default function RegisterClaimForm({
  client,
  onDone,
  onCancel,
}: {
  client: any;
  onDone: (claimId: string) => void;
  onCancel: () => void;
}) {
  const [claimText, setClaimText] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [claimType, setClaimType] = useState<ClaimType>("liveness");
  const [bond, setBond] = useState("1.0");

  const [stage, setStage] = useState<Stage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!claimText.trim()) errs.claimText = "Describe what you're promising";
    if (!proofUrl.trim().startsWith("http")) {
      errs.proofUrl = "Enter a live http(s) URL validators can fetch";
    }
    const bondNum = Number(bond);
    if (!bond || isNaN(bondNum) || bondNum <= 0) {
      errs.bond = "Enter a bond amount greater than 0";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setStage("submitting");
    setErrorMsg(null);
    try {
      const countBefore: number = await readContract(client, "get_claim_counter", []);
      const hash = await writeContract(
        client,
        "register_claim",
        [claimText.trim(), proofUrl.trim(), claimType],
        toRawGen(bond)
      );
      setTxHash(hash);
      setStage("confirming");

      // register_claim doesn't hand back the new claim_id directly --
      // per the build guide, payable methods aren't safely simulated
      // for return values. Poll the counter until it actually moves,
      // then derive the ID -- same pattern the reference projects
      // used for create_community, made safe against either
      // submit-time or finalize-time promise resolution.
      const count = await pollForCounterIncrease(client, "get_claim_counter", countBefore);
      const newId = claimId(count);
      setStage("done");
      onDone(newId);
    } catch (err: any) {
      setErrorMsg(err?.message || "Something went wrong submitting this claim");
      setStage("error");
    }
  }

  const busy = stage === "submitting" || stage === "confirming";

  return (
    <div className="max-w-lg mx-auto">
      <button onClick={onCancel} className="text-sm text-inkMuted hover:text-ink mb-6">
        &larr; Back
      </button>
      <h1 className="font-display text-2xl mb-2">Register a claim</h1>
      <p className="text-sm text-inkMuted mb-8">
        Post what you&apos;re promising, where it can be checked live, and lock
        a bond behind it. Anyone can challenge it later.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">What are you promising?</label>
          <textarea
            value={claimText}
            onChange={(e) => setClaimText(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="e.g. My trading bot only executes trades on blue-chip tokens"
            className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm focus:border-beacon outline-none disabled:opacity-50"
          />
          {fieldErrors.claimText && (
            <p className="text-xs text-violation mt-1">{fieldErrors.claimText}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Live proof URL</label>
          <input
            type="text"
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
            disabled={busy}
            placeholder="https://raw.githubusercontent.com/you/repo/main/status.txt"
            className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm font-mono focus:border-beacon outline-none disabled:opacity-50"
          />
          <p className="text-xs text-inkMuted mt-1">
            Plain text or JSON pages work best. JavaScript-rendered pages
            can&apos;t be checked by validators.
          </p>
          {fieldErrors.proofUrl && (
            <p className="text-xs text-violation mt-1">{fieldErrors.proofUrl}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Claim type</label>
          <div className="grid grid-cols-2 gap-3">
            {(["liveness", "behavior"] as ClaimType[]).map((t) => (
              <button
                type="button"
                key={t}
                disabled={busy}
                onClick={() => setClaimType(t)}
                className={`text-left p-3 rounded-lg border transition-colors disabled:opacity-50 ${
                  claimType === t ? "border-beacon bg-beacon/10" : "border-line"
                }`}
              >
                <p className="text-sm font-medium capitalize">{t}</p>
                <p className="text-xs text-inkMuted mt-1">
                  {t === "liveness"
                    ? "A code must appear on the page"
                    : "Live data must match your promise"}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Bond (GEN)</label>
          <input
            type="text"
            value={bond}
            onChange={(e) => setBond(e.target.value)}
            disabled={busy}
            className="w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm font-mono focus:border-beacon outline-none disabled:opacity-50"
          />
          <p className="text-xs text-inkMuted mt-1">
            This is what a watcher can win if they catch you failing a
            challenge.
          </p>
          {fieldErrors.bond && (
            <p className="text-xs text-violation mt-1">{fieldErrors.bond}</p>
          )}
        </div>

        {stage === "submitting" && (
          <div className="flex items-center gap-3 text-sm text-inkMuted">
            <Beacon size={10} />
            Submitting your transaction
          </div>
        )}
        {stage === "confirming" && (
          <div className="flex items-center gap-3 text-sm text-inkMuted">
            <Beacon size={10} />
            Waiting for validator consensus
            {txHash && (
              <a
                href={`https://explorer-studio.genlayer.com/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-beacon hover:underline"
              >
                View on explorer
              </a>
            )}
          </div>
        )}
        {stage === "error" && (
          <div className="border border-violation/40 bg-violation/5 rounded-lg p-3 text-sm text-violation">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-beacon text-base font-medium py-3 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {busy ? "Working..." : "Register claim & lock bond"}
        </button>
      </form>
    </div>
  );
}
