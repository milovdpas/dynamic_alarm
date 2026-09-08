import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AlarmEventType,
    API_ENDPOINTS,
    OccurrenceState,
    TransportMode,
    WakeChangeReason,
    Weekday,
} from '@alarm/types';
import type { Journey, OccurrenceResponse } from '@alarm/types';
import type { PlanRequest, RefreshResult, TransportProvider } from '@alarm/core';

import AlarmEvent from '../src/app/models/AlarmEvent.entity';
import Routine from '../src/app/models/Routine.entity';
import ScheduleOccurrence from '../src/app/models/ScheduleOccurrence.entity';
import { DisruptionSweepService } from '../src/app/services/DisruptionSweepService';
import { MonitorService } from '../src/app/services/MonitorService';
import { SchedulePlanService } from '../src/app/services/SchedulePlanService';
import { TransportProviderFactory } from '../src/app/services/TransportProviderFactory';
import { asDevice, data } from './support/client';
import { StubNsModule } from './support/disruptions';
import { seedCommute, seedSchedule } from './support/factories';
import { fixtureProvider } from './support/transport';

/**
 * Leaving a routine step out of one morning.
 *
 * "No shower on Thursday." The wake time moves later by the step's minutes,
 * recomputed from the journey already stored so no provider is asked. The part
 * that has to be right is that nothing puts the shower back: not the tick, not a
 * refresh, not a re-plan. Every place that measures the routine for a morning
 * reads the morning's skipped steps.
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

beforeEach(() => {
    vi.spyOn(TransportProviderFactory, 'forMode').mockReturnValue(fixtureProvider);
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** An armed week, with the soonest morning and the routine's first step to hand. */
async function armedMorning() {
    const { device, token, home, work, routine } = await seedCommute();
    const schedule = await seedSchedule(
        device,
        { origin: home, destination: work, routine },
        { mode: TransportMode.PUBLIC_TRANSPORT, daysOfWeek: EVERY_DAY },
    );
    const armed = await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});
    const occurrence = data<OccurrenceResponse>(armed);

    const stored = await Routine.findOneBy({ id: routine.id });
    const step = stored?.steps.find((each) => each.enabled);
    if (step === undefined) {
        throw new Error('The factory is meant to seed an enabled step.');
    }

    return { token, schedule, occurrence, step };
}

function minutesBetween(from: string, to: string): number {
    return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
}

describe('leaving a step out of one morning', () => {
    it('moves the wake time later by exactly that step', async () => {
        const { token, occurrence, step } = await armedMorning();

        const response = await asDevice(token).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
            disabledStepIds: [step.id],
        });

        expect(response.status).toBe(200);
        const after = data<OccurrenceResponse>(response);
        expect(minutesBetween(occurrence.currentWakeAt, after.currentWakeAt)).toBe(step.minutes);
        expect(after.disabledStepIds).toEqual([step.id]);
    });

    it('asks no provider anything', async () => {
        // The journey is unchanged; only the minutes before departure are.
        const { token, occurrence, step } = await armedMorning();
        const planner = vi.spyOn(SchedulePlanService.prototype, 'forDate');
        const options = vi.spyOn(SchedulePlanService.prototype, 'optionsForDate');

        await asDevice(token).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
            disabledStepIds: [step.id],
        });

        expect(planner).not.toHaveBeenCalled();
        expect(options).not.toHaveBeenCalled();
    });

    it('re-anchors the morning, because an explicit edit is not a silent move', async () => {
        /*
         * The anchor stops the alarm moving silently. Left where it was, the
         * return rule would drag this morning back to a wake time with a shower
         * in it, which is the one thing its owner just said they did not want.
         */
        const { token, occurrence, step } = await armedMorning();

        await asDevice(token).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
            disabledStepIds: [step.id],
        });

        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.anchorWakeAt?.getTime()).toBe(after?.currentWakeAt?.getTime());
    });

    it('records who moved it and why', async () => {
        const { token, occurrence, step } = await armedMorning();

        await asDevice(token).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
            disabledStepIds: [step.id],
        });

        const event = await AlarmEvent.findOne({
            where: { occurrenceId: occurrence.id },
            order: { createdAt: 'DESC' },
        });
        expect(event?.reason).toBe(WakeChangeReason.USER_EDITED);
        expect(event?.type).toBe(AlarmEventType.MOVED_LATER);
    });

    it('puts the step back when the list is emptied', async () => {
        const { token, occurrence, step } = await armedMorning();
        await asDevice(token).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
            disabledStepIds: [step.id],
        });

        const response = await asDevice(token).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
            disabledStepIds: [],
        });

        const after = data<OccurrenceResponse>(response);
        expect(after.currentWakeAt).toBe(occurrence.currentWakeAt);
        expect(after.disabledStepIds).toEqual([]);
    });

    it('refuses a morning that is over', async () => {
        // Otherwise the anchor moves into the past, a move lands in the trail,
        // and the row is armed again for the sweep to close a minute later.
        const { token, occurrence, step } = await armedMorning();
        await ScheduleOccurrence.update(occurrence.id, { state: OccurrenceState.FIRED });

        const response = await asDevice(token).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
            disabledStepIds: [step.id],
        });

        expect(response.status).toBe(409);
        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.state).toBe(OccurrenceState.FIRED);
    });

    it('refuses a step that is not part of this routine', async () => {
        const { token, occurrence } = await armedMorning();

        const response = await asDevice(token).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
            disabledStepIds: ['00000000-0000-4000-8000-000000000000'],
        });

        expect(response.status).toBe(422);
    });

    it('cannot be aimed at a morning owned by another device', async () => {
        const { occurrence, step } = await armedMorning();
        const { token: other } = await seedCommute();

        const response = await asDevice(other).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
            disabledStepIds: [step.id],
        });

        expect(response.status).toBe(404);
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

