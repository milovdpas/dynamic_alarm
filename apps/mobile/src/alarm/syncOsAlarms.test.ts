import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OccurrenceState } from '@alarm/types';
import type { OccurrenceResponse } from '@alarm/types';

import type { AlarmRequest } from './AlarmScheduler';

/**
 * The one sweep that decides what the OS holds, driven against a fake OS.
 *
 * Everything else that arms an alarm goes through this: Today's load, a skip on
 * the calendar, a step left out of a morning. It had no direct test while it
 * lived inside a React hook; now that it is a function, the fake scheduler below
 * is all it takes to assert on the set of alarms rather than on intentions.
 */
const held = new Map<string, AlarmRequest>();
/** Ids the fake OS refuses, to stand in for a time that has just passed. */
const refused = new Set<string>();
const acked: string[] = [];
const remembered: string[] = [];
const forgotten: string[] = [];

vi.mock('expo-router', () => ({ useFocusEffect: () => undefined }));
vi.mock('@/utils/modules/Storage', () => ({
    default: {
        getItem: () => Promise.resolve(null),
        setItem: () => Promise.resolve(),
        removeItem: () => Promise.resolve(),
    },
}));
vi.mock('@/utils/modules/ApiCache', () => ({ peekCache: () => Promise.resolve(null) }));
vi.mock('@/utils/modules/Axios', () => ({
    ApiRequestError: { from: (error: unknown) => ({ code: String(error) }) },
}));
vi.mock('@/i18n/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/alarm/alarmSound', () => ({ resolveAlarmSoundUri: () => Promise.resolve(null) }));
vi.mock('@/api', () => ({
    ackOccurrence: (id: string) => {
        acked.push(id);
        return Promise.resolve();
    },
    armSchedule: () => Promise.resolve(null),
    listOccurrences: () => Promise.resolve([]),
    listSchedules: () => Promise.resolve([]),
    OCCURRENCES_CACHE_KEY: 'occurrences',
}));
vi.mock('@/push/heldAlarm', () => ({
    rememberHeldAlarm: (record: { occurrenceId: string }) => {
        remembered.push(record.occurrenceId);
        return Promise.resolve();
    },
    forgetHeldAlarm: (id: string) => {
        forgotten.push(id);
        return Promise.resolve();
    },
}));
vi.mock('@/alarm', () => ({
    canGuaranteeAlarm: () => true,
    getAlarmScheduler: () => ({
        platform: 'android',
        schedule: (request: AlarmRequest) => {
            if (refused.has(request.id)) {
                return Promise.reject(new Error('Refusing to schedule an alarm in the past'));
            }
            held.set(request.id, request);
            return Promise.resolve();
        },
        cancel: (id: string) => {
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
    }),
}));

const { syncOsAlarms } = await import('./useNextAlarm');

const IN_TWO_HOURS = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const IN_THREE_HOURS = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
const AN_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();

function morning(id: string, wakeAt: string, overrides: Partial<OccurrenceResponse> = {}): OccurrenceResponse {
    return {
        id,
        scheduleId: 'sched',
        scheduleName: 'Work',
        reminders: { count: 1, intervalMinutes: 5 },
        date: wakeAt.slice(0, 10),
        state: OccurrenceState.ARMED,
        anchorWakeAt: wakeAt,
        currentWakeAt: wakeAt,
        departHomeAt: wakeAt,
        journey: null,
        replacedJourney: null,
        plan: null as unknown as OccurrenceResponse['plan'],
        lastCheckedAt: null,
        simulated: null,
        disabledStepIds: [],
        ...overrides,
    };
}

beforeEach(() => {
    held.clear();
    refused.clear();
    acked.length = 0;
    remembered.length = 0;
    forgotten.length = 0;
});

describe('making the OS hold what the list says', () => {
    it('arms every listed morning at its wake time', async () => {
        const { outcomes } = await syncOsAlarms([
            morning('a', IN_TWO_HOURS),
            morning('b', IN_THREE_HOURS),
        ]);

        expect(outcomes.map((outcome) => outcome.armed)).toEqual([true, true]);
        expect(held.get('occurrence-a')?.at).toBe(IN_TWO_HOURS);
        expect(held.get('occurrence-b')?.at).toBe(IN_THREE_HOURS);
    });

    it('arms the reminder chain too, and the real alarm keeps its plain id', async () => {
        await syncOsAlarms([
            morning('a', IN_TWO_HOURS, { reminders: { count: 3, intervalMinutes: 5 } }),
        ]);

        expect([...held.keys()].sort()).toEqual([
            'occurrence-a',
            'occurrence-a#r1',
            'occurrence-a#r2',
        ]);
    });

    it('acknowledges only what the OS confirms, and remembers the baseline', async () => {
        await syncOsAlarms([morning('a', IN_TWO_HOURS)]);

        expect(acked).toEqual(['a']);
        expect(remembered).toEqual(['a']);
    });

    it('never arms a skipped morning, and cancels what the OS still held for it', async () => {
        // A morning its owner sat out. The server lists it so the screens can
        // show it as skipped; arming it would undo the one thing the skip means.
        held.set('occurrence-s', { id: 'occurrence-s', at: IN_TWO_HOURS, title: '', body: '' });

        const { occurrences } = await syncOsAlarms([
            morning('s', IN_TWO_HOURS, { state: OccurrenceState.SKIPPED }),
        ]);

        expect(occurrences).toEqual([]);
        expect(held.has('occurrence-s')).toBe(false);
        expect(forgotten).toContain('s');
        expect(acked).toEqual([]);
    });

    it('drops a morning that has passed rather than asking the OS for it', async () => {
        // The bug of 2026-09-07 in one line: a rung morning re-armed, refused,
        // and blamed on the device.
        const { occurrences, outcomes } = await syncOsAlarms([morning('old', AN_HOUR_AGO)]);

        expect(occurrences).toEqual([]);
        expect(outcomes).toEqual([]);
        expect(held.size).toBe(0);
    });

    it('cancels an alarm the OS holds for a morning no longer listed', async () => {
        // A deleted schedule that keeps ringing is worse than one that never rang.
        held.set('occurrence-gone', { id: 'occurrence-gone', at: IN_TWO_HOURS, title: '', body: '' });
        held.set('occurrence-gone#r1', { id: 'occurrence-gone#r1', at: IN_TWO_HOURS, title: '', body: '' });

        await syncOsAlarms([morning('a', IN_THREE_HOURS)]);

        expect(held.has('occurrence-gone')).toBe(false);
        expect(held.has('occurrence-gone#r1')).toBe(false);
        expect(held.has('occurrence-a')).toBe(true);
        expect(forgotten).toContain('gone');
    });

    it('leaves hand-set alarms alone', async () => {
        // They live in no server list, so treating them as orphans would cancel
        // every one of them the moment Today refreshed.
        held.set('standalone-x@t', { id: 'standalone-x@t', at: IN_TWO_HOURS, title: '', body: '' });

        await syncOsAlarms([]);

        expect(held.has('standalone-x@t')).toBe(true);
    });

    it('lets one refusal cost one morning, not the week', async () => {
        refused.add('occurrence-b');

        const { outcomes } = await syncOsAlarms([
            morning('a', IN_TWO_HOURS),
            morning('b', IN_THREE_HOURS),
            morning('c', IN_THREE_HOURS),
        ]);

        expect(outcomes.map((outcome) => outcome.armed)).toEqual([true, false, true]);
        expect(outcomes[1]).toEqual({ armed: false, failure: 'REFUSED' });
        expect(acked.sort()).toEqual(['a', 'c']);
    });
});
