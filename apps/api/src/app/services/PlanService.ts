import { DateTime } from 'luxon';
import { MAX_JOURNEY_OPTIONS, Weekday } from '@alarm/types';
import type { PlanPreviewRequest, WakePlan } from '@alarm/types';
import {
    computeWakePlan,
    nextOccurrenceDate,
    planWake,
    rankJourneys,
    resolveLocalTimeOnDate,
    selectJourney,
    toIso,
} from '@alarm/core';

import { TransportProviderFactory } from './TransportProviderFactory';

const EVERY_DAY = [
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
    Weekday.SATURDAY,
    Weekday.SUNDAY,
];

export class PlanService {
    /**
     * A wake plan for coordinates the user has not saved yet.
     *
     * This is what makes onboarding honest. The user is deciding whether the
     * app is worth setting up, and the only convincing answer is their real
     * commute against the real timetable, so this runs the same engine the
     * monitor will, on the same providers, and persists nothing.
     */
    async preview(input: PlanPreviewRequest): Promise<WakePlan> {
        const requiredArrivalAt = this.resolveArrival(input);
        const provider = TransportProviderFactory.forMode(input.mode);

        const shared = {
            requiredArrivalAt,
            mode: input.mode,
            fixedTravelMinutes: input.fixedTravelMinutes,
            routineMinutes: input.routineMinutes,
            buffers: input.buffers,
            timezone: input.timezone,
        };

        if (provider === null) {
            // FIXED mode: the user supplied the travel time, so there is
            // nothing to ask and no journey to attach.
            return computeWakePlan({ ...shared, journey: null });
        }

        return planWake(
            {
                ...shared,
                origin: input.origin,
                destination: input.destination,
                originAccess: input.originAccess,
                destinationAccess: input.destinationAccess,
                journeyOffset: input.journeyOffset,
            },
            provider,
        );
    }

    /**
     * The same commute planned several ways, so the traveller can choose.
     *
     * The engine takes the latest journey that still arrives on time, because
     * that buys the most sleep. It is the right default and the wrong answer for
     * anyone who wants a seat, the direct train, or simply some margin.
     *
     * A whole plan per option rather than a list of departures: the number being
     * chosen between is the wake-up time, and that only exists once the routine
     * and the buffers have been applied.
     *
     * Ordered latest departure first, so the index is the `journeyOffset` to
     * store. One provider call serves all of them, since NS returns several
     * itineraries for a single request.
     */
    async options(input: PlanPreviewRequest): Promise<WakePlan[]> {
        const requiredArrivalAt = this.resolveArrival(input);
        const provider = TransportProviderFactory.forMode(input.mode);

        const shared = {
            requiredArrivalAt,
            mode: input.mode,
            fixedTravelMinutes: input.fixedTravelMinutes,
            routineMinutes: input.routineMinutes,
            buffers: input.buffers,
            timezone: input.timezone,
        };

        if (provider === null) {
            // FIXED mode has one answer by construction: the user supplied the
            // travel time, so there is nothing to choose between.
            return [computeWakePlan({ ...shared, journey: null })];
        }

        const journeys = await provider.plan({
            origin: input.origin,
            destination: input.destination,
            arriveBy: toIso(
                DateTime.fromISO(requiredArrivalAt, { setZone: true })
                    .setZone(input.timezone)
                    .minus({ minutes: input.buffers.arrivalMinutes }),
            ),
            addChangeTimeMinutes: input.buffers.transferMinutes,
            originAccess: input.originAccess,
            destinationAccess: input.destinationAccess,
            timezone: input.timezone,
        });

        const ranked = rankJourneys(journeys, requiredArrivalAt, input.timezone);

        if (ranked.length === 0) {
            // Nothing arrives on time. The least-late journey is still an
            // answer, and the plan carries feasible: false with the shortfall,
            // so the user gets an alarm rather than an error.
            const journey = selectJourney(journeys, requiredArrivalAt, input.timezone);
            return [computeWakePlan({ ...shared, journey })];
        }

        return ranked
            .slice(0, MAX_JOURNEY_OPTIONS)
            .map((journey) => computeWakePlan({ ...shared, journey }));
    }

    /**
     * Turns "08:30" into an instant.
     *
     * A named date is taken as given. Without one, the next time that clock
     * reading comes round is meant, which is tomorrow once today's has passed,
     * because previewing an alarm for a deadline in the past is never what
     * someone typing an arrival time is asking for.
     */
    private resolveArrival(input: PlanPreviewRequest): string {
        if (input.date !== undefined) {
            return toIso(resolveLocalTimeOnDate(input.date, input.arrivalTime, input.timezone));
        }

        const next = nextOccurrenceDate(
            EVERY_DAY,
            input.arrivalTime,
            input.timezone,
            DateTime.now().setZone(input.timezone),
        );
        if (next === null) {
            // Unreachable: the only null case is an empty day list, and this
            // one names all seven. Throwing rather than inventing a time,
            // because reaching here would mean the helper had changed under us
            // and a guessed deadline is worse than a 500.
            throw new Error('nextOccurrenceDate returned null for a full week of days');
        }
        return toIso(next);
    }
}
