"""
Requester-facing ticket email content. Every build_* function here is pure
(no I/O) - it returns (to_email, subject, html_body, text_body) computed
while the request's DB session is still open, so the caller can safely
hand the actual network send off to a background task (see main.py) without
touching any SQLAlchemy object after the session closes.
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


def _ticket_url(ticket_id: int) -> str:
    from mailer import FRONTEND_BASE_URL
    return f"{FRONTEND_BASE_URL}/tickets/{ticket_id}"


def _wrap_html(heading: str, body_html: str, ticket_id: int) -> str:
    url = _ticket_url(ticket_id)
    return f"""
    <div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: {ACCENT}; color: #ffffff; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <strong style="font-size: 18px;">Clinical IT Portal</strong>
      </div>
      <div style="border: 1px solid #e2e8f0; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <h2 style="margin-top: 0; color: #1e293b;">{heading}</h2>
        {body_html}
        <a href="{url}" style="display: inline-block; margin-top: 20px; background: {ACCENT}; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600;">View Ticket #{ticket_id}</a>
      </div>
      <p style="color: #94a3b8; font-size: 12px; margin-top: 16px;">
        This is an automated message from the Delta Health Center Clinical IT Portal. Please don't reply directly to this email.
      </p>
    </div>
    """


def build_ticket_created(ticket: models.Ticket, requester: models.User):
    # ticket.priority is a `class PriorityTier(str, Enum)` column - Enum
    # overrides __str__/__format__ even on a str mixin, so an f-string
    # would render "PriorityTier.P4" instead of "P4" without pulling
    # .value explicitly.
    priority = ticket.priority.value if hasattr(ticket.priority, "value") else ticket.priority
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


def build_ticket_assigned(ticket: models.Ticket, requester: models.User, technician: models.User):
    tech_name = _display_name(technician)
    subject = f"Ticket #{ticket.id} assigned to {tech_name}"
    body_html = f"""
      <p>Hi {_display_name(requester)},</p>
      <p><strong>{tech_name}</strong> has picked up your ticket and is working on it.</p>
    """
    text_body = (
        f"Hi {_display_name(requester)},\n\n"
        f"{tech_name} has picked up your ticket #{ticket.id} and is working on it.\n\n"
        f"Track it here: {_ticket_url(ticket.id)}"
    )
    return requester.email, subject, _wrap_html("Ticket Assigned", body_html, ticket.id), text_body


def build_status_changed(ticket: models.Ticket, requester: models.User, new_status: str):
    label = STATUS_LABELS.get(new_status, new_status)
    subject = f"Ticket #{ticket.id} is now {label}"
    reopen_note = (
        "<p>If this doesn't actually fix the issue, you can reopen it directly from the ticket page.</p>"
        if new_status == "resolved" else ""
    )
    body_html = f"""
      <p>Hi {_display_name(requester)},</p>
      <p>Your ticket status changed to <strong>{label}</strong>.</p>
      {reopen_note}
    """
    text_body = (
        f"Hi {_display_name(requester)},\n\n"
        f"Your ticket #{ticket.id} status changed to {label}.\n\n"
        f"Track it here: {_ticket_url(ticket.id)}"
    )
    return requester.email, subject, _wrap_html("Status Update", body_html, ticket.id), text_body


def build_technician_note(ticket: models.Ticket, requester: models.User, note: str):
    subject = f"New update on Ticket #{ticket.id}"
    body_html = f"""
      <p>Hi {_display_name(requester)},</p>
      <p>Your technician left a note on your ticket:</p>
      <div style="background:#f0f9ff; border-left:4px solid {ACCENT}; padding:12px 16px; margin:12px 0; color:#1e293b; white-space:pre-wrap;">{note}</div>
    """
    text_body = (
        f"Hi {_display_name(requester)},\n\n"
        f"Your technician left a note on ticket #{ticket.id}:\n\n{note}\n\n"
        f"Track it here: {_ticket_url(ticket.id)}"
    )
    return requester.email, subject, _wrap_html("Technician Note", body_html, ticket.id), text_body
