'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import DateInput from '@/components/DateInput'
import { useConfirm } from '@/components/ConfirmDialog'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// ─── TYPES ──────────────────────────────────────────────────────────────────

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

interface ContactTodoRow {
  id: string
  contact_report_id: string
  text: string
  done: boolean
  sort_order: number
  created_at: string
}

interface ContactCommentRow {
  id: string
  contact_report_id: string
  comment_date: string
  text: string
  created_at: string
}

const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  f2f: 'F2F Meeting',
  non_f2f: 'Non-F2F',
  phone: 'Phone Call',
  service_update: 'Service Update',
  other: 'Other',
}
const CONTACT_TYPE_ICON: Record<ContactType, string> = {
  f2f: '🤝',
  non_f2f: '💻',
  phone: '📞',
  service_update: '🔧',
  other: '✉️',
}
const PLATFORM_OPTIONS = ['Zoom', 'Google Meet', 'Microsoft Teams', 'WhatsApp Video', 'Skype', 'Other']

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

// ─── PAGE ───────────────────────────────────────────────────────────────────

export default function ContactReportPage() {
  const { activeClient, advisor, authLoading } = useDashboard()
  const router = useRouter()
  const supabase = createClient()
  const confirmAction = useConfirm()

  const hasAccess = advisor?.id === CREATOR_ID || (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing'))

  const [loading, setLoading] = useState(true)
  const [reports, setReports] = useState<ContactReportRow[]>([])
  const [todosByReport, setTodosByReport] = useState<Record<string, ContactTodoRow[]>>({})
  const [commentsByReport, setCommentsByReport] = useState<Record<string, ContactCommentRow[]>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [newTodoDraft, setNewTodoDraft] = useState<Record<string, string>>({})
  const [newCommentDraft, setNewCommentDraft] = useState<Record<string, string>>({})
  const [newCommentDate, setNewCommentDate] = useState<Record<string, string>>({})

  // ── Form state ──
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

  // ── Route/feature guard — mirrors Medical Claims' creator-bypass rule. ──
  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
  }, [authLoading, advisor, hasAccess, router])

  // ── Load contact reports + their nested todos for the active client. ──
  useEffect(() => {
    if (authLoading || !activeClient) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data: reportRows, error: reportErr } = await supabase
        .from('contact_reports')
        .select('*')
        .eq('client_id', activeClient.id)
        .order('contact_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (reportErr) { console.error('[contact-report] load reports failed:', reportErr); setLoading(false); return }

      const rows = (reportRows || []) as ContactReportRow[]
      setReports(rows)

      if (rows.length > 0) {
        const ids = rows.map(r => r.id)
        const [{ data: todoRows, error: todoErr }, { data: commentRows, error: commentErr }] = await Promise.all([
          supabase.from('contact_report_todos').select('*').in('contact_report_id', ids).order('sort_order', { ascending: true }),
          supabase.from('contact_report_comments').select('*').in('contact_report_id', ids).order('comment_date', { ascending: false }).order('created_at', { ascending: false }),
        ])
        if (cancelled) return
        if (todoErr) {
          console.error('[contact-report] load todos failed:', todoErr)
        } else {
          const grouped: Record<string, ContactTodoRow[]> = {}
          for (const t of (todoRows || []) as ContactTodoRow[]) {
            if (!grouped[t.contact_report_id]) grouped[t.contact_report_id] = []
            grouped[t.contact_report_id].push(t)
          }
          setTodosByReport(grouped)
        }
        if (commentErr) {
          console.error('[contact-report] load comments failed:', commentErr)
        } else {
          const groupedComments: Record<string, ContactCommentRow[]> = {}
          for (const c of (commentRows || []) as ContactCommentRow[]) {
            if (!groupedComments[c.contact_report_id]) groupedComments[c.contact_report_id] = []
            groupedComments[c.contact_report_id].push(c)
          }
          setCommentsByReport(groupedComments)
        }
      } else {
        setTodosByReport({})
        setCommentsByReport({})
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [activeClient, authLoading])

  function resetForm() {
    setEditingId(null)
    setFType(null)
    setFTypeOther('')
    setFVenue('')
    setFPlatform(PLATFORM_OPTIONS[0])
    setFPlatformOther('')
    setFDate(new Date().toISOString().slice(0, 10))
    setFNotes('')
    setFormError('')
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
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editingId)
        .select()
      setSaving(false)
      if (error) { setFormError(error.message); return }
      const updatedRow = (data || [])[0] as ContactReportRow | undefined
      if (updatedRow) {
        setReports(prev => prev.map(r => (r.id === editingId ? updatedRow : r))
          .sort((a, b) => {
            if (a.contact_date !== b.contact_date) return a.contact_date < b.contact_date ? 1 : -1
            return a.created_at < b.created_at ? 1 : -1
          }))
        setExpandedId(editingId)
      }
      resetForm()
      setFormOpen(false)
      return
    }

    const { data, error } = await supabase.from('contact_reports').insert({
      ...payload,
      client_id: activeClient.id,
      advisor_id: advisor.id,
      status: 'open',
    }).select()
    setSaving(false)
    if (error) { setFormError(error.message); return }
    const newRow = (data || [])[0] as ContactReportRow | undefined
    if (newRow) {
      setReports(prev => [newRow, ...prev].sort((a, b) => {
        if (a.contact_date !== b.contact_date) return a.contact_date < b.contact_date ? 1 : -1
        return a.created_at < b.created_at ? 1 : -1
      }))
      setExpandedId(newRow.id)
    }
    resetForm()
    setFormOpen(false)
  }

  function toggleExpand(id: string) {
    setExpandedId(prev => (prev === id ? null : id))
  }

  async function toggleTodo(todo: ContactTodoRow) {
    const nextDone = !todo.done
    setTodosByReport(prev => ({
      ...prev,
      [todo.contact_report_id]: (prev[todo.contact_report_id] || []).map(t => (t.id === todo.id ? { ...t, done: nextDone } : t)),
    }))
    const { error } = await supabase.from('contact_report_todos').update({ done: nextDone, updated_at: new Date().toISOString() }).eq('id', todo.id)
    if (error) {
      console.error('[contact-report] todo toggle failed:', error)
      setTodosByReport(prev => ({
        ...prev,
        [todo.contact_report_id]: (prev[todo.contact_report_id] || []).map(t => (t.id === todo.id ? { ...t, done: todo.done } : t)),
      }))
    }
  }

  async function addTodo(reportId: string) {
    const text = (newTodoDraft[reportId] || '').trim()
    if (!text) return
    const existing = todosByReport[reportId] || []
    const { data, error } = await supabase.from('contact_report_todos').insert({
      contact_report_id: reportId,
      text,
      sort_order: existing.length,
    }).select()
    if (error) { console.error('[contact-report] add todo failed:', error); return }
    const newTodo = (data || [])[0] as ContactTodoRow | undefined
    if (newTodo) {
      setTodosByReport(prev => ({ ...prev, [reportId]: [...(prev[reportId] || []), newTodo] }))
    }
    setNewTodoDraft(prev => ({ ...prev, [reportId]: '' }))
  }

  async function addComment(reportId: string) {
    const text = (newCommentDraft[reportId] || '').trim()
    if (!text) return
    const date = newCommentDate[reportId] || new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase.from('contact_report_comments').insert({
      contact_report_id: reportId,
      comment_date: date,
      text,
    }).select()
    if (error) { console.error('[contact-report] add comment failed:', error); return }
    const newComment = (data || [])[0] as ContactCommentRow | undefined
    if (newComment) {
      setCommentsByReport(prev => ({
        ...prev,
        [reportId]: [newComment, ...(prev[reportId] || [])].sort((a, b) => {
          if (a.comment_date !== b.comment_date) return a.comment_date < b.comment_date ? 1 : -1
          return a.created_at < b.created_at ? 1 : -1
        }),
      }))
    }
    setNewCommentDraft(prev => ({ ...prev, [reportId]: '' }))
  }

  async function deleteComment(comment: ContactCommentRow) {
    setCommentsByReport(prev => ({
      ...prev,
      [comment.contact_report_id]: (prev[comment.contact_report_id] || []).filter(c => c.id !== comment.id),
    }))
    const { error } = await supabase.from('contact_report_comments').delete().eq('id', comment.id)
    if (error) console.error('[contact-report] delete comment failed:', error)
  }

  async function deleteEntry(report: ContactReportRow) {
    if (!await confirmAction('Delete this contact report entry? This cannot be undone.', { danger: true, confirmLabel: 'Delete' })) return
    const { error } = await supabase.from('contact_reports').delete().eq('id', report.id)
    if (error) { console.error('[contact-report] delete entry failed:', error); return }
    setReports(prev => prev.filter(r => r.id !== report.id))
    setTodosByReport(prev => {
      const next = { ...prev }
      delete next[report.id]
      return next
    })
    setCommentsByReport(prev => {
      const next = { ...prev }
      delete next[report.id]
      return next
    })
    if (expandedId === report.id) setExpandedId(null)
  }

  async function deleteTodo(todo: ContactTodoRow) {
    setTodosByReport(prev => ({
      ...prev,
      [todo.contact_report_id]: (prev[todo.contact_report_id] || []).filter(t => t.id !== todo.id),
    }))
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10 }}>
        <div className="font-mono" style={{ fontSize: 11.5, color: 'var(--ink3)' }}>
          {reports.length} {reports.length === 1 ? 'entry' : 'entries'}
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

      {reports.length === 0 ? (
        <div style={{ ...cardBase, textAlign: 'center', color: 'var(--ink3)', padding: 40 }}>
          No contact logged yet for {activeClient.name}. Click "+ Log Contact" to start.
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--line)' }}>
          {reports.map(r => {
            const isExpanded = expandedId === r.id
            const todos = todosByReport[r.id] || []
            const openTodos = todos.filter(t => !t.done).length
            const comments = commentsByReport[r.id] || []
            const secondary = secondaryTag(r)
            return (
              <div key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                <div onClick={() => toggleExpand(r.id)} style={logRow}>
                  <div className="font-mono" style={logDate}>{fmtDate(r.contact_date)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={logTitle}>
                      {r.notes ? r.notes.split('\n')[0].slice(0, 80) : `${CONTACT_TYPE_LABEL[r.contact_type]} logged`}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <span style={tagStyle}>{contactTag(r)}</span>
                      {secondary && <span style={tagStyle}>{secondary}</span>}
                    </div>
                  </div>
                  {openTodos > 0 && (
                    <div className="font-mono" style={logStatus}>{openTodos} to-do{openTodos > 1 ? 's' : ''}</div>
                  )}
                  <div style={{ ...chevron, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</div>
                </div>

                {isExpanded && (
                  <div style={logDetail} onClick={e => e.stopPropagation()}>
                    {r.notes && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={detailLabel}>Notes</div>
                        <div style={{ ...detailValue, whiteSpace: 'pre-wrap' }}>{r.notes}</div>
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <button onClick={() => openEditForm(r)} style={editEntryBtn}>Edit Entry</button>
                      <button onClick={() => deleteEntry(r)} style={deleteEntryBtn}>Delete Entry</button>
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
                        <input type="date" value={newCommentDate[r.id] || new Date().toISOString().slice(0, 10)}
                          onChange={e => setNewCommentDate(prev => ({ ...prev, [r.id]: e.target.value }))}
                          style={{ ...ntAddInput, flex: '0 0 128px', fontFamily: 'DM Mono, monospace' }} />
                        <input type="text" value={newCommentDraft[r.id] || ''} placeholder="e.g. Sent illustration, emailed follow-up, client said not interested..."
                          onChange={e => setNewCommentDraft(prev => ({ ...prev, [r.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') addComment(r.id) }}
                          style={ntAddInput} />
                        <button onClick={() => addComment(r.id)} style={ntAddBtn}>Add</button>
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
                        <input type="text" value={newTodoDraft[r.id] || ''} placeholder="Add a task for this entry..."
                          onChange={e => setNewTodoDraft(prev => ({ ...prev, [r.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') addTodo(r.id) }}
                          style={ntAddInput} />
                        <button onClick={() => addTodo(r.id)} style={ntAddBtn}>Add</button>
                      </div>
                    </div>
                  </div>
                )}
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

const logRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 4px', cursor: 'pointer' }
const logDate: React.CSSProperties = { fontSize: 11, color: 'var(--ink3)', width: 62, flexShrink: 0, paddingTop: 2, lineHeight: 1.4 }
const logTitle: React.CSSProperties = { fontSize: 13.5, fontWeight: 600, color: 'var(--charcoal)' }
const tagStyle: React.CSSProperties = { fontSize: 10, color: 'var(--ink3)', background: 'var(--cream2)', padding: '2px 8px', borderRadius: 5 }
const logStatus: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, flexShrink: 0, paddingTop: 2, whiteSpace: 'nowrap', color: 'var(--gold-tag)' }
const chevron: React.CSSProperties = { fontSize: 11, color: 'var(--ink3)', marginLeft: 4, transition: 'transform 0.15s ease', flexShrink: 0, paddingTop: 3 }

const logDetail: React.CSSProperties = { padding: '0 4px 16px 4px' }
const detailLabel: React.CSSProperties = { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--ink3)', marginBottom: 3 }
const detailValue: React.CSSProperties = { fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }

const editEntryBtn: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--gold-tag)', background: 'var(--gold-l)', border: 'none',
  borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
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