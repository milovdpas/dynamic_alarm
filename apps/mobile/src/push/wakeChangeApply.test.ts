import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_MESSAGE_TYPE, WakeChangeReason } from '@alarm/types';
import type { ReminderConfig, WakeChangedPush } from '@alarm/types';

import type { AlarmRequest } from '@/alarm/AlarmScheduler';

/**
 * A pushed wake time reaching the OS, against a fake scheduler.
 *
 * The payload tests beside this stub the scheduler out. This one lets it hold
 * alarms, because what it holds afterwards is the whole question: a moved alarm
 * whose reminders stayed behind rings after its owner is up.
 */
const held = new Map<string, AlarmRequest>();
let baseline: { occurrenceId: string; wakeAt: string; reminders?: ReminderConfig } | null = null;
const remembered: { occurrenceId: string; wakeAt: string; reminders?: ReminderConfig }[] = [];

vi.mock('@/alarm', () => ({
    canGuaranteeAlarm: () => true,
    getAlarmScheduler: () => ({
        platform: 'android',
        schedule: (request: AlarmRequest) => {
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
vi.mock('@/api', () => ({ ackOccurrence: () => Promise.resolve() }));
vi.mock('@/alarm/alarmSound', () => ({ resolveAlarmSoundUri: () => Promise.resolve(null) }));
vi.mock('@/alarm/disruption', () => ({ rememberDisruption: () => Promise.resolve() }));
vi.mock('@/alarm/wakeChangeCopy', () => ({ describeWakeChange: () => 'a sentence' }));
vi.mock('@/push/heldAlarm', () => ({
    readHeldAlarm: () => Promise.resolve(baseline),
    rememberHeldAlarm: (record: { occurrenceId: string; wakeAt: string; reminders?: ReminderConfig }) => {
        remembered.push(record);
        return Promise.resolve();
    },
}));
vi.mock('@/push/pushLog', () => ({ recordPushOutcome: () => Promise.resolve() }));
vi.mock('@/i18n/i18n', () => ({ default: { t: (key: string) => key } }));

const { applyWakeChange } = await import('@/push/wakeChangePush');

const HELD = '2026-09-10T05:44:00.000Z';
const LATER = '2026-09-10T05:59:00.000Z';
const EARLIER = '2026-09-10T05:29:00.000Z';

function push(wakeAt: string, overrides: Partial<WakeChangedPush> = {}): WakeChangedPush {
    return {
        type: PUSH_MESSAGE_TYPE.WAKE_CHANGED,
        occurrenceId: 'thu',
        date: '2026-09-10',
        wakeAt,
        reason: WakeChangeReason.DELAY,
        simulated: false,
        emergency: false,
        ...overrides,
    };
}

function heldTimes(): Record<string, string> {
    return Object.fromEntries([...held.values()].map((request) => [request.id, request.at]));
}

beforeEach(() => {
    held.clear();
    remembered.length = 0;
    baseline = { occurrenceId: 'thu', wakeAt: HELD, reminders: { count: 3, intervalMinutes: 5 } };
    // What the app armed: the chain for 07:44 local.
    held.set('occurrence-thu', { id: 'occurrence-thu', at: HELD, title: '', body: '' });
    held.set('occurrence-thu#r1', { id: 'occurrence-thu#r1', at: '2026-09-10T05:39:00.000Z', title: '', body: '' });
    held.set('occurrence-thu#r2', { id: 'occurrence-thu#r2', at: '2026-09-10T05:34:00.000Z', title: '', body: '' });
});

describe('what the OS holds after a pushed move', () => {
    it('moves the reminders with the wake time', async () => {
        // The bug of 2026-09-08: only the plain id moved, and the phone rang at
        // 07:29, then twice more after its owner was already up.
        const outcome = await applyWakeChange(push(LATER));

        expect(outcome).toBe('APPLIED');
        expect(heldTimes()).toEqual({
            'occurrence-thu': '2026-09-10T05:59:00.000Z',
            'occurrence-thu#r1': '2026-09-10T05:54:00.000Z',
            'occurrence-thu#r2': '2026-09-10T05:49:00.000Z',
        });
    });

    it('moves the whole chain earlier too, when the server calls it an emergency', async () => {
        await applyWakeChange(push(EARLIER, { reason: WakeChangeReason.CANCELLATION, emergency: true }));

        expect(heldTimes()).toEqual({
            'occurrence-thu': '2026-09-10T05:29:00.000Z',
            'occurrence-thu#r1': '2026-09-10T05:24:00.000Z',
            'occurrence-thu#r2': '2026-09-10T05:19:00.000Z',
        });
    });

    it('carries the reminders forward on the new baseline', async () => {
        await applyWakeChange(push(LATER));

        expect(remembered).toEqual([
            { occurrenceId: 'thu', wakeAt: LATER, reminders: { count: 3, intervalMinutes: 5 } },
        ]);
    });

    it('clears stale reminders when the baseline never recorded any', async () => {
        // A record from before reminders were kept. Better one ring at the
        // right time than three with two of them wrong.
        baseline = { occurrenceId: 'thu', wakeAt: HELD };

        await applyWakeChange(push(LATER));

        expect(heldTimes()).toEqual({ 'occurrence-thu': '2026-09-10T05:59:00.000Z' });
    });

    it('touches nothing when the push is refused', async () => {
        const before = heldTimes();

        const outcome = await applyWakeChange(push(EARLIER));

        expect(outcome).toBe('IGNORED_NOT_LATER');
        expect(heldTimes()).toEqual(before);
    });
});
