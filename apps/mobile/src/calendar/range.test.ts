import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { AGENDA_DAYS, isPaged, stepAnchor, visibleDays } from './range';

/** A Wednesday, so Monday alignment is checkable by hand. */
const WEDNESDAY = DateTime.fromISO('2026-09-09T15:30:00', { zone: 'Europe/Amsterdam' });

describe('which days a view shows', () => {
    it('shows one day for the day view, at the start of that day', () => {
        const days = visibleDays('day', WEDNESDAY);

        expect(days.map((day) => day.toISODate())).toEqual(['2026-09-09']);
        expect(days[0]?.hour).toBe(0);
    });

    it('shows Monday to Sunday for the week view, whichever day is anchored', () => {
        // How the Netherlands prints a week, and how Weekday numbers it.
        const days = visibleDays('week', WEDNESDAY);

        expect(days.map((day) => day.toISODate())).toEqual([
            '2026-09-07',
            '2026-09-08',
            '2026-09-09',
            '2026-09-10',
            '2026-09-11',
            '2026-09-12',
            '2026-09-13',
        ]);
    });

    it('keeps a Sunday in the week that ends on it', () => {
        const sunday = DateTime.fromISO('2026-09-13T09:00:00', { zone: 'Europe/Amsterdam' });

        expect(visibleDays('week', sunday)[0]?.toISODate()).toBe('2026-09-07');
    });

    it('reads two weeks ahead for the agenda, starting on the anchor', () => {
        const days = visibleDays('agenda', WEDNESDAY);

        expect(days).toHaveLength(AGENDA_DAYS);
        expect(days[0]?.toISODate()).toBe('2026-09-09');
    });
});

describe('stepping through the calendar', () => {
    it('moves a day at a time in the day view', () => {
        expect(stepAnchor('day', WEDNESDAY, 1).toISODate()).toBe('2026-09-10');
        expect(stepAnchor('day', WEDNESDAY, -1).toISODate()).toBe('2026-09-08');
    });

    it('moves a week at a time in the week view', () => {
        expect(stepAnchor('week', WEDNESDAY, 1).toISODate()).toBe('2026-09-16');
    });

    it('does not move the agenda, which always reads from today', () => {
        expect(stepAnchor('agenda', WEDNESDAY, 1).toISODate()).toBe('2026-09-09');
        expect(isPaged('agenda')).toBe(false);
        expect(isPaged('week')).toBe(true);
    });
});
