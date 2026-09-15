from pydantic import BaseModel, field_validator, model_validator
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
    # How the request actually came in (call/email/in_person) - staff-set,
    # so it belongs on this staff-only update, unlike contact_phone below.
    intake_channel: Optional[str] = None

    # Validated here - unlike status/priority above, which aren't (a
    # pre-existing gap: an invalid value for either hits the Postgres enum
    # column unvalidated and 500s instead of cleanly 422ing; logged to
    # docs/TODO.md rather than fixed as a drive-by in this change).
    @field_validator("intake_channel")
    @classmethod
    def validate_intake_channel(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("call", "email", "in_person"):
            raise ValueError("intake_channel must be one of: call, email, in_person")
        return v

# Its own schema/endpoint (see PATCH /tickets/{id}/contact-phone in main.py)
# rather than a field on TicketUpdate above - that endpoint is staff-only,
# and the ticket's own requester needs to be able to set this too.
class TicketContactPhoneUpdate(BaseModel):
    contact_phone: Optional[str] = None

# --- Employee IT Onboarding ---
# See models.py's onboarding section and docs/employee-onboarding-prd.md.

# Free-text-but-validated (not a Postgres enum) - see OnboardingJobTitle's
# docstring for why. "Dental" is checked by exact string match wherever the
# conditional Dexis/FastAttach fields matter (create_onboarding_batch) - kept
# here as the canonical spelling.
ONBOARDING_DEPARTMENTS = ("Dental", "Clinical", "Administrative", "Billing", "Nursing", "IT", "Other")
ONBOARDING_DEPARTMENT_DENTAL = "Dental"
ONBOARDING_WORKSTATION_TYPES = ("dedicated_desktop", "laptop", "shared_workstation")
ONBOARDING_NOTIFICATION_TRIGGERS = ("batch_submitted", "stage1_complete")


class OnboardingJobTitleBase(BaseModel):
    title: str
    department: str
    default_workstation_type: Optional[str] = None

    @field_validator("department")
    @classmethod
    def validate_department(cls, v: str) -> str:
        if v not in ONBOARDING_DEPARTMENTS:
            raise ValueError(f"department must be one of: {', '.join(ONBOARDING_DEPARTMENTS)}")
        return v

    @field_validator("default_workstation_type")
    @classmethod
    def validate_default_workstation_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ONBOARDING_WORKSTATION_TYPES:
            raise ValueError(f"default_workstation_type must be one of: {', '.join(ONBOARDING_WORKSTATION_TYPES)}")
        return v

class OnboardingJobTitleCreate(OnboardingJobTitleBase):
    pass

class OnboardingJobTitleUpdate(OnboardingJobTitleBase):
    pass

class OnboardingJobTitleResponse(OnboardingJobTitleBase):
    id: int
    class Config:
        from_attributes = True


class OnboardingNotificationRecipientBase(BaseModel):
    trigger: str
    department: Optional[str] = None
    recipient_name: str
    recipient_email: str
    cc: bool = False

    @field_validator("trigger")
    @classmethod
    def validate_trigger(cls, v: str) -> str:
        if v not in ONBOARDING_NOTIFICATION_TRIGGERS:
            raise ValueError(f"trigger must be one of: {', '.join(ONBOARDING_NOTIFICATION_TRIGGERS)}")
        return v

    @field_validator("department")
    @classmethod
    def validate_department(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ONBOARDING_DEPARTMENTS:
            raise ValueError(f"department must be one of: {', '.join(ONBOARDING_DEPARTMENTS)}")
        return v

class OnboardingNotificationRecipientCreate(OnboardingNotificationRecipientBase):
    pass

class OnboardingNotificationRecipientResponse(OnboardingNotificationRecipientBase):
    id: int
    class Config:
        from_attributes = True


class OnboardingCandidateCreate(BaseModel):
    first_name: str
    middle_name: Optional[str] = None
    last_name: str
    job_title: str
    department: str
    clinic_site_id: Optional[int] = None
    start_date: datetime
    is_rehire: bool = False
    workstation_type: str
    # Dental-only - see model docstring. Validated below (not per-field) so
    # the error can explain the department-conditional rule, not just "not
    # one of these values".
    requires_dexis: Optional[bool] = None
    requires_fastattach: Optional[bool] = None
    workstation_suite: Optional[str] = None

    @field_validator("department")
    @classmethod
    def validate_department(cls, v: str) -> str:
        if v not in ONBOARDING_DEPARTMENTS:
            raise ValueError(f"department must be one of: {', '.join(ONBOARDING_DEPARTMENTS)}")
        return v

    @field_validator("workstation_type")
    @classmethod
    def validate_workstation_type(cls, v: str) -> str:
        if v not in ONBOARDING_WORKSTATION_TYPES:
            raise ValueError(f"workstation_type must be one of: {', '.join(ONBOARDING_WORKSTATION_TYPES)}")
        return v

    @model_validator(mode="after")
    def dental_fields_only_for_dental(self):
        if self.department != ONBOARDING_DEPARTMENT_DENTAL:
            if self.requires_dexis or self.requires_fastattach or self.workstation_suite:
                raise ValueError("requires_dexis/requires_fastattach/workstation_suite only apply when department is Dental")
        return self

class OnboardingBatchCreate(BaseModel):
    notes: Optional[str] = None
    candidates: List[OnboardingCandidateCreate]

    @field_validator("candidates")
    @classmethod
    def at_least_one_candidate(cls, v: List[OnboardingCandidateCreate]) -> List[OnboardingCandidateCreate]:
        if not v:
            raise ValueError("A batch needs at least one candidate")
        return v


class OnboardingTaskResponse(BaseModel):
    id: int
    candidate_id: int
    task_name: str
    assigned_role: str
    assigned_user_id: Optional[int]
    is_blocked: bool
    depends_on_task_id: Optional[int]
    status: str
    completed_by_user_id: Optional[int]
    completed_at: Optional[datetime]
    triggers_stage1_handoff: bool
    class Config:
        from_attributes = True

class OnboardingTaskUpdate(BaseModel):
    status: Optional[str] = None
    assigned_user_id: Optional[int] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("pending", "in_progress", "completed"):
            raise ValueError("status must be one of: pending, in_progress, completed")
        return v


class OnboardingCandidateResponse(BaseModel):
    id: int
    batch_id: int
    first_name: str
    middle_name: Optional[str]
    last_name: str
    job_title: str
    department: str
    clinic_site_id: Optional[int]
    start_date: datetime
    is_rehire: bool
    workstation_type: str
    requires_dexis: Optional[bool]
    requires_fastattach: Optional[bool]
    workstation_suite: Optional[str]
    assigned_email: Optional[str]
    stage: str
    child_ticket_id: Optional[int]
    tasks: List[OnboardingTaskResponse] = []
    class Config:
        from_attributes = True

class OnboardingBatchResponse(BaseModel):
    id: int
    submitted_by_user_id: int
    submitted_at: datetime
    status: str
    notes: Optional[str]
    master_ticket_id: Optional[int]
    candidates: List[OnboardingCandidateResponse] = []
    class Config:
        from_attributes = True

# Returned once by POST /onboarding/candidates/{id}/complete-stage1 - the
# generated temp password appears ONLY here, never in OnboardingCandidateResponse
# or any other read path, since it's never persisted (see
# OnboardingCandidate.assigned_email's docstring in models.py).
class OnboardingStage1Result(BaseModel):
    candidate: OnboardingCandidateResponse
    temp_password: str


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
    # Opaque - the frontend only needs to know whether one exists (to show
    # "Attach" vs "Replace") and can GET /tickets/{id}/screenshot for the
    # image itself; this isn't a usable path on its own from the client.
    screenshot_path: Optional[str] = None
    # Per-ticket preferred contact number - see models.Ticket.contact_phone.
    contact_phone: Optional[str] = None
    # How the request came in - see models.Ticket.intake_channel. Null
    # means the requester filed it online themselves.
    intake_channel: Optional[str] = None

    class Config:
        from_attributes = True
