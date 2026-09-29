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
| `.env.example` | Semua pengaturan, dengan penjelasan |
| `pterodactyl/egg-hermes-agent-web.json` | Egg Pterodactyl (untuk admin panel) |
| `Dockerfile`, `docker-compose.yml` | Untuk VPS / Docker |

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

### A. Pakai egg **Node.js** yang sudah ada (tanpa admin)

1. Buat/pilih server dengan egg **Node.js** (generic).
2. **Startup → Docker Image**: pilih **Node.js 22** (atau 24). Jangan Alpine.
3. **Startup → variabel**:
   - **Git Repo Address**: `https://github.com/USERNAME/hermes-agent-web`
   - **Main file**: `index.js`
   - **Auto Update**: `1` (opsional)
4. **Settings → Reinstall Server** supaya repo di-clone.
   Tanpa Git: upload zip lewat **File Manager** → *Unarchive*. Zip ini berisi folder `hermes-agent-web/`: pindahkan isinya ke folder paling atas, **atau** isi *Main file* dengan `hermes-agent-web/index.js`.
5. **File Manager** → salin `.env.example` jadi `.env`, lalu isi:
   ```env
   NINEROUTER_URL=http://IP-9ROUTER:PORT
   NINEROUTER_API_KEY=sk-...
   HERMES_MODEL=kr/claude-sonnet-4.5
   ADMIN_PASSWORD=password-kuat-kamu
   ```
6. **Start**. Start pertama butuh **5–10 menit**. Selama itu, membuka alamat server menampilkan halaman "Sedang menyiapkan Hermes…".

### B. Import egg khusus (admin panel)

1. Admin → **Nests → Import Egg** → pilih `pterodactyl/egg-hermes-agent-web.json`.
2. Buat server, isi **Git Repo Address**, **URL 9Router**, **API Key 9Router**, **Model**, **Admin Password**.
3. Install lalu Start. Status jadi *Running* saat console menampilkan `Hermes siap dipakai`.

### Resource

| | Minimal | Disarankan |
|---|---|---|
| RAM | 1.5 GB | 2 GB (build dashboard saat start pertama) |
| Disk | 2 GB | 3 GB+ |
| Port | 1 alokasi | — |

Setelah terpasang, pemakaian disk sekitar 450 MB, dan RAM saat jalan biasanya jauh di bawah 1 GB.

---

## 3. VPS / Docker

```bash
git clone https://github.com/USERNAME/hermes-agent-web.git
cd hermes-agent-web
cp .env.example .env        # isi NINEROUTER_URL, NINEROUTER_API_KEY, ADMIN_PASSWORD
docker compose up -d --build
docker compose logs -f
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
| `rebuild` | Install ulang Python env + build ulang dashboard |
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

- **Pterodactyl + Auto Update = 1**: push ke GitHub lalu restart. Launcher hanya membangun ulang bagian yang berubah.
- **Docker**: `git pull && docker compose up -d --build`.

---

## Catatan teknis

- Python 3.14 dan dependency Hermes di-install memakai `uv` versi yang di-pin dan dicek sha256-nya dari `hermes/pm/lock.json`, dengan `uv.lock` Hermes (`--frozen`).
- Dashboard dan Chat Hermes di-build dengan langkah yang sama seperti Dockerfile resmi Hermes. `node_modules` dihapus setelah build.
- Kode Hermes **tidak diubah**, hanya dirampingkan, ditambah beberapa baris di `hermes/.gitignore` supaya semua file ikut ter-commit.
- Lisensi Hermes Agent: MIT (Nous Research), lihat `hermes/LICENSE`.
