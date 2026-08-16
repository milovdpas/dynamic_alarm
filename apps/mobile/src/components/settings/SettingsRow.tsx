import { Pressable, StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * One line of settings: an icon, what it is, and what it currently says.
 *
 * The current value belongs on the row. A settings list that only names its
 * sections makes you open each one to find out what it holds, and most visits
 * are to check a setting rather than to change it.
 *
 * Rows lead somewhere rather than doing something. A switch that lives directly
 * in a list has no room to explain itself, and every setting in this app changes
 * when an alarm goes off, which is worth a sentence before it is worth a tap.
 */
export default function SettingsRow({
    icon,
    label,
    value,
    onPress,
    disabled = false,
}: {
    /** MaterialCommunityIcons name. Not user-facing copy. */
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    label: string;
    /** What it says now, when that fits in a few words. */
    value?: string;
    onPress: () => void;
    disabled?: boolean;
}) {
    const border = useThemeColor({}, 'border');
    const text = useThemeColor({}, 'text');
    const secondary = useThemeColor({}, 'textSecondary');
    const pressed = useThemeColor({}, 'backgroundSelected');

    return (
        <Pressable
            disabled={disabled}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={value === undefined ? label : `${label}: ${value}`}
            style={({ pressed: down }) => [
                styles.row,
                { borderColor: border },
                down && { backgroundColor: pressed },
            ]}
        >
            <MaterialCommunityIcons name={icon} size={22} color={disabled ? secondary : text} />

            <View style={styles.grow}>
                <ThemedText themeColor={disabled ? 'textSecondary' : 'text'}>{label}</ThemedText>
                {value !== undefined && (
                    <ThemedText type="small" themeColor="textSecondary">
                        {value}
                    </ThemedText>
                )}
            </View>

            <MaterialCommunityIcons name="chevron-right" size={22} color={secondary} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.small,
        borderWidth: 1,
        borderRadius: Radius.small,
        paddingVertical: Spacing.medium,
        paddingHorizontal: Spacing.medium,
    },
    grow: { flex: 1, gap: 2 },
});
