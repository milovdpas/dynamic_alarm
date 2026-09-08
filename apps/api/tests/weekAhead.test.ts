import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, APP_CONSTANTS, OccurrenceState, TransportMode, Weekday } from '@alarm/types';
import type { Journey, ListOccurrencesResponse, OccurrenceResponse } from '@alarm/types';
import type { PlanRequest, RefreshResult, TransportProvider } from '@alarm/core';

import ScheduleOccurrence from '../src/app/models/ScheduleOccurrence.entity';
import { DisruptionSweepService } from '../src/app/services/DisruptionSweepService';
import { MonitorService } from '../src/app/services/MonitorService';
import { OccurrenceService } from '../src/app/services/OccurrenceService';
import { SchedulePlanService } from '../src/app/services/SchedulePlanService';
import { TransportProviderFactory } from '../src/app/services/TransportProviderFactory';
import { asDevice, data } from './support/client';
import { plannedWorks, StubNsModule } from './support/disruptions';
import { seedCommute, seedOccurrence, seedSchedule } from './support/factories';
import { fixtureProvider } from './support/transport';

/**
 * A schedule has a week of mornings, not one.
 *
 * It had one, planned about eight hours ahead, so Thursday did not exist on
 * Tuesday: nothing could notice works announced for it, nothing could be skipped
 * on it, and a calendar had nothing to show. Every matching day in the coming
 * week gets a row now, `PENDING` until its window opens, and looked at once a
 * day until then.
 */
