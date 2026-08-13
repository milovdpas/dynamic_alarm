import { AccessMode, TransportMode } from '@alarm/types';
import type { CreateScheduleRequest, UpdateScheduleRequest } from '@alarm/types';

import Place from '../models/Place.entity';
import Routine from '../models/Routine.entity';
import Schedule from '../models/Schedule.entity';

/**
 * Why a write was refused, when it was.
 *
 * Named outcomes rather than thrown errors, so the controller decides what each
 * one looks like on the wire and the compiler notices when a new one is added
 * and left unhandled.
 */
export type ScheduleProblem =
    /** A referenced place is not this device's, or does not exist. */
    | 'PLACE_NOT_FOUND'
    /** The referenced routine is not this device's, or does not exist. */
    | 'ROUTINE_NOT_FOUND'
    /** Mode is FIXED but no travel duration remains after the update. */
    | 'MISSING_FIXED_TRAVEL_MINUTES';

export type ScheduleWriteResult =
    | { ok: true; schedule: Schedule }
    | { ok: false; problem: ScheduleProblem };

export class ScheduleService {
    async list(deviceId: string): Promise<Schedule[]> {
        return Schedule.find({ where: { deviceId }, order: { createdAt: 'ASC' } });
    }

    /** Scoped to the device, so another device's id is simply not found. */
    async findOne(deviceId: string, id: string): Promise<Schedule | null> {
        return Schedule.findOneBy({ id, deviceId });
    }

    async create(deviceId: string, input: CreateScheduleRequest): Promise<ScheduleWriteResult> {
        const problem = await this.checkReferences(deviceId, input);
        if (problem !== null) {
            return { ok: false, problem };
        }

        const schedule = Schedule.create({
            deviceId,
            name: input.name,
            originPlaceId: input.originPlaceId,
            destinationPlaceId: input.destinationPlaceId,
            routineId: input.routineId,
            arrivalTime: input.arrivalTime,
            daysOfWeek: input.daysOfWeek,
            mode: input.mode,
            originAccess: input.originAccess ?? AccessMode.WALK,
            destinationAccess: input.destinationAccess ?? AccessMode.WALK,
            journeyOffset: input.journeyOffset ?? 0,
            fixedTravelMinutes: input.fixedTravelMinutes ?? null,
            buffers: input.buffers,
            timezone: input.timezone,
            active: true,
        });
        return { ok: true, schedule: await schedule.save() };
    }

    async update(
        schedule: Schedule,
        input: UpdateScheduleRequest,
    ): Promise<ScheduleWriteResult> {
        const problem = await this.checkReferences(schedule.deviceId, input);
        if (problem !== null) {
            return { ok: false, problem };
        }

        if (input.name !== undefined) schedule.name = input.name;
        if (input.originPlaceId !== undefined) schedule.originPlaceId = input.originPlaceId;
        if (input.destinationPlaceId !== undefined) {
            schedule.destinationPlaceId = input.destinationPlaceId;
        }
        if (input.routineId !== undefined) schedule.routineId = input.routineId;
        if (input.arrivalTime !== undefined) schedule.arrivalTime = input.arrivalTime;
        if (input.daysOfWeek !== undefined) schedule.daysOfWeek = input.daysOfWeek;
        if (input.mode !== undefined) schedule.mode = input.mode;
        if (input.originAccess !== undefined) schedule.originAccess = input.originAccess;
        if (input.destinationAccess !== undefined) {
            schedule.destinationAccess = input.destinationAccess;
        }
        if (input.journeyOffset !== undefined) schedule.journeyOffset = input.journeyOffset;
        if (input.buffers !== undefined) schedule.buffers = input.buffers;
        if (input.timezone !== undefined) schedule.timezone = input.timezone;
        if (input.active !== undefined) schedule.active = input.active;
        if (input.fixedTravelMinutes !== undefined) {
            schedule.fixedTravelMinutes = input.fixedTravelMinutes;
        }

        // Checked against the merged result, not the payload. Switching to FIXED
        // without sending a duration, or dropping the duration while already on
        // FIXED, are both a schedule that cannot compute a wake time, and
        // neither is visible by looking at the request alone.
        if (schedule.mode === TransportMode.FIXED && schedule.fixedTravelMinutes === null) {
            return { ok: false, problem: 'MISSING_FIXED_TRAVEL_MINUTES' };
        }

        return { ok: true, schedule: await schedule.save() };
    }

    async remove(schedule: Schedule): Promise<void> {
        await schedule.remove();
    }

    /**
     * Every referenced place and routine must belong to the same device.
     *
     * This is the security boundary of the whole resource, not a tidiness
     * check. Without it a device could point a schedule at another device's
     * place id and read back where that person lives through the plan preview,
     * which is the most sensitive data this app holds. The foreign keys accept
     * any valid id; only ownership makes it theirs.
     */
    private async checkReferences(
        deviceId: string,
        input: Partial<CreateScheduleRequest>,
    ): Promise<ScheduleProblem | null> {
        const placeIds = [input.originPlaceId, input.destinationPlaceId].filter(
            (id): id is string => id !== undefined,
        );

        for (const id of placeIds) {
            if ((await Place.findOneBy({ id, deviceId })) === null) {
                return 'PLACE_NOT_FOUND';
            }
        }

        if (input.routineId !== undefined) {
            if ((await Routine.findOneBy({ id: input.routineId, deviceId })) === null) {
                return 'ROUTINE_NOT_FOUND';
            }
        }

        return null;
    }
}
