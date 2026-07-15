import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireCreator } from '@/lib/requireCreator'

export async function GET() {
  // Returns PII (names, emails, firms) of every registered advisor — creator only.
  const creator = await requireCreator()
  if (!creator) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data } = await supabase
    .from('advisors').select('*').order('created_at', { ascending: false })
  return NextResponse.json(data || [])
}
