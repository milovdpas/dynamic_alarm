import { ReplacementPreference } from '@alarm/types';
import type { IsoDateTimeString, LocalTimeString, TimeZone, WakePlan } from '@alarm/types';

import { parseInstant, parseLocalTime } from '../time';

export interface ReplacementInput {
    /** Candidates for the same morning, as the planner returned them. */
    options: WakePlan[];
    /** When the cancelled service was leaving, so "earlier" has a reference. */
    cancelledDepartureAt: IsoDateTimeString | null;
    preference: ReplacementPreference;
    /** Unset means any hour is acceptable. */
    windowStart: LocalTimeString | null;
    windowEnd: LocalTimeString | null;
    timezone: TimeZone;
}

export type ReplacementResult =
    | { found: true; plan: WakePlan; direction: 'EARLIER' | 'LATER' }
    /** Something exists, but not inside the hours the user will travel. */
    | { found: false; reason: 'OUTSIDE_WINDOW' }
    /** The planner offered nothing at all for this morning. */
    | { found: false; reason: 'NOTHING_PLANNED' };

/**
 * Which replacement to take when the chosen train is cancelled.
 *
 * The app used to accept whatever the planner returned first, which is how a
 * 06:50 becomes the answer for somebody who is not willing to get up an hour
 * earlier. That is a decision about someone's morning, so it belongs to them:
 * a direction to look first, and the hours in which travelling is acceptable at
 * all.
 *
 * The order matters and is deliberate:
 *
 *   1. The preferred direction, inside the window.
 *   2. The other direction, inside the window. Someone who prefers an earlier
 *      train would still rather take a later one than none, and the reverse
 *      holds just as strongly.
 *   3. Nothing, and say so. This is the honest outcome when a window excludes
 *      every remaining service, and it is far better than an alarm moved to
 *      06:20 for a train its owner was never going to catch.
 *
 * A later replacement will often arrive after the deadline. That is not a
 * failure to report here: the engine already marks such a plan `feasible:
 * false` with the minutes it falls short, and someone who chose `LATER` has
 * said they would rather be late than early.
 */
export function chooseReplacement(input: ReplacementInput): ReplacementResult {
    const candidates = input.options.filter((option) => option.journey !== null);
    if (candidates.length === 0) {
        return { found: false, reason: 'NOTHING_PLANNED' };
    }

    const withinWindow = candidates.filter((option) =>
        isWithinWindow(serviceDeparture(option), input),
    );
    if (withinWindow.length === 0) {
        return { found: false, reason: 'OUTSIDE_WINDOW' };
    }

    const cancelled = input.cancelledDepartureAt;
    if (cancelled === null) {
        // Nothing to be earlier or later than, so the planner's own first
        // choice stands. That is the latest departure still arriving on time,
        // which is the answer somebody with no preference wants anyway.
        const first = withinWindow[0];
        return first === undefined
            ? { found: false, reason: 'NOTHING_PLANNED' }
            : { found: true, plan: first, direction: 'EARLIER' };
    }

    const reference = parseInstant(cancelled, input.timezone).toMillis();
    const earlier = closestBefore(withinWindow, reference, input.timezone);
    const later = closestAfter(withinWindow, reference, input.timezone);

    const preferred = input.preference === ReplacementPreference.EARLIER ? earlier : later;
    const fallback = input.preference === ReplacementPreference.EARLIER ? later : earlier;

    if (preferred !== null) {
        return {
            found: true,
            plan: preferred,
            direction: input.preference === ReplacementPreference.EARLIER ? 'EARLIER' : 'LATER',
        };
    }
    if (fallback !== null) {
        return {
            found: true,
            plan: fallback,
            direction: input.preference === ReplacementPreference.EARLIER ? 'LATER' : 'EARLIER',
        };
    }

    // Everything inside the window departs at the same moment as the service
    // that was cancelled, which in practice means the planner handed back the
    // same trip. Not a replacement.
    return { found: false, reason: 'OUTSIDE_WINDOW' };
}

/** When the first real service leaves, ignoring the walk or ride to it. */
export function serviceDeparture(plan: WakePlan): IsoDateTimeString | null {
    const journey = plan.journey;
    if (journey === null) {
        return null;
    }

    const service = journey.legs.find((leg) => leg.type !== 'WALK' && leg.type !== 'BIKE');
    return service?.actualDeparture ?? journey.departureAt;
}

/**
 * Whether a departure falls in the hours the user will travel.
 *
 * Compared as wall-clock times on the departure's own day, because that is how
 * the window was expressed: "not before seven" means seven in the morning where
 * they are, on whichever morning this is, without an opinion about daylight
 * saving.
 */
function isWithinWindow(departure: IsoDateTimeString | null, input: ReplacementInput): boolean {
    if (departure === null) {
        return false;
    }
    if (input.windowStart === null && input.windowEnd === null) {
        return true;
    }

    const at = parseInstant(departure, input.timezone);
    const minutes = at.hour * 60 + at.minute;

    if (input.windowStart !== null && minutes < toMinutes(input.windowStart)) {
        return false;
    }
    if (input.windowEnd !== null && minutes > toMinutes(input.windowEnd)) {
        return false;
    }
    return true;
}

function toMinutes(time: LocalTimeString): number {
    const { hour, minute } = parseLocalTime(time);
    return hour * 60 + minute;
}

/** The latest option departing before the reference, so the smallest sacrifice. */
function closestBefore(
    options: WakePlan[],
    reference: number,
    timezone: TimeZone,
): WakePlan | null {
    let best: { plan: WakePlan; at: number } | null = null;

    for (const option of options) {
        const departure = serviceDeparture(option);
        if (departure === null) {
            continue;
        }
        const at = parseInstant(departure, timezone).toMillis();
        if (at < reference && (best === null || at > best.at)) {
            best = { plan: option, at };
        }
    }

    return best?.plan ?? null;
}

/** The earliest option departing after it, for the same reason in reverse. */
function closestAfter(options: WakePlan[], reference: number, timezone: TimeZone): WakePlan | null {
    let best: { plan: WakePlan; at: number } | null = null;

    for (const option of options) {
        const departure = serviceDeparture(option);
        if (departure === null) {
            continue;
        }
        const at = parseInstant(departure, timezone).toMillis();
        if (at > reference && (best === null || at < best.at)) {
            best = { plan: option, at };
        }
    }

    return best?.plan ?? null;
}
