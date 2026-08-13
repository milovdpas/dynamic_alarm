import { useEffect } from 'react';

import { registerWakeChangePushTask } from '@/push/backgroundTask';

/**
 * Makes sure this device is registered to receive wake-time pushes.
 *
 * Only registration. The handling itself lives in the background task, which the
 * OS also runs while the app is in the foreground, so there is deliberately no
 * second listener here: two paths applying the same message would each judge it
 * against a baseline the other had just moved.
 */
export function usePushRescheduling(): void {
    useEffect(() => {
        // Not awaited and never surfaced. A device that cannot register still
        // wakes on the alarm it already holds; the debug panel reports whether
        // this worked, and nothing else needs to.
        void registerWakeChangePushTask();
    }, []);
}
