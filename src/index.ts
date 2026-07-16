import { DiGistEngine } from './engine.js';

if (process.env.POLAR_RUNTIME_MANAGED !== '1') {
  console.error('[Engine] Persistent execution must be started by PolarProcess via Start/engine.sh.');
  process.exit(1);
}

const engine = new DiGistEngine({
  dbPath: process.env.DIGIST_DB || './data/digist.sqlite',
  evolutionIntervalMs: 30 * 60 * 1000,
  reportIntervalMs: 60 * 60 * 1000,
});

const shutdown = async () => {
  await engine.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
engine.start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
