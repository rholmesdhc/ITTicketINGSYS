"""add intake_channel to tickets

Revision ID: 33a60cdb2dae
Revises: a2ded8fbae24
Create Date: 2026-09-14 15:34:58.872621

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '33a60cdb2dae'
down_revision: Union[str, Sequence[str], None] = 'a2ded8fbae24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Autogenerate also picked up unrelated constraint/index drift
    # (categories_name_key, uq_users_email, uq_users_entra_object_id) that
    # predates this change and isn't part of it - trimmed out, same as the
    # contact_phone migration before this one.
    #
    # Postgres needs the enum TYPE created explicitly before a column can
    # use it - op.add_column doesn't emit CREATE TYPE on its own the way
    # create_table does for a brand-new table. Skipped straight to
    # `sa.Enum(...)` inline in add_column the first time this ran and hit
    # "type intakechannel does not exist" - .create() below is the fix.
    intake_channel_enum = sa.Enum('call', 'email', 'in_person', name='intakechannel')
    intake_channel_enum.create(op.get_bind(), checkfirst=True)
    op.add_column('tickets', sa.Column('intake_channel', intake_channel_enum, nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tickets', 'intake_channel')
    sa.Enum(name='intakechannel').drop(op.get_bind(), checkfirst=True)
