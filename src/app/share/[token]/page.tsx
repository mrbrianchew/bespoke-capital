import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import ShareClient from './ShareClient'

// Server component wrapper for /share/[token]. The actual page is a client
// component (ShareClient) — App Router won't let a 'use client' file export
// generateMetadata, so this thin server wrapper exists purely to resolve the
// advisor's firm name server-side and set a dynamic <title> (shown in the
// browser tab and in link-preview cards when the link is shared). No UI or
// data-fetching logic lives here — ShareClient still does its own
// client-side fetch via /api/share-data/[token] exactly as before.
//
// A share token resolves against one of two tables: client_shares
// (portfolio/payment_summary/claims, tied to a client) or financial_plans
// (tied directly to the advisor who created it) — same two-path lookup the
// /api/share-data/[token] route already does.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function resolveFirmForAdvisor(advisorId: string | null | undefined): Promise<string | null> {
  if (!advisorId) return null
  const { data: advisor } = await supabaseAdmin.from('advisors').select('firm').eq('id', advisorId).maybeSingle()
  return advisor?.firm || null
}

async function resolveFirmForToken(token: string): Promise<string | null> {
  const { data: share } = await supabaseAdmin
    .from('client_shares').select('client_id').eq('token', token).maybeSingle()
  if (share) {
    if (!share.client_id) return null
    const { data: client } = await supabaseAdmin
      .from('clients').select('advisor_id').eq('id', share.client_id).maybeSingle()
    return resolveFirmForAdvisor(client?.advisor_id)
  }
  const { data: plan } = await supabaseAdmin
    .from('financial_plans').select('created_by').eq('share_token', token).maybeSingle()
  if (plan) return resolveFirmForAdvisor(plan.created_by)
  return null
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const firm = await resolveFirmForToken(params.token)
  const title = `${firm || 'Bespoke Capital'} — Client Summary`
  return { title }
}

export default function SharePage({ params }: { params: { token: string } }) {
  return <ShareClient params={params} />
}