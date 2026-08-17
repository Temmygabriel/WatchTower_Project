"""
Direct-mode security tests for the WatchTower audit remediation.

These map 1:1 to the three rejection points from the surprise-audit review:

  #1 Predictable nonces        -> commit-reveal (secret hidden until reveal;
                                   wrong secret rejected).
  #2 Immediate resolution      -> enforced response window (resolve blocked
                                   until resolve_not_before; reveal window +
                                   cancel anti-grief).
  #3 Unauthenticated evidence  -> verdicts bound to authenticated evidence
                                   (unreachable => inconclusive, never slashed;
                                   authenticated failure => slash + on-chain
                                   evidence digest on the challenge and payout).

Direct mode runs the leader function only (no consensus), in-memory, no Docker,
no network -- so `mock_web` / `mock_llm` stand in for gl.nondet.web/exec_prompt
and `warp` drives the deterministic transaction clock the contract reads via
datetime.now(timezone.utc).
"""

import hashlib
import json

import pytest

CONTRACT = "contracts/watchtower.py"
PROOF_URL = "https://agent.example.com/proof"
PROOF_RE = r".*agent\.example\.com/proof.*"

# Deterministic clock anchors (ISO 8601, UTC).
# Defaults: response_window = 300s, reveal_window = 600s.
T0 = "2026-03-01T00:00:00Z"            # open + reveal happen here
T0_PAST_RESPONSE = "2026-03-01T00:05:01Z"  # T0 + 301s  -> past resolve_not_before
T0_PAST_REVEAL = "2026-03-01T00:10:01Z"    # T0 + 601s  -> past reveal_deadline

BOND = 10**18
STAKE_INT = 2 * 10**17
STAKE = str(STAKE_INT)


def sha256_hex(s: str) -> str:
    """Mirror the contract's hashlib.sha256(secret.encode('utf-8')).hexdigest()."""
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _register_claim(vm, contract, operator, claim_type):
    vm.sender = operator
    vm.value = BOND
    cid = contract.register_claim("agent stays honest", PROOF_URL, claim_type)
    vm.value = 0
    return cid


def _open_liveness(vm, contract, operator, watcher, secret):
    """Register a liveness claim and open a committed challenge at T0."""
    vm.warp(T0)
    claim_id = _register_claim(vm, contract, operator, "liveness")
    vm.sender = watcher
    vm.value = 0
    ch_id = contract.start_challenge(claim_id, STAKE, sha256_hex(secret))
    return claim_id, ch_id


def _reveal(vm, contract, watcher, ch_id, secret):
    vm.sender = watcher
    contract.reveal_nonce(ch_id, secret)  # still at T0 -> resolve_not_before = T0+300


# ----------------------------------------------------------------------
# Config surface (no web/LLM) -- fast sanity that the new knobs exist.
# ----------------------------------------------------------------------

def test_window_defaults_and_configuration(direct_vm, direct_deploy, direct_owner):
    direct_vm.sender = direct_owner
    c = direct_deploy(CONTRACT)

    assert c.get_response_window() == 300
    assert c.get_reveal_window() == 600

    c.configure_windows("3600", "1800")
    assert c.get_response_window() == 3600
    assert c.get_reveal_window() == 1800

    # A zero response window would re-open the "resolve immediately" hole.
    with direct_vm.expect_revert("response window must be > 0"):
        c.configure_windows("0", "1800")


# ----------------------------------------------------------------------
# AUDIT FIX #1 -- commit-reveal (unpredictable challenge).
# ----------------------------------------------------------------------

