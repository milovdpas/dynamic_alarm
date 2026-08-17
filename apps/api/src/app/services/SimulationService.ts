import { DateTime } from 'luxon';
import { APP_CONSTANTS, JourneyStatus, SimulationKind } from '@alarm/types';
import type { Journey } from '@alarm/types';

import type ScheduleOccurrence from '../models/ScheduleOccurrence.entity';

/**
 * The one place this system deliberately lies to itself.
 *
 * Real trains are mostly on time, so the path this whole product exists for runs
 * perhaps twice a month and never while anyone is watching. Waiting for NS to
 * cancel something is not a test plan.
 *
 * A staged simulation changes exactly one thing: what the provider appears to
 * have said on the next check. Everything downstream stays real. The same engine
 * recomputes the wake time, the same opt-in settings decide whether it may move,
 * the same push goes through Expo, and the phone applies it under the same
 * monotonic rule. If any of that is broken, this finds it.
 *
 * Three properties keep it a test tool rather than a liability, and each is
 * enforced here rather than trusted to whoever calls it:
 *
 *   It expires. One application, or an hour, whichever is first.
 *   It is visible. The occurrence says it is simulated and the event says so.
 *   It only ever makes things worse. A pretend delay moves an alarm later and a
 *   pretend cancellation forces a re-plan; neither invents an earlier time,
 *   because the emergency path deserves a real cancellation to prove it.
 */
export class SimulationService {
    /** Stages one, replacing anything already waiting. */
    stage(occurrence: ScheduleOccurrence, kind: SimulationKind, minutes: number): void {
        occurrence.simulationKind = kind;
        occurrence.simulationMinutes = minutes;
        occurrence.simulationExpiresAt = DateTime.now()
            .plus({ minutes: APP_CONSTANTS.MONITOR.SIMULATION_TTL_MINUTES })
            .toJSDate();
    }

    clear(occurrence: ScheduleOccurrence): void {
        occurrence.simulationKind = null;
        occurrence.simulationMinutes = null;
        occurrence.simulationExpiresAt = null;
    }

    /**
     * What this occurrence should pretend the provider said, if anything.
     *
     * Returns undefined when there is nothing staged, which is different from
     * returning the journey unchanged: the caller uses that to tell "no
     * simulation" from "simulated into a cancellation", and the second is null.
     *
     * Consuming is the caller's job, on purpose. This is a pure function of the
     * row and the journey so it can be tested without a database, and a
     * simulation must be cleared in the same save as the plan it produced.
     */
    apply(occurrence: ScheduleOccurrence, journey: Journey | null, now: Date): Journey | null | undefined {
        const kind = occurrence.simulationKind;
        if (kind === null) {
            return undefined;
        }

        const expiresAt = occurrence.simulationExpiresAt;
        if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
            // Expired rather than applied. Staged and forgotten is the common
            // case, and an hour later the timetable it was aimed at is gone.
            return undefined;
        }

        if (kind === SimulationKind.CANCELLATION) {
            // What a cancellation looks like from the monitor's side: the trip
            // can no longer be reconstructed, so a re-plan is forced.
            return null;
        }

        return journey === null ? null : this.delay(journey, occurrence.simulationMinutes ?? 0);
    }

    /**
     * The same journey, later.
     *
     * Every leg moves by the same amount rather than only the first, because a
     * train that leaves late arrives late, and the engine reads the arrival to
     * decide whether the itinerary still works. Shifting only the departure
     * would produce a journey that gains time in transit.
     *
     * The status is marked disrupted so the risk buffer responds the way it
     * would to a real delay. A simulation that skipped that would test the
     * arithmetic and not the behaviour.
     */
    private delay(journey: Journey, minutes: number): Journey {
        const later = (iso: string): string =>
            iso === ''
                ? iso
                : (DateTime.fromISO(iso, { setZone: true }).plus({ minutes }).toISO() ?? iso);

        return {
            ...journey,
            status: JourneyStatus.DISRUPTION,
            departureAt: later(journey.departureAt),
            arrivalAt: later(journey.arrivalAt),
            legs: journey.legs.map((leg) => ({
                ...leg,
                actualDeparture: later(leg.actualDeparture),
                actualArrival: later(leg.actualArrival),
                delaySeconds: leg.delaySeconds + minutes * 60,
                stops: leg.stops?.map((stop) => ({
                    ...stop,
                    arrivalAt: stop.arrivalAt === undefined ? undefined : later(stop.arrivalAt),
                    departureAt:
                        stop.departureAt === undefined ? undefined : later(stop.departureAt),
                    delaySeconds: stop.delaySeconds + minutes * 60,
                })),
            })),
        };
    }
}
