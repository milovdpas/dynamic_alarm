import Storage from '@/utils/modules/Storage';

const STORAGE_KEY = 'alarmLock';

export type LockKind = 'NONE' | 'MATHS' | 'CODE';
export type MathsDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface LockSetting {
    kind: LockKind;
    /** Only meaningful for `MATHS`, kept so switching back remembers the level. */
    difficulty: MathsDifficulty;
}

export const DEFAULT_LOCK: LockSetting = { kind: 'NONE', difficulty: 'EASY' };

/** What the ring screen shows and what it will accept. */
export interface Challenge {
    kind: Exclude<LockKind, 'NONE'>;
    /** The sum, or the code to copy. Shown as-is. */
    prompt: string;
    /** Compared against what is typed, after `normalise`. */
    answer: string;
}

/**
 * Something to get right before the alarm can be dismissed.
 *
 * **Guards dismissing, not silencing.** The tone comes from the native
 * foreground service and keeps playing throughout: this is UI, and if it failed
 * to render the alarm would still be sounding. That is deliberate, and it is
 * also why the notification's own Dismiss action is left unlocked. It runs in
 * Kotlin with no JavaScript involved and is the exit that always exists, which
 * is what makes it safe to have no escape hatch on the screen itself.
 *
 * So this is a speed bump against your own half-asleep reflex rather than a
 * security boundary, and the settings copy says exactly that. An app that
 * implied otherwise would be lying about something somebody is trusting to get
 * them to work.
 *
 * A wrong answer costs nothing but time. No lockouts, no penalties, no puzzle
 * that escalates: the alarm is already ringing, which is the entire pressure.
 */
export function generateChallenge(
    setting: LockSetting,
    random: () => number = Math.random,
): Challenge | null {
    if (setting.kind === 'NONE') {
        return null;
    }
    return setting.kind === 'MATHS' ? mathsChallenge(setting.difficulty, random) : codeChallenge(random);
}

/**
 * Arithmetic, because it is the one thing that cannot be done while asleep.
 *
 * Three levels rather than one: "24 + 17" and "13 x 7 - 9" are different
 * products. Someone who wants a moment's pause and someone who dismisses alarms
 * without remembering it need different sums.
 */
function mathsChallenge(difficulty: MathsDifficulty, random: () => number): Challenge {
    const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

    if (difficulty === 'EASY') {
        const a = between(10, 99);
        const b = between(10, 99);
        return { kind: 'MATHS', prompt: `${String(a)} + ${String(b)}`, answer: String(a + b) };
    }

    if (difficulty === 'MEDIUM') {
        const a = between(3, 9);
        const b = between(11, 19);
        return { kind: 'MATHS', prompt: `${String(a)} × ${String(b)}`, answer: String(a * b) };
    }

    const a = between(3, 12);
    const b = between(11, 29);
    const c = between(10, 99);
    return {
        kind: 'MATHS',
        // Multiplication first, which is the order everyone reads it in anyway,
        // so the puzzle is arithmetic rather than a test of operator precedence.
        prompt: `${String(a)} × ${String(b)} − ${String(c)}`,
        answer: String(a * b - c),
    };
}

/** Characters that cannot be confused with each other on a screen at 06:00. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/**
 * Copy six characters accurately.
 *
 * The fairest of the two: no memory, no arithmetic, and nothing to translate. It
 * asks for focus rather than for a skill, which matters because plenty of people
 * find mental arithmetic hard at the best of times, let alone before dawn.
 *
 * `O`, `0`, `I` and `1` are left out of the alphabet. A code that cannot be read
 * is a puzzle about eyesight.
 */
function codeChallenge(random: () => number): Challenge {
    let code = '';
    for (let index = 0; index < CODE_LENGTH; index += 1) {
        code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)] ?? 'A';
    }
    return { kind: 'CODE', prompt: code, answer: code };
}

/**
 * Whether this attempt is right.
 *
 * Case and surrounding space are ignored. Somebody typing a code with the
 * keyboard's autocapitalisation fighting them, at the exact moment they are
 * least able to notice, has answered correctly.
 */
export function isCorrect(challenge: Challenge, attempt: string): boolean {
    return normalise(attempt) === normalise(challenge.answer);
}

function normalise(value: string): string {
    return value.trim().toUpperCase();
}

export async function readLockSetting(): Promise<LockSetting> {
    const raw = await Storage.getItem(STORAGE_KEY);
    if (raw === null) {
        return DEFAULT_LOCK;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<LockSetting>;
        return {
            kind: isKind(parsed.kind) ? parsed.kind : 'NONE',
            difficulty: isDifficulty(parsed.difficulty) ? parsed.difficulty : 'EASY',
        };
    } catch {
        // Unreadable means unlocked. The alternative is an alarm somebody cannot
        // dismiss because a *preference* was corrupted, which is far worse than
        // a lock quietly not applying.
        return DEFAULT_LOCK;
    }
}

export async function writeLockSetting(setting: LockSetting): Promise<void> {
    await Storage.setItem(STORAGE_KEY, JSON.stringify(setting));
}

function isKind(value: unknown): value is LockKind {
    return value === 'NONE' || value === 'MATHS' || value === 'CODE';
}

function isDifficulty(value: unknown): value is MathsDifficulty {
    return value === 'EASY' || value === 'MEDIUM' || value === 'HARD';
}
