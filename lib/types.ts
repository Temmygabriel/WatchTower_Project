// These interfaces mirror the JSON shapes the Watchtower contract
// actually stores and returns. Keep these in lockstep with
// watchtower_single.py -- if you add or rename a field there,
// update it here too. Copy-paste, don't retype, per build guide.

export type ClaimType = "liveness" | "behavior";
export type ClaimStatus = "active" | "violated" | "withdrawn";
// Audit-hardened challenge lifecycle:
//   liveness: committed -> revealed -> (passed|failed|inconclusive) | cancelled
//   behavior: pending   ------------> (passed|failed|inconclusive)
// "inconclusive" = resolved with NO authenticated evidence (e.g. unreachable
// proof URL) -> bond released, nothing slashed. "cancelled" = a liveness
// commit whose reveal window lapsed -> bond released.
export type ChallengeStatus =
  | "committed"
  | "revealed"
  | "pending"
  | "passed"
  | "failed"
  | "inconclusive"
  | "cancelled";

export const TERMINAL_CHALLENGE_STATUSES: ChallengeStatus[] = [
  "passed",
  "failed",
  "inconclusive",
  "cancelled",
];

export function isTerminalChallenge(status: string): boolean {
  return (TERMINAL_CHALLENGE_STATUSES as string[]).includes(status);
}

export interface Claim {
  claim_id: string;
  operator: string;       // hex address, always from gl.message.sender_address
  claim_text: string;
  proof_url: string;
  claim_type: ClaimType;
  bond_total: number;     // raw 18-decimal integer, same convention as wei
  bond_locked: number;
  bond_slashed: number;
  status: ClaimStatus;
  challenge_count: number;
}

export interface Challenge {
  challenge_id: string;
  claim_id: string;
  claim_type: ClaimType;
  watcher: string;        // hex address of whoever triggered the challenge
  commitment: string;      // sha256(secret nonce) for liveness; "" for behavior
  nonce: string;           // the surprise code, revealed only after reveal_nonce
  stake_amount: number;    // raw 18-decimal integer
  status: ChallengeStatus;
  opened_at: number;       // unix seconds (tx time) the challenge was opened
  reveal_deadline: number; // unix seconds; watcher must reveal before this (liveness)
  revealed_at: number;     // unix seconds the nonce was revealed (0 until then)
  resolve_not_before: number; // unix seconds; resolution blocked until this passes
  verdict_detail: string;
  evidence_status: string; // "" | "authenticated" | "unavailable"
  evidence_digest: string; // sha256 of the observation the verdict was bound to
  observed_at: number;     // unix seconds the evidence was recorded
}

export interface Payout {
  payout_id: string;
  claim_id: string;
  watcher: string;
  amount_total: number;
  watcher_share: number;
  protocol_fee: number;
}

// A contract "not found" response looks like { error: "not found" }.
export interface NotFound {
  error: string;
}

export function isNotFound(x: unknown): x is NotFound {
  return !!x && typeof x === "object" && "error" in (x as any);
}
