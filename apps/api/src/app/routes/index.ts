import type { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';
import type { HealthResponse, IpDebugResponse } from '@alarm/types';

import { env } from '../../config/app';
import { AppDataSource } from '../../database/typeorm-db';
import { ipDebugLimit } from '../middleware/ApiLimits';
import { describeAddress } from '../utils/AddressDiagnostics';
import Api from './api';

/** Long for a `SELECT 1`, short against any sensible probe interval. */
const HEALTH_QUERY_TIMEOUT_MS = 2000;

export default (router: Router): void => {
    /**
     * Health check, and the one response deliberately outside the envelope.
     *
     * Load balancers and uptime checks read this, and none of them know about
     * `{ success, data }`. The status code carries the same answer, so nothing
     * is lost by staying plain.
     *
     * The database is reported separately rather than folded into one boolean.
     * A process that is up but cannot reach MySQL is exactly the state where the
     * monitor loop stops moving alarms, and "ok" would hide it.
     *
     * It is **asked**, not assumed. This used to read `isInitialized`, which is
     * set once at startup and stays true for the rest of the process however
     * dead the connection becomes, so the one state the check exists to catch
     * was the one state it could not report.
     */
    router.get(API_ENDPOINTS.HEALTH, async (_req, res) => {
        const database = await databaseReachable();
        const body: HealthResponse = {
            status: database ? 'ok' : 'degraded',
            database,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        };
        res.status(database ? 200 : 503).json(body);
    });

    /**
     * What this deployment sees of a caller's address. Diagnostic, off by
     * default, and meant to be short-lived.
     *
     * Outside the envelope and outside `deviceAuth`, like health, because the
     * question it answers is about the network in front of the process rather
     * than about anything in the database. It has to be callable from a phone on
     * mobile data, which is the only client whose real address is worth
     * comparing against.
     *
     * Unauthenticated, so it is limited on the socket address, which is the one
     * thing about a request that cannot be chosen by the caller. Credentials are
     * stripped from the echoed headers; everything left is the caller's own
     * request handed back, which is not a secret from the caller.
     *
     * **Set `IP_DIAGNOSTIC=false` again once `TRUST_PROXY_HOPS` has been settled
     * against the real deployment.** It exists to answer one question, and a
     * diagnostic that outlives its question is a permanent description of the
     * infrastructure for anyone who asks for it.
     */
    if (env.ipDiagnostic()) {
        mountIpDiagnostic(router);
    }

    router.use(new Api().getRoutes());
};

/**
 * Mounted only when `IP_DIAGNOSTIC=true`, and meant to be switched off again.
 *
 * Behind a flag rather than a comment saying "temporary". The route reflects the
 * proxy chain and every non-credential header back to an unauthenticated caller,
 * which is what makes it answer the question and what makes it the wrong thing
 * to leave running. A flag turns it off without a deploy, and a deployment that
 * never sets it never serves it at all.
 */
function mountIpDiagnostic(router: Router): void {
    console.warn(
        'IP_DIAGNOSTIC is on, so GET /api/v1/ip is being served. Turn it off once ' +
            'TRUST_PROXY_HOPS has been settled.',
    );

    router.get(API_ENDPOINTS.IP, ipDebugLimit, (req, res) => {
        const body: IpDebugResponse = describeAddress(req);
        // Logged as well as returned. The response goes to whoever called, and
        // the interesting call is usually the one made from a phone that is not
        // the machine with the terminal open.
        console.log(
            `[ip] resolved=${body.resolvedIp} socket=${body.socket.address ?? 'none'} ` +
                `xff=${body.forwarded.raw ?? 'none'} hops=${String(body.trustProxy.configuredHops)}`,
        );
        res.status(200).json(body);
    });
}

/**
 * Whether MySQL answers, right now.
 *
 * Bounded, because an unreachable database usually means a request that hangs
 * rather than one that fails, and a health check that hangs reads as healthy to
 * a load balancer waiting on it. Two seconds is far longer than a `SELECT 1` on
 * a live pool and far shorter than any sensible probe interval.
 */
async function databaseReachable(): Promise<boolean> {
    if (!AppDataSource.isInitialized) {
        return false;
    }

    try {
        await Promise.race([
            AppDataSource.query('SELECT 1'),
            new Promise((_resolve, reject) => {
                setTimeout(() => {
                    reject(new Error('Health check timed out'));
                }, HEALTH_QUERY_TIMEOUT_MS).unref();
            }),
        ]);
        return true;
    } catch (error) {
        console.error('Health check could not reach the database:', error);
        return false;
    }
}
