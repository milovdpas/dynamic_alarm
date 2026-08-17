import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let throwOnRead = false;

vi.mock('@/utils/modules/Storage', () => ({
    default: {
        getItem: (key: string) =>
            throwOnRead
                ? Promise.reject(new Error('storage is unavailable'))
                : Promise.resolve(store.get(key) ?? null),
        setItem: (key: string, value: string) => {
            store.set(key, value);
            return Promise.resolve();
        },
        removeItem: (key: string) => {
            store.delete(key);
            return Promise.resolve();
        },
    },
    isPersistent: () => true,
}));

const { readChosenSound, resolveAlarmSoundUri, writeChosenSound } = await import(
    '@/alarm/alarmSound'
);

const OXYGEN = { uri: 'content://media/internal/audio/media/42', label: 'Oxygen' };

beforeEach(() => {
    store.clear();
    throwOnRead = false;
});

describe('remembering which tone the alarm plays', () => {
    it('gives back what was chosen', async () => {
        await writeChosenSound(OXYGEN);

        expect(await readChosenSound()).toEqual(OXYGEN);
    });

    it('forgets it again when the phone default is chosen', async () => {
        await writeChosenSound(OXYGEN);
        await writeChosenSound(null);

        expect(await readChosenSound()).toBeNull();
        // Null, not an empty string. The native service treats "nothing" as
        // "use the system default", which is what the user just asked for.
        expect(await resolveAlarmSoundUri()).toBeNull();
    });

    it('refuses a half-written choice rather than arming something odd', async () => {
        // A URI with no label renders as an empty settings row; a label with no
        // URI arms an alarm that plays nothing. Neither is worth keeping.
        store.set('alarmSound', JSON.stringify({ uri: OXYGEN.uri }));
        expect(await readChosenSound()).toBeNull();

        store.set('alarmSound', JSON.stringify({ label: 'Oxygen' }));
        expect(await readChosenSound()).toBeNull();
    });

    it('survives a corrupted entry', async () => {
        store.set('alarmSound', 'not json at all');

        expect(await readChosenSound()).toBeNull();
    });
});

describe('what the alarm is armed with', () => {
    it('is the chosen tone when there is one', async () => {
        await writeChosenSound(OXYGEN);

        expect(await resolveAlarmSoundUri()).toBe(OXYGEN.uri);
    });

    it('falls back to the default rather than failing to arm', async () => {
        throwOnRead = true;

        // The worst possible trade would be an alarm that does not exist because
        // a *preference* could not be read. A broken store means the phone's
        // default tone, and the alarm still rings.
        expect(await resolveAlarmSoundUri()).toBeNull();
    });
});
