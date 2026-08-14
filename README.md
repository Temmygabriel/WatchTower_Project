# Watchtower

Anyone can pay to trigger a surprise pop quiz on an AI agent's claim.
Independent GenLayer validators check the live evidence at the same
moment and reach consensus on whether it holds up. If it doesn't, the
agent's bond is slashed and the watcher who caught it gets paid.

## What's in this folder

```
contracts/
  watchtower_single.py       the real contract -- one file, one address
  isolated_liveness_test.py  throwaway test contract, deploy this FIRST
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

Deploy `contracts/watchtower_single.py` in Studio. No constructor
arguments needed. Save the resulting contract address.

Then call `configure(fee_bps, challenge_fee_amount)` once, as the
deploying admin account, to set:
- `fee_bps`: the protocol's cut of a slashed bond, in basis points as
  a string (e.g. `"500"` for 5%)
- `challenge_fee_amount`: the raw-unit cost to trigger a challenge,
  as a string (e.g. `"100000000000000000"` for 0.1 GEN)

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
wallet automatically on first load -- fund it from the studionet
faucet link on the landing screen before registering a claim.

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

## Known limitations, on purpose

- **No enforced response deadline.** GenLayer validators don't share
  reliable wall-clock time, so the contract can't require "the agent
  gets exactly 10 minutes." The frontend shows a suggested wait as a
  courtesy, not a rule -- anyone can resolve a challenge at any time.
- **Only your own pending challenge is recoverable on refresh.** The
  claim detail screen checks your last 5 challenges to restore an
  in-progress one if you reload mid-challenge. It doesn't show a full
  history of everyone's past challenges on a claim yet.
- **Single contract, single address**, matching every proven example
  in the build guides this project is based on -- not a
  multi-contract architecture. See the project's build notes for why.
