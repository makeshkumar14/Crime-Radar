import sqlite3

DB_PATH = "crimeradar.db"

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS fir_records (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            district    TEXT NOT NULL,
            state       TEXT DEFAULT 'Tamil Nadu',
            lat         REAL,
            lng         REAL,
            ipc_section TEXT,
            category    TEXT,
            severity    TEXT,
            year        INTEGER,
            month       INTEGER,
            day_of_week INTEGER,
            time_slot   TEXT,
            count       INTEGER DEFAULT 1
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS crime_categories (
            ipc_section TEXT PRIMARY KEY,
            category    TEXT NOT NULL,
            severity    TEXT NOT NULL,
            description TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS hotspot_zones (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            cluster_id  INTEGER,
            center_lat  REAL,
            center_lng  REAL,
            radius_km   REAL,
            risk_level  TEXT,
            risk_score  REAL,
            crime_count INTEGER,
            top_crime   TEXT
        )
    """)

    conn.commit()
    conn.close()
    print("Database initialised successfully")