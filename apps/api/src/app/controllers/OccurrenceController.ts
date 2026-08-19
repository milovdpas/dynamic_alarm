import type { Response } from 'express';
import { In } from 'typeorm';
import { DEFAULT_REMINDERS } from '@alarm/types';
import type {
    ListAlarmEventsResponse,
    ListOccurrencesResponse,
    OccurrenceResponse,
} from '@alarm/types';

import type { Handler, IdParams } from '../../interfaces/IHttp';
import type { BodyOf } from '../middleware/ValidateRequest';
import AlarmEvent from '../models/AlarmEvent.entity';
import Schedule from '../models/Schedule.entity';
import type ScheduleOccurrence from '../models/ScheduleOccurrence.entity';
import { OccurrenceService } from '../services/OccurrenceService';
import { SimulationService } from '../services/SimulationService';
import { ScheduleService } from '../services/ScheduleService';
import type { SchedulePlanProblem } from '../services/SchedulePlanService';
import { sendConflict, sendNotFound, sendSuccess } from '../utils/ApiResponses';
import { ackOccurrenceSchema, simulateOccurrenceSchema } from '../validators/occurrenceSchemas';

export default class OccurrenceController {
    private readonly occurrences = new OccurrenceService();
    private readonly schedules = new ScheduleService();
    private readonly simulations = new SimulationService();

    /**
     * The soonest armed occurrence, or 404 when there is none.
     *
     * A pure read that spends no provider call, because the plan was stored when
     * the occurrence was armed. Opening the app repeatedly costs one query
     * rather than one NS request each time, which is the whole reason the
     * snapshot exists.
     */
    next: Handler = async (req, res) => {
        const occurrence = await this.occurrences.findNext(req.device.id);
        if (occurrence === null) {
            sendNotFound(res, 'Occurrence');
            return;
        }

        const schedule = await Schedule.findOneBy({ id: occurrence.scheduleId });
        sendSuccess<OccurrenceResponse>(res, occurrence.toDto(schedule?.name ?? '', schedule?.reminders ?? DEFAULT_REMINDERS));
    };

    /**
     * Every armed morning for this device, soonest first.
     *
     * The schedule names are read in one query rather than one per occurrence.
     * A handful of rows either way, but the alternative is a loop of queries
     * that grows with the number of schedules for no reason.
     */
    list: Handler = async (req, res) => {
        const occurrences = await this.occurrences.findArmed(req.device.id);
        const schedules = await this.schedulesFor(occurrences);

        sendSuccess<ListOccurrencesResponse>(
            res,
            occurrences.map((occurrence) => {
                const schedule = schedules.get(occurrence.scheduleId);
                return occurrence.toDto(
                    schedule?.name ?? '',
                    schedule?.reminders ?? DEFAULT_REMINDERS,
                );
            }),
        );
    };

    /**
     * Arms the next morning for a schedule, and returns what the device should
     * hold.
     *
     * Idempotent per morning: the unique key on (schedule, date) means calling
     * this twice cannot produce two alarms for one Thursday. Re-arming refreshes
     * the live time and leaves the anchor alone, because the anchor is the time
     * the device is already holding and moving it would make the guarantee only
     * as strong as the last network call.
     */
    arm: Handler<unknown, IdParams> = async (req, res) => {
        const schedule = await this.schedules.findOne(req.device.id, req.params.id);
        if (schedule === null) {
            sendNotFound(res, 'Schedule');
            return;
        }

        const result = await this.occurrences.arm(schedule);
        if (!result.ok) {
            this.sendProblem(res, result.problem);
            return;
        }

        sendSuccess<OccurrenceResponse>(res, result.occurrence.toDto(result.schedule.name, result.schedule.reminders));
    };

