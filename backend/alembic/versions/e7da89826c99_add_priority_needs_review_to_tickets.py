"""add priority_needs_review to tickets

Revision ID: e7da89826c99
Revises: c78bbfadac53
Create Date: 2026-08-17 11:06:34.616333

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7da89826c99'
down_revision: Union[str, Sequence[str], None] = 'c78bbfadac53'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Set true whenever a ticket's priority was decided by the AI triage
    # fallback path (service unreachable/timed out/bad response), not a real
    # classification - lets technicians find and double-check these instead
    # of them silently sitting at a possibly-wrong P3. Cleared once a
    # technician/admin sets priority explicitly (see update_ticket).
    op.add_column('tickets', sa.Column('priority_needs_review', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tickets', 'priority_needs_review')
