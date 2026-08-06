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

@mcp.tool()
def create_ticket(title: str, description: str, category: str, priority: str, asset_id: Optional[int] = None) -> str:
    """
    Create a new IT ticket.
    
    Args:
        title: Short summary of the issue
        description: Detailed explanation of the problem
        category: Ticket category (e.g., 'hardware', 'software', 'network', 'access')
        priority: Priority level ('P1', 'P2', 'P3', 'P4')
        asset_id: Optional ID of the affected asset
    """
    headers = get_auth_headers()
    payload = {
        "title": title,
        "description": description,
        "category": category,
        "priority": priority,
        "asset_id": asset_id
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
        return f"Ticket created successfully! ID: {data['id']}, Status: {data['status']}, Priority: {data['priority']}, SLA Deadline: {data['sla_deadline']}"
    except httpx.HTTPStatusError as e:
        return f"Failed to create ticket. HTTP Error {e.response.status_code}: {e.response.text}"
    except Exception as e:
        return f"Failed to create ticket: {str(e)}"

if __name__ == "__main__":
    mcp.run()
