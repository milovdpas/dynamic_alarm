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
    isPersistent: () => true,
}));

const { DEFAULT_LOCK, generateChallenge, isCorrect, readLockSetting, writeLockSetting } =
    await import('@/alarm/alarmLock');

beforeEach(() => {
    store.clear();
});

/** Deterministic "random", so a puzzle can be asserted rather than described. */
const fixed = (value: number) => () => value;

describe('the puzzle that has to be solved', () => {
    it('is nothing at all when the lock is off', () => {
        expect(generateChallenge({ kind: 'NONE', difficulty: 'EASY' })).toBeNull();
    });

    it('adds two whole numbers on easy', () => {
        const challenge = generateChallenge({ kind: 'MATHS', difficulty: 'EASY' }, fixed(0));

        expect(challenge?.prompt).toBe('10 + 10');
        expect(challenge?.answer).toBe('20');
    });

    it('multiplies on medium and subtracts as well on hard', () => {
        expect(generateChallenge({ kind: 'MATHS', difficulty: 'MEDIUM' }, fixed(0))?.prompt).toBe(
            '3 × 11',
        );
        expect(generateChallenge({ kind: 'MATHS', difficulty: 'HARD' }, fixed(0))?.answer).toBe(
            '23',
        );
    });

    it('never produces a sum whose own answer is wrong', () => {
        // Every level, every roll: the answer is what the prompt evaluates to.
        // A puzzle that cannot be solved correctly is an alarm nobody can stop.
        for (const difficulty of ['EASY', 'MEDIUM', 'HARD'] as const) {
            for (let attempt = 0; attempt < 200; attempt += 1) {
                const challenge = generateChallenge({ kind: 'MATHS', difficulty });
                const [, a = '0', operator = '+', b = '0', c = '0'] =
                    challenge?.prompt.match(/^(\d+) (.) (\d+)(?: − (\d+))?$/) ?? [];
                const left =
                    operator === '+' ? Number(a) + Number(b) : Number(a) * Number(b) - Number(c);

                expect(challenge?.answer).toBe(String(left));
            }
        }
    });

    it('gives a code of six unambiguous characters', () => {
        const challenge = generateChallenge({ kind: 'CODE', difficulty: 'EASY' });

        expect(challenge?.prompt).toHaveLength(6);
        // O and 0, I and 1 are left out on purpose. A code that cannot be read
        // is a puzzle about eyesight rather than about being awake.
        expect(challenge?.prompt).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
        expect(challenge?.answer).toBe(challenge?.prompt);
    });
});

describe('accepting an answer', () => {
    const code = { kind: 'CODE', prompt: 'ABC234', answer: 'ABC234' } as const;

    it('takes the right one', () => {
        expect(isCorrect(code, 'ABC234')).toBe(true);
    });

    it('forgives case and stray spaces', () => {
        // Somebody fighting autocapitalisation at 06:00 has answered correctly.
        expect(isCorrect(code, ' abc234 ')).toBe(true);
    });

    it('refuses anything else', () => {
        expect(isCorrect(code, 'ABC235')).toBe(false);
        expect(isCorrect(code, '')).toBe(false);
    });

    it('accepts a sum answered as typed', () => {
        const sum = { kind: 'MATHS', prompt: '24 + 17', answer: '41' } as const;

        expect(isCorrect(sum, '41')).toBe(true);
        expect(isCorrect(sum, '42')).toBe(false);
    });
});

describe('remembering the setting', () => {
    it('is off until somebody turns it on', async () => {
        expect(await readLockSetting()).toEqual(DEFAULT_LOCK);
    });

    it('keeps the difficulty when the kind changes, so switching back remembers it', async () => {
        await writeLockSetting({ kind: 'MATHS', difficulty: 'HARD' });
        await writeLockSetting({ kind: 'CODE', difficulty: 'HARD' });

        expect(await readLockSetting()).toEqual({ kind: 'CODE', difficulty: 'HARD' });
    });

    it('falls back to unlocked when the stored value is nonsense', async () => {
        store.set('alarmLock', '{"kind":"RETINA_SCAN"}');

        // Unreadable means unlocked. The alternative is an alarm somebody cannot
        // dismiss because a preference was corrupted.
        expect(await readLockSetting()).toEqual(DEFAULT_LOCK);
    });

    it('falls back to unlocked when the store is corrupted', async () => {
        store.set('alarmLock', 'not json');

        expect(await readLockSetting()).toEqual(DEFAULT_LOCK);
    });
});
