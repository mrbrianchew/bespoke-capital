'use client'
import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import { STAGES, Stage, staleLevel, hasUpcomingMeeting, daysInStage, AttentionMeeting } from '@/lib/newBusinessAttention'
import NewBusinessCaseModal from '@/components/NewBusinessCaseModal'
import CaseDrawer, { CaseRow, ProductRow, T, btnSmStyle } from '@/components/NewBusinessCaseDrawer'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Client Servicing's per-client view over new_business_cases — sits
// alongside Contact Report / Medical Claims / Service Requests, scoped to
// whichever client is active in the sidebar. Unlike the firm-wide board
// (dashboard/business/new-business), this is NOT a Kanban: one client
// rarely has more than 1-2 active cases at a time, so 8 columns would be
// mostly empty. Instead: a flat list/timeline, newest first, each case
// showing its current stage as a badge. Clicking a case opens the exact
// same drawer the Board uses (components/NewBusinessCaseDrawer.tsx).

function staleBadge(row: CaseRow, meetings: AttentionMeeting[]) {
  const level = staleLevel(row, meetings)
  if (level === 'meeting') {
    const m = hasUpcomingMeeting(row.id, meetings)
    const label = m ? new Date(m.meeting_date + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' }) : ''
    return { text: `📅 ${label}`, bg: T.slateSoft, fg: T.slate }
  }
  const days = daysInStage(row)
  const text = days === 0 ? 'Today' : `${days}d in stage`
  if (level === 'stale') return { text, bg: T.roseSoft, fg: T.rose }
  if (level === 'warn') return { text, bg: T.goldSoft, fg: T.goldText }
  return { text, bg: T.emeraldSoft, fg: T.emerald }
}

export default function NewApplicationsServicingPage() {
  const { activeClient, advisor, clients, setClients, spouseNames, authLoading } = useDashboard()
  const supabase = createClient()

  const hasAccess = advisor?.id === CREATOR_ID || (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing'))

  const [loading, setLoading] = useState(true)
  const [cases, setCases] = useState<CaseRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [meetings, setMeetings] = useState<AttentionMeeting[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showNewCase, setShowNewCase] = useState(false)
  const [savingOutcome, setSavingOutcome] = useState(false)
  const [outcomeDraft, setOutcomeDraft] = useState<{ type: 'lost' | 'deferred'; reason: string; revisitDate: string } | null>(null)

  useEffect(() => {
    if (authLoading || !hasAccess || !activeClient) { setLoading(false); return }
    let cancelled = false
    async function load() {
      setLoading(true)
      const casesRes = await supabase.from('new_business_cases').select('*').eq('client_id', activeClient!.id).order('created_at', { ascending: false })
      if (cancelled) return
      const caseRows = (casesRes.data || []) as CaseRow[]
      setCases(caseRows)
      const ids = caseRows.map(c => c.id)
      if (ids.length > 0) {
        const [productsRes, meetingsRes] = await Promise.all([
          supabase.from('new_business_case_products').select('*').in('case_id', ids),
          supabase.from('new_business_case_meetings').select('case_id, meeting_date, is_scheduled').in('case_id', ids).eq('is_scheduled', true),
        ])
        if (cancelled) return
        setProducts((productsRes.data || []) as ProductRow[])
        setMeetings((meetingsRes.data || []) as AttentionMeeting[])
      } else {
        setProducts([])
        setMeetings([])
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, hasAccess, activeClient?.id])

  const productsByCase = useMemo(() => {
    const map: Record<string, ProductRow[]> = {}
    products.forEach(p => { (map[p.case_id] ||= []).push(p) })
    return map
  }, [products])

  const activeCases = useMemo(() => cases.filter(c => !c.outcome), [cases])
  const pastCases = useMemo(() => cases.filter(c => !!c.outcome), [cases])

  async function moveStage(id: string, stage: Stage) {
    setCases(prev => prev.map(c => c.id === id ? { ...c, stage, stage_changed_at: new Date().toISOString() } : c))
    const { error } = await supabase.from('new_business_cases').update({ stage, stage_changed_at: new Date().toISOString() }).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function submitOutcome() {
    if (!editingId || !outcomeDraft) return
    const row = cases.find(c => c.id === editingId)
    if (!row) return
    setSavingOutcome(true)
    const patch: Partial<CaseRow> = {
      outcome: outcomeDraft.type,
      outcome_reason: outcomeDraft.reason || null,
      outcome_at_stage: STAGES.find(s => s.key === row.stage)?.label || row.stage,
      revisit_date: outcomeDraft.type === 'deferred' ? (outcomeDraft.revisitDate || null) : null,
    }
    const { error } = await supabase.from('new_business_cases').update(patch).eq('id', editingId)
    setSavingOutcome(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setCases(prev => prev.map(c => c.id === editingId ? { ...c, ...patch } : c))
    setOutcomeDraft(null)
    setEditingId(null)
  }

  async function reopenCase(id: string) {
    const { error } = await supabase.from('new_business_cases')
      .update({ outcome: null, outcome_reason: null, outcome_at_stage: null, revisit_date: null }).eq('id', id)
    if (error) { alert('Save failed: ' + error.message); return }
    setCases(prev => prev.map(c => c.id === id ? { ...c, outcome: null, outcome_reason: null, outcome_at_stage: null, revisit_date: null } : c))
  }

  function handleCaseCreated(newCase: CaseRow) {
    setCases(prev => [newCase, ...prev])
    setShowNewCase(false)
  }

  const editingRow = editingId ? cases.find(c => c.id === editingId) || null : null

  if (authLoading || loading) return <div style={{ padding: 40, color: T.textFaint, fontSize: 13 }}>Loading…</div>
  if (!hasAccess) return null
  if (!activeClient) return <div style={{ padding: 40, color: T.textFaint, fontSize: 13 }}>Select a client from the sidebar to begin.</div>

  return (
    <div style={{ minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 32px 18px', borderBottom: `1px solid ${T.line}` }}>
        <div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.gold }}>Client Servicing</div>
          <h1 className="font-serif" style={{ fontSize: 32, fontWeight: 600, margin: 0, color: T.text, letterSpacing: '-0.01em' }}>New Applications</h1>
        </div>
        <button onClick={() => setShowNewCase(true)} style={{ ...btnSmStyle, background: T.text, color: 'var(--cream)', borderColor: T.text }}>
          + New Case
        </button>
      </div>

      <div style={{ padding: '24px 32px 60px', maxWidth: 760 }}>
        {cases.length === 0 && (
          <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic' }}>No New Business cases for {activeClient.name} yet.</div>
        )}

        {activeCases.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 12 }}>Active</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activeCases.map(c => (
                <CaseListItem key={c.id} row={c} products={productsByCase[c.id] || []} meetings={meetings} onClick={() => setEditingId(c.id)} />
              ))}
            </div>
          </div>
        )}

        {pastCases.length > 0 && (
          <div>
            <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 12 }}>Past</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pastCases.map(c => (
                <CaseListItem key={c.id} row={c} products={productsByCase[c.id] || []} meetings={meetings} onClick={() => setEditingId(c.id)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {editingRow && (
        <div onClick={() => { setEditingId(null); setOutcomeDraft(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.42)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(720px, 94vw)', background: 'var(--cream)', height: '100%', overflowY: 'auto', boxShadow: '-14px 0 40px rgba(0,0,0,0.18)' }}>
            <CaseDrawer
              row={editingRow}
              clientName={activeClient.name}
              spouseName={spouseNames[activeClient.id] || null}
              products={productsByCase[editingRow.id] || []}
              onClose={() => { setEditingId(null); setOutcomeDraft(null) }}
              onMoveStage={stage => moveStage(editingRow.id, stage)}
              outcomeDraft={outcomeDraft}
              onStartOutcome={type => setOutcomeDraft({ type, reason: '', revisitDate: '' })}
              onCancelOutcome={() => setOutcomeDraft(null)}
              onChangeOutcomeDraft={setOutcomeDraft}
              onSubmitOutcome={submitOutcome}
              savingOutcome={savingOutcome}
              onReopen={() => reopenCase(editingRow.id)}
            />
          </div>
        </div>
      )}

      {showNewCase && advisor && (
        <NewBusinessCaseModal
          advisorId={advisor.id}
          clients={clients}
          setClients={setClients}
          presetClient={activeClient}
          onClose={() => setShowNewCase(false)}
          onCreated={handleCaseCreated}
        />
      )}
    </div>
  )
}

function CaseListItem({ row, products, meetings, onClick }: { row: CaseRow; products: ProductRow[]; meetings: AttentionMeeting[]; onClick: () => void }) {
  const stageLabel = STAGES.find(s => s.key === row.stage)?.label || row.stage
  const badge = row.outcome
    ? (row.outcome === 'lost' ? { text: 'Lost', bg: T.roseSoft, fg: T.rose } : { text: 'Deferred', bg: T.slateSoft, fg: T.slate })
    : staleBadge(row, meetings)
  const issuedCount = products.filter(p => p.status === 'issued').length

  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
      opacity: row.outcome ? 0.75 : 1,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: T.text }}>{row.case_title}</div>
        <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 2 }}>
          {row.outcome ? `${row.outcome === 'lost' ? 'Died' : 'Paused'} at: ${row.outcome_at_stage}` : stageLabel}
          {products.length > 0 && ` · ${row.stage === 'processing' ? `${issuedCount}/${products.length} issued` : `${products.length} product${products.length === 1 ? '' : 's'}`}`}
        </div>
      </div>
      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '3px 7px', borderRadius: 5, whiteSpace: 'nowrap', flexShrink: 0, background: badge.bg, color: badge.fg }}>{badge.text}</span>
    </div>
  )
}