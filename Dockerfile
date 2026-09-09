# ---- stage 1: build the console -------------------------------------------
FROM node:20-alpine AS console
WORKDIR /build
COPY console/package.json console/package-lock.json ./
RUN npm ci
COPY console/ ./
RUN npm run build

# ---- stage 2: runtime ------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WARRANT_CONSOLE_DIR=/srv/console

WORKDIR /srv

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY --from=console /build/dist/ ./console/

# Run unprivileged. Nothing here writes to disk.
RUN useradd --create-home --uid 10001 warrant && chown -R warrant:warrant /srv
USER warrant

ENV PYTHONPATH=/srv/src
EXPOSE 8000

# One worker, deliberately. State is in memory (block B5), so a second worker
# would serve a different set of threads depending on which one you hit.
CMD ["sh", "-c", "uvicorn warrant.serve:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
