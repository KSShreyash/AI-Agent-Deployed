"""
Emergency manager recovery for production (MongoDB Atlas / Railway).

Run locally with your Atlas connection string:
    python _fix_manager.py --uri "mongodb+srv://user:pass@cluster.mongodb.net/" --email you@company.com --password NewPass123
"""
from dotenv import load_dotenv
load_dotenv()
import os, sys, argparse
sys.path.insert(0, os.path.dirname(__file__))
import auth as auth_module
from pymongo import MongoClient
from datetime import datetime, timezone

parser = argparse.ArgumentParser()
parser.add_argument("--uri",      default=os.getenv("MONGODB_URI", "mongodb://localhost:27017"),  help="MongoDB connection string")
parser.add_argument("--db",       default=os.getenv("MONGODB_DB",  "process_improvement_agent"),  help="Database name")
parser.add_argument("--email",    default=os.getenv("DEFAULT_MANAGER_EMAIL",    "admin@yolexlabs.com"))
parser.add_argument("--password", default=os.getenv("DEFAULT_MANAGER_PASSWORD", "Admin@1234"))
parser.add_argument("--name",     default="Admin")
args = parser.parse_args()

print("\n=== Manager Recovery ===")
print("Connecting to:", args.uri[:40] + "..." if len(args.uri) > 40 else args.uri)

client   = MongoClient(args.uri, serverSelectionTimeoutMS=10000)
database = client[args.db]

# Test connection
database.command("ping")
print("Connection OK\n")

existing = database.users.find_one({"email": args.email})
set_doc  = {
    "password_hash": auth_module.hash_password(args.password),
    "role":          "manager",
    "is_active":     True,
}

if existing:
    database.users.update_one({"email": args.email}, {"$set": set_doc})
    print("DONE: password reset + manager role confirmed for", args.email)
else:
    set_doc.update({
        "name":          args.name,
        "email":         args.email,
        "department":    "Administration",
        "job_role":      "System Administrator",
        "auth_provider": "local",
        "created_at":    datetime.now(timezone.utc).isoformat(),
        "created_by":    "recovery_script",
    })
    database.users.insert_one(set_doc)
    print("DONE: new manager account created:", args.email)

u = database.users.find_one({"email": args.email}, {"password_hash": 0})
print("Verified -> email:", u["email"], "| role:", u["role"], "| active:", u.get("is_active"))
client.close()

print("\nYou can now log in at your Railway URL /app with:")
print("  Email   :", args.email)
print("  Password:", args.password)
