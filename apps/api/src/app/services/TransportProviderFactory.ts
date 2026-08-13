import { TransportMode } from '@alarm/types';
import type { TransportProvider } from '@alarm/core';

import { CarJourneyService } from './CarJourneyService';
import { JourneyPlannerService } from './JourneyPlannerService';

/**
 * The provider for a transport mode, or null when the mode needs none.
 *
 * `FIXED` returns null on purpose rather than a stub provider. The user typed
 * the travel time themselves, so there is nothing to ask anyone, and a stub
 * would leave every caller checking whether the journey it returned was real.
 *
 * Providers are created once and shared. `JourneyPlannerService` caches its
 * station lookups in memory, and a fresh instance per request would throw that
 * away and spend NS requests re-learning the same answer.
 */
export class TransportProviderFactory {
    private static readonly publicTransport = new JourneyPlannerService();
    private static readonly car = new CarJourneyService();

    static forMode(mode: TransportMode): TransportProvider | null {
        switch (mode) {
            case TransportMode.PUBLIC_TRANSPORT:
                return this.publicTransport;
            case TransportMode.CAR:
                return this.car;
            case TransportMode.FIXED:
                return null;
        }
    }
}
