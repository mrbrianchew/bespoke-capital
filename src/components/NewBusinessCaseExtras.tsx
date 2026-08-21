'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'

// Meetings + to-dos for a New Business case. Meetings reuse
// /api/service-requests/schedule-meeting as-is — that route only ever
// creates/deletes a Calendar event and hands back an eventId; it was never
// actually scoped to service requests, the id association happens entirely
// client-side in whichever table the caller saves into. No new API route
// needed. To-dos mirror the inline CRUD already in the Service Requests
// board modal (service_request_todos) — same shape, different table.

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', rose: 'var(--rouge)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)', cream2: 'var(--cream2)',
}

type MeetingType = 'in_person' | 'video_call' | 'phone_call' | 'clarification'
type VideoPlatform = 'google_meet' | 'zoom' | 'teams' | 'other'

interface MeetingRow {
  id: string
  case_id: string
  title: string
  meeting_type: 'fact_find' | 'presentation' | 'implementation' | 'clarification' | 'other'
  meeting_date: string
  meeting_time: string | null
  duration_minutes: number
  notes: string | null
  is_scheduled: boolean
  google_calendar_event_id: string | null
  video_platform: string | null
  meeting_link: string | null
  location: string | null
  phone_number: string | null
  created_at: string
}

interface TodoRow {
  id: string
  case_id: string
  text: string
  done: boolean
  due_date: string | null
  created_at: string
}

// Ported from ServiceRequestExtras.tsx (Aug 2026) — the new_business_
// activity_log table already existed in the schema (scaffolded alongside
// the other New Business tables) but no component ever queried it. Same
// shape, same edit/delete pattern as the Service Requests version.
interface ActivityRow {
  id: string
  case_id: string
  activity_date: string
  description: string
  created_at: string
}

const MEETING_PURPOSE_LABELS: Record<MeetingRow['meeting_type'], string> = {
  fact_find: 'Fact-Find', presentation: 'Presentation', implementation: 'Implementation',
  clarification: 'Clarification Call', other: 'Other',
}
const VIDEO_PLATFORM_LABELS: Record<VideoPlatform, string> = {
  google_meet: 'Google Meet', zoom: 'Zoom', teams: 'MS Teams', other: 'Other',
}
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
}

const inputStyle: React.CSSProperties = {
  padding: '7px 9px', fontSize: 12.5, border: `1px solid ${T.line}`, borderRadius: 7, outline: 'none', background: '#fff', color: T.text, fontFamily: 'Inter, sans-serif',
}
const ghostBtnStyle: React.CSSProperties = {
  flex: 1, fontSize: 12, fontWeight: 600, padding: '7px 10px', borderRadius: 7, border: `1px solid ${T.line}`, background: '#fff', color: T.textDim, cursor: 'pointer',
}
const btnStyle: React.CSSProperties = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 700, color: '#fff', background: T.text, border: 'none', borderRadius: 7, cursor: 'pointer',
}

