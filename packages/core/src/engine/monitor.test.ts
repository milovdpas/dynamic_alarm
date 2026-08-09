import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { APP_CONSTANTS } from '@alarm/types';
import {
    computeNextCheckAt,
    estimateChecksPerOccurrence,
    resolveCheckIntervalMinutes,
    shouldArm,
    shouldPushWakeChange,
} from './monitor';

const TZ = 'Europe/Amsterdam';
const WAKE = DateTime.fromISO('2026-08-10T06:53:00', { zone: TZ });

function minutesBefore(minutes: number): string {
    return WAKE.minus({ minutes }).toISO()!;
}

describe('resolveCheckIntervalMinutes', () => {
    it.each([
        [600, null], // beyond the arming horizon, costs nothing
        [480, 30],
        [300, 30],
        [121, 30],
        [120, 10],
        [46, 10],
        [45, 3],
        [10, 3],
    ])('%i minutes out → %s minute interval', (minutesUntilWake, expected) => {
        expect(resolveCheckIntervalMinutes(minutesUntilWake)).toBe(expected);
    });
});

describe('computeNextCheckAt', () => {
    it('tightens the cadence as the alarm approaches', () => {
        const far = computeNextCheckAt({
            wakeAt: WAKE.toISO()!,
            now: minutesBefore(300),
            timezone: TZ,
        });
        const near = computeNextCheckAt({
            wakeAt: WAKE.toISO()!,
            now: minutesBefore(20),
            timezone: TZ,
        });

        expect(
            DateTime.fromISO(far!).diff(DateTime.fromISO(minutesBefore(300)), 'minutes').minutes,
        ).toBe(30);
        expect(
            DateTime.fromISO(near!).diff(DateTime.fromISO(minutesBefore(20)), 'minutes').minutes,
        ).toBe(3);
    });

    it('never schedules a check past the alarm it is meant to change', () => {
        const next = computeNextCheckAt({
            wakeAt: WAKE.toISO()!,
            now: minutesBefore(2),
            timezone: TZ,
        });
        expect(DateTime.fromISO(next!).toMillis()).toBe(WAKE.toMillis());
    });

    it('stops once the alarm has rung', () => {
        expect(
            computeNextCheckAt({
                wakeAt: WAKE.toISO()!,
                now: WAKE.plus({ minutes: 1 }).toISO()!,
                timezone: TZ,
            }),
        ).toBeNull();
    });

    it('stays silent beyond the arming horizon', () => {
        expect(
            computeNextCheckAt({ wakeAt: WAKE.toISO()!, now: minutesBefore(600), timezone: TZ }),
        ).toBeNull();
    });
});

describe('estimateChecksPerOccurrence', () => {
    /**
     * A guard on the API bill, not on correctness. NS publishes no rate limits,
     * so the only ceiling is the one we impose here, if someone widens a cadence
     * band, this should fail loudly rather than show up as a surprise later.
     */
    it('costs ~34 provider calls per occurrence per night', () => {
        expect(estimateChecksPerOccurrence()).toBe(34);
    });

    it('stays an order of magnitude below blanket per-minute polling', () => {
        const blanket = APP_CONSTANTS.MONITOR.ARM_LEAD_MINUTES; // one call per minute
        expect(estimateChecksPerOccurrence() * 10).toBeLessThan(blanket);
    });
});

describe('shouldArm', () => {
    it.each([
        [600, false],
        [480, true],
        [30, true],
        [0, false],
        [-5, false],
    ])('%i minutes out → %s', (minutes, expected) => {
        expect(shouldArm(minutes)).toBe(expected);
    });
});

describe('shouldPushWakeChange', () => {
    const at = (time: string) => DateTime.fromISO(`2026-08-10T${time}:00`, { zone: TZ }).toISO()!;

    it('pushes a later wake time, the whole point of the product', () => {
        expect(shouldPushWakeChange(at('06:53'), at('07:05'), TZ)).toBe(true);
    });

    it('ignores jitter too small for a human to notice', () => {
        expect(shouldPushWakeChange(at('06:53'), at('06:54'), TZ)).toBe(false);
    });

    it('refuses to move an alarm earlier by default', () => {
        // The device already holds a pessimistic anchor. Silently pulling it earlier
        // on a best-effort push would trade a guaranteed wake-up for a hopeful one.
        expect(shouldPushWakeChange(at('06:53'), at('06:35'), TZ)).toBe(false);
    });

    it('allows an earlier alarm only when the caller opts in', () => {
        expect(shouldPushWakeChange(at('06:53'), at('06:35'), TZ, { allowEarlier: true })).toBe(
            true,
        );
    });
});
