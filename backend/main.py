import os
from dotenv import load_dotenv
load_dotenv()  # must run before entra_auth is imported - it reads ENTRA_* env vars at module load time

import httpx
from fastapi import FastAPI, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from datetime import timedelta, datetime
import models, schemas, auth, entra_auth, notifications
from mailer import send_mail
from database import engine, get_db

# Create the database tables
models.Base.metadata.create_all(bind=engine)

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="IT Ticketing System API")

# Configure CORS. CORS_ORIGINS is a comma-separated list of allowed
# origins; defaults to the local frontend dev server.
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3005").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.security import OAuth2PasswordBearer
from typing import Annotated

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)):
    payload = auth.decode_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    username: str = payload.get("sub")
    if username is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    user = db.query(models.User).filter(models.User.username == username).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

def _issue_local_token(db_user: models.User) -> dict:
    """Shared by every login path (password, Entra human, Entra service) -
    once we know who the user is, issuing our own local JWT is identical."""
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": db_user.username, "role": db_user.role}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "role": db_user.role, "id": db_user.id}

@app.post("/token", response_model=dict)
def login_for_access_token(user: schemas.UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    # db_user.hashed_password is None for Entra-provisioned accounts (they
    # never had a local password) - guard so that case 401s cleanly instead
    # of throwing inside verify_password.
    if not db_user or not db_user.hashed_password or not auth.verify_password(user.password, db_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _issue_local_token(db_user)

@app.post("/auth/entra", response_model=dict)
def login_with_entra(payload: schemas.EntraLoginRequest, db: Session = Depends(get_db)):
    """Human login via Entra ID. See entra_auth.py for what validates the
    token (Graph accepting it IS the validation for this delegated path)."""
    try:
        profile = entra_auth.fetch_graph_profile(payload.access_token)
    except httpx.HTTPStatusError:
        raise HTTPException(status_code=401, detail="Invalid or expired Microsoft token")

    entra_id = profile.get("id")
    email = (profile.get("mail") or profile.get("userPrincipalName") or "").lower()
    if not entra_id or not email:
        raise HTTPException(status_code=400, detail="Microsoft profile is missing an id or email")

    try:
        group_ids = entra_auth.fetch_graph_group_ids(payload.access_token)
        role = entra_auth.resolve_role_from_groups(group_ids)
        role_resolved = True
    except httpx.HTTPStatusError as e:
        # A failed lookup must never *downgrade* someone below whatever
        # role they already have - only apply a default of 'requester'
        # below for brand-new accounts, where there's no existing role to
        # protect. Logged (not silently swallowed) so a real permissions
        # problem is actually visible instead of just quietly resetting
        # people to requester with no trace.
        print(f"[entra] Graph group lookup failed for {email}: {e.response.status_code} {e.response.text}")
        role = None
        role_resolved = False

    # Match by entra_object_id first (returning user), then by email -
    # this links the 137 existing seeded accounts to their Entra identity
    # on first login instead of creating duplicates.
    db_user = db.query(models.User).filter(models.User.entra_object_id == entra_id).first()
    if not db_user:
        db_user = db.query(models.User).filter(models.User.email == email).first()

    if db_user:
        db_user.entra_object_id = entra_id
        db_user.email = email
        if role_resolved:
            db_user.role = role  # re-derive every login so a promotion/demotion in Entra takes effect immediately
        db_user.first_name = db_user.first_name or profile.get("givenName")
        db_user.last_name = db_user.last_name or profile.get("surname")
    else:
        db_user = models.User(
            username=email,
            entra_object_id=entra_id,
            email=email,
            first_name=profile.get("givenName"),
            last_name=profile.get("surname"),
            role=role if role_resolved else "requester",  # safe default only for brand-new accounts
            hashed_password=None,
        )
        db.add(db_user)

    db.commit()
    db.refresh(db_user)
    return _issue_local_token(db_user)

@app.post("/auth/entra/service", response_model=dict)
def login_with_entra_service(payload: schemas.EntraLoginRequest, db: Session = Depends(get_db)):
    """Machine login for the MCP server via Entra's client-credentials
    grant. Unlike the human path, the token is verified directly (see
    entra_auth.validate_service_token) since there's no Graph call to
    implicitly prove it against."""
    try:
        entra_auth.validate_service_token(payload.access_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid service token")

    # The MCP server authenticates as this same fixed service account it
    # always has - only *how* it proves that identity changed.
    db_user = db.query(models.User).filter(models.User.username == "claudeclawos").first()
    if not db_user:
        raise HTTPException(status_code=500, detail="MCP service account 'claudeclawos' does not exist - create it via the Users page first")
    return _issue_local_token(db_user)

@app.post("/users/", response_model=schemas.UserResponse)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = auth.get_password_hash(user.password)
    new_user = models.User(
        username=user.username, 
        hashed_password=hashed_password, 
        role=user.role,
        first_name=user.first_name,
        last_name=user.last_name,
        mi=user.mi,
        email=user.email,
        phone_number=user.phone_number,
        clinic_site_id=user.clinic_site_id
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.get("/users/", response_model=list[schemas.UserResponse])
def read_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role != models.RoleEnum.admin:
        raise HTTPException(status_code=403, detail="Not authorized to view users")
    users = db.query(models.User).offset(skip).limit(limit).all()
    return users

@app.get("/users/directory", response_model=list[schemas.UserDirectoryEntry])
def read_user_directory(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # Open to any authenticated role (unlike /users/) so requesters can
    # look up an employee by email when filing a ticket. Never returns
    # phone_number - see UserDirectoryEntry's docstring for what is/isn't
    # included and why.
    return db.query(models.User).order_by(models.User.email).all()

@app.get("/categories", response_model=list[str])
def read_categories():
    # Single source of truth for valid ticket categories, consumed by both
    # the web form and (ideally) any other client creating tickets - e.g.
    # the MCP server - so nobody has to hardcode a second, driftable copy
    # of this list. See TICKET_CATEGORIES in schemas.py.
    return schemas.TICKET_CATEGORIES

@app.get("/clinic-sites/", response_model=list[schemas.ClinicSiteResponse])
def read_clinic_sites(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    sites = db.query(models.ClinicSite).offset(skip).limit(limit).all()
    return sites

def get_app_settings(db: Session) -> models.AppSettings:
    # migrate_db.py seeds this row, but fall back to an unsaved in-memory
    # default (rather than 500ing) if a fresh DB somehow hasn't been
    # migrated yet - matches this app's general pattern of degrading
    # gracefully instead of hard-failing on missing config.
    settings = db.query(models.AppSettings).first()
    return settings or models.AppSettings(require_resolution_to_resolve=False)

@app.get("/settings", response_model=schemas.AppSettingsResponse)
def read_settings(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # Readable by any authenticated role, not just admin - the ticket
    # detail page needs to know require_resolution_to_resolve to show the
    # right hint to technicians, not just admins.
    return get_app_settings(db)

@app.patch("/settings", response_model=schemas.AppSettingsResponse)
def update_settings(settings_update: schemas.AppSettingsUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role != models.RoleEnum.admin:
        raise HTTPException(status_code=403, detail="Not authorized to change settings")

    settings = db.query(models.AppSettings).first()
    if not settings:
        settings = models.AppSettings()
        db.add(settings)

    update_data = settings_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(settings, key, value)

    db.commit()
    db.refresh(settings)
    return settings

@app.patch("/users/{user_id}", response_model=schemas.UserResponse)
def update_user(user_id: int, user_update: schemas.UserUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role != models.RoleEnum.admin:
        raise HTTPException(status_code=403, detail="Not authorized to update users")
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_data = user_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_user, key, value)
        
    db.commit()
    db.refresh(db_user)
    return db_user

@app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role != models.RoleEnum.admin:
        raise HTTPException(status_code=403, detail="Not authorized to delete users")
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    try:
        db.delete(db_user)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail="Cannot delete user. They may be associated with existing tickets.")
    return None


@app.post("/tickets/", response_model=schemas.TicketResponse)
def create_ticket(ticket: schemas.TicketCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # Standard time to resolution logic based on default requirements
    sla = None
    now = datetime.utcnow()
    if ticket.priority == "P1":
        sla = now + timedelta(hours=1)
    elif ticket.priority == "P2":
        sla = now + timedelta(hours=4)
    elif ticket.priority == "P3":
        sla = now + timedelta(hours=24)
    elif ticket.priority == "P4":
        sla = now + timedelta(hours=48)
        
    db_ticket = models.Ticket(
        title=ticket.title,
        description=ticket.description,
        category=ticket.category,
        priority=ticket.priority,
        sla_deadline=sla,
        requester_id=current_user.id,
        asset_id=ticket.asset_id,
        affected_user_id=ticket.affected_user_id,
        clinic_site_id=ticket.clinic_site_id
    )
    db.add(db_ticket)
    db.commit()
    db.refresh(db_ticket)

    # Content is built synchronously (cheap, needs current_user/db_ticket
    # while still attached to this request's session) - only the actual
    # network send is deferred, so a slow/unreachable SMTP relay can never
    # add latency to ticket creation, let alone fail the request.
    if current_user.email:
        to, subject, html, text = notifications.build_ticket_created(db_ticket, current_user)
        background_tasks.add_task(send_mail, to, subject, html, text)

    # If this was filed on someone else's behalf (a common workflow here -
    # phone intake, a tech filing for a coworker), the person the ticket is
    # actually about should hear about it too, not just whoever's logged
    # in. Guarded on != current_user.id so self-filed tickets that happen
    # to also set affected_user_id to yourself don't double-send.
    if db_ticket.affected_user_id and db_ticket.affected_user_id != current_user.id:
        affected_user = db.query(models.User).filter(models.User.id == db_ticket.affected_user_id).first()
        if affected_user and affected_user.email:
            to, subject, html, text = notifications.build_ticket_created_for_affected(db_ticket, affected_user, current_user)
            background_tasks.add_task(send_mail, to, subject, html, text)

    return db_ticket

@app.get("/tickets/", response_model=list[schemas.TicketResponse])
def read_tickets(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    query = db.query(models.Ticket)
    
    # Role-based filtering
    if current_user.role == models.RoleEnum.requester:
        query = query.filter(models.Ticket.requester_id == current_user.id)
    # Technicians and Admins see all tickets
    
    tickets = query.offset(skip).limit(limit).all()
    return tickets

@app.get("/tickets/{ticket_id}", response_model=schemas.TicketResponse)
def read_ticket(ticket_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    # Same visibility rule as the list endpoint: requesters can only see
    # their own tickets. Returning 404 (not 403) for someone else's ticket
    # avoids confirming to a requester that a ticket id even exists.
    if not db_ticket or (
        current_user.role == models.RoleEnum.requester and db_ticket.requester_id != current_user.id
    ):
        raise HTTPException(status_code=404, detail="Ticket not found")
    return db_ticket

@app.patch("/tickets/{ticket_id}", response_model=schemas.TicketResponse)
def update_ticket(ticket_id: int, ticket_update: schemas.TicketUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # Only Technicians and Admins can update tickets
    if current_user.role not in [models.RoleEnum.technician, models.RoleEnum.admin]:
        raise HTTPException(status_code=403, detail="Not authorized to update tickets")

    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Captured before applying changes so notifications only fire on an
    # actual transition (e.g. status sent but unchanged shouldn't re-notify).
    prev_status = db_ticket.status
    prev_tech_id = db_ticket.tech_id
    prev_note = db_ticket.technician_note
    prev_affected_user_id = db_ticket.affected_user_id

    # exclude_unset (not a plain truthy check) so a client can explicitly
    # send tech_id: null to unassign a ticket - a bare `if ticket_update.tech_id`
    # can never be true for None, so unassignment was previously impossible.
    update_data = ticket_update.dict(exclude_unset=True)

    # Checked against the *effective* resolution - either one arriving in
    # this same request, or one already saved from an earlier autosave -
    # before anything is applied, so a failed check leaves the ticket
    # completely untouched rather than partially updated.
    if update_data.get("status") == "resolved" and get_app_settings(db).require_resolution_to_resolve:
        effective_resolution = update_data.get("resolution", db_ticket.resolution)
        if not (effective_resolution and effective_resolution.strip()):
            raise HTTPException(status_code=400, detail="A resolution is required before marking this ticket resolved.")

    for key, value in update_data.items():
        setattr(db_ticket, key, value)

    db.commit()
    db.refresh(db_ticket)

    # Same pattern as create_ticket: build email content synchronously
    # (while db_ticket/requester/affected_user are still attached to this
    # session), defer only the actual send.
    requester = db.query(models.User).filter(models.User.id == db_ticket.requester_id).first()
    affected_user = None
    if db_ticket.affected_user_id and db_ticket.affected_user_id != db_ticket.requester_id:
        affected_user = db.query(models.User).filter(models.User.id == db_ticket.affected_user_id).first()

    technician = None
    if "tech_id" in update_data and db_ticket.tech_id and db_ticket.tech_id != prev_tech_id:
        technician = db.query(models.User).filter(models.User.id == db_ticket.tech_id).first()

    # Status/assignment/note notifications go to both the requester and
    # the affected employee (if one is set and isn't the same person) -
    # whoever's logged in filed/updated it, but the affected employee is
    # who the ticket is actually about.
    for recipient in (r for r in (requester, affected_user) if r and r.email):
        if "status" in update_data and db_ticket.status != prev_status:
            to, subject, html, text = notifications.build_status_changed(db_ticket, recipient, db_ticket.status)
            background_tasks.add_task(send_mail, to, subject, html, text)

        if technician:
            to, subject, html, text = notifications.build_ticket_assigned(db_ticket, recipient, technician)
            background_tasks.add_task(send_mail, to, subject, html, text)

        if "technician_note" in update_data and db_ticket.technician_note and db_ticket.technician_note != prev_note:
            to, subject, html, text = notifications.build_technician_note(db_ticket, recipient, db_ticket.technician_note)
            background_tasks.add_task(send_mail, to, subject, html, text)

    # Affected-employee-only: they were just newly linked to this ticket
    # (e.g. a tech set/changed the Affected Employee field on an existing
    # ticket) - the same "filed on your behalf" notification create_ticket
    # sends, since from their perspective this is the first they're
    # hearing about it.
    if affected_user and affected_user.email and "affected_user_id" in update_data and db_ticket.affected_user_id != prev_affected_user_id:
        to, subject, html, text = notifications.build_ticket_created_for_affected(db_ticket, affected_user, requester)
        background_tasks.add_task(send_mail, to, subject, html, text)

    return db_ticket

@app.post("/tickets/{ticket_id}/reopen", response_model=schemas.TicketResponse)
def reopen_ticket(ticket_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # Deliberately a separate, narrow endpoint rather than folding into the
    # general PATCH above - that one is tech/admin only, but the whole
    # point of this action is letting the requester who filed it say "this
    # didn't actually fix it" without needing to be a technician. Anyone
    # who can already fully edit tickets (tech/admin) is allowed too.
    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket or (
        current_user.role == models.RoleEnum.requester and db_ticket.requester_id != current_user.id
    ):
        raise HTTPException(status_code=404, detail="Ticket not found")

    if db_ticket.status != models.TicketStatus.resolved:
        raise HTTPException(status_code=400, detail="Only a resolved ticket can be reopened")

    # Left assigned to whoever last worked it (if anyone) rather than
    # unassigning - they already have the context, and dropping it back
    # into the unassigned pool would lose that continuity.
    db_ticket.status = models.TicketStatus.open
    db.commit()
    db.refresh(db_ticket)
    return db_ticket
