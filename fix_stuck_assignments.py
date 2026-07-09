"""
fix_stuck_assignments.py
One-time script: finds assignments that are still "pending" or "in_progress"
but have a matching report saved — and marks them completed.

Usage (local):   python fix_stuck_assignments.py
Usage (Atlas):   python fix_stuck_assignments.py --uri "mongodb+srv://..."
"""
import argparse, os, re, sys
from dotenv import load_dotenv
load_dotenv()

from pymongo import MongoClient
from datetime import datetime, timezone

parser = argparse.ArgumentParser()
parser.add_argument("--uri", default=os.getenv("MONGODB_URI", "mongodb://localhost:27017"))
parser.add_argument("--db",  default=os.getenv("MONGODB_DB",  "process_improvement_agent"))
args = parser.parse_args()

print(f"\nConnecting to: {args.uri[:50]}...")
client   = MongoClient(args.uri, serverSelectionTimeoutMS=10000)
database = client[args.db]
database.command("ping")
print("Connected.\n")

# Get all reports
reports = list(database.reports.find({}, {"report_id":1,"submitted_by":1,"candidate_name":1,"timestamp":1}))
print(f"Found {len(reports)} total reports.")

fixed = 0
for r in reports:
    email = r.get("submitted_by", "").lower().strip()
    rid   = r.get("report_id", "")
    if not email or not rid:
        continue

    # Find matching pending assignment
    assign = database.assignments.find_one(
        {
            "status": {"$in": ["pending", "in_progress"]},
            "$or": [
                {"candidate_email": email},
                {"candidate_email": email.lower()},
            ],
        },
        sort=[("created_at", -1)],
    )
    if assign:
        database.assignments.update_one(
            {"_id": assign["_id"]},
            {"$set": {
                "status":       "completed",
                "report_id":    rid,
                "completed_at": r.get("timestamp", datetime.now(timezone.utc).isoformat()),
            }},
        )
        print(f"  Fixed: {email} -> assignment {assign.get('_id')} marked completed (report: {rid})")
        fixed += 1

print(f"\nDone. Fixed {fixed} stuck assignment(s).")
client.close()
