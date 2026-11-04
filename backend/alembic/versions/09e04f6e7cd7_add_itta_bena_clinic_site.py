"""add itta bena clinic site

Revision ID: 09e04f6e7cd7
Revises: 13235b6e6c4b
Create Date: 2026-11-04 10:47:33.741268

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '09e04f6e7cd7'
down_revision: Union[str, Sequence[str], None] = '13235b6e6c4b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ON CONFLICT DO NOTHING - clinic_sites.name is unique, and this stays
    # safe to re-run if the site was ever added by hand ahead of this
    # migration landing.
    op.execute("""
        INSERT INTO clinic_sites (name) VALUES ('Itta Bena')
        ON CONFLICT (name) DO NOTHING
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM clinic_sites WHERE name = 'Itta Bena'")
