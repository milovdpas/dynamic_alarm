import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DEFAULT_REMINDERS, JourneyStatus, LegType, OccurrenceState } from '@alarm/types';
import type { DeviceResponse, Journey, OccurrenceResponse } from '@alarm/types';

import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import Section from '@/components/debug/Section';
import DisruptionBanner from '@/components/home/DisruptionBanner';
import { ThemedText } from '@/components/ui/ThemedText';

/**
 * Every state the Today banner can be in, side by side.
 *
 * It is the sentence the whole product exists for, and it only appears when a
 * train is actually late, which made it the one piece of copy nobody could read
 * on purpose. The ring screen already had previews for the same reason; this is
 * the other half.
 *
 * Five states, and the last two are the ones worth having: a disruption the alarm
 * deliberately did **not** act on, which is what happens with the opt-in
 * switches off. Those are the only states that offer the move button, so this is
 * also where to check that it appears exactly there and nowhere else.
 *
 * `NO_REPLACEMENT` is deliberately absent, and its absence is a finding rather
 * than an omission: this banner derives its state from the occurrence, and
 * `readDisruption` cannot produce that kind, because an occurrence records a
 * cancellation with no replacement and one the alarm was not allowed to act on
 * identically. Only the push knows the difference, so only the ring screen can
 * show it, and it has a preview of its own above.
 *
 * **The button does not move anything here.** These occurrences are invented and
 * have no id the server would recognise, so pressing it reports what it would
 * have done. The wiring is exercised by the real path instead: stage a delay in
 * the section below with the matching switch turned off, which produces this
 * banner from a real morning with a real plan behind it.
 */
const STATES = [
    'DELAY',
    'CANCELLATION',
    'CANCELLATION_REPLACED',
    'DECLINED_DELAY',
    'DECLINED_CANCELLATION',
] as const;

type PreviewState = (typeof STATES)[number];

export default function BannerPreviewSection() {
    const { t } = useTranslation();
    const [showing, setShowing] = useState<PreviewState | null>(null);
    const [pressed, setPressed] = useState(false);

    return (
        <Section title={t('banner_preview.title')}>
            <ThemedText type="small" themeColor="textSecondary">
                {t('banner_preview.help')}
            </ThemedText>

            {STATES.map((state) => (
                <ActionButton
                    key={state}
                    label={t(`banner_preview.${state}`)}
                    onPress={() => {
                        setPressed(false);
                        setShowing((current) => (current === state ? null : state));
                    }}
                />
            ))}

            {showing !== null && (
                <View style={styles.stage}>
                    <DisruptionBanner
                        occurrence={occurrenceFor(showing)}
                        device={deviceFor(showing)}
                        onMove={() => {
                            setPressed(true);
                            return Promise.resolve();
                        }}
                    />
                    {pressed && (
                        <ThemedText type="small" themeColor="textSecondary">
                            {t('banner_preview.pressed')}
                        </ThemedText>
                    )}
                </View>
            )}
        </Section>
    );
}

/**
 * The switches, set to whatever makes each state reachable.
 *
 * The declined states are declined *because* a switch is off, so inventing a
 * device is part of inventing the state rather than an extra detail.
 */
function deviceFor(state: PreviewState): DeviceResponse {
    const declined = state === 'DECLINED_DELAY' || state === 'DECLINED_CANCELLATION';
    // Everything else has the switches on, including NO_REPLACEMENT: that state
    // is about there being nothing to take, not about being refused.
    return {
        allowLaterWakeOnDelay: !declined,
        allowLaterWakeOnCancellation: !declined,
        allowEarlierWakeOnTraffic: true,
    } as DeviceResponse;
}

const IN_TWO_HOURS = 2 * 60 * 60 * 1000;

/** Minutes the alarm moved in each state. Negative is earlier. */
const MOVEMENT: Record<PreviewState, number> = {
    DELAY: 12,
    CANCELLATION: -14,
    CANCELLATION_REPLACED: -14,
    DECLINED_DELAY: 0,
    DECLINED_CANCELLATION: 0,
};

function occurrenceFor(state: PreviewState): OccurrenceResponse {
    const anchor = new Date(Date.now() + IN_TWO_HOURS);
    /*
     * How far the alarm moved, measured against the anchor, which is what the
     * banner reads.
     *
     * Chosen per state rather than uniformly, because the combination is the
     * thing being previewed. A delay the alarm was allowed to act on buys sleep;
     * a cancellation pulls somebody earlier to catch something else; a
     * cancellation with nothing to catch and a declined move both leave the
     * alarm exactly where it was, for completely different reasons.
     */
    const movedMinutes = MOVEMENT[state];
    const current = new Date(anchor.getTime() + movedMinutes * 60_000);

    const cancelled = state !== 'DELAY' && state !== 'DECLINED_DELAY';
    const replaced = state === 'CANCELLATION_REPLACED';

    return {
        id: `preview-${state}`,
        scheduleId: 'preview',
        scheduleName: 'Preview',
        reminders: DEFAULT_REMINDERS,
        date: current.toISOString().slice(0, 10),
        state: OccurrenceState.ARMED,
        anchorWakeAt: anchor.toISOString(),
        currentWakeAt: current.toISOString(),
        departHomeAt: current.toISOString(),
        journey: journey(cancelled && !replaced, cancelled ? 0 : 12 * 60),
        // Present only for a cancellation the alarm was allowed to act on, which
        // is exactly when the app knows a replacement to name.
        replacedJourney: replaced ? journey(true, 0) : null,
        plan: null as unknown as OccurrenceResponse['plan'],
        lastCheckedAt: null,
        simulated: null,
        disabledStepIds: [],
    };
}

/** A one-leg journey, delayed or cancelled as asked. */
function journey(legCancelled: boolean, delaySeconds: number): Journey {
    const at = new Date().toISOString();
    return {
        id: 'preview',
        ctxRecon: null,
        status: legCancelled ? JourneyStatus.CANCELLED : JourneyStatus.NORMAL,
        legs: [
            {
                type: LegType.TRAIN,
                name: 'Intercity 3052',
                fromName: 'Utrecht Centraal',
                toName: 'Amsterdam Zuid',
                plannedDeparture: at,
                actualDeparture: at,
                plannedArrival: at,
                actualArrival: at,
                delaySeconds,
                cancelled: legCancelled,
            },
        ],
        departureAt: at,
        arrivalAt: at,
        transferCount: 0,
        source: 'NS',
        watchedStationCodes: [],
    };
}

const styles = StyleSheet.create({
    stage: { gap: Spacing.small, marginTop: Spacing.small },
});
