from __future__ import annotations

from fastapi import FastAPI

from . import __version__
from .ib_async_adapter import LazyIbAsyncMarketDataAdapter
from .models import DesiredGenerationRequest, GenerationStatusResponse, HealthResponse
from .registry import MarketDataRegistry, utc_now_iso


def create_app(registry: MarketDataRegistry | None = None) -> FastAPI:
    sidecar_registry = registry or MarketDataRegistry(LazyIbAsyncMarketDataAdapter.from_env())
    app = FastAPI(title="PYRUS IBKR Sidecar", version=__version__)

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        lines = sidecar_registry.lines
        live = [line for line in lines if line.state == "live"]
        return HealthResponse(
            ok=True,
            version=__version__,
            appliedGenerationId=sidecar_registry.applied_generation_id,
            liveLineCount=len(live),
            failedLineCount=sum(1 for line in lines if line.state == "failed"),
        )

    @app.get("/market-data/generation", response_model=GenerationStatusResponse)
    async def get_market_data_generation() -> GenerationStatusResponse:
        return GenerationStatusResponse.from_registry(
            sidecar_registry,
            updated_at=utc_now_iso(),
        )

    @app.post("/market-data/generation", response_model=GenerationStatusResponse)
    async def apply_market_data_generation(
        request: DesiredGenerationRequest,
    ) -> GenerationStatusResponse:
        await sidecar_registry.apply_generation(request.to_registry_generation())
        return GenerationStatusResponse.from_registry(
            sidecar_registry,
            updated_at=utc_now_iso(),
            generation_id=request.generation_id,
        )

    return app


app = create_app()
