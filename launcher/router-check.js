'use strict';

const log = require('./log');

// Hermes only talks to 9Router over its OpenAI-compatible API. This module
// checks that link on boot (and on the `check` / `models` console commands) so
// problems show up as a clear message instead of a failed chat later.

async function request(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

async function listModels(cfg) {
  const headers = cfg.nineRouter.apiKey ? { authorization: `Bearer ${cfg.nineRouter.apiKey}` } : {};
  const res = await request(`${cfg.nineRouter.v1}/models`, { headers });
  if (res.status !== 200 || !res.body || !Array.isArray(res.body.data)) {
    throw new Error(`GET /v1/models → HTTP ${res.status}`);
  }
  return res.body.data.map((m) => m.id).filter(Boolean);
}

// 9Router checks the key before reading the body, so an empty request tells us
// whether the key is accepted without ever reaching a paid provider.
async function keyAccepted(cfg) {
  const headers = { 'content-type': 'application/json' };
  if (cfg.nineRouter.apiKey) headers.authorization = `Bearer ${cfg.nineRouter.apiKey}`;
  const res = await request(`${cfg.nineRouter.v1}/chat/completions`, { method: 'POST', headers, body: '{}' });
  return { ok: res.status !== 401 && res.status !== 403, status: res.status };
}

async function checkRouter(cfg) {
  const result = { configured: Boolean(cfg.nineRouter.v1), reachable: false, keyOk: false, modelKnown: null, models: [] };
  if (!result.configured) {
    log.warn('NINEROUTER_URL belum diisi. Dashboard Hermes tetap jalan, tapi belum bisa chat sebelum URL 9Router diisi di .env.');
    return result;
  }
  try {
    result.models = await listModels(cfg);
    result.reachable = true;
  } catch (err) {
    const why = err.cause && err.cause.code ? err.cause.code : err.message;
    log.warn(`9Router tidak bisa dihubungi di ${cfg.nineRouter.v1} (${why}).`);
    log.warn('Cek NINEROUTER_URL, pastikan 9Router sedang jalan dan bisa diakses dari server ini.');
    return result;
  }
  try {
    const key = await keyAccepted(cfg);
    result.keyOk = key.ok;
    if (!key.ok) {
      log.warn(cfg.nineRouter.apiKey
        ? `API key ditolak 9Router (HTTP ${key.status}). Buat ulang di dashboard 9Router → API Keys, isi NINEROUTER_API_KEY.`
        : '9Router mewajibkan API key. Buat di dashboard 9Router → API Keys, lalu isi NINEROUTER_API_KEY di .env.');
    }
  } catch (err) {
    log.warn(`Gagal mengecek API key: ${err.message}`);
  }
  // /v1/models lists 9Router's catalog (+ combos), so an unknown id is almost always a typo.
  result.modelKnown = result.models.includes(cfg.hermes.model);
  if (!result.modelKnown) {
    const [prefix] = cfg.hermes.model.split('/');
    const hints = result.models.filter((id) => id.startsWith(`${prefix}/`)).slice(0, 6);
    log.warn(`Model "${cfg.hermes.model}" tidak ada di daftar 9Router.${hints.length ? ` Mungkin maksudnya: ${hints.join(', ')}` : ' Ketik "models" di console untuk melihat daftar.'}`);
  }
  if (result.keyOk) {
    log.ok(`Terhubung ke 9Router ${cfg.nineRouter.baseUrl} (${result.models.length} model tersedia)`);
  }
  return result;
}

async function printModels(cfg, filter = '') {
  if (!cfg.nineRouter.v1) { log.warn('NINEROUTER_URL belum diisi.'); return; }
  try {
    const needle = filter.toLowerCase();
    const ids = (await listModels(cfg)).filter((id) => !needle || id.toLowerCase().includes(needle));
    log.info(`${ids.length} model${needle ? ` cocok "${filter}"` : ''}:`);
    for (let i = 0; i < ids.length; i += 4) log.info(`  ${ids.slice(i, i + 4).join('   ')}`);
  } catch (err) {
    log.error(`Tidak bisa mengambil daftar model: ${err.message}`);
  }
}

module.exports = { checkRouter, printModels };
