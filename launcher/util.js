'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const log = require('./log');

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

// Content hash over files/dirs (relative to root). Used to decide when a build
// is stale, so a `git pull` that changes sources triggers exactly one rebuild.
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', 'dist', '.next', '.turbo', '.cache']);
function hashTree(root, entries, extra = '') {
  const hash = crypto.createHash('sha256');
  hash.update(extra);
  const walk = (rel) => {
    const abs = path.join(root, rel);
    let st;
    try { st = fs.statSync(abs); } catch { hash.update(`missing:${rel}\0`); return; }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(path.join(rel, name));
      }
    } else if (st.isFile()) {
      hash.update(`${rel.split(path.sep).join('/')}\0`);
      hash.update(fs.readFileSync(abs));
      hash.update('\0');
    }
  };
  for (const entry of entries) walk(entry);
  return hash.digest('hex');
}

// Turns a chunked stream into whole lines (\n or \r terminated).
function lineSplitter(onLine) {
  let rest = '';
  const feed = (buf) => {
    const parts = (rest + buf.toString()).split(/\r?\n|\r/);
    rest = parts.pop();
    for (const part of parts) onLine(part);
  };
  feed.end = () => { if (rest) onLine(rest); rest = ''; };
  return feed;
}

// Run a command, stream its output with a service tag, keep the tail for errors.
function run(cmd, args, { cwd, env, label = 'setup', quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const tail = [];
    let lastProgress = 0;
    const onLine = (raw) => {
      const text = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd();
      if (!text) return;
      tail.push(text);
      if (tail.length > 40) tail.shift();
      if (quiet) return;
      // Progress bars (uv/npm) repaint many times a second; show at most one per 2s.
      if (/\d+(\.\d+)?%|MiB\s*\/|KiB\s*\//.test(text)) {
        const now = Date.now();
        if (now - lastProgress < 2000) return;
        lastProgress = now;
      }
      log.child(label, log.paint('dim', text));
    };
    const flushOut = lineSplitter(onLine);
    const flushErr = lineSplitter(onLine);
    child.stdout.on('data', flushOut);
    child.stderr.on('data', flushErr);
    child.on('error', (err) => reject(new Error(`${cmd}: ${err.message}`)));
    child.on('close', (code) => {
      flushOut.end();
      flushErr.end();
      if (code === 0) return resolve({ code, tail });
      const err = new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} gagal (exit ${code})\n${tail.slice(-15).join('\n')}`);
      err.tail = tail;
      reject(err);
    });
  });
}

async function download(url, dest, { attempts = 3 } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15 * 60 * 1000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
      return dest;
    } catch (err) {
      lastErr = err;
      log.warn(`download gagal (${i}/${attempts}): ${url} — ${err.message}`, 'setup');
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  throw new Error(`Tidak bisa download ${url}: ${lastErr && lastErr.message}`);
}

function portOpen(port, host = '127.0.0.1', timeout = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeout, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

function randomSecret(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }

function randomPassword(len = 14) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Minimal semver-ish compare for "22.12.0" style strings.
function versionAtLeast(version, min) {
  const a = String(version).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(min).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
}

function dirSizeMB(dir) {
  let total = 0;
  const walk = (p) => {
    let st;
    try { st = fs.lstatSync(p); } catch { return; }
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n));
    else total += st.size;
  };
  walk(dir);
  return Math.round(total / 1024 / 1024);
}

module.exports = {
  exists, readJSON, writeJSON, rmrf, sha256, sha256File, hashTree, run, download,
  portOpen, randomSecret, lineSplitter, randomPassword, versionAtLeast, dirSizeMB, fsp,
};
