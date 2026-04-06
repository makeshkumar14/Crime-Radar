from crime_catalog import CRIME_CATALOG
from database import get_connection


def seed_ipc_categories():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM crime_categories")
    cursor.executemany(
        """
        INSERT INTO crime_categories
        (law_name, ipc_section, category, severity, description)
        VALUES (:law_name, :ipc_section, :category, :severity, :description)
        """,
        CRIME_CATALOG,
    )
    conn.commit()
    conn.close()
    print(f"Seeded {len(CRIME_CATALOG)} legal sections")
