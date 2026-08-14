import os
import httpx
from mcp.server.fastmcp import FastMCP
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

# Initialize FastMCP server
mcp = FastMCP("IT Ticketing System")

API_USERNAME = os.getenv("API_USERNAME", "claudeclawos")
API_PASSWORD = os.getenv("API_PASSWORD", "R!sc2023")
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8005")

# Valid values, kept in sync with backend/models.py's enums and
# backend/schemas.py's TICKET_CATEGORIES - the source of truth is the
# backend; these exist so tool docstrings can tell an agent what's valid
# without it having to guess or read backend source.
TICKET_STATUSES = ["open", "in_progress", "resolved"]
TICKET_PRIORITIES = ["P1", "P2", "P3", "P4"]

# Entra ID client-credentials login (see backend/entra_auth.py's
# validate_service_token). Used instead of the legacy username/password
# login whenever all four are set; falls back to the password path
# otherwise so this keeps working during the migration.
ENTRA_TENANT_ID = os.getenv("ENTRA_TENANT_ID", "")
ENTRA_MCP_CLIENT_ID = os.getenv("ENTRA_MCP_CLIENT_ID", "")
ENTRA_MCP_CLIENT_SECRET = os.getenv("ENTRA_MCP_CLIENT_SECRET", "")
# The "IT Ticketing System - Web" app registration's client id - its
# exposed API (api://<this-id>) is what our token is actually requested
# for. Microsoft Graph's own /.default doesn't work here - see
# entra_auth.py's module docstring for why.
ENTRA_WEB_APP_CLIENT_ID = os.getenv("ENTRA_WEB_APP_CLIENT_ID", "")
_USE_ENTRA = bool(ENTRA_TENANT_ID and ENTRA_MCP_CLIENT_ID and ENTRA_MCP_CLIENT_SECRET and ENTRA_WEB_APP_CLIENT_ID)

# Global variables for auth
access_token = None

def get_auth_headers():
    global access_token
    if not access_token:
        login()
    return {"Authorization": f"Bearer {access_token}"}

def _login_via_entra() -> str:
    """Acquire an app-only token for our own exposed API via the
    client-credentials grant, then exchange it for our own local JWT.
    Scoped to api://<web-app-client-id>/.default, not Microsoft Graph -
    Graph-scoped tokens aren't reliably verifiable by a third-party
    resource server like our backend (see entra_auth.py)."""
    token_response = httpx.post(
        f"https://login.microsoftonline.com/{ENTRA_TENANT_ID}/oauth2/v2.0/token",
        data={
            "client_id": ENTRA_MCP_CLIENT_ID,
            "client_secret": ENTRA_MCP_CLIENT_SECRET,
            "scope": f"api://{ENTRA_WEB_APP_CLIENT_ID}/.default",
            "grant_type": "client_credentials",
        },
    )
    token_response.raise_for_status()
    entra_token = token_response.json()["access_token"]

    response = httpx.post(
        f"{API_BASE_URL}/auth/entra/service",
        json={"access_token": entra_token},
    )
    response.raise_for_status()
    return response.json()["access_token"]

def _login_via_password() -> str:
    response = httpx.post(
        f"{API_BASE_URL}/token",
        json={"username": API_USERNAME, "password": API_PASSWORD}
    )
    response.raise_for_status()
    return response.json()["access_token"]

def login():
    global access_token
    try:
        access_token = _login_via_entra() if _USE_ENTRA else _login_via_password()
    except Exception as e:
        raise Exception(f"Failed to authenticate with backend API: {str(e)}")

def _request_with_retry(method: str, path: str, **kwargs) -> httpx.Response:
    """Call the backend, retrying once after a fresh login on 401 (covers
    both an expired token and the very first call before one exists)."""
    headers = get_auth_headers()
    response = httpx.request(method, f"{API_BASE_URL}{path}", headers=headers, **kwargs)
    if response.status_code == 401:
        login()
        headers = get_auth_headers()
        response = httpx.request(method, f"{API_BASE_URL}{path}", headers=headers, **kwargs)
    return response

def _get_directory() -> list[dict]:
    return _request_with_retry("GET", "/users/directory").json()

