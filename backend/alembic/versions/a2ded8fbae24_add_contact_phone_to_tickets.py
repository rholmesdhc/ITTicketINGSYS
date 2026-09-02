"""add contact_phone to tickets

Revision ID: a2ded8fbae24
Revises: 0a6bd10d4c9e
Create Date: 2026-08-31 17:36:39.127743

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2ded8fbae24'
down_revision: Union[str, Sequence[str], None] = '0a6bd10d4c9e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate also picked up unrelated constraint/index drift
    # (categories_name_key, uq_users_email, uq_users_entra_object_id) that
    # predates this change and isn't part of it - trimmed out so this
    # migration does exactly one thing.
    op.add_column('tickets', sa.Column('contact_phone', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tickets', 'contact_phone')
