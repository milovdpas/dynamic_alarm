import { JourneyStatus, LegType } from '@alarm/types';
import type { Journey, JourneyLeg } from '@alarm/types';
import { DateTime } from 'luxon';
import { parseInstant, toIso } from '../time';
import type { PlanRequest, TransportProvider } from './provider';

/** Shift an ISO instant while keeping its original offset in the output. */
function shiftPreservingZone(iso: string, minutes: number): DateTime {
    const dt = DateTime.fromISO(iso, { setZone: true });
    if (!dt.isValid) {
        throw new Error(`Invalid ISO datetime: ${iso}`);
    }
    return dt.plus({ minutes });
}

export interface FixtureLegSpec {
    type: LegType;
    minutes: number;
    name?: string;
    fromName?: string;
    toName?: string;
    /** Realtime delay applied to this leg on refresh. */
    delayMinutes?: number;
    cancelled?: boolean;
    plannedTrack?: string;
    actualTrack?: string;
}

export interface FixtureScenario {
    legs: FixtureLegSpec[];
    status?: JourneyStatus;
    /** Station codes the disruption sweep would match against. */
    watchedStationCodes?: string[];
    /**
     * Arrival offset from `arriveBy`, in minutes. Positive means the journey
     * arrives late, used to exercise the infeasible path.
     */
    arrivalOffsetMinutes?: number;
}

const DEFAULT_SCENARIO: FixtureScenario = {
    legs: [
        { type: LegType.WALK, minutes: 7, fromName: 'Home', toName: 'Station' },
        {
            type: LegType.TRAIN,
            minutes: 35,
            name: 'Intercity',
            fromName: 'Station',
            toName: 'Station',
        },
        { type: LegType.WALK, minutes: 8, fromName: 'Station', toName: 'Work' },
    ],
};

/**
 * Deterministic in-memory provider.
 *
 * Exists so the engine, the monitor loop and the whole M1 app can be built and
 * tested without network access, API keys, or a train actually being late.
 * Swap it for NsProvider/TomTomProvider without touching a line of app code.
 */
export class FixtureTransportProvider implements TransportProvider {
    readonly name = 'FIXTURE';

    private scenario: FixtureScenario;
    /** Extra delay applied on the next refresh, in minutes. */
    private pendingDelayMinutes = 0;
    private pendingStatus: JourneyStatus | null = null;

    constructor(scenario: FixtureScenario = DEFAULT_SCENARIO) {
        this.scenario = scenario;
    }

    /** Test hook: make the next `refresh` report a delay. */
    setDelay(minutes: number): void {
        this.pendingDelayMinutes = minutes;
    }

    /** Test hook: make the next `refresh` report a degraded status. */
    setStatus(status: JourneyStatus): void {
        this.pendingStatus = status;
    }

    setScenario(scenario: FixtureScenario): void {
        this.scenario = scenario;
        this.pendingDelayMinutes = 0;
        this.pendingStatus = null;
    }

    async plan(request: PlanRequest): Promise<Journey[]> {
        return [this.build(request, 0)];
    }

    async refresh(journey: Journey): Promise<Journey | null> {
        if (journey.ctxRecon === null) {
            return null;
        }
        const status = this.pendingStatus ?? journey.status;
        if (
            status === JourneyStatus.CANCELLED ||
            status === JourneyStatus.CHANGE_NOT_POSSIBLE ||
            status === JourneyStatus.ALTERNATIVE_TRANSPORT
        ) {
            // Mirrors the real contract: a broken itinerary cannot be reconstructed,
            // so the caller must re-plan rather than patch what it already has.
            return null;
        }
        return this.shift(journey, this.pendingDelayMinutes, status);
    }

    private build(request: PlanRequest, delayMinutes: number): Journey {
        const totalMinutes = this.scenario.legs.reduce((sum, leg) => sum + leg.minutes, 0);
        const arriveBy = parseInstant(request.arriveBy, request.timezone);
        const arrival = arriveBy.plus({ minutes: this.scenario.arrivalOffsetMinutes ?? 0 });
        const departure = arrival.minus({ minutes: totalMinutes });

        let cursor = departure;
        const legs: JourneyLeg[] = this.scenario.legs.map((spec) => {
            const legDeparture = cursor;
            const legArrival = cursor.plus({ minutes: spec.minutes });
            cursor = legArrival;
            const legDelay = (spec.delayMinutes ?? 0) + delayMinutes;
            return {
                type: spec.type,
                name: spec.name,
                fromName: spec.fromName ?? 'Origin',
                toName: spec.toName ?? 'Destination',
                plannedDeparture: toIso(legDeparture),
                actualDeparture: toIso(legDeparture.plus({ minutes: legDelay })),
                plannedArrival: toIso(legArrival),
                actualArrival: toIso(legArrival.plus({ minutes: legDelay })),
                delaySeconds: legDelay * 60,
                plannedTrack: spec.plannedTrack,
                actualTrack: spec.actualTrack,
                cancelled: spec.cancelled ?? false,
            };
        });

        const transferCount = Math.max(
            0,
            this.scenario.legs.filter((leg) => leg.type !== LegType.WALK).length - 1,
        );

        return {
            id: `fixture-${departure.toMillis()}`,
            ctxRecon: 'fixture-ctx-recon',
            status: this.scenario.status ?? JourneyStatus.NORMAL,
            legs,
            departureAt: toIso(departure),
            arrivalAt: toIso(arrival.plus({ minutes: delayMinutes })),
            transferCount,
            source: this.name,
            watchedStationCodes: this.scenario.watchedStationCodes ?? [],
        };
    }

    /**
     * Apply a delay to an existing journey.
     *
     * Everything is derived from the *planned* times rather than the current
     * actuals, so calling refresh repeatedly with the same delay is idempotent
     * instead of compounding it into an ever-later train.
     */
    private shift(journey: Journey, delayMinutes: number, status: JourneyStatus): Journey {
        if (delayMinutes === 0 && status === journey.status) {
            return journey;
        }
        const shiftIso = (iso: string): string => toIso(shiftPreservingZone(iso, delayMinutes));

        const legs = journey.legs.map((leg) => ({
            ...leg,
            actualDeparture: shiftIso(leg.plannedDeparture),
            actualArrival: shiftIso(leg.plannedArrival),
            delaySeconds: delayMinutes * 60,
        }));

        const lastLeg = legs[legs.length - 1];
        return {
            ...journey,
            status,
            legs,
            // Keep the journey arrival and the final leg arrival in lockstep; a
            // mismatch here would silently corrupt every feasibility check.
            arrivalAt: lastLeg ? lastLeg.actualArrival : shiftIso(journey.arrivalAt),
        };
    }
}
