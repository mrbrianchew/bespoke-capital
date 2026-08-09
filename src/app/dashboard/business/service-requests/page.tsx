'use client'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import { DndContext, DragEndEvent, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Firm-wide Kanban over service_requests. Unlike Claims Board, a card click
// opens an in-place edit modal rather than navigating to a per-client page —
// there's no separate per-client Service Requests page this data lives on,
// the row itself IS the record. Status changes are reachable two ways: drag
// (desktop convenience) and buttons inside the modal (works everywhere,
// including mobile, where dragging a card into an off-screen column isn't
// realistic — see the mobile segmented view below).

// ─── TYPES ──────────────────────────────────────────────────────────────────

type RequestType = 'fund_switch' | 'nominee_change' | 'policy_loan' | 'correspondence' | 'document_request'
type Status = 'requested' | 'in_progress' | 'done'
type WaitingOn = 'client' | 'firm' | null

interface ServiceRequestRow {
  id: string
  client_id: string
  request_type: RequestType
  description: string
  policy_label: string | null
  status: Status
  waiting_on: WaitingOn
  created_by: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

interface TodoRow {
  id: string
  service_request_id: string
  text: string
  done: boolean
  created_at: string
}

const TYPE_LABEL: Record<RequestType, string> = {
  fund_switch: 'Fund Switch',
  nominee_change: 'Nominee Change',
  policy_loan: 'Policy Loan',
  correspondence: 'Correspondence',
  document_request: 'Document Request',
}

const TYPE_COLOR: Record<RequestType, { bg: string; fg: string }> = {
  fund_switch: { bg: 'var(--gold-l)', fg: 'var(--gold-tag)' },
  nominee_change: { bg: 'rgba(58,90,120,.12)', fg: '#3A5A78' },
  policy_loan: { bg: 'var(--rouge-l)', fg: 'var(--rouge)' },
  correspondence: { bg: 'var(--emerald-l)', fg: 'var(--emerald)' },
  document_request: { bg: 'var(--cream2)', fg: 'var(--ink2)' },
}

const RESOLVED_VISIBLE_DAYS = 30 // matches Claims Board's resolved drop-off, for consistency

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)',
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function columnFor(row: ServiceRequestRow): Status | null {
  if (row.status === 'done') {
    const daysAgo = daysSince(row.resolved_at || row.updated_at)
    return daysAgo !== null && daysAgo <= RESOLVED_VISIBLE_DAYS ? 'done' : null // drops off the board
  }
  return row.status
}

const COLUMNS: { id: Status; title: string; hint: string }[] = [
  { id: 'requested', title: 'Requested', hint: 'Not yet started' },
  { id: 'in_progress', title: 'In Progress', hint: 'Waiting on someone' },
  { id: 'done', title: 'Done', hint: `Last ${RESOLVED_VISIBLE_DAYS} days` },
]

// ─── PAGE ───────────────────────────────────────────────────────────────────

export default function BusinessServiceRequestsPage() {
  const { advisor, clients, authLoading } = useDashboard()
  const router = useRouter()
  const supabase = createClient()

  // Same two-flag gate as Claims Board — this is the same Business Dashboard
  // section, no separate beta flag introduced for this feature.
  const hasAccess = advisor?.id === CREATOR_ID ||
    (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing') && advisor.beta_features.includes('business_dashboard'))

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ServiceRequestRow[]>([])
  const [typeFilter, setTypeFilter] = useState<RequestType | 'all'>('all')
  const [mobileCol, setMobileCol] = useState<Status>('requested')

  // ── drag state ──
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  )

  // ── quick-capture bar state ──
  const [capClientName, setCapClientName] = useState('')
  const [capType, setCapType] = useState<RequestType>('fund_switch')
  const [capDesc, setCapDesc] = useState('')
  const [capSaving, setCapSaving] = useState(false)
  const [capError, setCapError] = useState('')
  const capDescRef = useRef<HTMLInputElement>(null)

  // ── edit modal state ──
  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalTodos, setModalTodos] = useState<TodoRow[]>([])
  const [todoDraft, setTodoDraft] = useState('')
  const [savingModal, setSavingModal] = useState(false)

  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
  }, [authLoading, advisor, hasAccess, router])

  // Firm-wide load. RLS on service_requests scopes through clients.advisor_id
  // (own_service_requests policy) — a plain select with no client_id filter
  // already returns only this advisor's rows, same as Claims Board.
  useEffect(() => {
    if (authLoading || !hasAccess) { setLoading(false); return }
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data } = await supabase.from('service_requests').select('*')
      if (cancelled) return
      setRows((data || []) as ServiceRequestRow[])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, hasAccess])

  const clientsById = useMemo(() => {
    const map: Record<string, string> = {}
    clients.forEach(c => { map[c.id] = c.name })
    return map
  }, [clients])

  const filteredRows = useMemo(() => {
    return typeFilter === 'all' ? rows : rows.filter(r => r.request_type === typeFilter)
  }, [rows, typeFilter])

  const columns = useMemo(() => {
    const buckets: Record<Status, ServiceRequestRow[]> = { requested: [], in_progress: [], done: [] }
    filteredRows.forEach(row => {
      const col = columnFor(row)
      if (!col) return
      buckets[col].push(row)
    })
    ;(Object.keys(buckets) as Status[]).forEach(col => {
      buckets[col].sort((a, b) => {
        if (col === 'done') return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime() // oldest first — most idle at top
      })
    })
    return buckets
  }, [filteredRows])

  const editingRow = editingId ? rows.find(r => r.id === editingId) || null : null

  // Optimistic update then write — same pattern as Claims Board's moveItem.
  async function patchRow(id: string, patch: Partial<ServiceRequestRow>) {
    const withTimestamp = { ...patch, updated_at: new Date().toISOString() }
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...withTimestamp } : r))
    const { error } = await supabase.from('service_requests').update(withTimestamp).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function moveTo(id: string, status: Status) {
    const patch: Partial<ServiceRequestRow> = { status }
    if (status === 'done') patch.resolved_at = new Date().toISOString()
    else patch.resolved_at = null // un-resolving clears it, matches Claims' un-resolve behaviour
    await patchRow(id, patch)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null)
    const { active, over } = event
    if (!over) return
    const id = active.id as string
    const zone = over.id as Status
    const row = rows.find(r => r.id === id)
    if (!row || row.status === zone) return
    moveTo(id, zone)
  }

  // Quick-capture — resolves the typed client name against the already-loaded
  // client list (via the datalist below). Requires an exact match; anything
  // else is a typo and gets rejected rather than silently creating a request
  // against the wrong client.
  async function submitQuickCapture() {
    setCapError('')
    const name = capClientName.trim()
    const desc = capDesc.trim()
    if (!name || !desc) return
    const client = clients.find(c => c.name.toLowerCase() === name.toLowerCase())
    if (!client) { setCapError(`No client named "${name}" — check the spelling or pick from the list.`); return }
    setCapSaving(true)
    const { data, error } = await supabase.from('service_requests')
      .insert({ client_id: client.id, request_type: capType, description: desc, status: 'requested' })
      .select().maybeSingle()
    setCapSaving(false)
    if (error) { setCapError('Could not save: ' + error.message); return }
    if (data) setRows(prev => [...prev, data as ServiceRequestRow])
    setCapClientName('')
    setCapDesc('')
    capDescRef.current?.focus()
  }

  // ── modal todos ──
  useEffect(() => {
    if (!editingId) { setModalTodos([]); return }
    let cancelled = false
    supabase.from('service_request_todos').select('*').eq('service_request_id', editingId).order('created_at', { ascending: true })
      .then(({ data }: any) => { if (!cancelled) setModalTodos((data || []) as TodoRow[]) })
    return () => { cancelled = true }
  }, [editingId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addTodo() {
    if (!editingId || !todoDraft.trim()) return
    const { data, error } = await supabase.from('service_request_todos')
      .insert({ service_request_id: editingId, text: todoDraft.trim() }).select().maybeSingle()
    if (error) { alert('Could not add: ' + error.message); return }
    if (data) setModalTodos(prev => [...prev, data as TodoRow])
    setTodoDraft('')
  }

  async function toggleTodo(id: string, done: boolean) {
    setModalTodos(prev => prev.map(t => t.id === id ? { ...t, done } : t))
    const { error } = await supabase.from('service_request_todos').update({ done }).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function deleteTodo(id: string) {
    setModalTodos(prev => prev.filter(t => t.id !== id))
    const { error } = await supabase.from('service_request_todos').delete().eq('id', id)
    if (error) alert('Delete failed: ' + error.message)
  }

  async function deleteRequest(id: string) {
    if (!window.confirm('Delete this service request? This cannot be undone.')) return
    setRows(prev => prev.filter(r => r.id !== id))
    setEditingId(null)
    const { error } = await supabase.from('service_requests').delete().eq('id', id)
    if (error) alert('Delete failed: ' + error.message)
  }

  if (!hasAccess) return null

  const openCount = columns.requested.length + columns.in_progress.length

  return (
    <div style={{ padding: 24, background: 'var(--cream)', minHeight: '100%', borderRadius: 16 }}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: T.gold, fontWeight: 700 }}>Business Dashboard</div>
          <div className="font-serif" style={{ fontSize: 26, marginTop: 5, color: T.text }}>Service Requests</div>
          <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 4 }}>
            {loading ? 'Loading…' : `${openCount} open request${openCount === 1 ? '' : 's'} across all clients`}
          </div>
        </div>
      </div>

      {/* ── Quick capture ── */}
      <div style={{ background: 'white', border: `1px solid ${T.line}`, borderRadius: 12, padding: '12px 14px', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            list="sr-clients-datalist"
            value={capClientName}
            onChange={e => setCapClientName(e.target.value)}
            placeholder="Client — start typing…"
            style={{ flex: '0 0 170px', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}
          />
          <datalist id="sr-clients-datalist">
            {clients.map(c => <option key={c.id} value={c.name} />)}
          </datalist>
          <select value={capType} onChange={e => setCapType(e.target.value as RequestType)}
            style={{ flex: '0 0 160px', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
            {(Object.keys(TYPE_LABEL) as RequestType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <input
            ref={capDescRef}
            value={capDesc}
            onChange={e => setCapDesc(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitQuickCapture() }}
            placeholder="What needs to be done…"
            style={{ flex: '1 1 200px', minWidth: 160, padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}
          />
          <button onClick={submitQuickCapture} disabled={capSaving || !capClientName.trim() || !capDesc.trim()}
            style={{ padding: '9px 16px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: capSaving ? 'default' : 'pointer', opacity: capSaving || !capClientName.trim() || !capDesc.trim() ? 0.5 : 1 }}>
            {capSaving ? 'Adding…' : 'Add'}
          </button>
        </div>
        {capError && <div style={{ fontSize: 11.5, color: T.rose, marginTop: 8 }}>{capError}</div>}
      </div>

      {/* ── type filter chips ── */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 18 }}>
        <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All types</FilterChip>
        {(Object.keys(TYPE_LABEL) as RequestType[]).map(t => (
          <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>{TYPE_LABEL[t]}</FilterChip>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>Loading service requests…</div>
      ) : (
        <>
          {/* ── DESKTOP: drag-and-drop board ── */}
          <div className="hidden md:flex" style={{ gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
            <DndContext sensors={dndSensors} onDragStart={e => setDraggingId(e.active.id as string)} onDragEnd={handleDragEnd}>
              {COLUMNS.map(col => (
                <div key={col.id} style={{ flex: '0 0 300px', minWidth: 300 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '2px 4px 10px' }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{col.title}</div>
                      <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 1 }}>{col.hint}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, background: 'var(--cream2)', padding: '2px 8px', borderRadius: 999 }}>
                      {columns[col.id].length}
                    </span>
                  </div>
                  <DropZone id={col.id}>
                    {columns[col.id].length === 0 && (
                      <div style={{ fontSize: 11.5, color: T.textFaint, fontStyle: 'italic', padding: '10px 4px' }}>Nothing here</div>
                    )}
                    {columns[col.id].map(row => (
                      <RequestCard key={row.id} row={row} clientName={clientsById[row.client_id] || 'Unknown client'}
                        dragging={draggingId === row.id} onClick={() => setEditingId(row.id)} />
                    ))}
                  </DropZone>
                </div>
              ))}
            </DndContext>
          </div>

          {/* ── MOBILE: segmented single-column view ── */}
          <div className="flex md:hidden" style={{ flexDirection: 'column' }}>
            <div style={{ display: 'flex', background: 'white', border: `1px solid ${T.line}`, borderRadius: 10, padding: 3, marginBottom: 14, gap: 2 }}>
              {COLUMNS.map(col => (
                <button key={col.id} onClick={() => setMobileCol(col.id)}
                  style={{ flex: 1, border: 'none', background: mobileCol === col.id ? 'var(--charcoal)' : 'none', color: mobileCol === col.id ? 'white' : T.textDim, fontSize: 11.5, fontWeight: 700, padding: '9px 4px', borderRadius: 7, cursor: 'pointer' }}>
                  {col.title}
                  <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600, opacity: 0.75, marginTop: 1 }}>{columns[col.id].length}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {columns[mobileCol].length === 0 && (
                <div style={{ fontSize: 11.5, color: T.textFaint, fontStyle: 'italic', padding: '10px 4px' }}>Nothing here</div>
              )}
              {columns[mobileCol].map(row => (
                <RequestCard key={row.id} row={row} clientName={clientsById[row.client_id] || 'Unknown client'}
                  dragging={false} onClick={() => setEditingId(row.id)} />
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── edit modal ── */}
      {editingRow && (
        <div onClick={() => setEditingId(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', background: 'white', borderRadius: 14 }}>
            <div style={{ padding: '22px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="font-serif" style={{ fontSize: 22, fontWeight: 600, color: T.text }}>
                  {clientsById[editingRow.client_id] || 'Unknown client'}
                </div>
                <div style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>
                  {TYPE_LABEL[editingRow.request_type]}{editingRow.policy_label ? ` · ${editingRow.policy_label}` : ''} · opened {new Date(editingRow.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                </div>
              </div>
              <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
            </div>

            <div style={{ padding: '18px 24px 24px' }}>
              <SectionLabel>Status</SectionLabel>
              <div style={{ display: 'flex', gap: 7 }}>
                {COLUMNS.map(col => (
                  <button key={col.id} onClick={() => moveTo(editingRow.id, col.id)}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 9, fontSize: 12, fontWeight: 700, textAlign: 'center', cursor: 'pointer',
                      border: `1.5px solid ${editingRow.status === col.id ? 'var(--charcoal)' : T.line}`,
                      background: editingRow.status === col.id ? 'var(--charcoal)' : 'white',
                      color: editingRow.status === col.id ? 'white' : T.textDim,
                    }}>
                    {col.title}
                  </button>
                ))}
              </div>

              <SectionLabel>Waiting on</SectionLabel>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                <WaitingButton active={editingRow.waiting_on === null} onClick={() => patchRow(editingRow.id, { waiting_on: null })}>Not applicable</WaitingButton>
                <WaitingButton active={editingRow.waiting_on === 'client'} kind="client" onClick={() => patchRow(editingRow.id, { waiting_on: 'client' })}>Client</WaitingButton>
                <WaitingButton active={editingRow.waiting_on === 'firm'} kind="firm" onClick={() => patchRow(editingRow.id, { waiting_on: 'firm' })}>Insurer / fund house</WaitingButton>
              </div>

              <SectionLabel>Request details</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <FieldLabel>Type</FieldLabel>
                  <select value={editingRow.request_type} onChange={e => patchRow(editingRow.id, { request_type: e.target.value as RequestType })}
                    style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
                    {(Object.keys(TYPE_LABEL) as RequestType[]).map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                <div>
                  <FieldLabel>Policy (optional)</FieldLabel>
                  <input defaultValue={editingRow.policy_label || ''} onBlur={e => patchRow(editingRow.id, { policy_label: e.target.value.trim() || null })}
                    placeholder="e.g. Prudential PRUlife"
                    style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <FieldLabel>Description</FieldLabel>
                  <textarea defaultValue={editingRow.description} onBlur={e => patchRow(editingRow.id, { description: e.target.value.trim() })}
                    rows={2}
                    style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5, resize: 'vertical', fontFamily: 'inherit' }} />
                </div>
              </div>

              <SectionLabel>To-dos</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {modalTodos.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>No to-dos yet.</div>}
                {modalTodos.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={t.done} onChange={e => toggleTodo(t.id, e.target.checked)} />
                    <div style={{ flex: 1, fontSize: 12.5, color: t.done ? T.textFaint : T.text, textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</div>
                    <button onClick={() => deleteTodo(t.id)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={todoDraft} onChange={e => setTodoDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTodo() }}
                  placeholder="Add a to-do…"
                  style={{ flex: 1, padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                <button onClick={addTodo} style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: 'pointer' }}>Add</button>
              </div>

              <div style={{ height: 1, background: T.line, margin: '20px 0 14px' }} />
              <button onClick={() => deleteRequest(editingRow.id)}
                style={{ fontSize: 12, fontWeight: 700, color: T.rose, background: T.roseSoft, border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>
                Delete request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── SUBCOMPONENTS ──────────────────────────────────────────────────────────

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${active ? 'var(--charcoal)' : T.line}`,
      background: active ? 'var(--charcoal)' : 'white',
      color: active ? 'white' : T.textDim,
    }}>
      {children}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint, margin: '18px 0 9px' }}>{children}</div>
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 600, color: T.textDim, marginBottom: 5, display: 'block' }}>{children}</span>
}

function WaitingButton({ active, kind, onClick, children }: { active: boolean; kind?: 'client' | 'firm'; onClick: () => void; children: React.ReactNode }) {
  const activeColor = kind === 'client' ? T.rose : kind === 'firm' ? T.goldText : T.text
  const activeBg = kind === 'client' ? T.roseSoft : kind === 'firm' ? T.goldSoft : 'var(--cream2)'
  return (
    <button onClick={onClick} style={{
      padding: '7px 13px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
      border: `1.5px solid ${active ? activeColor : T.line}`,
      background: active ? activeBg : 'white',
      color: active ? activeColor : T.textDim,
    }}>
      {children}
    </button>
  )
}

function DropZone({ id, children }: { id: Status; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} style={{
      display: 'flex', flexDirection: 'column', gap: 8, minHeight: 80, borderRadius: 12, padding: 10,
      background: isOver ? 'var(--gold-l)' : 'var(--cream2)',
      border: isOver ? '1.5px dashed var(--gold)' : '1.5px dashed transparent',
    }}>
      {children}
    </div>
  )
}

function RequestCard({ row, clientName, dragging, onClick }: {
  row: ServiceRequestRow; clientName: string; dragging: boolean; onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id })
  const days = daysSince(row.created_at)
  const color = TYPE_COLOR[row.request_type]
  const waitingLabel = row.waiting_on === 'client' ? 'Waiting on client' : row.waiting_on === 'firm' ? 'Waiting on insurer' : null

  return (
    <button ref={setNodeRef} {...listeners} {...attributes} onClick={onClick} style={{
      textAlign: 'left', width: '100%', cursor: 'grab', touchAction: 'none',
      background: 'white', border: `1px solid ${T.line}`, borderRadius: 10, padding: 12,
      opacity: dragging || isDragging ? 0.4 : 1,
      transform: transform ? CSS.Translate.toString(transform) : undefined,
      zIndex: isDragging ? 10 : undefined, position: isDragging ? 'relative' : undefined,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <span className="font-serif" style={{ fontSize: 16.5, fontWeight: 600, color: T.text, lineHeight: 1.15 }}>{clientName}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2.5px 8px', borderRadius: 5, background: color.bg, color: color.fg, whiteSpace: 'nowrap' }}>
          {TYPE_LABEL[row.request_type]}
        </span>
      </div>
      <div style={{ fontSize: 12, color: T.textDim, margin: '5px 0 8px', lineHeight: 1.4 }}>{row.description}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, color: T.textFaint }}>
        {waitingLabel ? (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
            background: row.waiting_on === 'client' ? T.roseSoft : T.goldSoft,
            color: row.waiting_on === 'client' ? T.rose : T.goldText,
          }}>{waitingLabel}</span>
        ) : <span />}
        <span className="font-mono">
          {row.status === 'done' ? `Completed ${daysSince(row.resolved_at) ?? 0}d ago` : days !== null ? `${days}d old` : ''}
        </span>
      </div>
    </button>
  )
}