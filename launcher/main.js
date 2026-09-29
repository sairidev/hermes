'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const log = require('./log');
const { loadConfig } = require('./config');
const { createProxy } = require('./proxy');
const { Service } = require('./supervisor');
const { rmrf } = require('./util');
const { ensureUv, ensureNode, ensureHermesVenv, ensureHermesFrontend } = require('./setup-hermes');
const { applyHermesConfig, hermesEnv } = require('./hermes-config');
const { checkRouter, printModels } = require('./router-check');

const ROOT = path.resolve(__dirname, '..');

function banner() {
  const p = (c, t) => log.paint(c, t);
  console.log('');
  console.log(p('magenta', '  ☤ Hermes Agent  ') + p('gray', '──▶ ') + p('cyan', '🧠 9Router (terpisah)  ') + p('gray', '──▶ ') + p('yellow', 'Claude · GPT · Gemini · 60+'));
  console.log(p('gray', '  hermes-agent-web — dashboard + chat Hermes, model lewat 9Router'));
  console.log('');
}

function publicBase(cfg) {
  if (cfg.public.url) return cfg.public.url.replace(/\/+$/, '');
  const ip = process.env.SERVER_IP && process.env.SERVER_IP !== '0.0.0.0' ? process.env.SERVER_IP : 'IP-SERVER';
  return `http://${ip}:${cfg.public.port}`;
}

function printAccess(cfg) {
  const line = log.paint('gray', '  ' + '─'.repeat(58));
  console.log(line);
  console.log(`  ☤  Dashboard Hermes : ${log.paint('bold', `${publicBase(cfg)}/`)}`);
  console.log(`  👤 Login            : ${cfg.admin.username} / ${cfg.generatedPassword ? log.paint('yellow', cfg.admin.password) : '(ADMIN_PASSWORD di .env / data/secrets.json)'}`);
  console.log(`  🧠 9Router          : ${cfg.nineRouter.v1 || log.paint('yellow', 'belum diisi (NINEROUTER_URL)')}`);
  console.log(`  🤖 Model            : ${cfg.hermes.model}`);
  if (cfg.generatedPassword) console.log(log.paint('yellow', '  ⚠ Password dibuat otomatis & disimpan di data/secrets.json. Ganti lewat ADMIN_PASSWORD di .env.'));
  console.log(line);
}

function serviceEnv(ctx) {
  const { cfg, venv, front, nodeInfo } = ctx;
  return hermesEnv(cfg, {
    HERMES_WEB_DIST: front.web,
    HERMES_TUI_DIR: front.tui,
    HERMES_NODE: nodeInfo.node,
    PATH: [path.dirname(venv.hermes), path.dirname(nodeInfo.node), process.env.PATH].join(path.delimiter),
    HERMES_DASHBOARD_BASIC_AUTH_USERNAME: cfg.admin.username,
    HERMES_DASHBOARD_BASIC_AUTH_PASSWORD: cfg.admin.password,
    HERMES_DASHBOARD_BASIC_AUTH_SECRET: cfg.secrets.hermesAuthSecret,
  });
}

// uvicorn access lines for the dashboard's own polling are pure noise in the panel console.
const hermesLogFilter = (text) => !/"(GET|HEAD) \/(api\/(status|ws|pty|sessions|health)|assets\/|fonts)/.test(text);

function makeServices(ctx) {
  const { cfg, venv } = ctx;
  const pidDir = path.join(cfg.runtimeDir, 'pids');
  const env = serviceEnv(ctx);
  const services = {
    // Bound to 0.0.0.0 on an internal port: this makes Hermes enforce login on
    // every request (its auth gate engages for non-loopback binds).
    hermes: new Service({
      name: 'hermes', pidDir, command: venv.hermes, cwd: cfg.hermes.home, env, port: cfg.hermes.port,
      args: ['dashboard', '--host', '0.0.0.0', '--port', String(cfg.hermes.port), '--no-open', '--skip-build'],
      filter: hermesLogFilter,
    }),
    gateway: cfg.hermes.gateway
      ? new Service({ name: 'gateway', pidDir, command: venv.hermes, cwd: cfg.hermes.home, env, args: ['gateway', 'run'] })
      : null,
  };
  services.hermes.onReady = () => {
    // Pterodactyl's egg watches for this exact line to mark the server "Running".
    log.ok('Hermes siap dipakai');
    printAccess(cfg);
  };
  return services;
}

