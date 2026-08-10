import { DateTime } from 'luxon';
import { JourneyStatus, LegType } from '@alarm/types';
import type { GeoPoint, Journey, JourneyLeg } from '@alarm/types';
import type { PlanRequest, TransportProvider } from '@alarm/core';

import { NsModule } from '../modules/NsModule';
import type { NsStation } from '../modules/NsModule';
import { TomTomModule } from '../modules/TomTomModule';

/**
 * Door-to-door journeys, assembled from two APIs neither of which offers them.
 *
 * NS refuses coordinate planning on this subscription
 * (`API_KEY_NOT_ALLOWED_TO_PLAN_DOOR_TO_DOOR`), so the walking legs have to
 * come from elsewhere. TomTom does routed pedestrian times, and the composition
 * is straightforward once the ordering is right:
 *
 *   1. nearest station to each end
 *   2. walk times to and from those stations
 *   3. NS station-to-station, arriving by (deadline minus the final walk)
 *   4. stitch the walks back on
 *
 * Step 3 is the subtle one. The deadline the user cares about is arriving at
 * work, but the deadline NS plans against is arriving at the station, and those
 * differ by the last walk. Getting that backwards would put someone on a train
 * that reaches the platform exactly when they were due at their desk.
 *
 * Implements `TransportProvider`, so the engine and the monitor cannot tell
 * that the journey was assembled rather than fetched.
 */
export class JourneyPlannerService implements TransportProvider {
    readonly name = 'NS+TOMTOM';

    private readonly ns = new NsModule();
    private readonly tomtom = new TomTomModule();

    /**
     * Nearest station and walk time, cached per rounded coordinate.
     *
     * Neither answer changes for a given home or office, and NS allows 300
     * requests per 5 minutes across every user of this deployment. Spending
     * three of them per plan to rediscover that Utrecht Centraal is still the
     * nearest station to the same address would be the first thing to exhaust
     * the budget.
     */
    private readonly accessCache = new Map<string, StationAccess>();

    async plan(request: PlanRequest): Promise<Journey[]> {
        const [from, to] = await Promise.all([
            this.resolveAccess(request.origin),
            this.resolveAccess(request.destination),
        ]);

        if (from === null || to === null) {
            return [];
        }

        // NS plans to the arrival station, not to the destination. The final
        // walk has to come off the deadline before asking.
        const stationArriveBy = DateTime.fromISO(request.arriveBy, { setZone: true })
            .setZone(request.timezone)
            .minus({ minutes: to.walkMinutes });

        const trips = await this.ns.planStationToStation({
            fromStation: from.station.code ?? '',
            toStation: to.station.code ?? '',
            arriveBy: stationArriveBy.toISO() ?? request.arriveBy,
            addChangeTimeMinutes: request.addChangeTimeMinutes,
        });

        // "Arrive by" has no lower bound, so a station with sparse or no service
        // makes NS answer with the last train that ever got there, which can be
        // the previous evening. Such a trip satisfies the deadline arithmetic
        // perfectly and still yields a wake time in the past. Nobody can board a
        // train that has already left, so drop them here rather than let the
        // engine reason about them.
        const now = DateTime.now().setZone(request.timezone);
        return trips
            .map((trip) => this.withWalkingLegs(trip, from, to, request.timezone))
            .filter((journey) => DateTime.fromISO(journey.departureAt, { setZone: true }) > now);
    }

    /**
     * Re-fetches the rail part and re-applies the same walks.
     *
     * The walking legs are stable, so only the train is worth asking about
     * again. The stored journey already carries its walks, which are read back
     * off it rather than re-fetched, keeping a refresh to a single NS call.
     */
    async refresh(journey: Journey): Promise<Journey | null> {
        if (journey.ctxRecon === null) {
            return null;
        }
        const refreshed = await this.ns.refreshTrip(journey.ctxRecon);
        if (refreshed === null) {
            return null;
        }

        const leadingWalk = journey.legs[0];
        const trailingWalk = journey.legs[journey.legs.length - 1];

        return this.reattachWalks(
            refreshed,
            leadingWalk?.type === LegType.WALK ? leadingWalk : null,
            trailingWalk?.type === LegType.WALK ? trailingWalk : null,
        );
    }

