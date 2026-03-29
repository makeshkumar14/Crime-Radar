import pandas as pd
import sqlite3
import os

# ── Tamil Nadu district coordinates
TN_COORDINATES = {
    "CHENNAI":              (13.0827, 80.2707),
    "CHENNAI RLY.":         (13.0827, 80.2707),
    "COIMBATORE RURAL":     (11.0168, 76.9558),
    "COIMBATORE URBAN":     (11.0168, 76.9558),
    "MADURAI RURAL":        (9.9252,  78.1198),
    "MADURAI URBAN":        (9.9252,  78.1198),
    "SALEM RURAL":          (11.6643, 78.1460),
    "SALEM URBAN":          (11.6643, 78.1460),
    "TRICHY RURAL":         (10.7905, 78.7047),
    "TRICHY URBAN":         (10.7905, 78.7047),
    "TRICHI RLY.":          (10.7905, 78.7047),
    "TRICHI RURAL":         (10.7905, 78.7047),
    "TRICHI URBAN":         (10.7905, 78.7047),
    "TIRUPPATUR":           (12.4967, 78.5672),
    "TIRUPPUR":             (11.1085, 77.3411),
    "THIRUVALLUR":          (13.1231, 79.9064),
    "KANCHIPURAM":          (12.8185, 79.6947),
    "VELLORE":              (12.9165, 79.1325),
    "KRISHNAGIRI":          (12.5266, 78.2138),
    "DHARMAPURI":           (12.1211, 78.1582),
    "TIRUVANNAMALAI":       (12.2253, 79.0747),
    "THIRUVANNAMALAI":      (12.2253, 79.0747),
    "VILLUPURAM":           (11.9392, 79.4933),
    "CUDDALORE":            (11.7480, 79.7714),
    "NAGAPATTINAM":         (10.7672, 79.8449),
    "THANJAVUR":            (10.7870, 79.1378),
    "TIRUVARUR":            (10.7731, 79.6367),
    "THIRUVARUR":           (10.7731, 79.6367),
    "PUDUKKOTTAI":          (10.3797, 78.8203),
    "PUDUKOTTAI":           (10.3797, 78.8203),
    "SIVAGANGAI":           (9.8479,  78.4800),
    "RAMANATHAPURAM":       (9.3762,  78.8309),
    "RAMNATHAPURAM":        (9.3762,  78.8309),
    "VIRUDHUNAGAR":         (9.5850,  77.9629),
    "THOOTHUKUDI":          (8.7642,  78.1348),
    "TIRUNELVELI RURAL":    (8.7139,  77.7567),
    "TIRUNELVELI URBAN":    (8.7139,  77.7567),
    "THIRUVELVELI RURAL":   (8.7139,  77.7567),
    "THIRUVELVELI URBAN":   (8.7139,  77.7567),
    "THIRUVELVELI":         (8.7139,  77.7567),
    "THIRUMELVELI":         (8.7139,  77.7567),
    "KANYAKUMARI":          (8.0883,  77.5385),
    "DINDIGUL":             (10.3624, 77.9695),
    "THENI":                (10.0104, 77.4770),
    "ERODE":                (11.3410, 77.7172),
    "NAMAKKAL":             (11.2190, 78.1675),
    "KARUR":                (10.9601, 78.0766),
    "PERAMBALUR":           (11.2346, 78.8809),
    "ARIYALUR":             (11.1396, 79.0763),
    "NILGIRIS":             (11.4102, 76.6950),
    "THIRUNELVELI RURAL":   (8.7139,  77.7567),
    "THIRUNELVELI URBAN":   (8.7139,  77.7567),
    "THOOTHUGUDI":          (8.7642,  78.1348),
    "TRICHY RLY.":          (10.7905, 78.7047),
    "COIMBATORE":           (11.0168, 76.9558),
    "COIMBATORE CITY":      (11.0168, 76.9558),
    "MADURAI":              (9.9252,  78.1198),
    "MADURAI CITY":         (9.9252,  78.1198),
    "RAILWAY CHENNAI":      (13.0827, 80.2707),
    "RAILWAY TRICHY":       (10.7905, 78.7047),
    "SALEM":                (11.6643, 78.1460),
    "SALEM CITY":           (11.6643, 78.1460),
    "THIRUNELVELI":         (8.7139,  77.7567),
    "THIRUNELVELI CITY":    (8.7139,  77.7567),
    "TIRUPPUR CITY":        (11.1085, 77.3411),
    "TRICHY":               (10.7905, 78.7047),
    "TRICHY CITY":          (10.7905, 78.7047),
}

