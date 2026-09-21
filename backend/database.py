import os
import urllib.parse
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# -------------------------------------------------------------
# BLOCK 1: Load Environment Variables
# -------------------------------------------------------------
# Resolve .env path relative to this backend file, and fallback to root
env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(env_path):
    load_dotenv(env_path)
load_dotenv()

def get_safe_db_url(url: str) -> str:
    """
    Safely encodes special characters (like '@') in the password portion
    of a postgres connection string to prevent host resolution errors.
    """
    if not url:
        return url
    try:
        if url.count('@') > 1 and '://' in url:
            prefix, remainder = url.split('://', 1)
            last_at_index = remainder.rfind('@')
            credentials = remainder[:last_at_index]
            host_and_path = remainder[last_at_index + 1:]
            if ':' in credentials:
                user, pwd = credentials.split(':', 1)
                safe_pwd = urllib.parse.quote_plus(pwd)
                return f"{prefix}://{user}:{safe_pwd}@{host_and_path}"
    except Exception:
        pass
    return url

DATABASE_URL = get_safe_db_url(os.getenv("DATABASE_URL"))


# -------------------------------------------------------------
# BLOCK 2: Database Connection Function
# -------------------------------------------------------------
# This function opens a connection to the PostgreSQL database.
# We pass cursor_factory=RealDictCursor so that query results
# are returned as Python dictionaries (e.g. row['role_title'])
# instead of plain tuples (e.g. row[1]).
def get_db_connection():
    """
    Establishes and returns a connection to the PostgreSQL database.
    Remember to close the connection once the query is completed.
    """
    # Re-check env in case it was updated during runtime
    env_file = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_file):
        load_dotenv(env_file)
    load_dotenv()

    db_url = get_safe_db_url(os.getenv("DATABASE_URL") or DATABASE_URL)
    if not db_url:
        raise ValueError("DATABASE_URL is not set in backend/.env file.")
    
    conn = psycopg2.connect(db_url, cursor_factory=RealDictCursor)
    return conn


# -------------------------------------------------------------
# BLOCK 3: Database Connection Test Function
# -------------------------------------------------------------
# Used during server startup to verify that PostgreSQL is running
# and the credentials (password/port) are working correctly.
def test_db_connection():
    """
    Tests if PostgreSQL is reachable and prints the database version.
    """
    try:
        conn = get_db_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT version();")
            db_version = cur.fetchone()
            print(f"[DB CONNECTED] PostgreSQL Version: {db_version['version']}")
        conn.close()
        return True
    except Exception as error:
        print(f"[DB ERROR] Could not connect to PostgreSQL: {error}")
        return False
