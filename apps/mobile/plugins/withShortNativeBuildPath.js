const { createHash } = require('node:crypto');
const { realpathSync } = require('node:fs');

const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Moves the native build tree off a path Windows cannot cope with.
 *
 * Windows caps a path at 260 characters, and the ninja shipped with CMake
 * 3.22.1 is not long-path aware, so it fails with a bare "No such file or
 * directory" while creating an object directory. Enabling `LongPathsEnabled` in
 * the registry does not help: the operating system permits it, the tool does
 * not use it.
 *
 * The paths get there honestly. Each object file carries a mirror of where its
 * source came from, inside an already deep build directory, so
 * `safeareacontext-generated.cpp.o` landed 351 characters down.
 *
 * **Measured from the tree a real build produced, not predicted.** With the root
 * below, the longest object path is 248 characters:
 * `RNSStackHeaderItemState.cpp.o` under `react_codegen_rnscreens.dir`. Twelve
 * characters of headroom against the 260 limit, which is why the per-checkout
 * suffix below is two characters and not four. Every one of them comes straight
 * out of that margin, and one new native dependency with a long component name
 * would spend the rest.
 *
 * **Windows only.** The path is absolute and meaningless on a Linux EAS worker,
 * where this would turn a working cloud build into a permission error, so the
 * plugin does nothing anywhere else.
 *
 * The other half of the fix is not config: build from a short path. A directory
 * junction is enough, and needs no admin rights:
 *
 *     mklink /J C:\da C:\Users\...\dynamic_alarm
 *
 * then build from `C:\da\apps\mobile`. That shortens the mirrored source half of
 * every object path, which relocating `.cxx` cannot reach.
 */
/**
 * A short root, plus two hex characters derived from this checkout's own path.
 *
 * Machine-global would mean a second clone or a git worktree silently sharing
 * one CMake staging tree, whose failure mode is stale object files and a linker
 * error that names nothing to do with the cause.
 *
 * Two characters rather than a digest, which keeps this root exactly as long as
 * the fixed name it replaced, so the 248 measured above still holds. 256 values
 * is ample for the handful of checkouts one machine has, and a collision costs a
 * shared build tree rather than a wrong APK.
 *
 * Hashed through `realpathSync`, which is the part that is easy to get wrong.
 * `projectRoot` is whatever path the build started from, so going through the
 * junction gives one string and running `expo run:android` directly gives
 * another. Hashing them raw would give a single checkout two staging trees and a
 * full native rebuild whenever you alternated between the two ways in; Node
 * resolves junctions, so resolving first collapses them to one.
 */
function stagingDirectory(projectRoot) {
    let resolved = projectRoot;
    try {
        resolved = realpathSync(projectRoot);
    } catch {
        // Not worth failing a build over. The worst case is the pair of trees
        // this is trying to avoid.
    }
    const id = createHash('sha1').update(resolved.toLowerCase()).digest('hex').slice(0, 2);
    return `C:/x/${id}`;
}

const withShortNativeBuildPath = (config) => {
    if (process.platform !== 'win32') {
        return config;
    }

    return withAppBuildGradle(config, (gradleConfig) => {
        const staging = stagingDirectory(gradleConfig.modRequest.projectRoot);
        const contents = gradleConfig.modResults.contents;
        if (contents.includes('buildStagingDirectory')) {
            return gradleConfig;
        }

        const anchor = 'android {\n    ndkVersion rootProject.ext.ndkVersion\n';
        if (!contents.includes(anchor)) {
            console.warn(
                '[withShortNativeBuildPath] Could not find the android block. On Windows ' +
                    'the native build may fail with "No such file or directory" from ninja.',
            );
            return gradleConfig;
        }

        gradleConfig.modResults.contents = contents.replace(
            anchor,
            `android {
    // Added by plugins/withShortNativeBuildPath.js: Windows path limit.
    externalNativeBuild {
        cmake {
            buildStagingDirectory = file('${staging}')
        }
    }

    ndkVersion rootProject.ext.ndkVersion
`,
        );
        return gradleConfig;
    });
};

module.exports = withShortNativeBuildPath;
