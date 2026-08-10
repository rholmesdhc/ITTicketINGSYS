import os
from server import create_ticket, lookup_employee_id_by_email, login, get_auth_headers

def run_test():
    print("Testing IT Ticketing System MCP Server Integration")
    print("-" * 50)
    
    # Ensure environment variables are set correctly for testing
    print(f"Using API Username: {os.getenv('API_USERNAME')}")
    print(f"Using API Base URL: {os.getenv('API_BASE_URL')}")
    
    print("\n1. Testing Login...")
    try:
        login()
        headers = get_auth_headers()
        if headers.get("Authorization"):
            print("Login successful. Token acquired.")
        else:
            print("Login failed. No token in headers.")
            return
    except Exception as e:
        print(f"Login encountered an error: {e}")
        return

    print("\n2. Testing Ticket Creation (via tool function)...")
    try:
        result = create_ticket(
            title="Test Ticket from MCP",
            description="This is a test ticket created by the MCP server test script.",
            category="software",  # deliberately lowercase - backend should normalize to 'Software'
            priority="P3"
        )
        print(f"Result: {result}")
        if "Ticket created successfully!" in result:
            print("Ticket creation successful.")
        else:
            print("Ticket creation failed.")
    except Exception as e:
        print(f"Ticket creation encountered an error: {e}")

    print("\n3. Testing employee directory lookup (affected_employee_email)...")
    try:
        # A known-seeded employee - see backend/seed_users.py
        result_id = lookup_employee_id_by_email("acrayton@DeltaHealthCenter.org")
        print(f"Lookup result: {result_id}")
        print("Lookup successful." if result_id else "Lookup returned no match.")
    except Exception as e:
        print(f"Employee lookup encountered an error: {e}")

if __name__ == "__main__":
    run_test()
