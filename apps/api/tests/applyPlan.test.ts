import { describe, expect, it } from 'vitest';
import { API_ENDPOINTS, AlarmEventType, TransportMode, WakeChangeReason } from '@alarm/types';
import type { OccurrenceResponse } from '@alarm/types';

import AlarmEvent from '../src/app/models/AlarmEvent.entity';
import ScheduleOccurrence from '../src/app/models/ScheduleOccurrence.entity';
import { asDevice, data } from './support/client';
import { seedCommute, seedOccurrence, seedSchedule } from './support/factories';

/**
 * Moving the alarm by hand, which is the other half of the opt-in switches.
 *
 * With them off a delay that would buy twelve minutes in bed is noticed,
 * explained on screen, and then deliberately not acted on. That is the right
 * default for somebody asleep and the wrong answer for somebody awake looking at
 * the sentence describing it, so there has to be a way to say go on.
 */
async function morning(currentWakeAt: Date, plannedWakeAt: Date) {
    const { device, token, home, work, routine } = await seedCommute();
    const schedule = await seedSchedule(
        device,
        { origin: home, destination: work, routine },
        { mode: TransportMode.PUBLIC_TRANSPORT },
    );
    const occurrence = await seedOccurrence(schedule, { currentWakeAt });

    // The stored plan is what the button applies, so it is the only thing that
    // has to differ from where the alarm currently sits.
    const plan = occurrence.planSnapshot;
    if (plan === null) {
        throw new Error('The factory is meant to seed a plan.');
    }
    await ScheduleOccurrence.update(occurrence.id, {
        planSnapshot: {
            ...plan,
            wakeUpAt: plannedWakeAt.toISOString(),
            departHomeAt: plannedWakeAt.toISOString(),
        },
    });

    return { token, occurrence };
}

describe('applying the stored plan by hand', () => {
    it('moves the alarm to the time already on screen', async () => {
        const now = Date.now();
        const { token, occurrence } = await morning(
            new Date(now + 60 * 60 * 1000),
            new Date(now + 72 * 60 * 1000),
        );

        const response = await asDevice(token).post(
            API_ENDPOINTS.OCCURRENCES.APPLY_PLAN(occurrence.id),
            {},
        );

        expect(response.status).toBe(200);
        const body = data<OccurrenceResponse>(response);
        expect(new Date(body.currentWakeAt).getTime()).toBe(now + 72 * 60 * 1000);
    });

    it('moves earlier just as readily, because somebody asked', async () => {
        /*
         * The monotonic rule guards against the alarm moving earlier while its
         * owner sleeps, on the strength of a best-effort message. It was never
         * meant to refuse the person holding the phone, and the home screen's
         * refresh already takes the same position.
         */
        const now = Date.now();
        const { token, occurrence } = await morning(
            new Date(now + 90 * 60 * 1000),
            new Date(now + 60 * 60 * 1000),
        );

        const response = await asDevice(token).post(
            API_ENDPOINTS.OCCURRENCES.APPLY_PLAN(occurrence.id),
            {},
        );

        expect(response.status).toBe(200);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.currentWakeAt?.getTime()).toBe(now + 60 * 60 * 1000);
    });

    it('records who moved it, so the morning stays explainable', async () => {
        const now = Date.now();
        const { token, occurrence } = await morning(
            new Date(now + 60 * 60 * 1000),
            new Date(now + 72 * 60 * 1000),
        );

        await asDevice(token).post(API_ENDPOINTS.OCCURRENCES.APPLY_PLAN(occurrence.id), {});

        const event = await AlarmEvent.findOne({
            where: { occurrenceId: occurrence.id },
            order: { createdAt: 'DESC' },
        });
        expect(event?.reason).toBe(WakeChangeReason.USER_APPLIED);
        expect(event?.type).toBe(AlarmEventType.MOVED_LATER);
    });

    it('refuses when there is nothing to apply', async () => {
        // A button that reports success while changing nothing is worse than one
        // that says there is nothing to do. Same floor the monitor pushes under.
        const now = Date.now();
        const { token, occurrence } = await morning(
            new Date(now + 60 * 60 * 1000),
            new Date(now + 60 * 60 * 1000 + 30_000),
        );

        const response = await asDevice(token).post(
            API_ENDPOINTS.OCCURRENCES.APPLY_PLAN(occurrence.id),
            {},
        );

        expect(response.status).toBe(409);
    });

    it('cannot be aimed at a morning owned by another device', async () => {
        const now = Date.now();
        const { occurrence } = await morning(
            new Date(now + 60 * 60 * 1000),
            new Date(now + 72 * 60 * 1000),
        );
        const { token: other } = await seedCommute();

        const response = await asDevice(other).post(
            API_ENDPOINTS.OCCURRENCES.APPLY_PLAN(occurrence.id),
            {},
        );

        expect(response.status).toBe(404);
    });
});
