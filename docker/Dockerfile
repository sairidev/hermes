# syntax=docker/dockerfile:1.7
#
# Hermes Agent (web) · SAIRI edition (Pterodactyl / Pelican ready)
#
# Build dari ROOT repo:
#   docker build -f docker/Dockerfile -t hermes-sairi .
#
# Stage 1 memasang Python 3.14 + dependency Hermes dan mem-build dashboard +
# Chat (butuh RAM ± 2 GB, aman di GitHub Actions). Stage 2 hanya berisi hasil
# jadinya, jadi panel tidak perlu install/build apa pun (cocok untuk RAM 1 GB).
# Model AI diambil dari 9Router yang berjalan terpisah (NINEROUTER_URL).

ARG NODE_IMAGE=node:22-bookworm-slim
# Extra Python yang ikut di-bake (telegram/discord = bot gateway siap pakai)
ARG HERMES_EXTRAS=web,pty,mcp,telegram,discord

# ---------------------------------------------------------------- builder ---
FROM ${NODE_IMAGE} AS builder
ARG HERMES_EXTRAS

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git tar xz-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/hermes-web
COPY package.json index.js .env.example ./
COPY launcher/ launcher/
COPY hermes/ hermes/

# --setup-only: uv (pin + sha256) → Python 3.14 → uv sync --frozen → build web + TUI.
# Tidak ada password/secret yang tersimpan di image.
ENV HOME=/root \
    RUNTIME_DIR=/opt/hermes-web/.runtime \
    DATA_DIR=/tmp/build-data \
    HERMES_EXTRAS=${HERMES_EXTRAS} \
    UV_COMPILE_BYTECODE=1 \
    CLEAN_BUILD_DEPS=true \
    BUILD_MEMORY_MB=3072
# Setelah itu: uv & cache build dibuang (hanya perlu saat build), lalu bytecode
# Hermes + Python dibuat sekarang karena /opt read-only di panel (start lebih cepat).
RUN node index.js --setup-only \
    && rm -rf .runtime/tools .runtime/tmp .runtime/npm-cache .runtime/uv-cache /tmp/build-data \
    && (.runtime/venv/bin/python -m compileall -q -j 0 hermes .runtime/python >/dev/null 2>&1 || true)

# ---------------------------------------------------------------- runtime ---
FROM ${NODE_IMAGE} AS runner
ARG HERMES_EXTRAS

LABEL org.opencontainers.image.title="hermes-sairi" \
      org.opencontainers.image.description="Hermes Agent web dashboard + chat, connect ke 9Router. Pterodactyl-ready dengan banner & auto start" \
      org.opencontainers.image.licenses="MIT" \
      maintainer="sairidev@gmail.com"

ENV DEBIAN_FRONTEND=noninteractive \
    USER=container \
    HOME=/home/container \
    TZ=UTC \
    PORT=3000 \
    HERMES_WEB_HOME=/opt/hermes-web \
    RUNTIME_DIR=/opt/hermes-web/.runtime \
    DATA_DIR=/home/container/data \
    ENV_FILE=/home/container/.env \
    HERMES_EXTRAS=${HERMES_EXTRAS} \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates git procps iproute2 tzdata jq nano \
    && rm -rf /var/lib/apt/lists/*

# Hasil jadi dari stage builder (path harus sama: venv & editable install memakai path absolut)
COPY --from=builder /opt/hermes-web /opt/hermes-web
COPY docker/entrypoint.sh /entrypoint.sh

# `hermes-web` = launcher (dashboard + chat), `hermes` = CLI Hermes untuk shell.
# chmod a+rX: panel menjalankan container dengan UID miliknya sendiri, jadi semua
# file di /opt harus bisa dibaca siapa saja.
RUN printf '#!/bin/sh\nexec node /opt/hermes-web/index.js "$@"\n' > /usr/local/bin/hermes-web \
    && printf '%s\n' '#!/bin/sh' \
        'DATA="${DATA_DIR:-/home/container/data}"' \
        'export HERMES_HOME="${HERMES_HOME:-$DATA/hermes}"' \
        'export HERMES_RUNTIME_DIR="${HERMES_RUNTIME_DIR:-$DATA/.pm-tools}"' \
        'export HERMES_DISABLE_LAZY_INSTALLS="${HERMES_DISABLE_LAZY_INSTALLS:-1}"' \
        'export HERMES_TUI_DIR="${HERMES_TUI_DIR:-/opt/hermes-web/.runtime/hermes-tui}"' \
        'export HERMES_NODE="${HERMES_NODE:-$(command -v node)}"' \
        'exec /opt/hermes-web/.runtime/venv/bin/hermes "$@"' > /usr/local/bin/hermes \
    && chmod 0755 /usr/local/bin/hermes-web /usr/local/bin/hermes /entrypoint.sh \
    && chmod -R a+rX /opt/hermes-web \
    && useradd -m -d /home/container -s /bin/bash container

USER container
WORKDIR /home/container

# Data (.env, data/: config Hermes, sesi, memori, password) ada di /home/container.
# Pterodactyl otomatis me-mount folder ini untuk setiap server.
EXPOSE 3000

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
