// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// The one shared rule. Everything else in the base config is server-shaped, and
// the Expo config already brings the React and React Native conventions this
// workspace needs, so only the project-wide writing rule crosses over.
const alarm = require('../../tools/eslint-plugin-alarm/index.cjs');

/**
 * Native modules that must never be imported at module scope.
 *
 * They throw at *import* time when absent, which happens in Expo Go, and far
 * more often on a development build that predates the dependency. A throwing
 * import stops every downstream module from evaluating, so expo-router reports
 * "Route is missing the required default export" for unrelated screens and the
 * app never mounts. This cost four debugging cycles during M0.
 *
 * Load them through `utils/modules/optionalModule.ts` (or an existing wrapper
 * like `Storage.ts`) inside the function that needs them.
 *
 * `react-native-notify-kit` is deliberately absent: it defers all native access
 * out of its constructor, so importing it is safe. Its *calls* are still guarded
 * via `alarmSupport.ts`.
 */
const IMPORT_TIME_UNSAFE_NATIVE_MODULES = [
    'expo-localization',
    'expo-notifications',
    'expo-secure-store',
    'expo-task-manager',
    'expo-device',
    'expo-updates',
    '@react-native-async-storage/async-storage',
    // Calls requireNativeView at module scope, so importing it throws when the
    // native view is absent: Expo Go, iOS, or any build older than the
    // dependency. Loaded lazily by TimeField, which falls back to a typed field.
    '@expo/ui/jetpack-compose',
];

module.exports = defineConfig([
    expoConfig,
    {
        ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*'],
    },
    {
        files: ['**/*.ts', '**/*.tsx', '**/*.js'],
        plugins: { alarm },
        rules: {
            'alarm/no-dashes': 'error',
        },
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    paths: IMPORT_TIME_UNSAFE_NATIVE_MODULES.map((name) => ({
                        name,
                        message: `Do not import ${name} at module scope. It throws at import time when the native module is missing (Expo Go, or a dev build older than the dependency), which takes the whole app down. Load it lazily via loadOptionalModule() inside the function that needs it. See docs/CONVENTIONS.md.`,
                    })),
                },
            ],
        },
    },
    {
        // The wrappers exist precisely to contain these lazy requires.
        files: [
            'src/components/ui/TimeField.tsx',
            'src/utils/modules/pushToken.ts',
            'src/utils/modules/Splash.ts',
            'src/utils/modules/Storage.ts',
            'src/utils/modules/Updates.ts',
            'src/utils/modules/Axios.ts',
            'src/utils/modules/optionalModule.ts',
            'src/utils/modules/nativeDiagnostics.ts',
            'src/push/backgroundTask.ts',
            'src/alarm/IosAlarmScheduler.ts',
            'src/i18n/i18n.ts',
        ],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
]);
