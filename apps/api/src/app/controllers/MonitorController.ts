import type { MonitorTickResponse } from '@alarm/types';

import type { Handler } from '../../interfaces/IHttp';
import { MonitorService } from '../services/MonitorService';
import { sendSuccess } from '../utils/ApiResponses';

/**
 * The heartbeat, driven from outside the process.
 *
 * The scheduler calls this once a minute. Almost every call does nothing: only
 * occurrences whose `nextCheckAt` has arrived are claimed, so the cost follows
 * how close alarms are rather than how many exist.
 */
export default class MonitorController {
    private readonly monitor = new MonitorService();

    /**
     * Ticks, unless the previous tick is still going.
     *
     * Overlap is refused rather than queued. `FOR UPDATE SKIP LOCKED` already
     * makes a second run safe, but a batch that outlasts its minute would have
     * two passes competing for the same NS quota, and the quota is the binding
     * constraint. Answering `skipped` keeps that visible in the scheduler's log
     * instead of turning it into unexplained rate limiting.
     */
    tick: Handler = async (_req, res) => {
        const startedAt = process.hrtime.bigint();

        if (MonitorController.running) {
            sendSuccess<MonitorTickResponse>(res, {
                disruptions: 0,
                promoted: 0,
                claimed: 0,
                moved: 0,
                unchanged: 0,
                failed: 0,
                skipped: true,
                durationMs: 0,
            });
            return;
        }

        MonitorController.running = true;
        try {
            const result = await this.monitor.tick();
            sendSuccess<MonitorTickResponse>(res, {
                ...result,
                skipped: false,
                durationMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
            });
        } finally {
            // In a `finally` because a throw here leaves the flag set forever,
            // and the symptom is a monitor that silently stops after one bad
            // night rather than one bad tick.
            MonitorController.running = false;
        }
    };

    /**
     * Static, so it is one flag per process rather than one per controller
     * instance. Routes construct their controller once today, but that is a
     * detail of the wiring and not something this should depend on.
     */
    private static running = false;
}
