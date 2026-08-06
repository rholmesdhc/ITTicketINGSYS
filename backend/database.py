import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Falls back to the local dev database when DATABASE_URL isn't set.
# Set DATABASE_URL in the environment (e.g. via .env.uat) for UAT/prod.
SQLALCHEMY_DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://rholmes:R!sc1969@localhost:5432/it_helpdesk2"
)

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
