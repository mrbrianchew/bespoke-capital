'use client'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import { IDLE_THRESHOLD_DAYS, Stage, hasUpcomingMeeting, calcAfyp, AttentionMeeting } from '@/lib/newBusinessAttention'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Business Dashboard landing page — the entry point Claims/New Business/
// Service Requests never had (each was previously only reachable via its
// own sidebar link, with no shared overview). Pulls a lean slice from all
// three pipelines: overdue/today/this-week/next-week items due-date items
// (todos + New Business meetings) merged into one feed, plus each
// pipeline's own "needs a follow-up" (stale, nothing tracked) rows merged
// into one list. Does NOT reuse each board's full fetch — those load a lot
// more than a summary page needs (documents, activity logs, full case
// products, etc.) — this fetches only the lean columns required here.
//
// Aug 2026. "Needs a follow-up" merge: Claims/Service use a flat 14-day
// idle threshold, New Business uses a per-stage threshold (3-14 days) — raw
// day-counts aren't comparable across those, so the merged list sorts by
// SEVERITY RATIO (days idle ÷ that item's own threshold), not raw days.
// This is a deliberate product decision (Brian, Aug 2026) — do not "fix" it
// back to a flat days-idle sort, that would systematically bury New
// Business's fast-decaying stages (Outreach/Consideration) under Claims'
// naturally larger day-counts.

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(45,90,78,.12)',
  rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  slate: '#5C6B73', slateSoft: 'rgba(92,107,115,.12)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)', cream2: 'var(--cream2)',
}

const PIPE = {
  claims: { label: 'Claims', color: T.emerald, soft: T.emeraldSoft, href: '/dashboard/business/claims' },
  newbiz: { label: 'New Biz', color: T.goldText, soft: T.goldSoft, href: '/dashboard/business/new-business' },
  service: { label: 'Service', color: T.slate, soft: T.slateSoft, href: '/dashboard/business/service-requests' },
} as const
type Pipe = keyof typeof PIPE

// Same calendar-week bucketing as each board's own "Upcoming follow-ups"
// tab (fixed Aug 2026 — see those pages' comments for why this isn't a
// rolling 7-day window).
function weekBucket(dateStr: string | null): 'today' | 'week' | 'nextweek' | 'later' {
  if (!dateStr) return 'week'
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return 'week'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diffDays <= 0) return 'today'
  const dow = today.getDay()
  const daysToSunday = dow === 0 ? 0 : 7 - dow
  const thisWeekEnd = new Date(today); thisWeekEnd.setDate(today.getDate() + daysToSunday)
  const nextWeekEnd = new Date(thisWeekEnd); nextWeekEnd.setDate(thisWeekEnd.getDate() + 7)
  if (d.getTime() <= thisWeekEnd.getTime()) return 'week'
  if (d.getTime() <= nextWeekEnd.getTime()) return 'nextweek'
  return 'later'
}

function daysIdleFrom(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

interface FeedEntry { pipe: Pipe; title: string; detail: string; date: string | null; time?: string | null; href: string }
interface StaleEntry { pipe: Pipe; title: string; detail: string; ratio: number; badge: string; href: string }

// Hover on desktop (unchanged), tap-to-toggle on mobile where hover doesn't
// exist at all (Aug 2026 — Brian flagged AFYP's tooltip was dead on touch).
// Click-outside dismisses so a stray tap elsewhere on the page closes it.
function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onOutside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])
  return (
    <div ref={ref} className="group relative inline-flex items-center">
      <button type="button" onClick={() => setOpen(o => !o)} style={{
        width: 14, height: 14, borderRadius: '50%', border: `1px solid var(--ink3)`, color: 'var(--ink3)',
        fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'help',
        flexShrink: 0, background: 'none', padding: 0,
      }}>?</button>
      <div className={`${open ? 'block' : 'hidden'} group-hover:block absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20`} style={{
        width: 230, padding: '10px 12px', background: 'var(--charcoal)', color: '#fff', fontSize: 11, lineHeight: 1.5,
        borderRadius: 8, fontFamily: 'Inter, sans-serif', textTransform: 'none', letterSpacing: 'normal',
        boxShadow: '0 10px 28px rgba(0,0,0,0.22)',
      }}>
        {text}
      </div>
    </div>
  )
}

