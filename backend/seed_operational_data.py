from __future__ import annotations

import json
import math
import random
import re
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from crime_catalog import catalog_by_category
from database import get_connection, init_db
from models import seed_ipc_categories

BASE_DIR = Path(__file__).resolve().parent
RAW_DIR = BASE_DIR / "data" / "raw"
DATA_SEED_VERSION = "ops_seed_v4"
YEARS = [2024, 2025, 2026]

# Curated taluk coordinates that take precedence over the official HQ feed.
# Sources used during development:
# - Official Bharat Maps SubDistrict_Hq service for most Tamil Nadu taluks
# - Curated OSM geocoding fallbacks for taluks missing from the HQ feed
# - Manual verification for a few Chennai and legacy-name taluks
TALUK_COORDINATE_OVERRIDES = {
    ("CHENNAI", "ALANDUR"): {
        "lat": 13.0028216,
        "lng": 80.1719186,
        "source_type": "verified",
    },
    ("CHENNAI", "AMBATTUR"): {
        "lat": 13.100653042654431,
        "lng": 80.16630446569768,
        "source_type": "verified",
    },
    ("CHENNAI", "AMINJIKARAI"): {
        "lat": 13.07897776529405,
        "lng": 80.22299415907511,
        "source_type": "verified",
    },
    ("CHENNAI", "AYANAVARAM"): {
        "lat": 13.088971192825646,
        "lng": 80.23144795178736,
        "source_type": "verified",
    },
    ("CHENNAI", "EGMORE"): {
        "lat": 13.0728321,
        "lng": 80.2576906,
        "source_type": "verified",
    },
    ("CHENNAI", "GUINDY"): {
        "lat": 13.013176743078098,
        "lng": 80.21624958546406,
        "source_type": "verified",
    },
    ("CHENNAI", "KOLATHUR"): {
        "lat": 13.1241127,
        "lng": 80.2046276,
        "source_type": "verified",
    },
    ("CHENNAI", "MADHAVARAM"): {
        "lat": 13.156034997226396,
        "lng": 80.24393438062472,
        "source_type": "verified",
    },
    ("CHENNAI", "MADURAVOYAL"): {
        "lat": 13.065046123373149,
        "lng": 80.1706005184068,
        "source_type": "verified",
    },
    ("CHENNAI", "MAMBALAM"): {
        "lat": 13.033672379887633,
        "lng": 80.20770320788705,
        "source_type": "verified",
    },
    ("CHENNAI", "MYLAPORE"): {
        "lat": 13.041327180153329,
        "lng": 80.26359421184028,
        "source_type": "verified",
    },
    ("CHENNAI", "PERAMBUR"): {
        "lat": 13.111625945442766,
        "lng": 80.25766707369674,
        "source_type": "verified",
    },
    ("CHENNAI", "PURASAWALKAM"): {
        "lat": 13.103640718170382,
        "lng": 80.27690314893154,
        "source_type": "verified",
    },
    ("CHENNAI", "SHOZHINGANALLUR"): {
        "lat": 12.9174426,
        "lng": 80.2164902,
        "source_type": "verified",
    },
    ("CHENNAI", "THIRUVOTTIYUR"): {
        "lat": 13.16294909004349,
        "lng": 80.30319452144093,
        "source_type": "verified",
    },
    ("CHENNAI", "TONDIARPET"): {
        "lat": 13.129259656353659,
        "lng": 80.28857020643194,
        "source_type": "verified",
    },
    ("CHENNAI", "VELACHERY"): {
        "lat": 12.984540729234467,
        "lng": 80.22992109697705,
        "source_type": "verified",
    },
    ("CHENGALPATTU", "VANDALUR"): {
        "lat": 12.8921486,
        "lng": 80.0829603,
        "source_type": "curated",
    },
    ("COIMBATORE", "PERUR"): {
        "lat": 10.9764060,
        "lng": 76.9141784,
        "source_type": "curated",
    },
    ("DINDIGUL", "GUJILIAMPARAI"): {
        "lat": 10.4261206,
        "lng": 78.0063561,
        "source_type": "curated",
    },
    ("KALLAKURICHI", "KALVARAYAN HILLS"): {
        "lat": 11.8577778,
        "lng": 78.6955556,
        "source_type": "curated",
    },
    ("KALLAKURICHI", "VANAPURAM"): {
        "lat": 11.9267389,
        "lng": 79.0113595,
        "source_type": "curated",
    },
    ("KANCHEEPURAM", "KUNDRATHUR"): {
        "lat": 12.9959652,
        "lng": 80.0975672,
        "source_type": "curated",
    },
    ("KANYAKUMARI", "KILLIYOOR"): {
        "lat": 8.2653222,
        "lng": 77.2132679,
        "source_type": "curated",
    },
    ("KANYAKUMARI", "THIRUVATTAR"): {
        "lat": 8.3305895,
        "lng": 77.2655506,
        "source_type": "curated",
    },
    ("KARUR", "PUGALUR"): {
        "lat": 11.0762440,
        "lng": 78.0040454,
        "source_type": "curated",
    },
    ("KRISHNAGIRI", "ANCHETTY"): {
        "lat": 12.3142332,
        "lng": 77.7206605,
        "source_type": "curated",
    },
    ("MAYILADUTHURAI", "SIRKAZHI"): {
        "lat": 11.23879735821739,
        "lng": 79.7378258025265,
        "source_type": "curated",
    },
    ("RAMANATHAPURAM", "RAJASINGAMANGALAM"): {
        "lat": 9.63574,
        "lng": 78.84613,
        "source_type": "curated",
    },
    ("RANIPET", "KALAVAI"): {
        "lat": 12.7690720,
        "lng": 79.4195652,
        "source_type": "curated",
    },
    ("RANIPET", "SHOLINGHUR"): {
        "lat": 13.1151925,
        "lng": 79.4231084,
        "source_type": "curated",
    },
    ("RANIPET", "WALAJAPET"): {
        "lat": 12.9254734,
        "lng": 79.3637892,
        "source_type": "curated",
    },
    ("SALEM", "THALAIVASAL"): {
        "lat": 11.5759235,
        "lng": 78.7609295,
        "source_type": "curated",
    },
    ("THANJAVUR", "BUDALUR"): {
        "lat": 10.7886490,
        "lng": 78.9789575,
        "source_type": "curated",
    },
    ("THANJAVUR", "THIRUVONAM"): {
        "lat": 10.6142792,
        "lng": 79.2327870,
        "source_type": "curated",
    },
    ("THIRUVARUR", "MUTHUPETTAI"): {
        "lat": 10.5692280,
        "lng": 79.5305922,
        "source_type": "curated",
    },
    ("THOOTHUKKUDI", "ERAL"): {
        "lat": 8.6253791,
        "lng": 78.0228746,
        "source_type": "curated",
    },
    ("TIRUNELVELI", "THISAYANVILAI"): {
        "lat": 8.3355721,
        "lng": 77.8668199,
        "source_type": "curated",
    },
    ("TIRUVALLUR", "R.K. PET"): {
        "lat": 13.1645,
        "lng": 79.4380,
        "source_type": "curated",
    },
    ("VELLORE", "K.V. KUPPAM"): {
        "lat": 12.9557646,
        "lng": 78.9873416,
        "source_type": "curated",
    },
    ("VILLUPPURAM", "THIRUVENNAINALLUR"): {
        "lat": 11.8664270,
        "lng": 79.4053467,
        "source_type": "curated",
    },
    ("VIRUDHUNAGAR", "WATRAP"): {
        "lat": 9.6365403,
        "lng": 77.6397064,
        "source_type": "curated",
    },
}

