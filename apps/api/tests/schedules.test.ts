import { describe, expect, it } from 'vitest';
import { API_ENDPOINTS, DEFAULT_BUFFERS, TransportMode, Weekday } from '@alarm/types';
import type { ScheduleResponse } from '@alarm/types';

import Schedule from '../src/app/models/Schedule.entity';
import { asDevice, data } from './support/client';
import { seedCommute, seedDevice, seedPlace, seedRoutine, seedSchedule } from './support/factories';

/** A valid body, so each test can change only the field it is about. */
function body(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        name: 'Work mornings',
        arrivalTime: '08:30',
        daysOfWeek: [Weekday.MONDAY, Weekday.TUESDAY],
        mode: TransportMode.PUBLIC_TRANSPORT,
        buffers: DEFAULT_BUFFERS,
        timezone: 'Europe/Amsterdam',
        ...overrides,
    };
}

describe('creating schedules', () => {
    it('round-trips the arrival time as HH:mm', async () => {
        const { token, home, work, routine } = await seedCommute();

        const response = await asDevice(token).post(
            API_ENDPOINTS.SCHEDULES.CREATE,
            body({
                originPlaceId: home.id,
                destinationPlaceId: work.id,
                routineId: routine.id,
            }),
        );

        expect(response.status).toBe(201);
        // MySQL stores TIME and hands it back as 08:30:00. The domain type is
        // wall-clock HH:mm, and the difference reaches the UI if it is not
        // trimmed on the way out.
        expect(data<ScheduleResponse>(response).arrivalTime).toBe('08:30');
    });

    it('rejects a duplicated day', async () => {
        const { token, home, work, routine } = await seedCommute();

        const response = await asDevice(token).post(
            API_ENDPOINTS.SCHEDULES.CREATE,
            body({
                originPlaceId: home.id,
                destinationPlaceId: work.id,
                routineId: routine.id,
                daysOfWeek: [Weekday.MONDAY, Weekday.MONDAY],
            }),
        );

        // The same day twice would arm two occurrences for one morning and ring
        // twice.
        expect(response.status).toBe(422);
    });

    it('rejects an origin equal to the destination', async () => {
        const { token, home, routine } = await seedCommute();

        const response = await asDevice(token).post(
            API_ENDPOINTS.SCHEDULES.CREATE,
            body({
                originPlaceId: home.id,
                destinationPlaceId: home.id,
                routineId: routine.id,
            }),
        );

        expect(response.status).toBe(422);
    });

    it('rejects FIXED mode without a travel duration', async () => {
        const { token, home, work, routine } = await seedCommute();

        const response = await asDevice(token).post(
            API_ENDPOINTS.SCHEDULES.CREATE,
            body({
                originPlaceId: home.id,
                destinationPlaceId: work.id,
                routineId: routine.id,
                mode: TransportMode.FIXED,
            }),
        );

        // FIXED asks no provider, so without this number there is no travel
        // time at all and no wake time can be computed.
        expect(response.status).toBe(422);
    });

    it('rejects an arrival time that is not HH:mm', async () => {
        const { token, home, work, routine } = await seedCommute();

        const response = await asDevice(token).post(
            API_ENDPOINTS.SCHEDULES.CREATE,
            body({
                originPlaceId: home.id,
                destinationPlaceId: work.id,
                routineId: routine.id,
                arrivalTime: '8:30 in the morning',
            }),
        );

        expect(response.status).toBe(422);
    });
});

describe('cross-resource ownership', () => {
    it("refuses a place belonging to another device", async () => {
        const { device: owner } = await seedDevice();
        const theirHome = await seedPlace(owner, { label: 'Their home' });

        const { token, work, routine } = await seedCommute();

        const response = await asDevice(token).post(
            API_ENDPOINTS.SCHEDULES.CREATE,
            body({
                originPlaceId: theirHome.id,
                destinationPlaceId: work.id,
                routineId: routine.id,
            }),
        );

        // The security boundary of the resource. The foreign key accepts any
        // valid id, so without this check a device could point a schedule at
        // another device's place and read back where that person lives through
        // the plan preview.
        expect(response.status).toBe(404);
        expect(await Schedule.count()).toBe(0);
    });

    it('refuses a routine belonging to another device', async () => {
        const { device: owner } = await seedDevice();
        const theirRoutine = await seedRoutine(owner);

        const { token, home, work } = await seedCommute();

        const response = await asDevice(token).post(
            API_ENDPOINTS.SCHEDULES.CREATE,
            body({
                originPlaceId: home.id,
                destinationPlaceId: work.id,
                routineId: theirRoutine.id,
            }),
        );

        expect(response.status).toBe(404);
    });

    it('refuses to repoint an existing schedule at another device place', async () => {
        const { device, token, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, {
            origin: home,
            destination: work,
            routine,
        });

        const { device: owner } = await seedDevice();
        const theirs = await seedPlace(owner);

        const response = await asDevice(token).patch(
            API_ENDPOINTS.SCHEDULES.DETAIL(schedule.id),
            { originPlaceId: theirs.id },
        );

        expect(response.status).toBe(404);
        expect((await Schedule.findOneBy({ id: schedule.id }))?.originPlaceId).toBe(home.id);
    });
});

describe('updating schedules', () => {
    it('pauses without losing the setup', async () => {
        const { device, token, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, {
            origin: home,
            destination: work,
            routine,
        });

        const response = await asDevice(token).patch(
            API_ENDPOINTS.SCHEDULES.DETAIL(schedule.id),
            { active: false },
        );

        // Paused rather than deleted, so a holiday does not lose the schedule.
        expect(data<ScheduleResponse>(response).active).toBe(false);
        expect(data<ScheduleResponse>(response).name).toBe('Work mornings');
    });

    it('refuses a switch to FIXED with no duration already stored', async () => {
        const { device, token, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, {
            origin: home,
            destination: work,
            routine,
        });

        const response = await asDevice(token).patch(
            API_ENDPOINTS.SCHEDULES.DETAIL(schedule.id),
            { mode: TransportMode.FIXED },
        );

        // Only visible once the payload and the stored row are merged, which is
        // why this check cannot live in the schema.
        expect(response.status).toBe(422);
        expect((await Schedule.findOneBy({ id: schedule.id }))?.mode).toBe(
            TransportMode.PUBLIC_TRANSPORT,
        );
    });

    it('accepts a switch to FIXED when the duration comes with it', async () => {
        const { device, token, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, {
            origin: home,
            destination: work,
            routine,
        });

        const response = await asDevice(token).patch(
            API_ENDPOINTS.SCHEDULES.DETAIL(schedule.id),
            { mode: TransportMode.FIXED, fixedTravelMinutes: 40 },
        );

        expect(response.status).toBe(200);
        expect(data<ScheduleResponse>(response).fixedTravelMinutes).toBe(40);
    });

    it('keeps the buffers as sent', async () => {
        const { device, token, home, work, routine } = await seedCommute();
        const schedule = await seedSchedule(device, {
            origin: home,
            destination: work,
            routine,
        });

        const response = await asDevice(token).patch(
            API_ENDPOINTS.SCHEDULES.DETAIL(schedule.id),
            { buffers: { ...DEFAULT_BUFFERS, wakeSlackMinutes: 10 } },
        );

        // Stored as JSON, so a driver that mangles the column shows up here
        // rather than in a wake time that is ten minutes out.
        expect(data<ScheduleResponse>(response).buffers.wakeSlackMinutes).toBe(10);
        expect(data<ScheduleResponse>(response).buffers.arrivalMinutes).toBe(
            DEFAULT_BUFFERS.arrivalMinutes,
        );
    });
});
