import { APP_CONSTANTS, JourneyStatus, LegType } from '@alarm/types';
import type { Journey } from '@alarm/types';
import type { PlanRequest, TransportProvider } from '@alarm/core';

import { TomTomModule, type RouteResult } from '../modules/TomTomModule';

/**
 * Driving, expressed as a journey so the engine cannot tell the modes apart.
 *
 * A car route is one leg with no transfers, which makes this thin, but it has
 * to exist: `computeWakePlan` reads a `Journey`, and special-casing the car
 * inside the engine would mean the app and the API each need their own version
 * of that special case.
 */
export class CarJourneyService implements TransportProvider {
    readonly name = 'TOMTOM';

    /** Injectable so the switch below can be tested without calling TomTom. */
    constructor(private readonly tomtom: TomTomModule = new TomTomModule()) {}

    /**
     * Plans the drive, with the traffic model that fits how close it is.
     *
     * Far out, the only question TomTom will answer is what that road usually
     * does at that hour. Inside the departure window it can answer what the road
     * is doing, and that is a different number: predictive traffic knows the
     * Tuesday rush, it does not know the lorry that jackknifed at 06:20.
     *
     * The forecast comes first because it is the only way to learn when
     * departure actually is. If that turns out to be within the window, the
     * route is asked again as a departure of now and the live answer wins.
     * Two requests, and only ever in the last hour before leaving: TomTom's
     * limit is generous and it is not the provider whose ceiling binds.
     *
     * Arrival is recomputed from the live duration rather than kept. The whole
     * point is that the drive now takes longer or shorter than the forecast
     * said, so keeping the forecast arrival would discard the finding and leave
     * the engine computing a wake time from a journey that does not add up.
     */
    async plan(request: PlanRequest): Promise<Journey[]> {
        const forecast = await this.tomtom.driveArrivingBy(
            request.origin,
            request.destination,
            request.arriveBy,
        );
        if (forecast === null) {
            return [];
        }

        const route = (await this.liveIfImminent(request, forecast)) ?? forecast;

        return [
            {
                id: `tomtom:${route.departureAt}`,
                // No reconstruction context exists for a road route. See refresh.
                ctxRecon: null,
                status: JourneyStatus.NORMAL,
                legs: [
                    {
                        type: LegType.CAR,
                        fromName: 'Origin',
                        toName: 'Destination',
                        plannedDeparture: route.departureAt,
                        actualDeparture: route.departureAt,
                        plannedArrival: route.arrivalAt,
                        actualArrival: route.arrivalAt,
                        // Congestion cost against free flow. Not a delay against
                        // a timetable, because a road has no timetable, but it
                        // is the same quantity the user experiences as one.
                        delaySeconds: route.trafficDelaySeconds,
                        cancelled: false,
                    },
                ],
                departureAt: route.departureAt,
                arrivalAt: route.arrivalAt,
                transferCount: 0,
                source: this.name,
                // Disruptions are matched by station, so a car watches nothing.
                // Road incidents arrive through the route itself instead.
                watchedStationCodes: [],
            },
        ];
    }

    /**
     * The live answer, when the drive is close enough for one to exist.
     *
     * Returns null when it is not, and also when the live request fails or comes
     * back empty. A forecast is a worse answer than live conditions and a much
     * better one than nothing: falling back to it keeps the alarm working
     * through a TomTom outage, which is the whole reason this is a separate step
     * rather than a different set of parameters on the first request.
     */
    private async liveIfImminent(
        request: PlanRequest,
        forecast: RouteResult,
    ): Promise<RouteResult | null> {
        const now = request.now === undefined ? Date.now() : new Date(request.now).getTime();
        const minutesUntilDeparture = (new Date(forecast.departureAt).getTime() - now) / 60_000;

        if (minutesUntilDeparture > APP_CONSTANTS.RISK_BUFFER.CAR_LIVE_TRAFFIC_WINDOW_MINUTES) {
            return null;
        }

        const live = await this.tomtom
            .driveLeavingNow(request.origin, request.destination)
            .catch(() => null);
        if (live === null) {
            return null;
        }

        // Departure stays where the plan put it; only the duration is live. The
        // engine decides when to leave, and answering a question it did not ask
        // would move the whole morning by however long this request took.
        const arrivalAt = new Date(
            new Date(forecast.departureAt).getTime() + live.travelSeconds * 1000,
        ).toISOString();

        return {
            departureAt: forecast.departureAt,
            arrivalAt,
            travelSeconds: live.travelSeconds,
            trafficDelaySeconds: live.trafficDelaySeconds,
        };
    }

    /**
     * Always null, which means "plan again" rather than "no change".
     *
     * Rail has `ctxRecon`, so the same itinerary can be re-fetched and asked
     * whether it still works. A road route has no such identity: the only way
     * to know what the drive looks like now is to route it again. Returning null
     * says exactly that, and costs nothing extra, since TomTom is not the
     * provider whose rate limit binds.
     */
    refresh(): Promise<Journey | null> {
        return Promise.resolve(null);
    }
}