describe('nothing puts the step back', () => {
    it('not the tick', async () => {
        /*
         * The monitor recomputes the wake time on every check with the routine's
         * full length. Without reading the morning's skipped steps it would
         * quietly restore the shower within half an hour of it being taken out.
         */
        const { token, occurrence, step } = await armedMorning();
        const moved = data<OccurrenceResponse>(
            await asDevice(token).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
                disabledStepIds: [step.id],
            }),
        );
        const row = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        const journey = row?.planSnapshot?.journey ?? null;
        if (journey === null) {
            throw new Error('The armed morning is meant to carry a journey.');
        }
        await ScheduleOccurrence.update(occurrence.id, {
            state: OccurrenceState.ARMED,
            nextCheckAt: new Date(Date.now() - 60_000),
        });
        vi.spyOn(TransportProviderFactory, 'forMode').mockReturnValue(new UnchangedProvider(journey));

        await new MonitorService(new DisruptionSweepService(new StubNsModule([]))).tick();

        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.currentWakeAt?.toISOString()).toBe(moved.currentWakeAt);
        /*
         * The stored plan as well, not only the alarm time. The monotonic rule
         * refuses an earlier move on a plain delay, so `currentWakeAt` would
         * survive a tick that forgot the skipped steps by accident, while the
         * plan on screen and the plan "move it anyway" applies quietly regained
         * the shower.
         */
        expect(after?.planSnapshot?.wakeUpAt).toBe(moved.plan.wakeUpAt);
        expect(after?.planSnapshot?.breakdown.routineMinutes).toBe(moved.plan.breakdown.routineMinutes);
    });

    it('not a refresh', async () => {
        // Arming plans the soonest morning again every time. It has to plan it
        // with the same steps left out.
        const { token, schedule, occurrence, step } = await armedMorning();
        const moved = data<OccurrenceResponse>(
            await asDevice(token).put(API_ENDPOINTS.OCCURRENCES.STEPS(occurrence.id), {
                disabledStepIds: [step.id],
            }),
        );

        await asDevice(token).post(API_ENDPOINTS.SCHEDULES.ARM(schedule.id), {});

        const after = await ScheduleOccurrence.findOneBy({ id: occurrence.id });
        expect(after?.currentWakeAt?.toISOString()).toBe(moved.currentWakeAt);
        expect(after?.disabledStepIds).toEqual([step.id]);
    });
});
