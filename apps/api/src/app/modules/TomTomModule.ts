import { AccessMode } from '@alarm/types';
import type { GeoPoint } from '@alarm/types';

import { env } from '../../config/app';
import { ProviderUsage } from '../services/ProviderUsage';

export interface RouteResult {
    departureAt: string;
    arrivalAt: string;
    travelSeconds: number;
    /** Congestion cost against free-flow. Always zero when walking. */
    trafficDelaySeconds: number;
}

/**
 * TomTom Routing, for driving and for walking.
 *
 * Walking matters more than it looks. NS refuses door-to-door planning on this
 * subscription, so the walk from home to the platform and from the platform to
 * the office has to come from somewhere. TomTom returns a routed pedestrian
 * time along actual paths, which is a better number than a straight-line
 * estimate and arguably better than what NS would have supplied.
 *
 * The nuance that shapes the car strategy: **for a future departure, TomTom
 * ignores live traffic.** Only historic and predictive data shape road speeds.
 * An estimate made the night before is a forecast; one made inside the
 * departure window reflects the road as it is. The engine relaxes the risk
 * buffer accordingly, and the monitor re-queries as departure approaches.
 */
export class TomTomModule {
    /**
     * Driving, arriving no later than `arriveBy`. A **forecast**.
     *
     * TomTom ignores live traffic for any future time, so this is historic and
     * predictive data: what that road usually does on that day at that hour. It
     * is the right question the night before and the wrong one at 06:40, when
     * the road either has an accident on it or does not.
     */
    async driveArrivingBy(
        origin: GeoPoint,
        destination: GeoPoint,
        arriveBy: string,
    ): Promise<RouteResult | null> {
        return this.route(origin, destination, { arriveAt: arriveBy, travelMode: 'car' });
    }

    /**
     * Driving, leaving now. The road **as it is**.
     *
     * Live traffic applies only to a departure of now, which is why this exists
     * separately rather than as a flag: the two are different questions and only
     * one of them can see the queue that formed twenty minutes ago.
     *
     * `departAt` is left off entirely rather than set to a timestamp of now. A
     * literal time, even one second in the future, is a future departure to
     * TomTom and silently drops back to predictive data, which would look
     * identical in the response and be wrong in exactly the case this is for.
     */
    async driveLeavingNow(origin: GeoPoint, destination: GeoPoint): Promise<RouteResult | null> {
        return this.route(origin, destination, { travelMode: 'car', liveTraffic: true });
    }

    /**
     * Minutes to reach a station, by whichever means the traveller uses.
     *
     * This used to be walking only, which quietly added about twenty minutes to
     * the wake-up time of anyone who cycles to their local station, in the
     * direction that makes them miss the train.
     *
     * Rounded up rather than to nearest, because this feeds a wake-up time: the
     * error that costs a train is being half a minute short, not half a minute
     * early.
     */
    async accessMinutes(
        origin: GeoPoint,
        destination: GeoPoint,
        mode: AccessMode,
    ): Promise<number | null> {
        const result = await this.route(origin, destination, {
            travelMode: mode === AccessMode.BIKE ? 'bicycle' : 'pedestrian',
        });
        return result === null ? null : Math.ceil(result.travelSeconds / 60);
    }

    private async route(
        origin: GeoPoint,
        destination: GeoPoint,
        options: {
            arriveAt?: string;
            travelMode: 'car' | 'pedestrian' | 'bicycle';
            /** Depart now, which is the only departure live traffic applies to. */
            liveTraffic?: boolean;
        },
    ): Promise<RouteResult | null> {
        const locations = `${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;
        const params = new URLSearchParams({
            key: env.transport.tomtomApiKey(),
            travelMode: options.travelMode,
            routeType: 'fastest',
        });

        if (options.arriveAt !== undefined) {
            params.set('arriveAt', options.arriveAt);
            params.set('traffic', 'true');
        } else if (options.liveTraffic === true) {
            // No departAt at all. That is what "now" means here, and it is the
            // only form that gets live conditions.
            params.set('traffic', 'true');
        } else {
            // Pedestrian and bicycle routing reject traffic-aware options, and
            // neither has road congestion to model anyway.
            params.set('traffic', 'false');
        }

        const url = `${env.transport.tomtomBaseUrl}/routing/1/calculateRoute/${locations}/json?${params.toString()}`;
        ProviderUsage.record('TOMTOM');
        const response = await fetch(url);

        if (response.status === 429) {
            throw new Error('TomTom rate limit reached');
        }
        if (!response.ok) {
            throw new Error(`TomTom routing failed: ${response.status} ${await response.text()}`);
        }

        const payload = (await response.json()) as TomTomResponse;
        const summary = payload.routes?.[0]?.summary;
        if (summary === undefined) {
            return null;
        }

        return {
            departureAt: summary.departureTime,
            arrivalAt: summary.arrivalTime,
            travelSeconds: summary.travelTimeInSeconds ?? 0,
            trafficDelaySeconds: summary.trafficDelayInSeconds ?? 0,
        };
    }
}

interface TomTomResponse {
    routes?: {
        summary?: {
            departureTime: string;
            arrivalTime: string;
            travelTimeInSeconds?: number;
            trafficDelayInSeconds?: number;
        };
    }[];
}
