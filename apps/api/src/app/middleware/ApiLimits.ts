import { addressOf, deviceOf, rateLimit, socketAddressOf } from './RateLimit';

/**
 * The ceilings themselves, kept apart from the mechanism that enforces them.
 *
 * The first two are derived from the one limit that is not ours to choose: NS
 * allows 300 requests per 5 minutes across every user of this deployment.
 */

const MINUTE = 60 * 1000;

/**
 * Registration, which is the only unauthenticated route in the API.
 *
 * It has to be open, because it is what issues the credential every other route
 * requires. That makes it the way in: a caller with no token spends one request
 * here and then has a device, and a device may search addresses, preview plans
 * and arm mornings, all of which cost NS calls from a budget the whole
 * deployment shares.
 *
 * Keyed by address, generously, because a real phone registers once per install
 * and an office behind one NAT might legitimately do so a handful of times in an
 * afternoon. Twenty an hour is far above that and far below useful for anyone
 * farming tokens.
 */
export const registrationLimit = rateLimit({
    name: 'device-registration',
    limit: 20,
    windowMs: 60 * MINUTE,
    key: addressOf,
});

/**
 * Everything that spends a provider call, per device.
 *
 * One limiter across all of them rather than one each, because the budget they
 * draw on is one budget: sixty address lookups and sixty plan previews cost the
 * same hundred and twenty NS requests, and limiting them separately would let a
 * caller have both.
 *
 * The window matches NS's own so the arithmetic is legible: at sixty, one device
 * can reach a fifth of the shared ceiling, which leaves room for the monitor
 * loop and for everybody else. Ordinary use is nowhere near it. Typing an
 * address with the client's debounce is a handful of requests, onboarding is a
 * preview and an options call, and arming a morning is one.
 */
export const providerLimit = rateLimit({
    name: 'provider-spending',
    limit: 60,
    windowMs: 5 * MINUTE,
    key: deviceOf,
});

/**
 * The address diagnostic, which is unauthenticated and reflects a request back.
 *
 * Keyed on the socket rather than on `req.ip`, because the whole reason the
 * route exists is that nobody yet knows whether `req.ip` can be chosen by the
 * caller. A limiter on the value under investigation would be no limiter at all.
 *
 * Tight, because nothing legitimate calls this more than a handful of times: a
 * person with a phone, checking an answer.
 */
export const ipDebugLimit = rateLimit({
    name: 'ip-diagnostic',
    limit: 30,
    windowMs: 5 * MINUTE,
    key: socketAddressOf,
});
