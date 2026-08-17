import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The store, replaced with a map.
 *
 * `Storage` wraps AsyncStorage, a native module that does not exist in node.
 * Mocked at the module boundary rather than by injecting a store into
 * `ApiCache`, so the code under test is the code that ships.
 */
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
    isPersistent: () => true,
}));

const { clearCache, getFreshness, peekCache, readCache, writeCache } = await import(
    '@/utils/modules/ApiCache'
);

beforeEach(async () => {
    store.clear();
    await clearCache();
});

describe('what the cache gives back', () => {
    it('returns what was written, for the key it was written under', async () => {
        await writeCache('/occurrences', [{ id: 'a' }]);

        expect((await peekCache<{ id: string }[]>('/occurrences'))?.body).toEqual([{ id: 'a' }]);
        expect(await peekCache('/schedules')).toBeNull();
    });

    it('overwrites rather than accumulating, so a deleted item cannot come back', async () => {
        await writeCache('/schedules', [{ id: 'a' }, { id: 'b' }]);
        await writeCache('/schedules', [{ id: 'a' }]);

        expect((await peekCache<{ id: string }[]>('/schedules'))?.body).toEqual([{ id: 'a' }]);
    });

    it('survives a corrupted entry instead of throwing into a screen', async () => {
        store.set('apiCache:/occurrences', 'not json');

        expect(await peekCache('/occurrences')).toBeNull();
    });
});

describe('what the app says it is showing', () => {
    it('peeking does not make the app claim to be offline', async () => {
        await writeCache('/occurrences', [{ id: 'a' }]);
        await peekCache('/occurrences');

        // The head start is not a failure. Marking it stale would put "no
        // connection" on screen every time somebody opened the app.
        expect(getFreshness().servingFromCache).toBe(false);
    });

    it('falling back to the cache does, and dates it', async () => {
        await writeCache('/occurrences', [{ id: 'a' }]);
        const entry = await readCache('/occurrences');

        expect(getFreshness()).toEqual({ servingFromCache: true, since: entry?.at });
    });

    it('reports the oldest copy in play, since a screen is only as current as its worst part', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-17T06:00:00.000Z'));
        await writeCache('/schedules', []);

        vi.setSystemTime(new Date('2026-08-17T09:00:00.000Z'));
        await writeCache('/occurrences', []);
        vi.useRealTimers();

        await readCache('/occurrences');
        await readCache('/schedules');

        expect(getFreshness().since).toBe('2026-08-17T06:00:00.000Z');
    });

    it('goes back to live as soon as a real answer is written', async () => {
        await writeCache('/occurrences', []);
        await readCache('/occurrences');
        expect(getFreshness().servingFromCache).toBe(true);

        await writeCache('/occurrences', []);

        expect(getFreshness()).toEqual({ servingFromCache: false, since: null });
    });
});

describe('what a rejected device token costs', () => {
    it('empties everything, because it all belonged to that device', async () => {
        await writeCache('/occurrences', [{ id: 'a' }]);
        await writeCache('/schedules', [{ id: 'b' }]);

        await clearCache();

        expect(await peekCache('/occurrences')).toBeNull();
        expect(await peekCache('/schedules')).toBeNull();
        // The index too, or the next write would try to evict keys that are gone.
        expect(store.size).toBe(0);
    });
});

describe('the bound on how much is kept', () => {
    it('drops the least recently written once past the cap', async () => {
        for (let index = 0; index < 32; index += 1) {
            await writeCache(`/key-${String(index)}`, index);
        }

        expect(await peekCache('/key-0')).toBeNull();
        expect(await peekCache('/key-1')).toBeNull();
        expect((await peekCache<number>('/key-31'))?.body).toBe(31);
    });

    it('counts a rewritten key as recent rather than as a second entry', async () => {
        await writeCache('/keep-me', 'first');
        for (let index = 0; index < 29; index += 1) {
            await writeCache(`/filler-${String(index)}`, index);
        }
        // Would be the oldest and dropped next, but this touch moves it back to
        // the front of the queue.
        await writeCache('/keep-me', 'second');
        await writeCache('/one-more', true);

        expect((await peekCache<string>('/keep-me'))?.body).toBe('second');
    });
});
