import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

// The audit-remediated contract on studionet (deployed 2026-08-17,
// tx 0x282d4af2310a682dee282fe80e5b8d5a1ba0a73679a31fa76bc9e2f66925b1fe).
// Baked in as the default so the live site points at the FIXED contract
// even before the Vercel env var is set. Setting NEXT_PUBLIC_CONTRACT_ADDRESS
// in Vercel still overrides this if you ever redeploy to a new address.
const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  "0x3C318Cb7cC02E3d5D5abB08CeDA8b58Ba3f05b4b";

// Plain client pattern, confirmed by the build guide -- no RPC
// endpoint override. A previous project burned a full debugging
// cycle chasing a phantom bug caused by an unproven endpoint
// override; the plain version below is the one actually proven
// to work.
export function makeClient(account: any) {
  return createClient({ chain: studionet, account });
}

const MAX_ATTEMPTS = 3;

function isBusyError(err: any): boolean {
  const msg = err?.message || err?.cause?.message || "";
  const code = err?.cause?.code ?? err?.code;
  return msg.includes("Server busy") || code === -32006;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (isBusyError(err) && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Decodes the real error hiding inside genlayer-js/viem's generic
// wrapper message ("Missing or invalid parameters..."). The actual
// gl.vm.UserError string from the contract is usually base64-coded
// inside err.cause.data.receipt.result.
export function decodeContractError(err: any): string {
  try {
    const receiptResult = err?.cause?.data?.receipt?.result;
    if (receiptResult) {
      return typeof window !== "undefined"
        ? atob(receiptResult)
        : Buffer.from(receiptResult, "base64").toString();
    }
  } catch {
    // fall through
  }
  return err?.shortMessage || err?.message || "Unknown contract error";
}

// Reads need the same retry treatment as writes -- the shared
// studionet RPC returns a real, transient "Server busy" error
// under load, and it hits reads exactly as often as writes.
export async function readContract(
  client: any,
  method: string,
  args: any[] = []
): Promise<any> {
  const raw = await withRetry(() =>
    client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: method,
      args,
    })
  );
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

// value, if provided, MUST be a raw-unit bigint that gets
// .toString()'d right here -- this is the one place unit
// conversion touches the wire format. Never pass a bigint
// directly into JSON.stringify elsewhere; it fails to serialize
// silently, before the request even leaves the browser.
export async function writeContract(
  client: any,
  method: string,
  args: any[] = [],
  valueRaw?: bigint
): Promise<string> {
  const params: any = {
    address: CONTRACT_ADDRESS,
    functionName: method,
    args,
  };
  // Only attach `value` when it's actually nonzero. Sending an
  // explicit "0" was confirmed to trip GenLayer's RPC parameter
  // validation ("Invalid parameters were provided to the RPC
  // method") on a payable call with no real fee configured yet --
  // omitting it entirely defaults to zero safely on the contract
  // side, since the contract's own checks treat missing and zero
  // value the same way.
  if (valueRaw !== undefined && valueRaw > 0n) {
    params.value = valueRaw.toString();
  }

  try {
    // Deliberately NOT using simulateWriteContract here, even
    // though several of our methods are payable and return an ID.
    // The build guide confirmed simulateWriteContract does not
    // reliably honor `value` -- it can make a payable method's own
    // zero-value check fire incorrectly. Any ID a method "returns"
    // (a new claim_id, a new challenge_id) must be looked up
    // afterward with a plain view call instead.
    const txHash: string = await withRetry(() => client.writeContract(params));
    return txHash;
  } catch (err) {
    throw new Error(decodeContractError(err));
  }
}

// After a write that increments a counter (register_claim,
// start_challenge), we don't actually know whether writeContract's
// promise resolved at submission or at finalization -- that detail
// isn't confirmed anywhere in our source material. Rather than
// assume either way, poll the counter itself until it visibly moves
// past the value it had before the write. This is the same
// "derive the ID from the counter" pattern the guide confirmed,
// made safe against either SDK behavior.
export async function pollForCounterIncrease(
  client: any,
  getterName: string,
  previousValue: number,
  maxAttempts = 8,
  delayMs = 2500
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const current: number = await readContract(client, getterName, []);
    if (current > previousValue) return current;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Timed out waiting for ${getterName} to update -- the transaction may still be finalizing. Check the explorer.`
  );
}

// --- Unit conversion boundary -----------------------------------
// GEN uses 18 decimals, same convention as wei. This is the ONLY
// place in the app that should do this math -- contract logic and
// UI state elsewhere should stay in whichever unit they already are.

export function toRawGen(humanAmount: string): bigint {
  const [whole, frac = ""] = humanAmount.trim().split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  const wholeBig = BigInt(whole || "0");
  const fracBig = BigInt(fracPadded || "0");
  return wholeBig * 10n ** 18n + fracBig;
}

export function fromRawGen(raw: number | string): string {
  const big = BigInt(Math.trunc(Number(raw)));
  const whole = big / 10n ** 18n;
  const frac = big % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}