# ── Crime column → IPC category mapping
CRIME_CATEGORY_MAP = {
    # Works for both 2013 and 2014
    "MURDER":                                                    ("Violent",      "HIGH",   "302"),
    "Murder":                                                    ("Violent",      "HIGH",   "302"),
    "ATTEMPT TO MURDER":                                         ("Violent",      "HIGH",   "307"),
    "Attempt to commit Murder":                                  ("Violent",      "HIGH",   "307"),
    "CULPABLE HOMICIDE NOT AMOUNTING TO MURDER":                 ("Violent",      "HIGH",   "304"),
    "Culpable Homicide not amounting to Murder":                 ("Violent",      "HIGH",   "304"),
    "RAPE":                                                      ("Women Safety", "HIGH",   "376"),
    "Rape":                                                      ("Women Safety", "HIGH",   "376"),
    "KIDNAPPING & ABDUCTION":                                    ("Women Safety", "HIGH",   "363"),
    "Kidnapping & Abduction_Total":                              ("Women Safety", "HIGH",   "363"),
    "KIDNAPPING AND ABDUCTION OF WOMEN AND GIRLS":               ("Women Safety", "HIGH",   "366"),
    "Kidnapping & Abduction of Women to compel her for marriage":("Women Safety", "HIGH",   "366"),
    "DACOITY":                                                   ("Property",     "HIGH",   "395"),
    "Dacoity":                                                   ("Property",     "HIGH",   "395"),
    "PREPARATION AND ASSEMBLY FOR DACOITY":                      ("Property",     "HIGH",   "396"),
    "Making Preparation and Assembly for committing Dacoity":    ("Property",     "HIGH",   "396"),
    "ROBBERY":                                                   ("Property",     "HIGH",   "392"),
    "Robbery":                                                   ("Property",     "HIGH",   "392"),
    "BURGLARY":                                                  ("Burglary",     "MEDIUM", "457"),
    "Criminal Trespass/Burglary":                                ("Burglary",     "MEDIUM", "457"),
    "House Trespass & House Breaking":                           ("Burglary",     "MEDIUM", "457"),
    "THEFT":                                                     ("Property",     "MEDIUM", "379"),
    "Theft":                                                     ("Property",     "MEDIUM", "379"),
    "AUTO THEFT":                                                ("Property",     "MEDIUM", "379"),
    "Auto Theft":                                                ("Property",     "MEDIUM", "379"),
    "OTHER THEFT":                                               ("Property",     "MEDIUM", "379"),
    "Other Thefts":                                              ("Property",     "MEDIUM", "379"),
    "RIOTS":                                                     ("Public Order", "MEDIUM", "147"),
    "Riots":                                                     ("Public Order", "MEDIUM", "147"),
    "CRIMINAL BREACH OF TRUST":                                  ("Fraud",        "MEDIUM", "406"),
    "Criminal Breach of Trust":                                  ("Fraud",        "MEDIUM", "406"),
    "CHEATING":                                                  ("Fraud",        "MEDIUM", "420"),
    "Cheating":                                                  ("Fraud",        "MEDIUM", "420"),
    "COUNTERFIETING":                                            ("Fraud",        "HIGH",   "489-A"),
    "Counterfeiting":                                            ("Fraud",        "HIGH",   "489-A"),
    "Counterfeit currency & Bank notes":                         ("Fraud",        "HIGH",   "489-A"),
    "ARSON":                                                     ("Violent",      "HIGH",   "435"),
    "Arson":                                                     ("Violent",      "HIGH",   "435"),
    "HURT/GREVIOUS HURT":                                        ("Violent",      "MEDIUM", "324"),
    "Grievous Hurt":                                             ("Violent",      "MEDIUM", "324"),
    "Hurt":                                                      ("Violent",      "LOW",    "323"),
    "DOWRY DEATHS":                                              ("Women Safety", "HIGH",   "304-B"),
    "Dowry Deaths":                                              ("Women Safety", "HIGH",   "304-B"),
    "ASSAULT ON WOMEN WITH INTENT TO OUTRAGE HER MODESTY":      ("Women Safety", "MEDIUM", "354"),
    "Assault on Women with intent to outrage her Modesty":       ("Women Safety", "MEDIUM", "354"),
    "INSULT TO MODESTY OF WOMEN":                                ("Women Safety", "LOW",    "509"),
    "Insult to the Modesty of Women":                            ("Women Safety", "LOW",    "509"),
    "CRUELTY BY HUSBAND OR HIS RELATIVES":                       ("Women Safety", "MEDIUM", "498-A"),
    "Cruelty by Husband or his Relatives":                       ("Women Safety", "MEDIUM", "498-A"),
    "CAUSING DEATH BY NEGLIGENCE":                               ("Violent",      "MEDIUM", "304-A"),
    "Causing Death by Negligence":                               ("Violent",      "MEDIUM", "304-A"),
    "Extortion":                                                 ("Property",     "MEDIUM", "383"),
    "HumanTrafficking":                                          ("Women Safety", "HIGH",   "370"),
    "Forgery":                                                   ("Fraud",        "MEDIUM", "465"),
    "Stalking":                                                  ("Women Safety", "LOW",    "354-D"),
    "Acid attack":                                               ("Women Safety", "HIGH",   "326-A"),
}

