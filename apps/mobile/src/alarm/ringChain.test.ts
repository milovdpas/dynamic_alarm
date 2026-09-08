import { beforeEach, describe, expect, it } from 'vitest';

import type { AlarmRequest, AlarmScheduler } from './AlarmScheduler';
import { armRingChain } from './ringChain';

/**
 * The one writer of a morning's rings, against a fake OS.
 *
 * Found on a phone on 2026-09-08: a cancellation push pulled the wake time from
 * 07:44 to 07:29 and the OS then held 07:29, 07:34 and 07:39, because the push
 * moved the real alarm and left the two reminders where they had been. The next
 * move, back to 07:44, left them at 07:19 and 07:24. Both paths write through
 * this helper now, so this is where that is pinned.
 */
const held = new Map<string, AlarmRequest>();

const scheduler: AlarmScheduler = {
    platform: 'android',
    schedule: (request) => {
        held.set(request.id, request);
        return Promise.resolve();
    },
    cancel: (id) => {
        held.delete(id);
        return Promise.resolve();
    },
    cancelAll: () => {
        held.clear();
        return Promise.resolve();
    },
    listScheduled: () => Promise.resolve([...held.keys()]),
    requestPermissions: () => Promise.resolve({ notifications: true, exactAlarm: true }),
    getPermissions: () => Promise.resolve({ notifications: true, exactAlarm: true }),
};

const WAKE = '2026-09-10T05:44:00.000Z';
const EARLIER = '2026-09-10T05:29:00.000Z';

function chain(wakeAt: string, reminders: { count: number; intervalMinutes: number } | null) {
    return armRingChain(scheduler, {
        baseId: 'occurrence-thu',
        wakeAt,
        reminders,
        title: '',
        body: '',
        soundUri: null,
        occurrenceId: 'thu',
    });
}

function heldTimes(): Record<string, string> {
    return Object.fromEntries([...held.values()].map((request) => [request.id, request.at]));
}

beforeEach(() => {
    held.clear();
});

describe('writing a morning as a chain of rings', () => {
    it('ends on the wake time under the plain id, with the reminders before it', async () => {
        await chain(WAKE, { count: 3, intervalMinutes: 5 });

        expect(heldTimes()).toEqual({
            'occurrence-thu': '2026-09-10T05:44:00.000Z',
            'occurrence-thu#r1': '2026-09-10T05:39:00.000Z',
            'occurrence-thu#r2': '2026-09-10T05:34:00.000Z',
        });
    });

    it('moves every ring when the wake time moves', async () => {
        await chain(WAKE, { count: 3, intervalMinutes: 5 });

        await chain(EARLIER, { count: 3, intervalMinutes: 5 });

        expect(heldTimes()).toEqual({
            'occurrence-thu': '2026-09-10T05:29:00.000Z',
            'occurrence-thu#r1': '2026-09-10T05:24:00.000Z',
            'occurrence-thu#r2': '2026-09-10T05:19:00.000Z',
        });
    });

    it('cancels reminders the new chain no longer has', async () => {
        await chain(WAKE, { count: 3, intervalMinutes: 5 });

        await chain(WAKE, { count: 1, intervalMinutes: 5 });

        expect(Object.keys(heldTimes())).toEqual(['occurrence-thu']);
    });

    it('with no reminder setting to go on, arms the wake time and clears the rest', async () => {
        // A baseline written before reminders were kept on it. A missing
        // reminder costs a nudge; a stale one rings at the wrong time.
        await chain(WAKE, { count: 3, intervalMinutes: 5 });

        await chain(EARLIER, null);

        expect(heldTimes()).toEqual({ 'occurrence-thu': '2026-09-10T05:29:00.000Z' });
    });

    it("leaves other mornings' reminders alone", async () => {
        held.set('occurrence-fri#r1', { id: 'occurrence-fri#r1', at: WAKE, title: '', body: '' });

        await chain(WAKE, { count: 1, intervalMinutes: 5 });

        expect(held.has('occurrence-fri#r1')).toBe(true);
    });
});
