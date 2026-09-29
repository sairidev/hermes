'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./log');
const {
  exists, readJSON, writeJSON, rmrf, sha256, sha256File, hashTree, run, download, versionAtLeast, dirSizeMB,
} = require('./util');

const STAMP_VERSION = 1;

function platformTarget() {
  if (process.platform !== 'linux') {
    throw new Error(`Launcher ini untuk Linux (Pterodactyl/VPS/Docker). Platform terdeteksi: ${process.platform}`);
  }
  const report = process.report && process.report.getReport ? process.report.getReport() : null;
  if (report && report.header && !report.header.glibcVersionRuntime) {
    throw new Error('Image berbasis musl/Alpine tidak didukung. Pilih image Debian/Ubuntu (mis. ghcr.io/parkervcp/yolks:nodejs_22).');
  }
  if (process.arch === 'x64') return 'linux-x64';
  if (process.arch === 'arm64') return 'linux-arm64';
  throw new Error(`Arsitektur CPU ${process.arch} tidak didukung (hanya x64/arm64).`);
}

function pmLock(cfg) {
  const lock = readJSON(path.join(cfg.hermesSrc, 'pm', 'lock.json'));
  if (!lock || !lock.packages) throw new Error('hermes/pm/lock.json tidak ditemukan — folder hermes/ tidak lengkap?');
  return lock.packages;
}

async function fetchPinned(cfg, name, target) {
  const pkg = pmLock(cfg)[name];
  const art = pkg && pkg.artifacts && pkg.artifacts[target];
  if (!art) throw new Error(`Tidak ada artefak ${name} untuk ${target} di pm/lock.json`);
  const tmpDir = path.join(cfg.runtimeDir, 'tmp');
  const file = path.join(tmpDir, path.basename(new URL(art.url).pathname));
  log.step(`Download ${name} ${pkg.version} (${target})`);
  await download(art.url, file);
  const got = await sha256File(file);
  if (got !== art.sha256) {
    rmrf(file);
    throw new Error(`Checksum ${name} tidak cocok (dapat ${got}, harusnya ${art.sha256})`);
  }
  return { file, version: pkg.version };
}

