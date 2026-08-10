import 'reflect-metadata';
import express from 'express';

import { env } from './config/app';
import { connectDatabase } from './database/typeorm-db';
import registerRoutes from './app/routes/index';
import { errorHandler } from './app/middleware/ErrorHandler';
import { notFound } from './app/middleware/NotFound';

async function bootstrap(): Promise<void> {
    // Connect before listening. A server that accepts requests it cannot serve
    // reports success while returning 500s, which is worse than starting a few
    // seconds later.
    await connectDatabase();

    const app = express();
    app.use(express.json({ limit: '256kb' }));

    const router = express.Router();
    registerRoutes(router);
    app.use(router);

    // Order matters: unmatched routes first, then the error handler, which must
    // be last to catch anything the routes threw.
    app.use(notFound);
    app.use(errorHandler);

    app.listen(env.port, () => {
        console.log(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);
    });
}

bootstrap().catch((error: unknown) => {
    console.error('Failed to start:', error);
    process.exit(1);
});
