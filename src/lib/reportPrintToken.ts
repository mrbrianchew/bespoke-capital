import crypto from 'crypto'

/**
 * Signed, short-lived tokens for the server-to-server hop between the PDF
 * export API route and the print-only report route (/report-print/[token]).
 *
 * Puppeteer navigates to that route as a fresh, cookie-less browser context —
 * it can't carry the advisor's Supabase Auth session. Rather than exposing an
 * unauthenticated route that can render any client's financial data, the
 * export API (which DOES run under the advisor's normal session, see
 * export-pdf/route.ts) mints one of these tokens scoped to a single
 * client_id + financial_plan_id, valid for 5 minutes, and hands it to
 * Puppeteer as the URL Puppeteer alone will ever request.
 *
 * HMAC-SHA256 over a plain payload + server secret — no external JWT
 * dependency, consistent with this codebase's existing lightweight approach
 * (see sharePassword.ts). Not a bearer credential an advisor ever sees or
 * copies; it's generated and consumed entirely server-side within one
 * request's lifetime.
 *
 * Scoped to clientId only, not a specific financial_plans row — "Export PDF"
 * prints the advisor's current live view, built fresh from fact_finding the
 * same way report/page.tsx's load() does. financial_plans.snapshot_data is a
 * separate, deliberately-frozen concept (past saved/shared plans) that this
 * export flow doesn't touch.
 */

const SECRET = process.env.REPORT_PRINT_TOKEN_SECRET
if (!SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('REPORT_PRINT_TOKEN_SECRET must be set in production')
}
// Falls back to a dev-only constant so `next dev` doesn't require the env var
// to be set locally — never reachable in production due to the throw above.
const SIGNING_SECRET = SECRET || 'dev-only-insecure-secret-do-not-use-in-prod'

const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes — long enough for Puppeteer's navigation + render + PDF export, short enough that a leaked token (e.g. in a server log) is worthless soon after.

export interface ReportPrintTokenPayload {
  clientId: string
  // Advisor who requested the export — carried through so the print route
  // can attribute "Prepared by" without a second auth lookup, and so an
  // audit trail exists even though this route itself doesn't re-check
  // advisor identity (the export API already did, before minting this).
  advisorId: string
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + ((4 - (input.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64')
}

/** Mint a signed token. Called only from export-pdf/route.ts, after that route has already verified the requesting advisor's session and access to clientId. */
export function signReportPrintToken(payload: ReportPrintTokenPayload): string {
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS }
  const bodyB64 = base64url(Buffer.from(JSON.stringify(body)))
  const sig = crypto.createHmac('sha256', SIGNING_SECRET).update(bodyB64).digest()
  const sigB64 = base64url(sig)
  return `${bodyB64}.${sigB64}`
}

/** Verify + decode a token. Returns null on any failure (bad signature, expired, malformed) — the print route treats all of these identically as "not found", never leaking which case it was. */
export function verifyReportPrintToken(token: string): ReportPrintTokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [bodyB64, sigB64] = parts

  const expectedSig = base64url(crypto.createHmac('sha256', SIGNING_SECRET).update(bodyB64).digest())
  // Constant-time comparison — this is a security boundary (anyone with a
  // valid signature can render another client's data), so a timing side
  // channel here is worth closing even though the token is short-lived.
  const a = Buffer.from(sigB64)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  let body: ReportPrintTokenPayload & { exp: number }
  try {
    body = JSON.parse(fromBase64url(bodyB64).toString('utf8'))
  } catch {
    return null
  }
  if (typeof body.exp !== 'number' || Date.now() > body.exp) return null
  if (!body.clientId || !body.advisorId) return null

  return { clientId: body.clientId, advisorId: body.advisorId }
}