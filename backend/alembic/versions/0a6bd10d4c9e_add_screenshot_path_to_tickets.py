"""add screenshot_path to tickets

Revision ID: 0a6bd10d4c9e
Revises: 127af6c71497
Create Date: 2026-08-31 16:20:26.240987

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a6bd10d4c9e'
down_revision: Union[str, Sequence[str], None] = '127af6c71497'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('tickets', sa.Column('screenshot_path', sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tickets', 'screenshot_path')
