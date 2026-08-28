import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import StatementClient from './StatementClient'

// Server component wrapper for /statement/[token]. The actual page is a
// client component (StatementClient) — App Router won't let a 'use client'
// file export generateMetadata, so this thin server wrapper exists purely to
// resolve the advisor's firm name server-side and set a dynamic <title>
// (this is what shows in the browser tab and in link-preview cards when the
// link is pasted into WhatsApp/iMessage/etc). No UI or data-fetching logic
// lives here — StatementClient still does its own client-side fetch via
// /api/statement/[token] exactly as before.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function resolveFirmForToken(token: string): Promise<string | null> {
  const { data: stmt } = await supabaseAdmin
    .from('financial_statements').select('client_id').eq('token', token).maybeSingle()
  if (!stmt?.client_id) return null
  const { data: client } = await supabaseAdmin
    .from('clients').select('advisor_id').eq('id', stmt.client_id).maybeSingle()
  if (!client?.advisor_id) return null
  const { data: advisor } = await supabaseAdmin
    .from('advisors').select('firm').eq('id', client.advisor_id).maybeSingle()
  return advisor?.firm || null
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const firm = await resolveFirmForToken(params.token)
  const title = `${firm || 'Bespoke Capital'} — Financial Statement`
  return { title }
}

export default function StatementPage() {
  return <StatementClient />
}