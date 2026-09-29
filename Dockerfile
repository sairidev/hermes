# Hermes Agent (web) — image untuk VPS / Docker.
# Python 3.14, venv Hermes, dan dashboard di-bake saat build; data di volume /data.
# Model diambil dari 9Router yang jalan terpisah (NINEROUTER_URL + NINEROUTER_API_KEY).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git tar xz-utils procps \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 10001 app && mkdir -p /data /app && chown app:app /data /app
WORKDIR /app
COPY --chown=app:app . .
USER app

ENV HOME=/home/app \
    DATA_DIR=/data \
    RUNTIME_DIR=/app/.runtime \
    PORT=3000 \
    HOST=0.0.0.0

# Tidak menyimpan password/secret apa pun di image (--setup-only melewati itu).
RUN node index.js --setup-only

EXPOSE 3000
VOLUME ["/data"]
STOPSIGNAL SIGTERM
CMD ["node", "index.js"]
