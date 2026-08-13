import express from 'express';
import type { Express } from 'express';

import registerRoutes from './app/routes/index';
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
