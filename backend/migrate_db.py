from database import engine, SessionLocal
import models
from sqlalchemy import text

def migrate():
    # First, let SQLAlchemy create any new tables like clinic_sites
    models.Base.metadata.create_all(bind=engine)
    print("Ensured all tables exist.")

    db = SessionLocal()
    try:
        # Check if columns exist and add them if not
        # PostgreSQL syntax for adding columns safely
        alter_statements = [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR;",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR;",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS mi VARCHAR;",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR;",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR;",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS clinic_site_id INTEGER;",
        ]
        
        for stmt in alter_statements:
            db.execute(text(stmt))
        
        db.commit()
        print("Successfully added new columns to the users table.")
        
        # Add foreign key constraint safely
        # Note: 'IF NOT EXISTS' for constraints isn't standard in all Postgres versions like it is for columns,
        # but we can try wrapping it in a DO block if needed. A simple way in PG is checking information_schema or just ignoring the error.
        fk_check_stmt = """
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name='users' AND constraint_type='FOREIGN KEY' AND constraint_name='fk_users_clinic_site_id';
        """
        result = db.execute(text(fk_check_stmt)).fetchone()
        if not result:
            db.execute(text("ALTER TABLE users ADD CONSTRAINT fk_users_clinic_site_id FOREIGN KEY (clinic_site_id) REFERENCES clinic_sites (id);"))
            db.commit()
            print("Successfully added foreign key constraint for clinic_site_id.")
            
        # Add unique constraint for email
        unique_check_stmt = """
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name='users' AND constraint_type='UNIQUE' AND constraint_name='uq_users_email';
        """
        result = db.execute(text(unique_check_stmt)).fetchone()
        if not result:
            db.execute(text("ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);"))
            db.commit()
            print("Successfully added unique constraint for email.")

    except Exception as e:
        print(f"Error during migration: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    migrate()
