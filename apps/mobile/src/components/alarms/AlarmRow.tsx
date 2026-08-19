import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * One alarm in the list, whatever kind it is.
 *
 * Deliberately one component for both kinds. A commute worked out from a
 * timetable and an alarm somebody typed in are different things to build and the
 * same thing to look at: a time, when it repeats, and a switch. Two components
 * would drift into two visual languages inside one list, and the list is the
 * whole point of the tab.
 *
 * The switch is the standing alarm, on or off. Not "skip tomorrow", which lives
 * inside the expanded area: a switch that means "off for good" on a one-off and
 * "off for tomorrow" on a recurring alarm is a switch nobody can predict, and
 * skipping expires by itself, which no switch can express.
 */
export default function AlarmRow({
    time,
    title,
    subtitle,
    note,
    enabled,
    muted = false,
    busy,
    expanded,
    onToggle,
    onExpand,
    children,
}: {
    time: string;
    title: string;
    /** When it repeats, or which morning it is for. */
    subtitle: string;
    /** Anything that needs saying about this morning specifically. */
    note?: string | null;
    enabled: boolean;
    /** Struck through and dimmed: the alarm exists but is not ringing next. */
    muted?: boolean;
    busy: boolean;
    expanded: boolean;
    onToggle: () => void;
    onExpand: () => void;
    /** The expanded half: whatever this kind of alarm can be told to do. */
    children?: ReactNode;
}) {
    const border = useThemeColor({}, 'border');
    const surface = useThemeColor({}, 'backgroundElement');
    const primary = useThemeColor({}, 'primary');

    return (
        <View style={[styles.card, { backgroundColor: surface, borderColor: border }]}>
            <Pressable
                style={styles.header}
                onPress={onExpand}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={title}
            >
                <View style={styles.headings}>
                    <ThemedText
                        type="title"
                        themeColor={enabled && !muted ? 'text' : 'textSecondary'}
                        style={muted ? styles.struck : undefined}
                    >
                        {time}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                        {title}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                        {subtitle}
                    </ThemedText>
                    {note !== undefined && note !== null && (
                        <ThemedText type="small" themeColor="textSecondary">
                            {note}
                        </ThemedText>
                    )}
                </View>

                <View style={styles.controls}>
                    <Switch value={enabled} onValueChange={onToggle} disabled={busy} />
                    <MaterialCommunityIcons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={24}
                        color={primary}
                    />
                </View>
            </Pressable>

            {expanded && <View style={styles.body}>{children}</View>}
        </View>
    );
}

const styles = StyleSheet.create({
    card: { borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: Spacing.medium,
        gap: Spacing.medium,
    },
    headings: { flex: 1, gap: Spacing.extraSmall },
    controls: { alignItems: 'center', gap: Spacing.small },
    body: { paddingHorizontal: Spacing.medium, paddingBottom: Spacing.medium, gap: Spacing.medium },
    struck: { textDecorationLine: 'line-through' },
});
