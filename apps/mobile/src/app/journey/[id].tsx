import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams } from 'expo-router';
import { LegType } from '@alarm/types';
import type {
    AlarmEventDto,
    JourneyLeg,
    JourneyStop,
    OccurrenceResponse,
    WakePlan,
} from '@alarm/types';

import { listOccurrences, occurrenceEvents } from '@/api';
import { Radius, Spacing } from '@/assets/Stylesheet';
import DetailRow from '@/components/ui/DetailRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { ApiRequestError } from '@/utils/modules/Axios';
import { clock, relativeDay } from '@/utils/time';

/**
 * The whole morning, step by step, and why the alarm is where it is.
 *
 * Today shows the answer; this shows the working. Every line here exists to
 * answer one of two questions somebody asks at 23:00: which train am I actually
 * getting, and why that time and not fifteen minutes later.
 *
 * It spends no provider call. The occurrence carries the plan it was armed from,
 * so this is the stored answer rather than a fresh one, which also makes it the
 * honest one: it is what the alarm was actually set from.
 */
export default function JourneyScreen() {
    const { t } = useTranslation();
    const { id } = useLocalSearchParams<{ id: string }>();
    const border = useThemeColor({}, 'border');

    const [occurrence, setOccurrence] = useState<OccurrenceResponse | null>(null);
    const [events, setEvents] = useState<AlarmEventDto[]>([]);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    /**
     * Which leg has its stops open, by index. One at a time: the list is here to
     * answer "does it stop at mine", and three open lists is a timetable again.
     */
    const [openLeg, setOpenLeg] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;

        // The events are a separate call and allowed to fail on their own. A
        // missing history should not cost the timeline, which is the part
        // somebody opened this screen to read.
        void Promise.all([listOccurrences(), occurrenceEvents(id).catch(() => [])])
            .then(([occurrences, trail]) => {
                if (!cancelled) {
                    setOccurrence(occurrences.find((each) => each.id === id) ?? null);
                    setEvents(trail);
                }
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setErrorCode(ApiRequestError.from(error).code);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [id]);

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    {errorCode !== null && (
                        <WarningBanner
                            title={t('home.failed_title')}
                            message={apiErrorMessage(t, errorCode)}
                        />
                    )}

                    {occurrence !== null && (
                        <>
                            <ThemedText type="small" themeColor="textSecondary">
                                {relativeDay(t, occurrence.date)}
                            </ThemedText>

                            <View style={[styles.card, { borderColor: border }]}>
                                <Step
                                    time={clock(occurrence.currentWakeAt)}
                                    label={t('common.wake_up')}
                                />
                                <Step
                                    time={clock(occurrence.departHomeAt)}
                                    label={t('common.leave_home')}
                                />

                                {occurrence.journey?.legs.map((leg, index) => (
                                    <Leg
                                        key={`${leg.type}-${String(index)}`}
                                        leg={leg}
                                        open={openLeg === index}
                                        onToggle={() => {
                                            setOpenLeg(openLeg === index ? null : index);
                                        }}
                                    />
                                ))}

                                {occurrence.journey !== null && (
                                    <Step
                                        time={clock(occurrence.journey.arrivalAt)}
                                        label={t('journey.arrive')}
                                    />
                                )}
                                <Step
                                    time={clock(occurrence.plan.breakdown.requiredArrivalAt)}
                                    label={t('common.arrive_by')}
                                />
                            </View>

                            <ThemedText type="subtitle">{t('journey.why_title')}</ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                                {t('journey.why_help')}
                            </ThemedText>
                            <Breakdown plan={occurrence.plan} borderColor={border} />

                            {/*
                             * Written when each change happened, because the
                             * delay that caused it has usually gone by the time
                             * anyone reads this. Empty on a morning that has not
                             * moved, which is most of them.
                             */}
                            {events.length > 0 && (
                                <>
                                    <ThemedText type="subtitle">
                                        {t('journey.changes_title')}
                                    </ThemedText>
                                    <View style={[styles.card, { borderColor: border }]}>
                                        {events.map((event) => (
                                            <Step
                                                key={event.id}
                                                time={clock(event.createdAt)}
                                                label={event.message}
                                            />
                                        ))}
                                    </View>
                                </>
                            )}
                        </>
                    )}
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

/**
 * One leg, with its stops a tap away.
 *
 * Which stations a train calls at is the question the NS app is usually open
 * for, and it is the difference between trusting this screen and checking
 * another one. Closed by default because the timeline is the point: the stops
 * answer a question somebody has occasionally, not every morning.
 *
 * A leg with no stops is not tappable rather than tappable and empty. Walking
 * legs have none, and neither does a provider that does not publish them.
 */
function Leg({ leg, open, onToggle }: { leg: JourneyLeg; open: boolean; onToggle: () => void }) {
    const { t } = useTranslation();
    const secondary = useThemeColor({}, 'textSecondary');
    const stops = leg.stops ?? [];

    if (stops.length === 0) {
        return (
            <Step
                time={clock(leg.actualDeparture)}
                label={legLabel(t, leg)}
                detail={legDetail(t, leg)}
                warn={leg.cancelled}
            />
        );
    }

    return (
        <View>
            <Pressable
                onPress={onToggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={t('journey.stops_toggle', { name: legLabel(t, leg) })}
                style={styles.step}
            >
                <ThemedText
                    type="smallBold"
                    style={styles.time}
                    themeColor={leg.cancelled ? 'danger' : 'text'}
                >
                    {clock(leg.actualDeparture)}
                </ThemedText>
                <View style={styles.grow}>
                    <ThemedText themeColor={leg.cancelled ? 'danger' : 'text'}>
                        {legLabel(t, leg)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                        {[legDetail(t, leg), t('journey.stops_count', { count: stops.length })]
                            .filter(Boolean)
                            .join(' \u00b7 ')}
                    </ThemedText>
                </View>
                <MaterialCommunityIcons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={secondary}
                />
            </Pressable>

            {open && (
                <View style={styles.stops}>
                    {stops.map((stop, index) => (
                        <Stop key={`${stop.name}-${String(index)}`} stop={stop} />
                    ))}
                </View>
            )}
        </View>
    );
}

/**
 * One station along the way.
 *
 * The departure where there is one, the arrival at the end of the leg. A
 * cancelled stop is marked rather than hidden: a train that no longer calls
 * somewhere is exactly what the person reading this needs to see.
 */
function Stop({ stop }: { stop: JourneyStop }) {
    const { t } = useTranslation();

    return (
        <View style={styles.step}>
            <ThemedText
                type="small"
                style={styles.time}
                themeColor={stop.cancelled ? 'danger' : 'textSecondary'}
            >
                {clock(stop.departureAt ?? stop.arrivalAt ?? '')}
            </ThemedText>
            <ThemedText
                type="small"
                style={styles.grow}
                themeColor={stop.cancelled ? 'danger' : 'text'}
            >
                {stop.name}
                {stop.track === undefined ? '' : ` \u00b7 ${t('journey.track', { track: stop.track })}`}
                {stop.cancelled ? ` \u00b7 ${t('journey.cancelled')}` : ''}
            </ThemedText>
        </View>
    );
}

/** One moment in the morning: when, what, and anything worth adding. */
function Step({
    time,
    label,
    detail,
    warn = false,
}: {
    time: string;
    label: string;
    detail?: string;
    warn?: boolean;
}) {
    return (
        <View style={styles.step}>
            <ThemedText type="smallBold" style={styles.time} themeColor={warn ? 'danger' : 'text'}>
                {time}
            </ThemedText>
            <View style={styles.grow}>
                <ThemedText themeColor={warn ? 'danger' : 'text'}>{label}</ThemedText>
                {detail !== undefined && (
                    <ThemedText type="small" themeColor="textSecondary">
                        {detail}
                    </ThemedText>
                )}
            </View>
        </View>
    );
}

/**
 * Every term of the calculation, in the order it is applied.
 *
 * The point of showing this is that each line is a number somebody can change,
 * except the ones that come from the timetable. An alarm that explains itself is
 * one people trust enough to leave alone.
 */
function Breakdown({ plan, borderColor }: { plan: WakePlan; borderColor: string }) {
    const { t } = useTranslation();
    const { breakdown } = plan;

    return (
        <View style={[styles.card, { borderColor }]}>
            <DetailRow
                label={t('plan.travel')}
                value={t('common.minutes_short', { count: breakdown.travelMinutes })}
            />
            <DetailRow
                label={t('journey.risk_buffer')}
                value={t('common.minutes_short', { count: breakdown.riskBufferMinutes })}
            />
            <DetailRow
                label={t('journey.pre_departure')}
                value={t('common.minutes_short', { count: breakdown.preDepartureBufferMinutes })}
            />
            <DetailRow
                label={t('journey.routine')}
                value={t('common.minutes_short', { count: breakdown.routineMinutes })}
            />
            <DetailRow
                label={t('journey.arrival_buffer')}
                value={t('common.minutes_short', { count: breakdown.arrivalBufferMinutes })}
            />
            {breakdown.wakeSlackMinutes > 0 && (
                <DetailRow
                    label={t('journey.wake_slack')}
                    value={t('common.minutes_short', { count: breakdown.wakeSlackMinutes })}
                />
            )}
        </View>
    );
}

/** Walking and cycling are the traveller's own legs, so they read differently. */
function legLabel(t: (key: string) => string, leg: JourneyLeg): string {
    if (leg.type === LegType.WALK) return t('home.leg_walk');
    if (leg.type === LegType.BIKE) return t('home.leg_bike');
    return leg.name ?? `${leg.fromName} - ${leg.toName}`;
}

/**
 * The line under a leg: where it goes, which platform, how late.
 *
 * The platform is here because a changed one is the difference between catching
 * a train and watching it leave, and the delay is here because a leg that is
 * running late explains a wake time that moved.
 */
function legDetail(t: (key: string, options?: Record<string, unknown>) => string, leg: JourneyLeg): string | undefined {
    const parts: string[] = [];

    if (leg.type !== LegType.WALK && leg.type !== LegType.BIKE) {
        parts.push(`${leg.fromName} → ${leg.toName}`);
    }
    if (leg.actualTrack !== undefined) {
        parts.push(t('journey.track', { track: leg.actualTrack }));
    }
    if (leg.delaySeconds >= 60) {
        parts.push(t('journey.delayed', { minutes: Math.round(leg.delaySeconds / 60) }));
    }
    if (leg.cancelled) {
        parts.push(t('journey.cancelled'));
    }

    return parts.length === 0 ? undefined : parts.join(' · ');
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: Spacing.large, gap: Spacing.medium },
    card: {
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
        gap: Spacing.small,
    },
    step: { flexDirection: 'row', gap: Spacing.small, alignItems: 'flex-start' },
    time: { width: 52 },
    grow: { flex: 1, gap: 2 },
    stops: {
        // Indented under the leg it belongs to, so the timeline still reads as
        // one column of times with a branch rather than two lists.
        paddingLeft: Spacing.large,
        paddingTop: Spacing.extraSmall,
        gap: Spacing.extraSmall,
    },
});
