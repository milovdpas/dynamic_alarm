import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { relativeDateTime } from '@/utils/time';
import { useApiFreshness } from '@/utils/hooks/useApiFreshness';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * Says that this is the last known answer, and when it was known.
 *
 * The date is the entire point. "Your alarm is 06:42" when nobody has checked
 * since yesterday evening is a lie with a number in it; "your alarm is 06:42, as
 * last known at 21:30 yesterday" is a useful thing to read on a train platform
 * with no signal.
 *
 * Quiet rather than alarming. Nothing here is wrong: the times shown are the
 * ones this phone will actually ring at, since the alarm is already armed in the
 * OS. What cannot happen is learning about a delay that appeared since.
 */
interface StaleNoticeProps {
    /**
     * This screen's own cached-at time, when it uses `useApiQuery`.
     *
     * Preferred over the global flag when given, because a screen that knows
     * exactly which copy it is rendering can date it precisely. Without it the
     * component falls back to the app-wide state, which is what the screens
     * still fetching by hand rely on.
     */
    cachedAt?: string | null;
}

export default function StaleNotice({ cachedAt }: StaleNoticeProps) {
    const { t } = useTranslation();
    const global = useApiFreshness();

    /*
     * Either source counts, and it has to be either rather than a preference.
     *
     * There are two ways this screen can be showing an old answer, and on a
     * migrated screen the second one hides the first. `useApiQuery` reports the
     * copy it painted before the request finished. But the request itself may
     * then be answered from the cache inside `Axios.get`, which looks like a
     * *success* to the query: `cachedAt` is cleared, `error` stays null, and the
     * screen would quietly claim to be live while showing yesterday.
     *
     * The timestamp prefers the query's own, since it names the copy actually on
     * screen, and falls back to the app-wide one.
     */
    const servingFromCache = (cachedAt ?? null) !== null || global.servingFromCache;
    const since = cachedAt ?? global.since;
    const border = useThemeColor({}, 'border');
    const secondary = useThemeColor({}, 'textSecondary');

    if (!servingFromCache) {
        return null;
    }

    return (
        <View style={[styles.row, { borderColor: border }]}>
            <MaterialCommunityIcons name="cloud-off-outline" size={16} color={secondary} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
                {since === null
                    ? t('api.stale_unknown')
                    : t('api.stale', { when: relativeDateTime(t, since) })}
            </ThemedText>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.small,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: Radius.small,
        paddingVertical: Spacing.small,
        paddingHorizontal: Spacing.medium,
    },
    grow: { flex: 1 },
});
