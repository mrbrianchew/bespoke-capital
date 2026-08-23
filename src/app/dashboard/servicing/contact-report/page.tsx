'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import DateInput from '@/components/DateInput'
import { useConfirm } from '@/components/ConfirmDialog'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// ─── TYPES ──────────────────────────────────────────────────────────────────
//
// This page merges two sources into one timeline:
//  - `contact_reports` — manual entries, typed in here directly. Fully
//    editable, has an Open/Resolved status.
//  - `client_activity` — auto-logged entries, written by other parts of the
//    app the moment something already happens (a Service Request meeting,
//    a New Business meeting, a claim reaching Approved/Rejected). Not
//    editable here — editing goes back to the source screen — but takes the
//    same running Updates/To-Do list as manual entries, via
//    client_activity_id on contact_report_todos/contact_report_comments.
//
// See src/lib/logClientActivity.ts for the write side.

type ContactType = 'f2f' | 'non_f2f' | 'phone' | 'service_update' | 'other'
type ContactStatus = 'open' | 'resolved'

interface ContactReportRow {
  id: string
  client_id: string
  advisor_id: string
  contact_type: ContactType
  contact_type_other: string | null
  venue: string | null
  platform: string | null
  platform_other: string | null
  contact_date: string
  notes: string | null
  status: ContactStatus
  created_at: string
  updated_at: string
}

type ActivityType =
  | 'meeting_f2f' | 'meeting_video' | 'meeting_phone'
  | 'claim_status' | 'policy_milestone' | 'todo' | 'other'

interface ClientActivityRow {
  id: string
  client_id: string
  advisor_id: string
  activity_type: ActivityType
  source_type: 'auto' | 'manual'
  source_table: string | null
  source_id: string | null
  title: string
  description: string | null
  activity_date: string
  created_at: string
  updated_at: string
}

// contact_report_id and client_activity_id are mutually exclusive on both of
// these — exactly one is set per row (enforced by a DB check constraint).
interface ContactTodoRow {
  id: string
  contact_report_id: string | null
  client_activity_id: string | null
  text: string
  done: boolean
  sort_order: number
  created_at: string
}
interface ContactCommentRow {
  id: string
  contact_report_id: string | null
  client_activity_id: string | null
  comment_date: string
  text: string
  created_at: string
}

// Unified shape the timeline actually renders — one of these per manual
// entry and one per auto entry, sorted together by date.
type EntryKind = 'manual' | 'auto'
interface TimelineEntry {
  id: string
  kind: EntryKind
  date: string
  createdAt: string
  title: string
  tag: string
  secondaryTag: string | null
  status: ContactStatus | null
  filterGroup: FilterGroup
  manual: ContactReportRow | null
  auto: ClientActivityRow | null
}

type FilterGroup = 'f2f' | 'call' | 'non_f2f' | 'service' | 'other'
const FILTER_LABEL: Record<'all' | FilterGroup, string> = {
  all: 'All', f2f: 'F2F', call: 'Call', non_f2f: 'Non-F2F', service: 'Service', other: 'Other',
}

const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  f2f: 'F2F Meeting', non_f2f: 'Non-F2F', phone: 'Phone Call', service_update: 'Service Update', other: 'Other',
}
const CONTACT_TYPE_ICON: Record<ContactType, string> = {
  f2f: '🤝', non_f2f: '💻', phone: '📞', service_update: '🔧', other: '✉️',
}
const CONTACT_TYPE_GROUP: Record<ContactType, FilterGroup> = {
  f2f: 'f2f', non_f2f: 'non_f2f', phone: 'call', service_update: 'service', other: 'other',
}
const PLATFORM_OPTIONS = ['Zoom', 'Google Meet', 'Microsoft Teams', 'WhatsApp Video', 'Skype', 'Other']

const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  meeting_f2f: 'F2F Meeting', meeting_video: 'Video Meeting', meeting_phone: 'Phone Call',
  claim_status: 'Claim Update', policy_milestone: 'Policy Update', todo: 'Task', other: 'Activity',
}
const ACTIVITY_TYPE_ICON: Record<ActivityType, string> = {
  meeting_f2f: '🤝', meeting_video: '💻', meeting_phone: '📞',
  claim_status: '🔧', policy_milestone: '🔧', todo: '✓', other: '✉️',
}
const ACTIVITY_TYPE_GROUP: Record<ActivityType, FilterGroup> = {
  meeting_f2f: 'f2f', meeting_video: 'non_f2f', meeting_phone: 'call',
  claim_status: 'service', policy_milestone: 'service', todo: 'other', other: 'other',
}

