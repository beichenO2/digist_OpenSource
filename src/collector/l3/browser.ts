/**
 * Isolated anti-detect browser for the L3 fallback layer.
 *
 * Uses patchright (Chromium with anti-detection patches) via a lazy dynamic
 * import so the main crawl path never loads it and installs stay light — it is
 * an optionalDependency. The profile lives in its own directory, fully isolated
 * from the user's day-to-day browser (this is what fixes "浏览器报废").
 */
import { join } from 'node:path';

const PROFILE_DIR = process.env.DIGIST_L3_PROFILE_DIR || './data/l3-profile';
const NAV_TIMEOUT = Number(process.env.DIGIST_L3_NAV_TIMEOUT_MS || 25_000);

export interface PageCapture {
  html: string;
  screenshotBase64?: string;
}

let _chromium: unknown | null = null;

async function loadChromium(): Promise<any> {
  if (_chromium) return _chromium;
  try {
    const mod = await import('patchright');
    _chromium = (mod as { chromium: unknown }).chromium;
    return _chromium;
  } catch (err) {
    throw new Error(
      '[L3] patchright not installed. Run `npm install --save-optional patchright` and `npx patchright install chromium`. ' +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

export async function isL3Available(): Promise<boolean> {
  try {
    await loadChromium();
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a URL in the isolated browser and return page HTML (+ optional shot).
 * Always tears the browser down, even on failure.
 */
export async function capturePage(
  url: string,
  opts: { waitFor?: string; screenshot?: boolean } = {},
): Promise<PageCapture> {
  const chromium = await loadChromium();
  const context = await chromium.launchPersistentContext(join(PROFILE_DIR), {
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    if (opts.waitFor) {
      await page.waitForSelector(opts.waitFor, { timeout: 8_000 }).catch(() => {});
    } else {
      // give client-rendered pages a beat to hydrate
      await page.waitForTimeout(1_500);
    }
    const html = await page.content();
    let screenshotBase64: string | undefined;
    if (opts.screenshot) {
      const buf = await page.screenshot({ fullPage: false });
      screenshotBase64 = Buffer.from(buf).toString('base64');
    }
    return { html, screenshotBase64 };
  } finally {
    await context.close().catch(() => {});
  }
}
