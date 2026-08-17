import { describe, expect, it, vi } from 'vitest';
import { APP_CONSTANTS, AccessMode, LegType } from '@alarm/types';
import type { PlanRequest } from '@alarm/core';

import { CarJourneyService } from '../src/app/services/CarJourneyService';
import type { RouteResult, TomTomModule } from '../src/app/modules/TomTomModule';

/**
 * The traffic model switch, which is the one thing about the car that is not
 * a thin wrapper around a route.
 *
 * TomTom answers a future departure with historic and predictive data: what that
 * road usually does on a Tuesday at 07:00. Live conditions apply only to a
 * departure of now. So an alarm armed at 22:00 is running on a forecast, and it
 * has to stop doing that before the drive begins, or it will never learn about
 * the lorry that jackknifed at 06:20.
 *
 * Tested with a stub rather than against TomTom, because the interesting cases
 * are "an hour before departure" and "a TomTom outage", and neither can be
 * arranged on demand against a live API.
 */

const ORIGIN = { lat: 52.0907, lng: 5.1214 };
const DESTINATION = { lat: 52.3791, lng: 4.9003 };

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
    return {
        origin: ORIGIN,
        destination: DESTINATION,
        arriveBy: '2026-08-18T06:30:00.000Z',
        addChangeTimeMinutes: 0,
        originAccess: AccessMode.WALK,
        destinationAccess: AccessMode.WALK,
        timezone: APP_CONSTANTS.TIMEZONE,
        ...overrides,
    };
}

/** Departs 05:30, arrives 06:30: a one hour drive by the forecast. */
const FORECAST: RouteResult = {
    departureAt: '2026-08-18T05:30:00.000Z',
    arrivalAt: '2026-08-18T06:30:00.000Z',
    travelSeconds: 3600,
    trafficDelaySeconds: 300,
};

/** The same road right now: ninety minutes, half an hour of it congestion. */
const LIVE: RouteResult = {
    departureAt: '2026-08-18T05:00:00.000Z',
    arrivalAt: '2026-08-18T06:30:00.000Z',
    travelSeconds: 5400,
    trafficDelaySeconds: 1800,
};

function stubbed(options: {
    forecast?: RouteResult | null;
    live?: RouteResult | null | (() => Promise<RouteResult>);
}) {
    // `??` would turn a deliberate null back into the default, which is the
    // exact case this helper exists to arrange.
    const driveArrivingBy = vi
        .fn()
        .mockResolvedValue('forecast' in options ? options.forecast : FORECAST);
    const driveLeavingNow = vi.fn(() =>
        typeof options.live === 'function'
            ? options.live()
            : Promise.resolve(options.live === undefined ? LIVE : options.live),
    );

    const service = new CarJourneyService({
        driveArrivingBy,
        driveLeavingNow,
    } as unknown as TomTomModule);

    return { service, driveArrivingBy, driveLeavingNow };
}

describe('which traffic model a drive is planned with', () => {
    it('asks only for the forecast when departure is hours away', async () => {
        const { service, driveLeavingNow } = stubbed({});

        // Departure is 05:30, and this is the evening before.
        const [journey] = await service.plan(request({ now: '2026-08-17T22:00:00.000Z' }));

        expect(driveLeavingNow).not.toHaveBeenCalled();
        expect(journey?.arrivalAt).toBe(FORECAST.arrivalAt);
    });

    it('asks the road what it is doing once departure is inside the window', async () => {
        const { service, driveLeavingNow } = stubbed({});

        // Half an hour before leaving, so live traffic exists to be had.
        const [journey] = await service.plan(request({ now: '2026-08-18T05:00:00.000Z' }));

        expect(driveLeavingNow).toHaveBeenCalledOnce();
        // Ninety minutes from the planned departure, not the forecast hour.
        expect(journey?.arrivalAt).toBe('2026-08-18T07:00:00.000Z');
        expect(journey?.legs[0]?.delaySeconds).toBe(LIVE.trafficDelaySeconds);
    });

    it('keeps the departure the plan chose, and only takes the duration', async () => {
        const { service } = stubbed({});

        const [journey] = await service.plan(request({ now: '2026-08-18T05:00:00.000Z' }));

        // The live route left "now", 05:00. Adopting that would move the whole
        // morning by however long the request happened to take, answering a
        // question the engine never asked.
        expect(journey?.departureAt).toBe(FORECAST.departureAt);
    });

    it('treats the window edge as still a forecast', async () => {
        const { service, driveLeavingNow } = stubbed({});
        const window = APP_CONSTANTS.RISK_BUFFER.CAR_LIVE_TRAFFIC_WINDOW_MINUTES;

        // Exactly one minute outside the window, which must not switch.
        const now = new Date(
            new Date(FORECAST.departureAt).getTime() - (window + 1) * 60_000,
        ).toISOString();
        await service.plan(request({ now }));

        expect(driveLeavingNow).not.toHaveBeenCalled();
    });
});

describe('when TomTom is having a bad morning', () => {
    it('keeps the forecast when the live request fails', async () => {
        const { service } = stubbed({
            live: () => Promise.reject(new Error('TomTom rate limit reached')),
        });

        const [journey] = await service.plan(request({ now: '2026-08-18T05:00:00.000Z' }));

        // Worse than live conditions, far better than nothing. An alarm that
        // fails because the second of two optional requests failed would be a
        // worse trade than a slightly stale estimate.
        expect(journey?.arrivalAt).toBe(FORECAST.arrivalAt);
    });

    it('keeps the forecast when the live route comes back empty', async () => {
        const { service } = stubbed({ live: null });

        const [journey] = await service.plan(request({ now: '2026-08-18T05:00:00.000Z' }));

        expect(journey?.arrivalAt).toBe(FORECAST.arrivalAt);
    });

    it('plans nothing at all when even the forecast is unavailable', async () => {
        const { service, driveLeavingNow } = stubbed({ forecast: null });

        // Nothing to be imminent about, so the second request is not spent.
        expect(await service.plan(request({ now: '2026-08-18T05:00:00.000Z' }))).toEqual([]);
        expect(driveLeavingNow).not.toHaveBeenCalled();
    });
});

describe('the shape a drive is expressed in', () => {
    it('is one car leg with no transfers and nothing to watch', async () => {
        const { service } = stubbed({});

        const [journey] = await service.plan(request({ now: '2026-08-17T22:00:00.000Z' }));

        expect(journey?.legs).toHaveLength(1);
        expect(journey?.legs[0]?.type).toBe(LegType.CAR);
        expect(journey?.transferCount).toBe(0);
        // Disruptions are matched by station, and a road has none. Road trouble
        // arrives through the route itself.
        expect(journey?.watchedStationCodes).toEqual([]);
        // No reconstruction context exists for a road route, which is what makes
        // refresh a re-plan rather than a re-fetch.
        expect(journey?.ctxRecon).toBeNull();
    });

    it('re-plans rather than refreshing, because a road route has no identity', async () => {
        const { service } = stubbed({});

        expect(await service.refresh()).toBeNull();
    });
});
