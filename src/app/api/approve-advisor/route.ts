import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireCreator } from '@/lib/requireCreator'

export async function POST(req: Request) {
  // Only the creator may approve advisors. This route uses the service-role
  // key (bypasses RLS), so the check must happen server-side.
  const creator = await requireCreator()
  if (!creator) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  await supabase.from('advisors').update({ status: 'approved' }).eq('id', id)
  await supabase.auth.admin.updateUserById(id, { email_confirm: true })
  return NextResponse.json({ success: true })
}