def _get_clinic_sites() -> list[dict]:
    return _request_with_retry("GET", "/clinic-sites/").json()

def lookup_employee_id_by_email(email: str) -> Optional[int]:
    """Resolve an employee's email to their user id via /users/directory."""
    for entry in _get_directory():
        if (entry.get("email") or "").lower() == email.lower():
            return entry["id"]
    return None

def _lookup_clinic_site_id_by_name(name: str) -> Optional[int]:
    for site in _get_clinic_sites():
        if site.get("name", "").strip().lower() == name.strip().lower():
            return site["id"]
    return None

def _format_ticket(t: dict, directory_by_id: dict, sites_by_id: dict) -> str:
    """Render one ticket as a human-readable block, resolving the raw ids
    on TicketResponse (requester_id, tech_id, affected_user_id,
    clinic_site_id) to names/emails - an agent works with these, not
    database ids."""
    def person(user_id):
        if user_id is None:
            return "(none)"
        entry = directory_by_id.get(user_id)
        if not entry:
            return f"user #{user_id}"
        name = " ".join(filter(None, [entry.get("first_name"), entry.get("last_name")])) or entry.get("email") or f"user #{user_id}"
        return f"{name} <{entry.get('email') or 'no email'}>"

    site = sites_by_id.get(t.get("clinic_site_id"), {}).get("name") if t.get("clinic_site_id") else "(not set)"

    return (
        f"#{t['id']} - {t['title']}\n"
        f"  Status: {t['status']}  Priority: {t['priority']}  Category: {t['category']}\n"
        f"  Requester: {person(t.get('requester_id'))}\n"
        f"  Affected Employee: {person(t.get('affected_user_id'))}\n"
        f"  Assigned Technician: {person(t.get('tech_id'))}\n"
        f"  Clinic Site: {site}\n"
        f"  Created: {t['created_at']}  Updated: {t['updated_at']}  SLA Deadline: {t.get('sla_deadline') or '(none)'}\n"
        f"  Description: {t['description']}"
    )

@mcp.tool()
def create_ticket(
    title: str,
    description: str,
    category: str,
    priority: str,
    asset_id: Optional[int] = None,
    affected_employee_email: Optional[str] = None,
) -> str:
    """
    Create a new IT ticket.

    Args:
        title: Short summary of the issue
        description: Detailed explanation of the problem
        category: Ticket category - must be exactly one of: 'Hardware/Workstation',
            'Software', 'EHR/NextGen', 'Network/Connectivity', 'Telecom'
            (matches the web app's category list - do not invent other values)
        priority: Priority level ('P1', 'P2', 'P3', 'P4')
        asset_id: Optional ID of the affected asset
        affected_employee_email: Optional email of the employee this ticket is
            actually about, if different from whoever is reporting it - e.g. a
            phone-intake call placed on someone else's behalf. Looked up
            against the employee directory and linked so the ticket shows the
            real person and their clinic site, instead of that information
            only existing as free text in the title/description.
    """
    affected_user_id = None
    lookup_note = ""
    if affected_employee_email:
        try:
            affected_user_id = lookup_employee_id_by_email(affected_employee_email)
            if affected_user_id is None:
                lookup_note = f" (note: no employee found matching '{affected_employee_email}' - ticket created without an affected-employee link)"
        except Exception:
            lookup_note = " (note: employee lookup failed - ticket created without an affected-employee link)"

    payload = {
        "title": title,
        "description": description,
        "category": category,
        "priority": priority,
        "asset_id": asset_id,
        "affected_user_id": affected_user_id,
    }

    try:
        response = _request_with_retry("POST", "/tickets/", json=payload)
        response.raise_for_status()
        data = response.json()
        return f"Ticket created successfully! ID: {data['id']}, Status: {data['status']}, Priority: {data['priority']}, SLA Deadline: {data['sla_deadline']}{lookup_note}"
    except httpx.HTTPStatusError as e:
        return f"Failed to create ticket. HTTP Error {e.response.status_code}: {e.response.text}"
    except Exception as e:
        return f"Failed to create ticket: {str(e)}"

