import { useEffect, useState } from 'react';

import { getFreshness, subscribeToFreshness, type Freshness } from '@/utils/modules/ApiCache';

/**
 * Whether what is on screen came from the server or from the last known copy.
 *
 * Subscribed rather than polled, and global rather than per screen, because
 * that is what is actually true: when the API cannot be reached the whole app is
 * showing yesterday, not one card on it.
 */
export function useApiFreshness(): Freshness {
    const [freshness, setFreshness] = useState<Freshness>(getFreshness);

    useEffect(() => {
        const unsubscribe = subscribeToFreshness(setFreshness);

        // Read again after subscribing, deferred by a microtask so the update
        // lands outside the render pass that scheduled it. A request can finish
        // between the initial state and this effect, and missing that would
        // leave a stale banner sitting over live data.
        void Promise.resolve().then(() => {
            setFreshness(getFreshness());
        });

        return unsubscribe;
    }, []);

    return freshness;
}
