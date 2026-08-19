import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Weekday } from '@alarm/types';

const store = new Map<string, string>();

vi.mock('@/utils/modules/Storage', () => ({
    default: {
        getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
        setItem: (key: string, value: string) => {
            store.set(key, value);
            return Promise.resolve();
        },
        removeItem: (key: string) => {
            store.delete(key);
            return Promise.resolve();
        },
    },
}));

// The alarm layer reaches native code, which does not exist under vitest. Only
// the pure half of this module is exercised here; scheduling is verified on a
// device, because "the OS is holding it" is not a claim a mock can make.
vi.mock('@/alarm', () => ({
    canGuaranteeAlarm: () => false,
    getAlarmScheduler: () => {
        throw new Error('No scheduler in tests.');
    },
}));
vi.mock('@/alarm/alarmSound', () => ({ resolveAlarmSoundUri: () => Promise.resolve(null) }));
vi.mock('@/i18n/i18n', () => ({ default: { t: (key: string) => key } }));

const {
    deleteStandaloneAlarm,
    listStandaloneAlarms,
    plannedRings,
    ringTimes,
    saveStandaloneAlarm,
    standaloneIdFrom,
} = await import('@/alarm/standaloneAlarms');

type Alarm = Awaited<ReturnType<typeof listStandaloneAlarms>>[number];

function alarm(overrides: Partial<Alarm> = {}): Alarm {
    return {
        id: 'a1',
        label: '',
        time: '07:45',
        days: [],
        enabled: true,
        soundUri: null,
        reminders: { count: 1, intervalMinutes: 5 },
        ...overrides,
    };
}

/** A Wednesday, so the weekday arithmetic is checkable by hand. */
const WEDNESDAY_NOON = DateTime.fromISO('2026-08-19T12:00:00', { zone: 'Europe/Amsterdam' });

beforeEach(() => {
    store.clear();
});

describe('when a standalone alarm rings', () => {
    it('takes the next occurrence of the time when no days are set', () => {
        // What an alarm app means by "07:45" with nothing else said: today if it
        // is still to come, otherwise tomorrow.
        const times = ringTimes(alarm({ time: '18:00' }), WEDNESDAY_NOON);

        expect(times).toHaveLength(1);
        expect(times[0]).toContain('2026-08-19T18:00');
    });

    it('rolls to tomorrow when the time has already passed today', () => {
        const times = ringTimes(alarm({ time: '07:45' }), WEDNESDAY_NOON);

        expect(times).toHaveLength(1);
        expect(times[0]).toContain('2026-08-20T07:45');
    });

    it('never schedules a one-off more than once', () => {
        // Scheduled once, not every day for a week, which would be a recurring
        // alarm nobody asked for.
        expect(ringTimes(alarm({ days: [] }), WEDNESDAY_NOON)).toHaveLength(1);
    });

    it('covers a week ahead for a recurring alarm', () => {
        /*
         * The reason this is scheduled ahead at all: the native layer holds
         * one-shot alarms, so something has to arm the next one, and the only
         * thing that runs is the app being opened. A week means a phone nobody
         * unlocks still rings.
         */
        const daily = alarm({
            time: '07:45',
            days: [
                Weekday.MONDAY,
                Weekday.TUESDAY,
                Weekday.WEDNESDAY,
                Weekday.THURSDAY,
                Weekday.FRIDAY,
                Weekday.SATURDAY,
                Weekday.SUNDAY,
            ],
        });

        expect(ringTimes(daily, WEDNESDAY_NOON)).toHaveLength(7);
    });

    it('rings only on the days that were chosen', () => {
        const times = ringTimes(
            alarm({ time: '07:45', days: [Weekday.MONDAY, Weekday.FRIDAY] }),
            WEDNESDAY_NOON,
        );

        // Friday the 21st and Monday the 24th, inside the seven day window.
        expect(times).toHaveLength(2);
        expect(times[0]).toContain('2026-08-21');
        expect(times[1]).toContain('2026-08-24');
    });

    it('never schedules a moment that has already gone', () => {
        // The Android scheduler refuses a time in the past outright, so a list
        // containing one loses every alarm after it in the same pass.
        const times = ringTimes(alarm({ time: '00:00', days: [Weekday.WEDNESDAY] }), WEDNESDAY_NOON);

        expect(times.every((at) => DateTime.fromISO(at) > WEDNESDAY_NOON)).toBe(true);
    });

    it('rings nothing at all for a time it cannot read', () => {
        expect(ringTimes(alarm({ time: '25:99' }), WEDNESDAY_NOON)).toEqual([]);
        expect(ringTimes(alarm({ time: 'half seven' }), WEDNESDAY_NOON)).toEqual([]);
    });
});

