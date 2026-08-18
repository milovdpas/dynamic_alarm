import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ActionButton from '@/components/buttons/ActionButton';
import DetailRow from '@/components/ui/DetailRow';
import Section from '@/components/debug/Section';
import { registerWakeChangePushTask } from '@/push/backgroundTask';
import { readHeldAlarm, type HeldAlarm } from '@/push/heldAlarm';
import { clearPushLog, readPushLog, type PushLogEntry } from '@/push/pushLog';

/** One line describing a handled push. */
function formatPush(entry: PushLogEntry): string {
    const at = new Date(entry.at).toLocaleTimeString();
    const wake = new Date(entry.wakeAt).toLocaleTimeString();
    return `${at} -> ${wake} (${entry.outcome})`;
}

/**
 * Whether this device can be told to move an alarm while it is asleep, and what
 * it has been told.
 *
 * Registration is attempted on every launch anyway; this reads back the answer,
 * because the only part of the system that runs while nobody is watching is also
 * the only part that cannot report itself any other way.
 */
export default function PushSection() {
    const { t } = useTranslation();
    const [registered, setRegistered] = useState<boolean | null>(null);
    const [held, setHeld] = useState<HeldAlarm | null>(null);
    const [log, setLog] = useState<PushLogEntry[]>([]);

    useEffect(() => {
        let cancelled = false;
        void Promise.all([registerWakeChangePushTask(), readHeldAlarm(), readPushLog()]).then(
            ([isRegistered, current, entries]) => {
                if (!cancelled) {
                    setRegistered(isRegistered);
                    setHeld(current);
                    setLog(entries);
                }
            },
        );
        return () => {
            cancelled = true;
        };
    }, []);

    const clear = useCallback(async () => {
        await clearPushLog();
        setLog([]);
    }, []);

    return (
        <Section title={t('push.title')}>
            <DetailRow
                label={t('push.background_task')}
                value={
                    registered === null
                        ? t('common.unknown')
                        : registered
                          ? t('diagnostics.linked')
                          : t('diagnostics.missing')
                }
                warn={registered === false}
            />
            <DetailRow
                label={t('push.held')}
                value={held === null ? t('harness.none') : new Date(held.wakeAt).toLocaleString()}
            />
            {log.length === 0 ? (
                <DetailRow label={t('push.received')} value={t('harness.none')} />
            ) : (
                // Indexed rather than keyed on the timestamp: two pushes in
                // the same millisecond is unlikely and not impossible, and the
                // list is append-only and never reordered, so position is a
                // stabler identity than the clock.
                log.map((entry, index) => (
                    <DetailRow
                        key={`${String(index)}-${entry.at}`}
                        label={t('push.received')}
                        value={formatPush(entry)}
                        warn={entry.outcome !== 'APPLIED'}
                    />
                ))
            )}
            {log.length > 0 && <ActionButton label={t('push.clear')} onPress={clear} />}
        </Section>
    );
}