@mcp.tool()
def get_ticket(ticket_id: int) -> str:
    """
    Fetch full details of a single ticket by its id, including who
    requested it, who it's assigned to, the affected employee, and clinic
    site - all resolved to names/emails rather than raw ids.

    Args:
        ticket_id: The numeric ticket id (e.g. from search_tickets results
            or a ticket number the user gives you).
    """
    try:
        response = _request_with_retry("GET", f"/tickets/{ticket_id}")
        if response.status_code == 404:
            return f"No ticket found with id {ticket_id}."
        response.raise_for_status()
        t = response.json()
        directory_by_id = {e["id"]: e for e in _get_directory()}
        sites_by_id = {s["id"]: s for s in _get_clinic_sites()}
        return _format_ticket(t, directory_by_id, sites_by_id)
    except httpx.HTTPStatusError as e:
        return f"Failed to fetch ticket. HTTP Error {e.response.status_code}: {e.response.text}"
    except Exception as e:
        return f"Failed to fetch ticket: {str(e)}"

@mcp.tool()
def search_tickets(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    category: Optional[str] = None,
    technician_email: Optional[str] = None,
    affected_employee_email: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 20,
) -> str:
    """
    Search/filter tickets. All filters are optional and combine with AND -
    call with no arguments to list the most recent tickets.

    Args:
        status: Filter by exact status - one of: 'open', 'in_progress', 'resolved'
        priority: Filter by exact priority - one of: 'P1', 'P2', 'P3', 'P4'
        category: Filter by exact category - one of: 'Hardware/Workstation',
            'Software', 'EHR/NextGen', 'Network/Connectivity', 'Telecom'
        technician_email: Filter to tickets assigned to this technician's email.
            Use the literal value 'unassigned' to find tickets with no
            technician assigned yet.
        affected_employee_email: Filter to tickets about this specific employee
        query: Free-text search against ticket title and description (case-insensitive substring match)
        limit: Maximum number of matching tickets to return (default 20, most recently updated first)
    """
    try:
        response = _request_with_retry("GET", "/tickets/", params={"limit": 1000})
        response.raise_for_status()
        tickets = response.json()

        directory = _get_directory()
        directory_by_id = {e["id"]: e for e in directory}
        sites_by_id = {s["id"]: s for s in _get_clinic_sites()}

        tech_id_filter = None
        if technician_email:
            if technician_email.strip().lower() == "unassigned":
                tech_id_filter = "unassigned"
            else:
                tech_id_filter = lookup_employee_id_by_email(technician_email)
                if tech_id_filter is None:
                    return f"No employee found matching technician email '{technician_email}'."

        affected_id_filter = None
        if affected_employee_email:
            affected_id_filter = lookup_employee_id_by_email(affected_employee_email)
            if affected_id_filter is None:
                return f"No employee found matching affected employee email '{affected_employee_email}'."

        def matches(t: dict) -> bool:
            if status and t.get("status") != status:
                return False
            if priority and t.get("priority") != priority:
                return False
            if category and t.get("category") != category:
                return False
            if tech_id_filter == "unassigned" and t.get("tech_id") is not None:
                return False
            if isinstance(tech_id_filter, int) and t.get("tech_id") != tech_id_filter:
                return False
            if affected_id_filter is not None and t.get("affected_user_id") != affected_id_filter:
                return False
            if query and query.lower() not in (t.get("title", "") + " " + t.get("description", "")).lower():
                return False
            return True

        filtered = [t for t in tickets if matches(t)]
        filtered.sort(key=lambda t: t["updated_at"], reverse=True)
        filtered = filtered[:limit]

        if not filtered:
            return "No tickets matched those filters."

        header = f"{len(filtered)} matching ticket(s):\n\n"
        return header + "\n\n".join(_format_ticket(t, directory_by_id, sites_by_id) for t in filtered)
    except httpx.HTTPStatusError as e:
        return f"Failed to search tickets. HTTP Error {e.response.status_code}: {e.response.text}"
    except Exception as e:
        return f"Failed to search tickets: {str(e)}"

