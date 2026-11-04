// All times in a conference file are local wall-clock strings ("YYYY-MM-DDTHH:mm") in the
// conference timezone. Display, grouping and ordering work directly on those strings, so no
// timezone conversion is needed except to find "now" in the conference timezone.

export const dayKey = (dt: string) => dt.slice(0, 10);

/** Minutes since epoch treating the wall-clock time as UTC. Good for differences and layout. */
export function wallMinutes(dt: string): number {
  const [d, t] = dt.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = (t ?? '00:00').split(':').map(Number);
  return Date.UTC(y, mo - 1, da, h, mi) / 60000;
}

export const minuteOfDay = (dt: string) => {
  const [h, m] = dt.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
};

export function formatTime(dt: string): string {
  const [h, m] = dt.slice(11, 16).split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatRange(start: string, end: string | null): string {
  return end ? `${formatTime(start)} – ${formatTime(end)}` : formatTime(start);
}

export function formatDuration(start: string, end: string | null): string {
  if (!end) return '';
  const mins = wallMinutes(end) - wallMinutes(start);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayLongFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function dayDate(key: string) {
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}
export const formatDay = (key: string) => dayFmt.format(dayDate(key));
export const formatDayLong = (key: string) => dayLongFmt.format(dayDate(key));

/** Current wall-clock time in `tz`, as "YYYY-MM-DDTHH:mm". */
export function nowInZone(tz: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Short zone name for display, e.g. "EST". */
export function zoneAbbrev(tz: string, at = new Date()): string {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at);
  return p.find((x) => x.type === 'timeZoneName')?.value ?? tz;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ymd = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

/** "Wednesday, 4 November" */
export const longDate = (key: string) => {
  const x = ymd(key);
  return `${DOW_LONG[x.dow]}, ${x.d} ${MON_LONG[x.m - 1]}`;
};
/** "Wed 4 Nov" */
export const dayLabel = (key: string) => {
  const x = ymd(key);
  return `${DOW[x.dow]} ${x.d} ${MON[x.m - 1]}`;
};
export const weekdayShort = (key: string) => DOW[ymd(key).dow];
export const dayNumber = (key: string) => String(ymd(key).d);

/** "Nov 4–7", "Oct 30–Nov 2", "Dec 30, 2026–Jan 2, 2027" */
export function formatShortRange(a: string, b: string): string {
  const x = ymd(a);
  const y = ymd(b);
  if (a === b) return `${MON[x.m - 1]} ${x.d}`;
  if (x.y !== y.y) return `${MON[x.m - 1]} ${x.d}, ${x.y}–${MON[y.m - 1]} ${y.d}, ${y.y}`;
  if (x.m !== y.m) return `${MON[x.m - 1]} ${x.d}–${MON[y.m - 1]} ${y.d}`;
  return `${MON[x.m - 1]} ${x.d}–${y.d}`;
}

/** "8:00 AM–5:00 PM" (reference calendar style) */
export const formatSpan = (start: string, end: string | null) => (end ? `${formatTime(start)}–${formatTime(end)}` : formatTime(start));
