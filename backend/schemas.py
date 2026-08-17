from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime

class CategoryBase(BaseModel):
    name: str

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    name: str

class CategoryResponse(CategoryBase):
    id: int
    class Config:
        from_attributes = True

class ClinicSiteBase(BaseModel):
    name: str

class ClinicSiteCreate(ClinicSiteBase):
    pass

class ClinicSiteResponse(ClinicSiteBase):
    id: int
    class Config:
        from_attributes = True

class AppSettingsResponse(BaseModel):
    require_resolution_to_resolve: bool
    class Config:
        from_attributes = True

class AppSettingsUpdate(BaseModel):
    require_resolution_to_resolve: Optional[bool] = None

class UserLogin(BaseModel):
    username: str
    password: str

# Both Entra login paths (human via POST /auth/entra, MCP service via
# POST /auth/entra/service) just forward a Microsoft-issued access token -
# see backend/entra_auth.py for what happens with it.
class EntraLoginRequest(BaseModel):
    access_token: str

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

class UserPreferences(BaseModel):
    """Opaque frontend UI state (theme, dashboard collapse groups) - used
    for both GET and PATCH /users/me/preferences. PATCH shallow-merges this
    into whatever's already stored, so callers only need to send the keys
    they're actually changing."""
    preferences: Dict[str, Any]

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
    # Optional here, not required: requesters don't send one at all (the
    # server decides via AI triage - see triage.py/create_ticket), while
    # technicians/admins still must supply one - that split is enforced in
    # create_ticket itself since it depends on the caller's role, not
    # something Pydantic alone can express.
    priority: Optional[str] = None
    asset_id: Optional[int] = None
    affected_user_id: Optional[int] = None
    clinic_site_id: Optional[int] = None
    # Category validity is no longer a static Pydantic check - categories
    # are now admin-managed (see models.Category), and a field_validator
    # has no DB access. Checked in create_ticket instead.

class TicketUpdate(BaseModel):
    status: Optional[str] = None
    tech_id: Optional[int] = None
    # Lets a technician/admin correct a bad AI-triage call after the fact
    # (see update_ticket, which recalculates sla_deadline and clears
    # priority_needs_review when this is set) - priority couldn't be
    # changed post-creation at all before this.
    priority: Optional[str] = None
    affected_user_id: Optional[int] = None
    clinic_site_id: Optional[int] = None
    technician_note: Optional[str] = None
    resolution: Optional[str] = None

class TicketResponse(BaseModel):
    id: int
    title: str
    description: str
    status: str
    category: str
    priority: str
    priority_needs_review: bool
    created_at: datetime
    updated_at: datetime
    sla_deadline: Optional[datetime]
    requester_id: int
    tech_id: Optional[int]
    asset_id: Optional[int]
    affected_user_id: Optional[int]
    clinic_site_id: Optional[int]
    technician_note: Optional[str] = None
    resolution: Optional[str] = None

    class Config:
        from_attributes = True
