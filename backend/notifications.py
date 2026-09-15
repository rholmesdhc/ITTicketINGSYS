"""
Ticket email content. Every build_* function here is pure (no I/O) - it
returns (to_email, subject, html_body, text_body) computed while the
request's DB session is still open, so the caller can safely hand the
actual network send off to a background task (see main.py) without
touching any SQLAlchemy object after the session closes.

The `recipient` param on most of these isn't always the ticket's
requester - main.py also calls the same builders for the affected
employee (item: "whenever a ticket is filed/updated on someone else's
behalf, they should hear about it too, not just whoever's logged-in
account did the filing"). The content reads fine addressed to either -
"your ticket" is natural for someone the issue actually concerns, filed
by them or not.
"""
import models

# Matches --color-medical-blue in frontend/src/app/globals.css, so
# notification emails read as the same app rather than a generic system
# message.
ACCENT = "#0284c7"

STATUS_LABELS = {"open": "Open", "in_progress": "In Progress", "resolved": "Resolved"}


def _display_name(user: models.User) -> str:
    name = " ".join(filter(None, [user.first_name, user.last_name]))
    return name or user.username


def _priority_value(ticket: models.Ticket) -> str:
    # ticket.priority is a `class PriorityTier(str, Enum)` column - Enum
    # overrides __str__/__format__ even on a str mixin, so an f-string
    # would render "PriorityTier.P4" instead of "P4" without pulling
    # .value explicitly.
    return ticket.priority.value if hasattr(ticket.priority, "value") else ticket.priority


def _ticket_url(ticket_id: int) -> str:
    from mailer import FRONTEND_BASE_URL
    return f"{FRONTEND_BASE_URL}/tickets/{ticket_id}"


def _wrap_html(heading: str, body_html: str, ticket_id: int) -> str:
    url = _ticket_url(ticket_id)
    return f"""
    <div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: {ACCENT}; color: #ffffff; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <strong style="font-size: 18px;">IT Helpdesk Portal</strong>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <h2 style="margin-top: 0; color: #1e293b;">{heading}</h2>
        {body_html}
        <a href="{url}" style="display: inline-block; margin-top: 20px; background: {ACCENT}; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600;">View Ticket #{ticket_id}</a>
      </div>
      <p style="color: #94a3b8; font-size: 12px; margin-top: 16px;">
        This is an automated message from the Delta Health Center IT Helpdesk Portal. Please don't reply directly to this email.
      </p>
    </div>
    """


def build_ticket_created(ticket: models.Ticket, requester: models.User):
    priority = _priority_value(ticket)
    subject = f"Ticket #{ticket.id} received: {ticket.title}"
    body_html = f"""
      <p>Hi {_display_name(requester)},</p>
      <p>We've received your support ticket and it's now in our queue.</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding:4px 0; color:#64748b;">Priority</td><td style="padding:4px 0; font-weight:600; color:#1e293b;">{priority}</td></tr>
        <tr><td style="padding:4px 0; color:#64748b;">Category</td><td style="padding:4px 0; font-weight:600; color:#1e293b;">{ticket.category}</td></tr>
      </table>
    """
    text_body = (
        f"Hi {_display_name(requester)},\n\n"
        f"We've received your ticket #{ticket.id}: {ticket.title}\n"
        f"Priority: {priority}\nCategory: {ticket.category}\n\n"
        f"Track it here: {_ticket_url(ticket.id)}"
    )
    return requester.email, subject, _wrap_html("Ticket Received", body_html, ticket.id), text_body


def build_ticket_created_for_affected(ticket: models.Ticket, affected_user: models.User, filed_by: models.User):
    # Distinct from build_ticket_created above - "we've received YOUR
    # ticket" reads wrong for someone who didn't file it themselves. Only
    # used when affected_user_id is set to someone other than whoever's
    # logged in (see main.py) - filing a ticket for yourself never
    # triggers this.
    priority = _priority_value(ticket)
    filer_name = _display_name(filed_by)
    subject = f"A ticket was filed for you: #{ticket.id} - {ticket.title}"
    body_html = f"""
      <p>Hi {_display_name(affected_user)},</p>
      <p><strong>{filer_name}</strong> filed a support ticket on your behalf, and it's now in our queue.</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding:4px 0; color:#64748b;">Priority</td><td style="padding:4px 0; font-weight:600; color:#1e293b;">{priority}</td></tr>
        <tr><td style="padding:4px 0; color:#64748b;">Category</td><td style="padding:4px 0; font-weight:600; color:#1e293b;">{ticket.category}</td></tr>
      </table>
    """
    text_body = (
        f"Hi {_display_name(affected_user)},\n\n"
        f"{filer_name} filed ticket #{ticket.id} on your behalf: {ticket.title}\n"
        f"Priority: {priority}\nCategory: {ticket.category}\n\n"
        f"Track it here: {_ticket_url(ticket.id)}"
    )
    return affected_user.email, subject, _wrap_html("Ticket Filed On Your Behalf", body_html, ticket.id), text_body


