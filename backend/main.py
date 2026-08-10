import os
from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import timedelta, datetime
import models, schemas, auth
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

@app.post("/token", response_model=dict)
def login_for_access_token(user: schemas.UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if not db_user or not auth.verify_password(user.password, db_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.username, "role": db_user.role}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "role": db_user.role, "id": db_user.id}

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
def create_ticket(ticket: schemas.TicketCreate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
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

@app.patch("/tickets/{ticket_id}", response_model=schemas.TicketResponse)
def update_ticket(ticket_id: int, ticket_update: schemas.TicketUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # Only Technicians and Admins can update tickets
    if current_user.role not in [models.RoleEnum.technician, models.RoleEnum.admin]:
        raise HTTPException(status_code=403, detail="Not authorized to update tickets")
    
    db_ticket = db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    # exclude_unset (not a plain truthy check) so a client can explicitly
    # send tech_id: null to unassign a ticket - a bare `if ticket_update.tech_id`
    # can never be true for None, so unassignment was previously impossible.
    update_data = ticket_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_ticket, key, value)

    db.commit()
    db.refresh(db_ticket)
    return db_ticket
