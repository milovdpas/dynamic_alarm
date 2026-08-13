import 'reflect-metadata';
import type { Server } from 'node:http';
import type { Express } from 'express';

import { createApp } from './app';
import { env } from './config/app';
import { connectDatabase } from './database/typeorm-db';

/**
 * How many ports past the configured one to try before giving up.
 *
 * Bounded rather than open-ended. A machine with ten consecutive ports in use
 * has something wrong with it, and scanning upwards until something answers
 * would eventually land on a port that means something else entirely.
 */
const PORT_SCAN_LIMIT = 10;

async function bootstrap(): Promise<void> {
    // Connect before listening. A server that accepts requests it cannot serve
    // reports success while returning 500s, which is worse than starting a few
    // seconds later.
    await connectDatabase();

    const app = createApp();
    const port = await listenOnFreePort(app, env.port);

    console.log(`API listening on http://localhost:${port} (${env.nodeEnv})`);
    if (port !== env.port) {
        // Said twice, and loudly. The app and the Postman collections point at
        // the configured port, so a server that quietly moved is a morning
        // spent debugging requests that never arrive.
        console.warn(
            `Note: this is NOT the configured port ${env.port}. Point the app ` +
                `and any smoke script at ${port}, or free ${env.port} and restart.`,
        );
    }
}

/**
 * Listens on the configured port, or the next free one after it.
 *
 * Only in development, where the usual cause is another project already holding
 * the port and the useful response is to keep going and say so. In production
 * the port is what a reverse proxy forwards to, so moving would leave the
 * deployment running and unreachable, which looks like a healthy service and is
 * not one. There it fails instead.
 */
async function listenOnFreePort(app: Express, preferred: number): Promise<number> {
    const attempts = env.isProduction() ? 1 : PORT_SCAN_LIMIT;

    for (let port = preferred; port < preferred + attempts; port += 1) {
        const server = await tryListen(app, port);
        if (server !== null) {
            return port;
        }
        console.warn(`Port ${port} is already in use.`);
    }

    throw new Error(
        env.isProduction()
            ? `Port ${preferred} is already in use. Refusing to move: a reverse ` +
              'proxy forwards to a fixed port, so a server on another one is ' +
              'running and unreachable.'
            : `Ports ${preferred} to ${preferred + attempts - 1} are all in use.`,
    );
}

/** The listening server, or null when the port is taken. */
async function tryListen(app: Express, port: number): Promise<Server | null> {
    return new Promise((resolve, reject) => {
        const server = app.listen(port);

        server.once('listening', () => {
            resolve(server);
        });
        server.once('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
                resolve(null);
                return;
            }
            // Anything else (a permission problem, an invalid port) is not
            // something another attempt would fix.
            reject(error);
        });
    });
}

bootstrap().catch((error: unknown) => {
    console.error('Failed to start:', error instanceof Error ? error.message : error);
    process.exit(1);
});

