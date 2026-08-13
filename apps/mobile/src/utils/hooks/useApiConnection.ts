import { useCallback, useEffect, useRef, useState } from 'react';

import { ensureDeviceRegistered } from '@/api/registration';
import type { ApiConnection } from '@/api/registration';

/**
 * Registers this device on launch and reports whether the API is reachable.
 *
 * Deliberately non-blocking and deliberately allowed to fail. The alarm that
 * matters most is the one already armed on the device, which needs no network,
 * so a dead API must never stop the app from opening. Everything that does need
 * the server reads this state and says so instead of hanging.
 *
 * The retry exists because the usual causes are things the user can fix while
 * looking at the screen: the API was not running, the laptop was on a different
 * network, the address is wrong.
 */
export function useApiConnection(): {
    connection: ApiConnection | null;
    retry: () => void;
} {
    const [connection, setConnection] = useState<ApiConnection | null>(null);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    /**
     * Guarded on unmount rather than fired and forgotten. Registration outlives
     * a screen that is closed while it is in flight, and setting state on a
     * gone component is a warning nobody can act on.
     */
    const run = useCallback(async () => {
        const result = await ensureDeviceRegistered();
        if (mounted.current) {
            setConnection(result);
        }
    }, []);

    // No synchronous state change here: the effect only starts the work. The
    // "registering" transition belongs to `retry`, which is an event handler,
    // where updating state immediately is exactly right.
    useEffect(() => {
        void run();
    }, [run]);

    const retry = useCallback(() => {
        setConnection((current) =>
            current === null
                ? null
                : { ...current, state: 'registering', errorCode: null, errorDetail: null },
        );
        void run();
    }, [run]);

    return { connection, retry };
}
