import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@alarm/types';

import { rateLimit, resetRateLimits } from '../src/app/middleware/RateLimit';

/**
 * The limiter itself, driven directly rather than over HTTP.
 *
 * The rest of the suite exercises it through real routes, which is the right
 * way to check that a route is guarded at all. This file is about the mechanism:
 * window expiry, key isolation, and the amortised sweep, none of which can be
 * reached through supertest without a thousand distinct source addresses and a
 * clock nobody can move.
 */

/** A request carrying nothing but the key this limiter reads off it. */
function requestFrom(who: string): Request {
    return { who } as unknown as Request;
}

/** Captures what `sendError` did, which is all these tests need of a response. */
function responseSpy() {
    const captured = { status: 0, code: '', retryAfter: '' };
    const res = {
        setHeader: (name: string, value: string) => {
            if (name === 'Retry-After') {
                captured.retryAfter = value;
            }
        },
        status: (status: number) => {
            captured.status = status;
            return res;
        },
        json: (body: { code: string }) => {
            captured.code = body.code;
            return res;
        },
    } as unknown as Response;
    return { res, captured };
}

/** Runs one request through, and says whether it was allowed past. */
function call(
    limiter: ReturnType<typeof rateLimit>,
    who: string,
): { allowed: boolean; status: number; code: string; retryAfter: string } {
    const { res, captured } = responseSpy();
    let allowed = false;
    limiter(requestFrom(who), res, (() => {
        allowed = true;
    }) as NextFunction);
    return { allowed, ...captured };
}

function limiterFor(limit: number, windowMs: number, name: string) {
    return rateLimit({
        name,
        limit,
        windowMs,
        key: (req) => (req as unknown as { who: string | null }).who,
    });
}

afterEach(() => {
    vi.useRealTimers();
    resetRateLimits();
});

describe('counting inside a window', () => {
    it('allows up to the limit and refuses the one after', () => {
        const limiter = limiterFor(3, 60_000, 'test-basic');

        expect(call(limiter, 'a').allowed).toBe(true);
        expect(call(limiter, 'a').allowed).toBe(true);
        expect(call(limiter, 'a').allowed).toBe(true);

        const refused = call(limiter, 'a');
        expect(refused.allowed).toBe(false);
        expect(refused.status).toBe(429);
        expect(refused.code).toBe(ERROR_CODES.RATE_LIMITED);
        // Says when, rather than leaving a client to retry into the same wall.
        expect(Number(refused.retryAfter)).toBeGreaterThan(0);
    });

    it('counts each caller separately', () => {
        const limiter = limiterFor(1, 60_000, 'test-isolation');

        expect(call(limiter, 'a').allowed).toBe(true);
        expect(call(limiter, 'a').allowed).toBe(false);
        // A ceiling that punished the wrong caller would be worse than none.
        expect(call(limiter, 'b').allowed).toBe(true);
    });

    it('exempts a request whose key is null rather than pooling them', () => {
        // How a device-keyed limiter skips anything that never reached
        // `deviceAuth`, instead of putting every anonymous caller in one bucket.
        const limiter = limiterFor(1, 60_000, 'test-exempt');

        for (let attempt = 0; attempt < 10; attempt += 1) {
            expect(call(limiter, null as unknown as string).allowed).toBe(true);
        }
    });
});

describe('when a window has passed', () => {
    it('gives the caller a fresh allowance', () => {
        vi.useFakeTimers();
        const limiter = limiterFor(1, 60_000, 'test-expiry');

        expect(call(limiter, 'a').allowed).toBe(true);
        expect(call(limiter, 'a').allowed).toBe(false);

        vi.advanceTimersByTime(60_001);

        // The per-key expiry check, which is what the sweep must never be
        // responsible for: it now runs on almost every request without one.
        expect(call(limiter, 'a').allowed).toBe(true);
    });
});

describe('the amortised sweep', () => {
    /**
     * The sweep used to run on every request, so the cost of an unauthenticated
     * route grew with the number of callers seen inside its window, and
     * `registrationLimit` holds an entry for a full hour. It now runs only past
     * a threshold and then not again until the map has doubled.
     *
     * What is asserted here is that the change did not cost correctness. The
     * saving itself is unobservable from outside, which is the point: it is
     * insurance rather than a fix for anything visible today.
     */
    const MANY = 3000;

    it('still enforces a limit after far more callers than the threshold', () => {
        const limiter = limiterFor(2, 60_000, 'test-sweep-enforce');

        for (let caller = 0; caller < MANY; caller += 1) {
            expect(call(limiter, `caller-${String(caller)}`).allowed).toBe(true);
        }

        // One of them comes back and uses the rest of its allowance.
        expect(call(limiter, 'caller-7').allowed).toBe(true);
        expect(call(limiter, 'caller-7').allowed).toBe(false);
    });

    it('still expires a caller once the sweep has run over it', () => {
        vi.useFakeTimers();
        const limiter = limiterFor(1, 60_000, 'test-sweep-expiry');

        expect(call(limiter, 'a').allowed).toBe(true);
        expect(call(limiter, 'a').allowed).toBe(false);

        // Enough distinct callers to push the map past the threshold, so the
        // sweep runs and reclaims everything including this caller's entry.
        vi.advanceTimersByTime(60_001);
        for (let caller = 0; caller < MANY; caller += 1) {
            call(limiter, `caller-${String(caller)}`);
        }

        expect(call(limiter, 'a').allowed).toBe(true);
    });

    it('does not let a swept caller lose an allowance it is still using', () => {
        vi.useFakeTimers();
        const limiter = limiterFor(2, 60_000, 'test-sweep-live');

        expect(call(limiter, 'a').allowed).toBe(true);

        // The map grows past the threshold well inside `a`'s window, so a sweep
        // runs while its entry is still live. Reclaiming it would hand back an
        // allowance that had already been spent.
        vi.advanceTimersByTime(1000);
        for (let caller = 0; caller < MANY; caller += 1) {
            call(limiter, `caller-${String(caller)}`);
        }

        expect(call(limiter, 'a').allowed).toBe(true);
        expect(call(limiter, 'a').allowed).toBe(false);
    });
});
