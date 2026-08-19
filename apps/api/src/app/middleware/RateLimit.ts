import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_CODES } from '@alarm/types';

import { sendError } from '../utils/ApiResponses';

/**
 * A ceiling on how often one caller may ask.
 *
 * This exists for one reason: NS allows **300 requests per 5 minutes** across
 * every user of this deployment, and until now nothing stopped a single caller
 * spending all of it. Autosuggest sat behind `deviceAuth` for exactly that
 * reason, which is a real protection right up to the moment you notice that
 * registration hands out a device token to anyone who asks, unauthenticated and
 * unlimited. One request buys a credential, and the credential buys the whole
 * deployment's rail-planning budget.
 *
 * **In memory, like `ProviderUsage`, and for the same reasons.** A second API
 * instance counts separately, so the effective ceiling is per instance rather
 * than global. That is the wrong shape for enforcement and the right shape for
 * this: the deployment runs one container, the alternative is a write to MySQL
 * on every request to protect against requests, and NS's own 429 remains the
 * number that actually binds. If this ever runs behind more than one instance,
 * the limits below are a floor rather than a promise.
 *
 * Fixed windows rather than a sliding log. A caller can send twice the limit
 * across a window boundary, which for these numbers is a rounding error against
 * a budget measured in hundreds, and a sliding log would keep a timestamp per
 * request for every caller in order to say the same thing.
 */

/** One caller's usage of one limiter. */
interface Window {
    /** When the current window ends, in epoch milliseconds. */
    resetAt: number;
    count: number;
}

export interface RateLimitOptions {
    /** Requests allowed per window. */
    limit: number;
    windowMs: number;
    /**
     * Who is being limited. Returning null exempts the request, which is how a
     * limiter keyed on a device skips anything that never reached `deviceAuth`.
     */
    key: (req: Request) => string | null;
    /** Named in the log line, so a tripped limit says which one. */
    name: string;
}

/**
 * Callers are pruned lazily, never on a timer.
 *
 * A timer would be a second thing to shut down cleanly. A caller's own entry is
 * checked for expiry on the request that touches it, and callers who never come
 * back are reclaimed by a sweep that runs only once the map has grown past
 * {@link SWEEP_THRESHOLD}, then not again until it has doubled.
 */
const buckets = new Map<string, Map<string, Window>>();

/**
 * How many callers one limiter tracks before a sweep is worth doing.
 *
 * Far above anything this deployment sees, so in practice the sweep never runs
 * and the map holds a handful of entries. It exists so that the cost of an
 * unauthenticated route cannot be made to grow by whoever calls it.
 */
const SWEEP_THRESHOLD = 1024;

export function rateLimit(options: RateLimitOptions): RequestHandler {
    const windows = new Map<string, Window>();
    buckets.set(options.name, windows);

    /**
     * The size at which a full sweep is worth its cost, doubling after each one.
     *
     * Sweeping on every request made the per-request cost grow with the number
     * of callers seen inside a window, and `registrationLimit` is the one that
     * matters: unauthenticated, keyed on address, and holding an entry for a
     * full hour. Doubling means a sweep happens once per n/2 new callers rather
     * than once per request, so the amortised cost is constant and the map stays
     * bounded by roughly twice what is genuinely live.
     */
    let sweepAbove = SWEEP_THRESHOLD;

    return (req: Request, res: Response, next: NextFunction) => {
        const key = options.key(req);
        if (key === null) {
            next();
            return;
        }

        const now = Date.now();
        if (windows.size > sweepAbove) {
            prune(windows, now);
            sweepAbove = Math.max(SWEEP_THRESHOLD, windows.size * 2);
        }

        // This caller's own entry is always checked for expiry below, so the
        // sweep above is only ever about reclaiming callers who never came back.
        const existing = windows.get(key);
        const window: Window =
            existing === undefined || existing.resetAt <= now
                ? { resetAt: now + options.windowMs, count: 0 }
                : existing;

        window.count += 1;
        windows.set(key, window);

        if (window.count > options.limit) {
            const retryAfter = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
            // Warned rather than silent. A limit tripping in normal use means
            // the limit is wrong, and that is only visible if it says so.
            console.warn(
                `Rate limit "${options.name}" tripped: ${String(window.count)} requests ` +
                    `against a ceiling of ${String(options.limit)}. Retry in ${String(retryAfter)}s.`,
            );
            res.setHeader('Retry-After', String(retryAfter));
            sendError(
                res,
                ERROR_CODES.RATE_LIMITED,
                'Too many requests. Try again shortly.',
                429,
            );
            return;
        }

        next();
    };
}

/** Only for tests, which would otherwise inherit each other's counts. */
export function resetRateLimits(): void {
    for (const windows of buckets.values()) {
        windows.clear();
    }
}

function prune(windows: Map<string, Window>, now: number): void {
    for (const [key, window] of windows) {
        if (window.resetAt <= now) {
            windows.delete(key);
        }
    }
}

/**
 * The caller's address, for limiters that run before there is a device.
 *
 * **This is only as trustworthy as `TRUST_PROXY_HOPS` is correct.** `req.ip` is
 * the real client when Express has been told exactly how many proxies sit in
 * front, and something else entirely when it has not. Too high and a caller
 * chooses their own key by sending an `X-Forwarded-For` header, which makes the
 * limit decorative. Too low and everybody behind the proxy shares one bucket,
 * which makes it an outage.
 *
 * The number was a guess until `GET /api/v1/ip` was added to measure it: call
 * that from a phone against the real deployment and its `candidates` table names
 * the setting whose resolved address matches. Until that has been done in
 * production, treat this key as unverified.
 */
export function addressOf(req: Request): string {
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/**
 * The TCP peer, for the one limiter that must not depend on a header.
 *
 * `addressOf` is the right key for everything else and the wrong key for the
 * address diagnostic, which exists precisely because nobody yet knows whether
 * `req.ip` can be chosen by the caller. Keying that endpoint on something
 * spoofable would let one caller hold the whole bucket while investigating
 * whether they can.
 *
 * Behind a proxy this is the proxy, so the diagnostic shares one bucket across
 * everybody. That is correct for a route nothing legitimate calls in a loop.
 */
export function socketAddressOf(req: Request): string {
    return req.socket.remoteAddress ?? 'unknown';
}

/**
 * The authenticated device, for limiters that guard provider spending.
 *
 * Null before `deviceAuth` has run, which exempts the request rather than
 * lumping every anonymous caller into one bucket under the same key.
 */
export function deviceOf(req: Request): string | null {
    return (req.device as typeof req.device | undefined)?.id ?? null;
}
