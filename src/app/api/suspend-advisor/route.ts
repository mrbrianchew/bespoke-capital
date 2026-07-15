import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireCreator } from '@/lib/requireCreator'

const CREATOR_ID = process.env.CREATOR_ID || process.env.NEXT_PUBLIC_CREATOR_ID

export async function POST(req: Request) {
  // Only the creator may suspend advisors. Suspension sets status to
  // 'suspended', which blocks both new logins and any active session
  // (see checkAuth in dashboard/layout.tsx) without deleting the account
  // or its data — it can be reversed via reactivation.
  const creator = await requireCreator()
  if (!creator) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  if (id === CREATOR_ID) {
    return NextResponse.json({ error: 'Cannot suspend the creator account' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  await supabase.from('advisors').update({ status: 'suspended' }).eq('id', id)
  return NextResponse.json({ success: true })
}
