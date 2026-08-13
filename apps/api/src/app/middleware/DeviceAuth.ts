import type { NextFunction, Request, Response } from 'express';
import Device from '../models/Device.entity';
import { sendUnauthorized } from '../utils/ApiResponses';
import { hashDeviceToken } from '../utils/Token';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            /**
             * Set by {@link deviceAuth}.
             *
             * Declared as always present rather than optional. It is a small
             * lie for the one route without the middleware, which does not
             * read it, and the alternative was a narrowing wrapper around
             * every handler to restate what the route already says.
             */
            device: Device;
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
 * Answers directly rather than throwing. Middleware holds the response, so
 * writing the 401 here is the shortest path to it, and there is nothing further
 * down that could usefully reinterpret a missing credential.
 *
 * A database failure is the exception, and is deliberately not folded into the
 * 401. Telling someone their token is invalid when the database is unreachable
 * sends them to re-register and lose their schedules over an outage that had
 * nothing to do with them, so that case goes to the error handler as the 500 it
 * is.
 *
 * `lastSeenAt` is updated without awaiting. Failed bookkeeping should never turn
 * into a failed request, and nothing reads it synchronously.
 */
export async function deviceAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const header = req.header('authorization');
    if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
        sendUnauthorized(res);
        return;
    }

    const token = header.slice('bearer '.length).trim();
    if (token === '') {
        sendUnauthorized(res);
        return;
    }

    let device: Device | null;
    try {
        device = await Device.findOneBy({ tokenHash: hashDeviceToken(token) });
    } catch (error) {
        next(error);
        return;
    }

    if (device === null) {
        sendUnauthorized(res);
        return;
    }

    req.device = device;
    void Device.update(device.id, { lastSeenAt: new Date() }).catch(() => undefined);

    next();
}


