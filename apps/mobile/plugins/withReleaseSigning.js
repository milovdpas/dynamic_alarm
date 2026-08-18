const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Signs release builds with the real keystore, when its details are on hand.
 *
 * The Expo template signs release with the **debug** keystore. That produces a
 * working APK and an uninstallable one: Android refuses to install a package
 * over one signed by a different key, so a locally built release cannot replace
 * the build that came from EAS. Replacing it would mean uninstalling first,
 * which takes the device token, the settings and every armed alarm with it, and
 * leaves an orphaned device row on the server.
 *
 * A config plugin rather than an edit to `android/app/build.gradle`, because
 * that directory is generated: it is in `.gitignore`, and `expo prebuild`
 * rewrites it. An edit made by hand survives until the next prebuild and then
 * vanishes, at which point the next build is silently debug-signed again.
 *
 * The values live in `~/.gradle/gradle.properties`, never in the repository,
 * since one of them is the keystore password:
 *
 *   DYNAMIC_ALARM_STORE_FILE=C:/path/to/upload-keystore.jks
 *   DYNAMIC_ALARM_STORE_PASSWORD=...
 *   DYNAMIC_ALARM_KEY_ALIAS=...
 *   DYNAMIC_ALARM_KEY_PASSWORD=...
 *
 * `eas credentials` prints all four for the EAS-managed keystore. With none of
 * them set this plugin changes nothing, so a machine without the keystore still
 * builds, just with an APK that cannot be installed over an EAS one.
 */
const RELEASE_CONFIG = `
        // Added by plugins/withReleaseSigning.js
        if (project.hasProperty('DYNAMIC_ALARM_STORE_FILE')) {
            release {
                storeFile file(DYNAMIC_ALARM_STORE_FILE)
                storePassword DYNAMIC_ALARM_STORE_PASSWORD
                keyAlias DYNAMIC_ALARM_KEY_ALIAS
                keyPassword DYNAMIC_ALARM_KEY_PASSWORD
            }
        }
`;

const withReleaseSigning = (config) => {
    /*
     * Never on EAS. The cloud build has its own credential step, which patches
     * the very line this plugin rewrites, and on EAS the gradle property is
     * never set so the ternary would resolve to the debug key anyway. Rewriting
     * an anchor somebody else is looking for, to no benefit, is a good way to
     * break signing in the one place we cannot easily test.
     */
    if (process.env.EAS_BUILD === 'true') {
        return config;
    }

    return withAppBuildGradle(config, (gradleConfig) => {
        let contents = gradleConfig.modResults.contents;

        // Idempotent: prebuild runs this on whatever is already there, which
        // may be a copy this plugin wrote a moment ago.
        if (contents.includes('DYNAMIC_ALARM_STORE_FILE')) {
            return gradleConfig;
        }

        const anchor = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
`;
        if (!contents.includes(anchor)) {
            // The template changed shape. Said out loud rather than silently
            // skipped: a release quietly signed with the debug key is exactly
            // the outcome this plugin exists to prevent.
            console.warn(
                '[withReleaseSigning] Could not find the debug signing block. ' +
                    'Release builds will use the debug key and cannot be installed ' +
                    'over an EAS build.',
            );
            return gradleConfig;
        }

        /*
         * Checked rather than attempted, and this is the half that matters.
         * Adding the signing config while failing to point the release build at
         * it produces an APK signed with the debug key, and the guard above then
         * makes that permanent: the next prebuild sees the marker, returns
         * early, and never tries again. A silently debug-signed release is
         * exactly what this plugin exists to prevent.
         */
        const buildType = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

        if (!contents.includes(buildType)) {
            console.warn(
                '[withReleaseSigning] Found the signing block but not the release build type. ' +
                    'Leaving build.gradle alone: a half-applied change would sign releases with ' +
                    'the debug key and look configured.',
            );
            return gradleConfig;
        }

        contents = contents.replace(anchor, anchor + RELEASE_CONFIG);
        contents = contents.replace(
            buildType,
            `        release {
            // The real key when it is configured, the debug one otherwise.
            signingConfig project.hasProperty('DYNAMIC_ALARM_STORE_FILE')
                ? signingConfigs.release
                : signingConfigs.debug`,
        );

        gradleConfig.modResults.contents = contents;
        return gradleConfig;
    });
};

module.exports = withReleaseSigning;
