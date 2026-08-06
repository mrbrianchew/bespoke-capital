import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireCreator } from '@/lib/requireCreator'

export async function POST(req: Request) {
  const creator = await requireCreator()
  if (!creator) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json().catch(() => ({}))
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: row, error: fetchErr } = await supabase
    .from('bug_reports').select('screenshot_path').eq('id', id).maybeSingle()
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

  const { error: deleteErr } = await supabase.from('bug_reports').delete().eq('id', id)
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 })

  // Best-effort — the row is already gone either way, no need to fail the
  // request over an orphaned file in storage.
  if (row.screenshot_path) {
    await supabase.storage.from('bug-report-screenshots').remove([row.screenshot_path])
  }

  return NextResponse.json({ success: true })
}