import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getAccessToken, extractFolderId } from '@/lib/googleDrive'

/**
 * Returns a Google-issued resumable upload URL. This route's own request/
 * response bodies are tiny (just metadata) — the file itself never passes
 * through this function. The browser PUTs the actual bytes straight to the
 * URL this returns, which works around Vercel's 4.5MB function body limit
 * entirely (Drive resumable uploads support files up to 5TB).
 *
 * The returned URL is a single-use Google session tied to exactly one file
 * creation in one specific folder — it does not expose the service account
 * credential, and it cannot be reused to write anywhere else.
 */
export async function POST(req: Request) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId, claimId, fileName, mimeType } = await req.json()
  if (!clientId || !claimId || !fileName || !mimeType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // RLS-scoped reads — ownership of clientId/claimId is enforced by the
  // database itself, not by application logic here.
  const { data: client, error: clientError } = await supabase
    .from('clients').select('id, drive_folder_link').eq('id', clientId).maybeSingle()
  if (clientError || !client) return NextResponse.json({ error: 'Client not found or not accessible' }, { status: 404 })
  if (!client.drive_folder_link) return NextResponse.json({ error: 'No Drive folder linked for this client yet' }, { status: 400 })

  const folderId = extractFolderId(client.drive_folder_link)
  if (!folderId) return NextResponse.json({ error: 'Could not parse a folder ID from the saved Drive link' }, { status: 400 })

  const { data: claim, error: claimError } = await supabase
    .from('claims').select('id').eq('id', claimId).eq('client_id', clientId).maybeSingle()
  if (claimError || !claim) return NextResponse.json({ error: 'Claim not found for this client' }, { status: 404 })

  let accessToken: string
  try {
    accessToken = await getAccessToken()
  } catch (err: any) {
    return NextResponse.json({ error: 'Drive is not configured: ' + err.message }, { status: 500 })
  }

  const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
    },
    body: JSON.stringify({ name: fileName, parents: [folderId] }),
  })

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => '')
    if (initRes.status === 404) {
      return NextResponse.json({ error: 'Drive folder not found. Check the link, or the folder may have been moved.' }, { status: 400 })
    }
    if (initRes.status === 403) {
      return NextResponse.json({ error: 'Access denied. Has this folder been shared with the service account email yet?' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Could not start Drive upload: ' + errText }, { status: 502 })
  }

  const uploadUrl = initRes.headers.get('Location')
  if (!uploadUrl) return NextResponse.json({ error: 'Drive did not return an upload session URL' }, { status: 502 })

  return NextResponse.json({ uploadUrl })
}