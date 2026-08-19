import { isIP } from 'node:net';
import type { Request } from 'express';
import type { ForwardedHop, HopCandidate, IpDebugResponse } from '@alarm/types';

import { env } from '../../config/app';
import { addressOf } from '../middleware/RateLimit';

/**
 * What this deployment can actually tell about who is calling.
 *
 * Written because `req.ip` is only trustworthy when `trust proxy` names the
 * exact number of proxies in front, and nothing in the codebase knew that
 * number. It was a guess with a plausible justification, which is the worst kind:
 * one nginx is the documented topology, but the deployment is behind a shared
 * host, and a caller who can add a hop the configuration does not expect can
 * choose their own rate-limit key by sending a header.
 *
 * A forwarded chain grows on the **left**. Whatever the client sends arrives
 * first, and each proxy appends the peer it genuinely saw, so the rightmost
 * entries are the ones written by infrastructure. Trusting `n` hops means
 * believing the last `n` entries and treating everything before them as the
 * caller's own writing. Configure `n` too high and the caller's writing is
 * believed.
 *
 * So the number is measured rather than argued about: call the endpoint from a
 * phone on mobile data, find the entry that matches its real address, and
 * `candidates` names the setting that resolves to it.
 */

/**
 * Headers that carry a credential, and never appear in the response.
 *
 * The rest of a request holds no secret from the caller who sent it, which is
 * what makes echoing it acceptable. These are the exception: a device token or
 * the monitor secret reflected into a body is a token in a log, a screenshot and
 * a scrollback.
 */
const REDACTED = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-monitor-token']);

/**
 * Every header a proxy or CDN might use to name the original client.
 *
 * Collected so that one deployment answers the question even if the answer is
 * not `X-Forwarded-For`. Several hosts put the client in a single-value header,
 * which is both simpler and harder to spoof than counting a chain, and finding
 * one of these populated would end the exercise.
 */
const CLIENT_HEADERS = [
    'x-forwarded-for',
    'x-real-ip',
    'x-client-ip',
    'cf-connecting-ip',
    'true-client-ip',
    'fastly-client-ip',
    'x-cluster-client-ip',
    'x-original-forwarded-for',
    'forwarded',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-port',
];

export function describeAddress(req: Request): IpDebugResponse {
    const socketAddress = req.socket.remoteAddress ?? null;
    const raw = header(req, 'x-forwarded-for');
    const hops = parseForwarded(raw);

    /**
     * The chain Express walks, in the order it walks it.
     *
     * Socket first, then the forwarded entries right to left, which is what
     * `proxy-addr` builds internally. `trust proxy: n` returns element `n`, so
     * this array is the lookup table the candidates below are read from.
     */
    const chain = [
        ...(socketAddress === null ? [] : [socketAddress]),
        ...hops.map((hop) => hop.value).reverse(),
    ];

    const configuredHops = env.trustProxyHops;
    const candidates: HopCandidate[] = chain.map((value, hops_) => ({
        hops: hops_,
        resolvedIp: value,
        current: hops_ === configuredHops,
        private: isPrivate(value),
        valid: isIP(normalise(value)) !== 0,
    }));

    return {
        resolvedIp: req.ip ?? '',
        rateLimitKey: addressOf(req),
        socket: {
            address: socketAddress,
            normalised: socketAddress === null ? null : normalise(socketAddress),
            port: req.socket.remotePort ?? null,
            family: req.socket.remoteFamily ?? null,
            private: socketAddress !== null && isPrivate(socketAddress),
            loopback: socketAddress !== null && isLoopback(socketAddress),
            ipv4Mapped: socketAddress !== null && socketAddress.startsWith('::ffff:'),
        },
        trustProxy: {
            setting: String(req.app.get('trust proxy') as unknown),
            configuredHops,
            envValue: process.env.TRUST_PROXY_HOPS ?? null,
            nodeEnv: env.nodeEnv,
        },
        forwarded: {
            raw,
            hops,
            count: hops.length,
            expressIps: req.ips,
        },
        chain,
        candidates,
        clientHeaders: Object.fromEntries(
            CLIENT_HEADERS.map((name) => [name, header(req, name)]),
        ),
        headers: safeHeaders(req),
        request: {
            method: req.method,
            protocol: req.protocol,
            secure: req.secure,
            hostname: req.hostname,
            originalUrl: req.originalUrl,
            httpVersion: req.httpVersion,
        },
        findings: findings(socketAddress, hops, candidates, configuredHops, req.ip ?? ''),
        timestamp: new Date().toISOString(),
    };
}

