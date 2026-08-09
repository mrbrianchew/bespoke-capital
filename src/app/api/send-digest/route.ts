import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { AttentionLineItem, AttentionTodo, needsFollowupItems, urgentTodos } from '@/lib/claimsAttention'
import { buildDigestHtml, DigestSection, totalDigestItems } from '@/lib/digestEmail'

const CREATOR_ID = process.env.CREATOR_ID || process.env.NEXT_PUBLIC_CREATOR_ID
const APP_URL = 'https://bespoke-capital.vercel.app'

function daysIdle(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function dueBadge(dueDate: string | null): string {
  if (!dueDate) return 'Overdue'
  const d = new Date(dueDate + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff < 0) return `Overdue · ${Math.abs(diff)}d`
  return 'Due today'
}

// Builds this advisor's Claims section — same scoring as the sidebar badge
// and the Claims Board's "Needs a follow-up" bucket (claimsAttention.ts),
// just run server-side across their whole book instead of client-side for
// one page. Any future section (Servicing, New Business) follows the same
// shape: fetch this advisor's rows, score them, return a DigestSection.
async function buildClaimsSection(supabase: any, advisorId: string): Promise<DigestSection> {
  const { data: clients } = await supabase.from('clients').select('id, name').eq('advisor_id', advisorId)
  const clientRows = (clients || []) as { id: string; name: string }[]
  if (clientRows.length === 0) return { title: 'Claims', items: [] }
  const clientNameById: Record<string, string> = {}
  clientRows.forEach(c => { clientNameById[c.id] = c.name })
  const clientIds = clientRows.map(c => c.id)

  const { data: claims } = await supabase.from('claims').select('id, client_id').in('client_id', clientIds)
  const claimRows = (claims || []) as { id: string; client_id: string }[]
  if (claimRows.length === 0) return { title: 'Claims', items: [] }
  const clientIdByClaimId: Record<string, string> = {}
  claimRows.forEach(c => { clientIdByClaimId[c.id] = c.client_id })
  const claimIds = claimRows.map(c => c.id)

  const { data: items } = await supabase.from('claim_line_items')
    .select('id, claim_id, description, approved, rejected, submitted_date, date_from')
    .in('claim_id', claimIds).eq('approved', false).eq('rejected', false)
  const itemRows = (items || []) as (AttentionLineItem & { description: string | null })[]
  const itemById: Record<string, AttentionLineItem & { description: string | null }> = {}
  itemRows.forEach(i => { itemById[i.id] = i })
  if (itemRows.length === 0) return { title: 'Claims', items: [] }
  const itemIds = itemRows.map(i => i.id)

  const { data: todos } = await supabase.from('claim_followup_todos')
    .select('id, line_item_id, task, due_date, done')
    .in('line_item_id', itemIds).eq('done', false)
  const todoRows = (todos || []) as (AttentionTodo & { task: string })[]

  const clientNameForItem = (item: AttentionLineItem) => {
    const clientId = clientIdByClaimId[item.claim_id]
    return clientNameById[clientId] || 'Unknown client'
  }

  const urgentItems = (urgentTodos(todoRows) as (AttentionTodo & { task: string })[]).map(t => {
    const item = itemById[t.line_item_id]
    return {
      label: item ? clientNameForItem(item) : 'Unknown client',
      detail: t.task,
      badge: dueBadge(t.due_date),
      badgeColor: 'rose' as const,
    }
  })

  const staleItems = needsFollowupItems(itemRows, todoRows).map(item => {
    const days = daysIdle(item.submitted_date || item.date_from)
    return {
      label: clientNameForItem(item),
      detail: `${(item as any).description || 'No follow-up set'}`,
      badge: `${days}d idle`,
      badgeColor: 'rose' as const,
    }
  })

  return { title: 'Claims', items: [...urgentItems, ...staleItems] }
}

export async function GET(req: Request) {
  // Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when a
  // CRON_SECRET env var is set — this is what stops the route being spammed
  // by anyone who finds the URL, since it uses the service-role key below.
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: advisors } = await supabase.from('advisors')
    .select('id, name, email, digest_email, status, beta_features')
  const eligible = (advisors || []).filter((a: any) =>
    a.status === 'approved' &&
    (a.digest_email || a.email) &&
    (a.id === CREATOR_ID || (Array.isArray(a.beta_features) && a.beta_features.includes('servicing')))
  )

  const results: { advisorId: string; sent: boolean; count: number }[] = []

  for (const advisor of eligible) {
    const claimsSection = await buildClaimsSection(supabase, advisor.id)
    const sections = [claimsSection] // future sections (Servicing, New Business) get pushed here
    const count = totalDigestItems(sections)
    if (count === 0) { results.push({ advisorId: advisor.id, sent: false, count: 0 }); continue }

    const html = buildDigestHtml(advisor.name || 'there', sections, `${APP_URL}/dashboard/business/claims`)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'Bespoke Capital <onboarding@resend.dev>',
        to: advisor.digest_email || advisor.email,
        subject: `${count} item${count === 1 ? '' : 's'} need attention this week`,
        html,
      }),
    })
    results.push({ advisorId: advisor.id, sent: res.ok, count })
  }

  return NextResponse.json({ success: true, results })
}