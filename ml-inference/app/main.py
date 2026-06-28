"""AegisFlow ML Inference Engine - FastAPI service for PII masking."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from prometheus_client import Counter, Histogram, generate_latest
from pydantic import BaseModel, Field
from starlette.responses import PlainTextResponse

from app.masking import MaskResult, get_engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MASK_REQUESTS = Counter(
    "aegisflow_ml_mask_requests_total",
    "Total mask requests",
    ["status"],
)
MASK_DURATION = Histogram(
    "aegisflow_ml_mask_duration_seconds",
    "Mask operation duration",
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)
ENTITIES_DETECTED = Histogram(
    "aegisflow_ml_entities_detected",
    "Number of PII entities detected per request",
    buckets=[0, 1, 2, 5, 10, 20, 50],
)


class MaskRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=100_000)
    language: str = Field(default="en", max_length=8)


class MaskResponse(BaseModel):
    masked_text: str
    mapping: dict[str, str]
    entities_found: int
    engine: str
    latency_ms: float


class HealthResponse(BaseModel):
    status: str
    engine_ready: bool


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Loading PII masking engine...")
    get_engine()
    logger.info("ML Inference Engine ready")
    yield


app = FastAPI(
    title="AegisFlow ML Inference Engine",
    description="Local PII masking via Presidio + Hugging Face NER",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    try:
        get_engine()
        return HealthResponse(status="healthy", engine_ready=True)
    except Exception as exc:
        logger.error("Health check failed: %s", exc)
        return HealthResponse(status="unhealthy", engine_ready=False)


@app.post("/mask", response_model=MaskResponse)
async def mask_text(request: MaskRequest) -> MaskResponse:
    start = time.perf_counter()
    try:
        engine = get_engine()
        result: MaskResult = engine.mask(request.text)
        latency_ms = (time.perf_counter() - start) * 1000

        MASK_REQUESTS.labels(status="success").inc()
        MASK_DURATION.observe(latency_ms / 1000)
        ENTITIES_DETECTED.observe(result.entities_found)

        return MaskResponse(
            masked_text=result.masked_text,
            mapping=result.mapping,
            entities_found=result.entities_found,
            engine=result.engine,
            latency_ms=round(latency_ms, 2),
        )
    except Exception as exc:
        MASK_REQUESTS.labels(status="error").inc()
        logger.exception("Masking failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/mask/batch")
async def mask_batch(texts: list[str]) -> list[dict[str, Any]]:
    engine = get_engine()
    results = []
    for text in texts:
        result = engine.mask(text)
        results.append(
            {
                "masked_text": result.masked_text,
                "mapping": result.mapping,
                "entities_found": result.entities_found,
            }
        )
    return results


@app.get("/metrics")
async def metrics() -> PlainTextResponse:
    return PlainTextResponse(generate_latest(), media_type="text/plain")
