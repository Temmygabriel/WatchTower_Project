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

from genlayer import *
import json
import typing


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

    def __init__(self):
        self.claim_counter = u256(0)
        self.challenge_counter = u256(0)
        self.payout_counter = u256(0)
        self.admin_address = gl.message.sender_address.as_hex
        self.protocol_fee_bps = u256(500)   # 5% default
        self.protocol_fees_collected = u256(0)
        self.challenge_fee = u256(0)

    # ------------------------------------------------------
    # Sender identity -- always from the signed transaction,
    # never trust an address passed as an argument.
    # ------------------------------------------------------
    def _sender(self) -> str:
        return gl.message.sender_address.as_hex

    @gl.public.write
    def configure(self, fee_bps: str, challenge_fee_amount: str) -> None:
        if self._sender() != self.admin_address:
            raise gl.vm.UserError("Only admin")
        fee = int(fee_bps)
        if fee < 0 or fee > 2000:
            raise gl.vm.UserError("fee_bps out of sane range (max 20%)")
        self.protocol_fee_bps = u256(fee)
        self.challenge_fee = u256(int(challenge_fee_amount))

    @gl.public.view
    def get_challenge_fee(self) -> int:
        return int(self.challenge_fee)

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

    @gl.public.write.payable
    def start_challenge(self, claim_id: str, stake_amount: str) -> str:
        paid = gl.message.value
        if paid < int(self.challenge_fee):
            raise gl.vm.UserError("Insufficient challenge fee")
        stake = int(stake_amount)   # passed as str per guide's int-param rule
        if stake <= 0:
            raise gl.vm.UserError("stake_amount must be positive")

        # The fee the watcher pays goes straight to protocol_fees_collected
        # -- without this line it was real GEN sitting in the contract's
        # balance with no accounting entry pointing at it, meaning
        # withdraw_protocol_fees could never actually reach it.
        self.protocol_fees_collected = u256(int(self.protocol_fees_collected) + paid)

        record = self._load_claim(claim_id)
        if record["status"] != "active":
            raise gl.vm.UserError("Claim is not active")

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
        nonce = "WT-" + challenge_id[-6:]

        ch = {
            "challenge_id": challenge_id,
            "claim_id": claim_id,
            "watcher": self._sender(),
            "nonce": nonce,
            "stake_amount": stake,
            "status": "pending",   # pending | passed | failed
            "verdict_detail": "",
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
    # LIVENESS challenge: plain string match on a live fetch.
    # --------------------------------------------------------
    @gl.public.write
    def resolve_liveness_challenge(self, challenge_id: str) -> None:
        ch = self._load_challenge(challenge_id)
        if ch["status"] != "pending":
            raise gl.vm.UserError("Challenge already resolved")
        claim = self._load_claim(ch["claim_id"])
        if claim["claim_type"] != "liveness":
            raise gl.vm.UserError("This claim is not a liveness-type claim")

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
                # decision made HERE, inside generate()
                return {"passed": False, "reason": "proof_url unreachable"}

            found = nonce in page_text
            return {
                "passed": bool(found),
                "reason": "nonce found on page" if found else "nonce not found on page",
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
                return json.dumps({"passed": False, "confidence": 0, "reason": "proof_url unreachable"})

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
            return json.dumps({"passed": final_passed, "confidence": confidence, "reason": reason})

        result_raw = gl.eq_principle.prompt_non_comparative(
            generate,
            task="Verify whether an agent's live proof data is consistent with its stated promise.",
            criteria="Validators independently fetch the live proof URL and judge consistency with the promise text. Ambiguous or low-confidence cases must be treated as a fail.",
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
        return verdict

    # --------------------------------------------------------
    # Apply the verdict: release or slash the reserved stake,
    # and pay the watcher out of THIS contract's own balance if
    # the agent failed. No cross-contract call needed -- it's
    # all one balance, one contract.
    # --------------------------------------------------------
    def _apply_verdict(self, challenge_id: str, ch: dict, verdict: dict) -> None:
        claim = self._load_claim(ch["claim_id"])

        if verdict["passed"]:
            ch["status"] = "passed"
            ch["verdict_detail"] = verdict["reason"]
            claim["bond_locked"] = max(0, claim["bond_locked"] - ch["stake_amount"])
        else:
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
                "watcher": ch["watcher"],
                "amount_total": ch["stake_amount"],
                "watcher_share": watcher_share,
                "protocol_fee": fee,
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
