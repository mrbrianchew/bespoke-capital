import crypto from 'crypto'

/**
 * Encrypts/decrypts the Gmail OAuth refresh token before it touches the
 * database. This is the ONLY place a Gmail refresh token is ever encrypted
 * or decrypted in the app — every other file treats the stored value as an
 * opaque blob.
 *
 * Algorithm: AES-256-GCM (authenticated encryption — tampering with the
 * ciphertext, IV, or tag causes decryption to throw, not silently succeed).
 * Key: GMAIL_TOKEN_ENCRYPTION_KEY, a 32-byte key stored as base64 in Vercel
 * env vars (server-only, never NEXT_PUBLIC_*). Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Stored format: "v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>"
 * The "v1" prefix exists so a future key-rotation or algorithm change can be
 * detected and handled without guessing at old rows' format.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH_BYTES = 12 // 96-bit IV is the recommended size for GCM

function getKey(): Buffer {
  const b64 = process.env.GMAIL_TOKEN_ENCRYPTION_KEY
  if (!b64) {
    throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY is not configured')
  }
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes')
  }
  return key
}

export function encryptToken(plaintext: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`
}

export function decryptToken(stored: string): string {
  const parts = stored.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unrecognized encrypted-token format')
  }
  const [, ivB64, tagB64, dataB64] = parts
  const key = getKey()
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(dataB64, 'base64')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}