export default function NewBusinessCaseExtras({ caseId, onMeetingsChanged }: { caseId: string; onMeetingsChanged?: () => void }) {
  const supabase = createClient()
  const toast = useToast()
  const confirmAction = useConfirm()

  const [loading, setLoading] = useState(true)
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [activity, setActivity] = useState<ActivityRow[]>([])

  // activity form
  const [activityDraft, setActivityDraft] = useState('')
  const [activityDateDraft, setActivityDateDraft] = useState(() => new Date().toISOString().slice(0, 10))
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null)
  const [editActivityText, setEditActivityText] = useState('')
  const [editActivityDate, setEditActivityDate] = useState('')

  // meeting form
  const [meetingMode, setMeetingMode] = useState<'log' | 'schedule' | 'edit' | null>(null)
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null)
  const [meetingTitle, setMeetingTitle] = useState('')
  const [purpose, setPurpose] = useState<MeetingRow['meeting_type']>('fact_find')
  const [channel, setChannel] = useState<'in_person' | 'video_call' | 'phone_call'>('video_call')
  const [meetingDate, setMeetingDate] = useState('')
  const [meetingTime, setMeetingTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [meetingNotes, setMeetingNotes] = useState('')
  const [videoPlatformSel, setVideoPlatformSel] = useState<VideoPlatform>('google_meet')
  const [meetingLinkDraft, setMeetingLinkDraft] = useState('')
  const [locationDraft, setLocationDraft] = useState('')
  const [phoneDraft, setPhoneDraft] = useState('')
  const [savingMeeting, setSavingMeeting] = useState(false)

  // todo form
  const [todoDraft, setTodoDraft] = useState('')
  const [todoDueDraft, setTodoDueDraft] = useState('')
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null)
  const [editTodoText, setEditTodoText] = useState('')
  const [editTodoDue, setEditTodoDue] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [meetRes, todoRes, actRes] = await Promise.all([
        supabase.from('new_business_case_meetings').select('*').eq('case_id', caseId).order('meeting_date', { ascending: false }),
        supabase.from('new_business_case_todos').select('*').eq('case_id', caseId).order('created_at', { ascending: true }),
        supabase.from('new_business_activity_log').select('*').eq('case_id', caseId).order('activity_date', { ascending: false }),
      ])
      if (cancelled) return
      setMeetings((meetRes.data || []) as MeetingRow[])
      setTodos((todoRes.data || []) as TodoRow[])
      setActivity((actRes.data || []) as ActivityRow[])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])

  function openMeetingForm(mode: 'log' | 'schedule') {
    setMeetingMode(mode)
    setEditingMeetingId(null)
    setMeetingTitle('')
    setPurpose('fact_find')
    setChannel('video_call')
    setMeetingDate(new Date().toISOString().slice(0, 10))
    setMeetingTime('')
    setDurationMinutes(30)
    setMeetingNotes('')
    setVideoPlatformSel('google_meet')
    setMeetingLinkDraft('')
    setLocationDraft('')
    setPhoneDraft('')
  }

  // Edits the DB row in place — does not touch the synced Calendar event
  // (the schedule-meeting API only supports create/delete, no update), so
  // a calendar-synced meeting's invite won't reflect edits made here. That's
  // an acceptable gap for now: delete + reschedule still works for changes
  // that need to hit the calendar.
  function openEditMeetingForm(m: MeetingRow) {
    setMeetingMode('edit')
    setEditingMeetingId(m.id)
    setMeetingTitle(m.title)
    setPurpose(m.meeting_type)
    setChannel((m.video_platform ? 'video_call' : m.phone_number ? 'phone_call' : 'in_person'))
    setMeetingDate(m.meeting_date)
    setMeetingTime(m.meeting_time ? m.meeting_time.slice(0, 5) : '')
    setDurationMinutes(m.duration_minutes || 30)
    setMeetingNotes(m.notes || '')
    setVideoPlatformSel((m.video_platform as VideoPlatform) || 'google_meet')
    setMeetingLinkDraft(m.meeting_link || '')
    setLocationDraft(m.location || '')
    setPhoneDraft(m.phone_number || '')
  }

  async function saveMeeting() {
    if (!meetingTitle.trim() || !meetingDate) return
    setSavingMeeting(true)

    if (editingMeetingId) {
      const patch = {
        title: meetingTitle.trim(), meeting_type: purpose,
        meeting_date: meetingDate, meeting_time: meetingTime || null, duration_minutes: durationMinutes,
        notes: meetingNotes.trim() || null,
        video_platform: channel === 'video_call' ? videoPlatformSel : null,
        meeting_link: channel === 'video_call' ? (meetingLinkDraft.trim() || null) : null,
        location: channel === 'in_person' ? (locationDraft.trim() || null) : null,
        phone_number: channel === 'phone_call' ? (phoneDraft.trim() || null) : null,
      }
      const { error } = await supabase.from('new_business_case_meetings').update(patch).eq('id', editingMeetingId)
      setSavingMeeting(false)
      if (error) { toast('Could not save changes: ' + error.message, 'error'); return }
      setMeetings(prev => prev.map(m => m.id === editingMeetingId ? { ...m, ...patch } : m))
      onMeetingsChanged?.()
      setMeetingMode(null)
      setEditingMeetingId(null)
      return
    }

    const isScheduled = meetingMode === 'schedule'
    let calendarEventId: string | null = null
    let finalMeetingLink = channel === 'video_call' ? meetingLinkDraft.trim() || null : null

    if (isScheduled) {
      try {
        const res = await fetch('/api/service-requests/schedule-meeting', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: meetingTitle.trim(), date: meetingDate, time: meetingTime || null, notes: meetingNotes.trim() || null,
            durationMinutes,
            location: channel === 'in_person' ? locationDraft.trim() || null : channel === 'phone_call' ? (phoneDraft.trim() ? `Phone: ${phoneDraft.trim()}` : null) : null,
            videoPlatform: channel === 'video_call' ? videoPlatformSel : null,
            meetingLink: channel === 'video_call' ? (meetingLinkDraft.trim() || null) : null,
          }),
        })
        if (res.ok) { const d = await res.json(); calendarEventId = d.eventId || null; if (d.meetLink) finalMeetingLink = d.meetLink }
      } catch { /* non-fatal — meeting still saves below */ }
    }

    const { data, error } = await supabase.from('new_business_case_meetings').insert({
      case_id: caseId, title: meetingTitle.trim(), meeting_type: purpose,
      meeting_date: meetingDate, meeting_time: meetingTime || null, duration_minutes: durationMinutes,
      notes: meetingNotes.trim() || null, is_scheduled: isScheduled, google_calendar_event_id: calendarEventId,
      video_platform: channel === 'video_call' ? videoPlatformSel : null,
      meeting_link: finalMeetingLink,
      location: channel === 'in_person' ? (locationDraft.trim() || null) : null,
      phone_number: channel === 'phone_call' ? (phoneDraft.trim() || null) : null,
    }).select().maybeSingle()

    setSavingMeeting(false)
    if (error) { toast('Could not save meeting: ' + error.message, 'error'); return }
    if (data) { setMeetings(prev => [data as MeetingRow, ...prev]); onMeetingsChanged?.() }
    setMeetingMode(null)
  }

  async function deleteMeeting(id: string) {
    if (!await confirmAction('Delete this meeting?', { danger: true, confirmLabel: 'Delete' })) return
    const meeting = meetings.find(m => m.id === id)
    setMeetings(prev => prev.filter(m => m.id !== id))
    const { error } = await supabase.from('new_business_case_meetings').delete().eq('id', id)
    if (error) toast('Delete failed: ' + error.message, 'error')
    if (meeting?.google_calendar_event_id) {
      fetch('/api/service-requests/schedule-meeting', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: meeting.google_calendar_event_id }),
      }).catch(() => {})
    }
    onMeetingsChanged?.()
  }

  async function addTodo() {
    if (!todoDraft.trim()) return
    const { data, error } = await supabase.from('new_business_case_todos')
      .insert({ case_id: caseId, text: todoDraft.trim(), due_date: todoDueDraft || null }).select().maybeSingle()
    if (error) { toast('Could not add: ' + error.message, 'error'); return }
    if (data) setTodos(prev => [...prev, data as TodoRow])
    setTodoDraft('')
    setTodoDueDraft('')
  }

  async function toggleTodo(id: string, done: boolean) {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done, done_at: done ? new Date().toISOString() : null } as any : t))
    const { error } = await supabase.from('new_business_case_todos').update({ done, done_at: done ? new Date().toISOString() : null }).eq('id', id)
    if (error) toast('Save failed: ' + error.message, 'error')
  }

  async function deleteTodo(id: string) {
    setTodos(prev => prev.filter(t => t.id !== id))
    const { error } = await supabase.from('new_business_case_todos').delete().eq('id', id)
    if (error) toast('Delete failed: ' + error.message, 'error')
  }

  function openEditTodo(t: TodoRow) {
    setEditingTodoId(t.id)
    setEditTodoText(t.text)
    setEditTodoDue(t.due_date || '')
  }

  async function saveTodoEdit() {
    if (!editingTodoId || !editTodoText.trim()) return
    const patch = { text: editTodoText.trim(), due_date: editTodoDue || null }
    setTodos(prev => prev.map(t => t.id === editingTodoId ? { ...t, ...patch } : t))
    const id = editingTodoId
    setEditingTodoId(null)
    const { error } = await supabase.from('new_business_case_todos').update(patch).eq('id', id)
    if (error) toast('Save failed: ' + error.message, 'error')
  }

  // ── activity log ──
  async function addActivity() {
    if (!activityDraft.trim()) return
    const { data, error } = await supabase.from('new_business_activity_log')
      .insert({ case_id: caseId, activity_date: activityDateDraft, description: activityDraft.trim() })
      .select().maybeSingle()
    if (error) { toast('Could not add entry: ' + error.message, 'error'); return }
    if (data) setActivity(prev => [data as ActivityRow, ...prev])
    setActivityDraft('')
    setActivityDateDraft(new Date().toISOString().slice(0, 10))
  }

  function startEditActivity(a: ActivityRow) {
    setEditingActivityId(a.id)
    setEditActivityText(a.description)
    setEditActivityDate(a.activity_date)
  }

  async function saveEditActivity() {
    if (!editingActivityId || !editActivityText.trim()) return
    const id = editingActivityId
    const patch = { description: editActivityText.trim(), activity_date: editActivityDate, updated_at: new Date().toISOString() }
    setActivity(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))
    setEditingActivityId(null)
    const { error } = await supabase.from('new_business_activity_log').update(patch).eq('id', id)
    if (error) toast('Save failed: ' + error.message, 'error')
  }

  async function deleteActivity(id: string) {
    if (!await confirmAction('Delete this entry?', { danger: true, confirmLabel: 'Delete' })) return
    setActivity(prev => prev.filter(a => a.id !== id))
    const { error } = await supabase.from('new_business_activity_log').delete().eq('id', id)
    if (error) toast('Delete failed: ' + error.message, 'error')
  }

  if (loading) return <div style={{ fontSize: 12, color: T.textFaint }}>Loading…</div>

  return (
    <div>
      {/* ── Activity log ── */}
      <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 12 }}>Activity log</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
        {activity.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>No entries yet.</div>}
        {activity.map(a => (
          editingActivityId === a.id ? (
            <div key={a.id} style={{ display: 'flex', gap: 6, padding: '6px 0' }}>
              <input type="date" value={editActivityDate} onChange={e => setEditActivityDate(e.target.value)} style={{ ...inputStyle, width: 128 }} />
              <input value={editActivityText} onChange={e => setEditActivityText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveEditActivity() }}
                style={{ ...inputStyle, flex: 1 }} />
              <button onClick={saveEditActivity} style={{ fontSize: 11, color: T.gold, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Save</button>
            </div>
          ) : (
            <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 11.5, color: T.textFaint, whiteSpace: 'nowrap', minWidth: 52, paddingTop: 1 }}>{fmtDate(a.activity_date)}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: T.text, lineHeight: 1.5 }}>{a.description}</span>
              <button onClick={() => startEditActivity(a)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>Edit</button>
              <button onClick={() => deleteActivity(a.id)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
            </div>
          )
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
        <input type="date" value={activityDateDraft} onChange={e => setActivityDateDraft(e.target.value)} style={{ ...inputStyle, width: 128 }} />
        <input value={activityDraft} onChange={e => setActivityDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addActivity() }}
          placeholder="What did you do?" style={{ ...inputStyle, flex: 1 }} />
        <button onClick={addActivity} style={btnStyle}>Add</button>
      </div>

      {/* ── Meetings ── */}
      <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 12 }}>
        Meetings <span style={{ fontWeight: 400, fontSize: 11.5, color: T.textFaint }}>{meetings.length > 0 ? `${meetings.length} logged` : ''}</span>
      </div>

      {meetings.length === 0 && meetingMode === null && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', marginBottom: 10 }}>No meetings yet.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {meetings.map(m => (
          <div key={m.id} style={{ padding: '10px 12px', background: '#fff', border: `1px solid ${T.line}`, borderRadius: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>{m.title}</span>
                <span style={{ marginLeft: 8, fontFamily: 'DM Mono, monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 4, background: T.cream2, color: T.textDim }}>
                  {MEETING_PURPOSE_LABELS[m.meeting_type]}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: T.textFaint, whiteSpace: 'nowrap' }}>{fmtDate(m.meeting_date)}{m.meeting_time ? `, ${m.meeting_time.slice(0, 5)}` : ''}</span>
                <button onClick={() => openEditMeetingForm(m)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }} title="Edit">✎</button>
                <button onClick={() => deleteMeeting(m.id)} style={{ fontSize: 13, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
              </div>
            </div>
            {m.meeting_link && <a href={m.meeting_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10.5, color: T.gold, textDecoration: 'none' }}>Join link ↗</a>}
            {m.location && <div style={{ fontSize: 10.5, color: T.textDim }}>{m.location}</div>}
            {m.phone_number && <div style={{ fontSize: 10.5, color: T.textDim }}>{m.phone_number}</div>}
            {m.notes && <p style={{ fontSize: 12, color: T.textDim, margin: '4px 0 0' }}>{m.notes}</p>}
            {m.is_scheduled && (
              <p style={{ fontSize: 10.5, color: m.google_calendar_event_id ? T.emerald : T.textFaint, margin: '4px 0 0' }}>
                {m.google_calendar_event_id ? '✓ synced to calendar' : 'scheduled — calendar not connected'}
              </p>
            )}
          </div>
        ))}
      </div>

      {meetingMode === null ? (
        <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
          <button onClick={() => openMeetingForm('log')} style={ghostBtnStyle}>Log past meeting</button>
          <button onClick={() => openMeetingForm('schedule')} style={ghostBtnStyle}>Schedule meeting</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, background: T.cream2, borderRadius: 9, marginBottom: 28 }}>
          {editingMeetingId && meetings.find(m => m.id === editingMeetingId)?.google_calendar_event_id && (
            <div style={{ fontSize: 10.5, color: T.textFaint, fontStyle: 'italic' }}>
              This meeting is synced to Google Calendar — changes here update the case record but not the calendar invite. Delete and reschedule to change the invite itself.
            </div>
          )}
          <input value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} placeholder="What's this meeting about?" style={inputStyle} />

          <select value={purpose} onChange={e => setPurpose(e.target.value as MeetingRow['meeting_type'])} style={inputStyle}>
            {(Object.keys(MEETING_PURPOSE_LABELS) as MeetingRow['meeting_type'][]).map(p => <option key={p} value={p}>{MEETING_PURPOSE_LABELS[p]}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 4 }}>
            {(['in_person', 'video_call', 'phone_call'] as const).map(t => (
              <button key={t} type="button" onClick={() => setChannel(t)}
                style={{
                  flex: 1, fontSize: 11.5, fontWeight: 600, padding: '6px 4px', borderRadius: 7, cursor: 'pointer',
                  border: `1px solid ${channel === t ? T.gold : T.line}`,
                  background: channel === t ? T.goldSoft : '#fff',
                  color: channel === t ? T.goldText : T.textDim,
                }}>
                {t === 'in_person' ? '📍 In person' : t === 'video_call' ? '💻 Video call' : '📞 Phone call'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <input type="time" value={meetingTime} onChange={e => setMeetingTime(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <select value={durationMinutes} onChange={e => setDurationMinutes(Number(e.target.value))} style={{ ...inputStyle, width: 92 }}>
              {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} min</option>)}
            </select>
          </div>

          {channel === 'in_person' && (
            <input value={locationDraft} onChange={e => setLocationDraft(e.target.value)} placeholder="Location (optional)" style={inputStyle} />
          )}
          {channel === 'video_call' && (
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={videoPlatformSel} onChange={e => setVideoPlatformSel(e.target.value as VideoPlatform)} style={{ ...inputStyle, width: 128 }}>
                {(Object.keys(VIDEO_PLATFORM_LABELS) as VideoPlatform[]).map(p => <option key={p} value={p}>{VIDEO_PLATFORM_LABELS[p]}</option>)}
              </select>
              <input value={meetingLinkDraft} onChange={e => setMeetingLinkDraft(e.target.value)}
                placeholder={videoPlatformSel === 'google_meet' ? 'Leave blank to auto-generate a Meet link' : 'Paste the meeting link (optional)'}
                style={{ ...inputStyle, flex: 1 }} />
            </div>
          )}
          {channel === 'phone_call' && (
            <input value={phoneDraft} onChange={e => setPhoneDraft(e.target.value)} placeholder="Phone number (optional)" style={inputStyle} />
          )}

          <textarea value={meetingNotes} onChange={e => setMeetingNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => { setMeetingMode(null); setEditingMeetingId(null) }} style={{ ...ghostBtnStyle, flex: 'none' }}>Cancel</button>
            <button onClick={saveMeeting} disabled={savingMeeting || !meetingTitle.trim() || !meetingDate} style={{ ...btnStyle, opacity: savingMeeting || !meetingTitle.trim() ? 0.6 : 1 }}>
              {savingMeeting ? 'Saving…' : editingMeetingId ? 'Save changes' : meetingMode === 'schedule' ? 'Schedule' : 'Log meeting'}
            </button>
          </div>
        </div>
      )}

      {/* ── To-dos ── */}
      <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 12 }}>
        To-Dos <span style={{ fontWeight: 400, fontSize: 11.5, color: T.textFaint }}>{todos.filter(t => !t.done).length} open</span>
      </div>
      {todos.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', marginBottom: 10 }}>No to-dos yet.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 10 }}>
        {todos.map(t => editingTodoId === t.id ? (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 0', borderBottom: `1px solid ${T.cream2}` }}>
            <input value={editTodoText} onChange={e => setEditTodoText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveTodoEdit(); if (e.key === 'Escape') setEditingTodoId(null) }}
              autoFocus style={{ ...inputStyle, flex: 1 }} />
            <input type="date" value={editTodoDue} onChange={e => setEditTodoDue(e.target.value)} style={inputStyle} />
            <button onClick={saveTodoEdit} style={{ fontSize: 11, color: T.gold, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Save</button>
            <button onClick={() => setEditingTodoId(null)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
          </div>
        ) : (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: `1px solid ${T.cream2}`, fontSize: 12.5 }}>
            <input type="checkbox" checked={t.done} onChange={e => toggleTodo(t.id, e.target.checked)} style={{ width: 15, height: 15, flexShrink: 0 }} />
            <span style={{ flex: 1, textDecoration: t.done ? 'line-through' : 'none', color: t.done ? T.textFaint : T.text }}>{t.text}</span>
            {t.due_date && <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, color: T.textFaint }}>{fmtDate(t.due_date)}</span>}
            <button onClick={() => openEditTodo(t)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }} title="Edit">✎</button>
            <button onClick={() => deleteTodo(t.id)} style={{ fontSize: 13, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={todoDraft} onChange={e => setTodoDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTodo() }}
          placeholder="Add a to-do..." style={{ ...inputStyle, flex: 1 }} />
        <input type="date" value={todoDueDraft} onChange={e => setTodoDueDraft(e.target.value)} style={inputStyle} />
        <button onClick={addTodo} style={btnStyle}>Add</button>
      </div>
    </div>
  )
}