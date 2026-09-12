"""add scheduled delivery date to orders

Revision ID: b4c8d5e91a2f
Revises: 7dea379d9041
"""

from alembic import op
import sqlalchemy as sa


revision = "b4c8d5e91a2f"
down_revision = "7dea379d9041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("orders")}
    if "delivery_date" not in columns:
        op.add_column("orders", sa.Column("delivery_date", sa.DateTime(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("orders")}
    if "delivery_date" in columns:
        op.drop_column("orders", "delivery_date")