    /**
     * Throws this morning away and plans it again from scratch.
     *
     * The way back from a test, and the reason it needs to exist: a simulated
     * cancellation that moved the alarm earlier cannot be undone by taking the
     * simulation back. Clearing it lets the monitor plan against reality again,
     * but restoring the original time is a move *later*, which the opt-in
     * switches govern, so a device that has not opted in keeps the early alarm.
     *
     * That asymmetry was a real bug for real cancellations too, and the fix is
     * the anchor-return rule in `MonitorService`, not this endpoint: an alarm
     * below its anchor is now given the anchor back on the next check. This
     * stays as the escape hatch for whoever is testing, which is a different
     * job: it throws the whole morning away rather than releasing one move.
     *
     * Discard and re-arm rather than "undo": there is no record of what the plan
     * was before, and inventing one would be worse than planning the morning
     * again from live data, which is what the app would have done anyway.
     */
    reset: Handler<unknown, IdParams> = async (req, res) => {
        const occurrence = await this.occurrences.findOwned(req.device.id, req.params.id);
        if (occurrence === null) {
            sendNotFound(res, 'Occurrence');
            return;
        }

        const schedule = await this.schedules.findOne(req.device.id, occurrence.scheduleId);
        if (schedule === null) {
            // Owned occurrence, missing schedule. Nothing to plan from.
            sendNotFound(res, 'Schedule');
            return;
        }

        await this.occurrences.discardUpcoming(schedule);

        const result = await this.occurrences.arm(schedule);
        if (!result.ok) {
            this.sendProblem(res, result.problem);
            return;
        }

        sendSuccess<OccurrenceResponse>(res, result.occurrence.toDto(result.schedule.name, result.schedule.reminders));
    };

    /**
     * Moves the alarm onto the plan on screen, because somebody tapped.
     *
     * The counterpart to the opt-in switches rather than a way around them.
     * With them off, a delay that would buy twelve minutes in bed is noticed,
     * explained, and then deliberately not acted on, which leaves the app
     * knowing something useful and doing nothing with it. This is how its owner
     * says go on, once, for this morning.
     *
     * No provider call and no `providerLimit`: the plan is the one the last
     * check already stored.
     */
    applyPlan: Handler<unknown, IdParams> = async (req, res) => {
        const occurrence = await this.occurrences.findOwned(req.device.id, req.params.id);
        if (occurrence === null) {
            sendNotFound(res, 'Occurrence');
            return;
        }

        const result = await this.occurrences.applyStoredPlan(occurrence);
        if (!result.ok) {
            // 409 rather than 422: nothing about the request is wrong, the
            // morning simply is not in a state where there is anything to
            // apply, and the app decides what to say from that.
            sendConflict(res, result.problem);
            return;
        }

        const schedule = await Schedule.findOneBy({ id: result.occurrence.scheduleId });
        sendSuccess<OccurrenceResponse>(res, result.occurrence.toDto(schedule?.name ?? '', schedule?.reminders ?? DEFAULT_REMINDERS));
    };

    /**
     * Sits one morning out without touching the schedule behind it.
     *
     * The pair to the alarms list's toggle rather than a replacement for it. A
     * toggle turns the standing alarm off, which is a decision about every
     * morning; this is a decision about one, and it expires by itself when that
     * morning has passed. Expressing both through the same control would mean a
     * switch whose meaning depended on whether the row recurred.
     */
    skip: Handler<unknown, IdParams> = async (req, res) => {
        const occurrence = await this.occurrences.findOwned(req.device.id, req.params.id);
        if (occurrence === null) {
            sendNotFound(res, 'Occurrence');
            return;
        }

        const updated = await this.occurrences.skip(occurrence);
        const schedule = await Schedule.findOneBy({ id: updated.scheduleId });
        sendSuccess<OccurrenceResponse>(res, updated.toDto(schedule?.name ?? '', schedule?.reminders ?? DEFAULT_REMINDERS));
    };

    /** Puts a skipped morning back, due for a check straight away. */
    unskip: Handler<unknown, IdParams> = async (req, res) => {
        const occurrence = await this.occurrences.findOwned(req.device.id, req.params.id);
        if (occurrence === null) {
            sendNotFound(res, 'Occurrence');
            return;
        }

        const updated = await this.occurrences.unskip(occurrence);
        const schedule = await Schedule.findOneBy({ id: updated.scheduleId });
        sendSuccess<OccurrenceResponse>(res, updated.toDto(schedule?.name ?? '', schedule?.reminders ?? DEFAULT_REMINDERS));
    };

