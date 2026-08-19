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

/** How stale `lastSeenAt` may get before another write is worth it. */
const LAST_SEEN_INTERVAL_MS = 60 * 1000;

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
 * `lastSeenAt` is updated without awaiting, and at most once a minute per
 * device. Failed bookkeeping should never turn into a failed request, and
 * nothing reads it synchronously. The interval is what stops a screen that
 * fetches four things on open turning into four writes: the column exists to
 * spot a device that has gone quiet for days, so a minute's resolution is
 * already far finer than anything asks of it.
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
    touch(device);

    next();
}

/**
 * Records that this device is alive, unless it very recently did.
 *
 * Compared against the value already on the row rather than kept in memory, so
 * a restart or a second instance does not reset the interval and the check
 * costs nothing extra: the row was just read.
 */
function touch(device: Device): void {
    const now = new Date();
    const seen = device.lastSeenAt;
    if (seen !== null && now.getTime() - seen.getTime() < LAST_SEEN_INTERVAL_MS) {
        return;
    }

    // Written to the in-memory copy too, so a handler reading it sees the same
    // answer the database is about to hold.
    device.lastSeenAt = now;
    void Device.update(device.id, { lastSeenAt: now }).catch(() => undefined);
}
