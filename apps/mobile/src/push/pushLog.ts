import Storage from '@/utils/modules/Storage';
import { createWriteQueue } from '@/utils/writeQueue';

const write = createWriteQueue();

/** One handled push, kept so the debug panel can explain a morning. */
export interface PushLogEntry {
    at: string;
    wakeAt: string;
    emergency: boolean;
    outcome: string;
}

const KEY = 'pushLog';
const MAX_ENTRIES = 10;

/**
 * A short trail of what arrived while nobody was watching.
 *
 * The background task runs in its own JavaScript context with no screen and no
 * React state, so a `console.log` there is visible to nobody. Without this,
 * "did the push arrive and was it applied" has no answer the morning after,
 * which makes the one part of the system that runs while its user is asleep the
 * one part that cannot be verified.
 *
 * Ten entries, oldest dropped. This is a diagnostic, not a history.
 */
export function recordPushOutcome(entry: PushLogEntry): Promise<void> {
    // One at a time. Two pushes handled together would otherwise both read the
    // same list and the second write would erase the first entry.
    return write(async () => {
        const entries = await readPushLog();
        entries.unshift(entry);
        await Storage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    });
}

export async function readPushLog(): Promise<PushLogEntry[]> {
    const raw = await Storage.getItem(KEY);
    if (raw === null) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? (parsed as PushLogEntry[]) : [];
    } catch {
        return [];
    }
}

export async function clearPushLog(): Promise<void> {
    await Storage.removeItem(KEY);
}
