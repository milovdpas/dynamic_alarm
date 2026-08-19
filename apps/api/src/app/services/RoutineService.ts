import type { CreateRoutineRequest, UpdateRoutineRequest } from '@alarm/types';

import { AppDataSource } from '../../database/typeorm-db';
import Routine from '../models/Routine.entity';
import RoutineStep from '../models/RoutineStep.entity';
import { OccurrenceService } from './OccurrenceService';
import Schedule from '../models/Schedule.entity';

export class RoutineService {
    private readonly occurrences = new OccurrenceService();

    async list(deviceId: string): Promise<Routine[]> {
        return Routine.find({ where: { deviceId }, order: { createdAt: 'ASC' } });
    }

    /** Scoped to the device, so another device's id is simply not found. */
    async findOne(deviceId: string, id: string): Promise<Routine | null> {
        return Routine.findOneBy({ id, deviceId });
    }

    async create(deviceId: string, input: CreateRoutineRequest): Promise<Routine> {
        const routine = Routine.create({
            deviceId,
            name: input.name,
            steps: input.steps.map((step, index) => buildStep(step, index)),
        });
        // Steps are cascaded, so this writes the routine and its steps together.
        return routine.save();
    }

    /**
     * Updates a routine, replacing its steps wholesale when they are sent.
     *
     * Replacement rather than a diff, because the client edits the list as a
     * unit: reordering, renaming and deleting all happen at once in the editor,
     * and reconstructing which of those occurred from a set of ids is guesswork
     * that gets the order wrong. Omitting `steps` leaves them untouched, so
     * renaming a routine does not require sending them back.
     *
     * The step ids change on every edit. Nothing references them (the engine
     * reads minutes, not identity), so stability would buy nothing.
     */
    async update(routine: Routine, input: UpdateRoutineRequest): Promise<Routine> {
        if (input.name !== undefined) {
            routine.name = input.name;
        }

        const steps = input.steps;
        if (steps === undefined) {
            return routine.save();
        }

        /**
         * The delete and the insert are one transaction, because half of them is
         * a routine that takes no time at all.
         *
         * The old steps have to go before the new ones arrive: position in the
         * array is the order, so a diff would have to reconstruct which of
         * reorder, rename and delete happened, and it would get it wrong. That
         * leaves a moment where the routine has no steps, and a failure inside
         * it used to be permanent: every wake time computed afterwards would be
         * as early as a morning with nothing in it, which is late.
         */
        const saved = await AppDataSource.transaction(async (manager) => {
            await manager.delete(RoutineStep, { routineId: routine.id });
            routine.steps = steps.map((step, index) => buildStep(step, index));
            return manager.save(routine);
        });

        // The routine is half the arithmetic: the journey says when to leave,
        // the routine says how long before that to wake. Changing it while an
        // alarm is armed leaves that alarm computed from a morning that no
        // longer exists, so everything built on it is discarded and the next
        // arming works it out again.
        //
        // Outside the transaction on purpose. A discard that fails leaves an
        // alarm on a stale time, which the next arming corrects; rolling the
        // routine back over it would lose the edit the user watched succeed.
        const schedules = await Schedule.findBy({ routineId: saved.id });
        await Promise.all(
            schedules.map((schedule) => this.occurrences.discardUpcoming(schedule)),
        );

        return saved;
    }

    /**
     * Deletes a routine unless a schedule still uses it.
     *
     * Returns the names of the schedules in the way, empty when it was deleted.
     * Same reasoning as places: the foreign key would refuse this anyway, and a
     * driver error is not an explanation.
     */
    async remove(routine: Routine): Promise<string[]> {
        const blocking = await Schedule.find({
            where: { deviceId: routine.deviceId, routineId: routine.id },
            select: { name: true },
        });

        if (blocking.length > 0) {
            return blocking.map((schedule) => schedule.name);
        }

        await routine.remove();
        return [];
    }
}

/**
 * Position in the submitted array is the order.
 *
 * The client sends the list as the user arranged it, so trusting an `order`
 * field would mean trusting two sources that can disagree. Duplicate or missing
 * values then decide the order arbitrarily, which reads as the app losing the
 * user's arrangement.
 */
function buildStep(
    step: { label: string; minutes: number; enabled: boolean },
    index: number,
): RoutineStep {
    return RoutineStep.create({
        label: step.label,
        minutes: step.minutes,
        order: index,
        enabled: step.enabled,
    });
}
