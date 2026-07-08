import bcrypt from 'bcryptjs'

/**
 * Share-link password hashing.
 *
 * Share links (client_shares, financial_plans) previously stored an
 * unsalted SHA-256 digest of the password, computed client-side, and the
 * server verified by comparing that digest byte-for-byte. That meant:
 *   1. The digest itself worked as a bearer credential — anyone who saw a
 *      leaked `password_hash` could replay it directly without ever
 *      knowing or cracking the password.
 *   2. Even offline, unsalted SHA-256 is fast enough that short passwords
 *      (these links use an 8-character NRIC+birth-year convention) are
 *      practical to brute-force.
 *
 * This module moves hashing to bcrypt (salted, deliberately slow, and
 * verified server-side against a plaintext password sent over HTTPS —
 * the same pattern as an ordinary login form). It also verifies the old
 * SHA-256 format so links created before this change keep working; see
 * `verifySharePassword`.
 */

const BCRYPT_ROUNDS = 10

/** Hash a plaintext share-link password for storage. */
export async function hashSharePassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

function isBcryptHash(stored: string): boolean {
  return /^\$2[aby]?\$/.test(stored)
}

function isLegacySha256Hash(stored: string): boolean {
  return /^[0-9a-f]{64}$/i.test(stored)
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time comparison of two equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Verifies a plaintext password against a stored hash of either format.
 * `legacy: true` tells the caller the stored hash was the old SHA-256
 * format, so it can be opportunistically upgraded to bcrypt now that the
 * plaintext is available.
 */
export async function verifySharePassword(
  password: string,
  stored: string | null | undefined,
): Promise<{ ok: boolean; legacy: boolean }> {
  if (!stored) return { ok: false, legacy: false }

  if (isBcryptHash(stored)) {
    return { ok: await bcrypt.compare(password, stored), legacy: false }
  }

  if (isLegacySha256Hash(stored)) {
    const hex = await sha256Hex(password)
    return { ok: timingSafeEqualHex(hex, stored), legacy: true }
  }

  return { ok: false, legacy: false }
}
