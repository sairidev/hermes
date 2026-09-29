# Hermes Agent · SAIRI edition (Docker + Pterodactyl)

Image Docker untuk Hermes Agent (web dashboard + chat) yang dibuat untuk **Pterodactyl / Pelican** dan juga bisa berjalan di Docker biasa. Model AI diambil dari **9Router** yang berjalan terpisah.

Semua proses berat (Python 3.14, dependency Hermes, build dashboard dan Chat) dikerjakan di **GitHub Actions**. Server panel hanya menarik image yang sudah jadi, sehingga cocok untuk server kecil (RAM sekitar 330 MB saat berjalan).

Image: `ghcr.io/sairidev/hermes:latest`

## Isi folder `docker/`

| File | Isi |
|---|---|
| `Dockerfile` | Multi-stage. Stage 1 memasang Python 3.14 + dependency Hermes dan mem-build dashboard/Chat. Stage 2 adalah image runtime (Node 22) yang hanya berisi hasil jadinya |
| `entrypoint.sh` | Banner HERMES, info sistem (lokasi, OS, CPU, RAM, disk), status koneksi 9Router, pertanyaan y/n, lalu menjalankan Hermes dalam mode Pterodactyl, headless, atau shell |
| `egg-hermes.json` | Egg Pterodactyl yang memakai image di atas |

Workflow `.github/workflows/docker-publish.yml` mem-build image setiap ada push ke `main`, lalu mengetesnya dua kali: sebagai Docker biasa dan sebagai simulasi Pterodactyl (UID lain, `/home/container` kosong, `STARTUP` dari egg). Image hanya diterbitkan ke GHCR kalau kedua tes lolos.

## Perintah di dalam image

| Perintah | Fungsi |
|---|---|
| `hermes-web` | Launcher: dashboard + chat Hermes di `SERVER_PORT` / `PORT` |
| `hermes` | CLI Hermes (misalnya `hermes chat`), memakai data dan config yang sama |

## Environment variable

| Variabel | Fungsi | Default |
|---|---|---|
| `NINEROUTER_URL` | Alamat 9Router | kosong |
| `NINEROUTER_API_KEY` | API key dari 9Router | kosong |
| `HERMES_MODEL` | ID model / nama combo di 9Router | `kr/claude-sonnet-4.5` |
| `ADMIN_PASSWORD` | Password dashboard (username `admin`) | acak, tampil di console |
| `HERMES_GATEWAY` | `true` = bot Telegram/Discord aktif | `false` |
| `SERVER_PORT` / `PORT` | Port web | `3000` |
| `SHOW_IP` | `true` = IP publik tampil di banner | `false` |
| `START_PROMPT_TIMEOUT` | Detik menunggu jawaban y/n sebelum otomatis `y` | `30` |

## Lokasi data

| Path | Isi |
|---|---|
| `/home/container/.env` | Pengaturan tambahan (dibuat otomatis; variabel panel selalu lebih diutamakan) |
| `/home/container/data/` | Config Hermes, sesi, memori, dan `secrets.json` |
| `/opt/hermes-web/` | Aplikasi (read-only, ikut diganti setiap image diperbarui) |
