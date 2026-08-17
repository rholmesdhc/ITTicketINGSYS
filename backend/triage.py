"""
AI-assisted ticket priority triage.

Requesters used to pick their own priority on the ticket form and almost
always picked P1 regardless of actual severity, defeating the SLA system's
purpose. This calls out to a separately-hosted classifier (a colleague's LLM
setup) that assesses priority from the ticket's title/description instead -
see create_ticket in main.py for where the requester's own input is
discarded in favor of this.

The result is treated as fully authoritative (it sets the real priority and
starts the real SLA clock immediately - see main.py) so this function is
deliberately built to *never raise* - any failure here still has to produce
a ticket, just a conservatively-triaged one. Falls back to P3 to match the
classifier's own internal default, so both layers agree on what "something
went wrong" looks like.
"""
import logging
import httpx

logger = logging.getLogger("triage")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)
logger.propagate = False

VALID_PRIORITIES = {"P1", "P2", "P3", "P4"}
FALLBACK_PRIORITY = "P3"


def classify_priority(title: str, description: str, base_url: str, api_key: str) -> tuple[str, bool]:
    """Returns (priority, needs_review). needs_review is True whenever this
    fell back rather than getting a real classification - the caller should
    persist that so technicians can find and double-check these tickets
    instead of trusting an unreviewed guess.

    base_url/api_key are passed in rather than read from os.getenv here so
    this stays easily testable and so a missing/blank config fails the same
    way as any other unreachable-service case (empty base_url -> httpx
    raises -> caught below), not as a separate code path to maintain.
    """
    try:
        resp = httpx.post(
            base_url,
            json={"title": title, "description": description},
            headers={"X-API-Key": api_key},
            timeout=50,  # a little over the triage service's own 45s bound, so its own P3 default wins before we time out client-side
        )
        resp.raise_for_status()
        priority = resp.json().get("priority")
        if priority in VALID_PRIORITIES:
            return priority, False
        logger.warning("Triage service returned an unexpected priority value: %r - falling back to %s", priority, FALLBACK_PRIORITY)
    except Exception as e:
        logger.warning("Triage service call failed (%s) - falling back to %s", e, FALLBACK_PRIORITY)
    return FALLBACK_PRIORITY, True
