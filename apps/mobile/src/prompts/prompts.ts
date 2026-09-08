import { APP_CONSTANTS } from '@alarm/types';
import type { IsoDateTimeString } from '@alarm/types';

import Storage from '@/utils/modules/Storage';

/**
 * The two things this app ever asks for, and when.
 *
 * Both are late and both are quiet. A rating after a fortnight of the alarm
 * actually working, once. A coffee after a month, then monthly, and never again
 * once somebody says they already did. Nothing is asked of a phone that has not
 * had the app long enough to have an opinion.
 *
 * Measured from the device's registration on the server, not from a date kept
 * here, so clearing the app's storage does not restart the clock.
 */
export type PromptKind = 'RATE' | 'DONATE';

/**
 * What the phone remembers about having asked.
 *
 * `donatedAt` is self-reported: with a donation page and no callback there is
 * nothing else it could be. It is taken on trust, stops the donate prompt for
 * good, and is the field Stripe writes to when it arrives.
 */
export interface PromptMarks {
    ratedAt: IsoDateTimeString | null;
    donatedAt: IsoDateTimeString | null;
    lastRatePromptAt: IsoDateTimeString | null;
    lastDonatePromptAt: IsoDateTimeString | null;
}

export const EMPTY_MARKS: PromptMarks = {
    ratedAt: null,
    donatedAt: null,
    lastRatePromptAt: null,
    lastDonatePromptAt: null,
};

const KEY = 'promptMarks';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which prompt, if any, is due now.
 *
 * At most one, and the rating first: it comes earlier and is asked only once,
 * so a phone that has reached a month unrated is asked to rate before it is
 * asked to pay. Pure, so the schedule can be asserted without a clock in the
 * test.
 */
export function nextPrompt(input: {
    registeredAt: IsoDateTimeString | null;
    now: Date;
    marks: PromptMarks;
    rateEnabled?: boolean;
}): PromptKind | null {
    if (input.registeredAt === null) {
        return null;
    }
    const registered = Date.parse(input.registeredAt);
    if (Number.isNaN(registered)) {
        return null;
    }
    const daysSinceRegistration = (input.now.getTime() - registered) / DAY_MS;
    const { PROMPTS } = APP_CONSTANTS;

    const rateEnabled = input.rateEnabled ?? PROMPTS.RATE_ENABLED;
    if (
        rateEnabled &&
        daysSinceRegistration >= PROMPTS.RATE_AFTER_DAYS &&
        input.marks.ratedAt === null &&
        input.marks.lastRatePromptAt === null
    ) {
        return 'RATE';
    }

    if (daysSinceRegistration >= PROMPTS.DONATE_AFTER_DAYS && input.marks.donatedAt === null) {
        const last = input.marks.lastDonatePromptAt;
        const daysSinceAsked = last === null ? Infinity : (input.now.getTime() - Date.parse(last)) / DAY_MS;
        if (daysSinceAsked >= PROMPTS.DONATE_EVERY_DAYS) {
            return 'DONATE';
        }
    }

    return null;
}

export async function readPromptMarks(): Promise<PromptMarks> {
    const raw = await Storage.getItem(KEY);
    if (raw === null) {
        return EMPTY_MARKS;
    }
    try {
        const parsed = JSON.parse(raw) as Partial<Record<keyof PromptMarks, unknown>>;
        return {
            ratedAt: typeof parsed.ratedAt === 'string' ? parsed.ratedAt : null,
            donatedAt: typeof parsed.donatedAt === 'string' ? parsed.donatedAt : null,
            lastRatePromptAt:
                typeof parsed.lastRatePromptAt === 'string' ? parsed.lastRatePromptAt : null,
            lastDonatePromptAt:
                typeof parsed.lastDonatePromptAt === 'string' ? parsed.lastDonatePromptAt : null,
        };
    } catch {
        // Unreadable means never asked. Asking once more is the cheaper failure.
        return EMPTY_MARKS;
    }
}

/** Merges a change into what is remembered. */
export async function writePromptMarks(patch: Partial<PromptMarks>): Promise<PromptMarks> {
    const next = { ...(await readPromptMarks()), ...patch };
    await Storage.setItem(KEY, JSON.stringify(next));
    return next;
}

/** Forgets everything, for the debug panel. */
export async function resetPromptMarks(): Promise<void> {
    await Storage.removeItem(KEY);
}
