#!/usr/bin/env node
'use strict';

// Hermes Agent (web) — launcher.
// Pterodactyl (egg Node.js), VPS, atau Docker: cukup jalankan `node index.js`.
// Model AI diambil dari 9Router yang berjalan terpisah (NINEROUTER_URL).
require('./launcher/main')
  .main(process.argv.slice(2))
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
