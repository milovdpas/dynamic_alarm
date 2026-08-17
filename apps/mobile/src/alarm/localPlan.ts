import { DateTime } from 'luxon';
import { APP_CONSTANTS, TransportMode, Weekday } from '@alarm/types';
import type { OccurrenceResponse, Routine, Schedule, WakePlan } from '@alarm/types';
import { computeWakePlan, routineDurationMinutes } from '@alarm/core';

/**
 * How much longer a journey is assumed to take when nobody can ask.
 *
 * A local plan has no NS and no TomTom behind it, only the travel time this
 * schedule needed the last time somebody could ask. Trains are late more often
 * than they are early, so an estimate with no live data behind it should sit on
 * the safe side of the last one rather than on top of it.
 *
 * Ten minutes rather than a percentage: the uncertainty being padded is "nobody
 * has checked", which does not scale with the length of the journey.
 */
const PESSIMISM_MINUTES = 10;

/** A wake time this phone worked out on its own, and what it is worth. */
export interface LocalPlan {
    scheduleId: string;
    scheduleName: string;
    /** The morning this is for, as a local date. */
    date: string;
    plan: WakePlan;
    /** The occurrence whose travel time this was derived from. */
    basedOn: string;
}

/**
 * A wake time computed on the device, for a morning the server never armed.
 *
 * **The last unrealised idea in the architecture.** `packages/core` is shared by
 * the app and the API precisely so both can compute the same answer, and until
 * now only the API ever did: the phone read an occurrence and armed whatever it
 * was told. A device that could not reach the API could show yesterday's plan,
 * thanks to the cache, but if nothing had been armed for tomorrow then nothing
 * would ring.
 *
 * This fills that gap and nothing else. It is used when the API cannot be
 * reached **and** no occurrence exists for the morning in question, and it never
 * overrides a server plan, which knows about live trains and this does not.
 *
 * Three things it deliberately does not do:
 *
 * - **It does not plan a journey.** No NS, no TomTom, no itinerary. It reuses
 *   the travel time from the most recent occurrence of the same schedule, which
 *   is the only travel figure the phone has ever been given, and pads it.
 * - **It does not invent a schedule it has not seen.** With no cached schedule
 *   or routine there is no plan, and the app says the alarm cannot be worked out
 *   rather than guessing at somebody's morning.
 * - **It does not pretend to be live.** The caller labels it, because a wake
 *   time with nothing behind it and one computed from a live journey are worth
 *   different amounts of trust, and only the person being woken can judge that.
 */
export function computeLocalPlans(input: {
    schedules: Schedule[];
    routines: Routine[];
    /** Whatever the phone last knew, used only for their travel times. */
    knownOccurrences: OccurrenceResponse[];
    now: string;
}): LocalPlan[] {
    const now = DateTime.fromISO(input.now, { setZone: true }).setZone(APP_CONSTANTS.TIMEZONE);

    return input.schedules
        .filter((schedule) => schedule.active)
        .map((schedule) => planFor(schedule, input, now))
        .filter((plan): plan is LocalPlan => plan !== null)
        .sort((a, b) => a.plan.wakeUpAt.localeCompare(b.plan.wakeUpAt));
}

function planFor(
    schedule: Schedule,
    input: {
        routines: Routine[];
        knownOccurrences: OccurrenceResponse[];
    },
    now: DateTime,
): LocalPlan | null {
    const routine = input.routines.find((each) => each.id === schedule.routineId);
    if (routine === undefined) {
        return null;
    }

    // The last thing the server said about this schedule, whichever morning it
    // was for. Its travel time is the only one this phone has ever been told.
    const previous = input.knownOccurrences
        .filter((occurrence) => occurrence.scheduleId === schedule.id)
        .sort((a, b) => b.date.localeCompare(a.date))[0];

    if (previous === undefined) {
        return null;
    }

    const arrival = nextArrival(schedule, now);
    if (arrival === null) {
        return null;
    }

    const plan = computeWakePlan({
        requiredArrivalAt: arrival.toISO() ?? '',
        // FIXED regardless of how this schedule normally travels. The mode
        // decides which risk buffer applies and how the journey is read, and
        // there is no journey here: claiming PUBLIC_TRANSPORT with a null
        // journey would ask the engine to reason about transfers that were
        // never looked up.
        mode: TransportMode.FIXED,
        journey: null,
        fixedTravelMinutes: previous.plan.breakdown.travelMinutes + PESSIMISM_MINUTES,
        routineMinutes: routineDurationMinutes(routine),
        // The schedule's own buffers, which the user set and the phone has
        // cached, rather than the ones baked into the previous plan. Editing a
        // buffer and then losing connectivity should not resurrect the old one.
        buffers: schedule.buffers,
        timezone: schedule.timezone,
        now: now.toISO() ?? undefined,
    });

    return {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        date: arrival.toISODate() ?? '',
        plan,
        basedOn: previous.id,
    };
}

/**
 * The next instant this schedule requires somebody to have arrived somewhere.
 *
 * Today counts only if its arrival has not already passed, which is what stops a
 * phone opened at 09:00 arming an alarm for a deadline an hour ago.
 */
function nextArrival(schedule: Schedule, now: DateTime): DateTime | null {
    const [hour, minute] = schedule.arrivalTime.split(':').map(Number);
    if (hour === undefined || minute === undefined) {
        return null;
    }

    for (let ahead = 0; ahead <= 7; ahead += 1) {
        const day = now.plus({ days: ahead });
        const arrival = day.set({ hour, minute, second: 0, millisecond: 0 });

        if (!schedule.daysOfWeek.includes(weekdayOf(day))) {
            continue;
        }
        if (arrival <= now) {
            continue;
        }
        return arrival;
    }
    return null;
}

/**
 * Luxon numbers Monday 1 through Sunday 7, and so does `Weekday`.
 *
 * Cast rather than mapped through a table: the enum was defined with those
 * numbers deliberately, and a lookup array would be a second place for the
 * order to be wrong.
 */
function weekdayOf(day: DateTime): Weekday {
    return day.weekday as Weekday;
}
