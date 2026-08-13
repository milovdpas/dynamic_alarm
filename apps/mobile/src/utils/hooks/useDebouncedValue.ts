import { useEffect, useState } from 'react';

/**
 * The value, once it has stopped changing for `delayMs`.
 *
 * Address search is the reason this exists. It proxies an NS endpoint drawing on
 * 300 requests per 5 minutes shared by every user of the deployment, and typing
 * "Amsterdam" is nine keystrokes. The server enforces a three-character minimum
 * as a floor, but a floor is not a substitute for waiting until someone has
 * stopped typing.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [settled, setSettled] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => {
            setSettled(value);
        }, delayMs);

        // Cleared on every change, so the timer only ever fires once typing
        // pauses rather than once per character.
        return () => {
            clearTimeout(timer);
        };
    }, [value, delayMs]);

    return settled;
}
