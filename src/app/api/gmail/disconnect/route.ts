import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/requireUser'
import { decryptToken } from '@/lib/tokenCrypto'
import { revokeGoogleToken } from '@/lib/googleGmail'

export async function POST() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: row } = await supabase
    .from('gmail_connections')
    .select('encrypted_refresh_token')
    .eq('advisor_id', user.id)
    .maybeSingle()

  if (row?.encrypted_refresh_token) {
    try {
      const refreshToken = decryptToken(row.encrypted_refresh_token)
      await revokeGoogleToken(refreshToken)
    } catch (e) {
      console.error('[gmail/disconnect] revoke failed, deleting local row anyway', e)
    }
  }

  const { error } = await supabase.from('gmail_connections').delete().eq('advisor_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}