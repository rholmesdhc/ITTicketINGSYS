"""add categories table

Revision ID: 127af6c71497
Revises: 91b015ed7c0b
Create Date: 2026-08-17 14:03:08.304671

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '127af6c71497'
down_revision: Union[str, Sequence[str], None] = '91b015ed7c0b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'categories',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )
    op.create_index(op.f('ix_categories_id'), 'categories', ['id'], unique=False)
    op.create_index(op.f('ix_categories_name'), 'categories', ['name'], unique=True)

    # Seed the categories that were previously a hardcoded Python list
    # (TICKET_CATEGORIES in schemas.py) - literal values, not imported from
    # app code, since migrations should stay self-contained as the app
    # continues to evolve after this migration is written.
    op.execute("""
        INSERT INTO categories (name) VALUES
            ('Hardware/Workstation'),
            ('Software'),
            ('EHR/NextGen'),
            ('Network/Connectivity'),
            ('Telecom')
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_categories_name'), table_name='categories')
    op.drop_index(op.f('ix_categories_id'), table_name='categories')
    op.drop_table('categories')
