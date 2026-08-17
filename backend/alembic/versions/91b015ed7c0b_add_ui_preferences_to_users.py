"""add ui_preferences to users

Revision ID: 91b015ed7c0b
Revises: e7da89826c99
Create Date: 2026-08-17 12:17:26.703799

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '91b015ed7c0b'
down_revision: Union[str, Sequence[str], None] = 'e7da89826c99'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Flat per-user JSON blob for frontend UI state (theme, dashboard
    # collapse states) - a single shallow-merge column rather than a
    # migration per toggle, since the backend never needs to validate or
    # query individual keys (see main.py's GET/PATCH /users/me/preferences).
    op.add_column('users', sa.Column('ui_preferences', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'ui_preferences')
