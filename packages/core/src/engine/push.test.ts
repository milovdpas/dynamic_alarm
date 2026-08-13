import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';

import { PUSH_RETRY_MINUTES, resolvePushedWake, shouldSendWakePush } from './push';

const TZ = 'Europe/Amsterdam';

/** A time on the morning every case below is about. */
function at(time: string): string {
    return DateTime.fromISO(`2026-08-14T${time}:00`, { zone: TZ }).toISO() ?? '';
}

const NOW = at('04:00');
const WAKE = at('06:53');

describe('shouldSendWakePush', () => {
    it('sends a time the device has never acknowledged', () => {
        expect(
            shouldSendWakePush({
                wakeAt: WAKE,
                ackedWakeAt: null,
                pushedWakeAt: null,
                lastPushedAt: null,
                now: NOW,
                timezone: TZ,
            }),
        ).toEqual({ send: true, kind: 'NEW' });
    });

    it('says nothing when the device already holds this time', () => {
        expect(
            shouldSendWakePush({
                wakeAt: WAKE,
                ackedWakeAt: WAKE,
                pushedWakeAt: WAKE,
                lastPushedAt: NOW,
                now: NOW,
                timezone: TZ,
            }),
        ).toEqual({ send: false, reason: 'NO_CHANGE' });
    });

    it('ignores a difference too small for anyone to notice', () => {
        // Without this floor, a minute of timetable jitter wakes every device's
        // radio for a change no human perceives.
        expect(
            shouldSendWakePush({
                wakeAt: at('06:54'),
                ackedWakeAt: WAKE,
                pushedWakeAt: null,
                lastPushedAt: null,
                now: NOW,
                timezone: TZ,
            }),
        ).toEqual({ send: false, reason: 'NO_CHANGE' });
    });

    it('holds off while a push for the same time is in flight', () => {
        expect(
            shouldSendWakePush({
                wakeAt: WAKE,
                ackedWakeAt: at('06:40'),
                pushedWakeAt: WAKE,
                lastPushedAt: at('03:58'),
                now: NOW,
                timezone: TZ,
            }),
        ).toEqual({ send: false, reason: 'IN_FLIGHT' });
    });

    it('retries once the window has passed with no acknowledgement', () => {
        // The entire reason a dropped push is survivable without a queue.
        const sentAt = DateTime.fromISO(NOW, { setZone: true })
            .minus({ minutes: PUSH_RETRY_MINUTES })
            .toISO();

        expect(
            shouldSendWakePush({
                wakeAt: WAKE,
                ackedWakeAt: at('06:40'),
                pushedWakeAt: WAKE,
                lastPushedAt: sentAt ?? '',
                now: NOW,
                timezone: TZ,
            }),
        ).toEqual({ send: true, kind: 'RETRY' });
    });

    it('retries when something was sent but no time was recorded', () => {
        // Otherwise a half-written row stalls its own retry forever.
        expect(
            shouldSendWakePush({
                wakeAt: WAKE,
                ackedWakeAt: at('06:40'),
                pushedWakeAt: WAKE,
                lastPushedAt: null,
                now: NOW,
                timezone: TZ,
            }),
        ).toEqual({ send: true, kind: 'RETRY' });
    });

    it('refuses to push an alarm that has already rung', () => {
        expect(
            shouldSendWakePush({
                wakeAt: at('06:53'),
                ackedWakeAt: at('06:40'),
                pushedWakeAt: null,
                lastPushedAt: null,
                now: at('07:10'),
                timezone: TZ,
            }),
        ).toEqual({ send: false, reason: 'PAST' });
    });
});

describe('resolvePushedWake', () => {
    it('applies a later time, which is the whole product', () => {
        expect(
            resolvePushedWake({
                heldWakeAt: WAKE,
                pushedWakeAt: at('07:05'),
                emergency: false,
                timezone: TZ,
            }),
        ).toEqual({ apply: true, kind: 'LATER' });
    });

    it('refuses an earlier time that is not an emergency', () => {
        // The device holds a pessimistic time that gets its owner there. Pulling
        // it earlier on a best-effort message trades a guaranteed wake-up for a
        // hopeful one.
        expect(
            resolvePushedWake({
                heldWakeAt: WAKE,
                pushedWakeAt: at('06:35'),
                emergency: false,
                timezone: TZ,
            }),
        ).toEqual({ apply: false, reason: 'NOT_LATER' });
    });

    it('applies an earlier time when the server calls it an emergency', () => {
        // A cancellation that leaves no way to arrive on time. Not moving is a
        // certain failure, moving early is a risk worth taking.
        expect(
            resolvePushedWake({
                heldWakeAt: WAKE,
                pushedWakeAt: at('06:35'),
                emergency: true,
                timezone: TZ,
            }),
        ).toEqual({ apply: true, kind: 'EMERGENCY' });
    });

    it('leaves the alarm alone when the device does not know what it holds', () => {
        // Not the same as nothing being armed. With nothing to compare against,
        // applying would be a guess against a real alarm.
        expect(
            resolvePushedWake({
                heldWakeAt: null,
                pushedWakeAt: at('07:05'),
                emergency: true,
                timezone: TZ,
            }),
        ).toEqual({ apply: false, reason: 'UNKNOWN_HELD' });
    });

    it('ignores a change below the floor the server pushes at', () => {
        expect(
            resolvePushedWake({
                heldWakeAt: WAKE,
                pushedWakeAt: at('06:54'),
                emergency: false,
                timezone: TZ,
            }),
        ).toEqual({ apply: false, reason: 'TOO_SMALL' });
    });

    it('never applies a stale message that would pull the alarm earlier', () => {
        // A retried push can arrive after the device has already moved on. The
        // device judges what it received rather than trusting that the server
        // knew its current state.
        expect(
            resolvePushedWake({
                heldWakeAt: at('07:20'),
                pushedWakeAt: at('07:05'),
                emergency: false,
                timezone: TZ,
            }),
        ).toEqual({ apply: false, reason: 'NOT_LATER' });
    });
});