// SSR-safe: starts false (desktop layout), corrects on mount. Shared shape
// reused (duplicated, matching this codebase's existing per-file pattern)
// in the Kanban/List toggle on each board page.
function useNarrow(breakpoint: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    setNarrow(mq.matches)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpoint])
  return narrow
}

export default function BusinessOverviewPage() {
  const router = useRouter()
  const { advisor, clients, authLoading } = useDashboard()
  const narrow = useNarrow(860)
  const hasAccess = advisor?.id === CREATOR_ID ||
    (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing') && advisor.beta_features.includes('business_dashboard'))

  const [loading, setLoading] = useState(true)
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([])
  const [staleEntries, setStaleEntries] = useState<StaleEntry[]>([])
  const [kpis, setKpis] = useState({ activeCases: 0, considerationCount: 0, considerationStale: 0, afyp: 0, claimsInProgress: 0, openServiceRequests: 0 })
  const [badges, setBadges] = useState({ claims: 0, newbiz: 0, service: 0 })

  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, advisor, hasAccess, router])

  useEffect(() => {
    if (authLoading || !hasAccess) { setLoading(false); return }
    let cancelled = false
    const supabase = createClient()
    const clientNameById: Record<string, string> = {}
    clients.forEach(c => { clientNameById[c.id] = c.name })

    async function load() {
      const feed: FeedEntry[] = []
      const stale: StaleEntry[] = []

      // ── Claims ──────────────────────────────────────────────────────
      const { data: lineItems } = await supabase.from('claim_line_items')
        .select('id, claim_id, description, submitted_date, date_from')
        .eq('approved', false).eq('rejected', false)
      const items = (lineItems || []) as { id: string; claim_id: string; description: string | null; submitted_date: string | null; date_from: string | null }[]
      let claimsInProgress = items.length
      let claimsTodos: { id: string; line_item_id: string; task: string; due_date: string | null }[] = []
      let claimNameByItem: Record<string, string> = {}
      if (items.length > 0) {
        const claimIds = Array.from(new Set(items.map(i => i.claim_id)))
        const { data: claimRows } = await supabase.from('claims').select('id, client_id').in('id', claimIds)
        const clientIdByClaim: Record<string, string> = {}
        ;(claimRows || []).forEach((c: any) => { clientIdByClaim[c.id] = c.client_id })
        items.forEach(i => { claimNameByItem[i.id] = clientNameById[clientIdByClaim[i.claim_id]] || 'Unknown client' })

        const itemIds = items.map(i => i.id)
        const { data: todoRows } = await supabase.from('claim_followup_todos')
          .select('id, line_item_id, task, due_date').in('line_item_id', itemIds).eq('done', false)
        claimsTodos = (todoRows || []) as typeof claimsTodos

        const itemIdsWithOpenTodo = new Set(claimsTodos.map(t => t.line_item_id))
        items.forEach(item => {
          const idle = daysIdleFrom(item.submitted_date || item.date_from)
          if (idle !== null && idle >= 14 && !itemIdsWithOpenTodo.has(item.id)) {
            stale.push({
              pipe: 'claims', title: claimNameByItem[item.id], detail: item.description || 'No follow-up set',
              ratio: idle / 14, badge: `${idle}d idle`, href: PIPE.claims.href,
            })
          }
        })
        claimsTodos.forEach(t => {
          const item = items.find(i => i.id === t.line_item_id)
          if (!item) return
          feed.push({ pipe: 'claims', title: claimNameByItem[t.line_item_id], detail: t.task, date: t.due_date, href: PIPE.claims.href })
        })
      }

      // ── New Business ────────────────────────────────────────────────
      const { data: caseRows } = await supabase.from('new_business_cases')
        .select('id, case_title, stage, stage_changed_at, outcome').is('outcome', null)
      const cases = (caseRows || []) as { id: string; case_title: string; stage: Stage; stage_changed_at: string; outcome: null }[]
      let activeCases = cases.length
      let considerationCount = 0
      let considerationStale = 0
      let afyp = 0
      if (cases.length > 0) {
        const caseIds = cases.map(c => c.id)
        const [meetingsRes, todosRes, productsRes] = await Promise.all([
          supabase.from('new_business_case_meetings').select('id, case_id, title, meeting_date, meeting_time, is_scheduled').in('case_id', caseIds).eq('is_scheduled', true),
          supabase.from('new_business_case_todos').select('id, case_id, text, due_date').in('case_id', caseIds).eq('done', false),
          supabase.from('new_business_case_products').select('case_id, premium, premium_frequency, status, outcome').in('case_id', caseIds),
        ])
        const meetings = (meetingsRes.data || []) as (AttentionMeeting & { id: string; title: string; meeting_time: string | null })[]
        const todos = (todosRes.data || []) as { id: string; case_id: string; text: string; due_date: string | null }[]
        const products = (productsRes.data || []) as { case_id: string; premium: number | null; premium_frequency: string | null; status: string; outcome: string | null }[]

        // AFYP: single source of truth is calcAfyp() in newBusinessAttention.ts
        // (Aug 2026 — was duplicated here and on the New Business board;
        // now excludes Postponed products too, see that function's comment).
        const productsByCase: Record<string, typeof products> = {}
        products.forEach(p => { (productsByCase[p.case_id] ||= []).push(p) })
        afyp = calcAfyp(cases, productsByCase)

        const openTodoCaseIds = new Set(todos.map(t => t.case_id))
        cases.forEach(c => {
          if (c.stage === 'consideration') considerationCount++
          const threshold = IDLE_THRESHOLD_DAYS[c.stage]
          if (threshold === null) return
          if (hasUpcomingMeeting(c.id, meetings)) return
          const days = Math.max(0, Math.floor((Date.now() - new Date(c.stage_changed_at).getTime()) / 86400000))
          if (c.stage === 'consideration' && days >= threshold) considerationStale++
          if (days >= threshold && !openTodoCaseIds.has(c.id)) {
            stale.push({
              pipe: 'newbiz', title: c.case_title, detail: `Stale in ${c.stage.replace('_', ' ')} · nothing tracked`,
              ratio: days / threshold, badge: `${days}d in stage`, href: PIPE.newbiz.href,
            })
          }
        })
        todos.forEach(t => {
          const c = cases.find(cc => cc.id === t.case_id)
          if (!c) return
          feed.push({ pipe: 'newbiz', title: c.case_title, detail: t.text, date: t.due_date, href: PIPE.newbiz.href })
        })
        meetings.forEach(m => {
          const c = cases.find(cc => cc.id === m.case_id)
          if (!c) return
          feed.push({ pipe: 'newbiz', title: c.case_title, detail: m.title, date: m.meeting_date, time: m.meeting_time, href: PIPE.newbiz.href })
        })
      }

      // ── Service Requests ────────────────────────────────────────────
      const { data: srRows } = await supabase.from('service_requests')
        .select('id, client_id, request_type, status, updated_at').neq('status', 'done')
      const srs = (srRows || []) as { id: string; client_id: string; request_type: string; status: string; updated_at: string }[]
      let openServiceRequests = srs.length
      if (srs.length > 0) {
        const srIds = srs.map(s => s.id)
        const { data: srTodoRows } = await supabase.from('service_request_todos')
          .select('id, service_request_id, text, due_date').in('service_request_id', srIds).eq('done', false)
        const srTodos = (srTodoRows || []) as { id: string; service_request_id: string; text: string; due_date: string | null }[]
        const idsWithOpenTodo = new Set(srTodos.map(t => t.service_request_id))
        srs.forEach(r => {
          const idle = daysIdleFrom(r.updated_at)
          if (idle !== null && idle >= 14 && !idsWithOpenTodo.has(r.id)) {
            stale.push({
              pipe: 'service', title: clientNameById[r.client_id] || 'Unknown client', detail: `${r.request_type} · no follow-up set`,
              ratio: idle / 14, badge: `${idle}d idle`, href: PIPE.service.href,
            })
          }
        })
        srTodos.forEach(t => {
          const r = srs.find(rr => rr.id === t.service_request_id)
          if (!r) return
          feed.push({ pipe: 'service', title: clientNameById[r.client_id] || 'Unknown client', detail: t.text, date: t.due_date, href: PIPE.service.href })
        })
      }

      if (cancelled) return
      stale.sort((a, b) => b.ratio - a.ratio)
      feed.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '').localeCompare(b.time || ''))
      setStaleEntries(stale)
      setFeedEntries(feed)
      setKpis({
        activeCases, considerationCount, considerationStale,
        afyp, claimsInProgress: claimsInProgress, openServiceRequests,
      })
      setBadges({
        claims: claimsInProgress > 0 ? feed.filter(f => f.pipe === 'claims').length + stale.filter(s => s.pipe === 'claims').length : 0,
        newbiz: feed.filter(f => f.pipe === 'newbiz').length + stale.filter(s => s.pipe === 'newbiz').length,
        service: feed.filter(f => f.pipe === 'service').length + stale.filter(s => s.pipe === 'service').length,
      })
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, hasAccess, clients])

  const todayEntries = useMemo(() => feedEntries.filter(e => weekBucket(e.date) === 'today'), [feedEntries])
  const weekEntries = useMemo(() => feedEntries.filter(e => weekBucket(e.date) === 'week'), [feedEntries])
  const nextWeekEntries = useMemo(() => feedEntries.filter(e => weekBucket(e.date) === 'nextweek'), [feedEntries])

  if (authLoading || loading) {
    return <div style={{ padding: 40, color: T.textFaint, fontSize: 13 }}>Loading overview…</div>
  }
  if (!hasAccess) return null

  const dueLabel = (date: string | null, time?: string | null) => {
    if (time) return time.slice(0, 5)
    if (!date) return ''
    return new Date(date + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'short' })
  }

  const renderFeedRow = (e: FeedEntry, i: number) => {
    const p = PIPE[e.pipe]
    return (
      <Link key={i} href={e.href} style={{ textDecoration: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: '11px 14px', marginBottom: 7, cursor: 'pointer' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.detail}</div>
            <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 2 }}>{e.title}</div>
          </div>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: p.soft, color: p.color, flexShrink: 0 }}>{p.label}</span>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, color: T.textFaint, whiteSpace: 'nowrap', flexShrink: 0 }}>{dueLabel(e.date, e.time)}</span>
        </div>
      </Link>
    )
  }

  const renderStaleRow = (e: StaleEntry, i: number) => {
    const p = PIPE[e.pipe]
    return (
      <Link key={i} href={e.href} style={{ textDecoration: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#fff', border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.rose}`, borderRadius: 10, padding: '11px 14px', marginBottom: 7, cursor: 'pointer' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>{e.title}</div>
            <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 2, fontStyle: 'italic' }}>{e.detail}</div>
          </div>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4, background: p.soft, color: p.color, flexShrink: 0 }}>{p.label}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: T.rose, background: T.roseSoft, padding: '3px 9px', borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0 }}>{e.badge}</span>
        </div>
      </Link>
    )
  }

  const Kpi = ({ label, value, flag, tooltip }: { label: string; value: string; flag?: string; tooltip?: string }) => (
    <div style={{ flex: 1, minWidth: 130, padding: '4px 20px', borderRight: `1px solid ${T.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'DM Mono, monospace', fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint }}>
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <div className="font-serif" style={{ fontSize: 26, fontWeight: 600, color: T.text, marginTop: 2 }}>
        {value}
        {flag && <span style={{ marginLeft: 6, fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, color: T.rose, background: T.roseSoft, padding: '1px 6px', borderRadius: 4, verticalAlign: 'middle' }}>{flag}</span>}
      </div>
    </div>
  )

  const totalFollowups = todayEntries.length + weekEntries.length + nextWeekEntries.length + staleEntries.length

  return (
    <div style={{ minHeight: '100%' }}>
      <div style={{ padding: '22px 32px 18px', borderBottom: `1px solid ${T.line}` }}>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.gold }}>Business Dashboard</div>
        <h1 className="font-serif" style={{ fontSize: 32, fontWeight: 600, margin: 0, color: T.text, letterSpacing: '-0.01em' }}>Overview</h1>
      </div>

      <div style={{ display: 'flex', padding: '16px 32px', borderBottom: `1px solid ${T.line}`, background: T.cream2, flexWrap: 'wrap' }}>
        <Kpi label="Active Cases" value={String(kpis.activeCases)} />
        <Kpi label="In Consideration" value={String(kpis.considerationCount)} flag={kpis.considerationStale > 0 ? `${kpis.considerationStale} stale` : undefined} />
        <Kpi label="Est. AFYP" value={`$${Math.round(kpis.afyp).toLocaleString('en-SG')}`}
          tooltip="Annualized First Year Premium. Sums premium across all products on active cases (not Lost/Deferred), excluding withdrawn, declined, or postponed products. Monthly premiums are ×12 to annualize; yearly/single as-is." />
        <Kpi label="Claims In Progress" value={String(kpis.claimsInProgress)} />
        <Kpi label="Open Service Reqs" value={String(kpis.openServiceRequests)} />
      </div>

      <div style={{ padding: '22px 32px 40px' }}>
        {totalFollowups === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13, fontStyle: 'italic', background: T.emeraldSoft, borderRadius: 10, border: `1px dashed ${T.emerald}`, marginBottom: 24 }}>
            Nothing pending anywhere — every follow-up across all three pipelines is checked off.
          </div>
        )}
        <div className="business-overview-grid" style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1.5fr 1fr', gap: 28, alignItems: 'start' }}>
          <div>
            {staleEntries.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.rose, marginBottom: 3 }}>
                  Needs a follow-up · {staleEntries.length}
                </div>
                <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 8 }}>
                  Stale, with nothing tracked to chase it — pooled from all three pipelines, most urgent relative to its own threshold first.
                </div>
                {staleEntries.map(renderStaleRow)}
              </div>
            )}
            {todayEntries.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>Today · {todayEntries.length}</div>
                {todayEntries.map(renderFeedRow)}
              </div>
            )}
            {weekEntries.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>This week · {weekEntries.length}</div>
                {weekEntries.map(renderFeedRow)}
              </div>
            )}
            {nextWeekEntries.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>Next week · {nextWeekEntries.length}</div>
                {nextWeekEntries.map(renderFeedRow)}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>Pipelines</div>
            <div className="business-overview-cards" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(Object.keys(PIPE) as Pipe[]).map(k => {
                const p = PIPE[k]
                const count = badges[k]
                const statusText = k === 'claims'
                  ? `${kpis.claimsInProgress} in progress${count > 0 ? ` · ${count} need attention` : ''}`
                  : k === 'newbiz'
                    ? `${kpis.considerationCount} in Consideration${count > 0 ? ` · ${count} need attention` : ''}`
                    : `${kpis.openServiceRequests} open${count > 0 ? ` · ${count} need attention` : ' · all tracked'}`
                return (
                  <Link key={k} href={p.href} style={{ textDecoration: 'none' }}>
                    <div style={{ position: 'relative', background: '#fff', border: `1px solid ${T.line}`, borderRadius: 12, padding: 16, cursor: 'pointer' }}>
                      {count > 0 && (
                        <div style={{ position: 'absolute', top: 14, right: 14, background: T.rose, color: '#fff', fontFamily: 'DM Mono, monospace', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20 }}>{count}</div>
                      )}
                      <div className="font-serif" style={{ fontSize: 19, fontWeight: 600, color: T.text }}>{p.label === 'New Biz' ? 'New Business' : p.label === 'Service' ? 'Service Requests' : p.label}</div>
                      <div style={{ fontSize: 11, color: T.textFaint, marginTop: 3 }}>{statusText}</div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}