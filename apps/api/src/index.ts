import 'reflect-metadata';
import type { Server } from 'node:http';
import type { Express } from 'express';

import { createApp } from './app';
import { env } from './config/app';
import { closeDatabase, connectDatabase } from './database/typeorm-db';

/**
 * How many ports past the configured one to try before giving up.
 *
 * Bounded rather than open-ended. A machine with ten consecutive ports in use
 * has something wrong with it, and scanning upwards until something answers
 * would eventually land on a port that means something else entirely.
 */
const PORT_SCAN_LIMIT = 10;

/**
 * How long a shutdown waits for requests already in flight.
 *
 * Shorter than the orchestrator's own grace period, so the process finishes on
 * its own terms rather than being killed mid-write. Long enough for an arming
 * request, which plans a journey against NS and TomTom before it can answer.
 */
const SHUTDOWN_GRACE_MS = 20000;

async function bootstrap(): Promise<void> {
    // Connect before listening. A server that accepts requests it cannot serve
    // reports success while returning 500s, which is worse than starting a few
    // seconds later.
    await connectDatabase();

    const app = createApp();
    const { server, port } = await listenOnFreePort(app, env.port);
    installShutdownHandlers(server);

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
async function listenOnFreePort(
    app: Express,
    preferred: number,
): Promise<{ server: Server; port: number }> {
    const attempts = env.isProduction() ? 1 : PORT_SCAN_LIMIT;

    for (let port = preferred; port < preferred + attempts; port += 1) {
        const server = await tryListen(app, port);
        if (server !== null) {
            return { server, port };
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

/**
 * Stops on request, rather than being killed for not stopping.
 *
 * Node installs no default `SIGTERM` handler when it is PID 1, which it is in
 * the container. Without this, `docker stop` waits out its grace period and then
 * sends `SIGKILL`, which can land in the middle of a monitor pass: the claim
 * lease is written, the occurrence is half updated, and the row sits unclaimable
 * for five minutes while the alarm it belongs to gets no closer.
 *
 * The order is the point. Stop accepting, let what is in flight finish, then
 * close the pool. Closing the database first would fail the very requests this
 * is trying to protect.
 *
 * Idempotent, because an orchestrator that loses patience sends the signal
 * again, and a second shutdown starting on top of the first is how a clean stop
 * turns into a hang.
 */
function installShutdownHandlers(server: Server): void {
    let stopping = false;

    const shutdown = (signal: NodeJS.Signals): void => {
        if (stopping) {
            return;
        }
        stopping = true;
        console.log(`${signal} received, finishing in-flight requests.`);

        // Belt and braces: if a request never completes, the process still goes
        // rather than hanging until the orchestrator kills it. Unreferenced so
        // it cannot be the thing keeping the process alive.
        const giveUp = setTimeout(() => {
            console.warn('Requests did not finish in time. Exiting anyway.');
            process.exit(1);
        }, SHUTDOWN_GRACE_MS);
        giveUp.unref();

        server.close((error) => {
            void (async () => {
                if (error !== undefined) {
                    console.error('Server did not close cleanly:', error);
                }
                try {
                    await closeDatabase();
                } catch (closeError) {
                    console.error('Database did not close cleanly:', closeError);
                }
                clearTimeout(giveUp);
                process.exit(error === undefined ? 0 : 1);
            })();
        });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

bootstrap().catch((error: unknown) => {
    console.error('Failed to start:', error instanceof Error ? error.message : error);
    process.exit(1);
});

