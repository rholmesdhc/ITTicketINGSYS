from sqlalchemy import Column, Integer, String, Enum, ForeignKey, DateTime
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

class ClinicSite(Base):
    __tablename__ = "clinic_sites"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    users = relationship("User", back_populates="clinic_site")

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
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

    requester = relationship("User", back_populates="tickets_submitted", foreign_keys=[requester_id])
    technician = relationship("User", back_populates="tickets_assigned", foreign_keys=[tech_id])
    asset = relationship("Asset", back_populates="tickets")
