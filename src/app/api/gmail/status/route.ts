import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/requireUser'

// Deliberately returns only { connected, email, connectedAt } — never the
// encrypted_refresh_token column, even though the caller is authenticated as
// the row's own advisor. There is no legitimate client-side use for that
// value, so it never leaves the server.
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: row } = await supabase
    .from('gmail_connections')
    .select('gmail_email, connected_at')
    .eq('advisor_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    connected: !!row,
    email: row?.gmail_email || null,
    connectedAt: row?.connected_at || null,
  })
}