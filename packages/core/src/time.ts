import { DateTime } from 'luxon';
import type { IsoDateString, IsoDateTimeString, LocalTimeString, TimeZone } from '@alarm/types';
import { Weekday } from '@alarm/types';

/** Parse an absolute instant into a zone-aware DateTime. */
export function parseInstant(iso: IsoDateTimeString, timezone: TimeZone): DateTime {
    const dt = DateTime.fromISO(iso, { setZone: true }).setZone(timezone);
    if (!dt.isValid) {
        throw new Error(`Invalid ISO datetime: ${iso}`);
    }
    return dt;
}

export function toIso(dt: DateTime): IsoDateTimeString {
    const iso = dt.toISO();
    if (iso === null) {
        throw new Error('Cannot serialise an invalid DateTime');
    }
    return iso;
}

/**
 * Split `"08:30"` into hour and minute. Throws on anything else.
 *
 * Seconds are accepted and ignored, because MySQL returns a `time` column as
 * `07:00:00` and the call sites that forget to trim it are the ones written
 * later, in a hurry, against a value that looks fine in the database.
 */
export function parseLocalTime(time: LocalTimeString): { hour: number; minute: number } {
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
    if (!match) {
        throw new Error(`Invalid local time (expected HH:mm): ${time}`);
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) {
        throw new Error(`Local time out of range: ${time}`);
    }
    return { hour, minute };
}

/**
 * Resolve a wall-clock time on a given date into an absolute instant.
 *
 * This is where DST bites. On the spring-forward morning 02:30 does not exist,
 * and on the autumn morning 02:30 happens twice. Luxon resolves both without
 * throwing, so the alarm still fires on a sane instant instead of the whole
 * schedule silently vanishing for a day.
 */
export function resolveLocalTimeOnDate(
    date: IsoDateString,
    time: LocalTimeString,
    timezone: TimeZone,
): DateTime {
    const { hour, minute } = parseLocalTime(time);
    const day = DateTime.fromISO(date, { zone: timezone });
    if (!day.isValid) {
        throw new Error(`Invalid ISO date: ${date}`);
    }
    return day.set({ hour, minute, second: 0, millisecond: 0 });
}

/**
 * The next date (today included) whose weekday is in `daysOfWeek` and whose
 * local `time` has not already passed.
 *
 * Returns null when `daysOfWeek` is empty, an inactive schedule, not an error.
 */
export function nextOccurrenceDate(
    daysOfWeek: Weekday[],
    time: LocalTimeString,
    timezone: TimeZone,
    now: DateTime,
): DateTime | null {
    if (daysOfWeek.length === 0) {
        return null;
    }
    const wanted = new Set<number>(daysOfWeek);
    const today = now.setZone(timezone).startOf('day');

    // A week of lookahead is always enough: any weekday recurs within 7 days.
    for (let offset = 0; offset < 8; offset += 1) {
        const candidate = today.plus({ days: offset });
        if (!wanted.has(candidate.weekday)) {
            continue;
        }
        const date = candidate.toISODate();
        if (date === null) {
            continue;
        }
        const at = resolveLocalTimeOnDate(date, time, timezone);
        if (at > now) {
            return at;
        }
    }
    return null;
}

export function minutesBetween(from: DateTime, to: DateTime): number {
    return to.diff(from, 'minutes').minutes;
}

/** Whole minutes, rounded up, never round a safety margin down. */
export function ceilMinutes(value: number): number {
    return Math.ceil(value - 1e-9);
}
