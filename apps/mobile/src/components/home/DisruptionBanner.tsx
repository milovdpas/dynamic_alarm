import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DeviceResponse, OccurrenceResponse } from '@alarm/types';

import { readDisruption } from '@/alarm/disruption';
import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { clock } from '@/utils/time';

/** Below this, a change is timetable jitter rather than news. */
const NOTICEABLE_MINUTES = 2;

/**
 * What is wrong with this morning, and what the alarm did about it.
 *
 * The moment the whole product exists for is a sentence: "your train is twelve
 * minutes late, so you can sleep twelve minutes longer". Until now the alarm
 * moved and no screen said anything, which is the one thing an alarm that moves
 * itself cannot afford. An alarm that changes without explaining itself is an
 * alarm nobody trusts.
 *
 * Four states, and the fourth is the one that is easy to forget: a disruption
 * the alarm deliberately did **not** act on. With the opt-in settings off a
 * delay changes nothing, and silence there is indistinguishable from an app that
 * never noticed. It says what it noticed and which switch would have let it act.
 *
 * Nothing is shown on an ordinary morning. The banner belongs to the plan in
 * force rather than to a history, so a re-check that finds the journey running
 * normally makes it disappear.
 */
export default function DisruptionBanner({
    occurrence,
    device,
}: {
    occurrence: OccurrenceResponse;
    device: DeviceResponse | null;
}) {
    const { t } = useTranslation();
    const warning = useThemeColor({}, 'warning');

    const disruption = readDisruption(occurrence);
    if (disruption === null) {
        return null;
    }

    const service = disruption.service ?? t('ring.your_journey');
    const cancelled = disruption.kind !== 'DELAY';

    /**
     * How much the alarm moved, measured against the anchor.
     *
     * The anchor is the time computed when the morning was armed and never moved
     * since, which makes it the honest baseline for "compared to what you were
     * expecting". Reading it from the occurrence also avoids a second request
     * for the event trail.
     */
    const gained = Math.round(
        (new Date(occurrence.currentWakeAt).getTime() -
            new Date(occurrence.anchorWakeAt).getTime()) /
            60_000,
    );

    return (
        <View style={[styles.banner, { borderColor: warning }]}>
            <ThemedText type="smallBold" style={{ color: warning }}>
                {disruption.kind === 'NO_REPLACEMENT'
                    ? t('ring.no_replacement')
                    : cancelled
                      ? t('disruption.cancelled', { service })
                      : t('disruption.delayed', { service, minutes: disruption.minutes })}
            </ThemedText>

            <ThemedText type="small" themeColor="textSecondary">
                {outcome(t, {
                    cancelled,
                    gained,
                    device,
                    wakeAt: occurrence.currentWakeAt,
                })}
            </ThemedText>

            {disruption.simulated && (
                <ThemedText type="small" style={{ color: warning }}>
                    {t('ring.simulated')}
                </ThemedText>
            )}
        </View>
    );
}

/**
 * What happened to the alarm, in the terms the user cares about.
 *
 * Extra sleep is stated as extra sleep rather than as a new time. "Your alarm
 * moved to 07:05" is a notification; "you can sleep twelve minutes longer" is
 * the reason this app exists.
 */
function outcome(
    t: (key: string, options?: Record<string, unknown>) => string,
    input: {
        cancelled: boolean;
        gained: number;
        device: DeviceResponse | null;
        wakeAt: string;
    },
): string {
    if (input.gained >= NOTICEABLE_MINUTES) {
        return t('disruption.sleep_longer', { minutes: input.gained });
    }

    if (input.gained <= -NOTICEABLE_MINUTES) {
        return t('disruption.moved_earlier', {
            minutes: Math.abs(input.gained),
            time: clock(input.wakeAt),
        });
    }

    // Nothing moved, and why is the whole point of this line. A switch that is
    // off is a decision the user made and can revisit; a plan with enough spare
    // time in it is the buffers doing their job.
    const allowed = input.cancelled
        ? input.device?.allowLaterWakeOnCancellation
        : input.device?.allowLaterWakeOnDelay;

    if (allowed === false) {
        return input.cancelled
            ? t('disruption.not_moved_cancellation_off')
            : t('disruption.not_moved_delay_off');
    }

    return t('disruption.not_moved_absorbed');
}

const styles = StyleSheet.create({
    banner: {
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
        gap: Spacing.extraSmall,
    },
});
