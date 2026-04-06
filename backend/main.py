from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from models import seed_ipc_categories
from seed_operational_data import seed_operational_data
from routes import citizen, fir, hotspots, crimes, predict, heatmap

LOCAL_DEV_ORIGIN_REGEX = r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"

app = FastAPI(
    title="CrimeRadar API",
    description="Crime Hotspot Mapping for Tamil Nadu Police · RedShield 2026",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=LOCAL_DEV_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    init_db()
    seed_ipc_categories()
    seed_operational_data()

@app.get("/")
def root():
    return {"status": "CrimeRadar API running"}

app.include_router(fir.router,      prefix="/api/fir",      tags=["FIR"])
app.include_router(hotspots.router, prefix="/api/hotspots", tags=["Hotspots"])
app.include_router(crimes.router,   prefix="/api/crimes",   tags=["Crimes"])
app.include_router(predict.router,  prefix="/api/predict",  tags=["Prediction"])
app.include_router(citizen.router,  prefix="/api/citizen",  tags=["Citizen"])
app.include_router(heatmap.router,  prefix="/api/heatmap",  tags=["Heatmap"])
