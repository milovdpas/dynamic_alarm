import type { Response } from 'express';
import type { ListAlarmEventsResponse, OccurrenceResponse } from '@alarm/types';

import type { Handler, IdParams } from '../../interfaces/IHttp';
import type { BodyOf } from '../middleware/ValidateRequest';
import AlarmEvent from '../models/AlarmEvent.entity';
import Schedule from '../models/Schedule.entity';
import { OccurrenceService } from '../services/OccurrenceService';
import { ScheduleService } from '../services/ScheduleService';
import type { SchedulePlanProblem } from '../services/SchedulePlanService';
import { sendConflict, sendNotFound, sendSuccess } from '../utils/ApiResponses';
import { ackOccurrenceSchema } from '../validators/occurrenceSchemas';

export default class OccurrenceController {
    private readonly occurrences = new OccurrenceService();
    private readonly schedules = new ScheduleService();

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
        sendSuccess<OccurrenceResponse>(res, occurrence.toDto(schedule?.name ?? ''));
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

        sendSuccess<OccurrenceResponse>(res, result.occurrence.toDto(result.scheduleName));
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
        sendSuccess<OccurrenceResponse>(res, updated.toDto(schedule?.name ?? ''));
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
