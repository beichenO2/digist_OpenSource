import { DiGistEngine } from './engine.js';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PID_FILE = resolve('./data/.engine.pid');

function acquireLock(): boolean {
  mkdirSync('./data', { recursive: true });
  if (existsSync(PID_FILE)) {
    const oldPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    try {
      process.kill(oldPid, 0);
      console.error(`[Engine] Another instance already running (PID ${oldPid}). Exiting.`);
      return false;
    } catch {
      console.warn(`[Engine] Stale PID file found (PID ${oldPid} not alive). Taking over.`);
    }
  }
  writeFileSync(PID_FILE, String(process.pid));
  return true;
}

function releaseLock(): void {
  try { unlinkSync(PID_FILE); } catch {}
}

if (!acquireLock()) {
  process.exit(1);
}

const engine = new DiGistEngine({
  dbPath: process.env.DIGIST_DB || './data/digist.sqlite',
  evolutionIntervalMs: 30 * 60 * 1000,
  reportIntervalMs: 60 * 60 * 1000,
});

const shutdown = async () => {
  await engine.stop();
  releaseLock();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', releaseLock);

engine.start().catch(err => {
  console.error('Fatal error:', err);
  releaseLock();
  process.exit(1);
});
