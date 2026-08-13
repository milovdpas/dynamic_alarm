const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

/**
 * Permits cleartext HTTP, but only when the configured API is cleartext.
 *
 * Development builds already allow it: Expo generates
 * `android/app/src/debug/AndroidManifest.xml` with `usesCleartextTraffic`, and
 * that file never reaches a release build. Preview builds are release builds,
 * so a preview pointed at `http://192.168.x.x:3000` cannot reach it, and
 * preview is exactly where this project verifies anything that matters.
 *
 * Enabling it unconditionally would leave a shipped alarm app permitting plain
 * HTTP to anywhere, for the sake of a laptop on the same wifi. Keying it to
 * `EXPO_PUBLIC_API_URL` means the permission exists precisely while it is
 * needed and disappears the moment the API is HTTPS, without anyone having to
 * remember to remove it.
 *
 * The variable must be set wherever the build runs, including on EAS, where it
 * belongs in the profile's `env` block. When it is unset or already HTTPS this
 * plugin does nothing at all.
 */
const withCleartextDevApi = (config) => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

    if (!apiUrl.startsWith('http://')) {
        return config;
    }

    console.warn(
        `[withCleartextDevApi] EXPO_PUBLIC_API_URL is ${apiUrl}, so this build ` +
            'permits cleartext HTTP. Point it at an HTTPS URL before shipping.',
    );

    return withAndroidManifest(config, (androidConfig) => {
        const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
            androidConfig.modResults,
        );
        application.$['android:usesCleartextTraffic'] = 'true';
        return androidConfig;
    });
};

module.exports = withCleartextDevApi;
