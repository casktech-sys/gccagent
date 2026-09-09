"""
Production entrypoint.

Development runs two processes: uvicorn on 8000 and the Vite dev server on
5173, with Vite proxying `/api` to the API. That is the right shape for
development and the wrong shape for a demo link — two URLs, CORS to configure,
two things a reviewer can find broken.

So production composes one application: the same API mounted under `/api`, and
the built console served at `/`. The client code is identical in both, because
it always calls `/api/...`.

    uvicorn warrant.serve:app --host 0.0.0.0 --port $PORT
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi import Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import app as api_app

CONSOLE_DIR = Path(os.getenv("WARRANT_CONSOLE_DIR", "/srv/console"))

app = FastAPI(title="Warrant", version="0.1.0", docs_url=None, redoc_url=None)
app.mount("/api", api_app)


@app.get("/healthz", include_in_schema=False)
def healthz() -> JSONResponse:
    """Render's health check. Deliberately separate from /api/health, which
    reports ledger state and would fail the deploy for the wrong reasons."""
    return JSONResponse({"status": "ok", "console": CONSOLE_DIR.is_dir()})


if (CONSOLE_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=CONSOLE_DIR / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False, response_model=None)
def spa(path: str) -> Response:
    """
    Serve the console, and hand any unknown path back to it.

    The console routes client-side, so a reload on /ledger must return
    index.html rather than a 404. Real files are served when they exist, so
    favicons and similar still work.
    """
    candidate = (CONSOLE_DIR / path).resolve()
    if path and CONSOLE_DIR.resolve() in candidate.parents and candidate.is_file():
        return FileResponse(candidate)

    index = CONSOLE_DIR / "index.html"
    if index.is_file():
        return FileResponse(index)

    return JSONResponse(
        {"detail": "Console not built. Run `npm run build` in console/, or set "
                   "WARRANT_CONSOLE_DIR to the built output."},
        status_code=503,
    )
