import { z } from 'zod';
import { APP_CONSTANTS } from '@alarm/types';

/**
 * A step, without an order field. Position in the array is the order.
 *
 * Zero minutes is allowed. A step that takes no time is a checklist item ("take
 * medication"), and forbidding it would push the user into inventing a minute
 * that then quietly moves their alarm.
 */
const routineStepSchema = z.object({
    label: z.string().trim().min(1).max(APP_CONSTANTS.ROUTINE.MAX_LABEL_LENGTH),
    minutes: z.number().int().min(0).max(APP_CONSTANTS.ROUTINE.MAX_STEP_MINUTES),
    enabled: z.boolean(),
});

export const createRoutineSchema = z.object({
    name: z.string().trim().min(1).max(64),
    steps: z.array(routineStepSchema).min(1).max(APP_CONSTANTS.ROUTINE.MAX_STEPS),
});

/**
 * Every field optional, so renaming a routine does not require sending its
 * steps back. When `steps` is present it replaces the list entirely.
 */
export const updateRoutineSchema = createRoutineSchema.partial();
