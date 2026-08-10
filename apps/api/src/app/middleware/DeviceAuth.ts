import type { NextFunction, Request, Response } from 'express';

import Device from '../models/Device.entity';
import { ApiError } from '../utils/ApiResponses';
import { hashDeviceToken } from '../utils/Token';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            /** Set by {@link deviceAuth}. Present on every protected route. */
            device?: Device;
        }
    }
}

/**
 * Resolves the bearer token to a device.
 *
 * The whole authentication model: no session, no refresh, no expiry. The token
 * is looked up by hash on each request, so revoking a device is a row delete
 * and takes effect immediately.
 *
 * `lastSeenAt` is updated without awaiting. A failed bookkeeping write should
 * never turn into a failed request, and nothing reads it synchronously.
 */
export async function deviceAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
        const header = req.header('authorization');
        if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
            throw ApiError.unauthorized();
        }

        const token = header.slice('bearer '.length).trim();
        if (token === '') {
            throw ApiError.unauthorized();
        }

        const device = await Device.findOneBy({ tokenHash: hashDeviceToken(token) });
        if (device === null) {
            throw ApiError.unauthorized();
        }

        req.device = device;

        void Device.update(device.id, { lastSeenAt: new Date() }).catch(() => undefined);

        next();
    } catch (error) {
        next(error);
    }
}

/** The authenticated device, or a clear failure rather than a vague one. */
export function requireDevice(req: Request): Device {
    if (req.device === undefined) {
        throw ApiError.unauthorized();
    }
    return req.device;
}
