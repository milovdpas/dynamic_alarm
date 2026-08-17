type FontType = {
    fontFamily: string;
    fontWeight: '400' | '500' | '600' | '700' | 'bold' | 'normal' | undefined;
};

export const Fonts = {
    regular: { fontFamily: 'System', fontWeight: '400' } as FontType,
    medium: { fontFamily: 'System', fontWeight: '500' } as FontType,
    bold: { fontFamily: 'System', fontWeight: '700' } as FontType,
};

export const FontSize = {
    extraSmall: 12,
    small: 16,
    medium: 20,
    large: 24,
    extraLarge: 32,
    /** The wake-up time on the home screen and the ring screen clock. */
    display: 64,
};

export const Spacing = {
    none: 0,
    extraSmall: 5,
    small: 10,
    medium: 15,
    large: 30,
    extraLarge: 50,
};

export const Radius = {
    small: 8,
    medium: 12,
    large: 20,
    pill: 999,
};

export const Color = {
    black: '#111112',
    white: '#FFFFFF',
    night: '#0B1020',
    primary: '#3A6FF7',
    green: '#21C452',
    amber: '#D98324',
    red: '#D14343',
    grey: '#7B7B7B',
};

/**
 * Theme colours, resolved through `useThemeColor`.
 *
 * Dark is not an afterthought here, this app is looked at in bed and again at
 * 06:00, so both schemes get equal care.
 */
export const Colors = {
    light: {
        text: '#111112',
        textSecondary: '#60646C',
        background: '#FFFFFF',
        backgroundElement: '#F0F0F3',
        backgroundSelected: '#E0E1E6',
        border: '#D8D9DE',
        primary: Color.primary,
        danger: Color.red,
        warning: Color.amber,
        success: Color.green,
        /**
         * The navigation chrome: headers and the tab bar.
         *
         * Its own token because a palette may want the frame of the app to
         * differ from the page inside it, which is how most brands are actually
         * recognised. Light and dark set it to their own background, so they look
         * exactly as they did before this existed.
         */
        chrome: '#FFFFFF',
        /** Inactive tab labels, which sit on `chrome` rather than on the page. */
        chromeSecondary: '#60646C',
    },
    dark: {
        text: '#FFFFFF',
        textSecondary: '#B0B4BA',
        background: '#000000',
        backgroundElement: '#212225',
        backgroundSelected: '#2E3135',
        border: '#3A3D42',
        primary: '#7DA1FF',
        danger: '#FF8A8A',
        warning: '#F0A85C',
        success: '#5BD97F',
        chrome: '#000000',
        chromeSecondary: '#B0B4BA',
    },
    /**
     * NS house style: NS blauw `#003082` and NS geel `#FFC917`.
     *
     * The journey in this app is an NS journey, so the option is a reasonable
     * one to want. Two decisions keep it legible rather than merely faithful:
     *
     * **Yellow is a surface, never a foreground.** NS yellow *behind* text is
     * where it belongs: NS blue on NS yellow measures 7.8:1, comfortably past
     * every floor there is. The same yellow as a text or icon colour on white is
     * about 1.7:1 and fails all of them. So it fills the chrome, the selected
     * rows and the input surfaces, and never draws a glyph.
     *
     * The first attempt gave it one job, a pale tint behind a chosen row, and
     * the result was an app that looked plain blue. A house style lives on the
     * large surfaces or it does not read at all.
     *
     * **Danger stays red, warning stays amber.** They are not decoration: they
     * are the colours that mean a train is cancelled and an alarm did not arm.
     * Recolouring them to fit a palette would make the warnings stop reading as
     * warnings, which matters more than a consistent screenshot.
     */
    ns: {
        text: '#003082',
        textSecondary: '#5A6B8C',
        background: '#FFFFFF',
        // Warm rather than grey, so fields and banners sit in the palette
        // instead of looking like the light theme leaked through.
        backgroundElement: '#FFF6D9',
        // Full NS yellow. This is the weekday chips, the chosen departure, the
        // selected language, the pressed settings row: everywhere the app says
        // "this one", said in the brand's own colour.
        backgroundSelected: '#FFC917',
        border: '#C8D3E6',
        primary: '#003082',
        /**
         * Darker than the shared red and amber, and measured rather than picked.
         *
         * The palette's surfaces are warm, so the shared amber `#D98324` landed
         * at 2.69:1 on the pale yellow the warning banner is drawn on, and the
         * shared red at 4.23:1. Warm on warm is the predictable failure and it
         * was found by measuring, not by looking: on a screenshot it reads as a
         * fine, slightly soft banner. These reach 6.7:1 and 6.3:1 there, and
         * clear 4.4:1 even on full NS yellow.
         *
         * Still unmistakably red and amber. The meaning is what may not change;
         * the exact hex was never the point.
         */
        danger: '#A82121',
        warning: '#8A4B00',
        success: '#1B7F3B',
        // The band across the top and the bar along the bottom, which is where
        // anyone recognises NS from a metre away.
        chrome: '#FFC917',
        // Inactive tab labels, on yellow. Darkened from `textSecondary` until it
        // passed: the obvious blue-grey manages only 3.5:1 against this
        // background, and this reaches 5:1.
        chromeSecondary: '#405374',
    },
} as const;

export type ThemeColor = keyof typeof Colors.light &
    keyof typeof Colors.dark &
    keyof typeof Colors.ns;
