from database import get_connection

IPC_MAPPING = [
    ("302", "Violent", "HIGH", "Murder / major violent offence"),
    ("307", "Violent", "HIGH", "Attempt to murder"),
    ("324", "Violent", "MEDIUM", "Assault with weapon"),
    ("379", "Property", "MEDIUM", "Theft"),
    ("392", "Property", "HIGH", "Robbery"),
    ("420", "Fraud", "MEDIUM", "Cheating / financial fraud"),
    ("465", "Fraud", "MEDIUM", "Forgery"),
    ("354", "Women Safety", "HIGH", "Assault on woman"),
    ("376", "Women Safety", "HIGH", "Rape"),
    ("498-A", "Women Safety", "MEDIUM", "Cruelty by husband"),
    ("147", "Public Order", "MEDIUM", "Rioting / unlawful assembly"),
    ("153-A", "Public Order", "HIGH", "Promoting enmity"),
    ("20", "NDPS", "HIGH", "Drug production / sale"),
    ("21", "NDPS", "HIGH", "Drug possession"),
    ("60", "Excise Act", "MEDIUM", "Excise offence"),
    ("72", "Excise Act", "HIGH", "Serious excise offence"),
    ("IRAD-ACCIDENT", "Accident", "HIGH", "Accident-prone incident cluster"),
]


def seed_ipc_categories():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM crime_categories")
    cursor.executemany(
        """
        INSERT INTO crime_categories
        (ipc_section, category, severity, description)
        VALUES (?, ?, ?, ?)
        """,
        IPC_MAPPING,
    )
    conn.commit()
    conn.close()
    print(f"Seeded {len(IPC_MAPPING)} IPC categories")
