'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import GmailClaimSearch from '@/components/GmailClaimSearch'
import ServiceRequestExtras from '@/components/ServiceRequestExtras'
import { needsFollowupRequests } from '@/lib/serviceRequestsAttention'
import { useDriveUpload } from '@/lib/useDriveUpload'
import { logServiceResolution } from '@/lib/policyServiceHistory'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Client Servicing's per-client view over service_requests — sits alongside
// Contact Report, scoped to whichever client is active in the sidebar
// (same activeClient pattern as Contact Report, not its own selector).
// Editing happens in the same shape of modal as the firm-wide Board
// (src/app/dashboard/business/service-requests/page.tsx), including the new
// Attachments/Meetings/Activity log block — but this page has no Kanban,
// no drag-and-drop, and no cross-client type management; it's a browsing +
// editing surface for one client at a time. The Board remains the place for
// firm-wide triage across clients.

type RequestType = string
type Status = 'requested' | 'in_progress' | 'done'
type WaitingOn = 'client' | 'firm' | null
type FieldKind = 'text' | 'number' | 'date'

interface FieldDef { key: string; label: string; kind: FieldKind }
interface TypeRow { id: string; label: string; fields: FieldDef[]; created_at: string }
interface PolicyLite { id: string; policyNo: string; companyName: string; productName: string; person: string }

interface ServiceRequestRow {
  id: string
  client_id: string
  request_type: RequestType
  description: string
  policy_label: string | null
  policy_id: string | null
  field_values: Record<string, string>
  status: Status
  waiting_on: WaitingOn
  created_by: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

interface TodoRow { id: string; service_request_id: string; text: string; done: boolean; due_date: string | null; created_at: string }

const STATUS_LABEL: Record<Status, string> = { requested: 'Requested', in_progress: 'In progress', done: 'Done' }

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', rose: 'var(--rouge)', roseSoft: 'var(--rouge-l)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)',
}

function dueLabel(dueDate: string | null): { text: string; kind: 'overdue' | 'today' | 'upcoming' | 'none' } {
  if (!dueDate) return { text: '', kind: 'none' }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate + 'T00:00:00')
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, kind: 'overdue' }
  if (diffDays === 0) return { text: 'Due today', kind: 'today' }
  return { text: due.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }), kind: 'upcoming' }
}

const ADD_NEW_SENTINEL = '__add_new__'

