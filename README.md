# ☤ Hermes Agent (web) — pakai 9Router

Hermes Agent yang dikemas seperti 9Router: **satu perintah `node index.js`**, ada **web dashboard**, dan siap di-deploy ke **GitHub**, **Pterodactyl**, atau **Docker**.

Hermes di sini **tidak menjalankan model sendiri**. Semua model diambil dari **9Router kamu yang berjalan terpisah** (repo, server, atau panel lain).

```
 Browser ──▶ ☤ Hermes (repo ini) ──── API /v1 + API key ────▶ 🧠 9Router (repo terpisah) ──▶ Claude · GPT · Gemini · 60+
             dashboard + chat                                   provider, combo, kuota
```

- `http://IP:PORT/` → dashboard + **Chat** Hermes (wajib login)
- Hermes connect ke 9Router lewat `NINEROUTER_URL` + `NINEROUTER_API_KEY`

---

## Isi repo

| Path | Fungsi |
|---|---|
| `index.js`, `launcher/` | Launcher: install otomatis, cek koneksi 9Router, jalankan Hermes, halaman "sedang menyiapkan" |
| `hermes/` | Source Hermes Agent (dirampingkan: tanpa test, website, dan aplikasi desktop) |
| `docker/Dockerfile` | Image siap pakai (multi-stage), di-build di GitHub Actions |
| `docker/entrypoint.sh` | Banner HERMES + info sistem + status 9Router, tanya y/n, lalu start |
| `docker/egg-hermes.json` | Egg Pterodactyl yang memakai image `ghcr.io/sairidev/hermes:latest` |
| `.github/workflows/docker-publish.yml` | Build, tes (Docker + simulasi Pterodactyl), lalu publish image ke GHCR |
| `docker-compose.yml` | Untuk VPS |
| `.env.example` | Semua pengaturan, dengan penjelasan |

Folder yang dibuat otomatis dan **tidak** ikut ke GitHub: `.env`, `data/` (config, sesi, memori, password), `.runtime/` (Python, venv, hasil build).

---

## 0. Siapkan dari 9Router kamu

Di dashboard 9Router (yang sudah jalan terpisah):

1. **Providers**: pastikan minimal satu provider sudah connect (Kiro, Claude Code, Codex, Gemini, dan lainnya).
2. **API Keys → Create**: salin key-nya. Ini untuk `NINEROUTER_API_KEY`.
3. Catat **ID model** (misalnya `kr/claude-sonnet-4.5`) atau nama **Combo**. Ini untuk `HERMES_MODEL`.
4. Catat **alamat** 9Router yang bisa diakses dari server Hermes, misalnya `http://IP-9ROUTER:20128` atau `https://9router.domainkamu.com`. Ini untuk `NINEROUTER_URL`.

> Kalau 9Router dan Hermes ada di panel Pterodactyl yang sama, pakai **IP publik + port alokasi** 9Router. Kalau lewat internet, sebaiknya pakai **HTTPS** (domain / Cloudflare Tunnel) supaya API key tidak lewat jalur terbuka.

---

## 1. Upload ke GitHub

Repo ini ~4.600 file, jadi pakai Git (upload lewat browser dibatasi 100 file):

```bash
cd hermes-agent-web
git init
git add -A
git commit -m "Hermes Agent web"
git branch -M main
git remote add origin https://github.com/USERNAME/hermes-agent-web.git
git push -u origin main
```

Bisa juga pakai **GitHub Desktop**: *Add local repository* → *Publish repository*. Repo private juga bisa (isi `USERNAME` + `ACCESS_TOKEN` di panel).

---

## 2. Pterodactyl

Ada dua cara. **Cara A disarankan**, terutama untuk server RAM 1 GB: semua sudah di-build di GitHub, jadi panel tinggal menarik image.

### A. Egg + image siap pakai (seperti 9Router SAIRI)

Sekali saja di GitHub:
1. Push repo ini. Tab **Actions** otomatis menjalankan workflow **Docker**. Tunggu sampai ✓ (± 10 menit untuk build pertama).
2. GitHub → foto profil → **Packages** → `hermes` → **Package settings** → **Change visibility** → **Public**. Tanpa ini, panel tidak bisa menarik image.