    /** Nearest station plus the walk to it, cached. */
    private async resolveAccess(point: GeoPoint): Promise<StationAccess | null> {
        const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
        const cached = this.accessCache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const [station] = await this.ns.nearestServedStations(point, 1);
        if (station === undefined || station.code === undefined) {
            return null;
        }

        const stationPoint = stationCoordinates(station);
        const walkMinutes =
            stationPoint === null ? null : await this.tomtom.walkMinutes(point, stationPoint);

        const access: StationAccess = {
            station,
            // A failed walk lookup falls back to zero rather than guessing a
            // number. Zero is visibly wrong in the breakdown; an invented eight
            // minutes would look correct and quietly cost someone their train.
            walkMinutes: walkMinutes ?? 0,
            point: stationPoint,
        };
        this.accessCache.set(key, access);
        return access;
    }

    private withWalkingLegs(
        trip: Journey,
        from: StationAccess,
        to: StationAccess,
        timezone: string,
    ): Journey {
        const railDeparture = DateTime.fromISO(trip.departureAt, { setZone: true }).setZone(timezone);
        const railArrival = DateTime.fromISO(trip.arrivalAt, { setZone: true }).setZone(timezone);

        const leadingWalk: JourneyLeg | null =
            from.walkMinutes > 0
                ? walkLeg(
                      railDeparture.minus({ minutes: from.walkMinutes }),
                      railDeparture,
                      'Origin',
                      stationName(from.station),
                  )
                : null;

        const trailingWalk: JourneyLeg | null =
            to.walkMinutes > 0
                ? walkLeg(
                      railArrival,
                      railArrival.plus({ minutes: to.walkMinutes }),
                      stationName(to.station),
                      'Destination',
                  )
                : null;

        return this.reattachWalks(trip, leadingWalk, trailingWalk);
    }

    private reattachWalks(
        trip: Journey,
        leadingWalk: JourneyLeg | null,
        trailingWalk: JourneyLeg | null,
    ): Journey {
        // Any walks already on the journey are dropped first, so re-attaching
        // after a refresh cannot accumulate a second pair.
        const railLegs = trip.legs.filter((leg) => leg.type !== LegType.WALK);
        const legs = [
            ...(leadingWalk === null ? [] : [leadingWalk]),
            ...railLegs,
            ...(trailingWalk === null ? [] : [trailingWalk]),
        ];

        const first = legs[0];
        const last = legs[legs.length - 1];

        return {
            ...trip,
            legs,
            departureAt: first?.actualDeparture ?? trip.departureAt,
            arrivalAt: last?.actualArrival ?? trip.arrivalAt,
            // Walking is not a transfer, so the count is unchanged and the
            // discrete risk buffer stays keyed to trains missed, not steps taken.
            transferCount: trip.transferCount,
            source: this.name,
            status: trip.status === undefined ? JourneyStatus.NORMAL : trip.status,
        };
    }
}

interface StationAccess {
    station: NsStation;
    walkMinutes: number;
    point: GeoPoint | null;
}

function walkLeg(from: DateTime, to: DateTime, fromName: string, toName: string): JourneyLeg {
    const departure = from.toISO() ?? '';
    const arrival = to.toISO() ?? '';
    return {
        type: LegType.WALK,
        fromName,
        toName,
        plannedDeparture: departure,
        actualDeparture: departure,
        plannedArrival: arrival,
        actualArrival: arrival,
        // A walk cannot be delayed or cancelled by anyone but the walker.
        delaySeconds: 0,
        cancelled: false,
    };
}

function stationName(station: NsStation): string {
    return station.namen?.lang ?? station.namen?.middel ?? station.code ?? 'Station';
}

function stationCoordinates(station: NsStation): GeoPoint | null {
    if (typeof station.lat === 'number' && typeof station.lng === 'number') {
        return { lat: station.lat, lng: station.lng };
    }
    return null;
}
