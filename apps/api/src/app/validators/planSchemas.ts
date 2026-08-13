import { z } from 'zod';
import { TransportMode } from '@alarm/types';

import { bufferConfigSchema, localTimeSchema } from './scheduleSchemas';

const geoPointSchema = z.object({
    lat: z.number().min(50.5).max(53.8),
    lng: z.number().min(3.2).max(7.3),
});

/**
 * Onboarding's preview: coordinates rather than saved places, because the user
 * has not committed to anything yet and should not have to before seeing what
 * the app would do for them.
 */
export const planPreviewSchema = z
    .object({
        origin: geoPointSchema,
        destination: geoPointSchema,
        arrivalTime: localTimeSchema,
        /** Omitted means the next time this clock reading comes round. */
        date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
            .optional(),
        mode: z.enum(TransportMode),
        fixedTravelMinutes: z.number().int().min(0).max(24 * 60).optional(),
        routineMinutes: z.number().int().min(0).max(12 * 60),
        buffers: bufferConfigSchema,
        timezone: z.string().min(1).max(64),
    })
    .refine(
        (input) =>
            input.mode !== TransportMode.FIXED || input.fixedTravelMinutes !== undefined,
        {
            message: 'A fixed-travel preview needs fixedTravelMinutes',
            path: ['fixedTravelMinutes'],
        },
    );
