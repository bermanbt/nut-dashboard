const express = require('express');
const path = require('path');
const { fetchUpsVars } = require('./lib/nut');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const CACHE_MS = parseInt(process.env.POLL_CACHE_MS, 10) || 2000;
const MAX_UPS_SLOTS = 8;

function prettifyName(name) {
  return name
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function loadUpsConfigs() {
  const configs = [];
  for (let i = 1; i <= MAX_UPS_SLOTS; i++) {
    const host = process.env[`UPS${i}_HOST`];
    if (!host) continue;
    const name = process.env[`UPS${i}_NAME`] || 'ups';
    configs.push({
      id: `ups${i}`,
      host,
      port: parseInt(process.env[`UPS${i}_PORT`], 10) || 3493,
      ups: name,
      label: process.env[`UPS${i}_LABEL`] || prettifyName(name),
      username: process.env[`UPS${i}_USER`] || '',
      password: process.env[`UPS${i}_PASSWORD`] || '',
    });
  }
  return configs;
}

const upsConfigs = loadUpsConfigs();
if (upsConfigs.length === 0) {
  console.warn('No UPS configured. Set UPS1_HOST (and friends) as environment variables.');
}

let cache = { at: 0, data: null };

async function pollAll() {
  const results = await Promise.all(
    upsConfigs.map(async (cfg) => {
      try {
        const vars = await fetchUpsVars(cfg);
        return {
          id: cfg.id,
          label: cfg.label,
          host: cfg.host,
          port: cfg.port,
          ups: cfg.ups,
          status: 'ok',
          vars,
          updatedAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          id: cfg.id,
          label: cfg.label,
          host: cfg.host,
          port: cfg.port,
          ups: cfg.ups,
          status: 'error',
          error: err.message,
          updatedAt: new Date().toISOString(),
        };
      }
    })
  );
  return results;
}

async function getData() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_MS) {
    return cache.data;
  }
  const data = await pollAll();
  cache = { at: now, data };
  return data;
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/ups', async (req, res) => {
  try {
    const data = await getData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`nut-dashboard listening on :${PORT}`);
  console.log(`Configured UPS targets: ${upsConfigs.map((c) => `${c.label} (${c.host}:${c.port}/${c.ups})`).join(', ') || 'none'}`);
});
