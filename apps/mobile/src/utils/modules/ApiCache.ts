import Storage from '@/utils/modules/Storage';

/**
 * The last answer the server gave to each read, kept on the device.
 *
 * The app already knows tomorrow's wake time, which train, and when to leave:
 * it was told hours ago. Throwing that away the moment a request fails, and
 * showing an error where the alarm should be, is the app looking broken while
 * holding everything it needs. So every successful read is written here, and a
 * read that cannot reach the server is answered from here instead.
 *
 * **Reads only, and this is the rule that matters.** Writes are refused, never
 * queued. A queued edit to an alarm lands while its owner is asleep, and an
 * alarm that changes hours after somebody thought they had cancelled it is the
 * worst outcome this project can produce. Offline the app is readable, not
 * editable, and it says so.
 *
 * Nothing here is served silently. Whenever an answer comes from the cache the
 * UI says so and dates it, because "your alarm is 06:42, as of 21:30 yesterday"
 * is worth a great deal and "your alarm is 06:42" when nobody has checked since
 * yesterday is a lie with a number in it.
 */

const PREFIX = 'apiCache:';
/** The list of cached keys, since the storage wrapper cannot enumerate them. */
const INDEX_KEY = 'apiCache:index';
/** Plenty for an app with a dozen endpoints, and a bound rather than none. */
const MAX_ENTRIES = 30;

interface Entry<T> {
    /** When the server gave this answer. */
    at: string;
    body: T;
}

/** What the UI needs to say: whether this is live, and how old it is if not. */
export interface Freshness {
    servingFromCache: boolean;
    /** The timestamp of the oldest cached answer currently on screen. */
    since: string | null;
}

let freshness: Freshness = { servingFromCache: false, since: null };
const listeners = new Set<(value: Freshness) => void>();

function publish(next: Freshness): void {
    // Compared before publishing: this runs on every read, and a new object per
    // request would re-render every subscribed screen for no change.
    if (next.servingFromCache === freshness.servingFromCache && next.since === freshness.since) {
        return;
    }
    freshness = next;
    for (const listener of listeners) {
        listener(freshness);
    }
}

export function getFreshness(): Freshness {
    return freshness;
}

export function subscribeToFreshness(listener: (value: Freshness) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * The server answered, so nothing on screen is stale any more.
 *
 * Called by `Axios.get` on a successful read, and deliberately **not** by
 * {@link writeCache}. Liveness is a fact about a request, so only something that
 * made one may report it. A query combining several reads stores the assembled
 * answer under its own key, and if every one of those reads came from the cache
 * then that write must not be allowed to announce a connection none of them had:
 * the stale notice would disappear and the screen would show yesterday undated.
 *
 * Not symmetrical with {@link markStale}, which keeps the oldest of several
 * answers: this clears outright. So a batch where one endpoint is up and another is
 * down resolves by whichever finishes last. Known, and listed in PROGRESS under
 * open questions.
 */
export function noteLiveAnswer(): void {
    publish({ servingFromCache: false, since: null });
}

/** A cached answer was served, dated so the UI can say how old it is. */
function markStale(at: string): void {
    // The oldest wins while offline: a screen showing several cached answers is
    // only as current as its worst one.
    const since = freshness.since !== null && freshness.since < at ? freshness.since : at;
    publish({ servingFromCache: true, since });
}

async function readIndex(): Promise<string[]> {
    const raw = await Storage.getItem(INDEX_KEY);
    if (raw === null) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
        return [];
    }
}

export async function writeCache(key: string, body: unknown): Promise<void> {
    const entry: Entry<unknown> = { at: new Date().toISOString(), body };

    try {
        await Storage.setItem(PREFIX + key, JSON.stringify(entry));
    } catch {
        // A cache that cannot be written is a cache miss later, which is the
        // behaviour this app had before it existed. Never a failed request.
        return;
    }

    const index = (await readIndex()).filter((each) => each !== key);
    index.push(key);

    for (const stale of index.splice(0, Math.max(0, index.length - MAX_ENTRIES))) {
        await Storage.removeItem(PREFIX + stale);
    }
    await Storage.setItem(INDEX_KEY, JSON.stringify(index));
}

/**
 * The stored answer, with no side effects at all.
 *
 * Separate from {@link readCache} because the two mean different things.
 * `readCache` is the fallback: the request failed and this is what the user is
 * being shown instead, so the app is now displaying yesterday and must say so.
 * `peekCache` is the head start: this is what we knew a moment ago, shown while
 * a live answer is on its way, and it will usually be replaced within a second.
 *
 * Marking the app stale for a peek would put "no connection" on screen every
 * time somebody opened it, which is the opposite of the truth.
 */
export async function peekCache<T>(key: string): Promise<{ body: T; at: string } | null> {
    const raw = await Storage.getItem(PREFIX + key);
    if (raw === null) {
        return null;
    }
    try {
        const entry = JSON.parse(raw) as Entry<T>;
        return { body: entry.body, at: entry.at };
    } catch {
        return null;
    }
}

export async function readCache<T>(key: string): Promise<{ body: T; at: string } | null> {
    const raw = await Storage.getItem(PREFIX + key);
    if (raw === null) {
        return null;
    }

    try {
        const entry = JSON.parse(raw) as Entry<T>;
        markStale(entry.at);
        return { body: entry.body, at: entry.at };
    } catch {
        return null;
    }
}

/**
 * Throws the whole cache away.
 *
 * Called when a device token is rejected and replaced, because every cached
 * body belongs to the device that asked for it. Serving another device's
 * schedules would be worse than serving nothing.
 */
export async function clearCache(): Promise<void> {
    for (const key of await readIndex()) {
        await Storage.removeItem(PREFIX + key);
    }
    await Storage.removeItem(INDEX_KEY);
    // Nothing stored, so nothing on screen can be coming from here.
    noteLiveAnswer();
}