/**
 * The forwarded chain, split and described but never believed.
 *
 * Entries that do not parse as an address are kept rather than dropped. A
 * client is free to send `X-Forwarded-For: banana`, and seeing that in the
 * response is the point: it demonstrates directly that the left of the chain is
 * whatever the caller typed.
 */
function parseForwarded(raw: string | null): ForwardedHop[] {
    if (raw === null || raw.trim() === '') {
        return [];
    }

    const parts = raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '');

    return parts.map((value, index) => ({
        index,
        fromRight: parts.length - 1 - index,
        value,
        normalised: normalise(value),
        private: isPrivate(value),
        valid: isIP(normalise(value)) !== 0,
    }));
}

/**
 * What the numbers mean, in sentences, so the answer does not depend on whoever
 * reads the JSON remembering how `proxy-addr` walks a chain.
 */
function findings(
    socketAddress: string | null,
    hops: ForwardedHop[],
    candidates: HopCandidate[],
    configuredHops: number,
    resolved: string,
): string[] {
    const notes: string[] = [];

    if (socketAddress === null) {
        notes.push('There is no socket address at all, which should be impossible over TCP.');
    } else if (isLoopback(socketAddress)) {
        notes.push(
            'The socket address is loopback, so the connection came from this machine: a ' +
                'local test, or a proxy sharing the host. On the VPS nginx is a separate ' +
                'container, so a real proxied request should show its network address here ' +
                'instead. Loopback in production means the call did not come through nginx.',
        );
    } else if (isPrivate(socketAddress)) {
        notes.push(
            'The socket address is private but not loopback, which is what a proxy on the ' +
                'same Docker network looks like. The caller is in the forwarded chain, not ' +
                'on the socket.',
        );
    } else {
        notes.push(
            'The socket address is public, so this request reached the process directly, ' +
                'with nothing in front of it. If that is the real topology, trust no proxies ' +
                'at all: TRUST_PROXY_HOPS=0, and the socket address is the caller.',
        );
    }

    if (hops.length === 0) {
        notes.push(
            'No X-Forwarded-For header arrived. Either nothing is in front, or whatever is ' +
                'in front is not adding one, in which case check the other client headers ' +
                'before trusting any hops.',
        );
    } else {
        notes.push(
            `The forwarded chain has ${String(hops.length)} entr${hops.length === 1 ? 'y' : 'ies'}. ` +
                'It grows on the left, so only the rightmost entries were written by ' +
                'infrastructure. Trusting n hops believes the last n.',
        );
    }

    const current = candidates.find((candidate) => candidate.current);
    if (current === undefined) {
        notes.push(
            `TRUST_PROXY_HOPS is ${String(configuredHops)}, which is more hops than this ` +
                'request has. Express falls back to the furthest trusted entry, so the ' +
                'setting is doing nothing useful and may be doing harm.',
        );
    } else if (current.private && hops.length === 0) {
        notes.push(
            `At the configured ${String(configuredHops)} hops the resolved address is ` +
                `${current.resolvedIp}. There is no chain to look further along, so raising ` +
                'the number would change nothing. Either this call did not come through a ' +
                'proxy, or the proxy is not forwarding an address at all.',
        );
    } else if (current.private) {
        notes.push(
            `At the configured ${String(configuredHops)} hops the resolved address is ` +
                `${current.resolvedIp}, which is private, so it names infrastructure rather ` +
                'than a caller. Every request through it shares one rate-limit bucket. The ' +
                'chain has entries further along: raise the number until the resolved ' +
                "address matches the calling device's own.",
        );
    } else {
        notes.push(
            `At the configured ${String(configuredHops)} hops the resolved address is ` +
                `${current.resolvedIp}. Compare it against what the calling phone believes ` +
                'its own public address to be. If they match, this setting is correct.',
        );
    }

    /**
     * An entry that is not an address was written by whoever called.
     *
     * Infrastructure appends addresses. So a chain containing one of these is a
     * spoof test in progress, and whether the resolved address is that entry
     * answers the question this endpoint exists for, outright and in one call.
     */
    const invented = candidates.find((candidate) => !candidate.valid);
    if (invented !== undefined) {
        notes.push(
            resolved === invented.resolvedIp
                ? `The chain contains "${invented.resolvedIp}", which is not an address, so a ` +
                      'caller wrote it, and it is what resolved. This setting believes ' +
                      'caller-supplied values and every rate limit can be sidestepped with a ' +
                      'header. Lower it, or fix the proxy so it appends rather than forwards.'
                : `The chain contains "${invented.resolvedIp}", which is not an address, so a ` +
                      'caller wrote it. It was not what resolved, which means the proxy ' +
                      'appends the peer it actually saw and this setting reads that rather ' +
                      'than anything the caller supplied. That is the answer: this hop count ' +
                      'is correct and not spoofable.',
        );
        return notes;
    }

    // Only counts entries that are addresses. A string that is not one is not a
    // public address, and treating it as a second candidate said the question
    // could not be settled in exactly the response that settled it.
    const plausible = candidates.filter((candidate) => candidate.valid && !candidate.private);
    if (plausible.length > 1) {
        notes.push(
            'More than one entry in the chain is a public address, so the count cannot be ' +
                'settled from this response alone. The correct one is whichever matches the ' +
                "calling device's own address. Do not simply take the first public entry: a " +
                'caller can put a public address at the front of the chain themselves.',
        );
    }

    notes.push(
        'To finish the check, call this once more with an invented X-Forwarded-For value. ' +
            'resolvedIp must not change. If it does, the setting trusts more hops than ' +
            'exist and must be lowered before this endpoint is switched off.',
    );

    return notes;
}

