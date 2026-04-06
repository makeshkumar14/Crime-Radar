from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from models import seed_ipc_categories
from seed_operational_data import seed_operational_data
from routes import fir, hotspots, crimes, predict, heatmap

app = FastAPI(
    title="CrimeRadar API",
    description="Crime Hotspot Mapping for Tamil Nadu Police · RedShield 2026",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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
app.include_router(heatmap.router,  prefix="/api/heatmap",  tags=["Heatmap"])
