import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LegType } from '@alarm/types';
import type { Journey } from '@alarm/types';

import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { clock, relativeDay } from '@/utils/time';
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
/**
 * Whether this launch has already sent someone to onboarding.
 *
 * Module scope rather than a ref, so it survives the screen remounting and
 * resets when the app restarts. Without it, backing out of onboarding lands on
 * this screen, which sends you straight back in: a trap with no way out but
 * force-quitting.
 */
let redirectedThisLaunch = false;

export default function HomeScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const border = useThemeColor({}, 'border');

    const { connection } = useApiConnection();
    const { next, busy, refresh } = useNextAlarm();

    const unreachable =
        connection?.state === 'unreachable' || connection?.state === 'not_configured';

    /**
     * Straight into onboarding when there is nothing set up.
     *
     * A screen whose only content is a button that starts the only thing you can
     * do is a screen worth skipping. The empty state stays for the way back:
     * once this launch has redirected, it does not do it again, so leaving
     * onboarding half way lands somewhere with a way forward rather than in a
     * loop.
     *
     * Not while the API is unreachable. Onboarding ends by saving three records,
     * and starting it against a dead server loses four screens of answers.
     */
    useEffect(() => {
        if (next.state === 'none' && !unreachable && !redirectedThisLaunch) {
            // In an effect rather than during render: navigating and marking
            // that we have navigated are both side effects, and a render that
            // happens twice would otherwise redirect twice.
            redirectedThisLaunch = true;
            router.replace('/(onboarding)/places');
        }
    }, [next.state, router, unreachable]);

    /**
     * One settled screen rather than three in a row.
     *
     * Reading the occurrence, arming it and confirming with the OS all take a
     * moment, and rendering each stage as it arrived made the content jump under
     * whoever was reading it. Nothing renders until there is an answer.
     */
    if (next.state === 'loading' && next.occurrence === null) {
        return (
            <ThemedView style={styles.flex}>
                <SafeAreaView style={[styles.flex, styles.centre]} edges={['top', 'bottom']}>
                    <ActivityIndicator size="large" />
                    <ThemedText type="small" themeColor="textSecondary">
                        {t('home.working')}
                    </ThemedText>
                </SafeAreaView>
            </ThemedView>
        );
    }

    return (
        <ThemedView style={styles.flex}>
            {/*
             * Top inset included, because a tab screen has no header above it to
             * take it. Without this the first line sits under the clock.
             */}
            <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    <ThemedText type="title">{t('tabs.today')}</ThemedText>

                    {next.state === 'none' && (
                        <View style={styles.setup}>
                            <ThemedText type="title">{t('home.no_schedule_title')}</ThemedText>
                            <ThemedText themeColor="textSecondary">
                                {t('home.no_schedule_body')}
                            </ThemedText>
                            <ActionButton
                                label={t('onboarding.entry_action')}
                                variant="primary"
                                // Disabled only when the API is known to be
                                // unreachable, not merely unconfirmed.
                                // Onboarding ends by saving three records, so
                                // starting it against a dead API would lose four
                                // screens of answers, but greying the one button
                                // on an empty screen while a registration check
                                // finishes reads as an app that does not work.
                                disabled={unreachable}
                                onPress={() => {
                                    router.push('/(onboarding)/places');
                                }}
                            />
                        </View>
                    )}

                    {next.state === 'failed' && (
                        <WarningBanner
                            title={t('home.failed_title')}
                            message={apiErrorMessage(t, next.errorCode)}
                        />
                    )}

                    {next.state === 'ready' && next.occurrence !== null && (
                        <View style={styles.plan}>
                            <ThemedText type="small" themeColor="textSecondary">
                                {relativeDay(t, next.occurrence.date)}
                            </ThemedText>
                            <ThemedText type="display">
                                {clock(next.occurrence.currentWakeAt)}
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
                                    value={clock(next.occurrence.departHomeAt)}
                                />
                                {/*
                                 * Which train, in one line. The timetable behind
                                 * it is a tap away: the wake time is the answer,
                                 * and burying it in a list of legs was the
                                 * fastest way to make it look like a detail.
                                 */}
                                {next.occurrence.journey !== null && (
                                    <DetailRow
                                        label={t('home.journey')}
                                        value={journeySummary(t, next.occurrence.journey)}
                                    />
                                )}
                                <DetailRow
                                    label={t('common.arrive_by')}
                                    value={clock(next.occurrence.plan.breakdown.requiredArrivalAt)}
                                />
                            </View>

                            <ActionButton
                                label={t('home.see_journey')}
                                onPress={() => {
                                    router.push({
                                        pathname: '/journey/[id]',
                                        params: { id: next.occurrence?.id ?? '' },
                                    });
                                }}
                            />

                            {!next.occurrence.plan.feasible && (
                                <WarningBanner
                                    title={t('plan.infeasible', {
                                        minutes: next.occurrence.plan.shortfallMinutes ?? 0,
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

/**
 * The one line that answers "which train".
 *
 * The first leg that is not the user's own legs: walking to the station is not
 * the journey anybody means when they ask. Falls back to the whole trip's
 * departure when there is nothing but walking, which is a real answer for a
 * short enough commute.
 */
function journeySummary(
    t: (key: string, options?: Record<string, unknown>) => string,
    journey: Journey,
): string {
    const service = journey.legs.find(
        (leg) => leg.type !== LegType.WALK && leg.type !== LegType.BIKE,
    );

    if (service === undefined) {
        return t('home.journey_summary_walk', { time: clock(journey.departureAt) });
    }

    return t('home.journey_summary', {
        time: clock(service.actualDeparture),
        name: service.name ?? service.fromName,
        to: service.toName,
    });
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
    centre: {
        alignItems: 'center',
        justifyContent: 'center',
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
