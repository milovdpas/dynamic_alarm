import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { DateTime } from 'luxon';
import { APP_CONSTANTS, LegType } from '@alarm/types';
import type { JourneyLeg, WakePlan } from '@alarm/types';

import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import DetailRow from '@/components/ui/DetailRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { useNextAlarm } from '@/alarm/useNextAlarm';
import { useApiConnection } from '@/utils/hooks/useApiConnection';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * What time you are getting up, and why.
 *
 * The wake time is the largest thing on the screen because it is the only thing
 * most people will ever read here. Everything below it exists to answer the one
 * question that follows: why that time and not another. An alarm that moves
 * without explaining itself is an alarm nobody trusts.
 *
 * The armed state is read back from the OS rather than inferred from a
 * successful call. "We asked for an alarm" and "there is an alarm" are different
 * claims, and only the second is worth showing to someone about to go to sleep.
 */
export default function HomeScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const border = useThemeColor({}, 'border');

    const { connection } = useApiConnection();
    const { next, busy, refresh } = useNextAlarm();

    const connected = connection?.state === 'connected';

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    {/*
                     * Only when there is nothing to show yet. A refresh keeps
                     * the previous answer on screen and says it is working
                     * below, rather than blanking what the user was reading.
                     */}
                    {next.planned === null && next.state === 'loading' && (
                        <ThemedText type="subtitle">{t('home.working')}</ThemedText>
                    )}

                    {next.state === 'none' && (
                        <View style={styles.setup}>
                            <ThemedText type="title">{t('home.no_schedule_title')}</ThemedText>
                            <ThemedText themeColor="textSecondary">
                                {t('home.no_schedule_body')}
                            </ThemedText>
                            <ActionButton
                                label={t('onboarding.entry_action')}
                                variant="primary"
                                // Onboarding ends by saving three records, so
                                // starting it without a reachable API would lose
                                // four screens of answers.
                                disabled={!connected}
                                onPress={() => {
                                    router.push('/(onboarding)/places');
                                }}
                            />
                        </View>
                    )}

                    {next.state === 'failed' && (
                        <WarningBanner
                            title={t('home.failed_title')}
                            message={translateError(t, next.errorCode)}
                        />
                    )}

                    {next.state === 'ready' && next.planned !== null && (
                        <View style={styles.plan}>
                            <ThemedText type="small" themeColor="textSecondary">
                                {relativeDay(t, next.planned.date)}
                            </ThemedText>
                            <ThemedText type="display">
                                {clock(next.planned.plan.wakeUpAt)}
                            </ThemedText>

                            {!next.armed && (
                                <WarningBanner
                                    title={t('home.not_armed_title')}
                                    message={t('home.not_armed_body')}
                                />
                            )}

                            <View style={[styles.card, { borderColor: border }]}>
                                <DetailRow
                                    label={t('common.leave_home')}
                                    value={clock(next.planned.plan.departHomeAt)}
                                />
                                <DetailRow
                                    label={t('common.arrive_by')}
                                    value={clock(
                                        next.planned.plan.breakdown.requiredArrivalAt,
                                    )}
                                />
                                {next.planned.plan.journey?.legs.map((leg, index) => (
                                    <DetailRow
                                        key={`${leg.type}-${String(index)}`}
                                        label={legLabel(t, leg)}
                                        value={`${clock(leg.actualDeparture)} ${t(
                                            'home.until',
                                        )} ${clock(leg.actualArrival)}`}
                                        warn={leg.cancelled}
                                    />
                                ))}
                            </View>

                            <Breakdown plan={next.planned.plan} />

                            {!next.planned.plan.feasible && (
                                <WarningBanner
                                    title={t('plan.infeasible', {
                                        minutes: next.planned.plan.shortfallMinutes ?? 0,
                                    })}
                                    message={t('schedule.infeasible_help')}
                                />
                            )}

                            {/*
                             * Manual until M2. The monitor loop and its pushes
                             * are what will keep this current; saying so is
                             * better than implying the number looks after
                             * itself overnight.
                             */}
                            <ThemedText type="small" themeColor="textSecondary">
                                {busy ? t('home.working') : t('home.manual_refresh')}
                            </ThemedText>
                            <ActionButton
                                label={t('home.refresh')}
                                onPress={refresh}
                                disabled={busy}
                            />
                        </View>
                    )}

                    <ActionButton
                        label={t('settings.title')}
                        onPress={() => {
                            router.push('/settings');
                        }}
                    />
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

/** Every term of the calculation, so the wake time can be argued with. */
function Breakdown({ plan }: { plan: WakePlan }) {
    const { t } = useTranslation();
    const { breakdown } = plan;

    return (
        <View style={styles.breakdown}>
            <DetailRow
                label={t('plan.travel')}
                value={t('common.minutes_short', { count: breakdown.travelMinutes })}
            />
            <DetailRow
                label={t('plan.risk_buffer')}
                value={t('common.minutes_short', { count: breakdown.riskBufferMinutes })}
            />
            <DetailRow
                label={t('plan.routine')}
                value={t('common.minutes_short', { count: breakdown.routineMinutes })}
            />
        </View>
    );
}

function clock(iso: string): string {
    return DateTime.fromISO(iso, { setZone: true })
        .setZone(APP_CONSTANTS.TIMEZONE)
        .toFormat('HH:mm');
}

/**
 * "Tomorrow" beats a date. A wake time on its own cannot say whether it means
 * tonight or Monday, and that is the first thing anyone checks.
 */
function relativeDay(t: (key: string, options?: Record<string, unknown>) => string, date: string) {
    const day = DateTime.fromISO(date, { zone: APP_CONSTANTS.TIMEZONE }).startOf('day');
    const days = Math.round(day.diff(DateTime.now().setZone(APP_CONSTANTS.TIMEZONE).startOf('day'), 'days').days);

    if (days === 0) return t('home.today');
    if (days === 1) return t('home.tomorrow');
    return day.setLocale('nl').toFormat('cccc d LLLL');
}

/** Walking and cycling are the traveller's own legs, so they read differently. */
function legLabel(t: (key: string) => string, leg: JourneyLeg): string {
    if (leg.type === LegType.WALK) return t('home.leg_walk');
    if (leg.type === LegType.BIKE) return t('home.leg_bike');
    return leg.name ?? leg.fromName;
}

function translateError(t: (key: string) => string, code: string | null): string {
    if (code === null) return t('api.error.unknown');
    const key = `api.error.${code}`;
    const copy = t(key);
    return copy === key ? t('api.error.unknown') : copy;
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },
    content: {
        padding: Spacing.medium,
        gap: Spacing.medium,
    },
    setup: {
        gap: Spacing.small,
    },
    plan: {
        gap: Spacing.small,
    },
    card: {
        borderWidth: 1,
        borderRadius: Radius.medium,
        padding: Spacing.medium,
        gap: Spacing.extraSmall,
    },
    breakdown: {
        gap: Spacing.extraSmall,
    },
});