Di panel:
1. Admin → **Nests → Import Egg** → `docker/egg-hermes.json`.
2. Buat server dengan egg **Hermes Agent · SAIRI** (RAM mulai 768 MB, disk 1 GB).
3. Tab **Startup**: isi **URL 9Router**, **API Key 9Router**, **Model**, **Admin Password**.
4. **Start**. Console menampilkan banner HERMES, info RAM/disk, dan status 9Router (✓ online · API key OK). Jawab `y` atau tunggu, lalu buka `http://IP:PORT/` setelah muncul `Hermes siap dipakai`.

Jawab `n` untuk masuk shell: `hermes-web` menjalankan dashboard, `hermes chat` untuk chat di terminal. Detail image ada di [`docker/README.md`](docker/README.md).

### B. Egg **Node.js** biasa (tanpa admin, build di panel)

1. Buat/pilih server dengan egg **Node.js** (generic), **Docker Image: Node.js 22** (jangan Alpine).
2. **Startup**: **Git Repo Address** `https://github.com/USERNAME/hermes`, **Main file** `index.js`, **Auto Update** `1`.
3. **Settings → Reinstall Server** supaya repo di-clone (atau upload zip lewat File Manager lalu *Unarchive*).
4. **File Manager** → salin `.env.example` jadi `.env`, isi `NINEROUTER_URL`, `NINEROUTER_API_KEY`, `HERMES_MODEL`, `ADMIN_PASSWORD`.
5. **Start**. Start pertama butuh 5–10 menit karena Python dan dashboard di-build di panel. Untuk RAM 1 GB, tambahkan `BUILD_MEMORY_MB=700` di `.env`.

### Resource

| | Cara A (image) | Cara B (build di panel) |
|---|---|---|
| RAM | 768 MB – 1 GB | 1.5–2 GB saat start pertama |
| Disk | ± 100 MB + data | ± 2 GB saat start pertama, ± 450 MB setelahnya |
| Waktu start pertama | < 1 menit | 5–10 menit |

---

## 3. VPS / Docker

Pakai image yang sudah di-build GitHub Actions:

```bash
git clone https://github.com/USERNAME/hermes.git
cd hermes
cp .env.example .env        # isi NINEROUTER_URL, NINEROUTER_API_KEY, ADMIN_PASSWORD
docker compose up -d
docker compose logs -f
```

Atau langsung satu perintah:

```bash
docker run -d --name hermes --restart unless-stopped -p 3000:3000 \
  -e NINEROUTER_URL=http://IP-9ROUTER:20128 -e NINEROUTER_API_KEY=sk-... \
  -e HERMES_MODEL=kr/claude-sonnet-4.5 -e ADMIN_PASSWORD=password-kuat \
  -v hermes-data:/home/container ghcr.io/sairidev/hermes:latest
```

Tanpa Docker (Node.js 22, Linux x64/arm64): `cp .env.example .env && node index.js`.

Untuk domain + HTTPS, taruh Nginx, Caddy, atau Cloudflare Tunnel di depannya, lalu set `TRUST_PROXY=true` dan `PUBLIC_URL=https://hermes.domainkamu.com`.

---

## 4. Setelah jalan

Console menampilkan hasil pengecekan otomatis ke 9Router:

```
✓ Terhubung ke 9Router http://IP-9ROUTER:20128 (12 model tersedia)
✓ Hermes siap dipakai
  ☤  Dashboard Hermes : http://IP:PORT/
  👤 Login            : admin / ...
```

Kalau ada masalah, launcher langsung memberi tahu apa yang salah: URL tidak bisa dihubungi, API key ditolak, atau nama model salah (lengkap dengan saran model yang mirip).

Buka `http://IP:PORT/` → login → tab **Chat**. Model juga bisa diganti dari dashboard Hermes. Launcher hanya menulis ulang config saat nilai di `.env` atau panel **berubah**, jadi pilihanmu di dashboard tidak ditimpa setiap restart.

---

## 5. Pengaturan (`.env` / variabel panel)

