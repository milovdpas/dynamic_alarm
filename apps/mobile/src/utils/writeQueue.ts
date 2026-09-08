/**
 * Runs read-modify-write cycles on one stored record one at a time.
 *
 * Key-value storage has no transactions, so "read the record, change one entry,
 * write it back" loses updates as soon as two of them overlap: both read the same
 * old record, and whichever writes second erases the first's change. Found on a
 * phone on 2026-09-08, where three mornings armed in parallel each remembered
 * their baseline and only the last survived, so a push about Thursday found no
 * Thursday to judge it against and was ignored.
 *
 * One queue per record. A failed cycle does not block the next: the chain is
 * continued from a settled promise either way.
 */
export function createWriteQueue(): <T>(work: () => Promise<T>) => Promise<T> {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(work: () => Promise<T>): Promise<T> => {
        const run = tail.then(work, work);
        tail = run.catch(() => undefined);
        return run;
    };
}
