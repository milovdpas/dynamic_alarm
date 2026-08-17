import { useCallback, useEffect, useState } from 'react';

import { ApiRequestError } from '@/utils/modules/Axios';
import { peekCache, writeCache } from '@/utils/modules/ApiCache';

export interface ApiQuery<T> {
    /**
     * What to render. Present as soon as anything is known, from the cache or
     * from the server.
     */
    data: T | null;
    /**
     * True only while there is **nothing to show**: no cached copy and no answer
     * yet. This is the only state that should draw a spinner, because a spinner
     * over data somebody can already read is a worse screen than the data.
     */
    loading: boolean;
    /** A request is in flight while `data` is already on screen. */
    revalidating: boolean;
    /**
     * When `data` came from the cache and has not yet been replaced. Null once a
     * live answer arrives, which is what lets a screen say "as of 21:30" and
     * then stop saying it.
     */
    cachedAt: string | null;
    /**
     * The failure code, if the last attempt failed. **Can be set at the same
     * time as `data`**, and that combination is the normal offline case: show
     * what we have, mention that it could not be refreshed, never blank the
     * screen. Only treat it as fatal when `data` is null.
     */
    error: string | null;
    refresh: () => void;
}

/**
 * A read, answered from the last known copy first and corrected when the server
 * replies.
 *
 * The cache in `Axios.get` is a *fallback*: the request goes out, and the stored
 * copy is used only if it fails. That keeps the app usable in an outage but does
 * nothing for the ordinary case, where the phone already knows the answer and
 * still shows a spinner for as long as NS, the server and the network take.
 *
 * This is the other half. The stored copy is put on screen immediately, the
 * request runs anyway, and the answer replaces it when it lands. On a good
 * connection the difference is invisible. On a train it is the difference
 * between an app that works and an app that is thinking.
 *
 * **Failure never removes what is already on screen.** The single most important
 * rule here, and the reason `data` and `error` are separate fields rather than a
 * union. A refresh that fails leaves yesterday's wake time visible with a note
 * that it could not be checked, because that is both true and useful. Replacing
 * it with an error banner throws away information the phone is holding, which is
 * exactly the behaviour this whole cache exists to end.
 */
export function useApiQuery<T>(key: string, fetcher: () => Promise<T>): ApiQuery<T> {
    const [data, setData] = useState<T | null>(null);
    const [cachedAt, setCachedAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [settled, setSettled] = useState(false);
    const [inFlight, setInFlight] = useState(true);
    const [attempt, setAttempt] = useState(0);

    const refresh = useCallback(() => {
        setAttempt((count) => count + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;
        // Deferred like the reads below, so no state is set inside the render
        // pass that scheduled this effect.
        void Promise.resolve().then(() => {
            if (!cancelled) {
                setInFlight(true);
            }
        });

        // The head start. Skipped once a live answer has arrived, so a manual
        // refresh never puts an older copy back over a newer one.
        void peekCache<T>(key).then((entry) => {
            if (cancelled || entry === null) {
                return;
            }
            setData((current) => (current === null ? entry.body : current));
            setCachedAt((current) => (current === null && !settled ? entry.at : current));
        });

        void fetcher()
            .then((fresh) => {
                /*
                 * Written under this query's own key, and this is not optional.
                 * `Axios.get` caches each endpoint under its own URL, which the
                 * fallback path uses, but a query whose fetcher combines two
                 * calls has a key nothing else ever writes. Without this the
                 * peek above would always miss and the head start would silently
                 * never happen, which is the whole reason this hook exists.
                 *
                 * Cached even when cancelled: the answer arrived and is worth
                 * keeping for the next screen that asks, whatever happened to
                 * the component that requested it.
                 */
                void writeCache(key, fresh);

                if (cancelled) {
                    return;
                }
                setData(fresh);
                // Live now, so anything that made this look old stops applying.
                setCachedAt(null);
                setError(null);
                setSettled(true);
            })
            .catch((failure: unknown) => {
                if (!cancelled) {
                    setError(ApiRequestError.from(failure).code);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setInFlight(false);
                }
            });

        return () => {
            cancelled = true;
        };
        // `settled` is read inside but deliberately not a dependency: it changes
        // when the first live answer lands, and re-running then would fetch
        // twice for every screen.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, fetcher, attempt]);

    return {
        data,
        loading: data === null && inFlight,
        revalidating: data !== null && inFlight,
        cachedAt,
        error,
        refresh,
    };
}
