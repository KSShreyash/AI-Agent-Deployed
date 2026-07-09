"""
recover_manager.py — Emergency manager account recovery
Run this when all manager accounts have been deleted.

Usage:
    python recover_manager.py

You can optionally set custom credentials:
    python recover_manager.py --email you@company.com --password MyPass123 --name "Your Name"
"""
import asyncio
import sys
import os
import argparse
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# ── patch sys.path so we can import auth.py from same folder ─────────────────
sys.path.insert(0, os.path.dirname(__file__))
import auth as auth_module

async def recover(email: str, password: str, name: str):
    from motor.motor_asyncio import AsyncIOMotorClient

    uri     = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    db_name = os.getenv("MONGODB_DB", "process_improvement_agent")

    print(f"\nConnecting to MongoDB at {uri} …")
    client   = AsyncIOMotorClient(uri)
    database = client[db_name]

    # 1. Check if this email already exists
    existing = await database.users.find_one({"email": email.lower().strip()})
    if existing:
        role = existing.get("role", "unknown")
        print(f"User '{email}' already exists with role: {role}")
        if role != "manager":
            await database.users.update_one(
                {"email": email.lower().strip()},
                {"$set": {"role": "manager", "is_active": True}},
            )
            print(f"  → Promoted to Manager and re-activated.")
        else:
            # Reset password in case they forgot it
            await database.users.update_one(
                {"email": email.lower().strip()},
                {"$set": {
                    "password_hash": auth_module.hash_password(password),
                    "is_active": True,
                }},
            )
            print(f"  → Manager already exists. Password has been reset.")
        client.close()
        return

    # 2. Count existing managers
    mgr_count = await database.users.count_documents({"role": "manager"})
    if mgr_count > 0:
        print(f"\nFound {mgr_count} existing manager(s) in the database.")
        print("If you cannot log in, the issue might be a wrong password.")
        print("Try: python recover_manager.py --email <existing_manager_email>")
        # Still create the new one
        print("Creating additional manager account anyway …\n")

    # 3. Insert new manager
    doc = {
        "name":          name,
        "email":         email.lower().strip(),
        "password_hash": auth_module.hash_password(password),
        "role":          "manager",
        "department":    "Administration",
        "job_role":      "System Administrator",
        "is_active":     True,
        "auth_provider": "local",
        "created_at":    datetime.now(timezone.utc).isoformat(),
        "created_by":    "recover_manager.py",
    }
    await database.users.insert_one(doc)
    print(f"\n  Manager account created successfully!")
    client.close()


def main():
    parser = argparse.ArgumentParser(description="Emergency manager account recovery")
    parser.add_argument("--email",    default=os.getenv("DEFAULT_MANAGER_EMAIL", "admin@yolexlabs.com"))
    parser.add_argument("--password", default=os.getenv("DEFAULT_MANAGER_PASSWORD", "Admin@1234"))
    parser.add_argument("--name",     default="Admin")
    args = parser.parse_args()

    print("=" * 55)
    print("  Process Improvement Agent — Manager Recovery")
    print("=" * 55)
    asyncio.run(recover(args.email, args.password, args.name))
    print("\n  You can now log in at /app with:")
    print(f"    Email   : {args.email}")
    print(f"    Password: {args.password}")
    print("\n  Change your password after logging in.\n")


if __name__ == "__main__":
    main()