def test_commit_reveal_wrong_secret_rejected(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = direct_deploy(CONTRACT)
    _, ch_id = _open_liveness(direct_vm, c, direct_alice, direct_bob, "correct-horse-battery")

    # The secret is NOT on-chain yet -- only its hash.
    ch = json.loads(c.get_challenge(ch_id))
    assert ch["status"] == "committed"
    assert ch["nonce"] == ""
    assert ch["commitment"] == sha256_hex("correct-horse-battery")

    # Wrong secret cannot open the commitment.
    with direct_vm.expect_revert("does not match"):
        c.reveal_nonce(ch_id, "wrong-guess")

    # Correct secret reveals and starts the response clock.
    c.reveal_nonce(ch_id, "correct-horse-battery")
    ch = json.loads(c.get_challenge(ch_id))
    assert ch["status"] == "revealed"
    assert ch["nonce"] == "correct-horse-battery"
    assert ch["resolve_not_before"] > ch["revealed_at"] >= ch["opened_at"]


def test_only_watcher_can_reveal(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    c = direct_deploy(CONTRACT)
    _, ch_id = _open_liveness(direct_vm, c, direct_alice, direct_bob, "secret-xyz")

    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only the watcher"):
        c.reveal_nonce(ch_id, "secret-xyz")


# ----------------------------------------------------------------------
# AUDIT FIX #2 -- enforced fair response window.
# ----------------------------------------------------------------------

def test_resolve_blocked_before_response_window(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = direct_deploy(CONTRACT)
    _, ch_id = _open_liveness(direct_vm, c, direct_alice, direct_bob, "s3cr3t")
    _reveal(direct_vm, c, direct_bob, ch_id, "s3cr3t")

    # Still at T0: resolving now would be the "atomic open+resolve" attack.
    with direct_vm.expect_revert("Response window still open"):
        c.resolve_liveness_challenge(ch_id)


def test_behavior_resolve_blocked_before_window(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    claim_id = _register_claim(direct_vm, c, direct_alice, "behavior")
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    ch_id = c.start_challenge(claim_id, STAKE, "")  # behavior ignores commitment
    assert json.loads(c.get_challenge(ch_id))["status"] == "pending"

    with direct_vm.expect_revert("Response window still open"):
        c.resolve_behavior_challenge(ch_id)


def test_reveal_after_reveal_window_expired(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = direct_deploy(CONTRACT)
    _, ch_id = _open_liveness(direct_vm, c, direct_alice, direct_bob, "late-secret")

    direct_vm.warp(T0_PAST_REVEAL)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Reveal window has expired"):
        c.reveal_nonce(ch_id, "late-secret")


def test_cancel_requires_expired_reveal_window_then_releases_bond(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    c = direct_deploy(CONTRACT)
    claim_id, ch_id = _open_liveness(direct_vm, c, direct_alice, direct_bob, "never-revealed")

    # Bond is reserved the instant the challenge opens.
    assert json.loads(c.get_claim(claim_id))["bond_locked"] == STAKE_INT

    # Too early: reveal window still open.
    with direct_vm.expect_revert("Reveal window is still open"):
        c.cancel_challenge(ch_id)

    # After the reveal window: anyone may cancel; bond released, NO slash.
    direct_vm.warp(T0_PAST_REVEAL)
    c.cancel_challenge(ch_id)

    ch = json.loads(c.get_challenge(ch_id))
    claim = json.loads(c.get_claim(claim_id))
    assert ch["status"] == "cancelled"
    assert claim["bond_locked"] == 0
    assert claim["bond_slashed"] == 0
    assert claim["status"] == "active"


# ----------------------------------------------------------------------
# AUDIT FIX #3 -- verdicts bound to authenticated evidence.
# ----------------------------------------------------------------------

def test_unreachable_proof_is_inconclusive_not_slashed(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = direct_deploy(CONTRACT)
    claim_id, ch_id = _open_liveness(direct_vm, c, direct_alice, direct_bob, "live-nonce")
    _reveal(direct_vm, c, direct_bob, ch_id, "live-nonce")

    # Empty body == no authenticated evidence (stands in for unreachable).
    direct_vm.mock_web(PROOF_RE, {"status": 200, "body": ""})
    direct_vm.warp(T0_PAST_RESPONSE)
    c.resolve_liveness_challenge(ch_id)

    ch = json.loads(c.get_challenge(ch_id))
    claim = json.loads(c.get_claim(claim_id))
    assert ch["status"] == "inconclusive"
    assert ch["evidence_status"] == "unavailable"
    assert ch["evidence_digest"] == ""
    # No slash: bond released, claim still active, and no payout recorded.
    assert claim["bond_slashed"] == 0
    assert claim["bond_locked"] == 0
    assert claim["status"] == "active"
    assert json.loads(c.get_payout("PAY000001")).get("error") == "not found"


def test_authenticated_liveness_failure_slashes_and_binds_digest(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    secret = "unpredictable-nonce-42"
    c = direct_deploy(CONTRACT)
    claim_id, ch_id = _open_liveness(direct_vm, c, direct_alice, direct_bob, secret)
    _reveal(direct_vm, c, direct_bob, ch_id, secret)

    # Page is reachable but does NOT contain the revealed nonce -> authenticated failure.
    direct_vm.mock_web(PROOF_RE, {"status": 200, "body": "<html>nothing relevant here</html>"})
    direct_vm.warp(T0_PAST_RESPONSE)
    c.resolve_liveness_challenge(ch_id)

    expected_digest = sha256_hex(secret + "|absent")
    ch = json.loads(c.get_challenge(ch_id))
    claim = json.loads(c.get_claim(claim_id))
    payout = json.loads(c.get_payout("PAY000001"))

    assert ch["status"] == "failed"
    assert ch["evidence_status"] == "authenticated"
    assert ch["evidence_digest"] == expected_digest
    assert claim["bond_slashed"] == STAKE_INT
    assert claim["status"] == "violated"
    # Payout is bound to the same authenticated evidence digest.
    assert payout["challenge_id"] == ch_id
    assert payout["evidence_digest"] == expected_digest
    assert payout["amount_total"] == STAKE_INT
    assert payout["protocol_fee"] == (STAKE_INT * 500) // 10000


def test_authenticated_liveness_pass_releases_bond(direct_vm, direct_deploy, direct_alice, direct_bob):
    secret = "present-nonce-99"
    c = direct_deploy(CONTRACT)
    claim_id, ch_id = _open_liveness(direct_vm, c, direct_alice, direct_bob, secret)
    _reveal(direct_vm, c, direct_bob, ch_id, secret)

    # Nonce IS present on the page -> agent honest.
    direct_vm.mock_web(PROOF_RE, {"status": 200, "body": f"...service token {secret} ok..."})
    direct_vm.warp(T0_PAST_RESPONSE)
    c.resolve_liveness_challenge(ch_id)

    ch = json.loads(c.get_challenge(ch_id))
    claim = json.loads(c.get_claim(claim_id))
    assert ch["status"] == "passed"
    assert ch["evidence_status"] == "authenticated"
    assert claim["bond_slashed"] == 0
    assert claim["bond_locked"] == 0
    assert claim["status"] == "active"


def test_authenticated_behavior_failure_slashes_and_binds_page_digest(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    page_body = "Agent promised daily posts but the feed has been silent for weeks."
    c = direct_deploy(CONTRACT)
    direct_vm.warp(T0)
    claim_id = _register_claim(direct_vm, c, direct_alice, "behavior")
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    ch_id = c.start_challenge(claim_id, STAKE, "")

    direct_vm.mock_web(PROOF_RE, {"status": 200, "body": page_body})
    # Leader LLM judges the promise broken, high confidence.
    direct_vm.mock_llm(
        r"checking whether an AI agent",
        json.dumps({"passed": False, "confidence": 92, "reason": "feed silent, promise broken"}),
    )
    direct_vm.warp(T0_PAST_RESPONSE)
    c.resolve_behavior_challenge(ch_id)

    ch = json.loads(c.get_challenge(ch_id))
    claim = json.loads(c.get_claim(claim_id))
    payout = json.loads(c.get_payout("PAY000001"))

    assert ch["status"] == "failed"
    assert ch["evidence_status"] == "authenticated"
    assert ch["evidence_digest"] == sha256_hex(page_body)
    assert claim["bond_slashed"] == STAKE_INT
    assert payout["evidence_digest"] == sha256_hex(page_body)
