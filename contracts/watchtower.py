# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

# ============================================================
# WATCHTOWER — single contract, one address.
# ============================================================
# PLAIN ENGLISH: everything lives in one file, one deployed
# address, same as every proven GenLayer project in our
# reference docs (CommunityPulse, HTP, NYP, FairPay, and the
# PredictionMarket sample). Three logical "rooms" live inside
# it: claims, challenges, and payouts -- but they all share the
# same contract balance, so money movement between them is
# just Python, not a cross-contract call. That removes the
# single biggest unproven risk in the earlier 3-contract draft.
# ============================================================
#
# SECURITY HARDENING (audit remediation) -- the "surprise audit"
# used to be gameable in three ways. All three are now closed:
#
#   1. PREDICTABLE NONCES. The nonce was "WT-" + a public
#      sequential counter, so an agent could read the next
#      challenge id off-chain and pre-publish every future nonce,
#      passing liveness checks forever without being watched.
#      FIX: commit-reveal. The watcher commits sha256(secret)
#      when opening; the secret nonce is HIDDEN until they reveal
#      it. The agent cannot pre-publish what it cannot predict.
#
#   2. IMMEDIATE RESOLUTION. A challenge could be opened and
#      resolved in the same instant, slashing an honest agent
#      before it had any chance to respond to the surprise.
#      FIX: an ENFORCED, on-chain response window. Resolution is
#      rejected until `resolve_not_before` (a transaction-time
#      deadline) has passed. Time is the deterministic GenVM
#      transaction timestamp, so every validator agrees on it.
#
#   3. UNAUTHENTICATED EVIDENCE. Slashing acted on a single live
#      fetch of the operator's own (mutable) URL, with nothing
#      recorded tying the verdict to what was actually observed.
#      FIX: verdicts are BOUND to authenticated evidence. A slash
#      is only permitted when consensus positively observed the
#      failure (evidence_status == "authenticated") AND an
#      evidence digest is recorded on-chain in the challenge and
#      payout. An unreachable / inconclusive fetch NEVER slashes
#      -- it releases the bond and marks the challenge
#      "inconclusive" instead.
# ============================================================

from genlayer import *
import json
import typing
import hashlib
from datetime import datetime, timezone


