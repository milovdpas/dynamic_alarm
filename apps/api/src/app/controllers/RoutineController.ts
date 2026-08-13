import type { ListRoutinesResponse, RoutineResponse } from '@alarm/types';

import type { Handler, IdParams } from '../../interfaces/IHttp';
import type { BodyOf } from '../middleware/ValidateRequest';
import { RoutineService } from '../services/RoutineService';
import { sendConflict, sendNotFound, sendSuccess } from '../utils/ApiResponses';
import { createRoutineSchema, updateRoutineSchema } from '../validators/routineSchemas';

export default class RoutineController {
    private readonly routines = new RoutineService();

    list: Handler = async (req, res) => {
        const routines = await this.routines.list(req.device.id);
        sendSuccess<ListRoutinesResponse>(
            res,
            routines.map((routine) => routine.toDto()),
        );
    };

    detail: Handler<unknown, IdParams> = async (req, res) => {
        const routine = await this.routines.findOne(req.device.id, req.params.id);
        if (routine === null) {
            sendNotFound(res, 'Routine');
            return;
        }
        sendSuccess<RoutineResponse>(res, routine.toDto());
    };

    create: Handler<BodyOf<typeof createRoutineSchema>> = async (req, res) => {
        const routine = await this.routines.create(req.device.id, req.body);
        sendSuccess<RoutineResponse>(res, routine.toDto(), 201);
    };

    update: Handler<BodyOf<typeof updateRoutineSchema>, IdParams> = async (req, res) => {
        const routine = await this.routines.findOne(req.device.id, req.params.id);
        if (routine === null) {
            sendNotFound(res, 'Routine');
            return;
        }

        const updated = await this.routines.update(routine, req.body);
        sendSuccess<RoutineResponse>(res, updated.toDto());
    };

    remove: Handler<unknown, IdParams> = async (req, res) => {
        const routine = await this.routines.findOne(req.device.id, req.params.id);
        if (routine === null) {
            sendNotFound(res, 'Routine');
            return;
        }

        const blockedBy = await this.routines.remove(routine);
        if (blockedBy.length > 0) {
            sendConflict(res, `Routine is still used by: ${blockedBy.join(', ')}`);
            return;
        }

        res.status(204).end();
    };
}
