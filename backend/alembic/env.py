import os
import sys
from logging.config import fileConfig

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy import pool

from alembic import context

# alembic invokes env.py with backend/ as the CWD but doesn't add it to
# sys.path itself - needed to import database.py/models.py below.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Loaded here (not just relied on from main.py) because `alembic` is its
# own entry point, run independently of the app - without this, DATABASE_URL
# would silently fall back to database.py's local-dev default instead of
# whatever a real environment (e.g. UAT) actually sets.
load_dotenv()

import models
from database import SQLALCHEMY_DATABASE_URL

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# The same URL the app itself connects with, so there's exactly one source
# of truth for the DB connection instead of a second copy in alembic.ini.
# ALEMBIC_DATABASE_URL is a deliberate escape hatch (not used by the app
# itself) for pointing a one-off `alembic` invocation at a scratch DB/
# schema instead - e.g. generating a migration against an empty schema to
# see the full CREATE TABLE set, without touching the real database.
# Kept out of config.set_main_option()/configparser entirely (rather than
# the more typical Alembic template pattern) because a `%` in a URL-encoded
# query string (e.g. ?options=-csearch_path%3Dfoo) collides with
# configparser's own interpolation syntax.
DB_URL = os.getenv("ALEMBIC_DATABASE_URL", SQLALCHEMY_DATABASE_URL)

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Drives `alembic revision --autogenerate` - it diffs the live DB against
# this metadata to figure out what changed.
target_metadata = models.Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    context.configure(
        url=DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = create_engine(DB_URL, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
