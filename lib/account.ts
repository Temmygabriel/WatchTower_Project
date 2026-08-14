import { createAccount } from "genlayer-js";
import { generatePrivateKey } from "viem/accounts";

const STORAGE_KEY = "watchtower_privkey";

// IMPORTANT: only ever call this from inside a useEffect (client
// side), never at module scope or during server render.
// localStorage does not exist on the server -- Next.js App Router
// server-renders components before they reach the browser.
export function loadOrCreateAccount() {
  let key: `0x${string}` | null = null;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && stored.startsWith("0x")) {
      key = stored as `0x${string}`;
    }
  } catch {
    key = null;
  }

  if (!key) {
    key = generatePrivateKey();
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // localStorage unavailable (private browsing, etc.) --
      // the account still works this session, it just won't
      // persist across a reload.
    }
  }

  const account = createAccount(key) as any;

  // THE VIEM TRAP: viem's createAccount() deliberately never
  // exposes .privateKey on the returned object -- it's captured
  // in a closure for signing but omitted from the return value.
  // Without this line, account.privateKey is undefined,
  // localStorage.setItem saves the literal string "undefined",
  // and every reload silently generates a brand new address.
  account.privateKey = key;

  return account;
}

export function clearAccount() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clean up
  }
}

export function getStoredAddress(account: any): string {
  return account?.address ?? "";
}
