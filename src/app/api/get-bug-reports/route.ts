import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireCreator } from '@/lib/requireCreator'

export async function GET() {
  const creator = await requireCreator()
  if (!creator) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('bug_reports')
    .select('id, type, description, screenshot_path, page_context, status, created_at, advisor:advisors(name, email)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Screenshots live in a private bucket — sign each path for 10 minutes so
  // the Admin Hub list can render thumbnails without exposing a public URL.
  const withUrls = await Promise.all(
    (data || []).map(async (row: any) => {
      const { data: signed } = await supabase.storage
        .from('bug-report-screenshots')
        .createSignedUrl(row.screenshot_path, 600)
      return { ...row, screenshot_url: signed?.signedUrl || null }
    })
  )

  return NextResponse.json(withUrls)
}