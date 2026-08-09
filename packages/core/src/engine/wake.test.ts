import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { JourneyStatus, LegType, TransportMode } from '@alarm/types';
import type { BufferConfig } from '@alarm/types';
import { FixtureTransportProvider } from '../transport/fixture';
import { computeWakePlan, planWake, selectBestJourney } from './wake';

const TZ = 'Europe/Amsterdam';
const HOME = { lat: 52.09, lng: 5.11 };
const WORK = { lat: 52.37, lng: 4.89 };

const BUFFERS: BufferConfig = {
    arrivalMinutes: 3,
    preDepartureMinutes: 5,
    transferMinutes: 2,
    wakeSlackMinutes: 0,
};

/** `2026-08-10T08:30` in Amsterdam, a normal Monday, no DST edge. */
const ARRIVE_BY = DateTime.fromISO('2026-08-10T08:30:00', { zone: TZ }).toISO()!;

function localTime(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true }).setZone(TZ).toFormat('HH:mm');
}

describe('computeWakePlan', () => {
    it('walks the deadline backwards through every buffer layer', async () => {
        // Walk 7 + train 35 + walk 8 = 50 minutes door to door.
        const provider = new FixtureTransportProvider();

        const plan = await planWake(
            {
                requiredArrivalAt: ARRIVE_BY,
                mode: TransportMode.PUBLIC_TRANSPORT,
                origin: HOME,
                destination: WORK,
                routineMinutes: 35,
                buffers: BUFFERS,
                timezone: TZ,
            },
            provider,
        );

        expect(plan.feasible).toBe(true);
        expect(plan.breakdown.travelMinutes).toBe(50);
        // 08:30 − 3 arrival buffer = 08:27 target, − 50 travel = 07:37 departure.
        expect(localTime(plan.journey!.departureAt)).toBe('07:37');
        // − 4 risk (no transfers) − 5 pre-departure = 07:28 out the door.
        expect(localTime(plan.departHomeAt)).toBe('07:28');
        // − 35 routine − 0 slack = 06:53.
        expect(localTime(plan.wakeUpAt)).toBe('06:53');
        expect(plan.shortfallMinutes).toBeUndefined();
    });

    it('charges risk per transfer, because public-transport risk is discrete', async () => {
        const direct = new FixtureTransportProvider();
        const withChange = new FixtureTransportProvider({
            legs: [
                { type: LegType.WALK, minutes: 7 },
                { type: LegType.TRAIN, minutes: 20 },
                { type: LegType.TRAIN, minutes: 15 },
                { type: LegType.WALK, minutes: 8 },
            ],
        });

        const base = {
            requiredArrivalAt: ARRIVE_BY,
            mode: TransportMode.PUBLIC_TRANSPORT as const,
            origin: HOME,
            destination: WORK,
            routineMinutes: 35,
            buffers: BUFFERS,
            timezone: TZ,
        };

        const a = await planWake(base, direct);
        const b = await planWake(base, withChange);

        expect(a.breakdown.riskBufferMinutes).toBe(4);
        // One transfer adds 3 minutes; total travel time is identical.
        expect(b.breakdown.riskBufferMinutes).toBe(7);
        expect(b.breakdown.travelMinutes).toBe(a.breakdown.travelMinutes);
    });

    it('pads a disrupted journey more than a healthy one of the same length', async () => {
        const disrupted = new FixtureTransportProvider({
            legs: [
                { type: LegType.WALK, minutes: 7 },
                { type: LegType.TRAIN, minutes: 35 },
                { type: LegType.WALK, minutes: 8 },
            ],
            status: JourneyStatus.DISRUPTION,
        });

        const plan = await planWake(
            {
                requiredArrivalAt: ARRIVE_BY,
                mode: TransportMode.PUBLIC_TRANSPORT,
                origin: HOME,
                destination: WORK,
                routineMinutes: 35,
                buffers: BUFFERS,
                timezone: TZ,
            },
            disrupted,
        );

        expect(plan.breakdown.riskBufferMinutes).toBe(4 + 5);
    });

    it('reports a shortfall instead of throwing when nothing arrives on time', async () => {
        const late = new FixtureTransportProvider({
            legs: [{ type: LegType.TRAIN, minutes: 60 }],
            // Best available itinerary lands 11 minutes past the 08:27 planner target,
            // i.e. 08:38, eight minutes past the real 08:30 deadline.
            arrivalOffsetMinutes: 11,
        });

        const plan = await planWake(
            {
                requiredArrivalAt: ARRIVE_BY,
                mode: TransportMode.PUBLIC_TRANSPORT,
                origin: HOME,
                destination: WORK,
                routineMinutes: 35,
                buffers: BUFFERS,
                timezone: TZ,
            },
            late,
        );

        expect(plan.feasible).toBe(false);
        expect(plan.shortfallMinutes).toBe(8);
        // An infeasible morning still produces a usable alarm.
        expect(plan.wakeUpAt).toBeTruthy();
    });

    it('treats eating into the arrival buffer as tight, not late', () => {
        // Arrives 08:29, past the 08:27 padded target, inside the 08:30 deadline.
        const plan = computeWakePlan({
            requiredArrivalAt: ARRIVE_BY,
            mode: TransportMode.PUBLIC_TRANSPORT,
            journey: {
                id: 'j1',
                ctxRecon: 'ctx',
                status: JourneyStatus.NORMAL,
                legs: [],
                departureAt: DateTime.fromISO('2026-08-10T07:39:00', { zone: TZ }).toISO()!,
                arrivalAt: DateTime.fromISO('2026-08-10T08:29:00', { zone: TZ }).toISO()!,
                transferCount: 0,
                source: 'TEST',
                watchedStationCodes: [],
            },
            routineMinutes: 35,
            buffers: BUFFERS,
            timezone: TZ,
        });

        expect(plan.feasible).toBe(true);
        expect(plan.shortfallMinutes).toBeUndefined();
    });

    it('adds no invented risk to a travel time the user typed themselves', () => {
        const plan = computeWakePlan({
            requiredArrivalAt: ARRIVE_BY,
            mode: TransportMode.FIXED,
            journey: null,
            fixedTravelMinutes: 50,
            routineMinutes: 35,
            buffers: BUFFERS,
            timezone: TZ,
        });

        expect(plan.breakdown.riskBufferMinutes).toBe(0);
        // 08:30 − 3 − 50 − 0 − 5 − 35 = 06:57
        expect(localTime(plan.wakeUpAt)).toBe('06:57');
    });

    it('refuses to guess when FIXED mode has no duration', () => {
        expect(() =>
            computeWakePlan({
                requiredArrivalAt: ARRIVE_BY,
                mode: TransportMode.FIXED,
                journey: null,
                routineMinutes: 35,
                buffers: BUFFERS,
                timezone: TZ,
            }),
        ).toThrow(/fixedTravelMinutes/);
    });
});