def build_ticket_assigned(ticket: models.Ticket, recipient: models.User, technician: models.User):
    tech_name = _display_name(technician)
    subject = f"Ticket #{ticket.id} assigned to {tech_name}"
    body_html = f"""
      <p>Hi {_display_name(recipient)},</p>
      <p><strong>{tech_name}</strong> has picked up your ticket and is working on it.</p>
    """
    text_body = (
        f"Hi {_display_name(recipient)},\n\n"
        f"{tech_name} has picked up your ticket #{ticket.id} and is working on it.\n\n"
        f"Track it here: {_ticket_url(ticket.id)}"
    )
    return recipient.email, subject, _wrap_html("Ticket Assigned", body_html, ticket.id), text_body


def build_status_changed(ticket: models.Ticket, recipient: models.User, new_status: str):
    label = STATUS_LABELS.get(new_status, new_status)
    subject = f"Ticket #{ticket.id} is now {label}"
    # Surfaces what was actually done, not just that the status flipped -
    # ticket.resolution is a separate field from technician_note (see
    # models.py), entered specifically when resolving.
    resolution_html = ""
    resolution_text = ""
    if new_status == "resolved" and ticket.resolution:
        resolution_html = f'<div style="background:#f0fdf4; border-left:4px solid #10b981; padding:12px 16px; margin:12px 0; color:#1e293b; white-space:pre-wrap;"><strong>Resolution:</strong> {ticket.resolution}</div>'
        resolution_text = f"\n\nResolution: {ticket.resolution}"
    reopen_note = (
        "<p>If this doesn't actually fix the issue, you can reopen it directly from the ticket page.</p>"
        if new_status == "resolved" else ""
    )
    body_html = f"""
      <p>Hi {_display_name(recipient)},</p>
      <p>Your ticket status changed to <strong>{label}</strong>.</p>
      {resolution_html}
      {reopen_note}
    """
    text_body = (
        f"Hi {_display_name(recipient)},\n\n"
        f"Your ticket #{ticket.id} status changed to {label}.{resolution_text}\n\n"
        f"Track it here: {_ticket_url(ticket.id)}"
    )
    return recipient.email, subject, _wrap_html("Status Update", body_html, ticket.id), text_body


def _onboarding_wrap_html(heading: str, body_html: str, url: str) -> str:
    # Same visual shell as _wrap_html above, but linking to an /onboarding
    # batch instead of a ticket - onboarding notifications go to configured
    # OnboardingNotificationRecipient rows (a name + email, not a
    # models.User), so there's no ticket id to build the CTA link from.
    return f"""
    <div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: {ACCENT}; color: #ffffff; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <strong style="font-size: 18px;">IT Helpdesk Portal</strong>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <h2 style="margin-top: 0; color: #1e293b;">{heading}</h2>
        {body_html}
        <a href="{url}" style="display: inline-block; margin-top: 20px; background: {ACCENT}; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600;">View Onboarding Request</a>
      </div>
      <p style="color: #94a3b8; font-size: 12px; margin-top: 16px;">
        This is an automated message from the Delta Health Center IT Helpdesk Portal. Please don't reply directly to this email.
      </p>
    </div>
    """


def _onboarding_batch_url(batch_id: int) -> str:
    from mailer import FRONTEND_BASE_URL
    return f"{FRONTEND_BASE_URL}/onboarding/{batch_id}"


