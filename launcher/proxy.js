'use strict';

const http = require('http');
const net = require('net');
const log = require('./log');

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'trailers', 'transfer-encoding', 'upgrade',
]);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Front door on the public port: shows a "preparing" page while Hermes installs or
// restarts, then forwards everything (HTTP, SSE, WebSocket) to the Hermes dashboard.
function createProxy(cfg, state) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

  function resolveRoute(url) {
    const q = url.indexOf('?');
    const pathname = q === -1 ? url : url.slice(0, q);
    if (pathname === '/_status') return { status: true };
    return { service: 'hermes', port: cfg.hermes.port, path: url };
  }

  function forwardHeaders(req) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    const trust = cfg.public.trustProxy;
    const clientIp = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const priorXff = trust && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']) : '';
    headers['x-forwarded-for'] = priorXff ? `${priorXff}, ${clientIp}` : clientIp;
    headers['x-real-ip'] = priorXff ? priorXff.split(',')[0].trim() : clientIp;
    headers['x-forwarded-proto'] = trust && req.headers['x-forwarded-proto']
      ? String(req.headers['x-forwarded-proto']).split(',')[0].trim() : 'http';
    headers['x-forwarded-host'] = trust && req.headers['x-forwarded-host']
      ? String(req.headers['x-forwarded-host']) : (req.headers.host || '');
    delete headers['x-forwarded-prefix'];
    return headers;
  }

  function statusJson() {
    const services = {};
    for (const [name, svc] of Object.entries(state.services)) services[name] = svc ? svc.state : 'disabled';
    return { phase: state.phase, step: state.step, error: state.error || null, services, router: state.router || null, versions: state.versions };
  }

  function sendUnavailable(req, res, title, detail) {
    const wantsHtml = String(req.headers.accept || '').includes('text/html');
    const headers = { 'cache-control': 'no-store', 'retry-after': '5' };
    if (!wantsHtml) {
      res.writeHead(503, { ...headers, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: title, detail, ...statusJson() }));
      return;
    }
    const failed = state.phase === 'error';
    res.writeHead(503, { ...headers, 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${failed ? '' : '<meta http-equiv="refresh" content="5">'}
<title>Hermes Agent</title>
<style>
:root{color-scheme:light dark;--bg:#0f1020;--fg:#e8e8f0;--muted:#9a9ab0;--card:#191a33;--accent:#7c5cff}
@media (prefers-color-scheme: light){:root{--bg:#f4f4fa;--fg:#1a1a2e;--muted:#5a5a70;--card:#fff}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
.card{background:var(--card);border-radius:16px;padding:28px;max-width:560px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.25)}
h1{font-size:20px;margin:0 0 4px} .muted{color:var(--muted);font-size:14px}
.bar{height:6px;border-radius:3px;background:rgba(124,92,255,.2);overflow:hidden;margin:18px 0}
.bar i{display:block;height:100%;width:40%;background:var(--accent);animation:s 1.4s infinite ease-in-out}
@keyframes s{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
pre{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.25);padding:12px;border-radius:8px;font-size:12px;max-height:240px;overflow:auto}
</style></head><body><div class="card">
<h1>${failed ? '✗ Setup gagal' : '☤ Hermes Agent'}</h1>
<div class="muted">${escapeHtml(title)}</div>
${failed ? '' : '<div class="bar"><i></i></div>'}
<p>${escapeHtml(state.phase === 'ready' ? (detail || '') : (state.step || detail || ''))}</p>
${state.error ? `<pre>${escapeHtml(state.error)}</pre><p class="muted">Cek console Pterodactyl, perbaiki, lalu ketik <b>retry</b> di console atau restart server.</p>` : '<p class="muted">Halaman ini refresh otomatis. Instalasi pertama bisa 5-10 menit.</p>'}
</div></body></html>`);
  }

  function handleRequest(req, res) {
    const route = resolveRoute(req.url || '/');
    if (route.status) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(statusJson()));
      return;
    }
    const svc = state.services.hermes;
    if (!svc || svc.state !== 'running') {
      let title = 'Sedang menyiapkan Hermes…';
      if (state.phase === 'error') title = 'Setup gagal';
      else if (svc) title = 'Hermes sedang start…';
      sendUnavailable(req, res, title, 'Hermes belum siap, tunggu sebentar.');
      return;
    }

    const upstream = http.request({
      host: '127.0.0.1', port: route.port, method: req.method, path: route.path,
      headers: forwardHeaders(req), agent,
    });
    upstream.on('response', (ures) => {
      const headers = {};
      for (const [k, v] of Object.entries(ures.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
      res.writeHead(ures.statusCode || 502, ures.statusMessage, headers);
      if (/text\/event-stream/.test(String(ures.headers['content-type'] || ''))) res.flushHeaders();
      ures.pipe(res);
      ures.on('error', () => res.destroy());
    });
    upstream.on('error', (err) => {
      if (res.headersSent) { res.destroy(); return; }
      sendUnavailable(req, res, 'Service belum bisa dihubungi', err.code || err.message);
    });
    // Client went away (e.g. closed a streaming chat) → stop the upstream work too.
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  }

  function handleUpgrade(req, socket, head) {
    const route = resolveRoute(req.url || '/');
    const svc = route.service && state.services[route.service];
    if (!route.service || !svc || svc.state !== 'running') {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    const headers = forwardHeaders(req);
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade;
    const upstream = net.connect(route.port, '127.0.0.1');
    const destroyBoth = () => { socket.destroy(); upstream.destroy(); };
    upstream.on('connect', () => {
      let raw = `${req.method} ${route.path} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        for (const value of [].concat(v)) raw += `${k}: ${value}\r\n`;
      }
      upstream.write(`${raw}\r\n`);
      if (head && head.length) upstream.write(head);
      socket.setNoDelay(true);
      upstream.setNoDelay(true);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', destroyBoth);
    socket.on('error', destroyBoth);
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
  }

  const server = http.createServer(handleRequest);
  server.on('upgrade', handleUpgrade);
  server.requestTimeout = 0;      // LLM streams can run for many minutes
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 65_000;
  server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* ignore */ } });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(cfg.public.port, cfg.public.host, () => {
          server.off('error', reject);
          log.ok(`Web aktif di port ${cfg.public.port} (host ${cfg.public.host})`, 'proxy');
          resolve();
        });
      });
    },
    close() { return new Promise((resolve) => server.close(() => resolve())); },
    resolveRoute,
  };
}

module.exports = { createProxy };
