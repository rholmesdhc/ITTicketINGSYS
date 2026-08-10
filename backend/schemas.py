from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime

# Canonical ticket categories. Both the web form (frontend/src/app/tickets/new)
# and the MCP server tool must offer exactly these - previously the web form
# had its own hardcoded dropdown while the MCP tool accepted arbitrary free
# text with entirely different example values ('software', 'network',
# 'access'), so tickets filed through each path landed in different,
# non-overlapping category buckets. "Software" is included because it's
# already the most common real category in production data, despite never
# having been an option in the web form.
TICKET_CATEGORIES = ["Hardware/Workstation", "Software", "EHR/NextGen", "Network/Connectivity", "Telecom"]

class ClinicSiteBase(BaseModel):
    name: str

class ClinicSiteCreate(ClinicSiteBase):
    pass

class ClinicSiteResponse(ClinicSiteBase):
    id: int
    class Config:
        from_attributes = True

class UserLogin(BaseModel):
    username: str
    password: str

class UserBase(BaseModel):
    username: str
    role: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    mi: Optional[str] = None
    email: Optional[str] = None
    phone_number: Optional[str] = None
    clinic_site_id: Optional[int] = None

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    role: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    mi: Optional[str] = None
    email: Optional[str] = None
    phone_number: Optional[str] = None
    clinic_site_id: Optional[int] = None

# Minimal, non-admin-gated shape for the employee typeahead lookup - does
# NOT include phone_number like UserResponse does, since any authenticated
# user (not just admins) can call the endpoint that returns it. `role` and
# `clinic_site_id` are included (unlike phone) because the frontend needs
# them to build a "reassign to any technician" list and to show which
# clinic site a ticket's affected employee belongs to - neither is as
# sensitive as a personal phone number.
class UserDirectoryEntry(BaseModel):
    id: int
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str
    clinic_site_id: Optional[int] = None

    class Config:
        from_attributes = True

class TicketCreate(BaseModel):
    title: str
    description: str
    category: str
    priority: str
    asset_id: Optional[int] = None
    affected_user_id: Optional[int] = None
    clinic_site_id: Optional[int] = None

    @field_validator("category")
    @classmethod
    def normalize_category(cls, v: str) -> str:
        for canonical in TICKET_CATEGORIES:
            if v.strip().lower() == canonical.lower():
                return canonical
        raise ValueError(f"category must be one of: {', '.join(TICKET_CATEGORIES)}")

class TicketUpdate(BaseModel):
    status: Optional[str] = None
    tech_id: Optional[int] = None
    affected_user_id: Optional[int] = None
    clinic_site_id: Optional[int] = None

class TicketResponse(BaseModel):
    id: int
    title: str
    description: str
    status: str
    category: str
    priority: str
    created_at: datetime
    updated_at: datetime
    sla_deadline: Optional[datetime]
    requester_id: int
    tech_id: Optional[int]
    asset_id: Optional[int]
    affected_user_id: Optional[int]
    clinic_site_id: Optional[int]

    class Config:
        from_attributes = True
