import csv
import os
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import SessionLocal
import models
import auth

CSV_FILE_PATH = os.path.join(os.path.dirname(__file__), "data", "DHC_Employees_2.csv")

CLINIC_SITES = [
    "Cleveland", "Searcy", "Indianola", "Greenville South", 
    "Greenville Central", "Moorhead", "MVSU / Mississippi Valley State University", 
    "Rosedale", "Rolling Fork", "Mound Bayou"
]

def seed_users():
    db: Session = SessionLocal()
    try:
        # 1. Create the ClinicSite entries
        print("Ensuring clinic sites exist...")
        site_map = {}
        for site_name in CLINIC_SITES:
            site = db.query(models.ClinicSite).filter(models.ClinicSite.name == site_name).first()
            if not site:
                site = models.ClinicSite(name=site_name)
                db.add(site)
                db.commit()
                db.refresh(site)
            site_map[site_name] = site.id
            
        default_site_id = site_map.get("Mound Bayou")

        print("Reading CSV and adding users...")
        with open(CSV_FILE_PATH, mode='r', encoding='utf-8-sig') as file:
            reader = csv.DictReader(file)
            
            users_added = 0
            users_skipped = 0
            
            processed_emails = set()
            processed_usernames = set()
            
            for row in reader:
                email = row.get("email", "").strip()
                given_name = row.get("given_name", "").strip()
                family_name = row.get("family_name", "").strip()
                
                if not email or not given_name or not family_name:
                    continue
                
                # Generate username as (given_name[0] + family_name).lower()
                username = f"{given_name[0]}{family_name}".lower().replace(" ", "")
                
                if email in processed_emails or username in processed_usernames:
                    users_skipped += 1
                    continue
                
                processed_emails.add(email)
                processed_usernames.add(username)
                
                # Check if user already exists. Case-insensitive - a plain
                # == comparison here once let a real account
                # (rholmes@deltahealthcenter.org, JIT-provisioned via
                # Entra login) get silently duplicated by this script,
                # since the CSV's stored casing (rholmes@DeltaHealthCenter.org)
                # didn't byte-match despite being the same address.
                existing_user = db.query(models.User).filter(
                    (func.lower(models.User.email) == email.lower()) |
                    (func.lower(models.User.username) == username.lower())
                ).first()
                
                if existing_user:
                    users_skipped += 1
                    continue
                
                # Create new user
                hashed_pw = auth.get_password_hash("Changeme123!")
                new_user = models.User(
                    username=username,
                    hashed_password=hashed_pw,
                    role=models.RoleEnum.requester,
                    first_name=given_name,
                    last_name=family_name,
                    email=email,
                    clinic_site_id=default_site_id
                )
                db.add(new_user)
                users_added += 1
                
            db.commit()
            print(f"Successfully added {users_added} users. Skipped {users_skipped} existing users.")
            
    except Exception as e:
        print(f"An error occurred: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    print("Starting user import from CSV...")
    seed_users()
