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

# Global variables for auth
access_token = None

def get_auth_headers():
    global access_token
    if not access_token:
        login()
    return {"Authorization": f"Bearer {access_token}"}

def login():
    global access_token
    try:
        response = httpx.post(
            f"{API_BASE_URL}/token",
            json={"username": API_USERNAME, "password": API_PASSWORD}
        )
        response.raise_for_status()
        data = response.json()
        access_token = data.get("access_token")
    except Exception as e:
        raise Exception(f"Failed to authenticate with backend API: {str(e)}")

def _get_with_retry(path: str) -> httpx.Response:
    """GET against the backend, retrying once after a fresh login on 401."""
    headers = get_auth_headers()
    response = httpx.get(f"{API_BASE_URL}{path}", headers=headers)
    if response.status_code == 401:
        login()
        headers = get_auth_headers()
        response = httpx.get(f"{API_BASE_URL}{path}", headers=headers)
    response.raise_for_status()
    return response

def lookup_employee_id_by_email(email: str) -> Optional[int]:
    """Resolve an employee's email to their user id via /users/directory."""
    for entry in _get_with_retry("/users/directory").json():
        if (entry.get("email") or "").lower() == email.lower():
            return entry["id"]
    return None

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

    headers = get_auth_headers()
    payload = {
        "title": title,
        "description": description,
        "category": category,
        "priority": priority,
        "asset_id": asset_id,
        "affected_user_id": affected_user_id,
    }

    try:
        response = httpx.post(
            f"{API_BASE_URL}/tickets/",
            json=payload,
            headers=headers
        )

        # If unauthorized, token might be expired. Try logging in again.
        if response.status_code == 401:
            login()
            headers = get_auth_headers()
            response = httpx.post(
                f"{API_BASE_URL}/tickets/",
                json=payload,
                headers=headers
            )

        response.raise_for_status()
        data = response.json()
        return f"Ticket created successfully! ID: {data['id']}, Status: {data['status']}, Priority: {data['priority']}, SLA Deadline: {data['sla_deadline']}{lookup_note}"
    except httpx.HTTPStatusError as e:
        return f"Failed to create ticket. HTTP Error {e.response.status_code}: {e.response.text}"
    except Exception as e:
        return f"Failed to create ticket: {str(e)}"

if __name__ == "__main__":
    mcp.run()