def build_onboarding_batch_submitted(recipient_name: str, recipient_email: str, batch: "models.OnboardingBatch", submitted_by: models.User):
    candidate_rows = "".join(
        f'<tr><td style="padding:4px 8px 4px 0; color:#1e293b;">{c.first_name} {c.last_name}</td>'
        f'<td style="padding:4px 8px; color:#64748b;">{c.job_title}</td>'
        f'<td style="padding:4px 0; color:#64748b;">{c.department} · {c.start_date.strftime("%b %d, %Y")}</td></tr>'
        for c in batch.candidates
    )
    subject = f"New Hire Onboarding: {len(batch.candidates)} candidate(s) submitted by {_display_name(submitted_by)}"
    body_html = f"""
      <p>Hi {recipient_name},</p>
      <p><strong>{_display_name(submitted_by)}</strong> submitted a new onboarding batch with {len(batch.candidates)} candidate(s):</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">{candidate_rows}</table>
      <p>Stage 1 IT setup (Windows Domain, Server Access, Email &amp; Okta) is now queued.</p>
    """
    text_lines = "\n".join(f"- {c.first_name} {c.last_name} ({c.job_title}, {c.department})" for c in batch.candidates)
    text_body = (
        f"Hi {recipient_name},\n\n"
        f"{_display_name(submitted_by)} submitted a new onboarding batch with {len(batch.candidates)} candidate(s):\n\n"
        f"{text_lines}\n\n"
        f"Stage 1 IT setup is now queued. Details: {_onboarding_batch_url(batch.id)}"
    )
    return recipient_email, subject, _onboarding_wrap_html("New Onboarding Batch Submitted", body_html, _onboarding_batch_url(batch.id)), text_body


def build_onboarding_stage1_complete(recipient_name: str, recipient_email: str, candidate: "models.OnboardingCandidate", completed_by: models.User):
    # Deliberately does NOT include the generated temp password - a
    # downstream provisioning team (Paychex/NextGen operators) needs to
    # know the account/email now exists, not the AD credential itself, and
    # emailing a password in plaintext is exactly the anti-pattern the
    # "never persist it" decision was meant to avoid extending into transit.
    full_name = f"{candidate.first_name} {candidate.last_name}"
    subject = f"IT Identity Ready: {full_name} - proceed with your provisioning step"
    body_html = f"""
      <p>Hi {recipient_name},</p>
      <p><strong>{_display_name(completed_by)}</strong> completed Stage 1 IT setup for <strong>{full_name}</strong> ({candidate.job_title}, {candidate.department}).</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr><td style="padding:4px 0; color:#64748b;">Assigned Email</td><td style="padding:4px 0; font-weight:600; color:#1e293b;">{candidate.assigned_email}</td></tr>
        <tr><td style="padding:4px 0; color:#64748b;">Start Date</td><td style="padding:4px 0; font-weight:600; color:#1e293b;">{candidate.start_date.strftime("%b %d, %Y")}</td></tr>
        <tr><td style="padding:4px 0; color:#64748b;">Rehire</td><td style="padding:4px 0; font-weight:600; color:#1e293b;">{"Yes" if candidate.is_rehire else "No"}</td></tr>
      </table>
      <p>You can proceed with your part of onboarding for this employee.</p>
    """
    text_body = (
        f"Hi {recipient_name},\n\n"
        f"{_display_name(completed_by)} completed Stage 1 IT setup for {full_name} ({candidate.job_title}, {candidate.department}).\n"
        f"Assigned Email: {candidate.assigned_email}\nStart Date: {candidate.start_date.strftime('%b %d, %Y')}\nRehire: {'Yes' if candidate.is_rehire else 'No'}\n\n"
        f"You can proceed with your part of onboarding for this employee.\n"
        f"Details: {_onboarding_batch_url(candidate.batch_id)}"
    )
    return recipient_email, subject, _onboarding_wrap_html("IT Identity Ready", body_html, _onboarding_batch_url(candidate.batch_id)), text_body


def build_technician_note(ticket: models.Ticket, recipient: models.User, note: str):
    subject = f"New update on Ticket #{ticket.id}"
    body_html = f"""
      <p>Hi {_display_name(recipient)},</p>
      <p>Your technician left a note on your ticket:</p>
      <div style="background:#f0f9ff; border-left:4px solid {ACCENT}; padding:12px 16px; margin:12px 0; color:#1e293b; white-space:pre-wrap;">{note}</div>
    """
    text_body = (
        f"Hi {_display_name(recipient)},\n\n"
        f"Your technician left a note on ticket #{ticket.id}:\n\n{note}\n\n"
        f"Track it here: {_ticket_url(ticket.id)}"
    )
    return recipient.email, subject, _wrap_html("Technician Note", body_html, ticket.id), text_body