async function extractSingleDir(archive, destDir, cfg) {
  const tmp = path.join(cfg.runtimeDir, 'tmp', `extract-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const flag = archive.endsWith('.xz') ? '-xJf' : '-xzf';
  await run('tar', [flag, archive, '-C', tmp], { label: 'setup', quiet: true });
  const entries = fs.readdirSync(tmp);
  const inner = entries.length === 1 && fs.statSync(path.join(tmp, entries[0])).isDirectory()
    ? path.join(tmp, entries[0]) : tmp;
  rmrf(destDir);
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.renameSync(inner, destDir);
  rmrf(tmp);
  rmrf(archive);
}

// ---------------------------------------------------------------------------
// uv (pinned + sha256-verified from Hermes' own pm/lock.json)
// ---------------------------------------------------------------------------
async function ensureUv(cfg) {
  const target = platformTarget();
  const version = pmLock(cfg).uv.version;
  const dir = path.join(cfg.runtimeDir, 'tools', `uv-${version}`);
  const bin = path.join(dir, 'uv');
  if (exists(bin)) return bin;
  const { file } = await fetchPinned(cfg, 'uv', target);
  await extractSingleDir(file, dir, cfg);
  fs.chmodSync(bin, 0o755);
  log.ok(`uv ${version} terpasang`, 'setup');
  return bin;
}

// ---------------------------------------------------------------------------
// Node for the dashboard build + the in-browser Chat tab (TUI).
// Uses the panel's Node when new enough, otherwise the pinned Node from pm/lock.json.
// ---------------------------------------------------------------------------
function npmCliFor(nodeBin) {
  const candidate = path.join(path.dirname(nodeBin), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return exists(candidate) ? path.resolve(candidate) : null;
}

async function ensureNode(cfg) {
  const current = process.versions.node;
  if (versionAtLeast(current, '20.19.0')) {
    return { node: process.execPath, npmCli: npmCliFor(process.execPath), version: current };
  }
  log.warn(`Node ${current} terlalu lama untuk build dashboard Hermes (butuh ≥ 20.19, disarankan 22). Pakai Node bawaan launcher.`, 'setup');
  const target = platformTarget();
  const version = pmLock(cfg).node.version;
  const dir = path.join(cfg.runtimeDir, 'tools', `node-${version}`);
  const node = path.join(dir, 'bin', 'node');
  if (!exists(node)) {
    const { file } = await fetchPinned(cfg, 'node', target);
    await extractSingleDir(file, dir, cfg);
  }
  return { node, npmCli: npmCliFor(node), version };
}

function npmArgs(nodeInfo, args) {
  return nodeInfo.npmCli ? [nodeInfo.node, [nodeInfo.npmCli, ...args]] : ['npm', args];
}

function nodeEnv(cfg, nodeInfo, extra = {}) {
  return {
    ...process.env,
    PATH: `${path.dirname(nodeInfo.node)}${path.delimiter}${process.env.PATH || ''}`,
    npm_config_cache: path.join(cfg.runtimeDir, 'npm-cache'),
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Python venv (uv sync against Hermes' hash-locked uv.lock)
// ---------------------------------------------------------------------------
function venvPaths(cfg) {
  const venv = path.join(cfg.runtimeDir, 'venv');
  return { venv, python: path.join(venv, 'bin', 'python'), hermes: path.join(venv, 'bin', 'hermes') };
}

function uvEnv(cfg) {
  return {
    ...process.env,
    UV_NO_CONFIG: '1',
    UV_PYTHON_INSTALL_DIR: path.join(cfg.runtimeDir, 'python'),
    UV_CACHE_DIR: path.join(cfg.runtimeDir, 'uv-cache'),
    UV_PROJECT_ENVIRONMENT: venvPaths(cfg).venv,
    UV_LINK_MODE: 'copy',
  };
}

// Prebuilt image: outputs exist but the runtime is read-only. Use them as-is
// instead of trying (and failing) to rebuild inside /opt.
function prebuiltOk(cfg, what, ready) {
  if (cfg.runtimeWritable) return false;
  if (!ready) throw new Error(`${what} tidak ada di image dan folder runtime read-only (${cfg.runtimeDir}). Build ulang image-nya.`);
  log.ok(`${what}: pakai versi bawaan image`, 'setup');
  return true;
}

async function ensureHermesVenv(cfg, getUv) {
  const src = cfg.hermesSrc;
  const extras = [...new Set(cfg.hermes.extras)].sort();
  const pyVersion = String(pmLock(cfg).python.version).split('+')[0].split('.').slice(0, 2).join('.');
  const fingerprint = sha256([
    // Paths are part of the key: the venv is an editable install with absolute paths,
    // so moving the folder must trigger a re-sync instead of a broken import path.
    STAMP_VERSION, pyVersion, extras.join(','), src, cfg.runtimeDir,
    fs.readFileSync(path.join(src, 'uv.lock')),
    fs.readFileSync(path.join(src, 'pyproject.toml')),
  ].join('\n'));
  const stampFile = path.join(cfg.runtimeDir, 'stamps', 'hermes-venv.json');
  const paths = venvPaths(cfg);
  if (readJSON(stampFile, {}).fingerprint === fingerprint && exists(paths.hermes)) {
    log.ok('Python env Hermes sudah siap', 'setup');
    return paths;
  }
  if (prebuiltOk(cfg, 'Python env Hermes', exists(paths.hermes))) return paths;
  const uv = await getUv();

  log.step(`Install Python ${pyVersion} + dependency Hermes (extras: ${extras.join(', ')}) — pertama kali bisa 2-5 menit`);
  const args = ['sync', '--frozen', '--no-dev', '--python', pyVersion, '--managed-python'];
  for (const extra of extras) args.push('--extra', extra);
  await run(uv, args, { cwd: src, env: uvEnv(cfg), label: 'setup' });
  if (!exists(paths.hermes)) throw new Error(`uv sync selesai tapi ${paths.hermes} tidak ada`);

  if (cfg.build.cleanDeps) rmrf(path.join(cfg.runtimeDir, 'uv-cache'));
  writeJSON(stampFile, { fingerprint, extras, pyVersion, at: new Date().toISOString() });
  log.ok(`Python env Hermes siap (${dirSizeMB(paths.venv)} MB)`, 'setup');
  return paths;
}

// ---------------------------------------------------------------------------
// Web dashboard + TUI (Chat tab) — same build steps as Hermes' Dockerfile
// ---------------------------------------------------------------------------
function frontendPaths(cfg) {
  return {
    web: path.join(cfg.runtimeDir, 'hermes-web'),
    tui: path.join(cfg.runtimeDir, 'hermes-tui'),
  };
}

async function ensureHermesFrontend(cfg, venv, nodeInfo) {
  const src = cfg.hermesSrc;
  const out = frontendPaths(cfg);
  const fingerprint = hashTree(src, [
    'package.json', 'package-lock.json', 'web', 'ui-tui', 'apps/shared', 'scripts/build',
    'scripts/generate_icons.py', 'scripts/generate-icons.mjs', 'assets',
  ], `v${STAMP_VERSION}`);
  const stampFile = path.join(cfg.runtimeDir, 'stamps', 'hermes-frontend.json');
  const ready = exists(path.join(out.web, 'index.html')) && exists(path.join(out.tui, 'dist', 'entry.js'));
  if (ready && readJSON(stampFile, {}).fingerprint === fingerprint) {
    log.ok('Web dashboard Hermes sudah ter-build', 'setup');
    return out;
  }
  if (prebuiltOk(cfg, 'Web dashboard Hermes', ready)) return out;

  const env = nodeEnv(cfg, nodeInfo, {
    npm_config_install_links: 'false',
    npm_config_engine_strict: 'false',
    CI: '1',
    NODE_OPTIONS: `--max-old-space-size=${cfg.build.memoryMB}`,
  });
  const icons = path.join(cfg.runtimeDir, 'tmp', 'hermes-icons');

  log.step('Generate icon dashboard Hermes');
  rmrf(icons);
  await run(venv.python, ['-I', 'scripts/generate_icons.py', '--source', src, '--out', icons], { cwd: src, label: 'setup', quiet: true });

  log.step('Install dependency frontend Hermes (npm ci) — butuh ~400 MB sementara');
  const [npmCmd, npmBase] = npmArgs(nodeInfo, [
    'ci', '--no-audit', '--no-fund', '--include=dev', '--include=optional',
    '--include-workspace-root=true', '--workspace', 'ui-tui', '--workspace', 'web',
  ]);
  await run(npmCmd, npmBase, { cwd: src, env, label: 'setup' });

  log.step('Build Chat (TUI) Hermes');
  rmrf(out.tui);
  await run(nodeInfo.node, ['scripts/build/tui.mjs', '--source', src, '--out', out.tui], { cwd: src, env, label: 'setup' });

  log.step('Build web dashboard Hermes');
  rmrf(out.web);
  await run(nodeInfo.node, ['scripts/build/web.mjs', '--source', src, '--icons', icons, '--out', out.web], { cwd: src, env, label: 'setup' });

  if (cfg.build.cleanDeps) {
    for (const dir of ['node_modules', 'web/node_modules', 'ui-tui/node_modules', 'apps/shared/node_modules',
      'ui-tui/packages/hermes-ink/node_modules']) rmrf(path.join(src, dir));
    rmrf(path.join(cfg.runtimeDir, 'npm-cache'));
  }
  rmrf(icons);
  writeJSON(stampFile, { fingerprint, node: nodeInfo.version, at: new Date().toISOString() });
  log.ok('Web dashboard + Chat Hermes ter-build', 'setup');
  return out;
}

module.exports = {
  ensureUv, ensureNode, ensureHermesVenv, ensureHermesFrontend, venvPaths, frontendPaths, nodeEnv, npmArgs,
};