| Variabel | Default | Keterangan |
|---|---|---|
| `NINEROUTER_URL` | – | **Wajib.** Alamat 9Router (boleh dengan/tanpa `/v1`) |
| `NINEROUTER_API_KEY` | – | **Wajib** (9Router versi baru mewajibkan API key) |
| `HERMES_MODEL` | `kr/claude-sonnet-4.5` | ID model / nama combo di 9Router |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / acak | Login dashboard Hermes |
| `HERMES_EXTRAS` | `web,pty,mcp` | Tambah `telegram`, `discord`, `slack` untuk bot |
| `HERMES_GATEWAY` | `false` | `true` = jalankan bot/gateway Hermes |
| `HERMES_LAZY_INSTALLS` | `false` | `true` = Hermes boleh mengunduh komponen tambahan sendiri (±500 MB+) |
| `PUBLIC_URL`, `TRUST_PROXY` | – | Untuk domain / reverse proxy |
| `HERMES_INTERNAL_PORT` | `9119` | Port internal Hermes (ubah hanya jika bentrok) |

---

## 6. Perintah di console

| Perintah | Fungsi |
|---|---|
| `help` | Daftar perintah |
| `status` | Status Hermes (dan gateway) |
| `info` | Tampilkan alamat & login lagi |
| `check` | Tes ulang koneksi, API key, dan model ke 9Router |
| `models` / `models claude` | Daftar model dari 9Router (bisa difilter) |
| `restart` | Restart Hermes |
| `retry` | Ulangi setup yang gagal |
| `rebuild` | Install ulang Python env + build ulang dashboard (cara B saja; image = build ulang di GitHub) |
| `stop` | Matikan dengan rapi |

---

## 7. Keamanan

- Dashboard Hermes **selalu** wajib login, karena Hermes bisa menjalankan perintah terminal di server tempat dia berjalan. Jangan taruh file penting lain di server yang sama.
- Password dan secret disimpan di `data/secrets.json` dan `.env`. Keduanya tidak ikut ke GitHub.
- Pakai HTTPS ke 9Router kalau lewat internet. Kalau API key bocor, hapus dan buat ulang di dashboard 9Router.

---

## 8. Troubleshooting

| Gejala | Solusi |
|---|---|
| `9Router tidak bisa dihubungi` | Cek `NINEROUTER_URL` (IP publik + port 9Router), dan pastikan 9Router jalan. Tes dengan `check` |
| `API key ditolak` | Buat key baru di 9Router → API Keys, isi `NINEROUTER_API_KEY`, restart |
| `Model "…" tidak ada di daftar 9Router` | Ketik `models` di console, salin ID yang benar ke `HERMES_MODEL` |
| Chat error / tidak ada jawaban | Provider di 9Router belum connect atau kuotanya habis. Cek dashboard 9Router |
| `Image berbasis musl/Alpine tidak didukung` | Ganti Docker Image ke `nodejs_22` |
| Setup berhenti di `npm ci` / build (killed) | RAM kurang: naikkan RAM atau set `BUILD_MEMORY_MB=1024` |
| Mau install ulang total | Stop → hapus `.runtime/` (data aman di `data/`) → Start |

Log Hermes ada di `data/hermes/logs/`.

---

## 9. Update

- **Egg image (cara A)**: push ke `main` → tunggu ✓ di tab Actions → **Restart** server di panel (image terbaru otomatis ditarik). Data di `/home/container` tetap aman.
- **Egg Node.js (cara B)**: push ke GitHub lalu restart (Auto Update = 1). Launcher hanya membangun ulang bagian yang berubah.
- **Docker / VPS**: `docker compose pull && docker compose up -d`.

---

## Catatan teknis

- Python 3.14 dan dependency Hermes di-install memakai `uv` versi yang di-pin dan dicek sha256-nya dari `hermes/pm/lock.json`, dengan `uv.lock` Hermes (`--frozen`).
- Dashboard dan Chat Hermes di-build dengan langkah yang sama seperti Dockerfile resmi Hermes. `node_modules` dihapus setelah build.
- Kode Hermes **tidak diubah**, hanya dirampingkan, ditambah beberapa baris di `hermes/.gitignore` supaya semua file ikut ter-commit.
- Lisensi Hermes Agent: MIT (Nous Research), lihat `hermes/LICENSE`.