DISTRICT_ALIASES = {
    "KALLAKURICHCHI": "KALLAKURICHI",
    "KALLAKURICHI": "KALLAKURICHI",
    "KANCHIPURAM": "KANCHEEPURAM",
    "KANCHEEPURAM": "KANCHEEPURAM",
    "KANNIYAKUMARI": "KANYAKUMARI",
    "KANYAKUMARI": "KANYAKUMARI",
    "SIVAGANGA": "SIVAGANGAI",
    "SIVAGANGAI": "SIVAGANGAI",
    "THE NILGIRIS": "NILGIRIS",
    "NILGIRIS": "NILGIRIS",
    "THOOTHUKUDI": "THOOTHUKKUDI",
    "THOOTHUKKUDI": "THOOTHUKKUDI",
    "TIRUCHIRAPPALLI": "THIRUCHIRAPPALLI",
    "THIRUCHIRAPPALLI": "THIRUCHIRAPPALLI",
    "TIRUPATHUR": "THIRUPATHUR",
    "TIRUPPATTUR": "THIRUPATHUR",
    "THIRUPATHUR": "THIRUPATHUR",
    "THIRUVALLUR": "TIRUVALLUR",
    "TIRUVALLUR": "TIRUVALLUR",
    "TUTICORIN": "THOOTHUKKUDI",
    "VILUPPURAM": "VILLUPPURAM",
    "VILLUPURAM": "VILLUPPURAM",
    "VILUPPURAM": "VILLUPPURAM",
    "VILLUPPURAM": "VILLUPPURAM",
}

TALUK_FIXES = {
    "MADURAMDAGAM": "MADURANTHAGAM",
    "TINDIVANAMM": "TINDIVANAM",
}

