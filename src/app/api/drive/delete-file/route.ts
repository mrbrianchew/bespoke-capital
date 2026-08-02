import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getDrive } from '@/lib/googleDrive'

// Deletes the underlying Drive file for a claim_documents row. The caller
// is responsible for deleting the claim_documents row itself afterward
// (done client-side via the normal RLS-scoped Supabase call, same pattern
// as every other delete on this page) — this route only ever touches Drive.
export async function POST(req: Request) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } },
  )
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { documentId } = await req.json()
  if (!documentId) return NextResponse.json({ error: 'Missing documentId' }, { status: 400 })

  // RLS-scoped: this select only succeeds if the row belongs to this advisor.
  const { data: doc, error } = await supabase
    .from('claim_documents').select('id, drive_file_id').eq('id', documentId).maybeSingle()
  if (error || !doc) return NextResponse.json({ error: 'Document not found or not accessible' }, { status: 404 })

  if (doc.drive_file_id) {
    try {
      await getDrive().files.delete({ fileId: doc.drive_file_id })
    } catch (err: any) {
      // If it's already gone from Drive (manually deleted, etc.), don't block
      // removing the app-side record over it.
      if (err?.code !== 404) {
        return NextResponse.json({ error: 'Could not delete from Drive: ' + (err?.message || 'unknown error') }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ success: true })
}