import { describe, expect, it } from 'vitest';

import {
    baseAlarmId,
    isReminderId,
    NO_REMINDERS,
    reminderLeadMinutes,
    reminderTimes,
    ringId,
} from './reminders';

const WAKE = '2026-08-20T07:45:00.000Z';

/** Minutes between an ISO moment and the wake time above. */
function minutesBefore(at: string): number {
    return (new Date(WAKE).getTime() - new Date(at).getTime()) / 60_000;
}

describe('when reminder alarms ring', () => {
    it('ends on the wake time, which is the ring that matters', () => {
        // The whole design in one assertion. The wake time is the latest moment
        // that still gets somebody there, so it has to be a ring; the earlier
        // ones are the extra.
        const times = reminderTimes(WAKE, { count: 3, intervalMinutes: 5 });

        expect(times).toHaveLength(3);
        expect(times[times.length - 1]).toBe(WAKE);
    });

    it('pulls the earlier rings back rather than pushing the last one out', () => {
        // The difference from snooze. Nothing here eats the safety margin: the
        // wake time stays where the engine put it and the extra time is paid for
        // by getting up sooner.
        const times = reminderTimes(WAKE, { count: 3, intervalMinutes: 5 });

        expect(times.map(minutesBefore)).toEqual([10, 5, 0]);
    });

    it('comes out in ringing order', () => {
        const times = reminderTimes(WAKE, { count: 4, intervalMinutes: 3 });

        expect(times.map(minutesBefore)).toEqual([9, 6, 3, 0]);
    });

    it('rings once when reminders are off', () => {
        expect(reminderTimes(WAKE, NO_REMINDERS)).toEqual([WAKE]);
        expect(reminderTimes(WAKE, { count: 1, intervalMinutes: 5 })).toEqual([WAKE]);
    });

    it('still rings once when the configuration is missing or nonsense', () => {
        /*
         * The wake time may never be dropped, whatever the input. A stored
         * config from an older version, a zero, a NaN out of a text field: all of
         * them are reasons to lose the *extra* rings and none of them are a
         * reason to lose the alarm.
         */
        expect(reminderTimes(WAKE, null)).toEqual([WAKE]);
        expect(reminderTimes(WAKE, undefined)).toEqual([WAKE]);
        expect(reminderTimes(WAKE, { count: 0, intervalMinutes: 5 })).toEqual([WAKE]);
        expect(reminderTimes(WAKE, { count: Number.NaN, intervalMinutes: 5 })).toEqual([WAKE]);
    });

    it('never walks an alarm back further than the cap allows', () => {
        // Otherwise a typo in a number field is an alarm at three in the morning.
        const times = reminderTimes(WAKE, { count: 99, intervalMinutes: 999 });

        expect(times).toHaveLength(5);
        expect(minutesBefore(times[0] ?? '')).toBe(80);
    });

    it('treats a zero interval as one minute rather than as one ring', () => {
        // Somebody clearing the field mid-edit asked for reminders and would
        // otherwise silently get none.
        const times = reminderTimes(WAKE, { count: 3, intervalMinutes: 0 });

        expect(times.map(minutesBefore)).toEqual([2, 1, 0]);
    });

    it('gives nothing at all for a wake time it cannot read', () => {
        expect(reminderTimes('not a time', { count: 3, intervalMinutes: 5 })).toEqual([]);
    });
});

describe('how far ahead a screen should say the first ring is', () => {
    it('is zero with reminders off, so nothing extra is said', () => {
        expect(reminderLeadMinutes(NO_REMINDERS)).toBe(0);
        expect(reminderLeadMinutes(null)).toBe(0);
    });

    it('is the whole chain, so Today can name the ring you will actually hear', () => {
        // Today says "your alarm is at 07:45" and the phone makes a noise at
        // 07:35. Without this the screen promises a time it will not keep.
        expect(reminderLeadMinutes({ count: 3, intervalMinutes: 5 })).toBe(10);
    });
});

describe('naming the OS alarms', () => {
    it('leaves the real alarm on its original id', () => {
        /*
         * Load bearing. `heldByOs`, `cancelOrphans` and the ring screen all key
         * off `occurrence-<id>`, so a scheme that renamed the final alarm would
         * have quietly broken all three at once.
         */
        expect(ringId('occurrence-abc', 0)).toBe('occurrence-abc');
    });

    it('suffixes the earlier rings, counted back from the wake time', () => {
        expect(ringId('occurrence-abc', 1)).toBe('occurrence-abc#r1');
        expect(ringId('occurrence-abc', 2)).toBe('occurrence-abc#r2');
    });

    it('tells a reminder apart from the alarm it precedes', () => {
        expect(isReminderId('occurrence-abc#r1')).toBe(true);
        expect(isReminderId('occurrence-abc')).toBe(false);
    });

    it('resolves a reminder back to the morning it belongs to', () => {
        // Otherwise the first two rings come up with no idea why they woke you.
        expect(baseAlarmId('occurrence-abc#r2')).toBe('occurrence-abc');
        expect(baseAlarmId('occurrence-abc')).toBe('occurrence-abc');
    });
});
