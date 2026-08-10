import { z } from 'zod';
import { DevicePlatform } from '@alarm/types';

/**
 * Request shapes, validated at the edge.
 *
 * These mirror the DTOs in `@alarm/types`. The types describe what the app
 * intends to send; these check what actually arrived, which is not the same
 * thing once a request has crossed a network.
 */
export const registerDeviceSchema = z.object({
    platform: z.enum([DevicePlatform.ANDROID, DevicePlatform.IOS]),
    pushToken: z.string().min(1).max(255).optional(),
    timezone: z.string().min(1).max(64),
    appVersion: z.string().max(32),
});

export const updateDeviceSchema = z.object({
    // Explicitly nullable: clearing the push token is meaningful, and means
    // notification permission was revoked rather than never granted.
    pushToken: z.string().max(255).nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
    appVersion: z.string().max(32).optional(),
});
