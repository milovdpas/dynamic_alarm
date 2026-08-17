import { JourneyStatus, LegType } from '@alarm/types';
import type { GeoPoint, Journey, JourneyLeg, JourneyStop } from '@alarm/types';

import { env } from '../../config/app';

/**
 * Raw NS Reisinformatie calls. Station to station only.
 *
 * The plan assumed door-to-door planning from coordinates. The `Ns-App`
 * subscription refuses it outright:
 *
 *     API_KEY_NOT_ALLOWED_TO_PLAN_DOOR_TO_DOOR
 *
 * Probing the key established what it *does* allow, which turned out to be
 * nearly everything else: station-to-station trips with `searchForArrival` and
 * `addChangeTime`, `ctxRecon` reconstruction, nearest-station lookup, the full
 * station list, and disruptions. So door-to-door is composed rather than
 * abandoned, by `JourneyPlannerService`, which adds walking legs from TomTom.
 *
 * Everything the design depended on survives. Only the source of the walk legs
 * changed, and TomTom's routed pedestrian time is arguably better than NS's.
 */
export class NsModule {
    private get headers(): Record<string, string> {
        return {
            'Ocp-Apim-Subscription-Key': env.transport.nsSubscriptionKey(),
            Accept: 'application/json',
        };
    }

    /**
     * Trips between two stations, arriving no later than `arriveBy`.
     *
     * `addChangeTime` is handed to the planner rather than applied afterwards,
     * so a connection tighter than the user's transfer buffer is never
     * proposed. Padding the result could not do that, because it cannot change
     * which train was chosen.
     */
    async planStationToStation(input: {
        fromStation: string;
        toStation: string;
        arriveBy: string;
        addChangeTimeMinutes: number;
    }): Promise<Journey[]> {
        const params = new URLSearchParams({
            fromStation: input.fromStation,
            toStation: input.toStation,
            dateTime: input.arriveBy,
            searchForArrival: 'true',
            addChangeTime: String(input.addChangeTimeMinutes),
        });

        const payload = await this.get<{ trips?: NsTrip[] }>(
            `/reisinformatie-api/api/v3/trips?${params.toString()}`,
        );
        return (payload.trips ?? []).map((trip) => this.toJourney(trip));
    }

    /**
     * Re-fetches one itinerary with current realtime data.
     *
     * The mechanism that makes the product honest: rather than adding a
     * reported delay to a stored plan, NS reconstructs the same trip and says
     * what it now looks like, including whether the connection still works.
     *
     * Null when it can no longer be reconstructed, which the caller must treat
     * as "plan again" rather than "no change".
     */
    async refreshTrip(ctxRecon: string): Promise<Journey | null> {
        try {
            const params = new URLSearchParams({ ctxRecon });
            const trip = await this.get<NsTrip>(`/reisinformatie-api/api/v3/trips/trip?${params.toString()}`);
            return this.toJourney(trip);
        } catch {
            return null;
        }
    }

    /**
     * The nearest station that trains actually depart from.
     *
     * This is how an address becomes a departure station now that NS will not
     * take coordinates directly. The answer is stable for a given home or
     * office, so callers should cache it rather than spend a request per plan.
     *
     * **`heeftVertrektijden` is not optional.** Nearest by distance is not the
     * same as nearest by usefulness: for an address near the Spoorwegmuseum the
     * closest station is Utrecht Maliebaan, a museum halt with no scheduled
     * service. Planning from it produced a journey eight hours adrift that
     * still looked internally consistent, which is exactly the kind of wrong
     * answer that survives review.
     */
    async nearestServedStations(point: GeoPoint, limit = 1): Promise<NsStation[]> {
        // Ask for extra candidates, because the closest ones may be unserved
        // and there is no way to filter server-side.
        const params = new URLSearchParams({
            lat: String(point.lat),
            lng: String(point.lng),
            limit: String(Math.max(limit + 4, 5)),
        });
        const payload = await this.get<{ payload?: NsStation[] }>(
            `/reisinformatie-api/api/v2/stations/nearest?${params.toString()}`,
        );
        return (payload.payload ?? [])
            .filter((station) => station.heeftVertrektijden !== false)
            .slice(0, limit);
    }

    /** Active disruptions, swept once globally per monitor tick. */
    async disruptions(): Promise<unknown[]> {
        const payload = await this.get<unknown>('/disruptions/v3?isActive=true');
        // Array.isArray widens unknown to any[], which would let anything past
        // the type system from here on. The shape is only ever forwarded, so
        // unknown[] is both honest and enough.
        return Array.isArray(payload) ? (payload as unknown[]) : [];
    }

    private async get<T>(path: string): Promise<T> {
        const response = await fetch(`${env.transport.nsBaseUrl}${path}`, { headers: this.headers });

        if (response.status === 429) {
            // 300 requests per 5 minutes for external users. Never swallowed:
            // hitting this means the monitor is spending more than it may, and
            // the ceiling is shared across every user of this deployment.
            const retryAfter = Number(response.headers.get('retry-after') ?? '0');
            throw new NsRateLimitError(retryAfter);
        }
        if (!response.ok) {
            throw new Error(`NS ${path} failed: ${response.status} ${await response.text()}`);
        }
        return (await response.json()) as T;
    }