// Where an auto entry's "Open source" link points — same client, different
// tab. None of these pages support deep-linking to one specific row yet, so
// this opens the tab, not the exact record.
const SOURCE_LINK: Record<string, { label: string; href: string }> = {
  service_request_meetings: { label: 'Open in Service Requests', href: '/dashboard/servicing/service-requests' },
  new_business_case_meetings: { label: 'Open in New Business', href: '/dashboard/servicing/new-business' },
  claim_line_items: { label: 'Open in Claims', href: '/dashboard/servicing/claims' },
}

// Auto entries whose Details can be edited right here in Contact Report.
// Both meeting tables have a real `notes` column to write back to, so an
// edit here also updates the source meeting — not just the notebook copy.
// claim_line_items' description is a generated status message, not a note
// the advisor typed, so it stays "edit at the source" only.
const EDITABLE_AUTO_DETAILS_SOURCES = new Set(['new_business_case_meetings', 'service_request_meetings'])

// Dot color per filter group — the whole point is to make the type
// recognizable at a glance down the page without reading every tag.
const DOT_COLOR: Record<FilterGroup, string> = {
  f2f: 'var(--emerald)', call: 'var(--gold)', non_f2f: 'var(--ink2)',
  service: 'var(--rouge)', other: 'var(--ink3)',
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtShortDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-SG', { day: '2-digit', month: 'short' })
}
function contactTag(r: ContactReportRow): string {
  const icon = CONTACT_TYPE_ICON[r.contact_type]
  if (r.contact_type === 'other') return `${icon} ${r.contact_type_other || 'Other'}`
  return `${icon} ${CONTACT_TYPE_LABEL[r.contact_type]}`
}
function secondaryTag(r: ContactReportRow): string | null {
  if (r.contact_type === 'f2f' && r.venue) return r.venue
  if (r.contact_type === 'non_f2f') {
    if (r.platform === 'Other') return r.platform_other || 'Other platform'
    return r.platform || null
  }
  return null
}

function toEntry(r: ContactReportRow): TimelineEntry {
  return {
    id: r.id, kind: 'manual', date: r.contact_date, createdAt: r.created_at,
    title: r.notes ? r.notes.split('\n')[0].slice(0, 80) : `${CONTACT_TYPE_LABEL[r.contact_type]} logged`,
    tag: contactTag(r), secondaryTag: secondaryTag(r), status: r.status,
    filterGroup: CONTACT_TYPE_GROUP[r.contact_type], manual: r, auto: null,
  }
}
function toEntryAuto(a: ClientActivityRow): TimelineEntry {
  return {
    id: a.id, kind: 'auto', date: a.activity_date, createdAt: a.created_at,
    title: a.title,
    tag: `${ACTIVITY_TYPE_ICON[a.activity_type]} ${ACTIVITY_TYPE_LABEL[a.activity_type]}`,
    secondaryTag: null, status: null,
    filterGroup: ACTIVITY_TYPE_GROUP[a.activity_type], manual: null, auto: a,
  }
}
function sortEntries(list: TimelineEntry[]) {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.createdAt < b.createdAt ? 1 : -1
  })
}

// ─── PAGE ───────────────────────────────────────────────────────────────────

