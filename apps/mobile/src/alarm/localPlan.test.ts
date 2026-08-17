import { describe, expect, it } from 'vitest';
import { AccessMode, TransportMode, Weekday } from '@alarm/types';
import type { OccurrenceResponse, Routine, Schedule } from '@alarm/types';

import { computeLocalPlans } from '@/alarm/localPlan';

/**
 * The wake time this phone works out when nobody can be asked.
 *
 * Worth testing more carefully than most of this app, because it is the only
 * code path that decides when somebody gets up without a server having checked
 * anything. It runs exactly when nothing else can be verified, on a morning when
 * being wrong means being late.
 */

const BUFFERS = {
    arrivalMinutes: 3,
    transferMinutes: 5,
    preDepartureMinutes: 5,
    wakeSlackMinutes: 0,
};

function schedule(overrides: Partial<Schedule> = {}): Schedule {
    return {
        id: 'schedule-1',
        name: 'Work mornings',
        originPlaceId: 'home',
        destinationPlaceId: 'office',
        routineId: 'routine-1',
        arrivalTime: '09:00',
        daysOfWeek: [Weekday.MONDAY, Weekday.TUESDAY, Weekday.WEDNESDAY],
        mode: TransportMode.PUBLIC_TRANSPORT,
        originAccess: AccessMode.BIKE,
        destinationAccess: AccessMode.WALK,
        journeyOffset: 0,
        buffers: BUFFERS,
        timezone: 'Europe/Amsterdam',
        active: true,
        ...overrides,
    } as Schedule;
}

function routine(): Routine {
    return {
        id: 'routine-1',
        name: 'Morning',
        steps: [
            { id: 'a', label: 'Shower', minutes: 20, order: 0, enabled: true },
            { id: 'b', label: 'Breakfast', minutes: 15, order: 1, enabled: true },
            { id: 'c', label: 'Skipped', minutes: 30, order: 2, enabled: false },
        ],
    } as Routine;
}

/** A morning the server planned once, with a 47 minute journey. */
function known(overrides: Partial<OccurrenceResponse> = {}): OccurrenceResponse {
    return {
        id: 'occurrence-1',
        scheduleId: 'schedule-1',
        date: '2026-08-10',
        plan: { breakdown: { travelMinutes: 47 } },
        ...overrides,
    } as OccurrenceResponse;
}

const MONDAY_EVENING = '2026-08-17T21:00:00.000+02:00';

describe('working out a morning with no server', () => {
    it('plans the next day the schedule runs', () => {
        const [plan] = computeLocalPlans({
            schedules: [schedule()],
            routines: [routine()],
            knownOccurrences: [known()],
            now: MONDAY_EVENING,
        });

        // Monday evening, so the next arrival is Tuesday at 09:00.
        expect(plan?.date).toBe('2026-08-18');
    });

    it('is pessimistic, since nothing has checked the journey', () => {
        const [plan] = computeLocalPlans({
            schedules: [schedule()],
            routines: [routine()],
            knownOccurrences: [known()],
            now: MONDAY_EVENING,
        });

        // 09:00 arrival, minus 3 arrival buffer, minus (47 + 10) travel,
        // minus 5 pre-departure, minus 35 of routine.
        //
        // No risk buffer, and that is what the ten minutes are for. The plan is
        // computed as FIXED, which carries none, because the risk buffers are
        // derived from a journey and there is no journey here: a mode with
        // transfers to reason about would be reasoning about transfers nobody
        // looked up. So the padding is a flat, stated amount rather than a
        // number dressed up as a calculation.
        expect(plan?.plan.breakdown.travelMinutes).toBe(57);
        expect(plan?.plan.breakdown.riskBufferMinutes).toBe(0);
        expect(plan?.plan.wakeUpAt).toBe('2026-08-18T07:20:00.000+02:00');
    });

    it('uses only the routine steps that are switched on', () => {
        const [plan] = computeLocalPlans({
            schedules: [schedule()],
            routines: [routine()],
            knownOccurrences: [known()],
            now: MONDAY_EVENING,
        });

        expect(plan?.plan.breakdown.routineMinutes).toBe(35);
    });

    it('skips today once its deadline has passed', () => {
        const [plan] = computeLocalPlans({
            schedules: [schedule()],
            routines: [routine()],
            knownOccurrences: [known()],
            // Tuesday at 09:30: today's 09:00 is gone, so this is Wednesday's.
            now: '2026-08-18T09:30:00.000+02:00',
        });

        expect(plan?.date).toBe('2026-08-19');
    });

    it('still plans today when the deadline is later on', () => {
        const [plan] = computeLocalPlans({
            schedules: [schedule()],
            routines: [routine()],
            knownOccurrences: [known()],
            now: '2026-08-18T04:00:00.000+02:00',
        });

        expect(plan?.date).toBe('2026-08-18');
    });

    it('jumps the weekend to the next day the schedule runs', () => {
        const [plan] = computeLocalPlans({
            schedules: [schedule()],
            routines: [routine()],
            knownOccurrences: [known()],
            // Friday evening, on a schedule that runs Monday to Wednesday.
            now: '2026-08-21T20:00:00.000+02:00',
        });

        expect(plan?.date).toBe('2026-08-24');
    });

    it('orders several schedules by who gets up first', () => {
        const plans = computeLocalPlans({
            schedules: [
                schedule(),
                schedule({ id: 'schedule-2', name: 'Early', arrivalTime: '07:00' }),
            ],
            routines: [routine()],
            knownOccurrences: [known(), known({ id: 'occurrence-2', scheduleId: 'schedule-2' })],
            now: MONDAY_EVENING,
        });

        expect(plans.map((plan) => plan.scheduleName)).toEqual(['Early', 'Work mornings']);
    });
});

describe('when it refuses to guess', () => {
    it('says nothing for a paused schedule', () => {
        expect(
            computeLocalPlans({
                schedules: [schedule({ active: false })],
                routines: [routine()],
                knownOccurrences: [known()],
                now: MONDAY_EVENING,
            }),
        ).toEqual([]);
    });

    it('says nothing when the routine was never cached', () => {
        // Guessing at how long somebody takes to get ready is worse than
        // admitting the alarm cannot be worked out.
        expect(
            computeLocalPlans({
                schedules: [schedule()],
                routines: [],
                knownOccurrences: [known()],
                now: MONDAY_EVENING,
            }),
        ).toEqual([]);
    });

    it('says nothing when this schedule has never been planned', () => {
        // The travel time has to come from somewhere, and a schedule the server
        // has never answered for gives no figure to pad.
        expect(
            computeLocalPlans({
                schedules: [schedule()],
                routines: [routine()],
                knownOccurrences: [known({ scheduleId: 'another-schedule' })],
                now: MONDAY_EVENING,
            }),
        ).toEqual([]);
    });

    it('takes the most recent journey when several are known', () => {
        const [plan] = computeLocalPlans({
            schedules: [schedule()],
            routines: [routine()],
            knownOccurrences: [
                known({ id: 'old', date: '2026-08-03', plan: { breakdown: { travelMinutes: 90 } } } as Partial<OccurrenceResponse>),
                known({ id: 'recent', date: '2026-08-10' }),
            ],
            now: MONDAY_EVENING,
        });

        expect(plan?.basedOn).toBe('recent');
        expect(plan?.plan.breakdown.travelMinutes).toBe(57);
    });
});
