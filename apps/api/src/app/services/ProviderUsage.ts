import { APP_CONSTANTS } from '@alarm/types';

export type Provider = 'NS' | 'TOMTOM';

export interface UsageSnapshot {
    /** Calls in the last `windowMinutes`, which is the number the limit applies to. */
    ns: number;
    tomtom: number;
    /** Since the process started, for a sense of the shape of a night. */
    nsTotal: number;
    tomtomTotal: number;
    windowMinutes: number;
    /** NS calls allowed in that window, so a log line can show a fraction. */
    nsLimit: number;
    /** True once the window is uncomfortably full. */
    nsPressure: boolean;
}

/**
 * How many provider calls this process has made, and how recently.
 *
 * NS publishes a real ceiling, **300 requests per 5 minutes**, shared across
 * every user of this deployment. Until now nothing counted, so every claim about
 * the cost of a feature was arithmetic on paper: the cadence ladder was designed
 * around roughly 35 calls per occurrence per night, and since then a disruption
 * sweep, a re-plan on cancellation and an eight-candidate replacement search have
 * been added without anyone measuring what they actually spend.
 *
 * A rolling window rather than a total. The limit is a rate, and a number that
 * only goes up cannot tell you whether you are near it.
 *
 * **In memory, and deliberately.** It is diagnostic rather than enforcement: a
 * second API instance would count separately and undercount the shared budget,
 * and a counter in the database would spend a write on every provider call to
 * measure the cost of provider calls. The number to trust when it matters is
 * NS's own 429, which is why that is logged loudly and separately.
 */
export class ProviderUsage {
    private static readonly calls: { at: number; provider: Provider }[] = [];
    private static totals: Record<Provider, number> = { NS: 0, TOMTOM: 0 };

    /** Called by the modules that talk to a provider, on every request. */
    static record(provider: Provider): void {
        const now = Date.now();
        ProviderUsage.calls.push({ at: now, provider });
        ProviderUsage.totals[provider] += 1;
        ProviderUsage.prune(now);
    }

    static snapshot(): UsageSnapshot {
        const now = Date.now();
        ProviderUsage.prune(now);

        const windowMinutes = APP_CONSTANTS.NS_RATE_LIMIT.WINDOW_MINUTES;
        const ns = ProviderUsage.calls.filter((call) => call.provider === 'NS').length;

        return {
            ns,
            tomtom: ProviderUsage.calls.filter((call) => call.provider === 'TOMTOM').length,
            nsTotal: ProviderUsage.totals.NS,
            tomtomTotal: ProviderUsage.totals.TOMTOM,
            windowMinutes,
            nsLimit: APP_CONSTANTS.NS_RATE_LIMIT.REQUESTS,
            // Two thirds of the budget in one process is worth noticing before
            // the 429 arrives, because by then an alarm has already gone
            // unchecked.
            nsPressure: ns > (APP_CONSTANTS.NS_RATE_LIMIT.REQUESTS * 2) / 3,
        };
    }

    /** For a probe that wants to measure one operation rather than a window. */
    static totalsSince(marker: UsageSnapshot): { ns: number; tomtom: number } {
        return {
            ns: ProviderUsage.totals.NS - marker.nsTotal,
            tomtom: ProviderUsage.totals.TOMTOM - marker.tomtomTotal,
        };
    }

    private static prune(now: number): void {
        const cutoff = now - APP_CONSTANTS.NS_RATE_LIMIT.WINDOW_MINUTES * 60_000;
        while (ProviderUsage.calls.length > 0 && (ProviderUsage.calls[0]?.at ?? 0) < cutoff) {
            ProviderUsage.calls.shift();
        }
    }
}
