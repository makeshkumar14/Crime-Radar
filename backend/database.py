import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "crimeradar.db"
SCHEMA_VERSION = "ops_v2"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _rebuild_schema(cursor):
    tables = [
        "patrol_routes",
        "hotspot_zones",
        "fir_records",
        "police_stations",
        "taluks",
        "districts",
        "crime_categories",
    ]

    for table in tables:
        cursor.execute(f"DROP TABLE IF EXISTS {table}")

    cursor.execute(
        """
        CREATE TABLE districts (
            district      TEXT PRIMARY KEY,
            lat           REAL NOT NULL,
            lng           REAL NOT NULL,
            taluk_count   INTEGER DEFAULT 0,
            station_count INTEGER DEFAULT 0,
            profile       TEXT,
            source_type   TEXT DEFAULT 'official'
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE taluks (
            taluk_id            TEXT PRIMARY KEY,
            district            TEXT NOT NULL,
            taluk               TEXT NOT NULL,
            lat                 REAL NOT NULL,
            lng                 REAL NOT NULL,
            radius_km           REAL DEFAULT 10,
            primary_station_id  TEXT,
            source_type         TEXT DEFAULT 'generated',
            UNIQUE(district, taluk)
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE police_stations (
            station_id          TEXT PRIMARY KEY,
            station_name        TEXT NOT NULL,
            district            TEXT NOT NULL,
            taluk               TEXT NOT NULL,
            lat                 REAL NOT NULL,
            lng                 REAL NOT NULL,
            source_type         TEXT DEFAULT 'osm',
            coverage_priority   INTEGER DEFAULT 1
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE fir_records (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            district      TEXT NOT NULL,
            taluk_id      TEXT NOT NULL,
            taluk         TEXT NOT NULL,
            station_id    TEXT,
            station_name  TEXT,
            state         TEXT DEFAULT 'Tamil Nadu',
            lat           REAL,
            lng           REAL,
            law_name      TEXT,
            ipc_section   TEXT,
            category      TEXT,
            severity      TEXT,
            year          INTEGER,
            month         INTEGER,
            day_of_week   INTEGER,
            time_slot     TEXT,
            incident_date TEXT,
            source_type   TEXT DEFAULT 'synthetic',
            count         INTEGER DEFAULT 1
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE crime_categories (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            law_name    TEXT NOT NULL,
            ipc_section TEXT NOT NULL,
            category    TEXT NOT NULL,
            severity    TEXT NOT NULL,
            description TEXT
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE hotspot_zones (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            taluk_id    TEXT,
            district    TEXT NOT NULL,
            zone_name   TEXT NOT NULL,
            center_lat  REAL NOT NULL,
            center_lng  REAL NOT NULL,
            radius_km   REAL NOT NULL,
            risk_level  TEXT NOT NULL,
            risk_score  REAL NOT NULL,
            crime_count INTEGER NOT NULL,
            top_crime   TEXT NOT NULL
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE patrol_routes (
            route_id     TEXT PRIMARY KEY,
            district     TEXT NOT NULL,
            route_name   TEXT NOT NULL,
            risk_level   TEXT NOT NULL,
            path_json    TEXT NOT NULL,
            source_type  TEXT DEFAULT 'generated'
        )
        """
    )

    cursor.execute(
        "CREATE INDEX idx_fir_district ON fir_records(district)"
    )
    cursor.execute(
        "CREATE INDEX idx_fir_taluk ON fir_records(taluk_id)"
    )
    cursor.execute(
        "CREATE INDEX idx_fir_category ON fir_records(category)"
    )
    cursor.execute(
        "CREATE INDEX idx_fir_year ON fir_records(year)"
    )
    cursor.execute(
        "CREATE INDEX idx_fir_station ON fir_records(station_id)"
    )


def init_db(force_rebuild=False):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS app_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )

    cursor.execute(
        "SELECT value FROM app_meta WHERE key = 'schema_version'"
    )
    row = cursor.fetchone()
    needs_rebuild = force_rebuild or not row or row["value"] != SCHEMA_VERSION

    if needs_rebuild:
        _rebuild_schema(cursor)
        cursor.execute(
            """
            INSERT INTO app_meta(key, value)
            VALUES('schema_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (SCHEMA_VERSION,),
        )

    conn.commit()
    conn.close()
    print("Database initialised successfully")
