# Hermes Agent · SAIRI edition (Docker + Pterodactyl)

Image Docker untuk Hermes Agent (web dashboard + chat) yang siap dipakai di **Pterodactyl / Pelican**, dan juga bisa dipakai di Docker biasa. Model AI diambil dari **9Router** yang berjalan terpisah.

Hermes **di-build di GitHub Actions**, bukan di panel. Server panel cukup menarik image yang sudah jadi, tanpa install Python, `npm ci`, atau build dashboard. Karena itu image ini cocok untuk server dengan RAM 1 GB.

## Isi folder `docker/`

| File | Fungsi |
|---|---|
| `Dockerfile` | Stage 1: Python 3.14 + dependency Hermes + build dashboard/Chat. Stage 2: image runtime (Node 22) yang hanya berisi hasil jadinya |
| `entrypoint.sh` | Banner HERMES + info sistem + status 9Router, tanya y/n, lalu menjalankan Hermes (mode Pterodactyl / headless / shell) |
| `egg-hermes.json` | Egg Pterodactyl siap import (image `ghcr.io/sairidev/hermes:latest`) |

Workflow `.github/workflows/docker-publish.yml` mem-build image setiap push ke `main`, lalu **mengetesnya** dua kali: sekali sebagai Docker biasa, sekali meniru Pterodactyl (UID lain, `/home/container` kosong, `STARTUP` dari egg). Kalau lolos, image diterbitkan ke GHCR dan commit mendapat centang ✓.

## Perintah di dalam image

| Perintah | Fungsi |
|---|---|
| `hermes-web` | Launcher: dashboard + chat Hermes di `SERVER_PORT` / `PORT` |
| `hermes` | CLI Hermes (mis. `hermes chat`), memakai data & config yang sama |

## Environment variable

| Variabel | Fungsi | Default |
|---|---|---|
| `NINEROUTER_URL` | Alamat 9Router, mis. `http://IP:20128` atau `https://9router.domain.com` | kosong |
| `NINEROUTER_API_KEY` | API key dari dashboard 9Router → API Keys | kosong |
| `HERMES_MODEL` | ID model / nama combo di 9Router | `kr/claude-sonnet-4.5` |
| `ADMIN_PASSWORD` | Password login dashboard (username `admin`) | acak, tampil di console |
| `HERMES_GATEWAY` | `true` = jalankan bot Telegram/Discord | `false` |
| `SERVER_PORT` / `PORT` | Port web | `3000` |
| `SHOW_IP` | `true` menampilkan IP publik di banner (berlaku setelah restart) | `false` |
| `START_PROMPT_TIMEOUT` | Detik menunggu jawaban y/n sebelum otomatis `y` | `30` |

Selain lewat variabel, pengaturan juga bisa ditulis di `/home/container/.env`, yang dibuat otomatis saat start pertama. Variabel panel selalu mengalahkan `.env`.

Semua data ada di `/home/container`: `.env` dan `data/` (config Hermes, sesi, memori, `secrets.json`). Folder `/opt/hermes-web` read-only dan ikut diganti setiap kali image diperbarui.

## Pterodactyl

1. Admin → **Nests → Import Egg** → `docker/egg-hermes.json`.
2. Buat server dengan egg **Hermes Agent · SAIRI**. Minimal RAM 768 MB, disk 1 GB.
3. Isi **URL 9Router**, **API Key 9Router**, **Model**, dan **Admin Password**, lalu **Start**.
4. Jawab `y` (atau tunggu) → console menampilkan `Hermes siap dipakai` → buka `http://IP:PORT/`.

Kalau menjawab `n`, Hermes tidak dijalankan dan kamu mendapat shell (`hermes-web` untuk menjalankan, `hermes chat` untuk chat di terminal).

> Package GHCR harus **Public** agar node Pterodactyl bisa menarik image tanpa login:
> GitHub → Packages → `hermes` → Package settings → Change visibility → Public.

## Docker biasa / VPS

```bash
docker run -d --name hermes --restart unless-stopped -p 3000:3000 \
  -e NINEROUTER_URL=http://IP-9ROUTER:20128 \
  -e NINEROUTER_API_KEY=sk-... \
  -e HERMES_MODEL=kr/claude-sonnet-4.5 \
  -e ADMIN_PASSWORD=password-kuat \
  -v hermes-data:/home/container \
  ghcr.io/sairidev/hermes:latest
```

Bisa juga pakai `docker compose up -d` dengan `docker-compose.yml` di root repo.

Build sendiri dari source:

```bash
docker build -f docker/Dockerfile -t hermes-sairi .
```

## Update

Update = build image baru (push ke `main` atau buat tag `vX.Y.Z`), lalu **Restart** server di panel supaya image terbaru ditarik. Data di `/home/container` tetap aman.
