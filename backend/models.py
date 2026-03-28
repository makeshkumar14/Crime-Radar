from database import get_connection

IPC_MAPPING = [
    ("302",   "Violent",        "HIGH",   "Murder"),
    ("307",   "Violent",        "HIGH",   "Attempt to murder"),
    ("304-B", "Violent",        "HIGH",   "Dowry death"),
    ("324",   "Violent",        "MEDIUM", "Hurt by weapon"),
    ("322",   "Violent",        "MEDIUM", "Grievous hurt"),
    ("351",   "Violent",        "LOW",    "Assault"),
    ("376",   "Women Safety",   "HIGH",   "Rape"),
    ("354",   "Women Safety",   "MEDIUM", "Assault on woman"),
    ("498-A", "Women Safety",   "MEDIUM", "Cruelty by husband"),
    ("509",   "Women Safety",   "LOW",    "Insulting modesty"),
    ("363",   "Women Safety",   "HIGH",   "Kidnapping"),
    ("366",   "Women Safety",   "HIGH",   "Kidnapping woman"),
    ("379",   "Property",       "MEDIUM", "Theft"),
    ("380",   "Property",       "MEDIUM", "Theft in dwelling"),
    ("392",   "Property",       "HIGH",   "Robbery"),
    ("395",   "Property",       "HIGH",   "Dacoity"),
    ("396",   "Property",       "HIGH",   "Dacoity with murder"),
    ("420",   "Property",       "MEDIUM", "Cheating"),
    ("411",   "Property",       "MEDIUM", "Stolen property"),
    ("383",   "Property",       "MEDIUM", "Extortion"),
    ("441",   "Burglary",       "MEDIUM", "Criminal trespass"),
    ("448",   "Burglary",       "MEDIUM", "House trespass"),
    ("457",   "Burglary",       "HIGH",   "Night house breaking"),
    ("465",   "Fraud",          "MEDIUM", "Forgery"),
    ("467",   "Fraud",          "HIGH",   "Forgery of document"),
    ("489-A", "Fraud",          "HIGH",   "Counterfeiting currency"),
    ("141",   "Public Order",   "MEDIUM", "Unlawful assembly"),
    ("146",   "Public Order",   "MEDIUM", "Rioting"),
    ("147",   "Public Order",   "MEDIUM", "Rioting"),
    ("148",   "Public Order",   "HIGH",   "Rioting with weapon"),
    ("153-A", "Public Order",   "HIGH",   "Promoting enmity"),
    ("295-A", "Public Order",   "HIGH",   "Religious insult"),
    ("504",   "Public Order",   "LOW",    "Intentional insult"),
    ("506",   "Public Order",   "MEDIUM", "Criminal intimidation"),
    ("121",   "State Security", "HIGH",   "Waging war"),
    ("20",    "NDPS",           "HIGH",   "Drug production/sale"),
    ("21",    "NDPS",           "HIGH",   "Drug possession"),
    ("22",    "NDPS",           "HIGH",   "Drug use"),
    ("25",    "Arms Act",       "HIGH",   "Arms possession"),
    ("13",    "Gambling",       "LOW",    "Gambling"),
    ("3",     "SC/ST Act",      "HIGH",   "Atrocity"),
    ("60",    "Excise Act",     "MEDIUM", "Liquor offence"),
    ("72",    "Excise Act",     "HIGH",   "Liquor offence"),
    ("3",     "Cow Protection", "MEDIUM", "Cow slaughter"),
    ("3",     "ITPA",           "HIGH",   "Trafficking"),
    ("3",     "Goonda Act",     "HIGH",   "Goonda activity"),
]

def seed_ipc_categories():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.executemany("""
        INSERT OR IGNORE INTO crime_categories
        (ipc_section, category, severity, description)
        VALUES (?, ?, ?, ?)
    """, IPC_MAPPING)
    conn.commit()
    conn.close()
    print(f"Seeded {len(IPC_MAPPING)} IPC categories")