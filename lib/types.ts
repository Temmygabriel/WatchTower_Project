// These interfaces mirror the JSON shapes the Watchtower contract
// actually stores and returns. Keep these in lockstep with
// watchtower_single.py -- if you add or rename a field there,
// update it here too. Copy-paste, don't retype, per build guide.

export type ClaimType = "liveness" | "behavior";
export type ClaimStatus = "active" | "violated" | "withdrawn";
export type ChallengeStatus = "pending" | "passed" | "failed";

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
  watcher: string;        // hex address of whoever triggered the challenge
  nonce: string;           // the surprise code, relevant for liveness claims
  stake_amount: number;    // raw 18-decimal integer
  status: ChallengeStatus;
  verdict_detail: string;
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
