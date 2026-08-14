# IT Ticketing System

A clinical IT helpdesk app: requesters file tickets, technicians and admins
triage and resolve them against role-based SLAs.

## Project Status

- **Developer:** Roderick Holmes, Director of AI
- **Started:** April 22, 2026
- **Stage:** Active development / pre-UAT. Core functionality is built and
  working end-to-end locally: JWT-based auth with role-based access
  (requester / technician / admin), ticket creation and lifecycle
  management with SLA deadlines, a KPI dashboard, and user/clinic-site
  administration. An MCP server exposes ticket creation as a tool for
  AI clients. CI/CD (GitHub Actions → Docker → self-hosted runner) is in
  place for deploying to the UAT environment; the app has not yet been
  deployed to UAT or production, and there is no automated test suite yet.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | [Next.js 16](frontend/package.json) (App Router, Turbopack) + React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Charts | Recharts (dashboard KPIs) |
| Backend | [FastAPI](backend/main.py) (Python 3.12) |
| ORM / DB driver | SQLAlchemy + psycopg2-binary |
| Database | PostgreSQL |
| Auth | JWT ([PyJWT](backend/auth.py)), bcrypt password hashing |
| AI integration | [MCP server](mcp-server/server.py) (FastMCP) — exposes ticket creation as a tool for MCP-capable AI clients |
| Containerization | Docker (multi-stage builds for both apps) |
| CI/CD | GitHub Actions — lint/build/Docker-build-check on PRs, build+push to GHCR and deploy on merge to `main` |
| UAT hosting | Docker Compose on an Ubuntu host, via a self-hosted GitHub Actions runner |

## How to Launch the Application

### Prerequisites
- Python 3.12+, Node.js 20+
- A running PostgreSQL instance

### 1. Backend (FastAPI)
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows; use `source venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
```
Set the environment (or rely on the local-dev defaults baked into the code):
```bash
set DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<db_name>
set SECRET_KEY=<a-random-secret>
set CORS_ORIGINS=http://localhost:3005
```
Provision the schema (creates every table + seed data - see `backend/alembic/`; run this again after pulling any change that includes a new migration):
```bash
alembic upgrade head
```
Run it (must be on port **8005** — the frontend is hardcoded to call it there):
```bash
uvicorn main:app --host 127.0.0.1 --port 8005
```
API docs: http://localhost:8005/docs

### 2. Frontend (Next.js)
```bash
cd frontend
npm install
npm run dev
```
Runs on http://localhost:3005 (port is set in `package.json`'s `dev` script).
Set `NEXT_PUBLIC_API_BASE_URL` in a `.env.local` if the backend isn't on
`http://localhost:8005`.

### 3. (Optional) Seed sample users
```bash
cd backend
python seed_users.py
```
Reads `backend/data/DHC_Employees_2.csv` (not tracked in git — real staff
PII, see `.gitignore`) and creates a `requester` account per row, all with
the same placeholder password.

### 4. (Optional) MCP server
```bash
cd mcp-server
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # fill in API_USERNAME / API_PASSWORD / API_BASE_URL
python server.py
```
Runs over stdio — wire it into an MCP client (e.g. Claude Desktop) rather
than hitting it directly.

### Docker Compose (UAT-style, all services)
```bash
cp .env.uat.example .env.uat   # fill in real secrets
docker compose --env-file .env.uat -f docker-compose.uat.yml up -d
```
Brings up Postgres, backend (`:8005`), and frontend (`:3005`) together.
See [docker-compose.uat.yml](docker-compose.uat.yml) and
[.env.uat.example](.env.uat.example) for the full variable list.