describe('selectBestJourney', () => {
    const journey = (departure: string, arrival: string) => ({
        id: `${departure}-${arrival}`,
        ctxRecon: null,
        status: JourneyStatus.NORMAL,
        legs: [],
        departureAt: DateTime.fromISO(`2026-08-10T${departure}:00`, { zone: TZ }).toISO()!,
        arrivalAt: DateTime.fromISO(`2026-08-10T${arrival}:00`, { zone: TZ }).toISO()!,
        transferCount: 0,
        source: 'TEST',
        watchedStationCodes: [],
    });

    it('buys the most sleep among journeys that still arrive on time', () => {
        const best = selectBestJourney(
            [journey('07:00', '08:00'), journey('07:40', '08:25'), journey('07:20', '08:10')],
            ARRIVE_BY,
            TZ,
        );
        expect(best?.departureAt).toContain('07:40');
    });

    it('never trades punctuality for a later departure', () => {
        // The 08:00 departure leaves latest but arrives 20 minutes late.
        const best = selectBestJourney(
            [journey('07:40', '08:25'), journey('08:00', '08:50')],
            ARRIVE_BY,
            TZ,
        );
        expect(best?.departureAt).toContain('07:40');
    });

    it('falls back to the least-late option when everything misses', () => {
        const best = selectBestJourney(
            [journey('07:50', '08:45'), journey('07:45', '08:35')],
            ARRIVE_BY,
            TZ,
        );
        expect(best?.arrivalAt).toContain('08:35');
    });

    it('returns null rather than inventing a journey', () => {
        expect(selectBestJourney([], ARRIVE_BY, TZ)).toBeNull();
    });
});
