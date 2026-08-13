import { JourneyStatus, LegType } from '@alarm/types';
import type { Journey } from '@alarm/types';
import type { PlanRequest, TransportProvider } from '@alarm/core';

import { TomTomModule } from '../modules/TomTomModule';

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

    private readonly tomtom = new TomTomModule();

    async plan(request: PlanRequest): Promise<Journey[]> {
        const route = await this.tomtom.driveArrivingBy(
            request.origin,
            request.destination,
            request.arriveBy,
        );
        if (route === null) {
            return [];
        }

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
