from sqlalchemy import Column, Integer, String, Enum, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship
import enum
from datetime import datetime
from database import Base

class RoleEnum(str, enum.Enum):
    admin = "admin"
    technician = "technician"
    requester = "requester"

class TicketStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"

class PriorityTier(str, enum.Enum):
    P1 = "P1" # Critical Patient Care Impact
    P2 = "P2"
    P3 = "P3"
    P4 = "P4" # General Inquiry

class AppSettings(Base):
    # Single-row table (see main.py's get_settings/GET+PATCH /settings) -
    # tenant-wide toggles, not per-user preferences. New settings get a
    # new column here + an Alembic migration (`alembic revision
    # --autogenerate`).
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, index=True)
    # If true, PATCH /tickets/{id} rejects setting status to "resolved"
    # unless a resolution is already on file (or included in the same
    # request) - see update_ticket in main.py.
    require_resolution_to_resolve = Column(Boolean, default=False, nullable=False)


class ClinicSite(Base):
    __tablename__ = "clinic_sites"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    users = relationship("User", back_populates="clinic_site")

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String, nullable=True)
    # Entra ID's immutable object id (the `oid` claim) - the durable link
    # between this row and a Microsoft identity. Nullable because existing
    # locally-seeded accounts don't have one until their first Entra login
    # links them by email (see main.py's /auth/entra).
    entra_object_id = Column(String, unique=True, index=True, nullable=True)
    role = Column(Enum(RoleEnum), default=RoleEnum.requester)
    first_name = Column(String)
    last_name = Column(String)
    mi = Column(String, nullable=True)
    email = Column(String, unique=True, index=True)
    phone_number = Column(String, nullable=True)
    clinic_site_id = Column(Integer, ForeignKey("clinic_sites.id"), nullable=True)

    clinic_site = relationship("ClinicSite", back_populates="users")

    tickets_submitted = relationship("Ticket", back_populates="requester", foreign_keys="[Ticket.requester_id]")
    tickets_assigned = relationship("Ticket", back_populates="technician", foreign_keys="[Ticket.tech_id]")


class Asset(Base):
    __tablename__ = "assets"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_tag = Column(String, unique=True, index=True)
    type = Column(String)
    location = Column(String)

    tickets = relationship("Ticket", back_populates="asset")


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    description = Column(String)
    status = Column(Enum(TicketStatus), default=TicketStatus.open)
    category = Column(String)  # EHR/NextGen, Hardware/Workstation, Network/Connectivity, Telecom
    priority = Column(Enum(PriorityTier), default=PriorityTier.P4)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    sla_deadline = Column(DateTime, nullable=True)

    requester_id = Column(Integer, ForeignKey("users.id"))
    tech_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True)
    # The employee the issue is actually affecting, if different from
    # whoever is filing the ticket (e.g. a tech filing on someone's behalf).
    affected_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Explicit override for which clinic site this ticket concerns. Not
    # derived automatically from affected_user/requester's own profile
    # site because that's frequently wrong or unset for phone-intake
    # tickets - a tech needs to be able to just set it directly.
    clinic_site_id = Column(Integer, ForeignKey("clinic_sites.id"), nullable=True)
    # A single, tech/admin-editable free-text note surfaced to the
    # requester (e.g. "waiting on a replacement part") - deliberately a
    # plain field, not a threaded comment log, since the only gap this
    # closes is "the requester has zero visibility into progress between
    # filing and resolution," not full two-way messaging.
    technician_note = Column(String, nullable=True)
    # Distinct from technician_note above: the permanent record of how the
    # issue was actually fixed, entered when resolving - not an
    # in-progress status update, and not overwritten by one. Kept even if
    # the ticket is later reopened, as a historical record of what was
    # tried.
    resolution = Column(String, nullable=True)
    # True when priority was set by the AI triage fallback (the classifier
    # was unreachable/timed out/returned something unusable at creation, so
    # it landed on the safety-net P3 rather than a real assessment) - lets
    # technicians find these instead of trusting an unreviewed guess.
    # Cleared the moment a technician/admin sets priority explicitly.
    priority_needs_review = Column(Boolean, default=False, nullable=False)

    requester = relationship("User", back_populates="tickets_submitted", foreign_keys=[requester_id])
    technician = relationship("User", back_populates="tickets_assigned", foreign_keys=[tech_id])
    affected_user = relationship("User", foreign_keys=[affected_user_id])
    clinic_site = relationship("ClinicSite", foreign_keys=[clinic_site_id])
    asset = relationship("Asset", back_populates="tickets")
