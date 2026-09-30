"""add dashboard_theme to app_settings

Revision ID: dc6c60024ada
Revises: b7b2b788e585
Create Date: 2026-09-17 14:26:37.963210

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dc6c60024ada'
down_revision: Union[str, Sequence[str], None] = 'b7b2b788e585'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate also picked up unrelated constraint/index drift
    # (categories_name_key, uq_users_email, uq_users_entra_object_id) that
    # predates this change and isn't part of it - trimmed out, same as
    # every migration before this one.
    #
    # NOT NULL with no server_default would fail outright against the
    # existing single app_settings row (add_column can't backfill a value
    # it doesn't have) - server_default matches the Python-side default in
    # models.py so both a fresh row and this backfilled one agree.
    op.add_column('app_settings', sa.Column('dashboard_theme', sa.String(), nullable=False, server_default='default'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('app_settings', 'dashboard_theme')
