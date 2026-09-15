from sqlalchemy import Column, Integer, String, Enum, ForeignKey, DateTime, Boolean, JSON
from sqlalchemy.orm import relationship
import enum
from datetime import datetime
from database import Base

class RoleEnum(str, enum.Enum):
    admin = "admin"
    technician = "technician"
    requester = "requester"
    # HR Assistant - submits Employee Onboarding requests (see
    # OnboardingBatch below) but isn't IT staff: no ticket-queue access, no
    # technician-assignment dropdowns, no admin settings. Added as its own
    # role rather than reusing admin/technician specifically to avoid
    # over-privileging Kim with unrelated IT access she doesn't need.
    hr = "hr"

class TicketStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"

class PriorityTier(str, enum.Enum):
    P1 = "P1" # Critical Patient Care Impact
    P2 = "P2"
    P3 = "P3"
    P4 = "P4" # General Inquiry

# How a ticket actually reached IT, for the cases where a requester didn't
# just file it themselves online - a technician taking a phone call or a
# walk-up request wants a quick way to note that, mostly for reporting
# ("how much of our volume is actually phone-intake") rather than anything
# that changes ticket handling. Deliberately no "online" option - null
# means self-filed online, which is the common case and needs no explicit
# selection.
class IntakeChannel(str, enum.Enum):
    call = "call"
    email = "email"
    in_person = "in_person"

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

class Category(Base):
    # Admin-managed list of valid ticket categories (see GET/POST/PATCH/
    # DELETE /categories in main.py). Deliberately NOT a foreign key target
    # for Ticket.category - a ticket's category is a point-in-time copy of
    # the name at creation, same treatment as technician_note/resolution,
    # so renaming or deleting a category here never touches existing
    # tickets that used the old name.
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

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
    # Frontend-owned UI state (theme, dashboard collapse groups) - a flat
    # dict the backend just stores/returns, never validates or queries. See
    # GET/PATCH /users/me/preferences in main.py.
    ui_preferences = Column(JSON, nullable=True)

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
    # Generated filename (a UUID, never the uploader's original filename -
    # avoids collisions and path-traversal from untrusted input) of the
    # ticket's attached screenshot, stored on disk under
    # SCREENSHOT_UPLOAD_DIR (see main.py) - not a DB blob, matching how
    # this app already keeps other large/binary data (the CSV seed file)
    # off the database. One per ticket - a re-upload replaces this file
    # and overwrites this path, it doesn't append.
    screenshot_path = Column(String, nullable=True)
    # Per-TICKET preferred contact number, distinct from the requester's
    # profile User.phone_number - "best way to reach someone about this
    # specific issue" (their cell today, a front-desk extension, etc.) isn't
    # always the same as their on-file directory number, and shouldn't
    # silently overwrite it. Editable by the requester themselves or staff
    # (see the dedicated PATCH endpoint in main.py - deliberately not folded
    # into update_ticket, which is staff-only).
    contact_phone = Column(String, nullable=True)
    # Set by staff, not the requester - unlike contact_phone above, this is
    # folded into the existing staff-only PATCH /tickets/{id} rather than
    # getting its own broader-permission endpoint, since only a
    # technician/admin taking a request over the phone/in person actually
    # has this to report. Null means "requester filed this online
    # themselves" - the default, common case, not a 4th enum value.
    intake_channel = Column(Enum(IntakeChannel), nullable=True)

    requester = relationship("User", back_populates="tickets_submitted", foreign_keys=[requester_id])
    technician = relationship("User", back_populates="tickets_assigned", foreign_keys=[tech_id])
    affected_user = relationship("User", foreign_keys=[affected_user_id])
    clinic_site = relationship("ClinicSite", foreign_keys=[clinic_site_id])
    asset = relationship("Asset", back_populates="tickets")


# --- Employee IT Onboarding (HR-initiated) ---
# See docs/employee-onboarding-prd.md for the full design. An HR Assistant
# submits a batch of new hires; each candidate gets a child Ticket (for
# visibility in the existing ticket queue/reporting) and a fixed set of
# OnboardingTasks that unblock in stages as IT/EHR work completes.

class OnboardingBatchStatus(str, enum.Enum):
    submitted = "submitted"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"

# Mirrors this candidate's overall progress - recomputed from its tasks
# (see main.py's _recompute_candidate_stage) rather than hand-set, so it
# never drifts out of sync with the actual task checklist.
class OnboardingStage(str, enum.Enum):
    it_identity = "it_identity"
    ehr_provisioning = "ehr_provisioning"
    clinical_training = "clinical_training"
    ready = "ready"