TALUK_COORDINATE_LOOKUP_ALIASES = {
    ("CHENGALPATTU", "MADURANTHAGAM"): ("CHENGALPATTU", "MADURANTHAKAM"),
    ("CHENGALPATTU", "THIRUPORUR"): ("CHENGALPATTU", "TIRUPORUR"),
    ("COIMBATORE", "COIMBATORE (N)"): ("COIMBATORE", "COIMBATORE NORTH"),
    ("COIMBATORE", "COIMBATORE (S)"): ("COIMBATORE", "COIMBATORE SOUTH"),
    ("COIMBATORE", "KINATHUKKDAVU"): ("COIMBATORE", "KINATHUKADAVU"),
    ("COIMBATORE", "MADUKKARAI"): ("COIMBATORE", "MADUKKARI"),
    ("CUDDALORE", "TITAGUDI"): ("CUDDALORE", "TITTAKUDI"),
    ("CUDDALORE", "VRIDHACHALAM"): ("CUDDALORE", "VIRUDHACHALAM"),
    ("DHARMAPURI", "PALACODE"): ("DHARMAPURI", "PALAKKODU"),
    ("DHARMAPURI", "PAPPIREDDIPATTY"): ("DHARMAPURI", "PAPPIREDDIPATTI"),
    ("DINDIGUL", "DINDIGUL WEST"): ("DINDIGUL", "DINDIGULWEST"),
    ("DINDIGUL", "NILAKOTTAI"): ("DINDIGUL", "NILAKKOTTAI"),
    ("DINDIGUL", "ODDENCHATRAM"): ("DINDIGUL", "ODDANCHATRAM"),
    ("ERODE", "GOBICHETTIPALAYM"): ("ERODE", "GOBICHETTIPALAYAM"),
    ("KALLAKURICHI", "KALLAKURICHI"): ("KALLAKURICHI", "KALLAKKURICHI"),
    ("KALLAKURICHI", "TIRUKKOILUR"): ("KALLAKURICHI", "TIRUKKOYILUR"),
    ("KALLAKURICHI", "ULUNDURPET"): ("KALLAKURICHI", "ULUNDURPETTAI"),
    ("KANYAKUMARI", "THOVALAI"): ("KANYAKUMARI", "THOVALA"),
    ("KANYAKUMARI", "VILAVAMCODE"): ("KANYAKUMARI", "VILAVANCODE"),
    ("KARUR", "ARVAKURICHI"): ("KARUR", "ARAVAKURICHI"),
    ("MADURAI", "TIRUMANGALAM"): ("MADURAI", "THIRUMANGALAM"),
    ("MAYILADUTHURAI", "SIRKAZHI"): ("MAYILADUTHURAI", "SIRKALI"),
    ("NAMAKKAL", "PARAMATHIVELUR"): ("NAMAKKAL", "PARAMATHI-VELUR"),
    ("NAMAKKAL", "THIRUCHENCODE"): ("NAMAKKAL", "TIRUCHENGODE"),
    ("NILGIRIS", "UDHAGAI"): ("NILGIRIS", "UDHAGAMANDALAM"),
    ("NILGIRIS", "PANDALUR"): ("NILGIRIS", "PANTHALUR"),
    ("PUDUKKOTTAI", "AVUDAIYARKOIL"): ("PUDUKKOTTAI", "AVUDAYARKOIL"),
    ("PUDUKKOTTAI", "GANDARVAKOTTAI"): ("PUDUKKOTTAI", "GANDARVAKKOTTAI"),
    ("PUDUKKOTTAI", "ILLUPUR"): ("PUDUKKOTTAI", "ILUPPUR"),
    ("RAMANATHAPURAM", "RAMESHWARAM"): ("RAMANATHAPURAM", "RAMESWARAM"),
    ("RAMANATHAPURAM", "THIRUVADANI"): ("RAMANATHAPURAM", "TIRUVADANAI"),
    ("RANIPET", "ARAKKONAM"): ("RANIPET", "ARAKONAM"),
    ("SALEM", "EDAPPADY"): ("SALEM", "EDAPPADI"),
    ("SALEM", "PETHANAICKENPALAYAM"): ("SALEM", "PETHANAICKANPALAYAM"),
    ("SALEM", "VALAPADY"): ("SALEM", "VAZHAPADI"),
    ("SIVAGANGAI", "ILAYANKUDI"): ("SIVAGANGAI", "ILAYANGUDI"),
    ("SIVAGANGAI", "KALAIYARKOVIL"): ("SIVAGANGAI", "KALAIYARKOIL"),
    ("SIVAGANGAI", "KARAIKUDI"): ("SIVAGANGAI", "KARAIKKUDI"),
    ("SIVAGANGAI", "THIRUPPATTUR"): ("SIVAGANGAI", "THIRUPPATHUR"),
    ("TENKASI", "THIRUVENGADAM"): ("TENKASI", "TIRUVENGADAM"),
    ("TENKASI", "VEERAKERALAMPUDUR"): ("TENKASI", "VEERAKERALAMPUTHUR"),
    ("THANJAVUR", "ORATHANAD"): ("THANJAVUR", "ORATHANADU"),
    ("THANJAVUR", "PATTUKKOTAI"): ("THANJAVUR", "PATTUKKOTTAI"),
    ("THENI", "AUNDIPATTI"): ("THENI", "ANDIPATTI"),
    ("THENI", "BODINAYAKKANUR"): ("THENI", "BODINAYAKANUR"),
    ("THIRUCHIRAPPALLI", "THOTTIAM"): ("THIRUCHIRAPPALLI", "THOTTIYAM"),
    ("THIRUPATHUR", "NATARAMPALLI"): ("THIRUPATHUR", "NATRAMPALLI"),
    ("THOOTHUKKUDI", "SATTANKULAM"): ("THOOTHUKKUDI", "SATHANKULAM"),
    ("THOOTHUKKUDI", "SRIVAIKUNDAM"): ("THOOTHUKKUDI", "SRIVAIKUNTAM"),
    ("THOOTHUKKUDI", "THOOTHUKUDI"): ("THOOTHUKKUDI", "THOOTHUKKUDI"),
    ("TIRUPPUR", "AVINASHI"): ("TIRUPPUR", "AVANASHI"),
    ("TIRUPPUR", "KANGAYAM"): ("TIRUPPUR", "KANGEYAM"),
    ("TIRUPPUR", "TIRUPPUR NORTH"): ("TIRUPPUR", "TIRUPPURNORTH"),
    ("TIRUPPUR", "TIRUPPUR SOUTH"): ("TIRUPPUR", "TIRUPPAR SOUTH"),
    ("TIRUPPUR", "UDUMALAIPET"): ("TIRUPPUR", "UDUMALAIPETTAI"),
    ("TIRUPPUR", "UTHUKKULI"): ("TIRUPPUR", "UTHUKULI"),
    ("TIRUVALLUR", "TIRUVALLUR"): ("TIRUVALLUR", "THIRUVALLUR"),
    ("TIRUVALLUR", "PALLIPET"): ("TIRUVALLUR", "PALLIPATTU"),
    ("TIRUVALLUR", "UTHUKOTTAI"): ("TIRUVALLUR", "UTHUKKOTTAI"),
    ("TIRUVANNAMALAI", "THANDARAMPATTU"): ("TIRUVANNAMALAI", "THANDRAMPET"),
    ("VILLUPPURAM", "KANDACHEEPURAM"): ("VILLUPPURAM", "KANDACHIPURAM"),
    ("VILLUPPURAM", "MARAKKANAM"): ("VILLUPPURAM", "MARAKANAM"),
    ("VILLUPPURAM", "MELMALAIYANOOR"): ("VILLUPPURAM", "MELMALAIYANUR"),
    ("VIRUDHUNAGAR", "KARIYAPATTI"): ("VIRUDHUNAGAR", "KARIAPATTI"),
    ("VIRUDHUNAGAR", "RAJAPALAIAM"): ("VIRUDHUNAGAR", "RAJAPALAYAM"),
    ("VIRUDHUNAGAR", "VEMBAKKOTTAI"): ("VIRUDHUNAGAR", "VEMBAKOTTAI"),
}

URBAN_DISTRICTS = {
    "CHENNAI",
    "CHENGALPATTU",
    "COIMBATORE",
    "MADURAI",
    "TIRUPPUR",
    "THIRUCHIRAPPALLI",
    "SALEM",
    "VELLORE",
}

COASTAL_DISTRICTS = {
    "CUDDALORE",
    "NAGAPATTINAM",
    "MAYILADUTHURAI",
    "THIRUVARUR",
    "RAMANATHAPURAM",
    "THOOTHUKKUDI",
    "KANYAKUMARI",
    "CHENGALPATTU",
}

HIGHWAY_DISTRICTS = {
    "KRISHNAGIRI",
    "DHARMAPURI",
    "SALEM",
    "NAMAKKAL",
    "ERODE",
    "COIMBATORE",
    "TIRUPPUR",
    "RANIPET",
    "VELLORE",
    "THIRUCHIRAPPALLI",
}

INDUSTRIAL_DISTRICTS = {
    "COIMBATORE",
    "TIRUPPUR",
    "ERODE",
    "SALEM",
    "RANIPET",
    "VELLORE",
    "KANCHEEPURAM",
    "CHENGALPATTU",
}

