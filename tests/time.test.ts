import { describe, expect, it } from 'vitest';
import { formatDay, formatDuration, formatRange, formatTime, minuteOfDay, nowInZone, wallMinutes } from '../src/lib/time.ts';

describe('time helpers', () => {
  it('formats 12-hour times', () => {
    expect(formatTime('2026-11-04T00:05')).toBe('12:05 AM');
    expect(formatTime('2026-11-04T12:00')).toBe('12:00 PM');
    expect(formatTime('2026-11-04T19:30')).toBe('7:30 PM');
    expect(formatRange('2026-11-04T19:30', '2026-11-04T22:00')).toBe('7:30 PM – 10:00 PM');
    expect(formatRange('2026-11-04T19:30', null)).toBe('7:30 PM');
  });

  it('computes wall-clock durations, including across midnight', () => {
    expect(formatDuration('2026-11-04T19:30', '2026-11-04T22:00')).toBe('2h 30m');
    expect(formatDuration('2026-11-04T23:00', '2026-11-05T01:00')).toBe('2h');
    expect(formatDuration('2026-11-04T09:00', '2026-11-04T09:18')).toBe('18m');
    expect(wallMinutes('2026-11-05T00:00') - wallMinutes('2026-11-04T00:00')).toBe(1440);
    expect(minuteOfDay('2026-11-04T19:30')).toBe(1170);
  });

  it('labels days without shifting them by the local timezone', () => {
    expect(formatDay('2026-11-04')).toBe('Wed, Nov 4');
  });

  it('reads now in the conference timezone, across DST changes', () => {
    // 2026-11-01 06:30Z = 01:30 EST (after fall-back at 06:00Z); 2026-07-01 12:00Z = 08:00 EDT
    expect(nowInZone('America/New_York', new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01T01:30');
    expect(nowInZone('America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe('2026-07-01T08:00');
    expect(nowInZone('Europe/Berlin', new Date('2027-03-28T01:30:00Z'))).toBe('2027-03-28T03:30');
    expect(nowInZone('Asia/Kolkata', new Date('2026-01-01T23:45:00Z'))).toBe('2026-01-02T05:15');
  });
});