describe('keeping standalone alarms', () => {
    it('round-trips one', async () => {
        await saveStandaloneAlarm(alarm({ label: 'Gym' }));

        const [stored] = await listStandaloneAlarms();
        expect(stored?.label).toBe('Gym');
    });

    it('replaces rather than duplicating when the same alarm is saved again', async () => {
        await saveStandaloneAlarm(alarm({ time: '07:45' }));
        await saveStandaloneAlarm(alarm({ time: '08:15' }));

        const stored = await listStandaloneAlarms();
        expect(stored).toHaveLength(1);
        expect(stored[0]?.time).toBe('08:15');
    });

    it('keeps the list in time order', async () => {
        await saveStandaloneAlarm(alarm({ id: 'late', time: '09:00' }));
        await saveStandaloneAlarm(alarm({ id: 'early', time: '06:30' }));

        expect((await listStandaloneAlarms()).map((each) => each.id)).toEqual(['early', 'late']);
    });

    it('deletes one without disturbing the others', async () => {
        await saveStandaloneAlarm(alarm({ id: 'keep' }));
        await saveStandaloneAlarm(alarm({ id: 'drop', time: '08:00' }));

        await deleteStandaloneAlarm('drop');

        expect((await listStandaloneAlarms()).map((each) => each.id)).toEqual(['keep']);
    });

    it('loses one malformed row rather than the whole list', async () => {
        // These survive app updates, so the stored shape is older than the code
        // reading it. Somebody's alarms are not an acceptable thing to drop
        // because one entry is wrong.
        store.set(
            'standaloneAlarms',
            JSON.stringify([{ nonsense: true }, alarm({ id: 'good', label: 'Gym' })]),
        );

        const stored = await listStandaloneAlarms();
        expect(stored).toHaveLength(1);
        expect(stored[0]?.id).toBe('good');
    });

    it('fills in fields a row written by an older version predates', async () => {
        // Reaching the OS as `undefined` is what this prevents: the notification
        // body is a required argument, and a missing label would throw on the
        // way to the native module rather than on the way in.
        store.set(
            'standaloneAlarms',
            JSON.stringify([{ id: 'old', time: '07:00', days: [], enabled: true }]),
        );

        const [stored] = await listStandaloneAlarms();
        expect(stored?.label).toBe('');
        expect(stored?.soundUri).toBeNull();
    });

    it('reads an empty list rather than throwing on rubbish', async () => {
        store.set('standaloneAlarms', 'not json at all');

        expect(await listStandaloneAlarms()).toEqual([]);
    });
});

describe('telling our own OS alarms apart', () => {
    it('recognises a standalone id and recovers which alarm it is', () => {
        expect(standaloneIdFrom('standalone-a1@2026-08-20T07:45:00+02:00')).toBe('a1');
    });

    it('does not claim an occurrence alarm', () => {
        // Sharing the prefix would have `cancelOrphans` cancel every standalone
        // alarm the moment Today refreshed, since none of them are in the
        // server's list.
        expect(standaloneIdFrom('occurrence-abc')).toBeNull();
    });
});

describe('which OS alarms a standalone alarm wants', () => {
    it('is one per ring of the chain', () => {
        const wanted = plannedRings(
            [alarm({ time: '18:00', reminders: { count: 3, intervalMinutes: 5 } })],
            WEDNESDAY_NOON,
        );

        expect(wanted.size).toBe(3);
    });

    it('gives every ring an id of its own moment', () => {
        /*
         * The bug this guards. Keying the id on the day's wake time left every
         * id identical when the interval changed, so the reconciliation saw each
         * ring as already held and the OS kept the old times for ever. Somebody
         * changing five minutes to ten would have seen nothing happen, and only
         * found out the next morning.
         */
        const five = plannedRings(
            [alarm({ time: '18:00', reminders: { count: 3, intervalMinutes: 5 } })],
            WEDNESDAY_NOON,
        );
        const ten = plannedRings(
            [alarm({ time: '18:00', reminders: { count: 3, intervalMinutes: 10 } })],
            WEDNESDAY_NOON,
        );

        // The final ring is the alarm itself and does not move; the two before
        // it do, so their ids must differ.
        const moved = [...ten.keys()].filter((id) => !five.has(id));
        expect(moved).toHaveLength(2);
    });

    it('wants nothing from an alarm that is switched off', () => {
        expect(plannedRings([alarm({ enabled: false })], WEDNESDAY_NOON).size).toBe(0);
    });

    it('rings each one at its own moment, not at the alarm time', () => {
        const wanted = plannedRings(
            [alarm({ time: '18:00', reminders: { count: 2, intervalMinutes: 5 } })],
            WEDNESDAY_NOON,
        );

        // Compared as instants. `reminderTimes` normalises to UTC, which is
        // the same moment written differently, and the scheduler parses it the
        // same way either side of the offset.
        const moments = [...wanted.values()]
            .map((each) => DateTime.fromISO(each.at).setZone('Europe/Amsterdam').toFormat('HH:mm'))
            .sort();
        expect(moments).toEqual(['17:55', '18:00']);
    });
});
