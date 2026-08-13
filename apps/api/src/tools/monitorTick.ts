import { API_ENDPOINTS } from '@alarm/types';
import type { MonitorTickResponse } from '@alarm/types';

import { env } from '../config/app';

/**
 * Drives one monitor tick against the API running in this same container.
 *
 * The scheduler runs this once a minute (`docker-compose.prod.yml` declares it
 * as an Ofelia label, so the schedule deploys with the code). It exists as a
 * tiny client rather than as the loop itself for one reason: the loop needs the
 * database pool and the provider caches that the running process already holds.
 * A fresh process each minute would reconnect to an external MySQL across the
 * internet to discover, most minutes, that there is nothing to do.
 *
 * It is also the local way to force a tick: `npm run tick -w @alarm/api`.
 *
 * The token comes from the environment, never from the command line. An
 * argument would put the secret in the compose labels and in `docker inspect`;
 * the container already has it, so there is no reason to pass it around.
 */
async function main(): Promise<void> {
    if (env.monitorToken === '') {
        console.error('MONITOR_TOKEN is not set, so the tick cannot authenticate.');
        process.exitCode = 1;
        return;
    }

    // 127.0.0.1 rather than localhost: Node binds IPv4 only, and a resolver that
    // tries ::1 first gets a refused connection from a perfectly healthy server.
    const url = `http://127.0.0.1:${String(env.port)}${API_ENDPOINTS.MONITOR.TICK}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'X-Monitor-Token': env.monitorToken },
    });

    if (!response.ok) {
        // Non-zero, so the scheduler's log shows a failed job rather than a
        // successful one that happened to print an error.
        console.error(`Tick failed: ${String(response.status)} ${await response.text()}`);
        process.exitCode = 1;
        return;
    }

    const result = (await response.json()) as MonitorTickResponse;
    if (result.skipped) {
        console.log('Tick skipped: the previous one is still running.');
        return;
    }

    // One line, because a minute of these is read as a column. Quiet nights are
    // the normal case and should look boring.
    console.log(
        `Tick: claimed ${String(result.claimed)}, moved ${String(result.moved)}, ` +
            `unchanged ${String(result.unchanged)}, failed ${String(result.failed)} ` +
            `in ${String(result.durationMs)}ms.`,
    );

    if (result.failed > 0) {
        process.exitCode = 1;
    }
}

main().catch((error: unknown) => {
    console.error('Tick could not reach the API:', error instanceof Error ? error.message : error);
    process.exit(1);
});