export default function ServiceRequestsServicingPage() {
  const { activeClient, advisor, authLoading, clients } = useDashboard()
  const router = useRouter()
  const supabase = createClient()
  const drive = useDriveUpload()
  const toast = useToast()
  const confirmAction = useConfirm()

  const hasAccess = advisor?.id === CREATOR_ID || (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing'))

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ServiceRequestRow[]>([])
  const [openTodos, setOpenTodos] = useState<TodoRow[]>([]) // this client's open to-dos only — enough to drive the same needsFollowupRequests check the Board uses, no firm-wide fetch needed here
  const [typeDefs, setTypeDefs] = useState<TypeRow[]>([])
  const [policies, setPolicies] = useState<PolicyLite[]>([])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalTodos, setModalTodos] = useState<TodoRow[]>([])
  const [todoDraft, setTodoDraft] = useState('')
  const [todoDueDraft, setTodoDueDraft] = useState('')

  const [showNew, setShowNew] = useState(false)
  const [newType, setNewType] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [savingNew, setSavingNew] = useState(false)

  // Same clients.service_requests_drive_folder_link ServiceRequestExtras
  // reads inside a request's modal — surfaced here too so the folder is
  // visible and manageable from the list itself, not only discoverable by
  // opening a request and trying to upload something.
  const [driveFolder, setDriveFolder] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
  }, [authLoading, advisor, hasAccess, router])

  useEffect(() => {
    if (authLoading || !hasAccess || !activeClient) { setLoading(false); return }
    let cancelled = false
    async function load() {
      setLoading(true)
      const [reqRes, typesRes, ffRes, clientRes] = await Promise.all([
        supabase.from('service_requests').select('*').eq('client_id', activeClient!.id).order('created_at', { ascending: false }),
        supabase.from('service_request_types').select('*').order('created_at', { ascending: true }),
        supabase.from('fact_finding').select('data').eq('client_id', activeClient!.id).eq('section', 'protection_portfolio').maybeSingle(),
        supabase.from('clients').select('service_requests_drive_folder_link').eq('id', activeClient!.id).maybeSingle(),
      ])
      if (cancelled) return
      const rowsData = ((reqRes.data || []) as any[]).map(r => ({ ...r, field_values: r.field_values || {} })) as ServiceRequestRow[]
      setRows(rowsData)
      const reqIds = rowsData.map(r => r.id)
      if (reqIds.length > 0) {
        const todosRes = await supabase.from('service_request_todos').select('*').in('service_request_id', reqIds).eq('done', false)
        if (!cancelled) setOpenTodos((todosRes.data || []) as TodoRow[])
      } else {
        setOpenTodos([])
      }
      setTypeDefs(((typesRes.data || []) as any[]).map(t => ({ ...t, fields: t.fields || [] })) as TypeRow[])
      const list: PolicyLite[] = ((ffRes.data as any)?.data?.risk_management?.policies || []).map((p: any) => ({
        id: p.id, policyNo: p.policyNo || '', companyName: p.companyName || '', productName: p.productName || '', person: p.person || '',
      }))
      setPolicies(list)
      const rawFolder = (clientRes.data as any)?.service_requests_drive_folder_link as string | undefined
      if (rawFolder) { try { const parsed = JSON.parse(rawFolder); setDriveFolder(parsed?.id && parsed?.name ? parsed : null) } catch { setDriveFolder(null) } }
      else setDriveFolder(null)
      if (!newType && ((typesRes.data || []) as any[]).length > 0) setNewType((typesRes.data as any[])[0].label)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, hasAccess, activeClient?.id])

  async function connectDrive() {
    if (!activeClient) return
    const folder = await drive.connectDriveFolder({ table: 'clients', idColumn: 'id', id: activeClient.id }, 'service_requests_drive_folder_link')
    if (folder) setDriveFolder(folder)
  }

  const staleIds = useMemo(() => new Set(needsFollowupRequests(rows, openTodos).map(r => r.id)), [rows, openTodos])
  const typeOptions = useMemo(() => typeDefs.map(t => t.label), [typeDefs])
  const editingRow = editingId ? rows.find(r => r.id === editingId) || null : null
  const editingFields = editingRow ? (typeDefs.find(t => t.label === editingRow.request_type)?.fields || []) : []
  const editingPolicy = useMemo(() => {
    if (!editingRow) return null
    if (editingRow.policy_id) {
      const p = policies.find(pp => pp.id === editingRow.policy_id)
      return p ? { label: `${p.companyName} — ${p.productName}${p.policyNo ? ` (${p.policyNo})` : ''}`, policyNo: p.policyNo } : { label: 'Loading policy…', policyNo: '' }
    }
    if (editingRow.policy_label) return { label: editingRow.policy_label, policyNo: '' }
    return null
  }, [editingRow, policies])

  useEffect(() => {
    if (!editingId) { setModalTodos([]); return }
    let cancelled = false
    supabase.from('service_request_todos').select('*').eq('service_request_id', editingId).order('created_at', { ascending: true })
      .then(({ data }: any) => { if (!cancelled) setModalTodos((data || []) as TodoRow[]) })
    return () => { cancelled = true }
  }, [editingId])

  async function addNewType(label: string): Promise<string | null> {
    const trimmed = label.trim()
    if (!trimmed) return null
    const existing = typeDefs.find(t => t.label.toLowerCase() === trimmed.toLowerCase())
    if (existing) return existing.label
    const { data, error } = await supabase.from('service_request_types').insert({ label: trimmed, fields: [] }).select().maybeSingle()
    if (error || !data) { toast('Could not add type: ' + (error?.message || 'unknown error'), 'error'); return null }
    setTypeDefs(prev => [...prev, { ...(data as any), fields: [] }])
    return trimmed
  }

  async function patchRow(id: string, patch: Partial<ServiceRequestRow>) {
    const withTimestamp = { ...patch, updated_at: new Date().toISOString() }
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...withTimestamp } : r))
    const { error } = await supabase.from('service_requests').update(withTimestamp).eq('id', id)
    if (error) toast('Save failed: ' + error.message, 'error')
  }

  function setFieldValue(row: ServiceRequestRow, key: string, value: string) {
    patchRow(row.id, { field_values: { ...row.field_values, [key]: value } })
  }

  async function moveTo(id: string, status: Status) {
    const patch: Partial<ServiceRequestRow> = { status }
    patch.resolved_at = status === 'done' ? new Date().toISOString() : null
    await patchRow(id, patch)
    // Log to the linked policy's Servicing History — no-ops if this request
    // isn't linked to a policy. Un-resolving (status !== 'done') doesn't
    // remove the history entry; the entry records that a resolution
    // happened, which stays true even if the request is later reopened.
    if (status === 'done') {
      const row = rows.find(r => r.id === id)
      if (row) {
        await logServiceResolution(supabase, {
          id: row.id, client_id: row.client_id, policy_id: row.policy_id,
          policy_label: row.policy_label, request_type: row.request_type, description: row.description,
        })
      }
    }
  }

  async function addTodo() {
    if (!editingId || !todoDraft.trim()) return
    const { data, error } = await supabase.from('service_request_todos')
      .insert({ service_request_id: editingId, text: todoDraft.trim(), due_date: todoDueDraft || null })
      .select().maybeSingle()
    if (error) { toast('Could not add to-do: ' + error.message, 'error'); return }
    if (data) { setModalTodos(prev => [...prev, data as TodoRow]); setOpenTodos(prev => [...prev, data as TodoRow]) }
    setTodoDraft(''); setTodoDueDraft('')
  }
  async function toggleTodo(id: string, done: boolean) {
    setModalTodos(prev => prev.map(t => t.id === id ? { ...t, done } : t))
    setOpenTodos(prev => done ? prev.filter(t => t.id !== id) : prev)
    const { error } = await supabase.from('service_request_todos').update({ done }).eq('id', id)
    if (error) toast('Save failed: ' + error.message, 'error')
  }
  async function deleteTodo(id: string) {
    setModalTodos(prev => prev.filter(t => t.id !== id))
    setOpenTodos(prev => prev.filter(t => t.id !== id))
    const { error } = await supabase.from('service_request_todos').delete().eq('id', id)
    if (error) toast('Delete failed: ' + error.message, 'error')
  }
  function setTodoDueDate(id: string, date: string) {
    setModalTodos(prev => prev.map(t => t.id === id ? { ...t, due_date: date || null } : t))
    setOpenTodos(prev => prev.map(t => t.id === id ? { ...t, due_date: date || null } : t))
    supabase.from('service_request_todos').update({ due_date: date || null }).eq('id', id).then(({ error }: any) => { if (error) toast('Save failed: ' + error.message, 'error') })
  }

  async function createRequest() {
    if (!activeClient || !newType || !newDesc.trim()) return
    setSavingNew(true)
    const { data, error } = await supabase.from('service_requests').insert({
      client_id: activeClient.id, request_type: newType, description: newDesc.trim(),
      status: 'requested', field_values: {},
    }).select().maybeSingle()
    setSavingNew(false)
    if (error) { toast('Could not create request: ' + error.message, 'error'); return }
    if (data) { setRows(prev => [{ ...(data as any), field_values: {} }, ...prev]); setNewDesc(''); setShowNew(false); setEditingId((data as any).id) }
  }

  async function deleteRequest(id: string) {
    if (!await confirmAction('Delete this service request? This cannot be undone.', { danger: true, confirmLabel: 'Delete' })) return
    setRows(prev => prev.filter(r => r.id !== id))
    setEditingId(null)
    const { error } = await supabase.from('service_requests').delete().eq('id', id)
    if (error) toast('Delete failed: ' + error.message, 'error')
  }

  if (authLoading || loading) {
    return <div style={{ padding: 32, fontSize: 13, color: T.textFaint }}>Loading…</div>
  }
  if (!activeClient) {
    return <div style={{ padding: 32, fontSize: 13, color: T.textFaint }}>Select a client from the sidebar to view their service requests.</div>
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 720 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div className="font-serif" style={{ fontSize: 24, fontWeight: 600, color: T.text }}>Service requests</div>
          <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 2 }}>{activeClient.name}</div>
        </div>
        <button onClick={() => setShowNew(true)}
          style={{ padding: '8px 16px', fontSize: 12.5, fontWeight: 700, color: 'white', background: 'var(--charcoal)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          + New request
        </button>
      </div>

      {/* ── Drive folder for this client's service requests ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        <span style={{ fontSize: 11, color: T.textFaint }}>
          {driveFolder ? <>📁 Attachments save to <strong style={{ color: T.textDim }}>{driveFolder.name}</strong></> : 'No folder linked yet for this client\'s service requests'}
        </span>
        <button onClick={connectDrive} disabled={drive.connecting}
          style={{ fontSize: 11, color: T.gold, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
          {drive.connecting ? 'Connecting…' : driveFolder ? 'Change' : 'Connect folder'}
        </button>
      </div>
      {drive.uploadError && <div style={{ fontSize: 11.5, color: T.rose, marginBottom: 12 }}>{drive.uploadError}</div>}

      {showNew && (
        <div style={{ background: 'var(--cream2)', borderRadius: 10, padding: 14, marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select value={newType} onChange={e => setNewType(e.target.value)}
            style={{ padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }}>
            {typeOptions.length === 0 && <option value="">No types yet — add one from the Business Dashboard board</option>}
            {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2} placeholder="What's the request?"
            style={{ padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5, resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowNew(false)} style={{ fontSize: 12, color: T.textDim, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px' }}>Cancel</button>
            <button onClick={createRequest} disabled={savingNew || !newType || !newDesc.trim()}
              style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: 'pointer', opacity: savingNew || !newType || !newDesc.trim() ? 0.6 : 1 }}>
              {savingNew ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: T.textFaint, fontStyle: 'italic' }}>No service requests for this client yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => (
            <button key={r.id} onClick={() => setEditingId(r.id)}
              style={{ textAlign: 'left', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'white', border: `1px solid ${T.line}`, borderRadius: 10, cursor: 'pointer' }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: T.text }}>{r.request_type}</div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{r.description}</div>
                <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>
                  Opened {new Date(r.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                  {r.status === 'done' && r.resolved_at && ` · Resolved ${new Date(r.resolved_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {staleIds.has(r.id) && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: T.rose, background: T.roseSoft, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>
                    Needs follow-up
                  </span>
                )}
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, whiteSpace: 'nowrap',
                  background: r.status === 'done' ? 'rgba(45,90,78,.12)' : r.status === 'in_progress' ? T.goldSoft : 'var(--cream2)',
                  color: r.status === 'done' ? T.emerald : r.status === 'in_progress' ? T.goldText : T.textDim,
                }}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── edit modal — same shape as the firm-wide Board's ── */}
      {editingRow && (
        <div onClick={() => setEditingId(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto', background: 'white', borderRadius: 14 }}>
            <div style={{ padding: '22px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="font-serif" style={{ fontSize: 22, fontWeight: 600, color: T.text }}>{activeClient.name}</div>
                <div style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>
                  {editingRow.request_type}{editingPolicy ? ` · ${editingPolicy.label}` : ''} · opened {new Date(editingRow.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                </div>
              </div>
              <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
            </div>

            <div style={{ padding: '18px 24px 24px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint, margin: '0 0 9px' }}>Status</div>
              <div style={{ display: 'flex', gap: 7 }}>
                {(['requested', 'in_progress', 'done'] as Status[]).map(s => (
                  <button key={s} onClick={() => moveTo(editingRow.id, s)}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 9, fontSize: 12, fontWeight: 700, textAlign: 'center', cursor: 'pointer',
                      border: `1.5px solid ${editingRow.status === s ? 'var(--charcoal)' : T.line}`,
                      background: editingRow.status === s ? 'var(--charcoal)' : 'white',
                      color: editingRow.status === s ? 'white' : T.textDim,
                    }}>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint, margin: '18px 0 9px' }}>Waiting on</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {[{ v: null, label: 'Not applicable' }, { v: 'client', label: 'Client' }, { v: 'firm', label: 'Insurer / fund house' }].map(opt => {
                  const active = editingRow.waiting_on === opt.v
                  const activeColor = opt.v === 'client' ? T.rose : opt.v === 'firm' ? T.goldText : T.text
                  const activeBg = opt.v === 'client' ? T.roseSoft : opt.v === 'firm' ? T.goldSoft : 'var(--cream2)'
                  return (
                    <button key={String(opt.v)} onClick={() => patchRow(editingRow.id, { waiting_on: opt.v as WaitingOn })}
                      style={{ padding: '7px 13px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${active ? activeColor : T.line}`, background: active ? activeBg : 'white', color: active ? activeColor : T.textDim }}>
                      {opt.label}
                    </button>
                  )
                })}
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint, margin: '18px 0 9px' }}>Request details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.textDim, marginBottom: 5, display: 'block' }}>Type</span>
                  <select value={editingRow.request_type}
                    onChange={e => { if (e.target.value === ADD_NEW_SENTINEL) { const label = window.prompt('New type name'); if (label) addNewType(label).then(l => { if (l) patchRow(editingRow.id, { request_type: l }) }) } else patchRow(editingRow.id, { request_type: e.target.value }) }}
                    style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
                    {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                    <option value={ADD_NEW_SENTINEL}>+ Add new type…</option>
                  </select>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.textDim, marginBottom: 5, display: 'block' }}>Description</span>
                  <textarea defaultValue={editingRow.description} onBlur={e => patchRow(editingRow.id, { description: e.target.value.trim() })}
                    rows={2} style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5, resize: 'vertical', fontFamily: 'inherit' }} />
                </div>
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint, margin: '18px 0 9px' }}>Policy</div>
              <div style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
                <button onClick={() => patchRow(editingRow.id, { policy_label: null })}
                  style={{ padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${editingRow.policy_id || !editingRow.policy_label ? 'var(--charcoal)' : T.line}`, background: editingRow.policy_id || !editingRow.policy_label ? 'var(--charcoal)' : 'white', color: editingRow.policy_id || !editingRow.policy_label ? 'white' : T.textDim }}>
                  Existing policy
                </button>
                <button onClick={() => patchRow(editingRow.id, { policy_id: null, policy_label: '' })}
                  style={{ padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${!editingRow.policy_id && editingRow.policy_label !== null ? 'var(--charcoal)' : T.line}`, background: !editingRow.policy_id && editingRow.policy_label !== null ? 'var(--charcoal)' : 'white', color: !editingRow.policy_id && editingRow.policy_label !== null ? 'white' : T.textDim }}>
                  Not on file yet
                </button>
              </div>
              {!editingRow.policy_id && editingRow.policy_label === null ? (
                <select value={editingRow.policy_id || ''} onChange={e => patchRow(editingRow.id, { policy_id: e.target.value || null })}
                  style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
                  <option value="">Select a policy…</option>
                  {policies.map(p => <option key={p.id} value={p.id}>{p.companyName} — {p.productName}{p.policyNo ? ` (${p.policyNo})` : ''}</option>)}
                </select>
              ) : editingRow.policy_id ? (
                <select value={editingRow.policy_id} onChange={e => patchRow(editingRow.id, { policy_id: e.target.value || null })}
                  style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
                  {policies.map(p => <option key={p.id} value={p.id}>{p.companyName} — {p.productName}{p.policyNo ? ` (${p.policyNo})` : ''}</option>)}
                </select>
              ) : (
                <input defaultValue={editingRow.policy_label || ''} onBlur={e => patchRow(editingRow.id, { policy_label: e.target.value.trim() || '' })}
                  placeholder="e.g. new application with XYZ Insurance"
                  style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
              )}

              {editingFields.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint, margin: '18px 0 9px' }}>Additional details — {editingRow.request_type}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {editingFields.map(f => (
                      <div key={f.key}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: T.textDim, marginBottom: 5, display: 'block' }}>{f.label}</span>
                        <input type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}
                          defaultValue={editingRow.field_values?.[f.key] || ''} onBlur={e => setFieldValue(editingRow, f.key, e.target.value)}
                          style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint, margin: '18px 0 9px' }}>To-dos</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {modalTodos.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>No to-dos yet.</div>}
                {modalTodos.map(t => {
                  const due = dueLabel(t.due_date)
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={t.done} onChange={e => toggleTodo(t.id, e.target.checked)} />
                      <div style={{ flex: 1, fontSize: 12.5, color: t.done ? T.textFaint : T.text, textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</div>
                      {!t.done && due.kind !== 'none' && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: due.kind === 'overdue' ? T.roseSoft : due.kind === 'today' ? T.goldSoft : 'var(--cream2)', color: due.kind === 'overdue' ? T.rose : due.kind === 'today' ? T.goldText : T.textFaint, whiteSpace: 'nowrap' }}>
                          {due.text}
                        </span>
                      )}
                      <input type="date" value={t.due_date || ''} onChange={e => setTodoDueDate(t.id, e.target.value)}
                        style={{ fontSize: 10.5, padding: '2px 4px', border: `1px solid ${T.line}`, borderRadius: 5, background: 'white', color: T.textFaint, width: 108 }} />
                      <button onClick={() => deleteTodo(t.id)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={todoDraft} onChange={e => setTodoDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTodo() }}
                  placeholder="Add a to-do…" style={{ flex: 1, padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                <input type="date" value={todoDueDraft} onChange={e => setTodoDueDraft(e.target.value)}
                  style={{ padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5, width: 130 }} />
                <button onClick={addTodo} style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: 'pointer' }}>Add</button>
              </div>

              <div style={{ marginTop: 16, borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
                <ServiceRequestExtras serviceRequestId={editingRow.id} clientId={editingRow.client_id} advisorId={advisor?.id || ''} />
              </div>

              <div style={{ marginTop: 16, borderTop: `1px solid ${T.line}`, paddingTop: 10 }}>
                <GmailClaimSearch serviceRequestId={editingRow.id} defaultTerms={[editingPolicy?.policyNo].filter((v): v is string => !!v)} />
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