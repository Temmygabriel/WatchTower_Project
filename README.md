# Watchtower

Anyone can pay to trigger a surprise pop quiz on an AI agent's claim.
Independent GenLayer validators check the live evidence at the same
moment and reach consensus on whether it holds up. If it doesn't, the
agent's bond is slashed and the watcher who caught it gets paid.

## What's in this folder

```
contracts/
  watchtower.py              the real contract -- one file, one address
  isolated_liveness_test.py  throwaway test contract, deploy this FIRST
tests/direct/                fast in-memory security tests (audit remediation)
app/                          Next.js App Router pages
components/                   screens: Landing, Dashboard, Register, ClaimDetail
lib/                          contract client, account handling, types
```

## Deploy order (don't skip steps)

### 1. Prove the fetch pattern works, in isolation

Deploy `contracts/isolated_liveness_test.py` in GenLayer Studio first,
by itself. It has no bonds, no money, no other logic -- it just fetches
a URL you control and checks for a code, so you can confirm consensus
genuinely reaches `Accepted` before trusting anything built on top of
it. Full click-by-click steps are earlier in this conversation if you
need them again.

Only move on once this passes both ways: verdict `true` when the code
is present, `false` when it isn't, and the explorer's real
`Consensus Result` says `Accepted` both times -- not just a green
"Success" badge.

### 2. Deploy the real contract

Deploy `contracts/watchtower.py` in Studio. No constructor
arguments needed. Save the resulting contract address.

Then call `configure(fee_bps, challenge_fee_amount)` once, as the
deploying admin account, to set:
- `fee_bps`: the protocol's cut of a slashed bond, in basis points as
  a string (e.g. `"500"` for 5%)
- `challenge_fee_amount`: the raw-unit cost to trigger a challenge,
  as a string (e.g. `"100000000000000000"` for 0.1 GEN)

Optionally call `configure_windows(response_window_secs,
reveal_window_secs)` (both in seconds, as strings) to tune the enforced
response and reveal windows -- defaults are `"300"` and `"600"`. See
**Security model** below for what these govern. `configure(...)` itself is
unchanged and still takes exactly two arguments.

> **Upgrading from an earlier deployment?** The challenge storage schema
> changed (commit-reveal + evidence fields), so deploy to a **fresh
> address** and repoint `NEXT_PUBLIC_CONTRACT_ADDRESS` -- do not reuse an
> old contract's state.

### 3. Run the frontend locally

```bash
npm install
cp .env.example .env.local
```

Open `.env.local` and paste your contract address from step 2 into
`NEXT_PUBLIC_CONTRACT_ADDRESS`.

```bash
npm run dev
```

Open `http://localhost:3000`. The app will create a browser-local
wallet automatically on first load. Studionet is a free test
environment -- no funding step is needed before registering a claim
or triggering a challenge.

### 4. Push to GitHub

```bash
git init
git add .
git commit -m "Watchtower: initial build"
git branch -M main
git remote add origin https://github.com/YOURNAME/YOURREPO.git
git push -u origin main
```

### 5. Deploy on Vercel

- Import the GitHub repo in Vercel
- Framework preset: Next.js (auto-detected)
- Add an environment variable: `NEXT_PUBLIC_CONTRACT_ADDRESS` set to
  your deployed contract address
- Deploy

## Security model (audit remediation)

An earlier revision failed a security review: the "surprise audit" was
gameable three ways. All three are now closed in `contracts/watchtower.py`,
and each is covered by a direct-mode test in `tests/direct/`
(`pip install genlayer-test && pytest tests/direct/ -v`).

**1. Unpredictable challenges (commit-reveal).** The liveness nonce used to
be `"WT-" + a public sequential id`, so an agent could precompute every
future nonce and pass forever without being watched. Now the watcher commits
`sha256(secret)` when opening a challenge -- `start_challenge(claim_id,
stake_amount, nonce_commitment)` -- and the secret stays hidden until they
call `reveal_nonce(challenge_id, secret)`. The agent cannot publish what it
cannot predict. Behavior challenges have no nonce and pass an empty
commitment.

**2. Enforced fair response window.** Resolution used to be possible in the
same instant a challenge opened, slashing an honest agent before it could
respond. Now resolution is rejected until `resolve_not_before`, a deadline
derived from the deterministic GenVM transaction timestamp
(`datetime.now(timezone.utc)`), which every validator re-executing the tx
agrees on. For liveness the clock starts at reveal; for behavior it starts at
open. If a watcher opens a liveness challenge but never reveals, anyone may
`cancel_challenge` once the reveal window expires -- the agent's reserved bond
is released with no slash (anti-grief). Both windows are admin-tunable via
`configure_windows(response_window_secs, reveal_window_secs)` (defaults 300s
and 600s; production should raise the response window).

**3. Verdicts bound to authenticated evidence.** Slashing used to act on a
single live fetch of the operator's own mutable URL, with nothing recorded
tying the verdict to what was observed. Now a slash is permitted only when
consensus positively authenticated the failure (`evidence_status ==
"authenticated"`) and an evidence digest is recorded on-chain in both the
challenge and the payout. An unreachable or otherwise unauthenticated fetch
resolves `inconclusive` and never slashes. For liveness the digest binds the
specific revealed nonce to a `present`/`absent` observation; for behavior it
is a sha256 of the exact page text the AI judgment was made against.

**Challenge lifecycle**

```
liveness:  committed --reveal--> revealed --window--> passed | failed | inconclusive
                \--(no reveal, reveal window expires)--> cancelled
behavior:  pending --window--> passed | failed | inconclusive

  passed        agent honest, reserved bond released
  failed        agent lied, AUTHENTICATED evidence recorded, bond slashed, watcher paid
  inconclusive  no authenticated evidence (e.g. unreachable) -> bond released, NO slash
  cancelled     liveness commit expired without a reveal      -> bond released, NO slash
```

## Known limitations, on purpose

- **A slash needs a reachable proof at resolution time.** By design, an
  unreachable or empty proof URL resolves `inconclusive` rather than slashing
  (see Security model #3), so an honest agent is never slashed on a dead
  fetch. The flip side: an operator who takes their own proof page down can
  force `inconclusive` instead of a clean `pass`. That trade-off is
  deliberate -- we never slash on unauthenticated evidence.
- **Only your own pending challenge is recoverable on refresh.** The
  claim detail screen checks your last 5 challenges to restore an
  in-progress one if you reload mid-challenge. It doesn't show a full
  history of everyone's past challenges on a claim yet.
- **Single contract, single address**, matching every proven example
  in the build guides this project is based on -- not a
  multi-contract architecture. See the project's build notes for why.