/** First value only. A repeated header arrives as an array and is joined back. */
function header(req: Request, name: string): string | null {
    const value = req.headers[name];
    if (value === undefined) {
        return null;
    }
    return Array.isArray(value) ? value.join(', ') : value;
}

function safeHeaders(req: Request): Record<string, string> {
    const safe: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) {
            continue;
        }
        safe[name] = REDACTED.has(name.toLowerCase())
            ? '[redacted]'
            : Array.isArray(value)
              ? value.join(', ')
              : value;
    }
    return safe;
}

/**
 * `::ffff:1.2.3.4` reduced to `1.2.3.4`, and a port stripped if one came along.
 *
 * Node hands back the mapped form on a dual-stack socket, so a raw comparison
 * against what a phone reports as its own address fails on a difference that is
 * only notation.
 */
function normalise(address: string): string {
    const withoutBrackets = address.replace(/^\[|\]$/g, '');
    const mapped = withoutBrackets.replace(/^::ffff:/i, '');
    // An IPv4 address with a port, which some proxies write. IPv6 is left alone,
    // since its colons are part of the address.
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(mapped);
    return match?.[1] ?? mapped;
}

/** The connection came from this machine, which is not the same as via a proxy. */
function isLoopback(address: string): boolean {
    const value = normalise(address);
    return value === '::1' || value.startsWith('127.');
}

/**
 * Whether an address could not belong to a phone on the internet.
 *
 * Loopback, the RFC 1918 ranges, carrier-grade NAT, link local, and unique local
 * IPv6. A private address at the end of the chain means a proxy wrote it, which
 * is the signal that more hops need trusting.
 */
function isPrivate(address: string): boolean {
    const value = normalise(address);
    if (isIP(value) === 0) {
        return false;
    }

    if (value === '::1' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) {
        return true;
    }

    const octets = value.split('.').map(Number);
    const [a, b] = octets;
    if (octets.length !== 4 || a === undefined || b === undefined) {
        return false;
    }

    return (
        a === 10 ||
        a === 127 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254) ||
        // Carrier-grade NAT. A mobile network can legitimately put a phone
        // behind one of these, so it is worth naming rather than guessing at.
        (a === 100 && b >= 64 && b <= 127)
    );
}
