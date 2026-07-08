"""
database.py — Async MongoDB connection via Motor
"""

import os
import logging
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME     = os.getenv("MONGODB_DB", "process_improvement_agent")

_client: AsyncIOMotorClient = None


async def connect():
    global _client
    _client = AsyncIOMotorClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
    await _client.admin.command("ping")   # raises if unreachable
    logger.info("MongoDB connected: %s / %s", MONGODB_URI, DB_NAME)


async def disconnect():
    global _client
    if _client:
        _client.close()
        _client = None
        logger.info("MongoDB disconnected")


def get_db() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("MongoDB not connected — did startup fail?")
    return _client[DB_NAME]
