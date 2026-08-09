import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Weekday } from '@alarm/types';
import { nextOccurrenceDate, parseLocalTime, resolveLocalTimeOnDate } from './time';

const TZ = 'Europe/Amsterdam';

describe('parseLocalTime', () => {
    it.each([
        ['08:30', { hour: 8, minute: 30 }],
        ['6:05', { hour: 6, minute: 5 }],
        ['00:00', { hour: 0, minute: 0 }],
        ['23:59', { hour: 23, minute: 59 }],
    ])('parses %s', (input, expected) => {
        expect(parseLocalTime(input)).toEqual(expected);
    });

    it.each(['24:00', '08:60', '8', '08:5', 'morning', ''])('rejects %s', (input) => {
        expect(() => parseLocalTime(input)).toThrow();
    });
});

describe('resolveLocalTimeOnDate, DST', () => {
    /**
     * These are the two mornings a naive `date + hours` implementation silently
     * gets wrong. A schedule must not vanish or fire an hour off because the
     * clocks moved.
     */
    it('survives the spring-forward gap, where 02:30 does not exist', () => {
        // 2027-03-28: clocks jump 02:00 → 03:00 in Amsterdam.
        const resolved = resolveLocalTimeOnDate('2027-03-28', '02:30', TZ);
        expect(resolved.isValid).toBe(true);
        expect(resolved.toUTC().toISO()).toBeTruthy();
    });

    it('survives the autumn overlap, where 02:30 happens twice', () => {
        // 2026-10-25: clocks fall 03:00 → 02:00 in Amsterdam.
        const resolved = resolveLocalTimeOnDate('2026-10-25', '02:30', TZ);
        expect(resolved.isValid).toBe(true);
        expect(resolved.hour).toBe(2);
    });

    it('keeps a normal wake time on the DST day at the same wall clock', () => {
        const resolved = resolveLocalTimeOnDate('2026-10-25', '06:53', TZ);
        expect(resolved.toFormat('HH:mm')).toBe('06:53');
    });
});

describe('nextOccurrenceDate', () => {
    // Monday 2026-08-10, 09:00 local, after a 08:30 alarm has already passed.
    const now = DateTime.fromISO('2026-08-10T09:00:00', { zone: TZ });

    it('skips today once the time has already gone by', () => {
        const next = nextOccurrenceDate([Weekday.MONDAY], '08:30', TZ, now);
        expect(next?.toISODate()).toBe('2026-08-17');
    });

    it('still uses today when the time is yet to come', () => {
        const next = nextOccurrenceDate([Weekday.MONDAY], '18:00', TZ, now);
        expect(next?.toISODate()).toBe('2026-08-10');
    });

    it('finds the nearest matching weekday', () => {
        const next = nextOccurrenceDate([Weekday.WEDNESDAY, Weekday.FRIDAY], '08:30', TZ, now);
        expect(next?.toISODate()).toBe('2026-08-12');
    });

    it('treats an empty weekday list as inactive rather than an error', () => {
        expect(nextOccurrenceDate([], '08:30', TZ, now)).toBeNull();
    });
});