export default function ContactReportPage() {
  const { activeClient, advisor, authLoading } = useDashboard()
  const router = useRouter()
  const supabase = createClient()
  const confirmAction = useConfirm()

  const hasAccess = advisor?.id === CREATOR_ID || (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing'))

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [todosByEntry, setTodosByEntry] = useState<Record<string, ContactTodoRow[]>>({})
  const [commentsByEntry, setCommentsByEntry] = useState<Record<string, ContactCommentRow[]>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<'all' | FilterGroup>('all')
  const [newTodoDraft, setNewTodoDraft] = useState<Record<string, string>>({})
  const [newCommentDraft, setNewCommentDraft] = useState<Record<string, string>>({})
  const [newCommentDate, setNewCommentDate] = useState<Record<string, string>>({})
  const [editingAutoDetailsId, setEditingAutoDetailsId] = useState<string | null>(null)
  const [autoDetailsDraft, setAutoDetailsDraft] = useState('')
  const [savingAutoDetails, setSavingAutoDetails] = useState(false)

  // ── Form state (manual entries only — auto entries have no form) ──
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fType, setFType] = useState<ContactType | null>(null)
  const [fTypeOther, setFTypeOther] = useState('')
  const [fVenue, setFVenue] = useState('')
  const [fPlatform, setFPlatform] = useState(PLATFORM_OPTIONS[0])
  const [fPlatformOther, setFPlatformOther] = useState('')
  const [fDate, setFDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [fNotes, setFNotes] = useState('')
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
  }, [authLoading, advisor, hasAccess, router])

  // ── Load manual + auto entries for the active client, merge, then load
  //    their shared todos/comments in one pass keyed by entry id. ──
  useEffect(() => {
    if (authLoading || !activeClient) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [{ data: reportRows, error: reportErr }, { data: activityRows, error: activityErr }] = await Promise.all([
        supabase.from('contact_reports').select('*').eq('client_id', activeClient.id)
          .order('contact_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('client_activity').select('*').eq('client_id', activeClient.id)
          .order('activity_date', { ascending: false }).order('created_at', { ascending: false }),
      ])
      if (cancelled) return
      if (reportErr) console.error('[contact-report] load manual entries failed:', reportErr)
      if (activityErr) console.error('[contact-report] load auto entries failed:', activityErr)

      const manualRows = (reportRows || []) as ContactReportRow[]
      const autoRows = (activityRows || []) as ClientActivityRow[]
      const merged = sortEntries([...manualRows.map(toEntry), ...autoRows.map(toEntryAuto)])
      setEntries(merged)

      if (merged.length > 0) {
        const manualIds = manualRows.map(r => r.id)
        const autoIds = autoRows.map(a => a.id)
        const [{ data: todoRows, error: todoErr }, { data: commentRows, error: commentErr }] = await Promise.all([
          supabase.from('contact_report_todos').select('*')
            .or([
              manualIds.length ? `contact_report_id.in.(${manualIds.join(',')})` : '',
              autoIds.length ? `client_activity_id.in.(${autoIds.join(',')})` : '',
            ].filter(Boolean).join(','))
            .order('sort_order', { ascending: true }),
          supabase.from('contact_report_comments').select('*')
            .or([
              manualIds.length ? `contact_report_id.in.(${manualIds.join(',')})` : '',
              autoIds.length ? `client_activity_id.in.(${autoIds.join(',')})` : '',
            ].filter(Boolean).join(','))
            .order('comment_date', { ascending: false }).order('created_at', { ascending: false }),
        ])
        if (cancelled) return
        if (todoErr) {
          console.error('[contact-report] load todos failed:', todoErr)
        } else {
          const grouped: Record<string, ContactTodoRow[]> = {}
          for (const t of (todoRows || []) as ContactTodoRow[]) {
            const key = t.contact_report_id || t.client_activity_id
            if (!key) continue
            if (!grouped[key]) grouped[key] = []
            grouped[key].push(t)
          }
          setTodosByEntry(grouped)
        }
        if (commentErr) {
          console.error('[contact-report] load comments failed:', commentErr)
        } else {
          const groupedComments: Record<string, ContactCommentRow[]> = {}
          for (const c of (commentRows || []) as ContactCommentRow[]) {
            const key = c.contact_report_id || c.client_activity_id
            if (!key) continue
            if (!groupedComments[key]) groupedComments[key] = []
            groupedComments[key].push(c)
          }
          setCommentsByEntry(groupedComments)
        }
      } else {
        setTodosByEntry({})
        setCommentsByEntry({})
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [activeClient, authLoading])

  const visibleEntries = useMemo(
    () => (filter === 'all' ? entries : entries.filter(e => e.filterGroup === filter)),
    [entries, filter],
  )

  function resetForm() {
    setEditingId(null); setFType(null); setFTypeOther(''); setFVenue('')
    setFPlatform(PLATFORM_OPTIONS[0]); setFPlatformOther('')
    setFDate(new Date().toISOString().slice(0, 10)); setFNotes(''); setFormError('')
  }

  function openEditForm(report: ContactReportRow) {
    setEditingId(report.id)
    setFType(report.contact_type)
    setFTypeOther(report.contact_type_other || '')
    setFVenue(report.venue || '')
    setFPlatform(report.platform || PLATFORM_OPTIONS[0])
    setFPlatformOther(report.platform_other || '')
    setFDate(report.contact_date)
    setFNotes(report.notes || '')
    setFormError('')
    setFormOpen(true)
  }

  async function saveEntry() {
    if (!activeClient || !advisor) return
    if (!fType) { setFormError('Select a contact type.'); return }
    if (fType === 'other' && !fTypeOther.trim()) { setFormError('Please specify the contact type.'); return }
    if (fType === 'non_f2f' && fPlatform === 'Other' && !fPlatformOther.trim()) { setFormError('Please specify the platform.'); return }
    setFormError('')
    setSaving(true)

    const payload = {
      contact_type: fType,
      contact_type_other: fType === 'other' ? fTypeOther.trim() : null,
      venue: fType === 'f2f' ? (fVenue.trim() || null) : null,
      platform: fType === 'non_f2f' ? fPlatform : null,
      platform_other: fType === 'non_f2f' && fPlatform === 'Other' ? fPlatformOther.trim() : null,
      contact_date: fDate,
      notes: fNotes.trim() || null,
    }

    if (editingId) {
      const { data, error } = await supabase.from('contact_reports')
        .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingId).select()
      setSaving(false)
      if (error) { setFormError(error.message); return }
      const updatedRow = (data || [])[0] as ContactReportRow | undefined
      if (updatedRow) {
        setEntries(prev => sortEntries(prev.map(e => (e.id === editingId ? toEntry(updatedRow) : e))))
        setExpandedId(editingId)
      }
      resetForm(); setFormOpen(false)
      return
    }

    const { data, error } = await supabase.from('contact_reports').insert({
      ...payload, client_id: activeClient.id, advisor_id: advisor.id, status: 'open',
    }).select()
    setSaving(false)
    if (error) { setFormError(error.message); return }
    const newRow = (data || [])[0] as ContactReportRow | undefined
    if (newRow) {
      setEntries(prev => sortEntries([toEntry(newRow), ...prev]))
      setExpandedId(newRow.id)
    }
    resetForm(); setFormOpen(false)
  }

  function toggleExpand(id: string) {
    setExpandedId(prev => (prev === id ? null : id))
  }

  async function toggleTodo(todo: ContactTodoRow) {
    const key = (todo.contact_report_id || todo.client_activity_id)!
    const nextDone = !todo.done
    setTodosByEntry(prev => ({ ...prev, [key]: (prev[key] || []).map(t => (t.id === todo.id ? { ...t, done: nextDone } : t)) }))
    const { error } = await supabase.from('contact_report_todos').update({ done: nextDone, updated_at: new Date().toISOString() }).eq('id', todo.id)
    if (error) {
      console.error('[contact-report] todo toggle failed:', error)
      setTodosByEntry(prev => ({ ...prev, [key]: (prev[key] || []).map(t => (t.id === todo.id ? { ...t, done: todo.done } : t)) }))
    }
  }

  async function addTodo(entry: TimelineEntry) {
    const text = (newTodoDraft[entry.id] || '').trim()
    if (!text) return
    const existing = todosByEntry[entry.id] || []
    const { data, error } = await supabase.from('contact_report_todos').insert({
      contact_report_id: entry.kind === 'manual' ? entry.id : null,
      client_activity_id: entry.kind === 'auto' ? entry.id : null,
      text, sort_order: existing.length,
    }).select()
    if (error) { console.error('[contact-report] add todo failed:', error); return }
    const newTodo = (data || [])[0] as ContactTodoRow | undefined
    if (newTodo) setTodosByEntry(prev => ({ ...prev, [entry.id]: [...(prev[entry.id] || []), newTodo] }))
    setNewTodoDraft(prev => ({ ...prev, [entry.id]: '' }))
  }

  async function addComment(entry: TimelineEntry) {
    const text = (newCommentDraft[entry.id] || '').trim()
    if (!text) return
    const date = newCommentDate[entry.id] || new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase.from('contact_report_comments').insert({
      contact_report_id: entry.kind === 'manual' ? entry.id : null,
      client_activity_id: entry.kind === 'auto' ? entry.id : null,
      comment_date: date, text,
    }).select()
    if (error) { console.error('[contact-report] add comment failed:', error); return }
    const newComment = (data || [])[0] as ContactCommentRow | undefined
    if (newComment) {
      setCommentsByEntry(prev => ({
        ...prev,
        [entry.id]: [newComment, ...(prev[entry.id] || [])].sort((a, b) => {
          if (a.comment_date !== b.comment_date) return a.comment_date < b.comment_date ? 1 : -1
          return a.created_at < b.created_at ? 1 : -1
        }),
      }))
    }
    setNewCommentDraft(prev => ({ ...prev, [entry.id]: '' }))
  }

  async function deleteComment(comment: ContactCommentRow) {
    const key = (comment.contact_report_id || comment.client_activity_id)!
    setCommentsByEntry(prev => ({ ...prev, [key]: (prev[key] || []).filter(c => c.id !== comment.id) }))
    const { error } = await supabase.from('contact_report_comments').delete().eq('id', comment.id)
    if (error) console.error('[contact-report] delete comment failed:', error)
  }

  // Edits an auto entry's Details field from Contact Report itself. Writes
  // to client_activity.description (what this page reads) AND back to the
  // source meeting's own `notes` column, so New Business / Service Requests
  // shows the same text if opened later — not just a local overwrite here.
  async function saveAutoDetails(entry: TimelineEntry) {
    if (!entry.auto) return
    const text = autoDetailsDraft.trim() || null
    setSavingAutoDetails(true)
    const { error } = await supabase.from('client_activity')
      .update({ description: text, updated_at: new Date().toISOString() })
      .eq('id', entry.auto.id)
    if (error) {
      console.error('[contact-report] save auto details failed:', error)
      setSavingAutoDetails(false)
      return
    }
    if (entry.auto.source_table && entry.auto.source_id && EDITABLE_AUTO_DETAILS_SOURCES.has(entry.auto.source_table)) {
      const { error: sourceErr } = await supabase.from(entry.auto.source_table)
        .update({ notes: text }).eq('id', entry.auto.source_id)
      if (sourceErr) console.warn('[contact-report] source meeting notes sync failed:', sourceErr.message)
    }
    setEntries(prev => prev.map(e => (e.id === entry.id && e.auto ? { ...e, auto: { ...e.auto, description: text } } : e)))
    setEditingAutoDetailsId(null)
    setSavingAutoDetails(false)
  }

  async function deleteEntry(report: ContactReportRow) {
    if (!await confirmAction('Delete this contact report entry? This cannot be undone.', { danger: true, confirmLabel: 'Delete' })) return
    const { error } = await supabase.from('contact_reports').delete().eq('id', report.id)
    if (error) { console.error('[contact-report] delete entry failed:', error); return }
    setEntries(prev => prev.filter(e => e.id !== report.id))
    setTodosByEntry(prev => { const next = { ...prev }; delete next[report.id]; return next })
    setCommentsByEntry(prev => { const next = { ...prev }; delete next[report.id]; return next })
    if (expandedId === report.id) setExpandedId(null)
  }

  async function deleteTodo(todo: ContactTodoRow) {
    const key = (todo.contact_report_id || todo.client_activity_id)!
    setTodosByEntry(prev => ({ ...prev, [key]: (prev[key] || []).filter(t => t.id !== todo.id) }))
    const { error } = await supabase.from('contact_report_todos').delete().eq('id', todo.id)
    if (error) console.error('[contact-report] delete todo failed:', error)
  }

  // ── Guards ──
  if (authLoading || loading) {
    return <div style={pageWrap}><div style={{ color: 'var(--ink3)', padding: 40, textAlign: 'center' }}>Loading…</div></div>
  }
  if (!hasAccess) return null
  if (!activeClient) {
    return <div style={pageWrap}><div style={{ color: 'var(--ink3)', padding: 40, textAlign: 'center' }}>Select a client to view Contact Reports.</div></div>
  }

  return (
    <div style={pageWrap}>
      <div className="font-serif" style={{ fontSize: 26, color: 'var(--charcoal)', marginBottom: 2 }}>Contact Report</div>
      <div style={{ fontSize: 13, color: 'var(--ink3)', marginBottom: 20 }}>{activeClient.name} · Servicing Log</div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {(['all', 'f2f', 'call', 'non_f2f', 'service', 'other'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={filter === f ? filterChipOn : filterChipOff}>
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10 }}>
        <div className="font-mono" style={{ fontSize: 11.5, color: 'var(--ink3)' }}>
          {visibleEntries.length} {visibleEntries.length === 1 ? 'entry' : 'entries'}
        </div>
        {!formOpen && (
          <button onClick={() => setFormOpen(true)} style={btnPrimary}>+ Log Contact</button>
        )}
      </div>

      {formOpen && (
        <div style={cardBase}>
          <div style={fieldLabel}>Service Type</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {(['f2f', 'non_f2f', 'phone', 'service_update', 'other'] as ContactType[]).map(t => (
              <button key={t} onClick={() => setFType(t)} style={fType === t ? pillSelected : pillUnselected}>
                {CONTACT_TYPE_ICON[t]} {CONTACT_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          {fType === 'other' && (
            <div style={{ marginBottom: 14 }}>
              <div style={fieldLabel}>Please Specify</div>
              <input type="text" value={fTypeOther} onChange={e => setFTypeOther(e.target.value)}
                placeholder="e.g. WhatsApp text, Email thread" style={textInput} />
            </div>
          )}

          {fType === 'f2f' && (
            <div style={{ marginBottom: 14 }}>
              <div style={fieldLabel}>Venue</div>
              <input type="text" value={fVenue} onChange={e => setFVenue(e.target.value)}
                placeholder="e.g. Client's office, Suntec Tower 3" style={textInput} />
            </div>
          )}

          {fType === 'non_f2f' && (
            <div style={{ marginBottom: 14 }}>
              <div style={fieldLabel}>Platform</div>
              <select value={fPlatform} onChange={e => setFPlatform(e.target.value)} style={selectInput}>
                {PLATFORM_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {fPlatform === 'Other' && (
                <input type="text" value={fPlatformOther} onChange={e => setFPlatformOther(e.target.value)}
                  placeholder="Please specify platform" style={{ ...textInput, marginTop: 8 }} />
              )}
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <div style={fieldLabel}>Date</div>
            <DateInput value={fDate} onChange={setFDate} style={dateInputStyle} />
          </div>

          <div style={fieldLabel}>Notes</div>
          <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} placeholder="What was discussed..."
            style={notesInput} />

          {formError && (
            <div style={{ fontSize: 12.5, color: 'var(--rouge)', background: 'var(--rouge-l)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>{formError}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => { setFormOpen(false); resetForm() }} style={btnCancel}>Cancel</button>
            <button onClick={saveEntry} disabled={saving} style={{ ...btnSave, opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : editingId ? 'Update Entry' : 'Save Entry'}
            </button>
          </div>
        </div>
      )}

      {visibleEntries.length === 0 ? (
        <div style={{ ...cardBase, textAlign: 'center', color: 'var(--ink3)', padding: 40 }}>
          {entries.length === 0
            ? `No contact logged yet for ${activeClient.name}. Click "+ Log Contact" to start.`
            : 'No entries match this filter.'}
        </div>
      ) : (
        <div style={timelineWrap}>
          {visibleEntries.map((entry, idx) => {
            const isExpanded = expandedId === entry.id
            const todos = todosByEntry[entry.id] || []
            const openTodos = todos.filter(t => !t.done).length
            const comments = commentsByEntry[entry.id] || []
            const sourceLink = entry.auto?.source_table ? SOURCE_LINK[entry.auto.source_table] : null
            const isLast = idx === visibleEntries.length - 1
            return (
              <div key={entry.id} style={timelineItem}>
                <div style={{ ...timelineRail, ...(isLast ? { bottom: 'auto', height: 20 } : {}) }} />
                <div style={{ ...timelineDot, background: DOT_COLOR[entry.filterGroup] }} />
                <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--line)', paddingBottom: 18 }}>
                  <div onClick={() => toggleExpand(entry.id)} style={logRow}>
                    <div className="font-mono" style={logDate}>{fmtDate(entry.date)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={logTitle}>{entry.title}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <span style={tagStyle}>{entry.tag}</span>
                        {entry.secondaryTag && <span style={tagStyle}>{entry.secondaryTag}</span>}
                        {entry.kind === 'auto' && <span style={autoTagStyle}>Auto-logged</span>}
                      </div>
                    </div>
                    {openTodos > 0 && (
                      <div className="font-mono" style={logStatus}>{openTodos} to-do{openTodos > 1 ? 's' : ''}</div>
                    )}
                    <div style={{ ...chevron, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</div>
                  </div>

                  {isExpanded && (
                  <div style={logDetail} onClick={e => e.stopPropagation()}>
                    {entry.manual?.notes && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={detailLabel}>Notes</div>
                        <div style={{ ...detailValue, whiteSpace: 'pre-wrap' }}>{entry.manual.notes}</div>
                      </div>
                    )}
                    {entry.kind === 'auto' && entry.auto?.source_table && EDITABLE_AUTO_DETAILS_SOURCES.has(entry.auto.source_table) ? (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={detailLabel}>Details</div>
                          {editingAutoDetailsId !== entry.id && (
                            <button
                              onClick={() => { setEditingAutoDetailsId(entry.id); setAutoDetailsDraft(entry.auto?.description || '') }}
                              style={editEntryBtn}
                            >
                              {entry.auto?.description ? 'Edit' : '+ Add'}
                            </button>
                          )}
                        </div>
                        {editingAutoDetailsId === entry.id ? (
                          <div style={{ marginTop: 6 }}>
                            <textarea
                              value={autoDetailsDraft}
                              onChange={e => setAutoDetailsDraft(e.target.value)}
                              rows={3}
                              autoFocus
                              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 7, fontSize: 12.5, fontFamily: 'Inter, sans-serif', resize: 'vertical', color: 'var(--ink)' }}
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                              <button onClick={() => saveAutoDetails(entry)} disabled={savingAutoDetails} style={editEntryBtn}>Save</button>
                              <button onClick={() => setEditingAutoDetailsId(null)} disabled={savingAutoDetails} style={deleteEntryBtn}>Cancel</button>
                              <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>Also updates the notes on the original meeting.</span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ ...detailValue, whiteSpace: 'pre-wrap' }}>
                            {entry.auto?.description || <span style={{ color: 'var(--ink3)', fontStyle: 'italic' }}>No details yet.</span>}
                          </div>
                        )}
                      </div>
                    ) : (
                      entry.auto?.description && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={detailLabel}>Details</div>
                          <div style={{ ...detailValue, whiteSpace: 'pre-wrap' }}>{entry.auto.description}</div>
                        </div>
                      )
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      {entry.kind === 'manual' ? (
                        <>
                          <button onClick={() => openEditForm(entry.manual!)} style={editEntryBtn}>Edit Entry</button>
                          <button onClick={() => deleteEntry(entry.manual!)} style={deleteEntryBtn}>Delete Entry</button>
                        </>
                      ) : sourceLink ? (
                        <Link href={sourceLink.href} style={editEntryBtn}>{sourceLink.label} →</Link>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>Auto-logged — edit at the source</span>
                      )}
                    </div>

                    <div style={{ ...nestedTodoBox, marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--charcoal)', marginBottom: 8 }}>Updates</div>
                      {comments.length === 0 && (
                        <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 8 }}>No updates logged yet.</div>
                      )}
                      {comments.map(c => (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0' }}>
                          <span className="font-mono" style={{ fontSize: 10.5, color: 'var(--ink3)', width: 44, flexShrink: 0, paddingTop: 1 }}>{fmtShortDate(c.comment_date)}</span>
                          <div style={{ ...ntText, flex: 1 }}>{c.text}</div>
                          <button onClick={() => deleteComment(c)} style={ntDelete} aria-label="Remove update">×</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <input type="date" value={newCommentDate[entry.id] || new Date().toISOString().slice(0, 10)}
                          onChange={e => setNewCommentDate(prev => ({ ...prev, [entry.id]: e.target.value }))}
                          style={{ ...ntAddInput, flex: '0 0 128px', fontFamily: 'DM Mono, monospace' }} />
                        <input type="text" value={newCommentDraft[entry.id] || ''} placeholder="e.g. Sent illustration, emailed follow-up, client said not interested..."
                          onChange={e => setNewCommentDraft(prev => ({ ...prev, [entry.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') addComment(entry) }}
                          style={ntAddInput} />
                        <button onClick={() => addComment(entry)} style={ntAddBtn}>Add</button>
                      </div>
                    </div>

                    <div style={nestedTodoBox}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--charcoal)' }}>To-Do for this entry</span>
                        <span className="font-mono" style={{ fontSize: 10, color: 'var(--ink3)' }}>{openTodos} open</span>
                      </div>
                      {todos.map(t => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0' }}>
                          <div onClick={() => toggleTodo(t)}
                            style={{ ...ntCheck, background: t.done ? 'var(--emerald)' : '#fff', borderColor: t.done ? 'var(--emerald)' : 'var(--line)' }}>
                            {t.done ? '✓' : ''}
                          </div>
                          <div style={{ ...ntText, color: t.done ? 'var(--ink3)' : 'var(--ink)', textDecoration: t.done ? 'line-through' : 'none', flex: 1 }}>
                            {t.text}
                          </div>
                          <button onClick={() => deleteTodo(t)} style={ntDelete} aria-label="Remove task">×</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <input type="text" value={newTodoDraft[entry.id] || ''} placeholder="Add a task for this entry..."
                          onChange={e => setNewTodoDraft(prev => ({ ...prev, [entry.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') addTodo(entry) }}
                          style={ntAddInput} />
                        <button onClick={() => addTodo(entry)} style={ntAddBtn}>Add</button>
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── STYLES ─────────────────────────────────────────────────────────────────

const pageWrap: React.CSSProperties = { padding: '24px 32px 60px', maxWidth: 760 }

// Vertical dotted-line timeline — replaces the old flat bordered list. Each
// entry gets a colored dot (see DOT_COLOR) sitting on a thin rail, so the
// contact type reads at a glance without parsing every tag.
const timelineWrap: React.CSSProperties = { position: 'relative', paddingLeft: 22 }
const timelineItem: React.CSSProperties = { position: 'relative' }
const timelineRail: React.CSSProperties = {
  position: 'absolute', left: -17, top: 6, bottom: 0, width: 1, background: 'var(--line)',
}
const timelineDot: React.CSSProperties = {
  position: 'absolute', left: -21, top: 20, width: 9, height: 9, borderRadius: '50%',
  border: '2px solid var(--cream)', boxShadow: '0 0 0 1px var(--line2)',
}

const cardBase: React.CSSProperties = {
  background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: 18, marginBottom: 14,
}

const fieldLabel: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
  color: 'var(--ink3)', marginBottom: 8,
}

const pillBase: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, padding: '9px 13px', borderRadius: 8, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 6, minHeight: 40, border: '1px solid var(--line)',
}
const pillSelected: React.CSSProperties = { ...pillBase, background: 'var(--charcoal)', color: 'var(--cream)', borderColor: 'var(--charcoal)' }
const pillUnselected: React.CSSProperties = { ...pillBase, background: 'var(--cream)', color: 'var(--ink2)' }

const filterChipBase: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
  border: '1px solid var(--line)', fontFamily: 'DM Mono, monospace',
}
const filterChipOn: React.CSSProperties = { ...filterChipBase, background: 'var(--charcoal)', color: 'var(--cream)', borderColor: 'var(--charcoal)' }
const filterChipOff: React.CSSProperties = { ...filterChipBase, background: 'transparent', color: 'var(--ink3)' }

const textInput: React.CSSProperties = {
  width: '100%', fontSize: 13.5, padding: '11px 12px', border: '1px solid var(--line)', borderRadius: 8,
  background: 'var(--cream)', outline: 'none', fontFamily: 'inherit',
}
const selectInput: React.CSSProperties = { ...textInput }
const dateInputStyle: React.CSSProperties = { ...textInput }
const notesInput: React.CSSProperties = { ...textInput, resize: 'vertical', minHeight: 80, lineHeight: 1.55, marginBottom: 16 }

const btnPrimary: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, background: 'var(--charcoal)', color: 'var(--cream)', border: 'none',
  padding: '10px 16px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
}
const btnSave: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, background: 'var(--gold)', color: 'var(--charcoal)', border: 'none',
  padding: '10px 18px', borderRadius: 8, cursor: 'pointer',
}
const btnCancel: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, background: 'transparent', color: 'var(--ink3)', border: 'none',
  padding: 10, cursor: 'pointer',
}

const logRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 4px 0', cursor: 'pointer' }
const logDate: React.CSSProperties = { fontSize: 11, color: 'var(--ink3)', width: 62, flexShrink: 0, paddingTop: 2, lineHeight: 1.4 }
const logTitle: React.CSSProperties = { fontSize: 13.5, fontWeight: 600, color: 'var(--charcoal)' }
const tagStyle: React.CSSProperties = { fontSize: 10, color: 'var(--ink3)', background: 'var(--cream2)', padding: '2px 8px', borderRadius: 5 }
const autoTagStyle: React.CSSProperties = { fontSize: 10, color: 'var(--emerald)', background: 'var(--emerald-l, rgba(45,90,78,0.10))', padding: '2px 8px', borderRadius: 5, fontWeight: 600 }
const logStatus: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, flexShrink: 0, paddingTop: 2, whiteSpace: 'nowrap', color: 'var(--gold-tag)' }
const chevron: React.CSSProperties = { fontSize: 11, color: 'var(--ink3)', marginLeft: 4, transition: 'transform 0.15s ease', flexShrink: 0, paddingTop: 3 }

const logDetail: React.CSSProperties = { padding: '0 4px 16px 4px' }
const detailLabel: React.CSSProperties = { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--ink3)', marginBottom: 3 }
const detailValue: React.CSSProperties = { fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }

const editEntryBtn: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--gold-tag)', background: 'var(--gold-l)', border: 'none',
  borderRadius: 6, padding: '6px 12px', cursor: 'pointer', textDecoration: 'none', display: 'inline-block',
}
const deleteEntryBtn: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--rouge)', background: 'transparent', border: 'none',
  padding: '6px 4px', cursor: 'pointer',
}

const nestedTodoBox: React.CSSProperties = { background: 'var(--cream2)', borderRadius: 8, padding: 12 }
const ntCheck: React.CSSProperties = {
  width: 15, height: 15, border: '1.5px solid var(--line)', borderRadius: 4, flexShrink: 0, marginTop: 1,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff',
}
const ntText: React.CSSProperties = { fontSize: 12, lineHeight: 1.4 }
const ntDelete: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--ink3)', fontSize: 14, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }
const ntAddInput: React.CSSProperties = {
  flex: 1, fontSize: 11.5, padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 6,
  outline: 'none', background: '#fff', fontFamily: 'inherit',
}
const ntAddBtn: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, background: 'var(--charcoal)', color: 'var(--cream)', border: 'none',
  padding: '7px 11px', borderRadius: 6, cursor: 'pointer',
}