@mcp.tool()
def update_ticket(
    ticket_id: int,
    status: Optional[str] = None,
    technician_email: Optional[str] = None,
    affected_employee_email: Optional[str] = None,
    clinic_site_name: Optional[str] = None,
) -> str:
    """
    Update an existing ticket. Only the fields you pass are changed -
    everything else on the ticket stays as-is.

    Args:
        ticket_id: The numeric ticket id to update
        status: New status - one of: 'open', 'in_progress', 'resolved'
        technician_email: Email of the technician to assign this ticket to.
            Use the literal value 'unassign' to clear the current assignment.
        affected_employee_email: Email of the employee this ticket should be
            linked to as the affected employee
        clinic_site_name: Exact clinic site name to set on this ticket (see
            list_clinic_sites for valid values)
    """
    payload = {}
    notes = []

    if status is not None:
        if status not in TICKET_STATUSES:
            return f"Invalid status '{status}'. Must be one of: {', '.join(TICKET_STATUSES)}"
        payload["status"] = status

    if technician_email is not None:
        if technician_email.strip().lower() == "unassign":
            payload["tech_id"] = None
        else:
            tech_id = lookup_employee_id_by_email(technician_email)
            if tech_id is None:
                return f"No employee found matching technician email '{technician_email}'. No changes were made."
            payload["tech_id"] = tech_id

    if affected_employee_email is not None:
        affected_id = lookup_employee_id_by_email(affected_employee_email)
        if affected_id is None:
            return f"No employee found matching affected employee email '{affected_employee_email}'. No changes were made."
        payload["affected_user_id"] = affected_id

    if clinic_site_name is not None:
        site_id = _lookup_clinic_site_id_by_name(clinic_site_name)
        if site_id is None:
            return f"No clinic site found matching '{clinic_site_name}'. No changes were made. Use list_clinic_sites to see valid names."
        payload["clinic_site_id"] = site_id

    if not payload:
        return "No fields to update were provided."

    try:
        response = _request_with_retry("PATCH", f"/tickets/{ticket_id}", json=payload)
        if response.status_code == 404:
            return f"No ticket found with id {ticket_id}."
        response.raise_for_status()
        directory_by_id = {e["id"]: e for e in _get_directory()}
        sites_by_id = {s["id"]: s for s in _get_clinic_sites()}
        return "Ticket updated successfully.\n\n" + _format_ticket(response.json(), directory_by_id, sites_by_id)
    except httpx.HTTPStatusError as e:
        return f"Failed to update ticket. HTTP Error {e.response.status_code}: {e.response.text}"
    except Exception as e:
        return f"Failed to update ticket: {str(e)}"

@mcp.tool()
def lookup_employee(query: str) -> str:
    """
    Search the employee directory by name or email (case-insensitive
    substring match on first name, last name, or email). Use this to find
    an employee's exact email before passing it to create_ticket,
    search_tickets, or update_ticket, or to check someone's role/clinic site.

    Args:
        query: Part of a name or email to search for, e.g. 'smith' or 'jsmith@'
    """
    try:
        directory = _get_directory()
        sites_by_id = {s["id"]: s for s in _get_clinic_sites()}
        q = query.strip().lower()
        matches = [
            e for e in directory
            if q in (e.get("email") or "").lower()
            or q in (e.get("first_name") or "").lower()
            or q in (e.get("last_name") or "").lower()
        ]
        if not matches:
            return f"No employees found matching '{query}'."

        lines = []
        for e in matches[:25]:
            name = " ".join(filter(None, [e.get("first_name"), e.get("last_name")])) or "(no name on file)"
            site = sites_by_id.get(e.get("clinic_site_id"), {}).get("name", "(not set)") if e.get("clinic_site_id") else "(not set)"
            lines.append(f"{name} <{e.get('email') or 'no email'}> - role: {e['role']}, clinic site: {site}")

        suffix = f"\n(showing first 25 of {len(matches)} matches - narrow your search)" if len(matches) > 25 else ""
        return "\n".join(lines) + suffix
    except Exception as e:
        return f"Failed to search employee directory: {str(e)}"

@mcp.tool()
def list_clinic_sites() -> str:
    """List all clinic site names, for use with update_ticket's clinic_site_name argument."""
    try:
        sites = _get_clinic_sites()
        if not sites:
            return "No clinic sites found."
        return "\n".join(f"- {s['name']}" for s in sites)
    except Exception as e:
        return f"Failed to fetch clinic sites: {str(e)}"

if __name__ == "__main__":
    mcp.run()
