import { DateTime } from 'luxon';
import { nextOccurrenceDate, routineDurationMinutes } from '@alarm/core';
import type { PlanPreviewRequest, SchedulePlanResponse } from '@alarm/types';

import Place from '../models/Place.entity';
import Routine from '../models/Routine.entity';
import type Schedule from '../models/Schedule.entity';
import { PlanService } from './PlanService';

/**
 * Why a saved schedule could not be planned. Named, so the controller decides
 * what each looks like on the wire and the compiler notices a new one.
 */
export type SchedulePlanProblem =
    /** Paused. Nothing is wrong; there is simply no next morning. */
    | 'SCHEDULE_INACTIVE'
    /** No day of the week matches, which only an empty list can cause. */
    | 'NO_UPCOMING_OCCURRENCE'
    /** A referenced place or routine is gone. */
    | 'REFERENCES_MISSING';

export type SchedulePlanResult =
    | { ok: true; response: SchedulePlanResponse }
    | { ok: false; problem: SchedulePlanProblem };

/**
 * The wake plan for a schedule's next occurrence.
 *
 * This exists so the device can ask one question and get everything it needs to
 * arm an alarm. The alternative was the app fetching schedules, places and
 * routines, summing the enabled steps itself and rebuilding the plan request,
 * which is four round trips and a second copy of arithmetic that already lives
 * here. The first time the two copies disagreed, the alarm would be wrong and
 * nothing would say which side was.
 *
 * Computed rather than stored. M2 introduces occurrences, which persist state
 * across the monitor loop; until then this answers the same question honestly
 * and costs one provider call.
 */
export class SchedulePlanService {
    private readonly plans = new PlanService();

    async forSchedule(schedule: Schedule): Promise<SchedulePlanResult> {
        const request = await this.requestFor(schedule);
        if (!request.ok) {
            return { ok: false, problem: request.problem };
        }

        const plan = await this.plans.preview(request.input);

        return {
            ok: true,
            response: {
                scheduleId: schedule.id,
                scheduleName: schedule.name,
                date: request.date,
                plan,
            },
        };
    }


    /**
     * A fresh plan for one specific morning, ignoring what was stored.
     *
     * The re-plan path: the itinerary an occurrence was armed from no longer
     * exists, which is what NS means when a trip stops being reconstructable,
     * and the only useful answer is a different journey to the same deadline.
     * Without it a cancellation left the occurrence with no journey at all,
     * which reads on screen as a train that vanished with nothing replacing it.
     *
     * The date is passed in rather than recomputed, because the morning being
     * re-planned is the one already armed, and `nextOccurrenceDate` rolls
     * forward the moment its deadline passes.
     */
    async forDate(
        schedule: Schedule,
        date: string,
        journeyOffset?: number,
    ): Promise<SchedulePlanResult> {
        const request = await this.requestFor(schedule, date, journeyOffset);
        if (!request.ok) {
            return { ok: false, problem: request.problem };
        }

        return {
            ok: true,
            response: {
                scheduleId: schedule.id,
                scheduleName: schedule.name,
                date: request.date,
                plan: await this.plans.preview(request.input),
            },
        };
    }

    /**
     * Turns a saved schedule into a plan request, or says why it cannot.
     *
     * Shared by both callers above, because they differ only in what they ask
     * the planner for. Two copies would eventually disagree about which day is
     * next, and the disagreement would show up as an option list for a different
     * morning than the plan beside it.
     */
    private async requestFor(
        schedule: Schedule,
        forDate?: string,
        journeyOffset?: number,
    ): Promise<
        { ok: true; input: PlanPreviewRequest; date: string } | { ok: false; problem: SchedulePlanProblem }
    > {
        if (!schedule.active) {
            return { ok: false, problem: 'SCHEDULE_INACTIVE' };
        }

        const [origin, destination, routine] = await Promise.all([
            Place.findOneBy({ id: schedule.originPlaceId, deviceId: schedule.deviceId }),
            Place.findOneBy({ id: schedule.destinationPlaceId, deviceId: schedule.deviceId }),
            Routine.findOneBy({ id: schedule.routineId, deviceId: schedule.deviceId }),
        ]);

        if (origin === null || destination === null || routine === null) {
            // The foreign keys are RESTRICT, so this should be unreachable. It
            // is reported rather than thrown because "your setup is incomplete"
            // is something the app can act on, and a 500 is not.
            return { ok: false, problem: 'REFERENCES_MISSING' };
        }

        const date = forDate ?? this.nextDate(schedule);
        if (date === null) {
            return { ok: false, problem: 'NO_UPCOMING_OCCURRENCE' };
        }

        const input: PlanPreviewRequest = {
            origin: { lat: origin.lat, lng: origin.lng },
            destination: { lat: destination.lat, lng: destination.lng },
            arrivalTime: schedule.arrivalTime.slice(0, 5),
            date,
            mode: schedule.mode,
            originAccess: schedule.originAccess,
            destinationAccess: schedule.destinationAccess,
            journeyOffset: journeyOffset ?? schedule.journeyOffset,
            fixedTravelMinutes: schedule.fixedTravelMinutes ?? undefined,
            // Disabled steps are kept and count zero, which is how "not today"
            // works without losing the step.
            routineMinutes: routineDurationMinutes(routine),
            buffers: schedule.buffers,
            timezone: schedule.timezone,
        };

        return { ok: true, input, date };
    }

    private nextDate(schedule: Schedule): string | null {
        const next = nextOccurrenceDate(
            schedule.daysOfWeek,
            schedule.arrivalTime.slice(0, 5),
            schedule.timezone,
            DateTime.now().setZone(schedule.timezone),
        );
        return next?.toISODate() ?? null;
    }
}
