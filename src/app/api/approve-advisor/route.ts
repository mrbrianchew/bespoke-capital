import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { id } = await req.json()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  await supabase.from('advisors').update({ status: 'approved' }).eq('id', id)
  await supabase.auth.admin.updateUserById(id, { email_confirm: true })
  return NextResponse.json({ success: true })
}