    /**
     * The device confirming which time it actually holds.
     *
     * Deliberately takes the time rather than just the id. "I armed something"
     * and "I armed 06:58" are different claims, and only the second lets the
     * server tell a delivered push from a dropped one.
     */
    acknowledge: Handler<BodyOf<typeof ackOccurrenceSchema>, IdParams> = async (req, res) => {
        const occurrence = await this.occurrences.findOwned(req.device.id, req.params.id);
        if (occurrence === null) {
            sendNotFound(res, 'Occurrence');
            return;
        }

        const updated = await this.occurrences.acknowledge(occurrence, req.body.ackedWakeAt);
        const schedule = await Schedule.findOneBy({ id: updated.scheduleId });
        sendSuccess<OccurrenceResponse>(res, updated.toDto(schedule?.name ?? '', schedule?.reminders ?? DEFAULT_REMINDERS));
    };

    /**
     * Stages a pretend disruption for the next check of this occurrence.
     *
     * A test tool, and deliberately a narrow one. It is authenticated as a
     * device and looked up by device id, so it can only ever touch this phone's
     * own morning: a simulation that could be aimed at someone else's alarm is a
     * way to make a stranger late.
     *
     * It also does nothing by itself. The monitor applies it on the next check,
     * which is what makes the test worth running: every step after the invented
     * timetable is the real one.
     *
     * `kind: null` takes one back, whether or not it has already been applied.
     * Clearing the fields is only half of that: an applied simulation has left
     * an invented journey and a moved wake time behind it, and those are undone
     * by planning against reality again, which is the monitor's job rather than
     * this request's.
     */
    simulate: Handler<BodyOf<typeof simulateOccurrenceSchema>, IdParams> = async (req, res) => {
        const occurrence = await this.occurrences.findOwned(req.device.id, req.params.id);
        if (occurrence === null) {
            sendNotFound(res, 'Occurrence');
            return;
        }

        if (req.body.kind === null) {
            this.simulations.clear(occurrence);
        } else {
            this.simulations.stage(occurrence, req.body.kind, req.body.minutes ?? 15);
        }

        /*
         * Due now either way, and the "either way" is the part that was missing.
         *
         * Staging has always done this, so a test does not wait half an hour to
         * begin. Taking one back did not, so an already-applied simulation kept
         * its invented cancellation and its moved alarm until the next band
         * check, and the button reported success while the screen disagreed with
         * it for the next thirty minutes.
         */
        occurrence.nextCheckAt = new Date();

        const saved = await occurrence.save();
        const schedule = await Schedule.findOneBy({ id: saved.scheduleId });
        sendSuccess<OccurrenceResponse>(res, saved.toDto(schedule?.name ?? '', schedule?.reminders ?? DEFAULT_REMINDERS));
    };

    /** Why this alarm moved, oldest first, so the story reads forwards. */
    events: Handler<unknown, IdParams> = async (req, res) => {
        const occurrence = await this.occurrences.findOwned(req.device.id, req.params.id);
        if (occurrence === null) {
            sendNotFound(res, 'Occurrence');
            return;
        }

        const events = await AlarmEvent.find({
            where: { occurrenceId: occurrence.id },
            order: { createdAt: 'ASC' },
        });
        sendSuccess<ListAlarmEventsResponse>(
            res,
            events.map((event) => event.toDto()),
        );
    };

    /**
     * The schedules behind a set of mornings, by id.
     *
     * The whole record rather than the name, since the DTO also carries the
     * reminder setting. Still one query for the lot: the alternative is a loop
     * that grows with the number of schedules for no reason.
     */
    private async schedulesFor(
        occurrences: ScheduleOccurrence[],
    ): Promise<Map<string, Schedule>> {
        const ids = [...new Set(occurrences.map((occurrence) => occurrence.scheduleId))];
        if (ids.length === 0) {
            return new Map();
        }

        const schedules = await Schedule.findBy({ id: In(ids) });
        return new Map(schedules.map((schedule) => [schedule.id, schedule]));
    }

    private sendProblem(res: Response, problem: SchedulePlanProblem): void {
        switch (problem) {
            case 'SCHEDULE_INACTIVE':
                sendConflict(res, 'Schedule is paused');
                return;
            case 'NO_UPCOMING_OCCURRENCE':
                sendConflict(res, 'Schedule has no upcoming day');
                return;
            case 'REFERENCES_MISSING':
                sendNotFound(res, 'Place or routine');
                return;
        }
    }
}
