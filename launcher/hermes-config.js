'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./log');
const { readJSON, writeJSON, run } = require('./util');

// Uses Hermes' own config API (load_config/save_config) so the YAML stays valid
// and every other section the user changed in the dashboard is preserved.
const PY_APPLY = `
import json, sys
from hermes_cli.config import load_config, save_config
wanted = json.loads(sys.argv[1])
cfg = load_config()
model = cfg.get("model")
if not isinstance(model, dict):
    model = {"default": model} if model else {}
model.update(wanted)
model.pop("key_env", None)
cfg["model"] = model
save_config(cfg)
print("ok", model.get("default"), model.get("base_url"))
`;

function hermesEnv(cfg, extra = {}) {
  const env = {
    ...process.env,
    HERMES_HOME: cfg.hermes.home,
    // Anything Hermes' package manager does fetch lands in .runtime, not in data/.
    HERMES_RUNTIME_DIR: cfg.pmToolsDir,
    PYTHONUNBUFFERED: '1',
    ...extra,
  };
  if (!cfg.hermes.lazyInstalls) env.HERMES_DISABLE_LAZY_INSTALLS = '1';
  return env;
}

// Only re-applies when the values from .env/panel change, so a model picked
// later inside the Hermes dashboard is not overwritten on every restart.
async function applyHermesConfig(cfg, venv) {
  fs.mkdirSync(cfg.hermes.home, { recursive: true });
  if (!cfg.nineRouter.v1) return;
  const wanted = {
    default: cfg.hermes.model,
    provider: 'custom',
    base_url: cfg.nineRouter.v1,
    // The OpenAI SDK refuses an empty key, so keep a placeholder when none is set yet.
    api_key: cfg.nineRouter.apiKey || 'sk-9router-missing-key',
  };
  const stateFile = path.join(cfg.dataDir, 'hermes-router-applied.json');
  const configFile = path.join(cfg.hermes.home, 'config.yaml');
  const last = readJSON(stateFile, null);
  if (last && JSON.stringify(last) === JSON.stringify(wanted) && fs.existsSync(configFile)) {
    log.ok(`Hermes → 9Router: ${cfg.nineRouter.v1} (model ${cfg.hermes.model})`);
    return;
  }
  await run(venv.python, ['-c', PY_APPLY, JSON.stringify(wanted)], {
    cwd: cfg.hermesSrc, env: hermesEnv(cfg), label: 'setup', quiet: true,
  });
  writeJSON(stateFile, wanted);
  log.ok(`Config Hermes ditulis: provider custom → ${cfg.nineRouter.v1}, model ${cfg.hermes.model}`);
}

module.exports = { applyHermesConfig, hermesEnv };
