from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, auth, billing_notifications, market, plans, portal, trade
from app.seed import init_db
from app.services.tick_upstream import tick_upstream
from app.ws import quotes as ws_quotes

app = FastAPI(
    title="AlphaFX API",
    version="0.2.0",
    description="AlphaFX trader portal backend",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(plans.router, prefix="/api/v1")
app.include_router(portal.router, prefix="/api/v1")
app.include_router(billing_notifications.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(market.router, prefix="/api/v1")
app.include_router(trade.router, prefix="/api/v1")
app.include_router(ws_quotes.router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    tick_upstream.start()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await tick_upstream.stop()


@app.get("/health")
def health():
    return {"status": "ok", "service": "alphafx-api", "version": "0.2.0"}