const EVERY_DAY = [
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
    Weekday.SATURDAY,
    Weekday.SUNDAY,
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(() => {
    vi.spyOn(TransportProviderFactory, 'forMode').mockReturnValue(fixtureProvider);
});

afterEach(() => {
    vi.restoreAllMocks();
});

async function weeklySchedule() {
    const { device, token, home, work, routine } = await seedCommute();
    const schedule = await seedSchedule(
        device,
        { origin: home, destination: work, routine },
        { mode: TransportMode.PUBLIC_TRANSPORT, daysOfWeek: EVERY_DAY },
    );
    return { token, schedule };
}

async function rowsFor(scheduleId: string): Promise<ScheduleOccurrence[]> {
    return ScheduleOccurrence.find({ where: { scheduleId }, order: { date: 'ASC' } });
}

describe('planning the week ahead', () => {
    it('gives every matching morning in the coming week a row and a plan', async () => {
        const { token, schedule } = await weeklySchedule();

        const response = await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});

        expect(response.status).toBe(200);
        const rows = await rowsFor(schedule.id);
        // Seven days ahead, plus today when its arrival is still to come.
        expect(rows.length).toBeGreaterThanOrEqual(7);
        expect(rows.length).toBeLessThanOrEqual(8);
        for (const row of rows) {
            expect(row.planSnapshot).not.toBeNull();
            expect([OccurrenceState.ARMED, OccurrenceState.PENDING]).toContain(row.state);
        }
    });

    it('returns the soonest, which is what the endpoint always meant', async () => {
        const { token, schedule } = await weeklySchedule();

        const response = await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});

        const [soonest] = await rowsFor(schedule.id);
        expect(data<OccurrenceResponse>(response).id).toBe(soonest?.id);
    });

    it('is pending beyond the window and armed inside it', async () => {
        // The two differ only in cadence, and this is the line between them.
        const { token, schedule } = await weeklySchedule();
        const before = Date.now();

        await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});

        for (const row of await rowsFor(schedule.id)) {
            const minutesUntilWake = ((row.currentWakeAt?.getTime() ?? 0) - before) / 60_000;
            const expected =
                minutesUntilWake > APP_CONSTANTS.MONITOR.ARM_LEAD_MINUTES
                    ? OccurrenceState.PENDING
                    : OccurrenceState.ARMED;
            expect(row.state).toBe(expected);
        }
    });

    it('plans the soonest every time and a later morning only once', async () => {
        /*
         * The cost rule. Arming is also the refresh path, so the morning on
         * screen is planned again on every call; the rest of the week is not,
         * because spending six provider calls to arrive at six identical answers
         * is precisely the bill this is built to avoid.
         */
        const { token, schedule } = await weeklySchedule();
        await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});
        const planner = vi.spyOn(SchedulePlanService.prototype, 'forDate');

        await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});

        const [soonest] = await rowsFor(schedule.id);
        expect(planner.mock.calls.map(([, date]) => date)).toEqual([soonest?.date]);
    });

    it('fills in a morning that has gone missing without touching the others', async () => {
        const { token, schedule } = await weeklySchedule();
        await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});
        const rows = await rowsFor(schedule.id);
        const missing = rows[3];
        if (missing === undefined) {
            throw new Error('Expected a week of rows.');
        }
        await ScheduleOccurrence.delete({ id: missing.id });
        const planner = vi.spyOn(SchedulePlanService.prototype, 'forDate');

        await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});

        const planned = planner.mock.calls.map(([, date]) => date).sort();
        expect(planned).toEqual([rows[0]?.date, missing.date].sort());
    });

    it('rolls the horizon forward a day at a time, without re-planning the soonest', async () => {
        /*
         * Only arm creates rows, and the phone arms only when it has nothing
         * listed. Without a top-up the week shrank a day at a time and refilled
         * only after the last morning had passed: by Thursday nothing existed
         * for next Tuesday, the very morning the horizon was added for.
         */
        const { token, schedule } = await weeklySchedule();
        await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});
        const before = await rowsFor(schedule.id);
        const planner = vi.spyOn(SchedulePlanService.prototype, 'forDate');

        const planned = await new OccurrenceService().topUpWeek(new Date(Date.now() + DAY));

        const after = await rowsFor(schedule.id);
        expect(planned).toBe(1);
        expect(after.length).toBe(before.length + 1);
        // Exactly one planning call, for the new day. Re-planning the soonest
        // is the refresh path's business, not the tick's, and a looser check
        // here ("did not plan yesterday's soonest") let a mutation that did
        // re-plan the soonest pass, because the clock had moved on a day.
        expect(planner.mock.calls.map(([, date]) => date)).toEqual([after[after.length - 1]?.date]);
    });

    it('lists the whole week to the phone', async () => {
        // The phone arms everything it is told about, which is what makes a
        // dead server harmless: the week still rings at pessimistic times.
        const { token, schedule } = await weeklySchedule();
        await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});

        const listed = await asDevice(token).get(API_ENDPOINTS.OCCURRENCES.LIST);

        const rows = await rowsFor(schedule.id);
        expect(data<ListOccurrencesResponse>(listed)).toHaveLength(rows.length);
    });
});

/** A provider that hands back the stored journey, unchanged. */
class UnchangedProvider implements TransportProvider {
    readonly name = 'STUB';

    constructor(private readonly journey: Journey) {}

    plan(request: PlanRequest): Promise<Journey[]> {
        return fixtureProvider.plan(request);
    }

    refresh(): Promise<RefreshResult> {
        return Promise.resolve({ status: 'CURRENT', journey: this.journey });
    }
}

/** A tick that asks NS nothing. */
function monitor(feed: unknown[] = []): MonitorService {
    return new MonitorService(new DisruptionSweepService(new StubNsModule(feed)));
}

/** A pending morning, `hoursAhead` from now, with a plan to match. */
async function pendingMorning(hoursAhead: number) {
    const { device, home, work, routine } = await seedCommute();
    const schedule = await seedSchedule(
        device,
        { origin: home, destination: work, routine },
        { mode: TransportMode.PUBLIC_TRANSPORT, daysOfWeek: EVERY_DAY },
    );
    const wakeAt = new Date(Date.now() + hoursAhead * HOUR);
    const occurrence = await seedOccurrence(schedule, {
        state: OccurrenceState.PENDING,
        anchorWakeAt: wakeAt,
        currentWakeAt: wakeAt,
        // Far in the future: the tests below decide whether it is pulled in.
        nextCheckAt: new Date(Date.now() + 5 * DAY),
    });
    const plan = occurrence.planSnapshot;
    if (plan === null) {
        throw new Error('The factory is meant to seed a plan.');
    }
    await ScheduleOccurrence.update(occurrence.id, {
        planSnapshot: { ...plan, wakeUpAt: wakeAt.toISOString() },
    });
    return { schedule, occurrence, wakeAt, journey: plan.journey };
}

