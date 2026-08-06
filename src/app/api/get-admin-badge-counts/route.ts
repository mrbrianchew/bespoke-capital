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

  const [{ count: pendingAdvisors }, { count: newBugReports }] = await Promise.all([
    supabase.from('advisors').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('bug_reports').select('id', { count: 'exact', head: true }).eq('status', 'new'),
  ])

  return NextResponse.json({
    pendingAdvisors: pendingAdvisors || 0,
    newBugReports: newBugReports || 0,
  })
}