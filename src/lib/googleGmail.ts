/**
 * Server-only helpers for the Gmail claim-search feature. Every function here
 * runs in an API route, never in client code — the client never sees an
 * access token, a refresh token, or a client secret.
 *
 * Deliberate scope discipline: searchGmailMessages fetches message metadata
 * only (Subject / From / Date headers via format=metadata) — it never
 * requests format=full or format=raw, so message bodies are never pulled
 * from Gmail, never held in memory, and never logged.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

function credentials() {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth client is not configured (NEXT_PUBLIC_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)')
  }
  return { clientId, clientSecret }
}

export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = credentials()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const { clientId, clientSecret } = credentials()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// Best-effort. Called on disconnect so Google's side reflects the revocation
// immediately; the local DB row is deleted regardless of whether this call
// succeeds, so a disconnect never gets "stuck" on a flaky network call.
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
  } catch (e) {
    console.error('[googleGmail] revoke call failed (non-fatal)', e)
  }
}

export async function getGmailProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const res = await fetch(`${GMAIL_API}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Gmail profile fetch failed: ${res.status}`)
  return res.json()
}

export interface EmailMatch {
  id: string
  threadId: string
  subject: string
  from: string
  date: string
  permalink: string
}

export async function searchGmailMessages(accessToken: string, query: string, maxResults = 15): Promise<EmailMatch[]> {
  const listUrl = `${GMAIL_API}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!listRes.ok) throw new Error(`Gmail search failed: ${listRes.status} ${await listRes.text()}`)
  const listData: { messages?: { id: string; threadId: string }[] } = await listRes.json()
  const messages = listData.messages || []

  const results = await Promise.all(messages.map(async (m): Promise<EmailMatch | null> => {
    const metaUrl = `${GMAIL_API}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`
    const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!metaRes.ok) return null
    const meta = await metaRes.json()
    const headers: { name: string; value: string }[] = meta.payload?.headers || []
    const get = (name: string) => headers.find(h => h.name === name)?.value || ''
    return {
      id: m.id,
      threadId: m.threadId,
      subject: get('Subject') || '(no subject)',
      from: get('From'),
      date: get('Date'),
      permalink: `https://mail.google.com/mail/u/0/#all/${m.threadId}`,
    }
  }))
  return results.filter((r): r is EmailMatch => r !== null)
}