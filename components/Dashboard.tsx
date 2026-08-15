"use client";

import { useEffect, useState } from "react";
import { readContract, fromRawGen } from "@/lib/contract";
import { Claim, isNotFound } from "@/lib/types";
import Beacon from "./Beacon";

function statusColor(status: string): "signal" | "verified" | "alarm" {
  if (status === "violated") return "alarm";
  if (status === "active") return "verified";
  return "signal";
}

function claimId(n: number): string {
  return "CLM" + String(n).padStart(6, "0");
}

export default function Dashboard({
  client,
  onOpenClaim,
  onRegister,
}: {
  client: any;
  onOpenClaim: (id: string) => void;
  onRegister: () => void;
}) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const count: number = await readContract(client, "get_claim_counter", []);
        const ids = Array.from({ length: count }, (_, i) => claimId(count - i)); // newest first
        const results = await Promise.all(
          ids.map((id) => readContract(client, "get_claim", [id]))
        );
        if (!cancelled) {
          const valid = results.filter((r) => !isNotFound(r)) as Claim[];
          setClaims(valid);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Could not load claims");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl mb-1">All claims</h1>
          <p className="text-sm text-inkMuted">
            Every promise an agent has made, and whether it&apos;s held up.
          </p>
        </div>
        <button
          onClick={onRegister}
          className="text-sm px-4 py-2 rounded-lg wt-btn-primary font-medium whitespace-nowrap"
        >
          Register a claim
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-mist py-16 justify-center">
          <Beacon size={12} />
          <span className="text-sm">Loading claims</span>
        </div>
      )}

      {!loading && error && (
        <div className="border border-alarm/40 bg-alarm/5 rounded-xl p-5 text-sm text-alarm">
          Couldn&apos;t reach the contract: {error}
        </div>
      )}

      {!loading && !error && claims.length === 0 && (
        <div className="border border-dashed border-horizon rounded-xl p-10 text-center">
          <p className="text-mist mb-4">
            No claims yet. Be the first to register one.
          </p>
          <button
            onClick={onRegister}
            className="text-sm px-4 py-2 rounded-lg border border-horizon hover:border-signal transition-colors"
          >
            Register a claim
          </button>
        </div>
      )}

      {!loading && !error && claims.length > 0 && (
        <div className="space-y-3">
          {claims.map((c) => (
            <button
              key={c.claim_id}
              onClick={() => onOpenClaim(c.claim_id)}
              className="w-full text-left wt-card-interactive p-5 flex items-center gap-4"
            >
              <Beacon size={9} color={statusColor(c.status)} active={c.status === "active"} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.claim_text}</p>
                <p className="text-xs text-inkMuted font-mono mt-1">
                  {c.claim_id} &middot; {c.claim_type} &middot; {c.operator.slice(0, 6)}...{c.operator.slice(-4)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-mono">{fromRawGen(c.bond_total)} GEN</p>
                <p className="text-xs text-inkMuted capitalize">{c.status}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}