    private toJourney(trip: NsTrip): Journey {
        const legs = (trip.legs ?? []).map((leg) => this.toLeg(leg));
        const first = legs[0];
        const last = legs[legs.length - 1];

        return {
            id: trip.ctxRecon ?? String(trip.idx ?? 'ns-trip'),
            ctxRecon: trip.ctxRecon ?? null,
            shareUrl: trip.shareUrl?.uri,
            status: this.toStatus(trip.status),
            legs,
            departureAt: first?.actualDeparture ?? '',
            arrivalAt: last?.actualArrival ?? '',
            transferCount: Math.max(0, legs.filter((leg) => leg.type !== LegType.WALK).length - 1),
            source: 'NS',
            watchedStationCodes: this.stationCodes(trip),
        };
    }

    private toLeg(leg: NsLeg): JourneyLeg {
        const plannedDeparture = leg.origin?.plannedDateTime ?? '';
        const plannedArrival = leg.destination?.plannedDateTime ?? '';
        return {
            type: this.toLegType(leg.travelType, leg.product?.type),
            name: leg.product?.displayName ?? leg.name,
            fromName: leg.origin?.name ?? '',
            toName: leg.destination?.name ?? '',
            plannedDeparture,
            actualDeparture: leg.origin?.actualDateTime ?? plannedDeparture,
            plannedArrival,
            actualArrival: leg.destination?.actualDateTime ?? plannedArrival,
            delaySeconds: leg.origin?.delayInSeconds ?? 0,
            plannedTrack: leg.origin?.plannedTrack,
            actualTrack: leg.origin?.actualTrack,
            cancelled: leg.cancelled === true,
            stops: this.toStops(leg.stops),
        };
    }

    /**
     * The stations a leg calls at, dropping the ones it only passes.
     *
     * `passing` stops are stations the train runs through at speed. NS returns
     * them so a map can draw the line; listing them would tell someone their
     * stop is served when it is not, which is the one mistake this list must
     * never make.
     *
     * Undefined rather than empty when there is nothing to show, so a walk leg
     * and a train with no published stops read differently in the app.
     */
    private toStops(stops?: NsTripStop[]): JourneyStop[] | undefined {
        const calling = (stops ?? []).filter((stop) => stop.passing !== true);
        if (calling.length === 0) {
            return undefined;
        }

        return calling.map((stop) => ({
            name: stop.name ?? '',
            arrivalAt: stop.actualArrivalDateTime ?? stop.plannedArrivalDateTime,
            departureAt: stop.actualDepartureDateTime ?? stop.plannedDepartureDateTime,
            track: stop.actualDepartureTrack ?? stop.plannedDepartureTrack,
            delaySeconds: stop.departureDelayInSeconds ?? 0,
            cancelled: stop.cancelled === true,
        }));
    }

    private toLegType(travelType?: string, productType?: string): LegType {
        if (travelType === 'WALK') return LegType.WALK;
        if (travelType === 'BIKE') return LegType.BIKE;
        if (travelType === 'CAR' || travelType === 'KISS') return LegType.CAR;
        if (travelType === 'TAXI') return LegType.TAXI;

        switch (productType) {
            case 'TRAIN':
                return LegType.TRAIN;
            case 'BUS':
                return LegType.BUS;
            case 'TRAM':
                return LegType.TRAM;
            case 'METRO':
                return LegType.METRO;
            case 'FERRY':
                return LegType.FERRY;
            default:
                return travelType === 'PUBLIC_TRANSIT' ? LegType.TRAIN : LegType.UNKNOWN;
        }
    }

    private toStatus(status?: string): JourneyStatus {
        if (status !== undefined && status in JourneyStatus) {
            return JourneyStatus[status as keyof typeof JourneyStatus];
        }
        return JourneyStatus.NORMAL;
    }

    /** Stations this trip touches, matched against the disruption sweep. */
    private stationCodes(trip: NsTrip): string[] {
        const codes = new Set<string>();
        for (const leg of trip.legs ?? []) {
            const from = leg.origin?.stationCode;
            const to = leg.destination?.stationCode;
            if (from !== undefined) codes.add(from);
            if (to !== undefined) codes.add(to);
        }
        return [...codes];
    }
}

export class NsRateLimitError extends Error {
    constructor(readonly retryAfterSeconds: number) {
        super(`NS rate limit reached, retry after ${retryAfterSeconds}s`);
        this.name = 'NsRateLimitError';
    }
}

export interface NsStation {
    /** False for museum halts and closed stations. The filter that matters. */
    heeftVertrektijden?: boolean;
    stationType?: string;
    code?: string;
    UICCode?: string;
    distance?: number;
    namen?: { lang?: string; middel?: string; kort?: string };
    land?: string;
    lat?: number;
    lng?: number;
}

/* Only the fields we read. The full NS schema is far larger. */

interface NsTrip {
    shareUrl?: { uri?: string };
    idx?: number;
    ctxRecon?: string;
    status?: string;
    legs?: NsLeg[];
}

interface NsLeg {
    name?: string;
    travelType?: string;
    cancelled?: boolean;
    product?: { type?: string; displayName?: string };
    origin?: NsStop;
    destination?: NsStop;
    stops?: NsTripStop[];
}

/** A station along a leg. Distinct from `NsStop`, which is a leg's own end. */
interface NsTripStop {
    name?: string;
    plannedArrivalDateTime?: string;
    actualArrivalDateTime?: string;
    plannedDepartureDateTime?: string;
    actualDepartureDateTime?: string;
    plannedDepartureTrack?: string;
    actualDepartureTrack?: string;
    departureDelayInSeconds?: number;
    cancelled?: boolean;
    /** True where the train runs through without stopping. */
    passing?: boolean;
}

interface NsStop {
    name?: string;
    stationCode?: string;
    plannedDateTime?: string;
    actualDateTime?: string;
    plannedTrack?: string;
    actualTrack?: string;
    delayInSeconds?: number;
}
