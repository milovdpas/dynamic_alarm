import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';

import registerRoutes from './app/routes/index';
import { env } from './config/app';
import { errorHandler } from './app/middleware/ErrorHandler';
import { notFound } from './app/middleware/NotFound';

/**
 * Builds the app without starting it.
 *
 * Separate from `index.ts` so tests can drive the real routing, validation and
 * error handling over an ephemeral port instead of reasoning about controllers
 * in isolation. Most of the bugs this API has produced lived in that seam: a
 * driver returning decimals as strings, a MySQL TIME arriving as `08:30:00`,
 * Express matching `:id` before a literal path. None are visible from a unit
 * test of a service, and all of them are one request away from obvious.
 */
export function createApp(): Express {
    const app = express();

    /**
     * How many proxies sit in front, and never a guess.
     *
     * `req.ip` is the socket's address unless Express is told otherwise, and the
     * rate limiters key on it. Trusting a proxy that is not there lets a caller
     * choose their own key with an `X-Forwarded-For` header, which turns the
     * limit into an inconvenience. Trusting none when one is there puts every
     * caller in the same bucket behind the proxy's address, which turns it into
     * an outage. So it is configuration, defaulting to the truth in each
     * environment: nothing in front locally, one nginx in production.
     */
    app.set('trust proxy', env.trustProxyHops);

    // Nothing gains from announcing the framework, and it is one fewer hint for
    // anyone matching a version against a list of its vulnerabilities.
    app.disable('x-powered-by');
    app.use(securityHeaders);

    app.use(express.json({ limit: '256kb' }));

    const router = express.Router();
    registerRoutes(router);
    app.use(router);

    // Order matters: unmatched routes first, then the error handler, which must
    // be last to catch anything the routes threw.
    app.use(notFound);
    app.use(errorHandler);

    return app;
}

/**
 * The two headers a JSON-only API actually needs.
 *
 * Not `helmet`. Most of what it sets governs how a browser renders a document,
 * and nothing here serves one: there is no HTML, no cookies, no CORS headers,
 * and therefore no cross-origin caller a browser would let read a response. The
 * two below still earn their place. `nosniff` stops a response being re-read as
 * something executable, and `no-referrer` keeps our paths, which contain
 * occurrence and schedule ids, out of the logs of anywhere a link might lead.
 *
 * HSTS is deliberately absent: TLS terminates at the reverse proxy, and the
 * header belongs with whoever owns the certificate.
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
}