HILL_TOURISM_DISTRICTS = {
    "NILGIRIS",
    "DINDIGUL",
    "KANYAKUMARI",
    "TENKASI",
    "THENI",
}

CATEGORY_CONFIG = {
    "State Security": {
        "base": 0.08,
        "month": [0.98, 0.96, 0.97, 0.98, 1.0, 1.02, 1.01, 1.0, 1.0, 1.02, 1.01, 0.99],
        "time_slots": [("NIGHT", 0.34), ("EVENING", 0.3), ("AFTERNOON", 0.2), ("MORNING", 0.16)],
    },
    "Violent": {
        "base": 0.82,
        "month": [0.94, 0.92, 0.95, 1.0, 1.04, 1.08, 1.1, 1.06, 1.0, 1.03, 1.08, 1.12],
        "time_slots": [("NIGHT", 0.38), ("EVENING", 0.34), ("AFTERNOON", 0.18), ("MORNING", 0.1)],
    },
    "Public Nuisance": {
        "base": 0.36,
        "month": [0.95, 0.93, 0.96, 0.98, 1.0, 1.03, 1.04, 1.02, 1.01, 1.0, 1.0, 0.98],
        "time_slots": [("EVENING", 0.34), ("AFTERNOON", 0.32), ("MORNING", 0.2), ("NIGHT", 0.14)],
    },
    "Property": {
        "base": 1.26,
        "month": [0.86, 0.88, 0.9, 0.96, 1.0, 1.03, 1.02, 1.0, 1.08, 1.2, 1.24, 1.26],
        "time_slots": [("EVENING", 0.4), ("NIGHT", 0.28), ("AFTERNOON", 0.2), ("MORNING", 0.12)],
    },
    "Burglary": {
        "base": 0.74,
        "month": [0.88, 0.89, 0.9, 0.94, 0.98, 1.0, 1.02, 1.0, 1.08, 1.16, 1.18, 1.22],
        "time_slots": [("NIGHT", 0.48), ("EVENING", 0.28), ("AFTERNOON", 0.14), ("MORNING", 0.1)],
    },
    "Fraud": {
        "base": 0.76,
        "month": [0.92, 0.94, 0.95, 0.98, 1.0, 1.02, 1.0, 1.01, 1.05, 1.1, 1.12, 1.08],
        "time_slots": [("AFTERNOON", 0.42), ("MORNING", 0.3), ("EVENING", 0.2), ("NIGHT", 0.08)],
    },
    "Women Safety": {
        "base": 0.88,
        "month": [0.9, 0.92, 0.95, 0.97, 1.0, 1.04, 1.05, 1.04, 1.02, 1.08, 1.12, 1.14],
        "time_slots": [("EVENING", 0.36), ("NIGHT", 0.32), ("AFTERNOON", 0.18), ("MORNING", 0.14)],
    },
    "Kidnapping": {
        "base": 0.34,
        "month": [0.92, 0.93, 0.95, 0.98, 1.0, 1.02, 1.04, 1.03, 1.02, 1.06, 1.08, 1.07],
        "time_slots": [("EVENING", 0.34), ("NIGHT", 0.28), ("AFTERNOON", 0.22), ("MORNING", 0.16)],
    },
    "Public Order": {
        "base": 0.66,
        "month": [0.9, 0.9, 0.96, 1.04, 1.08, 1.06, 1.0, 0.96, 1.0, 1.08, 1.1, 1.02],
        "time_slots": [("EVENING", 0.38), ("AFTERNOON", 0.3), ("NIGHT", 0.18), ("MORNING", 0.14)],
    },
    "NDPS": {
        "base": 0.38,
        "month": [0.95, 0.95, 0.96, 0.98, 1.0, 1.02, 1.04, 1.03, 1.02, 1.05, 1.08, 1.1],
        "time_slots": [("NIGHT", 0.46), ("EVENING", 0.3), ("AFTERNOON", 0.16), ("MORNING", 0.08)],
    },
    "Gambling": {
        "base": 0.28,
        "month": [0.94, 0.92, 0.94, 0.97, 1.0, 1.01, 1.02, 1.0, 1.02, 1.06, 1.08, 1.12],
        "time_slots": [("NIGHT", 0.42), ("EVENING", 0.3), ("AFTERNOON", 0.18), ("MORNING", 0.1)],
    },
    "Arms Act": {
        "base": 0.18,
        "month": [0.94, 0.94, 0.95, 0.98, 1.0, 1.01, 1.02, 1.0, 1.01, 1.03, 1.04, 1.03],
        "time_slots": [("NIGHT", 0.4), ("EVENING", 0.3), ("AFTERNOON", 0.18), ("MORNING", 0.12)],
    },
    "Excise Act": {
        "base": 0.42,
        "month": [0.92, 0.92, 0.95, 0.98, 1.0, 1.03, 1.04, 1.02, 1.01, 1.06, 1.08, 1.12],
        "time_slots": [("NIGHT", 0.34), ("EVENING", 0.3), ("AFTERNOON", 0.2), ("MORNING", 0.16)],
    },
    "Cow Protection": {
        "base": 0.14,
        "month": [0.95, 0.95, 0.96, 0.98, 1.0, 1.0, 1.01, 1.0, 1.01, 1.03, 1.03, 1.02],
        "time_slots": [("NIGHT", 0.28), ("EVENING", 0.28), ("AFTERNOON", 0.24), ("MORNING", 0.2)],
    },
    "SC/ST Act": {
        "base": 0.2,
        "month": [0.96, 0.96, 0.97, 0.99, 1.0, 1.02, 1.03, 1.01, 1.01, 1.04, 1.05, 1.03],
        "time_slots": [("EVENING", 0.3), ("AFTERNOON", 0.28), ("NIGHT", 0.24), ("MORNING", 0.18)],
    },
    "Mining Act": {
        "base": 0.24,
        "month": [0.93, 0.93, 0.95, 0.99, 1.02, 1.04, 1.05, 1.04, 1.02, 1.01, 1.0, 0.98],
        "time_slots": [("MORNING", 0.32), ("AFTERNOON", 0.3), ("EVENING", 0.22), ("NIGHT", 0.16)],
    },
    "ITPA": {
        "base": 0.16,
        "month": [0.95, 0.95, 0.96, 0.98, 1.0, 1.01, 1.02, 1.01, 1.02, 1.04, 1.05, 1.05],
        "time_slots": [("NIGHT", 0.44), ("EVENING", 0.3), ("AFTERNOON", 0.16), ("MORNING", 0.1)],
    },
    "Goonda Act": {
        "base": 0.12,
        "month": [0.96, 0.95, 0.96, 0.98, 1.0, 1.02, 1.02, 1.01, 1.01, 1.02, 1.03, 1.02],
        "time_slots": [("NIGHT", 0.36), ("EVENING", 0.3), ("AFTERNOON", 0.2), ("MORNING", 0.14)],
    },
    "Accident": {
        "base": 1.26,
        "month": [0.94, 0.93, 0.95, 0.97, 1.0, 1.02, 1.02, 1.0, 1.08, 1.16, 1.18, 1.1],
        "time_slots": [("EVENING", 0.34), ("NIGHT", 0.28), ("AFTERNOON", 0.22), ("MORNING", 0.16)],
    },
}

