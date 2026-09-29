'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const log = require('./log');
const { portOpen, lineSplitter } = require('./util');

// PID files let a fresh launcher clean up children orphaned by a hard kill
// (e.g. `kill -9` on a VPS). Inside Pterodactyl the container dies anyway.
function killStale(pidFile, name) {
  let pid;
  try { pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10); } catch { return false; }
  try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  if (!pid || pid === process.pid) return false;
  try {
    // Only kill a process that carries our marker (PIDs get reused).
    const environ = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
    if (!environ.includes(`HERMES_WEB_SERVICE=${name}\0`)) return false;
  } catch { return false; }
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { return false; } }
  log.warn(`proses lama (pid ${pid}) dimatikan`, name);
  return true;
}

class Service {
  constructor({ name, command, args, cwd, env, port, filter, pidDir }) {
    Object.assign(this, { name, command, args, cwd, env, port, filter });
    this.pidFile = pidDir ? path.join(pidDir, `${name}.pid`) : null;
    this.child = null;
    this.state = 'stopped'; // stopped | starting | running | crashed
    this.restarts = 0;
    this.stopping = false;
    this.startedAt = 0;
    this.timer = null;
  }

  async start() {
    if (this.child || this.launching) return;
    this.launching = true;
    try {
      await this.spawnChild();
    } finally {
      this.launching = false;
    }
  }

  async spawnChild() {
    this.stopping = false;
    this.state = 'starting';
    this.startedAt = Date.now();
    if (this.pidFile) {
      if (killStale(this.pidFile, this.name)) await new Promise((r) => setTimeout(r, 1500));
    }
    if (this.port && await portOpen(this.port)) {
      this.state = 'crashed';
      this.restarts += 1;
      const delay = Math.min(30_000, 2000 * this.restarts);
      log.error(`port internal ${this.port} sudah dipakai proses lain; coba lagi dalam ${Math.round(delay / 1000)} detik (ubah ${this.name === 'hermes' ? 'HERMES_INTERNAL_PORT' : 'NINEROUTER_INTERNAL_PORT'} kalau bentrok)`, this.name);
      this.timer = setTimeout(() => this.start(), delay);
      return;
    }
    log.info(`start: ${[this.command, ...this.args].join(' ')}`, this.name);
    // Own process group so stop() also kills children (PTY chat, MCP servers, ...).
    const child = spawn(this.command, this.args, {
      cwd: this.cwd, env: { ...this.env, HERMES_WEB_SERVICE: this.name }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    this.child = child;
    if (this.pidFile && child.pid) {
      fs.mkdirSync(path.dirname(this.pidFile), { recursive: true });
      fs.writeFileSync(this.pidFile, String(child.pid));
    }
    const onLine = (raw) => {
      const text = raw.trimEnd();
      if (!text || (this.filter && !this.filter(text))) return;
      log.child(this.name, text);
    };
    child.stdout.on('data', lineSplitter(onLine));
    child.stderr.on('data', lineSplitter(onLine));
    child.on('error', (err) => log.error(`gagal start: ${err.message}`, this.name));
    child.on('exit', (code, signal) => {
      this.child = null;
      if (this.pidFile) { try { fs.unlinkSync(this.pidFile); } catch { /* ignore */ } }
      if (this.stopping) { this.state = 'stopped'; return; }
      this.state = 'crashed';
      const ranFor = Date.now() - this.startedAt;
      if (ranFor > 60_000) this.restarts = 0;
      this.restarts += 1;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.restarts, 5));
      log.error(`berhenti (code ${code}${signal ? `, ${signal}` : ''}); restart dalam ${Math.round(delay / 1000)} detik`, this.name);
      this.timer = setTimeout(() => this.start(), delay);
    });
    if (this.port) this.waitReady();
  }

  async waitReady() {
    const child = this.child;
    const deadline = Date.now() + 10 * 60_000;
    while (this.child === child && Date.now() < deadline) {
      if (await portOpen(this.port)) {
        if (this.child === child) {
          this.state = 'running';
          log.ok(`siap (port internal ${this.port})`, this.name);
          if (this.onReady) this.onReady();
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  stop(timeoutMs = 10_000) {
    clearTimeout(this.timer);
    this.stopping = true;
    const child = this.child;
    if (!child) { this.state = 'stopped'; return Promise.resolve(); }
    return new Promise((resolve) => {
      const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } };
      const t = setTimeout(() => kill('SIGKILL'), timeoutMs);
      child.once('exit', () => { clearTimeout(t); resolve(); });
      kill('SIGTERM');
    });
  }

  async restart() {
    await this.stop();
    this.restarts = 0;
    await this.start();
  }
}

module.exports = { Service };
