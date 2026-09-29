'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./log');
const { exists, readJSON, writeJSON, randomSecret, randomPassword } = require('./util');

function parseDotenv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]] = value;
  }
  return out;
}

const truthy = (v) => /^(1|true|yes|on|ya)$/i.test(String(v || '').trim());

function isWritable(dir) {
  try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}

function loadConfig(root, { setupOnly = false } = {}) {
  // ENV_FILE lets the Docker/Pterodactyl image keep .env in /home/container
  // while the app itself lives read-only in /opt/hermes-web.
  const envFile = process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : path.join(root, '.env');
  if (!setupOnly && !exists(envFile) && exists(path.join(root, '.env.example'))) {
    try {
      fs.mkdirSync(path.dirname(envFile), { recursive: true });
      fs.copyFileSync(path.join(root, '.env.example'), envFile);
      log.info(`File .env belum ada — dibuat di ${envFile} (edit lewat File Manager kalau perlu).`);
    } catch { /* read-only location: env vars only */ }
  }
  const dotenv = exists(envFile) ? parseDotenv(fs.readFileSync(envFile, 'utf8')) : {};

  // Panel/Docker env vars win over .env; empty values fall through (Pterodactyl
  // sets every egg variable, even the ones the user left blank).
  const get = (key, def = '') => {
    const fromEnv = process.env[key];
    if (fromEnv !== undefined && String(fromEnv).trim() !== '') return String(fromEnv).trim();
    if (dotenv[key] !== undefined && String(dotenv[key]).trim() !== '') return String(dotenv[key]).trim();
    return def;
  };

  const dataDir = path.resolve(root, get('DATA_DIR', 'data'));
  const runtimeDir = path.resolve(root, get('RUNTIME_DIR', '.runtime'));
  fs.mkdirSync(dataDir, { recursive: true });
  try { fs.mkdirSync(runtimeDir, { recursive: true }); } catch { /* prebuilt, read-only image */ }
  // In the Docker image the runtime is baked and owned by root: nothing may be
  // (re)built there, and everything that changes goes to the data dir instead.
  const runtimeWritable = isWritable(runtimeDir);

  // Secrets are generated once and persisted, so sessions and 9Router's
  // encrypted API keys survive restarts.
  const secretsFile = path.join(dataDir, 'secrets.json');
  const secrets = readJSON(secretsFile, {}) || {};
  let generatedPassword = false;
  for (const key of ['hermesAuthSecret']) {
    if (!secrets[key]) secrets[key] = randomSecret();
  }
  if (!secrets.adminPassword) { secrets.adminPassword = randomPassword(); generatedPassword = true; }
  // --setup-only (docker build) must never bake secrets into an image layer.
  if (!setupOnly) {
    writeJSON(secretsFile, secrets);
    try { fs.chmodSync(secretsFile, 0o600); } catch { /* ignore */ }
  }

  const isPterodactyl = Boolean(process.env.P_SERVER_UUID || process.env.P_SERVER_LOCATION);
  const publicPort = parseInt(get('SERVER_PORT', get('PORT', '3000')), 10);
  let hermesPort = parseInt(get('HERMES_INTERNAL_PORT', '9119'), 10);
  if (hermesPort === publicPort) hermesPort += 1; // never collide with the public allocation

  // 9Router runs elsewhere (its own repo/server). Accept "https://host", "https://host/v1"
  // or "host:port" and normalise to the OpenAI-compatible /v1 base.
  let routerUrl = get('NINEROUTER_URL', '').replace(/\/+$/, '');
  if (routerUrl && !/^https?:\/\//i.test(routerUrl)) routerUrl = `http://${routerUrl}`;
  const routerBase = routerUrl.replace(/\/v1$/i, '');
  const routerV1 = routerBase ? `${routerBase}/v1` : '';

  const extras = get('HERMES_EXTRAS', 'web,pty,mcp')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!extras.includes('web')) extras.push('web'); // dashboard needs fastapi/uvicorn

  const adminPassword = get('ADMIN_PASSWORD', secrets.adminPassword);

  return {
    root,
    hermesSrc: path.join(root, 'hermes'),
    dataDir,
    runtimeDir,
    runtimeWritable,
    envFile,
    pidDir: path.join(dataDir, '.pids'),
    pmToolsDir: runtimeWritable ? path.join(runtimeDir, 'pm-tools') : path.join(dataDir, '.pm-tools'),
    isPterodactyl,
    generatedPassword: generatedPassword && !get('ADMIN_PASSWORD'),
    secretsFile,
    public: {
      host: get('HOST', '0.0.0.0'),
      port: publicPort,
      url: get('PUBLIC_URL', ''),
      trustProxy: truthy(get('TRUST_PROXY', 'false')),
    },
    admin: {
      username: get('ADMIN_USERNAME', 'admin'),
      password: adminPassword,
    },
    nineRouter: {
      baseUrl: routerBase,
      v1: routerV1,
      apiKey: get('NINEROUTER_API_KEY', ''),
    },
    hermes: {
      port: hermesPort,
      model: get('HERMES_MODEL', 'kr/claude-sonnet-4.5'),
      extras,
      gateway: truthy(get('HERMES_GATEWAY', 'false')),
      // Hermes' own package manager can download ~500 MB (its Python, tirith,
      // Chromium, ...) on first use of some features. Off by default so disk use
      // stays predictable on panels; extras go through HERMES_EXTRAS instead.
      lazyInstalls: truthy(get('HERMES_LAZY_INSTALLS', 'false')),
      home: path.join(dataDir, 'hermes'),
    },
    build: {
      cleanDeps: !/^(0|false|no)$/i.test(get('CLEAN_BUILD_DEPS', 'true')),
      memoryMB: parseInt(get('BUILD_MEMORY_MB', '1536'), 10) || 1536,
    },
    secrets,
  };
}

module.exports = { loadConfig, parseDotenv, truthy };
