"""add archived_at and archived_by_user_id to tickets

Revision ID: 13235b6e6c4b
Revises: dc6c60024ada
Create Date: 2026-11-02 17:22:08.982578

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '13235b6e6c4b'
down_revision: Union[str, Sequence[str], None] = 'dc6c60024ada'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate also picked up unrelated constraint/index drift
    # (categories_name_key, uq_users_email/entra_object_id) that predates
    # this change and isn't part of it - trimmed out so this migration does
    # exactly one thing, same as a2ded8fbae24 before it.
    op.add_column('tickets', sa.Column('archived_at', sa.DateTime(), nullable=True))
    op.add_column('tickets', sa.Column('archived_by_user_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_tickets_archived_by_user_id_users', 'tickets', 'users', ['archived_by_user_id'], ['id']
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_tickets_archived_by_user_id_users', 'tickets', type_='foreignkey')
    op.drop_column('tickets', 'archived_by_user_id')
    op.drop_column('tickets', 'archived_at')