CATEGORY_CODES = catalog_by_category()


def normalize_text(value: str) -> str:
    value = (value or "").strip().upper()
    value = re.sub(r"\s+", " ", value)
    return value


def normalize_district(value: str) -> str:
    return DISTRICT_ALIASES.get(normalize_text(value), normalize_text(value))


def normalize_taluk(value: str) -> str:
    value = TALUK_FIXES.get(normalize_text(value), normalize_text(value))
    return value


def slugify(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", normalize_text(value)).strip("-")


def resolve_coordinate_lookup_key(district: str, taluk: str):
    normalized_key = (normalize_district(district), normalize_taluk(taluk))
    return TALUK_COORDINATE_LOOKUP_ALIASES.get(normalized_key, normalized_key)


@lru_cache(maxsize=1)
def load_official_taluk_coordinate_overrides():
    path = RAW_DIR / "tn_subdistrict_hq_points.json"
    if not path.exists():
        return {}

    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    overrides = {}
    for feature in raw.get("features", []):
        attributes = feature.get("attributes") or {}
        geometry = feature.get("geometry") or {}
        lat = geometry.get("y")
        lng = geometry.get("x")
        if lat is None or lng is None:
            continue

        district = normalize_district(attributes.get("dtname") or "")
        taluk = normalize_taluk(attributes.get("name11") or "")
        if not district or not taluk:
            continue

        overrides[(district, taluk)] = {
            "lat": float(lat),
            "lng": float(lng),
            "source_type": "official_hq",
        }

    return overrides


def get_coordinate_override(district: str, taluk: str):
    normalized_key = (normalize_district(district), normalize_taluk(taluk))
    manual_override = TALUK_COORDINATE_OVERRIDES.get(normalized_key)
    if manual_override:
        return manual_override

    lookup_key = resolve_coordinate_lookup_key(district, taluk)
    official_override = load_official_taluk_coordinate_overrides().get(lookup_key)
    if not official_override:
        return None

    source_type = official_override.get("source_type", "official_hq")
    if lookup_key != normalized_key:
        source_type = "official_hq_alias"

    return {
        "lat": official_override["lat"],
        "lng": official_override["lng"],
        "source_type": source_type,
    }


def load_taluk_rows():
    html = (RAW_DIR / "tn_taluk_source.html").read_text(
        encoding="utf-8", errors="ignore"
    )
    rows = re.findall(
        r'<tr><td>\d+</td><td>([^<]+)</td>\s*<td class="text-left">([^<]+)</td></tr>',
        html,
    )
    taluks = [
        {
            "district": normalize_district(district),
            "taluk": normalize_taluk(taluk),
        }
        for district, taluk in rows
    ]
    return taluks


def polygon_area(ring):
    area = 0.0
    for idx in range(len(ring)):
        x1, y1 = ring[idx]
        x2, y2 = ring[(idx + 1) % len(ring)]
        area += (x1 * y2) - (x2 * y1)
    return area / 2.0


def ring_centroid(ring):
    area = polygon_area(ring)
    if abs(area) < 1e-9:
        xs = [point[0] for point in ring]
        ys = [point[1] for point in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys), 0.0

    factor = 0.0
    cx = 0.0
    cy = 0.0
    for idx in range(len(ring)):
        x1, y1 = ring[idx]
        x2, y2 = ring[(idx + 1) % len(ring)]
        step = (x1 * y2) - (x2 * y1)
        factor += step
        cx += (x1 + x2) * step
        cy += (y1 + y2) * step

    factor *= 0.5
    cx /= 6.0 * factor
    cy /= 6.0 * factor
    return cx, cy, abs(factor)


def point_in_ring(lng, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def point_in_feature(lng, lat, rings):
    inside = False
    for ring in rings:
        if point_in_ring(lng, lat, ring):
            inside = not inside
    return inside


def load_district_geometries():
    raw = json.loads((RAW_DIR / "tn_districts_bharatmaps.json").read_text(encoding="utf-8-sig"))
    districts = {}
    for feature in raw["features"]:
        district = normalize_district(feature["attributes"]["dtname"])
        rings = feature["geometry"]["rings"]
        min_lng = min(point[0] for ring in rings for point in ring)
        max_lng = max(point[0] for ring in rings for point in ring)
        min_lat = min(point[1] for ring in rings for point in ring)
        max_lat = max(point[1] for ring in rings for point in ring)

        weighted = [ring_centroid(ring) for ring in rings if len(ring) >= 3]
        total_area = sum(item[2] for item in weighted) or 1.0
        centroid_lng = sum(item[0] * item[2] for item in weighted) / total_area
        centroid_lat = sum(item[1] * item[2] for item in weighted) / total_area

        districts[district] = {
            "district": district,
            "rings": rings,
            "bbox": (min_lng, min_lat, max_lng, max_lat),
            "centroid": (centroid_lat, centroid_lng),
        }
    return districts


def halton(index, base):
    result = 0.0
    factor = 1.0 / base
    current = index
    while current > 0:
        result += factor * (current % base)
        current //= base
        factor /= base
    return result


def generate_points_in_district(geometry, count, seed_offset):
    min_lng, min_lat, max_lng, max_lat = geometry["bbox"]
    rings = geometry["rings"]
    centroid_lat, centroid_lng = geometry["centroid"]
    points = []
    attempt = 1

    while len(points) < count and attempt <= count * 500:
        lng = min_lng + (max_lng - min_lng) * halton(attempt + seed_offset, 2)
        lat = min_lat + (max_lat - min_lat) * halton(attempt + seed_offset, 3)
        if point_in_feature(lng, lat, rings):
            points.append((lat, lng))
        attempt += 1

    while len(points) < count:
        idx = len(points) + 1
        angle = (idx / max(count, 1)) * math.pi * 2.0
        radius = 0.02 + (idx % 5) * 0.01
        lat = centroid_lat + math.sin(angle) * radius
        lng = centroid_lng + math.cos(angle) * radius
        if point_in_feature(lng, lat, rings):
            points.append((lat, lng))
        else:
            points.append((centroid_lat, centroid_lng))

    return points


def haversine_km(lat1, lng1, lat2, lng2):
    radius = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def jitter_point(lat, lng, seed_value, radius_km):
    rng = random.Random(seed_value)
    angle = rng.random() * math.pi * 2.0
    distance_km = radius_km * (0.12 + rng.random() * 0.28)
    dlat = distance_km / 111.0
    dlng = distance_km / max(20.0, 111.0 * math.cos(math.radians(lat)))
    return lat + math.sin(angle) * dlat, lng + math.cos(angle) * dlng


def infer_profile(district):
    tags = []
    if district in URBAN_DISTRICTS:
        tags.append("urban")
    if district in COASTAL_DISTRICTS:
        tags.append("coastal")
    if district in HIGHWAY_DISTRICTS:
        tags.append("highway")
    if district in INDUSTRIAL_DISTRICTS:
        tags.append("industrial")
    if district in HILL_TOURISM_DISTRICTS:
        tags.append("tourism")
    return ",".join(tags) or "mixed"


def district_category_multiplier(district, category):
    multiplier = 1.0

    if district in URBAN_DISTRICTS and category in {"Property", "Fraud", "Women Safety"}:
        multiplier *= 1.28
    if district in HIGHWAY_DISTRICTS and category in {"Accident", "Property", "Public Order"}:
        multiplier *= 1.24
    if district in COASTAL_DISTRICTS and category in {"NDPS", "Excise Act", "Accident"}:
        multiplier *= 1.22
    if district in INDUSTRIAL_DISTRICTS and category in {"Fraud", "Property", "Accident"}:
        multiplier *= 1.16
    if district in HILL_TOURISM_DISTRICTS and category in {"Accident", "Property", "Women Safety"}:
        multiplier *= 1.12
    if district in COASTAL_DISTRICTS and category in {"ITPA", "Excise Act"}:
        multiplier *= 1.16
    if district in HIGHWAY_DISTRICTS and category in {"Arms Act", "Goonda Act"}:
        multiplier *= 1.1
    if district in INDUSTRIAL_DISTRICTS and category in {"Mining Act", "Fraud"}:
        multiplier *= 1.12

    return multiplier


def taluk_keyword_multiplier(taluk_name, category):
    multiplier = 1.0
    keywords = normalize_text(taluk_name)

    if any(term in keywords for term in ("NORTH", "SOUTH", "EAST", "WEST", "CITY")):
        if category in {"Property", "Fraud", "Women Safety"}:
            multiplier *= 1.12
    if any(term in keywords for term in ("HILLS", "KODAIKANAL", "VALPARAI", "YERCAUD")):
        if category in {"Accident", "Property"}:
            multiplier *= 1.16
    if any(term in keywords for term in ("PORT", "NAGAPATTINAM", "RAMESHWARAM")):
        if category in {"Excise Act", "NDPS", "Accident"}:
            multiplier *= 1.14
    if any(term in keywords for term in ("NORTH", "SOUTH", "EAST", "WEST")):
        if category in {"Burglary", "Kidnapping"}:
            multiplier *= 1.08
    if any(term in keywords for term in ("HILLS", "KALVARAYAN", "SATHYAMANGALAM")):
        if category in {"Goonda Act", "Arms Act", "NDPS"}:
            multiplier *= 1.1

    return multiplier


def pick_weighted(items, rng):
    roll = rng.random()
    cumulative = 0.0
    for value, weight in items:
        cumulative += weight
        if roll <= cumulative:
            return value
    return items[-1][0]


def load_osm_station_candidates(district_geometries):
    candidates = defaultdict(list)
    raw = json.loads((RAW_DIR / "tn_police_osm_simple.json").read_text(encoding="utf-8-sig"))
    unnamed_count = defaultdict(int)

    for item in raw:
        lat = item.get("lat")
        lng = item.get("lng")
        if lat is None or lng is None:
            continue

        district = None
        for district_name, geometry in district_geometries.items():
            min_lng, min_lat, max_lng, max_lat = geometry["bbox"]
            if lng < min_lng or lng > max_lng or lat < min_lat or lat > max_lat:
                continue
            if point_in_feature(lng, lat, geometry["rings"]):
                district = district_name
                break

        if not district:
            continue

        name = normalize_text(item.get("name") or "")
        if not name or name == "POLICE STATION":
            unnamed_count[district] += 1
            name = f"{district} PATROL UNIT {unnamed_count[district]}"

        candidates[district].append(
            {
                "name": name,
                "district": district,
                "lat": float(lat),
                "lng": float(lng),
            }
        )

    deduped = {}
    for district, stations in candidates.items():
        seen = set()
        clean = []
        for station in stations:
            key = (station["name"], round(station["lat"], 4), round(station["lng"], 4))
            if key in seen:
                continue
            seen.add(key)
            clean.append(station)
        deduped[district] = clean
    return deduped


def build_operational_layers():
    taluk_rows = load_taluk_rows()
    district_geometries = load_district_geometries()
    station_candidates = load_osm_station_candidates(district_geometries)

    grouped_taluks = defaultdict(list)
    for row in taluk_rows:
        grouped_taluks[row["district"]].append(row["taluk"])

    districts = []
    taluks = []
    stations = []

    for district in sorted(grouped_taluks):
        geometry = district_geometries[district]
        taluk_names = sorted(set(grouped_taluks[district]))
        points = generate_points_in_district(
            geometry=geometry,
            count=len(taluk_names),
            seed_offset=abs(hash(district)) % 1000,
        )
        available_stations = list(station_candidates.get(district, []))
        centroid_lat, centroid_lng = geometry["centroid"]
        profile = infer_profile(district)

        districts.append(
            {
                "district": district,
                "lat": centroid_lat,
                "lng": centroid_lng,
                "taluk_count": len(taluk_names),
                "profile": profile,
            }
        )

        for idx, taluk_name in enumerate(taluk_names, start=1):
            lat, lng = points[idx - 1]
            coordinate_override = get_coordinate_override(district, taluk_name)
            taluk_source_type = "generated"
            if coordinate_override:
                lat = coordinate_override["lat"]
                lng = coordinate_override["lng"]
                taluk_source_type = coordinate_override.get("source_type", "verified")
            taluk_id = f"TLK-{slugify(district)}-{idx:03d}"
            radius_km = 7 + (idx % 5) * 1.4
            if district in URBAN_DISTRICTS:
                radius_km *= 0.78
            elif district in COASTAL_DISTRICTS or district in HILL_TOURISM_DISTRICTS:
                radius_km *= 1.08

            selected_station = None
            if available_stations:
                selected_station = min(
                    available_stations,
                    key=lambda item: haversine_km(lat, lng, item["lat"], item["lng"]),
                )
                available_stations.remove(selected_station)

            if selected_station:
                station_name = selected_station["name"]
                station_lat = selected_station["lat"]
                station_lng = selected_station["lng"]
                source_type = "osm"
                coverage_priority = 2
            else:
                station_name = f"{taluk_name} SERVICE UNIT"
                station_lat, station_lng = jitter_point(
                    lat, lng, f"{taluk_id}|fallback-station", 2.5
                )
                source_type = "generated"
                coverage_priority = 1

            station_id = f"PS-{slugify(district)}-{idx:03d}"

            taluks.append(
                {
                    "taluk_id": taluk_id,
                    "district": district,
                    "taluk": taluk_name,
                    "lat": lat,
                    "lng": lng,
                    "radius_km": round(radius_km, 2),
                    "primary_station_id": station_id,
                    "source_type": taluk_source_type,
                    "profile": profile,
                }
            )
            stations.append(
                {
                    "station_id": station_id,
                    "station_name": station_name,
                    "district": district,
                    "taluk": taluk_name,
                    "lat": station_lat,
                    "lng": station_lng,
                    "source_type": source_type,
                    "coverage_priority": coverage_priority,
                }
            )

    station_count_map = defaultdict(int)
    for station in stations:
        station_count_map[station["district"]] += 1
    for district in districts:
        district["station_count"] = station_count_map[district["district"]]

    return districts, taluks, stations


def base_zone_intensity(taluk_record):
    district = taluk_record["district"]
    taluk_name = taluk_record["taluk"]
    base = 8.0

    if district in URBAN_DISTRICTS:
        base += 5.0
    if district in HIGHWAY_DISTRICTS:
        base += 2.8
    if district in COASTAL_DISTRICTS:
        base += 2.1
    if district in INDUSTRIAL_DISTRICTS:
        base += 2.4
    if district in HILL_TOURISM_DISTRICTS:
        base += 1.4

    keywords = normalize_text(taluk_name)
    if any(term in keywords for term in ("NORTH", "SOUTH", "EAST", "WEST", "CHENNAI", "MADURAI", "COIMBATORE")):
        base += 2.2
    if any(term in keywords for term in ("PORT", "HILLS", "KODAIKANAL", "VALPARAI", "YERCAUD")):
        base += 1.4

    return base


def minimum_accident_count(taluk_record, year, month):
    floor = 3

    if taluk_record["district"] in URBAN_DISTRICTS:
        floor += 1
    if taluk_record["district"] in HIGHWAY_DISTRICTS:
        floor += 2
    if taluk_record["district"] in COASTAL_DISTRICTS:
        floor += 1
    if taluk_record["district"] in HILL_TOURISM_DISTRICTS:
        floor += 1
    if month in {9, 10, 11, 12}:
        floor += 1
    if year == 2026:
        floor += 1

    return floor


def build_incidents(taluks, station_by_id):
    incidents = []

    for taluk in taluks:
        station = station_by_id[taluk["primary_station_id"]]
        base_intensity = base_zone_intensity(taluk)

        for year in YEARS:
            year_growth = {2024: 0.94, 2025: 1.0, 2026: 1.08}[year]
            for month in range(1, 13):
                for category, config in CATEGORY_CONFIG.items():
                    code_options = CATEGORY_CODES.get(category, [])
                    if not code_options:
                        continue
                    rng = random.Random(
                        f"{taluk['taluk_id']}|{category}|{year}|{month}"
                    )
                    count = int(
                        round(
                            base_intensity
                            * config["base"]
                            * district_category_multiplier(taluk["district"], category)
                            * taluk_keyword_multiplier(taluk["taluk"], category)
                            * config["month"][month - 1]
                            * year_growth
                            * (0.84 + rng.random() * 0.42)
                        )
                    )

                    if category == "Accident":
                        count = max(
                            minimum_accident_count(taluk, year, month),
                            count,
                        )

                    if count <= 0:
                        continue

                    time_slot = pick_weighted(config["time_slots"], rng)
                    if category in {"Public Order", "Accident"}:
                        day_of_week = rng.choices(range(1, 8), weights=[0.11, 0.11, 0.12, 0.13, 0.15, 0.2, 0.18], k=1)[0]
                    elif category in {"Fraud"}:
                        day_of_week = rng.choices(range(1, 8), weights=[0.17, 0.17, 0.17, 0.17, 0.17, 0.08, 0.07], k=1)[0]
                    else:
                        day_of_week = rng.randint(1, 7)

                    incident_date = f"{year}-{month:02d}-{rng.randint(1, 28):02d}"
                    lat, lng = jitter_point(
                        taluk["lat"],
                        taluk["lng"],
                        f"{taluk['taluk_id']}|{category}|{incident_date}",
                        max(2.5, taluk["radius_km"] / 2.2),
                    )
                    legal_entry = rng.choice(code_options)

                    incidents.append(
                        {
                            "district": taluk["district"],
                            "taluk_id": taluk["taluk_id"],
                            "taluk": taluk["taluk"],
                            "station_id": station["station_id"],
                            "station_name": station["station_name"],
                            "lat": round(lat, 6),
                            "lng": round(lng, 6),
                            "law_name": legal_entry["law_name"],
                            "ipc_section": legal_entry["ipc_section"],
                            "category": category,
                            "severity": legal_entry["severity"],
                            "year": year,
                            "month": month,
                            "day_of_week": day_of_week,
                            "time_slot": time_slot,
                            "incident_date": incident_date,
                            "source_type": "synthetic",
                            "count": count,
                        }
                    )

    return incidents


def score_from_total(total, maximum):
    if maximum <= 0:
        return 20
    return round(20 + (total / maximum) * 75, 1)


def level_from_score(score):
    if score >= 70:
        return "HIGH"
    if score >= 42:
        return "MEDIUM"
    return "LOW"


def build_hotspots_and_routes(taluks, incidents):
    totals = defaultdict(lambda: {"count": 0, "categories": defaultdict(int)})
    taluk_lookup = {row["taluk_id"]: row for row in taluks}

    for record in incidents:
        zone = totals[record["taluk_id"]]
        zone["count"] += record["count"]
        zone["categories"][record["category"]] += record["count"]

    max_total = max((value["count"] for value in totals.values()), default=1)
    hotspots = []
    district_buckets = defaultdict(list)

    for taluk_id, aggregate in totals.items():
        taluk = taluk_lookup[taluk_id]
        top_crime = max(aggregate["categories"], key=aggregate["categories"].get)
        score = score_from_total(aggregate["count"], max_total)
        risk_level = level_from_score(score)
        hotspots.append(
            {
                "taluk_id": taluk_id,
                "district": taluk["district"],
                "zone_name": taluk["taluk"],
                "center_lat": taluk["lat"],
                "center_lng": taluk["lng"],
                "radius_km": round(max(5.0, taluk["radius_km"] * 0.95), 2),
                "risk_level": risk_level,
                "risk_score": score,
                "crime_count": aggregate["count"],
                "top_crime": top_crime,
            }
        )
        district_buckets[taluk["district"]].append(
            {
                "lat": taluk["lat"],
                "lng": taluk["lng"],
                "score": score,
                "name": taluk["taluk"],
            }
        )

    patrol_routes = []
    for district, points in district_buckets.items():
        selected = sorted(points, key=lambda item: item["score"], reverse=True)[:4]
        selected = sorted(selected, key=lambda item: (item["lng"], item["lat"]))
        if len(selected) < 2:
            continue
        path = [{"lat": round(item["lat"], 6), "lng": round(item["lng"], 6), "name": item["name"]} for item in selected]
        avg_score = sum(item["score"] for item in selected) / len(selected)
        patrol_routes.append(
            {
                "route_id": f"PATROL-{slugify(district)}",
                "district": district,
                "route_name": f"{district} HOTSPOT PATROL",
                "risk_level": level_from_score(avg_score),
                "path_json": json.dumps(path),
                "source_type": "generated",
            }
        )

    return hotspots, patrol_routes


def seed_operational_data(force=False):
    init_db()
    seed_ipc_categories()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT value FROM app_meta WHERE key = 'data_seed_version'"
    )
    row = cursor.fetchone()
    if row and row["value"] == DATA_SEED_VERSION and not force:
        conn.close()
        print("Operational data already seeded")
        return

    districts, taluks, stations = build_operational_layers()
    station_by_id = {row["station_id"]: row for row in stations}
    incidents = build_incidents(taluks, station_by_id)
    hotspots, patrol_routes = build_hotspots_and_routes(taluks, incidents)

    cursor.execute("DELETE FROM districts")
    cursor.execute("DELETE FROM taluks")
    cursor.execute("DELETE FROM police_stations")
    cursor.execute("DELETE FROM fir_records")
    cursor.execute("DELETE FROM hotspot_zones")
    cursor.execute("DELETE FROM patrol_routes")

    cursor.executemany(
        """
        INSERT INTO districts
        (district, lat, lng, taluk_count, station_count, profile, source_type)
        VALUES (:district, :lat, :lng, :taluk_count, :station_count, :profile, 'official')
        """,
        districts,
    )

    cursor.executemany(
        """
        INSERT INTO taluks
        (taluk_id, district, taluk, lat, lng, radius_km, primary_station_id, source_type)
        VALUES (:taluk_id, :district, :taluk, :lat, :lng, :radius_km, :primary_station_id, :source_type)
        """,
        taluks,
    )

    cursor.executemany(
        """
        INSERT INTO police_stations
        (station_id, station_name, district, taluk, lat, lng, source_type, coverage_priority)
        VALUES (:station_id, :station_name, :district, :taluk, :lat, :lng, :source_type, :coverage_priority)
        """,
        stations,
    )

    cursor.executemany(
        """
        INSERT INTO fir_records
        (district, taluk_id, taluk, station_id, station_name, lat, lng, law_name, ipc_section,
         category, severity, year, month, day_of_week, time_slot, incident_date,
         source_type, count)
        VALUES (:district, :taluk_id, :taluk, :station_id, :station_name, :lat, :lng,
                :law_name, :ipc_section, :category, :severity, :year, :month, :day_of_week,
                :time_slot, :incident_date, :source_type, :count)
        """,
        incidents,
    )

    cursor.executemany(
        """
        INSERT INTO hotspot_zones
        (taluk_id, district, zone_name, center_lat, center_lng, radius_km,
         risk_level, risk_score, crime_count, top_crime)
        VALUES (:taluk_id, :district, :zone_name, :center_lat, :center_lng, :radius_km,
                :risk_level, :risk_score, :crime_count, :top_crime)
        """,
        hotspots,
    )

    cursor.executemany(
        """
        INSERT INTO patrol_routes
        (route_id, district, route_name, risk_level, path_json, source_type)
        VALUES (:route_id, :district, :route_name, :risk_level, :path_json, :source_type)
        """,
        patrol_routes,
    )

    cursor.execute(
        """
        INSERT INTO app_meta(key, value)
        VALUES('data_seed_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (DATA_SEED_VERSION,),
    )

    conn.commit()
    conn.close()
    print(
        f"Operational seed complete | districts={len(districts)} "
        f"taluks={len(taluks)} stations={len(stations)} incidents={len(incidents)}"
    )


if __name__ == "__main__":
    seed_operational_data(force=True)
