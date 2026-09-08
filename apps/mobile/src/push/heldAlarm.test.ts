import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { forgetHeldAlarm, readHeldAlarm, readHeldAlarms, rememberHeldAlarm } =
    await import('./heldAlarm');

beforeEach(() => {
    store.clear();
});

describe('what the phone believes it holds', () => {
    it('keeps one baseline per morning', async () => {
        /*
         * The bug this guards. A single record was overwritten by whichever
         * morning was armed last, so once mornings came in weeks a push about
         * Thursday was judged against Friday's wake time.
         */
        await rememberHeldAlarm({ occurrenceId: 'thu', wakeAt: '2026-09-10T05:31:00.000Z' });
        await rememberHeldAlarm({ occurrenceId: 'fri', wakeAt: '2026-09-11T05:31:00.000Z' });

        expect((await readHeldAlarm('thu'))?.wakeAt).toBe('2026-09-10T05:31:00.000Z');
        expect((await readHeldAlarm('fri'))?.wakeAt).toBe('2026-09-11T05:31:00.000Z');
    });

    it('answers the soonest when no morning is named', async () => {
        await rememberHeldAlarm({ occurrenceId: 'fri', wakeAt: '2026-09-11T05:31:00.000Z' });
        await rememberHeldAlarm({ occurrenceId: 'thu', wakeAt: '2026-09-10T05:31:00.000Z' });

        expect((await readHeldAlarm())?.occurrenceId).toBe('thu');
    });

    it('answers null for a morning it knows nothing about', async () => {
        // Null is "cannot judge", not "no alarm": a push about it must not be
        // applied blindly.
        await rememberHeldAlarm({ occurrenceId: 'thu', wakeAt: '2026-09-10T05:31:00.000Z' });

        expect(await readHeldAlarm('sat')).toBeNull();
    });

    it('overwrites a morning when it is armed again', async () => {
        await rememberHeldAlarm({ occurrenceId: 'thu', wakeAt: '2026-09-10T05:31:00.000Z' });
        await rememberHeldAlarm({ occurrenceId: 'thu', wakeAt: '2026-09-10T05:43:00.000Z' });

        expect(await readHeldAlarms()).toHaveLength(1);
        expect((await readHeldAlarm('thu'))?.wakeAt).toBe('2026-09-10T05:43:00.000Z');
    });

    it('forgets a morning the OS no longer holds', async () => {
        await rememberHeldAlarm({ occurrenceId: 'thu', wakeAt: '2026-09-10T05:31:00.000Z' });

        await forgetHeldAlarm('thu');

        expect(await readHeldAlarm('thu')).toBeNull();
    });

    it('forgets a morning that has passed when the next one is written', async () => {
        // The OS drops a fired alarm, so the orphan sweep never sees it to
        // forget here. Left alone the record grew by one morning a day for ever.
        await rememberHeldAlarm(
            { occurrenceId: 'yesterday', wakeAt: '2026-09-07T05:31:00.000Z' },
            new Date('2026-09-07T00:00:00.000Z'),
        );

        await rememberHeldAlarm(
            { occurrenceId: 'tomorrow', wakeAt: '2026-09-09T05:31:00.000Z' },
            new Date('2026-09-08T12:00:00.000Z'),
        );

        expect((await readHeldAlarms()).map((held) => held.occurrenceId)).toEqual(['tomorrow']);
    });

    it('orders by instant, not by text', async () => {
        // The same moment written with an offset sorts after one written in UTC
        // as text, and before it as a time.
        await rememberHeldAlarm({ occurrenceId: 'later', wakeAt: '2026-09-11T05:31:00.000Z' });
        await rememberHeldAlarm({ occurrenceId: 'sooner', wakeAt: '2026-09-10T07:31:00.000+02:00' });

        expect((await readHeldAlarm())?.occurrenceId).toBe('sooner');
    });

    it('reads the single record an older version wrote', async () => {
        // A phone updating tonight has a morning armed under the old shape.
        // Losing its baseline would make the next push unjudgeable.
        store.set('heldAlarm', JSON.stringify({ occurrenceId: 'old', wakeAt: '2026-09-10T05:31:00.000Z' }));

        expect((await readHeldAlarm('old'))?.wakeAt).toBe('2026-09-10T05:31:00.000Z');
    });

    it('reads nothing rather than throwing on rubbish', async () => {
        store.set('heldAlarms', 'not json');

        expect(await readHeldAlarms()).toEqual([]);
    });

    it('keeps the reminder chain beside the time', async () => {
        // A push that moves the wake time has to move every ring, and it
        // carries no reminder setting of its own. This is where it finds one.
        await rememberHeldAlarm({
            occurrenceId: 'thu',
            wakeAt: '2026-09-10T05:31:00.000Z',
            reminders: { count: 3, intervalMinutes: 5 },
        });

        expect((await readHeldAlarm('thu'))?.reminders).toEqual({ count: 3, intervalMinutes: 5 });
    });

    it('keeps every morning when several are remembered at once', async () => {
        /*
         * Found on a phone on 2026-09-08. The week is armed in parallel, each
         * morning read the record, added itself and wrote it back, and only the
         * last write survived. "This device holds" named Tuesday alone, and a
         * push about Thursday was ignored as unknown.
         */
        await Promise.all([
            rememberHeldAlarm({ occurrenceId: 'thu', wakeAt: '2026-09-10T05:44:00.000Z' }),
            rememberHeldAlarm({ occurrenceId: 'fri', wakeAt: '2026-09-11T05:43:00.000Z' }),
            rememberHeldAlarm({ occurrenceId: 'tue', wakeAt: '2026-09-15T05:44:00.000Z' }),
        ]);

        expect((await readHeldAlarms()).map((held) => held.occurrenceId)).toEqual(['thu', 'fri', 'tue']);
    });

    it('does not lose a morning remembered while another is forgotten', async () => {
        await rememberHeldAlarm({ occurrenceId: 'old', wakeAt: '2026-09-10T05:44:00.000Z' });

        await Promise.all([
            forgetHeldAlarm('old'),
            rememberHeldAlarm({ occurrenceId: 'fri', wakeAt: '2026-09-11T05:43:00.000Z' }),
        ]);

        expect((await readHeldAlarms()).map((held) => held.occurrenceId)).toEqual(['fri']);
    });

    it('reads a record written as a bare time, from before reminders were kept', async () => {
        store.set('heldAlarms', JSON.stringify({ thu: '2026-09-10T05:31:00.000Z' }));

        const held = await readHeldAlarm('thu');

        expect(held?.wakeAt).toBe('2026-09-10T05:31:00.000Z');
        expect(held?.reminders).toBeUndefined();
    });
});
