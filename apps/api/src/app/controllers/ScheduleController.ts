import type { Response } from 'express';
import type { ListSchedulesResponse, ScheduleResponse } from '@alarm/types';

import type { Handler, IdParams } from '../../interfaces/IHttp';
import type { BodyOf } from '../middleware/ValidateRequest';
import { ScheduleService } from '../services/ScheduleService';
import type { ScheduleProblem, ScheduleWriteResult } from '../services/ScheduleService';
import { sendNotFound, sendSuccess, sendValidationFailed } from '../utils/ApiResponses';
import { createScheduleSchema, updateScheduleSchema } from '../validators/scheduleSchemas';

export default class ScheduleController {
    private readonly schedules = new ScheduleService();

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