class OnboardingTaskStatus(str, enum.Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"

# Who a task is meant for - a coarser grouping than a specific technician
# (assigned_user_id below), used for routing/filtering task queues (e.g. an
# EHR admin filtering to just EHR_ADMIN tasks) before anyone claims one.
class OnboardingAssignedRole(str, enum.Enum):
    it_infrastructure = "IT_INFRASTRUCTURE"
    ehr_admin = "EHR_ADMIN"
    clinical_trainer = "CLINICAL_TRAINER"
    dental_trainer = "DENTAL_TRAINER"


# Admin-managed job title -> department/workstation defaults, same CRUD
# shape as Category. NOT a foreign key target for OnboardingCandidate.job_title
# (same point-in-time reasoning as Ticket.category) - a candidate keeps
# whatever title/department applied when the batch was submitted even if
# this entry is later renamed or removed.
class OnboardingJobTitle(Base):
    __tablename__ = "onboarding_job_titles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, unique=True, index=True)
    # Free text, validated against a small constant list in schemas.py
    # (schemas.ONBOARDING_DEPARTMENTS) rather than its own Postgres enum -
    # this list is realistically going to grow/change (new clinic
    # departments), and a native enum type needs an explicit ALTER TYPE
    # migration for every addition (see the intake_channel migration's
    # comment for how much friction that is on an *existing* column).
    department = Column(String)
    default_workstation_type = Column(String, nullable=True)


# Config-driven notification routing (per the "who gets notified" decision -
# admin-managed, not hardcoded) - who hears about a given onboarding event.
# `department` nullable = applies regardless of department; set (e.g.
# "Dental") = only CC'd/notified when the candidate's department matches.
class OnboardingNotificationRecipient(Base):
    __tablename__ = "onboarding_notification_recipients"

    id = Column(Integer, primary_key=True, index=True)
    # Validated against schemas.ONBOARDING_NOTIFICATION_TRIGGERS -
    # "batch_submitted" (new batch came in) or "stage1_complete" (IT
    # identity/email created, EHR + Paychex teams can proceed).
    trigger = Column(String, index=True)
    department = Column(String, nullable=True)
    recipient_name = Column(String)
    recipient_email = Column(String)
    # True = CC'd, False = primary "To" recipient - mirrors the spec's
    # distinction between Davis/Jamari (To) and Margaret/Candace/Shanika
    # (CC) on the batch-submitted notification.
    cc = Column(Boolean, default=False, nullable=False)


class OnboardingBatch(Base):
    __tablename__ = "onboarding_batches"

    id = Column(Integer, primary_key=True, index=True)
    submitted_by_user_id = Column(Integer, ForeignKey("users.id"))
    submitted_at = Column(DateTime, default=datetime.utcnow)
    status = Column(Enum(OnboardingBatchStatus), default=OnboardingBatchStatus.submitted, nullable=False)
    notes = Column(String, nullable=True)
    # The "[BATCH-YYYY-MM-DD]" master ticket - a real Ticket row so it shows
    # up in the existing ticket queue/reporting rather than living in a
    # parallel, invisible system. Nullable only so batch creation can create
    # the batch row, then the ticket (which needs the batch id in its
    # title), then link back - never left null once creation completes.
    master_ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)

    submitted_by = relationship("User", foreign_keys=[submitted_by_user_id])
    master_ticket = relationship("Ticket", foreign_keys=[master_ticket_id])
    candidates = relationship("OnboardingCandidate", back_populates="batch", order_by="OnboardingCandidate.id")


class OnboardingCandidate(Base):
    __tablename__ = "onboarding_candidates"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("onboarding_batches.id"))
    first_name = Column(String)
    middle_name = Column(String, nullable=True)
    last_name = Column(String)
    # Point-in-time copies of the OnboardingJobTitle entry chosen at submit
    # time (see that model's docstring) - not FKs.
    job_title = Column(String)
    department = Column(String)
    clinic_site_id = Column(Integer, ForeignKey("clinic_sites.id"), nullable=True)
    start_date = Column(DateTime)
    is_rehire = Column(Boolean, default=False, nullable=False)
    # dedicated_desktop / laptop / shared_workstation - validated against
    # schemas.ONBOARDING_WORKSTATION_TYPES, same free-text-not-enum
    # reasoning as department above.
    workstation_type = Column(String)
    # Dental-only conditional fields (see schemas.OnboardingCandidateCreate)
    # - null for every non-Dental candidate, not just False, so "not
    # applicable" stays distinguishable from "asked and declined".
    requires_dexis = Column(Boolean, nullable=True)
    requires_fastattach = Column(Boolean, nullable=True)
    workstation_suite = Column(String, nullable=True)
    # Set once by POST /onboarding/candidates/{id}/complete-stage1 - the
    # generated temp password is deliberately NOT stored anywhere (shown
    # once in that endpoint's response for the technician to hand off, then
    # gone) - see that endpoint's docstring.
    assigned_email = Column(String, nullable=True)
    stage = Column(Enum(OnboardingStage), default=OnboardingStage.it_identity, nullable=False)
    child_ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)

    batch = relationship("OnboardingBatch", back_populates="candidates")
    clinic_site = relationship("ClinicSite", foreign_keys=[clinic_site_id])
    child_ticket = relationship("Ticket", foreign_keys=[child_ticket_id])
    tasks = relationship("OnboardingTask", back_populates="candidate", order_by="OnboardingTask.id")


class OnboardingTask(Base):
    __tablename__ = "onboarding_tasks"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(Integer, ForeignKey("onboarding_candidates.id"))
    task_name = Column(String)
    assigned_role = Column(Enum(OnboardingAssignedRole))
    assigned_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # True until depends_on_task_id (if any) is completed - a blocked task
    # is visible (so people can see what's coming) but not actionable yet.
    is_blocked = Column(Boolean, default=False, nullable=False)
    depends_on_task_id = Column(Integer, ForeignKey("onboarding_tasks.id"), nullable=True)
    status = Column(Enum(OnboardingTaskStatus), default=OnboardingTaskStatus.pending, nullable=False)
    completed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    completed_at = Column(DateTime, nullable=True)
    # True only for the one "Windows Domain, Server Access, Email & Okta
    # Created" task per candidate - marks which task's completion is meant
    # to happen via POST /onboarding/candidates/{id}/complete-stage1 (the
    # credential-generation + stakeholder-notify handoff) rather than a
    # plain PATCH, so the frontend knows which task gets the special button.
    triggers_stage1_handoff = Column(Boolean, default=False, nullable=False)

    candidate = relationship("OnboardingCandidate", back_populates="tasks")
    assigned_user = relationship("User", foreign_keys=[assigned_user_id])
    completed_by = relationship("User", foreign_keys=[completed_by_user_id])
    depends_on = relationship("OnboardingTask", remote_side=[id])
