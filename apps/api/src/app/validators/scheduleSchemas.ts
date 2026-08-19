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
    /*
     * Bounded so a reminder chain cannot walk an alarm into the previous
     * evening. Optional with a default of one ring, so a client that predates
     * reminders keeps exactly the behaviour it was written against.
     */
    reminders: z
        .object({
            count: z.number().int().min(1).max(APP_CONSTANTS.ALARM.REMINDERS.MAX_COUNT),
            intervalMinutes: z
                .number()
                .int()
                .min(1)
                .max(APP_CONSTANTS.ALARM.REMINDERS.MAX_INTERVAL_MINUTES),
        })
        .optional(),
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
    .object({
        ...scheduleFields,
        /*
         * The defaulted fields, re-declared without their defaults.
         *
         * `.partial()` makes a key optional but does **not** stop a
         * `.default()` inside it from firing, so parsing `{ name: 'Gym' }`
         * came back with `originAccess`, `destinationAccess` and
         * `journeyOffset` filled in. Harmless for storage, since they were
         * given the values already held, but `affectsPlanning` decides on the
         * presence of a key, and every one of these is on its list.
         *
         * So every edit looked like a planning change: renaming a schedule
         * threw away its armed morning and spent an NS request rebuilding an
         * identical plan. That list exists precisely so renaming would not do
         * that, and its own comment says so.
         *
         * A default is right for creation, where an older client genuinely
         * omits the field and something has to be stored. On an update, an
         * absent key means "leave it alone", which is not a value.
         */
        originAccess: z.enum(AccessMode),
        destinationAccess: z.enum(AccessMode),
        journeyOffset: z.number().int().min(0).max(MAX_JOURNEY_OPTIONS - 1),
        active: z.boolean(),
    })
    .partial();
