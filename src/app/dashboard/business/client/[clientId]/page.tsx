'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import { fetchClientOpenItems, ClientOpenItems } from '@/lib/clientOpenItems'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// "Everything for this client" across Claims / New Business / Service —
// the view that didn't exist before Aug 2026 (previously you had to check
// all three boards separately to see one client's full picture). Read-only
// by design: editing still happens on the board that owns the item
// (Kanban card, drawer, etc.) — this page links out rather than
// re-implementing three different edit forms. Reached from the Global
// Quick-Add's "View all for this client" link, or directly at
// /dashboard/business/client/[clientId].

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(45,90,78,.12)',
  rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  slate: '#5C6B73', slateSoft: 'rgba(92,107,115,.12)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)', cream2: 'var(--cream2)',
}

function fmtDate(d: string | null, time?: string | null) {
  if (!d) return null
  const label = new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
  return time ? `${label}, ${time.slice(0, 5)}` : label
}

export default function ClientEverythingPage() {
  const params = useParams()
  const clientId = params.clientId as string
  const router = useRouter()
  const { advisor, clients, authLoading } = useDashboard()
  const hasAccess = advisor?.id === CREATOR_ID ||
    (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing') && advisor.beta_features.includes('business_dashboard'))

  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ClientOpenItems | null>(null)
  const client = clients.find(c => c.id === clientId)

  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, advisor, hasAccess, router])

  useEffect(() => {
    if (authLoading || !hasAccess || !clientId) { setLoading(false); return }
    let cancelled = false
    const supabase = createClient()
    fetchClientOpenItems(supabase, clientId).then(data => {
      if (!cancelled) { setItems(data); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [authLoading, hasAccess, clientId])

  if (authLoading || loading) return <div style={{ padding: 40, color: T.textFaint, fontSize: 13 }}>Loading…</div>
  if (!hasAccess) return null

  const totalOpen = items ? items.claims.length + items.newBusiness.length + items.service.length : 0

  return (
    <div style={{ minHeight: '100%' }}>
      <div style={{ padding: '22px 32px 18px', borderBottom: `1px solid ${T.line}` }}>
        <Link href="/dashboard/business" style={{ fontSize: 11.5, color: T.textFaint, textDecoration: 'none' }}>← Business Dashboard</Link>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.gold, marginTop: 10 }}>Client Overview</div>
        <h1 className="font-serif" style={{ fontSize: 32, fontWeight: 600, margin: 0, color: T.text, letterSpacing: '-0.01em' }}>{client?.name || 'Unknown client'}</h1>
      </div>

      <div style={{ padding: '22px 32px 40px', maxWidth: 760 }}>
        {totalOpen === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13, fontStyle: 'italic', background: T.emeraldSoft, borderRadius: 10, border: `1px dashed ${T.emerald}` }}>
            Nothing open for this client across any pipeline.
          </div>
        )}

        {items && items.claims.length > 0 && (
          <Section title="Claims" color={T.emerald} soft={T.emeraldSoft} count={items.claims.length} href="/dashboard/business/claims">
            {items.claims.map(item => (
              <Card key={item.id} title={item.description} subtitle={item.policyLabel} href="/dashboard/business/claims">
                {item.todos.length === 0 ? <NoTodo /> : item.todos.map(t => <TodoRow key={t.id} text={t.text} due={fmtDate(t.due_date)} />)}
              </Card>
            ))}
          </Section>
        )}

        {items && items.newBusiness.length > 0 && (
          <Section title="New Business" color={T.goldText} soft={T.goldSoft} count={items.newBusiness.length} href="/dashboard/business/new-business">
            {items.newBusiness.map(c => (
              <Card key={c.id} title={c.title} subtitle={c.stage.replace('_', ' ')} href="/dashboard/business/new-business">
                {c.meetings.filter(m => m.is_scheduled).map(m => <MeetingRow key={m.id} title={m.title} when={fmtDate(m.meeting_date, m.meeting_time)!} />)}
                {c.todos.length === 0 && c.meetings.filter(m => m.is_scheduled).length === 0 ? <NoTodo /> : c.todos.map(t => <TodoRow key={t.id} text={t.text} due={fmtDate(t.due_date)} />)}
              </Card>
            ))}
          </Section>
        )}

        {items && items.service.length > 0 && (
          <Section title="Service Requests" color={T.slate} soft={T.slateSoft} count={items.service.length} href="/dashboard/business/service-requests">
            {items.service.map(r => (
              <Card key={r.id} title={r.requestType} subtitle={r.status.replace('_', ' ')} href="/dashboard/business/service-requests">
                {r.meetings.filter(m => m.is_scheduled).map(m => <MeetingRow key={m.id} title={m.title} when={fmtDate(m.meeting_date, m.meeting_time)!} />)}
                {r.todos.length === 0 && r.meetings.filter(m => m.is_scheduled).length === 0 ? <NoTodo /> : r.todos.map(t => <TodoRow key={t.id} text={t.text} due={fmtDate(t.due_date)} />)}
              </Card>
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ title, color, soft, count, href, children }: { title: string; color: string; soft: string; count: number; href: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, background: soft, color }}>{title}</span>
        <span style={{ fontSize: 11, color: T.textFaint }}>{count} open</span>
        <Link href={href} style={{ marginLeft: 'auto', fontSize: 11, color: T.textFaint, textDecoration: 'none' }}>Open board →</Link>
      </div>
      {children}
    </div>
  )
}

function Card({ title, subtitle, href, children }: { title: string; subtitle: string; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div style={{ background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: '13px 15px', marginBottom: 9, cursor: 'pointer' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{title}</div>
        <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2, textTransform: 'capitalize' }}>{subtitle}</div>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>{children}</div>
      </div>
    </Link>
  )
}

function TodoRow({ text, due }: { text: string; due: string | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, color: T.textDim }}>
      <span>· {text}</span>
      {due && <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: T.textFaint, flexShrink: 0 }}>{due}</span>}
    </div>
  )
}

function MeetingRow({ title, when }: { title: string; when: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, color: T.goldText }}>
      <span>◈ {title}</span>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, flexShrink: 0 }}>{when}</span>
    </div>
  )
}

function NoTodo() {
  return <div style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic' }}>Nothing tracked</div>
}