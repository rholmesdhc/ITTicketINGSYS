import os
from server import (
    create_ticket,
    get_ticket,
    search_tickets,
    update_ticket,
    lookup_employee,
    lookup_employee_id_by_email,
    list_clinic_sites,
    login,
    get_auth_headers,
)

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

    print("\n2. Testing employee directory lookup (affected_employee_email)...")
    try:
        # A known-seeded employee - see backend/seed_users.py
        result_id = lookup_employee_id_by_email("acrayton@DeltaHealthCenter.org")
        print(f"Lookup result: {result_id}")
        print("Lookup successful." if result_id else "Lookup returned no match.")
    except Exception as e:
        print(f"Employee lookup encountered an error: {e}")

    print("\n3. Testing lookup_employee (fuzzy search tool)...")
    try:
        result = lookup_employee("crayton")
        print(result)
    except Exception as e:
        print(f"lookup_employee encountered an error: {e}")

    print("\n4. Testing list_clinic_sites...")
    try:
        result = list_clinic_sites()
        print(result)
    except Exception as e:
        print(f"list_clinic_sites encountered an error: {e}")

    print("\n5. Testing ticket creation (via tool function)...")
    test_ticket_id = None
    try:
        result = create_ticket(
            title="MCP toolset smoke test - safe to ignore/delete",
            description="Created by test_server.py to exercise get/search/update tools end-to-end.",
            category="software",  # deliberately lowercase - backend should normalize to 'Software'
            priority="P3",
            affected_employee_email="acrayton@DeltaHealthCenter.org",
        )
        print(f"Result: {result}")
        if "Ticket created successfully!" in result:
            print("Ticket creation successful.")
            test_ticket_id = int(result.split("ID: ")[1].split(",")[0])
        else:
            print("Ticket creation failed.")
    except Exception as e:
        print(f"Ticket creation encountered an error: {e}")

    if test_ticket_id is None:
        print("\nSkipping get/search/update tests - no test ticket id.")
        return

    print(f"\n6. Testing get_ticket({test_ticket_id})...")
    try:
        print(get_ticket(test_ticket_id))
    except Exception as e:
        print(f"get_ticket encountered an error: {e}")

    print("\n7. Testing search_tickets(query='smoke test')...")
    try:
        print(search_tickets(query="smoke test"))
    except Exception as e:
        print(f"search_tickets encountered an error: {e}")

    print(f"\n8. Testing update_ticket({test_ticket_id}) - set in_progress, assign technician...")
    try:
        result = update_ticket(
            test_ticket_id,
            status="in_progress",
            technician_email="rholmes",  # deliberately wrong-looking to confirm graceful failure path
        )
        print(result)
    except Exception as e:
        print(f"update_ticket (bad email) encountered an error: {e}")

    print(f"\n9. Testing update_ticket({test_ticket_id}) - unassign technician, resolve...")
    try:
        result = update_ticket(test_ticket_id, status="resolved", technician_email="unassign")
        print(result)
    except Exception as e:
        print(f"update_ticket encountered an error: {e}")

if __name__ == "__main__":
    run_test()
