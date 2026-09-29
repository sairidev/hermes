'use strict';

// Pterodactyl's console renders ANSI colours, so we keep them on unless NO_COLOR is set.
const useColor = !process.env.NO_COLOR;
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const paint = (color, text) => (useColor ? `${C[color] || ''}${text}${C.reset}` : text);

const TAGS = {
  launcher: 'cyan',
  setup: 'blue',
  proxy: 'gray',
  '9router': 'magenta',
  hermes: 'green',
  gateway: 'yellow',
};

function tag(name) {
  return paint(TAGS[name] || 'gray', `[${name}]`);
}

function line(name, text) {
  process.stdout.write(`${tag(name)} ${text}\n`);
}

module.exports = {
  paint,
  info: (text, name = 'launcher') => line(name, text),
  ok: (text, name = 'launcher') => line(name, paint('green', `✓ ${text}`)),
  step: (text, name = 'setup') => line(name, paint('bold', `→ ${text}`)),
  warn: (text, name = 'launcher') => line(name, paint('yellow', `⚠ ${text}`)),
  error: (text, name = 'launcher') => line(name, paint('red', `✗ ${text}`)),
  child: (name, text) => line(name, text),
};
