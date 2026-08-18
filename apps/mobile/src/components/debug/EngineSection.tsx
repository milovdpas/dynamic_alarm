import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateTime } from 'luxon';
import { APP_CONSTANTS, DEFAULT_BUFFERS, TransportMode } from '@alarm/types';
import type { WakePlan } from '@alarm/types';
import { FixtureTransportProvider, planWake } from '@alarm/core';

import DetailRow from '@/components/ui/DetailRow';
import Section from '@/components/debug/Section';
import { ThemedText } from '@/components/ui/ThemedText';

function formatTime(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true })
        .setZone(APP_CONSTANTS.TIMEZONE)
        .toFormat('HH:mm');
}

/**
 * The shared engine, run on the device against fixtures.
 *
 * Doubles as proof that Metro really is resolving `@alarm/core` across the
 * workspace, which is a thing that breaks silently and looks like a bug in
 * whatever screen happens to need a wake time next.
 */
export default function EngineSection() {
    const { t } = useTranslation();
    const [plan, setPlan] = useState<WakePlan | null>(null);

    useEffect(() => {
        const arriveAt = DateTime.now()
            .setZone(APP_CONSTANTS.TIMEZONE)
            .plus({ days: 1 })
            .set({ hour: 8, minute: 30, second: 0, millisecond: 0 });

        void planWake(
            {
                requiredArrivalAt: arriveAt.toISO() ?? '',
                mode: TransportMode.PUBLIC_TRANSPORT,
                origin: { lat: 52.0907, lng: 5.1214 },
                destination: { lat: 52.3791, lng: 4.9003 },
                routineMinutes: 35,
                buffers: DEFAULT_BUFFERS,
                timezone: APP_CONSTANTS.TIMEZONE,
            },
            new FixtureTransportProvider(),
        ).then(setPlan);
    }, []);

    return (
        <Section title={t('harness.engine')}>
            {plan === null ? (
                <ThemedText type="small">{t('harness.calculating')}</ThemedText>
            ) : (
                <>
                    <DetailRow label={t('common.wake_up')} value={formatTime(plan.wakeUpAt)} />
                    <DetailRow
                        label={t('common.leave_home')}
                        value={formatTime(plan.departHomeAt)}
                    />
                    <DetailRow
                        label={t('plan.travel')}
                        value={t('common.minutes_short', {
                            count: plan.breakdown.travelMinutes,
                        })}
                    />
                    <DetailRow
                        label={t('plan.risk_buffer')}
                        value={t('common.minutes_short', {
                            count: plan.breakdown.riskBufferMinutes,
                        })}
                    />
                    <DetailRow
                        label={t('plan.routine')}
                        value={t('common.minutes_short', {
                            count: plan.breakdown.routineMinutes,
                        })}
                    />
                    <DetailRow
                        label={t('plan.feasible')}
                        value={
                            plan.feasible
                                ? t('common.yes')
                                : t('plan.infeasible', { minutes: plan.shortfallMinutes })
                        }
                        warn={!plan.feasible}
                    />
                </>
            )}
        </Section>
    );
}
