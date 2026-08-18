# @alarm/mobile

The Expo app. Routes live in `src/app/` and nothing else does, see
[docs/CONVENTIONS.md](../../docs/CONVENTIONS.md) for why.

```bash
npm run dev:mobile          # from the repo root: Metro, for a development build
npm run start:go            # Expo Go, alarms disabled but the app runs
npm test -w @alarm/mobile   # the app's own logic, node environment, no React
npx tsc --noEmit            # here
npx expo lint               # here
```

## Building an APK on this machine

```bash
npm run build:apk -w @alarm/mobile
```

One command because Windows needs three things arranged first, and forgetting any
of them fails in a way that does not name itself. It finds the Android SDK, works
around the 260 character path limit through a directory junction, and passes the
release signing and update channel that EAS would otherwise supply. The reasoning
is in [docs/PLAN.md](../../docs/PLAN.md) under "Building an APK without EAS".

Needs the Android SDK (`platform-tools`, `platforms;android-36`,
`build-tools;36.0.0`) and a JDK. Nothing else, and not Android Studio.

The native build tree does not live in this repository. It goes to `C:\x\<two
characters>`, derived from where this checkout is, because Windows cannot cope
with the paths CMake generates under a deep project directory. It reaches a
couple of hundred megabytes per checkout and nothing ever cleans it up, so it is
worth knowing it is there:

```bash
du -sh /c/x/*        # what each checkout's tree costs
rm -rf /c/x/da       # the shared tree used before the per-checkout suffix
```

Deleting one costs a full native rebuild of that checkout and nothing else.

## Debugging on a real device

The alarm only exists on a phone, so most of what goes wrong is only visible
there. These are the commands that have actually found something.

```bash
adb devices                                   # is the phone attached and authorised
adb logcat -c                                 # clear, then reproduce
adb logcat -d | grep -iE "ReactNativeJS|dev.expo.updates|okhttp|Exception"
```

**Ask the phone, not the laptop.** The device ships `curl`, and it answers a
question no amount of reading the code can:

```bash
adb shell curl -s -o /dev/null -w "%{http_code} tls=%{ssl_verify_result}\n" \
  https://dynamic-alarm-api.milovanderpas.nl/api/v1/health
```

That runs as the shell user rather than as the app, which is what makes it
useful: if the phone can reach the API and the app cannot, the difference is
something applied to the app.

**The most likely such thing is Android restricting it.**

```bash
adb shell dumpsys netpolicy | grep -E "UID=<uid> (policy|state)"
adb shell dumpsys package com.milovanderpas.dynamicalarm | grep -m1 userId=
```

`policy=262144 (REJECT_ALL)` or `effective=RESTRICTED_MODE` means the app has no
network at all, foreground included. See the section in
[docs/CONVENTIONS.md](../../docs/CONVENTIONS.md) on what that looks like from
inside the app, which is nothing like what it is.

Other things worth reading off the device:

```bash
adb shell settings get global http_proxy          # a proxy the app obeys and curl ignores
adb shell settings get global private_dns_mode
adb shell getprop ro.build.version.sdk            # trust-store questions need this
adb shell am force-stop com.milovanderpas.dynamicalarm
```

## The debug panel

Settings, ten taps on the version, then the password. It reports permissions,
native modules, boot re-arm history, the API connection **with its error code and
the server's own message**, which bundle is running, and the alarms the OS is
actually holding. "Copy debug info" puts all of it on the clipboard as plain
text, deliberately untranslated, because it is written to be pasted into a bug
report rather than read in the app.

Start there before reaching for `adb`. It answers most questions in one screen,
and the two it cannot answer are the two above.
