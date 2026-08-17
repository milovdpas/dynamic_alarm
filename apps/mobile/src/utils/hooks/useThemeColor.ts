import { Colors, type ThemeColor } from '@/assets/Stylesheet';
import { type Theme, useTheme } from '@/utils/contexts/ThemeContext';

/**
 * An override per theme, all optional.
 *
 * Keyed off `Theme` rather than listed by hand, so a palette added to `Colors`
 * can be overridden here without this signature going stale. A theme with no
 * entry falls through to the palette, which is what nearly every caller wants.
 */
type Overrides = Partial<Record<Theme, string>>;

export function useThemeColor(props: Overrides, colorName: ThemeColor) {
    const { theme } = useTheme();
    const colorFromProps = props[theme];

    if (colorFromProps) {
        return colorFromProps;
    }
    return Colors[theme][colorName];
}
