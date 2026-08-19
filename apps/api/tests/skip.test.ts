import { describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, OccurrenceState, TransportMode, Weekday } from '@alarm/types';
import type { ListOccurrencesResponse, OccurrenceResponse } from '@alarm/types';

import ScheduleOccurrence from '../src/app/models/ScheduleOccurrence.entity';
import { SchedulePlanService } from '../src/app/services/SchedulePlanService';
import { asDevice, data } from './support/client';
import { seedCommute, seedOccurrence, seedSchedule } from './support/factories';

/**
 * Sitting one morning out, which is not the same as pausing a schedule.
 *
 * A toggle in a list of alarms turns the standing alarm off, every morning of
 * it. Skipping is a decision about one morning that expires by itself. The two
 * need separate controls, and the server has to keep them separate too: the app
 * re-arms every active schedule whenever Today is focused, so a skip that arming
 * does not respect lasts until the next glance at the phone.
 */
async function skippableMorning() {
    const { device, token, home, work, routine } = await seedCommute();
    const schedule = await seedSchedule(
        device,
        { origin: home, destination: work, routine },
        {
            mode: TransportMode.PUBLIC_TRANSPORT,
            // Every day, so `nextDate` always resolves and the guard is being
            // tested rather than a schedule that had no next morning anyway.
            daysOfWeek: [
                Weekday.MONDAY,
                Weekday.TUESDAY,
                Weekday.WEDNESDAY,
                Weekday.THURSDAY,
                Weekday.FRIDAY,
                Weekday.SATURDAY,
                Weekday.SUNDAY,
            ],
        },
    );

    // Dated as the morning the schedule would arm next, which is the row the
    // skip guard looks for.
    const date = new SchedulePlanService().nextDate(schedule);
    const occurrence = await seedOccurrence(schedule, { date: date ?? undefined });

    return { token, schedule, occurrence };
}

describe('skipping one morning', () => {
    it('marks the morning skipped without touching the schedule', async () => {
        const { token, schedule, occurrence } = await skippableMorning();

        const response = await asDevice(token).post(
            API_ENDPOINTS.OCCURRENCES.SKIP(occurrence.id),
            {},
        );

        expect(response.status).toBe(200);
        expect(data<OccurrenceResponse>(response).state).toBe(OccurrenceState.SKIPPED);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.SKIPPED);
        // The schedule is a standing commitment and this was one morning.
        expect(schedule.active).toBe(true);
    });

    it('stops the monitor claiming it every tick', async () => {
        // `nextCheckAt` is half of the claim query. A row left due is a row
        // picked up on every tick for a morning nobody is having.
        const { token, occurrence } = await skippableMorning();

        await asDevice(token).post(API_ENDPOINTS.OCCURRENCES.SKIP(occurrence.id), {});

        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.nextCheckAt).toBeNull();
    });

    it('survives the app re-arming, which is what would undo it', async () => {
        /*
         * The bug this guard exists for. Today re-arms every active schedule on
         * focus, and arming sets the state to ARMED on whatever row it finds for
         * that date, so opening the app would have quietly cancelled the skip.
         */
        const { token, schedule, occurrence } = await skippableMorning();
        await asDevice(token).post(API_ENDPOINTS.OCCURRENCES.SKIP(occurrence.id), {});

        const response = await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});

        expect(response.status).toBe(200);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.SKIPPED);
    });

    it('costs no provider call to re-arm, because there is nothing to plan', async () => {
        // Arming a morning nobody is travelling on would spend an NS request to
        // work out a journey and then throw the answer away.
        const { token, schedule, occurrence } = await skippableMorning();
        await asDevice(token).post(API_ENDPOINTS.OCCURRENCES.SKIP(occurrence.id), {});
        const planner = vi.spyOn(SchedulePlanService.prototype, 'forSchedule');

        await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});

        expect(planner).not.toHaveBeenCalled();
    });

    it('still appears in the list, so it can be shown as skipped', async () => {
        // Dropping it would make the morning vanish, which reads as a deleted
        // schedule rather than one sat out for a day.
        const { token, occurrence } = await skippableMorning();
        await asDevice(token).post(API_ENDPOINTS.OCCURRENCES.SKIP(occurrence.id), {});

        const response = await asDevice(token).get(API_ENDPOINTS.OCCURRENCES.LIST);

        const listed = data<ListOccurrencesResponse>(response);
        expect(listed.map((each) => each.id)).toContain(occurrence.id);
    });

    it('can be put back, and is looked at straight away', async () => {
        const { token, occurrence } = await skippableMorning();
        await asDevice(token).post(API_ENDPOINTS.OCCURRENCES.SKIP(occurrence.id), {});

        const response = await asDevice(token).post(
            API_ENDPOINTS.OCCURRENCES.UNSKIP(occurrence.id),
            {},
        );

        expect(response.status).toBe(200);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.ARMED);
        expect(after?.nextCheckAt).not.toBeNull();
    });

    it('cannot be aimed at a morning owned by another device', async () => {
        const { occurrence } = await skippableMorning();
        const { token: other } = await seedCommute();

        const response = await asDevice(other).post(
            API_ENDPOINTS.OCCURRENCES.SKIP(occurrence.id),
            {},
        );

        expect(response.status).toBe(404);
    });
});
