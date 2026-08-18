import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds a release APK locally, without EAS and without anything to remember.
 *
 * `eas build --local` refuses to run on Windows, and a plain
 * `expo run:android --variant release` fails there for a reason that has nothing
 * to do with this project: Windows caps a path at 260 characters, the ninja
 * bundled with CMake 3.22.1 is not long-path aware, and each object file mirrors
 * the *source* path of a generated C++ file inside an already deep build tree.
 * `safeareacontext-generated.cpp.o` lands 351 characters down and the build dies
 * with a bare "No such file or directory".
 *
 * Two halves have to shrink and only one is reachable from config.
 * `plugins/withShortNativeBuildPath.js` moves the build tree; this moves the
 * source half, by building through a **directory junction** with a short name.
 * Nothing is copied and nothing is moved: a junction is the same files under a
 * shorter path, and creating one needs no administrator rights.
 *
 * On anything other than Windows it just runs the build, because no other
 * platform has the problem.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(HERE, '..');
const REPO = resolve(MOBILE, '../..');
// Forward slashes on purpose. Node accepts them on Windows, and they cannot
// be mangled by a shell or a heredoc the way a backslash can.
const SHORT_ROOT = 'C:/da';

/** The junction, created if absent and verified if present. */
function shortRepoPath() {
    if (process.platform !== 'win32') {
        return REPO;
    }

    /*
     * `lstatSync` rather than `existsSync`, because the latter follows the
     * junction: a link left behind after its target moved reports as absent,
     * the ownership check below is skipped, and `mklink` then fails with "Cannot
     * create a file when that file already exists", which names neither the
     * cause nor the fix.
     */
    let entry = null;
    try {
        entry = lstatSync(SHORT_ROOT);
    } catch {
        entry = null;
    }

    if (entry !== null) {
        if (!existsSync(SHORT_ROOT)) {
            throw new Error(
                `${SHORT_ROOT} exists but points at nothing. Remove it with ` +
                    `\`rmdir ${SHORT_ROOT}\` and run this again.`,
            );
        }
        // Something else already owns the name. Better to say so than to build
        // an APK from a directory nobody meant to build.
        if (realpathSync(SHORT_ROOT).toLowerCase() !== realpathSync(REPO).toLowerCase()) {
            throw new Error(
                `${SHORT_ROOT} exists and does not point at ${REPO}. ` +
                    'Remove it, or edit SHORT_ROOT in scripts/build-apk.mjs.',
            );
        }
        return SHORT_ROOT;
    }

    console.log(`Creating a junction ${SHORT_ROOT} -> ${REPO}`);
    execFileSync('cmd', ['/c', 'mklink', '/J', SHORT_ROOT, REPO], { stdio: 'inherit' });
    return SHORT_ROOT;
}

/**
 * Where the Android SDK is, without anyone having to have exported it.
 *
 * Gradle fails with "SDK location not found" when `ANDROID_HOME` is unset, and
 * an environment variable set in one terminal is not set in the next, so the
 * build worked once and failed the following morning in a fresh shell. Looking
 * in the place the SDK is installed by default costs nothing and removes a
 * class of "it worked yesterday" entirely.
 *
 * An explicit variable still wins, since somebody who set one meant it.
 */
function androidSdkPath() {
    const configured = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    if (configured !== undefined && configured !== '' && existsSync(configured)) {
        return configured;
    }

    const defaults = {
        win32: `${process.env.LOCALAPPDATA ?? ''}/Android/Sdk`,
        darwin: `${homedir()}/Library/Android/sdk`,
    };
    const candidate = defaults[process.platform] ?? `${homedir()}/Android/Sdk`;

    // Checked for `platform-tools` rather than for the directory, because an
    // empty `Sdk` folder left by an abandoned install passes `existsSync` and
    // then fails inside Gradle with a far less obvious message.
    if (!existsSync(`${candidate}/platform-tools`)) {
        throw new Error(
            `No Android SDK found. Looked at ${candidate}, and ANDROID_HOME is ` +
                `${configured === undefined ? 'not set' : configured}. Install the ` +
                'command-line tools, or set ANDROID_HOME to an existing SDK.',
        );
    }
    return candidate;
}

const sdk = androidSdkPath();
const root = shortRepoPath();
const cwd = root === REPO ? MOBILE : join(root, 'apps', 'mobile');

console.log(`Building from ${cwd}`);
console.log(`Android SDK  ${sdk}`);
const result = spawnSync(
    'npx',
    ['expo', 'run:android', '--variant', 'release', ...process.argv.slice(2)],
    {
        cwd,
        stdio: 'inherit',
        shell: true,
        // Both names: Gradle reads one, parts of the Android tooling read the
        // other, and which of them is consulted has changed between versions.
        env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk },
    },
);

/*
 * A spawn that never started has no status, only an error. Exiting 1 on it and
 * printing nothing is how "npx is not on PATH" becomes a silent failure.
 */
if (result.error !== undefined) {
    console.error(`Could not start the build: ${result.error.message}`);
    process.exit(1);
}

process.exit(result.status ?? 1);
