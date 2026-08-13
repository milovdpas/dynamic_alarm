import { z } from 'zod';
import {
    AccessMode,
    APP_CONSTANTS,
    MAX_JOURNEY_OPTIONS,
    TransportMode,
    Weekday,
} from '@alarm/types';

/** `HH:mm` in the schedule's own timezone, not an instant. */
export const localTimeSchema = z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time as HH:mm');

const bufferMinutes = z.number().int().min(0).max(APP_CONSTANTS.BUFFERS.MAX_MINUTES);

export const bufferConfigSchema = z.object({
    arrivalMinutes: bufferMinutes,
    preDepartureMinutes: bufferMinutes,
    transferMinutes: bufferMinutes,
    wakeSlackMinutes: bufferMinutes,
});

/**
 * Deduplicated, because the same day twice would arm two occurrences for one
 * morning and ring twice.
 */
const daysOfWeekSchema = z
    .array(z.enum(Weekday))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, 'Days must be unique');

const scheduleFields = {
    name: z.string().trim().min(1).max(64),
    originPlaceId: z.uuid(),
    destinationPlaceId: z.uuid(),
    routineId: z.uuid(),
    arrivalTime: localTimeSchema,
    daysOfWeek: daysOfWeekSchema,
    mode: z.enum(TransportMode),
    // Optional, defaulting to walking, so an older client that knows nothing
    // about access modes keeps the behaviour it was written against rather than
    // failing validation.
    originAccess: z.enum(AccessMode).default(AccessMode.WALK),
    destinationAccess: z.enum(AccessMode).default(AccessMode.WALK),
    // Bounded by what the options endpoint offers. A larger number is not
    // wrong, it just clamps, but accepting it would let a client store a
    // preference nothing can ever show it.
    journeyOffset: z.number().int().min(0).max(MAX_JOURNEY_OPTIONS - 1).default(0),
    fixedTravelMinutes: z.number().int().min(0).max(24 * 60).optional(),
    buffers: bufferConfigSchema,
    timezone: z.string().min(1).max(64),
};

export const createScheduleSchema = z
    .object(scheduleFields)
    .refine(
        (input) =>
            input.mode !== TransportMode.FIXED || input.fixedTravelMinutes !== undefined,
        {
            // FIXED has no provider to ask, so without this number there is no
            // travel time at all and the wake time cannot be computed.
            message: 'A fixed-travel schedule needs fixedTravelMinutes',
            path: ['fixedTravelMinutes'],
        },
    )
    .refine((input) => input.originPlaceId !== input.destinationPlaceId, {
        message: 'Origin and destination must be different places',
        path: ['destinationPlaceId'],
    });

/**
 * A partial update cannot be checked the same way.
 *
 * Whether the result is coherent depends on the stored row as much as on the
 * payload, so switching to `FIXED` without a duration is only visible once the
 * two are merged. That check lives in `ScheduleService.update`.
 */
export const updateScheduleSchema = z
    .object({ ...scheduleFields, active: z.boolean() })
    .partial();
