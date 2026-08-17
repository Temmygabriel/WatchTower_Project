// ============================================================
// Commit-reveal helpers for the audit-hardened surprise audit.
// ============================================================
// The whole point of the fix is that the agent CANNOT predict the
// nonce. So the watcher's browser generates a high-entropy secret,
// commits sha256(secret) on-chain when opening the challenge, and
// only reveals the raw secret later. This file is the browser side
// of that scheme; the contract verifies the commitment in
// reveal_nonce() with the same sha256.
//
// The commitment MUST match Python's
//   hashlib.sha256(secret.encode("utf-8")).hexdigest()
// exactly -- lowercase hex of the sha256 of the secret's UTF-8
// bytes. Web Crypto's SHA-256 over the same bytes produces the
// same digest, so the two sides agree.

// 128 bits of entropy, rendered as "WT-" + 32 lowercase hex chars.
// Enough that the sha256 commitment can't be brute-forced back to
// the secret before the watcher chooses to reveal it.
export function randomSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return "WT-" + hex;
}

// sha256 of the UTF-8 bytes of `input`, as lowercase hex -- matches
// Python hashlib.sha256(input.encode("utf-8")).hexdigest().
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// --- secret persistence -----------------------------------------
// We key the stored secret by its COMMITMENT, not by challenge_id:
// the commitment is generated before the tx (so it survives a
// refresh in the window before we learn the id), and every
// challenge record carries its commitment on-chain, so we can
// always recover the secret for a given challenge later.

const KEY_PREFIX = "watchtower_nonce_secret::";

export function saveSecret(commitment: string, secret: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + commitment, secret);
  } catch {
    // storage may be unavailable (private mode); reveal will then
    // require the secret to be re-supplied manually.
  }
}

export function loadSecret(commitment: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + commitment);
  } catch {
    return null;
  }
}
