import { createHash, randomBytes } from 'node:crypto';

/**
 * Device bearer tokens.
 *
 * A plain random string rather than a JWT. There are no claims worth signing:
 * the token identifies one device and nothing else, it never expires, and the
 * database is consulted on every request anyway. A JWT would add rotation and
 * revocation problems in exchange for nothing.
 */
export function generateDeviceToken(): string {
    return randomBytes(32).toString('base64url');
}

/**
 * Hashed with plain SHA-256, not bcrypt, and that is deliberate.
 *
 * Password hashing is deliberately slow to survive being guessed. This token is
 * 256 bits of machine-generated randomness, so guessing is not the threat and
 * slowness would only make every authenticated request expensive. Hashing at
 * all is what stops a database dump handing over every device's identity.
 */
export function hashDeviceToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
