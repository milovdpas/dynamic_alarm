import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { API_ENDPOINTS, DEFAULT_BUFFERS, LegType, TransportMode } from '@alarm/types';
import type { PlanPreviewResponse } from '@alarm/types';

import { TransportProviderFactory } from '../src/app/services/TransportProviderFactory';
import { api, asDevice, data } from './support/client';
import { AMSTERDAM_ZUID, UTRECHT, seedDevice } from './support/factories';
import { fixtureProvider } from './support/transport';

/** The default fixture: 7 minutes walking, 35 on a train, 8 more walking. */
const DEFAULT_TRAVEL_MINUTES = 50;

function preview(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        origin: UTRECHT,
        destination: AMSTERDAM_ZUID,
        arrivalTime: '08:30',
        mode: TransportMode.PUBLIC_TRANSPORT,
        routineMinutes: 25,
        buffers: DEFAULT_BUFFERS,
        timezone: 'Europe/Amsterdam',
        ...overrides,
    };
}

/** Local wall-clock time of an instant, which is what the user actually sees. */
function clock(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true })
        .setZone('Europe/Amsterdam')
        .toFormat('HH:mm');
}

/**
 * No test calls NS or TomTom.
 *
 * A suite that depends on a live timetable fails when a train is late, which is
 * both untrue and unfixable, and it spends a budget of 300 requests per 5
 * minutes that the whole deployment shares. Spying on the factory swaps in the
 * deterministic fixture without the production code knowing it is under test.
 */
beforeEach(() => {
    vi.spyOn(TransportProviderFactory, 'forMode').mockImplementation((mode) =>
        mode === TransportMode.FIXED ? null : fixtureProvider,
    );

    fixtureProvider.setScenario({
        legs: [
            { type: LegType.WALK, minutes: 7, fromName: 'Home', toName: 'Station' },
            { type: LegType.TRAIN, minutes: 35, fromName: 'Station', toName: 'Station' },
            { type: LegType.WALK, minutes: 8, fromName: 'Station', toName: 'Work' },
        ],
    });
});

describe('fixed mode', () => {
    it('attaches no journey and works backwards from the deadline', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(
            API_ENDPOINTS.PLAN.PREVIEW,
            preview({
                mode: TransportMode.FIXED,
                fixedTravelMinutes: 40,
                date: '2026-09-16',
                routineMinutes: 25,
            }),
        );

        const plan = data<PlanPreviewResponse>(response);
        expect(plan.journey).toBeNull();

        // 08:30 deadline, minus 3 arrival, 40 travel, 5 pre-departure, 25
        // routine. The risk buffer is 0: the user typed the travel time
        // themselves, and inventing risk on top of it would be second-guessing
        // an input there is no basis to doubt.
        expect(clock(plan.breakdown.requiredArrivalAt)).toBe('08:30');
        expect(plan.breakdown.travelMinutes).toBe(40);
        expect(plan.breakdown.riskBufferMinutes).toBe(0);
        expect(clock(plan.departHomeAt)).toBe('07:42');
        expect(clock(plan.wakeUpAt)).toBe('07:17');
    });

    it('rejects fixed mode with no duration', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(
            API_ENDPOINTS.PLAN.PREVIEW,
            preview({ mode: TransportMode.FIXED }),
        );

        expect(response.status).toBe(422);
    });
});

describe('public transport', () => {
    it('returns a journey and a wake time derived from it', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(
            API_ENDPOINTS.PLAN.PREVIEW,
            preview({ date: '2026-09-16' }),
        );

        const plan = data<PlanPreviewResponse>(response);
        expect(plan.feasible).toBe(true);
        expect(plan.journey?.legs.map((leg) => leg.type)).toEqual([
            LegType.WALK,
            LegType.TRAIN,
            LegType.WALK,
        ]);
        expect(plan.breakdown.travelMinutes).toBe(DEFAULT_TRAVEL_MINUTES);
    });

    it('does not subtract the transfer buffer, having handed it to the planner', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(
            API_ENDPOINTS.PLAN.PREVIEW,
            preview({
                date: '2026-09-16',
                buffers: { ...DEFAULT_BUFFERS, transferMinutes: 30 },
            }),
        );

        const plan = data<PlanPreviewResponse>(response);
        // A tight connection is refused at plan time by NS `addChangeTime`, so
        // subtracting it again here would double-count it and cost half an hour
        // of sleep for nothing.
        expect(plan.breakdown.travelMinutes).toBe(DEFAULT_TRAVEL_MINUTES);
    });

    it('wakes earlier when the routine is longer, minute for minute', async () => {
        const { token } = await seedDevice();
        const shared = { date: '2026-09-16' };

        const short = data<PlanPreviewResponse>(
            await asDevice(token).post(
                API_ENDPOINTS.PLAN.PREVIEW,
                preview({ ...shared, routineMinutes: 25 }),
            ),
        );
        const long = data<PlanPreviewResponse>(
            await asDevice(token).post(
                API_ENDPOINTS.PLAN.PREVIEW,
                preview({ ...shared, routineMinutes: 45 }),
            ),
        );

        const difference = DateTime.fromISO(short.wakeUpAt).diff(
            DateTime.fromISO(long.wakeUpAt),
            'minutes',
        ).minutes;
        expect(difference).toBe(20);
    });

    it('reports infeasible without refusing to answer', async () => {
        const { token } = await seedDevice();
        fixtureProvider.setScenario({
            legs: [{ type: LegType.TRAIN, minutes: 40, fromName: 'A', toName: 'B' }],
            // The best available journey arrives 11 minutes after the deadline.
            arrivalOffsetMinutes: 11,
        });

        const response = await asDevice(token).post(
            API_ENDPOINTS.PLAN.PREVIEW,
            preview({ date: '2026-09-16' }),
        );

        // Still a 200. "The earliest you can arrive is 08:41" is an answer, and
        // the user needs an alarm either way.
        expect(response.status).toBe(200);
        const plan = data<PlanPreviewResponse>(response);
        expect(plan.feasible).toBe(false);
        expect(plan.shortfallMinutes).toBeGreaterThan(0);
        expect(plan.wakeUpAt).toEqual(expect.any(String));
    });
});

describe('resolving the deadline', () => {
    it('uses the named date when one is given', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(
            API_ENDPOINTS.PLAN.PREVIEW,
            preview({ date: '2026-09-16' }),
        );

        const plan = data<PlanPreviewResponse>(response);
        expect(plan.breakdown.requiredArrivalAt.startsWith('2026-09-16')).toBe(true);
    });

    it('resolves a deadline in the future when no date is given', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(API_ENDPOINTS.PLAN.PREVIEW, preview());

        const plan = data<PlanPreviewResponse>(response);
        // Today if 08:30 has not passed, otherwise tomorrow. Previewing an
        // alarm for a deadline already gone is never what someone typing an
        // arrival time is asking for.
        expect(DateTime.fromISO(plan.breakdown.requiredArrivalAt).toMillis()).toBeGreaterThan(
            Date.now(),
        );
    });

    it('rejects a malformed date', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(
            API_ENDPOINTS.PLAN.PREVIEW,
            preview({ date: '16-09-2026' }),
        );

        expect(response.status).toBe(422);
    });
});

describe('access', () => {
    it('requires a device token', async () => {
        const response = await api.post(API_ENDPOINTS.PLAN.PREVIEW).send(preview());

        expect(response.status).toBe(401);
    });
});
