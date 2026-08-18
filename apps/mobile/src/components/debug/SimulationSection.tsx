import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SimulationKind } from '@alarm/types';
import type { OccurrenceResponse } from '@alarm/types';

import { nextOccurrence, simulateOccurrence } from '@/api';
import ActionButton from '@/components/buttons/ActionButton';
import DetailRow from '@/components/ui/DetailRow';
import Section from '@/components/debug/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { ApiRequestError } from '@/utils/modules/Axios';
import { clock } from '@/utils/time';

/**
 * Stages a pretend disruption against the next armed morning.
 *
 * Test tools, and the only place in the app that asks the server to lie. Behind
 * the debug gate because a simulated disruption moves a real alarm, and nobody
 * should meet that by accident.
 */
export default function SimulationSection({ onStatus }: { onStatus: (message: string) => void }) {
    const { t } = useTranslation();
    /**
     * The morning a simulation would be staged against.
     *
     * The soonest armed one, because that is the alarm about to happen and the
     * only one worth testing against. Null when nothing is armed, in which case
     * there is nothing to disrupt and the buttons say so instead of failing.
     */
    const [occurrence, setOccurrence] = useState<OccurrenceResponse | null>(null);
    const [simulating, setSimulating] = useState(false);

    useEffect(() => {
        let cancelled = false;
        // A 404 means nothing is armed, which is an ordinary answer here.
        void nextOccurrence()
            .then((next) => {
                if (!cancelled) {
                    setOccurrence(next);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * Stages a pretend disruption, or clears one.
     *
     * Reports the outcome into the same status line the rest of this panel uses,
     * including failures: this is the screen where a broken thing should say so
     * rather than look inert.
     */
    const simulate = useCallback(
        async (kind: SimulationKind | null) => {
            if (occurrence === null) {
                return;
            }
            setSimulating(true);
            try {
                const updated = await simulateOccurrence(occurrence.id, kind, 20);
                setOccurrence(updated);
                onStatus(kind === null ? t('simulate.cleared') : t('simulate.staged'));
            } catch (error) {
                onStatus(apiErrorMessage(t, ApiRequestError.from(error).code));
            } finally {
                setSimulating(false);
            }
        },
        [occurrence, onStatus, t],
    );

    return (
        <Section title={t('simulate.title')}>
            <ThemedText type="small" themeColor="textSecondary">
                {t('simulate.help')}
            </ThemedText>

            <DetailRow
                label={t('simulate.target')}
                value={
                    occurrence === null
                        ? t('harness.none')
                        : `${occurrence.scheduleName} ${clock(occurrence.currentWakeAt)}`
                }
                warn={occurrence === null}
            />
            <DetailRow
                label={t('simulate.staged_label')}
                value={occurrence?.simulated ?? t('harness.none')}
                warn={occurrence?.simulated != null}
            />

            <ActionButton
                label={t('simulate.delay')}
                disabled={occurrence === null || simulating}
                onPress={() => void simulate(SimulationKind.DELAY)}
            />
            <ActionButton
                label={t('simulate.cancellation')}
                disabled={occurrence === null || simulating}
                onPress={() => void simulate(SimulationKind.CANCELLATION)}
            />
            {occurrence?.simulated != null && (
                <ActionButton
                    label={t('simulate.clear')}
                    disabled={simulating}
                    onPress={() => void simulate(null)}
                />
            )}
        </Section>
    );
}
