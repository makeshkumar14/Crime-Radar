from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from chatbot_service import load_local_env
from database import init_db
from models import seed_ipc_categories
from routes import chatbot, citizen, crimes, fir, heatmap, hotspots, navigation, predict, reports
from seed_operational_data import seed_operational_data

LOCAL_DEV_ORIGIN_REGEX = r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"

app = FastAPI(
    title="CrimeRadar API",
    description="Crime Hotspot Mapping for Tamil Nadu Police · RedShield 2026",
    version="1.0.0",
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
    load_local_env()
    init_db()
    seed_ipc_categories()
    seed_operational_data()


@app.get("/")
def root():
    return {"status": "CrimeRadar API running"}


app.include_router(fir.router, prefix="/api/fir", tags=["FIR"])
app.include_router(hotspots.router, prefix="/api/hotspots", tags=["Hotspots"])
app.include_router(crimes.router, prefix="/api/crimes", tags=["Crimes"])
app.include_router(predict.router, prefix="/api/predict", tags=["Prediction"])
app.include_router(citizen.router, prefix="/api/citizen", tags=["Citizen"])
app.include_router(navigation.router, prefix="/api/navigation", tags=["Navigation"])
app.include_router(heatmap.router, prefix="/api/heatmap", tags=["Heatmap"])
app.include_router(chatbot.router, prefix="/api/chatbot", tags=["Chatbot"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
