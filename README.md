# ☤ Hermes Agent · SAIRI edition

[![Docker](https://github.com/sairidev/hermes/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/sairidev/hermes/actions/workflows/docker-publish.yml)
![Image](https://img.shields.io/badge/image-ghcr.io%2Fsairidev%2Fhermes-blue)
![Pterodactyl](https://img.shields.io/badge/Pterodactyl-ready-7c5cff)
![License](https://img.shields.io/badge/license-MIT-green)

**Hermes Agent** yang dikemas menjadi web app: dashboard dan chat langsung dari browser, siap dijalankan di **Pterodactyl**, VPS, atau Docker.

Repo ini **tidak menjalankan model AI sendiri**. Semua model diambil dari **9Router**, gateway yang berjalan terpisah dan meneruskan permintaan ke Claude, GPT, Gemini, dan 60+ provider lainnya.

```
 Browser ──▶ ☤ Hermes Agent ──── /v1 + API key ────▶ 🧠 9Router ──▶ Claude · GPT · Gemini · 60+
             (repo ini)                                (repo terpisah)
```

---

## Apa itu Hermes Agent?

Hermes Agent adalah AI agent open-source buatan Nous Research. Berbeda dengan chatbot biasa, Hermes bisa **mengerjakan tugas sendiri** di server tempat dia berjalan: menjalankan perintah, mengolah file, menulis kode, mencari informasi, lalu mengingat dan belajar dari pekerjaan sebelumnya.

## Fitur

- **Web dashboard + Chat**: percakapan, riwayat sesi, pengaturan, memori, dan jadwal, semua dari browser, dengan login wajib.
- **Terhubung ke 9Router**: satu URL dan API key untuk mengakses banyak provider, termasuk combo dan fallback otomatis milik 9Router.
- **Cek koneksi otomatis**: status 9Router, API key, dan nama model diperiksa setiap kali start.
- **Kemampuan agent**: terminal dan file, skills yang bisa berkembang sendiri, memori jangka panjang, tugas terjadwal (cron), dan integrasi MCP.
- **Bot chat**: Hermes bisa dijadikan bot Telegram atau Discord lewat gateway bawaan.
- **Siap Pterodactyl**: image dengan banner HERMES, info sistem, status 9Router, dan pilihan start y/n, seperti 9Router SAIRI edition.
- **Ringan di panel**: semua di-build di GitHub Actions, sehingga server cukup menarik image jadi (RAM sekitar 330 MB saat berjalan).

## Isi repo

| Path | Isi |
|---|---|
| `hermes/` | Source Hermes Agent (versi ramping: tanpa test, website, dan aplikasi desktop) |
| `launcher/`, `index.js` | Launcher Node.js: menyiapkan Python + dashboard, menghubungkan ke 9Router, menjalankan dan menjaga Hermes |
| `docker/` | `Dockerfile` multi-stage, `entrypoint.sh` (banner + y/n), dan egg Pterodactyl |
| `.github/workflows/` | Build, tes (mode Docker dan simulasi Pterodactyl), lalu publish image ke GHCR |
| `docker-compose.yml` | Konfigurasi untuk VPS |
| `.env.example` | Daftar semua pengaturan |

## Teknologi

Hermes Agent (Python 3.14) · Node.js 22 · uv · Docker multi-stage · GitHub Actions · GitHub Container Registry

## Terkait

- **9Router**: gateway model AI yang dipakai repo ini sebagai sumber model (repo terpisah).
- **[Hermes Agent](https://github.com/NousResearch/hermes-agent)**: proyek asli dari Nous Research.

## Lisensi

MIT. Hermes Agent © Nous Research (lihat `hermes/LICENSE`).
