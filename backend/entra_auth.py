"""
Microsoft Entra ID integration helpers.

Two separate flows live here:

1. Delegated (human) - the frontend gets a Graph-scoped access token via
   NextAuth's Microsoft sign-in and posts it to POST /auth/entra. We call
   Graph's /me and /me/memberOf *with that token*. If Graph accepts it,
   it's a legitimate, unexpired token for a real signed-in user - that IS
   the validation; there's no separate signature check needed for this path.

2. App-only (machine) - the MCP server has its own Entra app registration
   and gets a token via the OAuth2 client-credentials grant (no human
   involved), scoped to OUR OWN exposed API (api://<web-app-client-id>/.default)
   - not Microsoft Graph. That distinction matters: Microsoft does not
   guarantee tokens issued for its own first-party resources (Graph
   included) are third-party-verifiable via the tenant's public JWKS, even
   though they're structurally JWTs - confirmed the hard way, a
   Graph-scoped token's signature did not verify against the same tenant's
   discovery endpoint. Only tokens issued for an API *you* expose carry
   that guarantee, which is why the Web app registration exposes one
   (see ENTRA_WEB_APP_CLIENT_ID below) purely for the MCP service to
   authenticate against - no human ever uses it.
"""
import os
import jwt
import httpx
from jwt import PyJWKClient
from typing import Optional

GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0"

ENTRA_TENANT_ID = os.getenv("ENTRA_TENANT_ID", "")
ENTRA_MCP_CLIENT_ID = os.getenv("ENTRA_MCP_CLIENT_ID", "")  # the MCP server's own app registration's client id
ENTRA_WEB_APP_CLIENT_ID = os.getenv("ENTRA_WEB_APP_CLIENT_ID", "")  # "IT Ticketing System - Web" - the API the MCP service's token is issued for
ENTRA_ADMIN_GROUP_ID = os.getenv("ENTRA_ADMIN_GROUP_ID", "")
ENTRA_TECH_GROUP_ID = os.getenv("ENTRA_TECH_GROUP_ID", "")

# The app role (see "App roles" on the Web app registration) that must be
# present on the MCP service's token - proves Entra actually granted it
# permission to call this API, not just that it can request a token.
SERVICE_APP_ROLE = "Ticketing.Service"

_jwks_client: Optional[PyJWKClient] = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        if not ENTRA_TENANT_ID:
            raise RuntimeError("ENTRA_TENANT_ID is not configured")
        _jwks_client = PyJWKClient(
            f"https://login.microsoftonline.com/{ENTRA_TENANT_ID}/discovery/v2.0/keys"
        )
    return _jwks_client


def fetch_graph_profile(access_token: str) -> dict:
    """Fetch the signed-in user's profile. Raises on an invalid/expired
    token (Graph itself rejects it), which is the validation for this path."""
    response = httpx.get(
        f"{GRAPH_BASE_URL}/me",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"$select": "id,mail,userPrincipalName,givenName,surname,officeLocation,department,jobTitle"},
    )
    response.raise_for_status()
    return response.json()


def fetch_graph_group_ids(access_token: str) -> list[str]:
    """Fetch the signed-in user's security group object ids.

    Deliberately uses /me/memberOf rather than the token's `groups` claim:
    Entra omits that claim once a user belongs to too many groups (the
    "group overage" case), and this tenant already has 213 groups - close
    enough to a real risk that relying on the claim isn't safe.
    """
    group_ids: list[str] = []
    url: Optional[str] = f"{GRAPH_BASE_URL}/me/memberOf"
    headers = {"Authorization": f"Bearer {access_token}"}
    while url:
        response = httpx.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        group_ids.extend(item["id"] for item in data.get("value", []) if item.get("id"))
        url = data.get("@odata.nextLink")
    return group_ids


def resolve_role_from_groups(group_ids: list[str]) -> str:
    """Map Entra security group membership to this app's role enum.
    Admin group wins if someone is in both. Neither -> requester."""
    if ENTRA_ADMIN_GROUP_ID and ENTRA_ADMIN_GROUP_ID in group_ids:
        return "admin"
    if ENTRA_TECH_GROUP_ID and ENTRA_TECH_GROUP_ID in group_ids:
        return "technician"
    return "requester"


def validate_service_token(token: str) -> dict:
    """Validate the MCP server's app-only client-credentials token.

    Checks: signature (against Entra's tenant JWKS), audience (must be our
    own exposed API - see ENTRA_WEB_APP_CLIENT_ID above, not Graph), the
    SERVICE_APP_ROLE app role is present (proves it was actually granted,
    not just requestable), and that the token was issued to *our* MCP app
    registration specifically (appid/azp claim). Issuer isn't checked
    explicitly - the JWKS endpoint is already tenant-scoped, so a
    signature match already proves it's this tenant.
    """
    if not ENTRA_TENANT_ID or not ENTRA_MCP_CLIENT_ID or not ENTRA_WEB_APP_CLIENT_ID:
        raise RuntimeError("ENTRA_TENANT_ID / ENTRA_MCP_CLIENT_ID / ENTRA_WEB_APP_CLIENT_ID are not configured")

    signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
    payload = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        options={"verify_aud": False},  # checked manually below - aud may be the GUID or the api:// URI form
    )

    valid_audiences = {ENTRA_WEB_APP_CLIENT_ID, f"api://{ENTRA_WEB_APP_CLIENT_ID}"}
    if payload.get("aud") not in valid_audiences:
        raise jwt.InvalidAudienceError("Token audience is not this app's exposed API")

    if SERVICE_APP_ROLE not in (payload.get("roles") or []):
        raise jwt.InvalidTokenError(f"Token is missing the required '{SERVICE_APP_ROLE}' app role")

    caller_app_id = payload.get("azp") or payload.get("appid")
    if caller_app_id != ENTRA_MCP_CLIENT_ID:
        raise jwt.InvalidTokenError("Token was not issued to the expected MCP app registration")

    return payload