class Watchtower(gl.Contract):
    # --- claims ("the promise book") ---
    claims: TreeMap[str, str]
    claim_counter: u256
    operator_claims: TreeMap[str, str]

    # --- challenges ("the pop quiz") ---
    challenges: TreeMap[str, str]
    challenge_counter: u256
    watcher_challenges: TreeMap[str, str]   # watcher_address -> JSON list of challenge_ids

    # --- payouts ("the piggy bank") ---
    payout_log: TreeMap[str, str]
    payout_counter: u256
    protocol_fee_bps: u256
    protocol_fees_collected: u256

    admin_address: str
    challenge_fee: u256

    # --- fair-response-window config (audit fix #2) ---
    # Seconds the agent gets to respond AFTER the surprise nonce is
    # revealed (liveness) or the challenge is opened (behavior),
    # before anyone is allowed to resolve. Seconds the watcher gets
    # to reveal a committed nonce before the challenge can be
    # cancelled and the agent's bond released. Both are admin-tunable
    # via configure_windows(); production should raise the response
    # window (e.g. hours) -- the defaults are demo-friendly but still
    # enforce a real, non-zero delay that kills atomic open+resolve.
    response_window_seconds: u256
    reveal_window_seconds: u256

    def __init__(self):
        self.claim_counter = u256(0)
        self.challenge_counter = u256(0)
        self.payout_counter = u256(0)
        self.admin_address = gl.message.sender_address.as_hex
        self.protocol_fee_bps = u256(500)   # 5% default
        self.protocol_fees_collected = u256(0)
        self.challenge_fee = u256(0)
        self.response_window_seconds = u256(300)   # 5 min default (tunable)
        self.reveal_window_seconds = u256(600)     # 10 min default (tunable)

    # ------------------------------------------------------
    # Sender identity -- always from the signed transaction,
    # never trust an address passed as an argument.
    # ------------------------------------------------------
    def _sender(self) -> str:
        return gl.message.sender_address.as_hex

    # ------------------------------------------------------
    # Deterministic transaction time (Unix seconds). The GenVM
    # pins datetime.now() to the transaction timestamp, so every
    # validator re-executing this tx sees the SAME value -- safe
    # for storage and comparison. Only ever call this from WRITE
    # methods (view-method datetime can be a placeholder).
    # ------------------------------------------------------
    def _now(self) -> int:
        return int(datetime.now(timezone.utc).timestamp())

    @gl.public.write
    def configure(self, fee_bps: str, challenge_fee_amount: str) -> None:
        if self._sender() != self.admin_address:
            raise gl.vm.UserError("Only admin")
        fee = int(fee_bps)
        if fee < 0 or fee > 2000:
            raise gl.vm.UserError("fee_bps out of sane range (max 20%)")
        self.protocol_fee_bps = u256(fee)
        self.challenge_fee = u256(int(challenge_fee_amount))

    # Admin-tunable fair-response-window settings (audit fix #2).
    # Kept separate from configure() so the existing 2-arg deploy
    # step / README stay valid. Both values are in seconds.
    @gl.public.write
    def configure_windows(self, response_window_secs: str, reveal_window_secs: str) -> None:
        if self._sender() != self.admin_address:
            raise gl.vm.UserError("Only admin")
        resp = int(response_window_secs)
        rev = int(reveal_window_secs)
        # A zero response window would re-open the "resolve immediately"
        # hole, so require a real, positive delay.
        if resp <= 0:
            raise gl.vm.UserError("response window must be > 0 seconds")
        if rev <= 0:
            raise gl.vm.UserError("reveal window must be > 0 seconds")
        self.response_window_seconds = u256(resp)
        self.reveal_window_seconds = u256(rev)

    @gl.public.view
    def get_challenge_fee(self) -> int:
        return int(self.challenge_fee)

    @gl.public.view
    def get_response_window(self) -> int:
        return int(self.response_window_seconds)

    @gl.public.view
    def get_reveal_window(self) -> int:
        return int(self.reveal_window_seconds)

    # ========================================================
    # CLAIMS
    # ========================================================

    @gl.public.write.payable
    def register_claim(self, claim_text: str, proof_url: str, claim_type: str) -> str:
        bond = gl.message.value  # raw 18-decimal integer, comes with the tx
        if bond <= 0:
            raise gl.vm.UserError("A bond (GEN deposit) is required to register a claim")
        if claim_type not in ("liveness", "behavior"):
            raise gl.vm.UserError("claim_type must be 'liveness' or 'behavior'")
        if not proof_url.startswith("http"):
            raise gl.vm.UserError("proof_url must be a live http(s) URL")

        claim_id = "CLM" + str(int(self.claim_counter) + 1).zfill(6)
        self.claim_counter = u256(int(self.claim_counter) + 1)
        operator = self._sender()

        record = {
            "claim_id": claim_id,
            "operator": operator,
            "claim_text": claim_text,
            "proof_url": proof_url,
            "claim_type": claim_type,
            "bond_total": bond,
            "bond_locked": 0,
            "bond_slashed": 0,
            "status": "active",   # active | violated | withdrawn
            "challenge_count": 0,
        }
        self.claims[claim_id] = json.dumps(record)

        raw = self.operator_claims.get(operator)
        ids = json.loads(raw) if raw else []
        ids.append(claim_id)
        self.operator_claims[operator] = json.dumps(ids)
        return claim_id

    @gl.public.view
    def get_claim(self, claim_id: str) -> str:
        raw = self.claims.get(claim_id)
        return raw if raw else json.dumps({"error": "not found"})

    @gl.public.view
    def get_operator_claims(self, operator: str) -> str:
        raw = self.operator_claims.get(operator)
        return raw if raw else "[]"

    @gl.public.view
    def get_claim_counter(self) -> int:
        # Lets the frontend enumerate every claim (CLM000001 upward)
        # for a public browse feed, without needing a separate index
        # array. Read-only, touches nothing in the write paths that
        # are already tested.
        return int(self.claim_counter)

    def _load_claim(self, claim_id: str) -> dict:
        raw = self.claims.get(claim_id)
        if raw is None:
            raise gl.vm.UserError("Claim not found")
        return json.loads(raw)

    @gl.public.write
    def withdraw_claim(self, claim_id: str) -> None:
        record = self._load_claim(claim_id)
        if record["operator"] != self._sender():
            raise gl.vm.UserError("Only the claim's operator can withdraw it")
        if record["bond_locked"] > 0:
            raise gl.vm.UserError("Cannot withdraw while a challenge is active")

        remaining = record["bond_total"] - record["bond_slashed"]
        record["status"] = "withdrawn"
        record["bond_total"] = 0
        self.claims[claim_id] = json.dumps(record)

        if remaining > 0:
            target = gl.get_contract_at(Address(record["operator"]))
            target.emit_transfer(value=remaining)

    # ========================================================
    # CHALLENGES
    # ========================================================
    #
    # Lifecycle (audit-hardened):
    #   liveness:  committed --reveal--> revealed --window--> resolve
    #                   |                                        |
    #                   +--(watcher never reveals)--> cancelled  +--> passed / failed / inconclusive
    #   behavior:  pending --window--> resolve --> passed / failed / inconclusive
    #
    #   passed        = agent honest, reserved bond released
    #   failed        = agent lied, AUTHENTICATED evidence recorded, bond slashed
    #   inconclusive  = no authenticated evidence (e.g. unreachable) -> bond released, NO slash
    #   cancelled     = liveness commit expired without a reveal   -> bond released, NO slash
    # ========================================================

    def _is_hex64(self, s: str) -> bool:
        if len(s) != 64:
            return False
        return all(c in "0123456789abcdef" for c in s)

    @gl.public.write.payable
    def start_challenge(self, claim_id: str, stake_amount: str, nonce_commitment: str) -> str:
        # AUDIT FIX #1 (predictable nonces): for liveness claims the
        # watcher must supply a commitment = sha256(secret_nonce) hex.
        # The secret nonce stays hidden until reveal_nonce(), so the
        # agent cannot pre-publish it. Behavior claims have no nonce to
        # post, so they pass an empty commitment.
        paid = gl.message.value
        if paid < int(self.challenge_fee):
            raise gl.vm.UserError("Insufficient challenge fee")
        stake = int(stake_amount)   # passed as str per guide's int-param rule
        if stake <= 0:
            raise gl.vm.UserError("stake_amount must be positive")

        record = self._load_claim(claim_id)
        if record["status"] != "active":
            raise gl.vm.UserError("Claim is not active")

        claim_type = record["claim_type"]
        commitment = (nonce_commitment or "").strip().lower()
        if claim_type == "liveness":
            if not self._is_hex64(commitment):
                raise gl.vm.UserError(
                    "liveness challenge needs a nonce_commitment = sha256(secret) as 64 hex chars"
                )
        else:
            # behavior: no committed nonce; ignore whatever was passed.
            commitment = ""

        # The fee the watcher pays goes straight to protocol_fees_collected
        # -- without this line it was real GEN sitting in the contract's
        # balance with no accounting entry pointing at it, meaning
        # withdraw_protocol_fees could never actually reach it.
        self.protocol_fees_collected = u256(int(self.protocol_fees_collected) + paid)

        available = record["bond_total"] - record["bond_locked"] - record["bond_slashed"]
        if stake > available:
            raise gl.vm.UserError("Insufficient unlocked bond for this challenge")

        # RESERVE the stake right now -- lesson from CommunityPulse
        # bug #1: escrow must be reserved the instant a challenge
        # opens, not just noted, or two concurrent challenges could
        # both claim the same funds.
        record["bond_locked"] += stake
        record["challenge_count"] += 1
        self.claims[claim_id] = json.dumps(record)

        challenge_id = "CHL" + str(int(self.challenge_counter) + 1).zfill(6)
        self.challenge_counter = u256(int(self.challenge_counter) + 1)

        now = self._now()
        if claim_type == "liveness":
            status = "committed"
            reveal_deadline = now + int(self.reveal_window_seconds)
            resolve_not_before = 0   # set on reveal, once the clock actually starts
        else:
            status = "pending"
            reveal_deadline = 0
            # AUDIT FIX #2: behavior has no reveal step, so the fair
            # window starts at open.
            resolve_not_before = now + int(self.response_window_seconds)

        ch = {
            "challenge_id": challenge_id,
            "claim_id": claim_id,
            "claim_type": claim_type,
            "watcher": self._sender(),
            "commitment": commitment,   # sha256(secret) for liveness, "" for behavior
            "nonce": "",                # revealed later for liveness; empty for behavior
            "stake_amount": stake,
            "status": status,           # committed|revealed|pending|passed|failed|inconclusive|cancelled
            "opened_at": now,
            "reveal_deadline": reveal_deadline,
            "revealed_at": 0,
            "resolve_not_before": resolve_not_before,
            "verdict_detail": "",
            # authenticated-evidence record (audit fix #3), filled at resolution
            "evidence_status": "",      # ""|authenticated|unavailable
            "evidence_digest": "",      # sha256 commitment to what consensus observed
            "observed_at": 0,
        }
        self.challenges[challenge_id] = json.dumps(ch)

        # index it under the watcher so the frontend can find "my
        # last challenge" via a free view call instead of relying
        # on simulateWriteContract's return value -- which the
        # fetch guide confirmed does NOT honor `value` reliably on
        # payable methods.
        watcher = ch["watcher"]
        raw_list = self.watcher_challenges.get(watcher)
        w_ids = json.loads(raw_list) if raw_list else []
        w_ids.append(challenge_id)
        self.watcher_challenges[watcher] = json.dumps(w_ids)

        return challenge_id

    @gl.public.view
    def get_watcher_challenges(self, watcher: str) -> str:
        raw = self.watcher_challenges.get(watcher)
        return raw if raw else "[]"

    @gl.public.view
    def get_challenge_counter(self) -> int:
        return int(self.challenge_counter)

    def _load_challenge(self, challenge_id: str) -> dict:
        raw = self.challenges.get(challenge_id)
        if raw is None:
            raise gl.vm.UserError("Challenge not found")
        return json.loads(raw)

    @gl.public.view
    def get_challenge(self, challenge_id: str) -> str:
        raw = self.challenges.get(challenge_id)
        return raw if raw else json.dumps({"error": "not found"})

    # --------------------------------------------------------
    # REVEAL (liveness only) -- audit fix #1 + start of fix #2.
    # The watcher reveals the secret nonce; the contract checks it
    # matches the commitment, publishes it (so the agent can now
    # post it), and STARTS the fair response window. Resolution is
    # blocked until that window elapses.
    # --------------------------------------------------------
    @gl.public.write
    def reveal_nonce(self, challenge_id: str, secret_nonce: str) -> None:
        ch = self._load_challenge(challenge_id)
        if ch["watcher"] != self._sender():
            raise gl.vm.UserError("Only the watcher who opened this challenge can reveal")
        if ch["status"] != "committed":
            raise gl.vm.UserError("Challenge is not awaiting a reveal")

        now = self._now()
        if now > int(ch["reveal_deadline"]):
            raise gl.vm.UserError(
                "Reveal window has expired -- this challenge can now be cancelled"
            )

        computed = hashlib.sha256(secret_nonce.encode("utf-8")).hexdigest()
        if computed != ch["commitment"]:
            raise gl.vm.UserError("secret_nonce does not match the committed hash")

        ch["nonce"] = secret_nonce
        ch["revealed_at"] = now
        ch["resolve_not_before"] = now + int(self.response_window_seconds)
        ch["status"] = "revealed"
        self.challenges[challenge_id] = json.dumps(ch)

    # --------------------------------------------------------
    # CANCEL -- anti-grief. If a watcher opens a liveness challenge
    # (locking the agent's bond) but never reveals the secret, the
    # bond would otherwise be stuck forever. After the reveal window
    # expires, anyone may cancel: the reserved bond is released and
    # no slash occurs. The watcher forfeits the challenge fee (it was
    # already booked to the protocol), which discourages this grief.
    # --------------------------------------------------------
    @gl.public.write
    def cancel_challenge(self, challenge_id: str) -> None:
        ch = self._load_challenge(challenge_id)
        if ch["status"] != "committed":
            raise gl.vm.UserError("Only an unrevealed (committed) challenge can be cancelled")
        now = self._now()
        if now <= int(ch["reveal_deadline"]):
            raise gl.vm.UserError("Reveal window is still open")

        claim = self._load_claim(ch["claim_id"])
        claim["bond_locked"] = max(0, claim["bond_locked"] - ch["stake_amount"])
        self.claims[ch["claim_id"]] = json.dumps(claim)

        ch["status"] = "cancelled"
        ch["verdict_detail"] = "Cancelled: watcher did not reveal the nonce within the reveal window."
        self.challenges[challenge_id] = json.dumps(ch)

    # --------------------------------------------------------
    # LIVENESS challenge: plain string match on a live fetch.
    # --------------------------------------------------------
    @gl.public.write
    def resolve_liveness_challenge(self, challenge_id: str) -> None:
        ch = self._load_challenge(challenge_id)
        # AUDIT FIX #1/#2: the nonce must have been revealed, and the
        # response window must have elapsed, before we can resolve.
        if ch["status"] != "revealed":
            if ch["status"] == "committed":
                raise gl.vm.UserError("Nonce not revealed yet -- call reveal_nonce first")
            raise gl.vm.UserError("Challenge already resolved")
        claim = self._load_claim(ch["claim_id"])
        if claim["claim_type"] != "liveness":
            raise gl.vm.UserError("This claim is not a liveness-type claim")

        now = self._now()
        if now < int(ch["resolve_not_before"]):
            raise gl.vm.UserError(
                "Response window still open -- the agent must be given time to respond before resolving"
            )

        proof_url = claim["proof_url"]
        nonce = ch["nonce"]

        def generate():
            page_text = None
            try:
                response = gl.nondet.web.request(proof_url, method="GET")
                page_text = response.body.decode("utf-8", errors="ignore")[:4000]
            except Exception as e:
                # bare Exception only -- never import GenLayer exception
                # classes, per guide: validators may differ on class
                # availability, which causes consensus splits.
                ctx = e.args[0] if e.args else {}
                if isinstance(ctx, dict):
                    body = ctx.get("body")
                    if body:
                        page_text = str(body)[:4000]

            if not page_text:
                # AUDIT FIX #3: no reachable page => no authenticated
                # evidence. Decision made HERE, inside generate(): this
                # is NOT a slashable failure, it is inconclusive.
                return {
                    "passed": False,
                    "reason": "proof_url unreachable -- no authenticated evidence, not slashable",
                    "evidence_status": "unavailable",
                    "evidence_digest": "",
                }

            found = nonce in page_text
            # AUDIT FIX #3: bind the verdict to a deterministic digest
            # of exactly what consensus observed for THIS unpredictable
            # nonce. We digest the decision-relevant fact (nonce +
            # present/absent) rather than raw HTML so strict_eq stays
            # robust -- unrelated page churn cannot split consensus,
            # but the slash is still cryptographically tied to a fresh,
            # post-reveal observation of this specific nonce.
            observation = "present" if found else "absent"
            digest = hashlib.sha256(
                (nonce + "|" + observation).encode("utf-8")
            ).hexdigest()
            return {
                "passed": bool(found),
                "reason": "nonce found on page" if found else "nonce not found on page",
                "evidence_status": "authenticated",
                "evidence_digest": digest,
            }

        # This is a clean, deterministic yes/no string match with no
        # LLM call in it -- every validator that fetches the same
        # content should produce the EXACT same output. strict_eq
        # (the same call GenLayer's own PredictionMarket sample uses
        # for an equally clean, deterministic dict) checks for that
        # exact equality directly. prompt_non_comparative was the
        # wrong tool here: it runs its own separate LLM judgment to
        # decide whether output is "close enough" to a task
        # description, which is only meaningful when generate()
        # itself produces free-form LLM reasoning -- ours never did,
        # and handing it a clean dict with no prose left that
        # judgment step with nothing sensible to evaluate.
        verdict = gl.eq_principle.strict_eq(generate)
        self._apply_verdict(challenge_id, ch, verdict)

    # --------------------------------------------------------
    # BEHAVIOR challenge: genuine AI judgment call. This is
    # the one that actually needs GenLayer -- "does live
    # activity match the promise" is not a string match.
    # --------------------------------------------------------
    @gl.public.write
    def resolve_behavior_challenge(self, challenge_id: str) -> None:
        ch = self._load_challenge(challenge_id)
        if ch["status"] != "pending":
            raise gl.vm.UserError("Challenge already resolved")
        claim = self._load_claim(ch["claim_id"])
        if claim["claim_type"] != "behavior":
            raise gl.vm.UserError("This claim is not a behavior-type claim")

        # AUDIT FIX #2: enforce the fair response window here too.
        now = self._now()
        if now < int(ch["resolve_not_before"]):
            raise gl.vm.UserError(
                "Response window still open -- the agent must be given time to respond before resolving"
            )

        proof_url = claim["proof_url"]
        promise_text = claim["claim_text"]

        def generate():
            page_text = None
            try:
                response = gl.nondet.web.request(proof_url, method="GET")
                page_text = response.body.decode("utf-8", errors="ignore")[:4000]
            except Exception as e:
                ctx = e.args[0] if e.args else {}
                if isinstance(ctx, dict):
                    body = ctx.get("body")
                    if body:
                        page_text = str(body)[:4000]

            if not page_text:
                # AUDIT FIX #3: unreachable => no authenticated evidence
                # => inconclusive, never slashable.
                return json.dumps({
                    "passed": False,
                    "confidence": 0,
                    "reason": "proof_url unreachable -- no authenticated evidence, not slashable",
                    "evidence_status": "unavailable",
                    "evidence_digest": "",
                })

            # AUDIT FIX #3: digest the exact live data the judgment was
            # made against, so the slash is bound to an authenticated,
            # recorded snapshot rather than the mutable live URL.
            evidence_digest = hashlib.sha256(page_text.encode("utf-8")).hexdigest()

            prompt = f"""
You are checking whether an AI agent's ACTUAL live activity matches
a PROMISE it made. Be strict and literal. If ambiguous, treat it as
a fail -- do not give benefit of the doubt.

PROMISE: {promise_text}

LIVE DATA (fetched just now from the agent's own proof page):
{page_text}

Respond with ONLY a JSON object, no other text:
{{"passed": true or false, "confidence": 0-100, "reason": "one sentence"}}
"""
            raw = gl.nondet.exec_prompt(prompt).replace("```json", "").replace("```", "")

            try:
                s = raw.find("{")
                e = raw.rfind("}") + 1
                parsed = json.loads(raw[s:e]) if s >= 0 and e > s else {}
            except Exception:
                parsed = {}

            passed_val = parsed.get("passed")
            if passed_val is None:
                passed_val = False  # safe default -- never accidentally pass
            try:
                confidence = max(0, min(100, int(parsed.get("confidence", 0))))
            except Exception:
                confidence = 0
            reason = parsed.get("reason") or "no reason given"

            # decision made HERE, inside generate(): low-confidence
            # passes get downgraded to fail
            final_passed = bool(passed_val) and confidence >= 60
            return json.dumps({
                "passed": final_passed,
                "confidence": confidence,
                "reason": reason,
                "evidence_status": "authenticated",
                "evidence_digest": evidence_digest,
            })

        # AUDIT FIX #3 (behavior path): use the COMPARATIVE principle, not the
        # non-comparative one. prompt_non_comparative wraps generate() in a
        # SECOND LLM pass and returns that text, which discards the structured
        # evidence_status / evidence_digest generate() computed -- so a slash
        # could never be bound to authenticated evidence (it silently always
        # fell through to "inconclusive"). prompt_comparative returns
        # generate()'s own result verbatim from the leader while validators
        # independently re-fetch and judge equivalence, so the authenticated
        # digest survives to _apply_verdict AND consensus is preserved.
        result_raw = gl.eq_principle.prompt_comparative(
            generate,
            principle=(
                "Two verdicts are equivalent if they reach the SAME pass/fail "
                "decision about whether the agent's live proof data is "
                "consistent with its stated promise. Validators independently "
                "fetch the same proof URL; ambiguous or low-confidence cases "
                "must be treated as a fail. The evidence_digest may legitimately "
                "differ between nodes if the live page changed between fetches "
                "and need not match byte-for-byte -- only the pass/fail "
                "decision must agree."
            ),
        )

        verdict = self._normalize_verdict(result_raw)
        self._apply_verdict(challenge_id, ch, verdict)

    # --------------------------------------------------------
    # eq_principle sometimes returns generate()'s full JSON
    # verbatim, sometimes a summarized shape instead. Normalize
    # both -- lesson from CommunityPulse.
    # --------------------------------------------------------
    def _normalize_verdict(self, result_raw: str) -> dict:
        verdict = {}
        try:
            cleaned = result_raw.replace("```json", "").replace("```", "").strip()
            s = cleaned.find("{")
            e = cleaned.rfind("}") + 1
            if s >= 0 and e > s:
                verdict = json.loads(cleaned[s:e])
        except Exception:
            verdict = {}

        if "passed" not in verdict:
            verdict["passed"] = bool(verdict.get("result", False))
        verdict["passed"] = bool(verdict.get("passed", False))
        verdict["reason"] = verdict.get("reason", "no reason recorded")
        # AUDIT FIX #3: carry the evidence binding through normalization.
        # SAFE DEFAULT: if the evidence fields were lost/garbled, treat
        # the verdict as having NO authenticated evidence, which blocks
        # any slash (see _apply_verdict) rather than slashing blind.
        verdict["evidence_status"] = verdict.get("evidence_status", "unavailable")
        verdict["evidence_digest"] = verdict.get("evidence_digest", "")
        return verdict

    # --------------------------------------------------------
    # Apply the verdict: release or slash the reserved stake,
    # and pay the watcher out of THIS contract's own balance if
    # the agent failed. No cross-contract call needed -- it's
    # all one balance, one contract.
    #
    # AUDIT FIX #3: funds are only slashed when consensus produced
    # AUTHENTICATED evidence of failure. A "not passed" verdict with
    # no authenticated evidence (e.g. the page was unreachable) is
    # NOT a slash -- it releases the bond and records the challenge
    # as "inconclusive". Slashing blind on a mutable/absent source is
    # exactly what the audit rejected.
    # --------------------------------------------------------
    def _apply_verdict(self, challenge_id: str, ch: dict, verdict: dict) -> None:
        claim = self._load_claim(ch["claim_id"])
        now = self._now()

        evidence_status = verdict.get("evidence_status", "unavailable")
        evidence_digest = verdict.get("evidence_digest", "")
        authenticated = (evidence_status == "authenticated") and bool(evidence_digest)

        # Always record what was observed, for an immutable audit trail.
        ch["evidence_status"] = evidence_status
        ch["evidence_digest"] = evidence_digest
        ch["observed_at"] = now

        if verdict["passed"]:
            # Agent honest: release the reserved stake.
            ch["status"] = "passed"
            ch["verdict_detail"] = verdict["reason"]
            claim["bond_locked"] = max(0, claim["bond_locked"] - ch["stake_amount"])
        elif not authenticated:
            # Not passed, but NO authenticated evidence -> never slash.
            ch["status"] = "inconclusive"
            ch["verdict_detail"] = verdict["reason"] or "inconclusive -- no authenticated evidence"
            claim["bond_locked"] = max(0, claim["bond_locked"] - ch["stake_amount"])
        else:
            # Agent failed AND consensus authenticated the evidence: slash.
            ch["status"] = "failed"
            ch["verdict_detail"] = verdict["reason"]
            claim["bond_locked"] = max(0, claim["bond_locked"] - ch["stake_amount"])
            claim["bond_slashed"] += ch["stake_amount"]
            claim["status"] = "violated"

            fee = (ch["stake_amount"] * int(self.protocol_fee_bps)) // 10000
            watcher_share = ch["stake_amount"] - fee
            self.protocol_fees_collected = u256(int(self.protocol_fees_collected) + fee)

            payout_id = "PAY" + str(int(self.payout_counter) + 1).zfill(6)
            self.payout_counter = u256(int(self.payout_counter) + 1)
            self.payout_log[payout_id] = json.dumps({
                "payout_id": payout_id,
                "claim_id": ch["claim_id"],
                "challenge_id": challenge_id,
                "watcher": ch["watcher"],
                "amount_total": ch["stake_amount"],
                "watcher_share": watcher_share,
                "protocol_fee": fee,
                # bind the payout itself to the authenticated evidence
                "evidence_digest": evidence_digest,
            })

            if watcher_share > 0:
                target = gl.get_contract_at(Address(ch["watcher"]))
                target.emit_transfer(value=watcher_share)

        self.claims[ch["claim_id"]] = json.dumps(claim)
        self.challenges[challenge_id] = json.dumps(ch)

    # ========================================================
    # PAYOUTS / ADMIN
    # ========================================================

    @gl.public.view
    def get_payout(self, payout_id: str) -> str:
        raw = self.payout_log.get(payout_id)
        return raw if raw else json.dumps({"error": "not found"})

    @gl.public.write
    def withdraw_protocol_fees(self, to_address: str) -> None:
        if self._sender() != self.admin_address:
            raise gl.vm.UserError("Only admin")
        amount = int(self.protocol_fees_collected)
        if amount <= 0:
            raise gl.vm.UserError("Nothing to withdraw")
        self.protocol_fees_collected = u256(0)
        target = gl.get_contract_at(Address(to_address))
        target.emit_transfer(value=amount)
