import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@alarm/types';

import { env } from '../../config/app';
import { sendError } from '../utils/ApiResponses';

/**
 * Guards the monitor tick, which is called by the scheduler and by nobody else.
 *
 * Device tokens are wrong here: the tick belongs to no device, and handing the
 * scheduler a device's credential would let a stolen phone token drive the loop
 * for everyone. This is a separate shared secret, set once in the deployment's
 * environment.
 *
 * **An unset token closes the route rather than opening it.** The endpoint sits
 * on a public domain behind the same proxy as everything else, so treating
 * "not configured" as "no check needed" would leave a stranger able to spend
 * this deployment's entire NS quota in a loop. Refusing instead means a
 * misconfigured deployment stops moving alarms and says so in the scheduler's
 * log, which is visible, where the other failure is not.
 */
export function monitorAuth(req: Request, res: Response, next: NextFunction): void {
    const expected = env.monitorToken;
    if (expected === '') {
        sendError(
            res,
            ERROR_CODES.INTERNAL_ERROR,
            'MONITOR_TOKEN is not configured, so the monitor cannot run.',
            503,
        );
        return;
    }

    const provided = req.header('x-monitor-token') ?? '';
    if (!matches(provided, expected)) {
        sendError(res, ERROR_CODES.UNAUTHORIZED, 'Missing or invalid monitor token', 401);
        return;
    }

    next();
}

/**
 * Constant time for equal lengths, and length is compared first.
 *
 * `timingSafeEqual` throws on a length mismatch, so that case has to be handled
 * anyway. Leaking the length of a secret that is generated once and never typed
 * is not worth padding around.
 */
function matches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}
