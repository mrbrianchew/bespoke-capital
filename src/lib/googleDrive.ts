import { google, drive_v3 } from 'googleapis'

/**
 * Server-side only. Uses a Google service account, scoped to `drive.file` —
 * the narrowest Drive scope Google offers. This means the app can only see
 * or touch files it creates itself, or folders an advisor has *explicitly*
 * shared with the service account's email via Drive's normal Share dialog.
 * It has no ability to browse, list, or access anything else in anyone's
 * Drive. There is deliberately no folder-creation or file-move logic here —
 * uploads land directly in whatever folder the advisor shared.
 *
 * Requires GOOGLE_SERVICE_ACCOUNT_KEY in the environment: the full JSON
 * contents of the service account key file, as a single string.
 */

let cached: drive_v3.Drive | null = null

export function getDrive(): drive_v3.Drive {
  if (cached) return cached
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not configured')
  let credentials: any
  try {
    credentials = JSON.parse(keyJson)
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON')
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })
  cached = google.drive({ version: 'v3', auth: auth as any })
  return cached
}

// Short-lived bearer token for the resumable-upload flow, where the *browser*
// talks to Google directly (see /api/drive/start-upload). Never returned to
// the client — only used server-side to initiate the upload session.
export async function getAccessToken(): Promise<string> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not configured')
  const credentials = JSON.parse(keyJson)
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  if (!tokenResponse.token) throw new Error('Could not obtain a Drive access token')
  return tokenResponse.token
}

// Accepts a full Drive folder URL (either
// https://drive.google.com/drive/folders/<id> or a legacy ?id=<id> link) or
// a bare folder ID, and returns just the ID. Returns null if nothing usable
// could be parsed.
export function extractFolderId(link: string): string | null {
  const trimmed = (link || '').trim()
  if (!trimmed) return null
  const folderMatch = /\/folders\/([a-zA-Z0-9_-]{10,})/.exec(trimmed)
  if (folderMatch) return folderMatch[1]
  const idParamMatch = /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(trimmed)
  if (idParamMatch) return idParamMatch[1]
  // Bare ID pasted directly, no URL wrapper.
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed
  return null
}

// Maps a googleapis error to a message an advisor (not a developer) can act on.
export function friendlyDriveError(err: any): { status: number; message: string } {
  const code = err?.code || err?.response?.status
  if (code === 404) {
    return { status: 400, message: 'Drive folder not found. Check the link, or the folder may have been moved or deleted.' }
  }
  if (code === 403) {
    return { status: 403, message: 'Access denied. Has this folder been shared with the service account email yet?' }
  }
  return { status: 500, message: 'Drive request failed: ' + (err?.message || 'unknown error') }
}