def load_csv_to_db(csv_path: str, db_path: str = "crimeradar.db"):
    print(f"Loading {csv_path}...")

    df = pd.read_csv(csv_path)

    # Filter Tamil Nadu only
    # Handle different column names across CSV files
    state_col = None
    for col in df.columns:
        if "STATE" in col.upper():
            state_col = col
            break

    if state_col is None:
        print(f"  Could not find state column. Columns: {list(df.columns)}")
        return

    df = df[df[state_col] == "Tamil Nadu"].copy()

    # Remove total row
    # Handle different column names for district
    dist_col = None
    for col in df.columns:
        if "DISTRICT" in col.upper():
            dist_col = col
            break

    if dist_col is None:
        print(f"  Could not find district column. Skipping.")
        return

    df = df[df[dist_col] != "ZZ TOTAL"].copy()
    df = df[df[dist_col] != "Total"].copy()
    df["DISTRICT"] = df[dist_col].str.strip().str.upper()

    
    print(f"Found {len(df)} Tamil Nadu district records")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    inserted = 0
    skipped = 0

    for _, row in df.iterrows():
        district = row["DISTRICT"]
        year_col = next((c for c in df.columns if "YEAR" in c.upper()), None)
        year = int(row[year_col]) if year_col else 2014

        # Get coordinates
        coords = TN_COORDINATES.get(district)
        if not coords:
            print(f"  No coordinates for: {district} — skipping")
            skipped += 1
            continue

        lat, lng = coords

        # Insert one row per crime type
        for crime_col, (category, severity, ipc) in CRIME_CATEGORY_MAP.items():
            if crime_col not in df.columns:
                continue

            count = row.get(crime_col, 0)
            try:
                count = int(count)
            except:
                count = 0

            if count == 0:
                continue

            cursor.execute("""
                INSERT INTO fir_records
                (district, state, lat, lng, ipc_section,
                 category, severity, year, count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (district, "Tamil Nadu", lat, lng,
                  ipc, category, severity, year, count))
            inserted += 1

    conn.commit()
    conn.close()
    print(f"Inserted {inserted} records | Skipped {skipped} districts")
    print("Done!")


if __name__ == "__main__":
    # Load all CSV files in data/ folder
    data_folder = "data"
    csv_files = [f for f in os.listdir(data_folder) if f.endswith(".csv")]

    if not csv_files:
        print("No CSV files found in data/ folder!")
    else:
        for csv_file in csv_files:
            path = os.path.join(data_folder, csv_file)
            load_csv_to_db(path)
