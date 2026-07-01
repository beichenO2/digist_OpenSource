// Safari scraper reuses real login sessions — same as manual browsing.
// Risk is negligible; time-window restriction removed.
// Re-enable per-platform if any platform starts rate-limiting.
const RISK_WINDOW_PLATFORMS = new Set<string>([]);

// Platforms temporarily disabled (e.g. account suspended, no viable access).
// Override via DIGIST_DISABLED_PLATFORMS (comma-separated); set to "" to enable all.
const DEFAULT_DISABLED_PLATFORMS = ['twitter'];

function getDisabledPlatforms(): Set<string> {
  const env = process.env.DIGIST_DISABLED_PLATFORMS;
  if (env !== undefined) {
    if (env.trim() === '') return new Set();
    return new Set(env.split(',').map(s => s.trim()).filter(Boolean));
  }
  return new Set(DEFAULT_DISABLED_PLATFORMS);
}

export function isPlatformDisabled(platform: string): boolean {
  return getDisabledPlatforms().has(platform);
}

const WINDOW_START_HOUR = parseInt(process.env.DIGIST_RISK_WINDOW_START_HOUR || '1', 10);
const WINDOW_END_HOUR = parseInt(process.env.DIGIST_RISK_WINDOW_END_HOUR || '7', 10);
const POLICY_TIMEZONE = process.env.DIGIST_POLICY_TZ || 'Asia/Shanghai';

function getHourInTimezone(now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone,
  });
  const hour = parseInt(formatter.format(now), 10);
  return Number.isNaN(hour) ? now.getHours() : hour;
}

function isWithinWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export function canScrapePlatformNow(
  platform: string,
  now = new Date(),
): { allowed: boolean; reason?: string } {
  if (isPlatformDisabled(platform)) {
    return { allowed: false, reason: `${platform} is temporarily disabled` };
  }

  if (!RISK_WINDOW_PLATFORMS.has(platform)) {
    return { allowed: true };
  }

  const hour = getHourInTimezone(now, POLICY_TIMEZONE);
  const allowed = isWithinWindow(hour, WINDOW_START_HOUR, WINDOW_END_HOUR);
  if (allowed) return { allowed: true };

  return {
    allowed: false,
    reason: `${platform} is restricted to ${WINDOW_START_HOUR.toString().padStart(2, '0')}:00-${WINDOW_END_HOUR.toString().padStart(2, '0')}:00 (${POLICY_TIMEZONE})`,
  };
}
