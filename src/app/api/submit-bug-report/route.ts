import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/requireUser'

const MAX_BYTES = 8 * 1024 * 1024 // 8MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// Any logged-in advisor may submit — this is not creator-gated. The
// resulting row is only ever read back through get-bug-reports, which IS
// creator-gated, so submitters never see each other's reports.
export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const type = String(form.get('type') || '')
  const description = String(form.get('description') || '').trim()
  const pageContext = form.get('page') ? String(form.get('page')).slice(0, 500) : null
  const file = form.get('screenshot')

  if (type !== 'bug' && type !== 'suggestion') {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }
  if (!description) {
    return NextResponse.json({ error: 'Description is required' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Screenshot is required' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Screenshot must be a PNG, JPEG, WEBP or GIF image' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Screenshot must be under 8MB' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadErr } = await supabase.storage
    .from('bug-report-screenshots')
    .upload(path, buffer, { contentType: file.type })
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const { error: insertErr } = await supabase.from('bug_reports').insert({
    advisor_id: user.id,
    type,
    description,
    screenshot_path: path,
    page_context: pageContext,
    status: 'new',
  })
  if (insertErr) {
    // Best-effort cleanup so we don't leave an orphaned file if the insert fails.
    await supabase.storage.from('bug-report-screenshots').remove([path])
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}