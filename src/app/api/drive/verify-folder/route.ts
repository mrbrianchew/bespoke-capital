import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getDrive, extractFolderId, friendlyDriveError } from '@/lib/googleDrive'

// Any authenticated advisor may call this — it only reads Drive metadata for
// a folder they're about to link, never any client/claim data.
export async function POST(req: Request) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { folderLink } = await req.json()
  const folderId = extractFolderId(folderLink)
  if (!folderId) {
    return NextResponse.json({ ok: false, error: 'Could not read a folder ID from that link. Paste the full Drive folder URL.' })
  }

  try {
    const drive = getDrive()
    const res = await drive.files.get({ fileId: folderId, fields: 'id, name, mimeType' })
    if (res.data.mimeType !== 'application/vnd.google-apps.folder') {
      return NextResponse.json({ ok: false, error: 'That link points to a file, not a folder.' })
    }
    return NextResponse.json({ ok: true, folderId, name: res.data.name })
  } catch (err: any) {
    const { message } = friendlyDriveError(err)
    return NextResponse.json({ ok: false, error: message })
  }
}