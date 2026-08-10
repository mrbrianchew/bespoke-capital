import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/requireUser'

// Same discipline as Gmail's status route — never returns the encrypted
// refresh token, only connection metadata.
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: row } = await supabase
    .from('calendar_connections')
    .select('calendar_email, connected_at')
    .eq('advisor_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    connected: !!row,
    email: row?.calendar_email || null,
    connectedAt: row?.connected_at || null,
  })
}