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

const { EMPTY_MARKS, nextPrompt, readPromptMarks, resetPromptMarks, writePromptMarks } =
    await import('./prompts');

const DAY = 24 * 60 * 60 * 1000;
const REGISTERED = new Date('2026-08-01T10:00:00.000Z');

function daysLater(days: number): Date {
    return new Date(REGISTERED.getTime() + days * DAY);
}

beforeEach(() => {
    store.clear();
});

describe('when the app asks for a coffee', () => {
    it('asks nothing in the first month', () => {
        // A phone that has not had the app long enough to have an opinion.
        expect(
            nextPrompt({ registeredAt: REGISTERED.toISOString(), now: daysLater(29), marks: EMPTY_MARKS }),
        ).toBeNull();
    });

    it('asks after a month', () => {
        expect(
            nextPrompt({ registeredAt: REGISTERED.toISOString(), now: daysLater(30), marks: EMPTY_MARKS }),
        ).toBe('DONATE');
    });

    it('waits a month between asks', () => {
        const marks = { ...EMPTY_MARKS, lastDonatePromptAt: daysLater(30).toISOString() };

        expect(nextPrompt({ registeredAt: REGISTERED.toISOString(), now: daysLater(45), marks })).toBeNull();
        expect(nextPrompt({ registeredAt: REGISTERED.toISOString(), now: daysLater(60), marks })).toBe(
            'DONATE',
        );
    });

    it('never asks again once somebody says they already did', () => {
        // Taken on trust. The people most likely to be annoyed by a monthly ask
        // are exactly the people who paid.
        const marks = { ...EMPTY_MARKS, donatedAt: daysLater(31).toISOString() };

        expect(nextPrompt({ registeredAt: REGISTERED.toISOString(), now: daysLater(400), marks })).toBeNull();
    });

    it('asks nothing when it does not know when the device registered', () => {
        expect(nextPrompt({ registeredAt: null, now: daysLater(100), marks: EMPTY_MARKS })).toBeNull();
        expect(nextPrompt({ registeredAt: 'rubbish', now: daysLater(100), marks: EMPTY_MARKS })).toBeNull();
    });
});

describe('when the app asks for a rating', () => {
    it('is switched off until there is a store listing', () => {
        // The constant is false today; a prompt that opens nothing is worse
        // than none. The plumbing is exercised with it forced on below.
        expect(
            nextPrompt({ registeredAt: REGISTERED.toISOString(), now: daysLater(20), marks: EMPTY_MARKS }),
        ).toBeNull();
    });

    it('asks after a fortnight, once, when enabled', () => {
        const ask = (now: Date, marks = EMPTY_MARKS) =>
            nextPrompt({ registeredAt: REGISTERED.toISOString(), now, marks, rateEnabled: true });

        expect(ask(daysLater(13))).toBeNull();
        expect(ask(daysLater(14))).toBe('RATE');
        expect(ask(daysLater(100), { ...EMPTY_MARKS, lastRatePromptAt: daysLater(14).toISOString() })).toBe(
            'DONATE',
        );
    });

    it('comes before the coffee when both are due', () => {
        // It is the earlier ask and the one asked only once.
        expect(
            nextPrompt({
                registeredAt: REGISTERED.toISOString(),
                now: daysLater(40),
                marks: EMPTY_MARKS,
                rateEnabled: true,
            }),
        ).toBe('RATE');
    });
});

describe('what the phone remembers about having asked', () => {
    it('starts with nothing', async () => {
        expect(await readPromptMarks()).toEqual(EMPTY_MARKS);
    });

    it('merges a change into the rest', async () => {
        await writePromptMarks({ lastDonatePromptAt: '2026-09-01T00:00:00.000Z' });
        await writePromptMarks({ donatedAt: '2026-09-02T00:00:00.000Z' });

        const marks = await readPromptMarks();
        expect(marks.lastDonatePromptAt).toBe('2026-09-01T00:00:00.000Z');
        expect(marks.donatedAt).toBe('2026-09-02T00:00:00.000Z');
    });

    it('reads nothing rather than throwing on rubbish', async () => {
        store.set('promptMarks', 'not json');

        expect(await readPromptMarks()).toEqual(EMPTY_MARKS);
    });

    it('can be forgotten, for the debug panel', async () => {
        await writePromptMarks({ donatedAt: '2026-09-02T00:00:00.000Z' });

        await resetPromptMarks();

        expect(await readPromptMarks()).toEqual(EMPTY_MARKS);
    });
});