async function runSetup(ctx) {
  const { cfg, state } = ctx;
  const step = (text) => { state.step = text; };
  state.phase = 'setup';
  state.error = null;
  try {
    step('Mengecek Node.js');
    ctx.nodeInfo = await ensureNode(cfg);
    log.ok(`Node.js ${ctx.nodeInfo.version}`, 'setup');
    step('Menyiapkan uv (installer Python)');
    const uv = await ensureUv(cfg);
    step('Install Python 3.14 + dependency Hermes (2-5 menit)');
    ctx.venv = await ensureHermesVenv(cfg, uv);
    step('Build web dashboard Hermes (2-5 menit)');
    ctx.front = await ensureHermesFrontend(cfg, ctx.venv, ctx.nodeInfo);
    step('Mengecek koneksi ke 9Router');
    state.router = await checkRouter(cfg).then((r) => ({ configured: r.configured, reachable: r.reachable, keyOk: r.keyOk, modelKnown: r.modelKnown }));
    step('Menulis config Hermes → 9Router');
    await applyHermesConfig(cfg, ctx.venv);
    state.versions = { node: ctx.nodeInfo.version };
    state.phase = 'ready';
    step('Hermes jalan');
    return true;
  } catch (err) {
    state.phase = 'error';
    state.error = err.message;
    log.error(`Setup gagal: ${err.message}`, 'setup');
    log.info('Perbaiki masalahnya lalu ketik "retry" di console (atau restart server).');
    return false;
  }
}

function startServices(ctx) {
  const { state } = ctx;
  if (!state.services.hermes) Object.assign(state.services, makeServices(ctx));
  for (const svc of Object.values(state.services)) if (svc) svc.start();
}

async function stopAll(ctx) {
  await Promise.all(Object.values(ctx.state.services).filter(Boolean).map((s) => s.stop()));
}

function attachConsole(ctx) {
  if (!process.stdin || process.stdin.destroyed) return;
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let busy = false;
  rl.on('line', async (raw) => {
    const [cmd, ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(' ');
    if (!cmd) return;
    if (busy) { log.warn('Masih memproses perintah sebelumnya…'); return; }
    busy = true;
    const { state, cfg } = ctx;
    try {
      switch (cmd.toLowerCase()) {
        case 'help':
          log.info('Perintah: status | info | check | models [kata] | restart | retry | rebuild | stop');
          break;
        case 'status':
          log.info(`fase: ${state.phase}${state.error ? ` (error: ${state.error.split('\n')[0]})` : ''}`);
          for (const [name, svc] of Object.entries(state.services)) log.info(`${name.padEnd(8)} ${svc ? svc.state : 'nonaktif'}`);
          break;
        case 'info': printAccess(cfg); break;
        case 'check': await checkRouter(cfg); break;
        case 'models': await printModels(cfg, arg); break;
        case 'restart':
          for (const svc of Object.values(state.services)) if (svc) await svc.restart();
          break;
        case 'retry':
          if (state.phase !== 'error') { log.info('Tidak ada setup yang gagal.'); break; }
          if (await runSetup(ctx)) startServices(ctx);
          break;
        case 'rebuild':
          await stopAll(ctx);
          rmrf(path.join(cfg.runtimeDir, 'stamps'));
          if (await runSetup(ctx)) startServices(ctx);
          break;
        case 'stop': case 'exit': case 'quit':
          await shutdown(ctx, 0);
          break;
        default:
          log.info(`Perintah "${cmd}" tidak dikenal. Ketik "help".`);
      }
    } catch (err) {
      log.error(err.message);
    } finally {
      busy = false;
    }
  });
}

let shuttingDown = false;
async function shutdown(ctx, code) {
  if (shuttingDown) process.exit(code);
  shuttingDown = true;
  log.info('Mematikan Hermes…');
  await stopAll(ctx);
  if (ctx.proxy) await Promise.race([ctx.proxy.close(), new Promise((r) => setTimeout(r, 2000))]);
  log.info('Selesai. Sampai jumpa 👋');
  process.exit(code);
}

async function main(argv) {
  const setupOnly = argv.includes('--setup-only');
  banner();
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    log.error(`Node.js ${process.versions.node} terlalu lama. Pilih image Node.js 22 di panel.`);
    process.exit(1);
  }

  let cfg;
  try {
    cfg = loadConfig(ROOT, { setupOnly });
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(cfg.hermesSrc, 'pyproject.toml'))) {
    log.error('Folder hermes/ tidak lengkap. Upload ulang seluruh isi repo.');
    process.exit(1);
  }

  const state = { phase: 'setup', step: 'Mulai…', error: null, services: { hermes: null, gateway: null }, versions: {}, router: null };
  const ctx = { cfg, state };
  log.info(`Data: ${cfg.dataDir} · Runtime: ${cfg.runtimeDir}${cfg.isPterodactyl ? ' · Pterodactyl terdeteksi' : ''}`);

  if (setupOnly) {
    // Used by the Dockerfile to bake Python/venv/dashboard into the image.
    ctx.nodeInfo = await ensureNode(cfg);
    const venv = await ensureHermesVenv(cfg, await ensureUv(cfg));
    await ensureHermesFrontend(cfg, venv, ctx.nodeInfo);
    log.ok('Setup selesai (--setup-only).');
    process.exit(0);
  }

  process.on('SIGINT', () => shutdown(ctx, 0));
  process.on('SIGTERM', () => shutdown(ctx, 0));
  attachConsole(ctx);

  ctx.proxy = createProxy(cfg, state);
  try {
    await ctx.proxy.listen();
  } catch (err) {
    log.error(`Port ${cfg.public.port} tidak bisa dipakai: ${err.message}`);
    process.exit(1);
  }

  if (await runSetup(ctx)) startServices(ctx);
}

module.exports = { main };
