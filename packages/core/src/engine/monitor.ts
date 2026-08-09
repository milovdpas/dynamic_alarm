import { APP_CONSTANTS } from '@alarm/types';
import type { IsoDateTimeString, TimeZone } from '@alarm/types';
import { minutesBetween, parseInstant, toIso } from '../time';

const { MONITOR } = APP_CONSTANTS;

export interface CadenceBand {
    withinMinutes: number;
    intervalMinutes: number;
}

/**
 * How long to wait before re-checking an occurrence.
 *
 * Picks the narrowest band that still contains the occurrence, so the check
 * rate rises as the alarm approaches: a delay six hours out is noise, a delay
 * twenty minutes out is the entire product.
 *
 * Returns null when the occurrence is beyond the arming horizon and should not
 * be costing us provider calls at all.
 */
export function resolveCheckIntervalMinutes(
    minutesUntilWake: number,
    bands: readonly CadenceBand[] = MONITOR.CADENCE_BANDS,
): number | null {
    let chosen: number | null = null;
    for (const band of bands) {
        if (minutesUntilWake <= band.withinMinutes) {
            // Bands are ordered widest-first, so later matches are narrower and win.
            chosen = band.intervalMinutes;
        }
    }
    return chosen;
}

export interface NextCheckInput {
    wakeAt: IsoDateTimeString;
    now: IsoDateTimeString;
    timezone: TimeZone;
    bands?: readonly CadenceBand[];
}

/**
 * When the monitor loop should next look at this occurrence.
 *
 * Never schedules a check past the wake time itself, a check that lands after
 * the alarm has already rung cannot change anything, and would just be a
 * provider call spent on a decision that is already made.
 */
export function computeNextCheckAt(input: NextCheckInput): IsoDateTimeString | null {
    const now = parseInstant(input.now, input.timezone);
    const wakeAt = parseInstant(input.wakeAt, input.timezone);
    const minutesUntilWake = minutesBetween(now, wakeAt);

    if (minutesUntilWake <= 0) {
        return null;
    }

    const interval = resolveCheckIntervalMinutes(minutesUntilWake, input.bands);
    if (interval === null) {
        return null;
    }

    const next = now.plus({ minutes: interval });
    return toIso(next < wakeAt ? next : wakeAt);
}

/** True once an occurrence is close enough to be worth monitoring. */
export function shouldArm(minutesUntilWake: number): boolean {
    return minutesUntilWake > 0 && minutesUntilWake <= MONITOR.ARM_LEAD_MINUTES;
}

/**
 * Total provider calls one occurrence costs between arming and waking.
 *
 * Exists so a change to the cadence bands shows up as a failing assertion
 * rather than as a surprise on an invoice, NS publishes no rate limits, so the
 * only ceiling we have is the one we impose on ourselves.
 */
export function estimateChecksPerOccurrence(
    bands: readonly CadenceBand[] = MONITOR.CADENCE_BANDS,
    armLeadMinutes: number = MONITOR.ARM_LEAD_MINUTES,
): number {
    let checks = 0;
    let minutesUntilWake = armLeadMinutes;

    while (minutesUntilWake > 0) {
        const interval = resolveCheckIntervalMinutes(minutesUntilWake, bands);
        if (interval === null) {
            break;
        }
        checks += 1;
        minutesUntilWake -= interval;
    }
    return checks;
}

/**
 * Whether a recomputed wake time may be pushed to the device.
 *
 * The alarm is monotonically non-decreasing by design. If a push is dropped,
 * the backend dies, or the phone is in flight mode, the device still holds an
 * anchor alarm at the pessimistic time and the user wakes slightly early rather
 * than late. Moving the alarm *earlier* is therefore never routine, it is an
 * explicit, best-effort emergency and callers must opt into it.
 */
export function shouldPushWakeChange(
    currentWakeAt: IsoDateTimeString,
    nextWakeAt: IsoDateTimeString,
    timezone: TimeZone,
    options: { allowEarlier?: boolean } = {},
): boolean {
    const current = parseInstant(currentWakeAt, timezone);
    const next = parseInstant(nextWakeAt, timezone);
    const deltaMinutes = minutesBetween(current, next);

    if (Math.abs(deltaMinutes) < MONITOR.MIN_PUSH_DELTA_MINUTES) {
        // Below this floor, a push wakes every device's radio for a change no human
        // would notice, and spends battery to do it.
        return false;
    }
    if (deltaMinutes < 0) {
        return options.allowEarlier === true;
    }
    return true;
}
