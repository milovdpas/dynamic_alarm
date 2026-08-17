import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * i18n, reduced to what these helpers use.
 *
 * The real module initialises i18next and reaches for `expo-localization`, which
 * does not exist in node. Only the language matters here, and it decides how a
 * month is spelled.
 */
vi.mock('@/i18n/i18n', () => ({ default: { language: 'nl' } }));

const { clock, relativeDateTime, relativeDay } = await import('@/utils/time');

/** Keys pass through, which is enough to see which one was chosen. */
const t = (key: string) => key;

afterEach(() => {
    vi.useRealTimers();
});

describe('showing an instant as a wall clock', () => {
    it('converts UTC into Amsterdam time, which is the whole reason this exists', () => {
        // The API serialises with toISOString, so occurrence times arrive as
        // UTC. Formatting this without converting shows 05:34, which is not a
        // crash and not a wrong calculation, it is two hours of somebody's
        // morning.
        expect(clock('2026-08-18T05:34:00.000Z')).toBe('07:34');
    });

    it('keeps a time that already carries an offset', () => {
        // Plan times from the engine arrive as +02:00 and were right by accident
        // on screens that forgot to convert, which is worse than being wrong
        // everywhere: two screens disagreed and neither looked broken.
        expect(clock('2026-08-18T07:20:00.000+02:00')).toBe('07:20');
    });

    it('follows the winter offset rather than a fixed two hours', () => {
        expect(clock('2026-01-15T05:34:00.000Z')).toBe('06:34');
    });
});

describe('naming the morning a date belongs to', () => {
    it('says today and tomorrow rather than a date', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-17T20:00:00.000+02:00'));

        expect(relativeDay(t, '2026-08-17')).toBe('home.today');
        expect(relativeDay(t, '2026-08-18')).toBe('home.tomorrow');
    });

    it('spells out anything further off, because a weekday alone is ambiguous', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-17T20:00:00.000+02:00'));

        // A schedule that runs on more than one day makes "Wednesday" a
        // question rather than an answer.
        expect(relativeDay(t, '2026-08-19')).toBe('woensdag 19 augustus');
    });

    it('is still tomorrow just before midnight, not in two days', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-17T23:58:00.000+02:00'));

        expect(relativeDay(t, '2026-08-18')).toBe('home.tomorrow');
    });
});

describe('saying how old something is', () => {
    it('gives the time of day for today, since that is what judges the age', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-17T22:00:00.000+02:00'));

        expect(relativeDateTime(t, '2026-08-17T19:30:00.000Z')).toBe('21:30');
    });

    it('keeps the time of day for yesterday too', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-17T09:00:00.000+02:00'));

        // Yesterday at 23:50 and yesterday at 07:00 are worth different amounts
        // of trust, so "yesterday" on its own is not enough.
        expect(relativeDateTime(t, '2026-08-16T21:50:00.000Z')).toBe('home.yesterday 23:50');
    });

    it('spells out the date once it is older than that', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-17T09:00:00.000+02:00'));

        expect(relativeDateTime(t, '2026-08-15T06:00:00.000Z')).toBe('15 augustus 08:00');
    });

    it('counts calendar days rather than elapsed hours', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-17T00:30:00.000+02:00'));

        // Ninety minutes earlier, and still yesterday. Rounding the difference
        // in hours would call this today.
        expect(relativeDateTime(t, '2026-08-16T21:00:00.000Z')).toBe('home.yesterday 23:00');
    });
});
