import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DeviceResponse, OccurrenceResponse } from '@alarm/types';

import { NOTICEABLE_MINUTES, readDisruption, wasDeclined } from '@/alarm/disruption';
import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { useThemeColor } from '@/utils/hooks/useThemeColor';
import { ApiRequestError } from '@/utils/modules/Axios';
import { clock } from '@/utils/time';

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
    onMove,
}: {
    occurrence: OccurrenceResponse;
    device: DeviceResponse | null;
    /**
     * Moves the alarm onto the stored plan, when there is something to move.
     *
     * Passed in rather than called from here, so this component knows what to
     * offer and not how to do it. Today hands it the real endpoint plus a
     * re-arm; the debug panel hands it something that reports instead, which is
     * the only way to look at this banner without a cancelled train.
     *
     * Omitted means no offer, which is right for anywhere the alarm is not this
     * screen's to change.
     */
    onMove?: () => Promise<void>;
}) {
    const { t } = useTranslation();
    const warning = useThemeColor({}, 'warning');
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState<string | null>(null);

    const move = useCallback(() => {
        if (onMove === undefined) {
            return;
        }
        setBusy(true);
        setFailed(null);
        onMove()
            .catch((error: unknown) => {
                setFailed(ApiRequestError.from(error).code);
            })
            .finally(() => {
                setBusy(false);
            });
    }, [onMove]);

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

    const noReplacement = disruption.kind === 'NO_REPLACEMENT';
    const declined = wasDeclined({ cancelled, gained, device, noReplacement });

    return (
        <View style={[styles.banner, { borderColor: warning }]}>
            <ThemedText type="smallBold" style={{ color: warning }}>
                {noReplacement
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
                    noReplacement,
                    wakeAt: occurrence.currentWakeAt,
                })}
            </ThemedText>

            {disruption.simulated && (
                <ThemedText type="small" style={{ color: warning }}>
                    {t('ring.simulated')}
                </ThemedText>
            )}

            {declined && onMove !== undefined && (
                <ActionButton
                    label={busy ? t('disruption.moving') : t('disruption.move_it_anyway')}
                    onPress={move}
                    disabled={busy}
                />
            )}

            {failed !== null && (
                <ThemedText type="small" themeColor="danger">
                    {apiErrorMessage(t, failed)}
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
        noReplacement: boolean;
        wakeAt: string;
    },
): string {
    /*
     * Said first, because it is the one case where the alarm not moving is not a
     * choice anybody made. It used to fall through to "your journey had enough
     * spare time in it", which is the opposite of true for a cancelled train
     * with nothing to take.
     */
    if (input.noReplacement) {
        return t('disruption.not_moved_no_replacement', { time: clock(input.wakeAt) });
    }

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
    if (wasDeclined(input)) {
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
