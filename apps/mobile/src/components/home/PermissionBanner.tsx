import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAlarmPermissions } from '@/alarm/useAlarmPermissions';
import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import WarningBanner from '@/components/ui/WarningBanner';

/**
 * Says, permanently, when this phone will not ring.
 *
 * The app used to tell people to "check permissions in the debug panel", a
 * screen reachable only by tapping the version ten times and typing a password.
 * That sentence was the whole bug in miniature: it knew the alarm could not
 * work, and pointed at somewhere the user could not go.
 *
 * **Permanent, and not a nag.** It states the situation wherever the alarm is
 * shown, with the way to fix it attached, and never interrupts. Somebody who
 * decided against notifications should keep a working app that says plainly what
 * it cannot do, and should not be asked again on every launch.
 *
 * The recommended pair is deliberately quieter than the required pair. An alarm
 * that may not cover the lock screen is worth mentioning; an alarm that cannot
 * ring at all is worth stopping to read.
 */
export default function PermissionBanner() {
    const { t } = useTranslation();
    const { permissions, canRing, hasGaps, unsupported, request, openSettings } =
        useAlarmPermissions();

    // Nothing to ask for on this runtime, and the alarm harness already explains
    // why. A second banner saying the same thing helps nobody.
    if (unsupported || permissions === null) {
        return null;
    }

    if (!canRing) {
        return (
            <View style={styles.stack}>
                <WarningBanner
                    title={t('permissions.cannot_ring_title')}
                    message={t(
                        permissions.notifications
                            ? 'permissions.cannot_ring_exact'
                            : 'permissions.cannot_ring_notifications',
                    )}
                />
                {/*
                 * Both offered at once, rather than the second appearing after
                 * the first fails. Android answers an already-refused request
                 * with "denied" and shows nothing at all, so a lone button would
                 * look broken to the person who most needs it to work, and there
                 * is no way to tell in advance which of the two they need.
                 */}
                <ActionButton
                    label={t('permissions.fix')}
                    variant="primary"
                    onPress={() => void request()}
                />
                <ActionButton
                    label={t('permissions.open_settings')}
                    onPress={() => void openSettings()}
                />
            </View>
        );
    }

    if (hasGaps) {
        return (
            <WarningBanner
                title={t('permissions.gaps_title')}
                message={t(
                    permissions.fullScreen
                        ? 'permissions.gaps_battery'
                        : 'permissions.gaps_full_screen',
                )}
            />
        );
    }

    return null;
}

const styles = StyleSheet.create({
    stack: { gap: Spacing.small },
});
