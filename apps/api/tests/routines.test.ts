import { describe, expect, it } from 'vitest';
import { API_ENDPOINTS } from '@alarm/types';
import type { RoutineResponse } from '@alarm/types';
import { routineDurationMinutes } from '@alarm/core';

import RoutineStep from '../src/app/models/RoutineStep.entity';
import { asDevice, data, error } from './support/client';
import { seedCommute, seedDevice, seedRoutine, seedSchedule } from './support/factories';

describe('creating routines', () => {
    it('takes the order from the array, not from the payload', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(API_ENDPOINTS.ROUTINES.CREATE, {
            name: 'Weekday',
            steps: [
                { label: 'Shower', minutes: 10, enabled: true },
                { label: 'Breakfast', minutes: 15, enabled: true },
            ],
        });

        expect(response.status).toBe(201);
        const routine = data<RoutineResponse>(response);
        expect(routine.steps.map((step) => step.label)).toEqual(['Shower', 'Breakfast']);
        expect(routine.steps.map((step) => step.order)).toEqual([0, 1]);
    });

    it('keeps disabled steps and leaves them out of the total', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(API_ENDPOINTS.ROUTINES.CREATE, {
            name: 'Weekday',
            steps: [
                { label: 'Shower', minutes: 10, enabled: true },
                { label: 'Breakfast', minutes: 15, enabled: true },
                { label: 'Gym', minutes: 45, enabled: false },
            ],
        });

        const routine = data<RoutineResponse>(response);
        // "I'll skip breakfast today" is a toggle, not a reason to lose the step
        // and have to retype it tomorrow.
        expect(routine.steps).toHaveLength(3);
        expect(routineDurationMinutes(routine)).toBe(25);
    });

    it('accepts a zero-minute step', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(API_ENDPOINTS.ROUTINES.CREATE, {
            name: 'Weekday',
            steps: [{ label: 'Take medication', minutes: 0, enabled: true }],
        });

        // A checklist item that takes no time is real. Forbidding it would push
        // the user into inventing a minute that then moves their alarm.
        expect(response.status).toBe(201);
    });

    it('rejects a routine with no steps', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(API_ENDPOINTS.ROUTINES.CREATE, {
            name: 'Empty',
            steps: [],
        });

        expect(response.status).toBe(422);
    });
});

describe('updating routines', () => {
    it('replaces the steps entirely and leaves the name alone', async () => {
        const { device, token } = await seedDevice();
        const routine = await seedRoutine(device);

        const response = await asDevice(token).patch(API_ENDPOINTS.ROUTINES.DETAIL(routine.id), {
            steps: [{ label: 'Shower', minutes: 12, enabled: true }],
        });

        const updated = data<RoutineResponse>(response);
        expect(updated.steps).toHaveLength(1);
        expect(updated.name).toBe('Weekday');
        // Replaced, not merged. The old rows are gone rather than orphaned.
        expect(await RoutineStep.countBy({ routineId: routine.id })).toBe(1);
    });

    it('leaves the steps alone when only the name is sent', async () => {
        const { device, token } = await seedDevice();
        const routine = await seedRoutine(device);

        const response = await asDevice(token).patch(API_ENDPOINTS.ROUTINES.DETAIL(routine.id), {
            name: 'Weekend',
        });

        const updated = data<RoutineResponse>(response);
        expect(updated.name).toBe('Weekend');
        expect(updated.steps).toHaveLength(3);
    });

    it('reorders by position when the list is sent in a new order', async () => {
        const { device, token } = await seedDevice();
        const routine = await seedRoutine(device);

        const response = await asDevice(token).patch(API_ENDPOINTS.ROUTINES.DETAIL(routine.id), {
            steps: [
                { label: 'Breakfast', minutes: 15, enabled: true },
                { label: 'Shower', minutes: 10, enabled: true },
            ],
        });

        expect(data<RoutineResponse>(response).steps.map((step) => step.label)).toEqual([
            'Breakfast',
            'Shower',
        ]);
    });
});

describe('routine ownership and deletion', () => {
    it('answers 404 for another device routine', async () => {
        const { device: owner } = await seedDevice();
        const theirs = await seedRoutine(owner);
        const { token: intruder } = await seedDevice();

        const response = await asDevice(intruder).get(API_ENDPOINTS.ROUTINES.DETAIL(theirs.id));

        expect(response.status).toBe(404);
    });

    it('deletes a routine nothing points at', async () => {
        const { device, token } = await seedDevice();
        const routine = await seedRoutine(device);

        const response = await asDevice(token).delete(API_ENDPOINTS.ROUTINES.DETAIL(routine.id));

        expect(response.status).toBe(204);
    });

    it('refuses with 409 while a schedule still uses it', async () => {
        const { device, token, home, work, routine } = await seedCommute();
        await seedSchedule(
            device,
            { origin: home, destination: work, routine },
            { name: 'Work mornings' },
        );

        const response = await asDevice(token).delete(API_ENDPOINTS.ROUTINES.DETAIL(routine.id));

        expect(response.status).toBe(409);
        expect(error(response).message).toContain('Work mornings');
    });
});
