import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LockKind, LockSetting, MathsDifficulty } from '@/alarm/alarmLock';

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

const {
    DEFAULT_LOCK,
    generateChallenge,
    isCorrect,
    locksThisRing,
    readLockSetting,
    writeLockSetting,
} = await import('@/alarm/alarmLock');

beforeEach(() => {
    store.clear();
});

/** Deterministic "random", so a puzzle can be asserted rather than described. */
const fixed = (value: number) => () => value;

/** A setting with today's fields filled in, so a new one is one edit here. */
function lock(kind: LockKind, difficulty: MathsDifficulty): LockSetting {
    return { kind, difficulty, appliesTo: 'ALL' };
}

describe('the puzzle that has to be solved', () => {
    it('is nothing at all when the lock is off', () => {
        expect(generateChallenge(lock('NONE', 'EASY'))).toBeNull();
    });

    it('adds two whole numbers on easy', () => {
        const challenge = generateChallenge(lock('MATHS', 'EASY'), fixed(0));

        expect(challenge?.prompt).toBe('10 + 10');
        expect(challenge?.answer).toBe('20');
    });

    it('multiplies on medium and subtracts as well on hard', () => {
        expect(generateChallenge(lock('MATHS', 'MEDIUM'), fixed(0))?.prompt).toBe(
            '3 × 11',
        );
        expect(generateChallenge(lock('MATHS', 'HARD'), fixed(0))?.answer).toBe(
            '23',
        );
    });

    it('never produces a sum whose own answer is wrong', () => {
        // Every level, every roll: the answer is what the prompt evaluates to.
        // A puzzle that cannot be solved correctly is an alarm nobody can stop.
        for (const difficulty of ['EASY', 'MEDIUM', 'HARD'] as const) {
            for (let attempt = 0; attempt < 200; attempt += 1) {
                const challenge = generateChallenge(lock('MATHS', difficulty));
                const [, a = '0', operator = '+', b = '0', c = '0'] =
                    challenge?.prompt.match(/^(\d+) (.) (\d+)(?: − (\d+))?$/) ?? [];
                const left =
                    operator === '+' ? Number(a) + Number(b) : Number(a) * Number(b) - Number(c);

                expect(challenge?.answer).toBe(String(left));
            }
        }
    });

    it('gives a code of six unambiguous characters', () => {
        const challenge = generateChallenge(lock('CODE', 'EASY'));

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
        await writeLockSetting(lock('MATHS', 'HARD'));
        await writeLockSetting(lock('CODE', 'HARD'));

        expect(await readLockSetting()).toEqual(lock('CODE', 'HARD'));
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

describe('which rings have to be earned', () => {
    it('asks nothing at all when the lock is off', () => {
        expect(locksThisRing(lock('NONE', 'EASY'), 'occurrence-a#r1')).toBe(false);
    });

    it('locks every ring by default, reminders included', () => {
        /*
         * The default, and the honest one. Reminders exist to get somebody out
         * of bed, so a reminder that can be swiped away half asleep is the exact
         * reflex the lock was added for, three times over.
         */
        const setting = lock('MATHS', 'EASY');

        expect(locksThisRing(setting, 'occurrence-a')).toBe(true);
        expect(locksThisRing(setting, 'occurrence-a#r1')).toBe(true);
        expect(locksThisRing(setting, 'occurrence-a#r2')).toBe(true);
    });

    it('can be narrowed to the ring on the real wake time', () => {
        const setting: LockSetting = { ...lock('MATHS', 'EASY'), appliesTo: 'LAST' };

        expect(locksThisRing(setting, 'occurrence-a#r1')).toBe(false);
        expect(locksThisRing(setting, 'occurrence-a')).toBe(true);
    });

    it('treats an unrecognised alarm as the real one', () => {
        // The safe direction. Being asked a sum you did not expect costs a few
        // seconds; being let off one you wanted costs the morning.
        const setting: LockSetting = { ...lock('MATHS', 'EASY'), appliesTo: 'LAST' };

        expect(locksThisRing(setting, undefined)).toBe(true);
        expect(locksThisRing(setting, 'standalone-x@2026-08-20T07:00:00.000Z')).toBe(true);
    });

    it('reads a setting stored before reminders existed as locking everything', async () => {
        // Its single ring was locked, so nothing about that phone's behaviour
        // should change when it updates.
        store.set('alarmLock', JSON.stringify({ kind: 'MATHS', difficulty: 'EASY' }));

        const setting = await readLockSetting();

        expect(setting.appliesTo).toBe('ALL');
        expect(locksThisRing(setting, 'occurrence-a#r1')).toBe(true);
    });
});
