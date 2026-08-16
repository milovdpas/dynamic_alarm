import type { Response } from 'express';
import type {
    ListSchedulesResponse,
    SchedulePlanResponse,
    ScheduleResponse,
} from '@alarm/types';

import type { Handler, IdParams } from '../../interfaces/IHttp';
import type { BodyOf } from '../middleware/ValidateRequest';
import { SchedulePlanService } from '../services/SchedulePlanService';
import type { SchedulePlanProblem } from '../services/SchedulePlanService';
import { ScheduleService } from '../services/ScheduleService';
import type { ScheduleProblem, ScheduleWriteResult } from '../services/ScheduleService';
import {
    sendConflict,
    sendNotFound,
    sendSuccess,
    sendValidationFailed,
} from '../utils/ApiResponses';
import { createScheduleSchema, updateScheduleSchema } from '../validators/scheduleSchemas';

export default class ScheduleController {
    private readonly schedules = new ScheduleService();
    private readonly plans = new SchedulePlanService();

    list: Handler = async (req, res) => {
        const schedules = await this.schedules.list(req.device.id);
        sendSuccess<ListSchedulesResponse>(
            res,
            schedules.map((schedule) => schedule.toDto()),
        );
    };

    detail: Handler<unknown, IdParams> = async (req, res) => {
        const schedule = await this.schedules.findOne(req.device.id, req.params.id);
        if (schedule === null) {
            sendNotFound(res, 'Schedule');
            return;
        }
        sendSuccess<ScheduleResponse>(res, schedule.toDto());
    };

    create: Handler<BodyOf<typeof createScheduleSchema>> = async (req, res) => {
        this.send(res, await this.schedules.create(req.device.id, req.body), 201);
    };

    update: Handler<BodyOf<typeof updateScheduleSchema>, IdParams> = async (req, res) => {
        const schedule = await this.schedules.findOne(req.device.id, req.params.id);
        if (schedule === null) {
            sendNotFound(res, 'Schedule');
            return;
        }
        this.send(res, await this.schedules.update(schedule, req.body));
    };

    remove: Handler<unknown, IdParams> = async (req, res) => {
        const schedule = await this.schedules.findOne(req.device.id, req.params.id);
        if (schedule === null) {
            sendNotFound(res, 'Schedule');
            return;
        }
        await this.schedules.remove(schedule);
        res.status(204).end();
    };

    /**
     * The wake plan for this schedule's next occurrence.
     *
     * Everything the device needs to arm an alarm, in one request. It costs a
     * provider call, so it is a deliberate action rather than something to poll.
     */
    plan: Handler<unknown, IdParams> = async (req, res) => {
        const schedule = await this.schedules.findOne(req.device.id, req.params.id);
        if (schedule === null) {
            sendNotFound(res, 'Schedule');
            return;
        }

        const result = await this.plans.forSchedule(schedule);
        if (!result.ok) {
            this.sendPlanProblem(res, result.problem);
            return;
        }
        sendSuccess<SchedulePlanResponse>(res, result.response);
    };


    /**
     * A schedule that cannot be planned is not a server fault, so none of these
     * are 500s. Exhaustive on purpose: a new problem fails to compile here
     * rather than falling through to something nobody can act on.
     */
    private sendPlanProblem(res: Response, problem: SchedulePlanProblem): void {
        switch (problem) {
            case 'SCHEDULE_INACTIVE':
                // 409 rather than 422: nothing about the request is wrong, the
                // schedule is simply paused.
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

    private send(res: Response, result: ScheduleWriteResult, status = 200): void {
        if (result.ok) {
            sendSuccess<ScheduleResponse>(res, result.schedule.toDto(), status);
            return;
        }
        this.sendProblem(res, result.problem);
    }

    /**
     * Turns a refusal into a response.
     *
     * The switch is exhaustive on purpose: `ScheduleProblem` is a union, so
     * adding a case without handling it here fails to compile rather than
     * falling through to a generic error nobody can act on.
     *
     * A place or routine that is not this device's answers 404, the same as
     * asking for it directly would. Anything else would confirm that the id
     * exists to someone who only guessed it.
     */
    private sendProblem(res: Response, problem: ScheduleProblem): void {
        switch (problem) {
            case 'PLACE_NOT_FOUND':
                sendNotFound(res, 'Place');
                return;
            case 'ROUTINE_NOT_FOUND':
                sendNotFound(res, 'Routine');
                return;
            case 'MISSING_FIXED_TRAVEL_MINUTES':
                sendValidationFailed(res, 'A fixed-travel schedule needs fixedTravelMinutes');
                return;
        }
    }
}
