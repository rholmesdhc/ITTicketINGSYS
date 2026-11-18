"""
Proactive sync of DHC domain users into this app's own `users` table.

Two complementary paths populate a `User` row ahead of someone's first
login (which already does its own lazy upsert - see login_with_entra in
main.py):

1. Onboarding Stage 1 completion (complete_onboarding_stage1 in main.py)
   creates a row immediately for a new hire, using the generated
   assigned_email - the common case, no Graph call needed.
2. sync_requesters_from_entra (this module) is the safety net: a
   scheduled job (see main.py's startup event) that pages through a
   Dynamic Entra security group's membership (ENTRA_SYNC_GROUP_ID - e.g.
   "all enabled staff") via app-only Graph and upserts anyone missing.
   Catches everyone outside the onboarding workflow (pre-existing staff,
   people hired before that feature existed) and self-corrects as Entra's
   dynamic rule adds/removes people - no one has to maintain group
   membership by hand.

Deliberately additive-only: a person who drops out of the Entra group is
NOT deactivated or removed here. Tickets hold foreign keys into `users`
(requester_id/affected_user_id/tech_id) that can't just disappear out
from under history - that's a separate, already-logged open question
(see docs/TODO.md) about adding a soft is_active flag, not something this
sync should decide on its own.
"""
import os
import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

import models

GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"

ENTRA_TENANT_ID = os.getenv("ENTRA_TENANT_ID", "")
# Reuses the "IT Ticketing System - Mail Sender" app registration's
# existing app-only client-credentials setup (see mailer.py) - just needs
# the GroupMember.Read.All Application permission added to it in Entra,
# no separate app registration.
ENTRA_MAIL_CLIENT_ID = os.getenv("ENTRA_MAIL_CLIENT_ID", "")
ENTRA_MAIL_CLIENT_SECRET = os.getenv("ENTRA_MAIL_CLIENT_SECRET", "")
# A Dynamic-membership security group in Entra (e.g. rule
# `user.accountEnabled -eq true`) - self-maintaining, so no one has to
# remember to add new hires to it by hand.
ENTRA_SYNC_GROUP_ID = os.getenv("ENTRA_SYNC_GROUP_ID", "")

SYNC_CONFIGURED = bool(
    ENTRA_TENANT_ID and ENTRA_MAIL_CLIENT_ID and ENTRA_MAIL_CLIENT_SECRET and ENTRA_SYNC_GROUP_ID
)

# Separate cache from mailer.py's own - different scope/lifetime, no
# reason to couple the two call sites' token refresh timing together.
_token_cache: dict = {}


def _get_app_token() -> str:
    cached = _token_cache.get("token")
    if cached:
        return cached
    resp = httpx.post(
        f"https://login.microsoftonline.com/{ENTRA_TENANT_ID}/oauth2/v2.0/token",
        data={
            "client_id": ENTRA_MAIL_CLIENT_ID,
            "client_secret": ENTRA_MAIL_CLIENT_SECRET,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=10,
    )
    resp.raise_for_status()
    token = resp.json()["access_token"]
    _token_cache["token"] = token
    return token


def _fetch_group_members() -> list[dict]:
    """Paginated, app-only. /members returns a mix of member types (nested
    groups, service principals) alongside real users - filtered to
    #microsoft.graph.user here since only people can be requesters."""
    token = _get_app_token()
    members: list[dict] = []
    url = (
        f"{GRAPH_BASE_URL}/groups/{ENTRA_SYNC_GROUP_ID}/members"
        "?$select=id,mail,userPrincipalName,givenName,surname"
    )
    while url:
        headers = {"Authorization": f"Bearer {token}"}
        resp = httpx.get(url, headers=headers, timeout=15)
        if resp.status_code == 401:
            # Cached token might have expired - retry once with a fresh one.
            _token_cache.pop("token", None)
            token = _get_app_token()
            headers = {"Authorization": f"Bearer {token}"}
            resp = httpx.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        members.extend(
            item for item in data.get("value", [])
            if item.get("@odata.type") == "#microsoft.graph.user"
        )
        url = data.get("@odata.nextLink")
    return members


def sync_requesters_from_entra(db: Session) -> dict:
    """Upserts a `User` row for every member of ENTRA_SYNC_GROUP_ID.
    Matches by entra_object_id then case-insensitive email, same
    precedence/logic as login_with_entra - so someone who's already
    logged in (entra_object_id already set) or already exists from the
    CSV seed (matched by email) is linked/left alone, not duplicated.
    Never touches the role on an existing row - a brand-new local account
    gets 'requester', but an existing admin/tech/hr/requester row is never
    rewritten by this job."""
    if not SYNC_CONFIGURED:
        return {"configured": False}

    members = _fetch_group_members()

    created = 0
    linked = 0
    skipped_no_email = 0

    for member in members:
        entra_id = member.get("id")
        email = (member.get("mail") or member.get("userPrincipalName") or "").lower()
        if not entra_id or not email:
            skipped_no_email += 1
            continue

        existing = db.query(models.User).filter(models.User.entra_object_id == entra_id).first()
        if not existing:
            existing = db.query(models.User).filter(func.lower(models.User.email) == email).first()

        if existing:
            if not existing.entra_object_id:
                existing.entra_object_id = entra_id
                linked += 1
            existing.first_name = existing.first_name or member.get("givenName")
            existing.last_name = existing.last_name or member.get("surname")
            continue

        db.add(models.User(
            username=email,
            entra_object_id=entra_id,
            email=email,
            first_name=member.get("givenName"),
            last_name=member.get("surname"),
            role=models.RoleEnum.requester,
            hashed_password=None,
        ))
        created += 1

    db.commit()
    return {
        "configured": True,
        "members_seen": len(members),
        "created": created,
        "linked": linked,
        "skipped_no_email": skipped_no_email,
    }