describe('a pending morning', () => {
    it('is looked at once a day until its window opens', async () => {
        const { occurrence, wakeAt } = await pendingMorning(3 * 24);
        const plan = occurrence.planSnapshot;
        if (plan === null) {
            throw new Error('The factory is meant to seed a plan.');
        }
        const now = new Date();

        const next = new OccurrenceService().nextCheck(
            { ...plan, wakeUpAt: wakeAt.toISOString() },
            'Europe/Amsterdam',
            now,
        );

        const daily = now.getTime() + APP_CONSTANTS.MONITOR.FAR_CHECK_INTERVAL_MINUTES * 60_000;
        expect(Math.abs((next?.getTime() ?? 0) - daily)).toBeLessThan(60_000);
    });

    it('lands its last far check exactly on the arming moment', async () => {
        // Twenty hours out: the daily step would overshoot the window, so the
        // check lands on the moment the window opens instead.
        const { occurrence, wakeAt } = await pendingMorning(20);
        const plan = occurrence.planSnapshot;
        if (plan === null) {
            throw new Error('The factory is meant to seed a plan.');
        }

        const next = new OccurrenceService().nextCheck(
            { ...plan, wakeUpAt: wakeAt.toISOString() },
            'Europe/Amsterdam',
            new Date(),
        );

        const armsAt = wakeAt.getTime() - APP_CONSTANTS.MONITOR.ARM_LEAD_MINUTES * 60_000;
        expect(Math.abs((next?.getTime() ?? 0) - armsAt)).toBeLessThan(60_000);
    });

    it('is claimed when due and becomes armed inside the window', async () => {
        const { occurrence, journey } = await pendingMorning(1);
        if (journey === null) {
            throw new Error('The factory is meant to seed a journey.');
        }
        await ScheduleOccurrence.update(occurrence.id, { nextCheckAt: new Date(Date.now() - 60_000) });
        vi.spyOn(TransportProviderFactory, 'forMode').mockReturnValue(new UnchangedProvider(journey));

        const result = await monitor().tick();

        expect(result.claimed).toBe(1);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.ARMED);
    });
});

describe('announced works', () => {
    it('promote a pending morning whose date they cover', async () => {
        /*
         * The reason the week exists. Works for Thursday are published days
         * ahead with the window they apply to; the sweep used to ask NS only for
         * what was active, so it could not see them until Thursday.
         */
        const { occurrence, wakeAt } = await pendingMorning(3 * 24);
        const now = new Date();
        const feed = [
            plannedWorks(
                ['UT'],
                now,
                new Date(wakeAt.getTime() - 6 * HOUR),
                new Date(wakeAt.getTime() + 6 * HOUR),
            ),
        ];

        const result = await new DisruptionSweepService(new StubNsModule(feed)).sweep(now);

        expect(result.promoted).toBe(1);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.nextCheckAt?.getTime()).toBeLessThanOrEqual(now.getTime());
    });

    it('leave a morning alone when the works are for another week', async () => {
        // Otherwise works next month promote every morning this week, one extra
        // provider call each, every single day.
        const { occurrence, wakeAt } = await pendingMorning(3 * 24);
        const now = new Date();
        const feed = [
            plannedWorks(
                ['UT'],
                now,
                new Date(wakeAt.getTime() + 10 * DAY),
                new Date(wakeAt.getTime() + 11 * DAY),
            ),
        ];

        const result = await new DisruptionSweepService(new StubNsModule(feed)).sweep(now);

        expect(result.promoted).toBe(0);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.nextCheckAt?.getTime()).toBeGreaterThan(now.getTime());
    });
});
