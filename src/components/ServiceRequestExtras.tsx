'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useDriveUpload, DriveDocumentGeneric } from '@/lib/useDriveUpload'

// Drops into the Service Request modal wherever it's rendered (firm-wide
// Board or the per-client Servicing page) — self-fetches and self-manages
// its own three blocks so neither host page has to duplicate this state.
// Mirrors patterns already in use elsewhere in the app rather than
// inventing new ones: Attachments = Claims' Drive upload mechanics +
// BugReportModal's paste/drag-drop UX; Activity log = Claims' followup-notes
// edit/delete pattern; Meetings is new (no exact precedent).

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  rose: 'var(--rouge)', roseSoft: 'var(--rouge-l)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)',
}

interface AttachmentRow extends DriveDocumentGeneric {
  service_request_id: string
}

interface MeetingRow {
  id: string
  service_request_id: string
  title: string
  meeting_date: string
  meeting_time: string | null
  notes: string | null
  is_scheduled: boolean
  google_calendar_event_id: string | null
  created_at: string
}

interface ActivityRow {
  id: string
  service_request_id: string
  activity_date: string
  description: string
  created_at: string
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, margin: '14px 0 8px' }}>{children}</div>
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
}

export default function ServiceRequestExtras({ serviceRequestId, clientId }: { serviceRequestId: string; clientId: string }) {
  const supabase = createClient()
  const drive = useDriveUpload()

  // Bumps the parent request's updated_at so serviceRequestsAttention.ts's
  // idle-day staleness check sees this as "recently touched" even though
  // none of the plain fields (status/description/etc, saved via patchRow
  // in the host page) changed. Fire-and-forget — a missed touch just means
  // the request looks one interaction staler than it is, not incorrect data.
  function touchRequest() {
    supabase.from('service_requests').update({ updated_at: new Date().toISOString() }).eq('id', serviceRequestId).then(() => {})
  }

  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [driveFolder, setDriveFolder] = useState<{ id: string; name: string } | null>(null)
  const [dragActive, setDragActive] = useState(false)

  // meeting form
  const [meetingMode, setMeetingMode] = useState<'log' | 'schedule' | null>(null)
  const [meetingTitle, setMeetingTitle] = useState('')
  const [meetingDate, setMeetingDate] = useState('')
  const [meetingTime, setMeetingTime] = useState('')
  const [meetingNotes, setMeetingNotes] = useState('')
  const [savingMeeting, setSavingMeeting] = useState(false)

  // activity form
  const [activityDraft, setActivityDraft] = useState('')
  const [activityDateDraft, setActivityDateDraft] = useState(() => new Date().toISOString().slice(0, 10))
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null)
  const [editActivityText, setEditActivityText] = useState('')
  const [editActivityDate, setEditActivityDate] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      // Folder is per-CLIENT for Service Requests — its own column
      // (clients.service_requests_drive_folder_link), separate from the
      // one Claims uses (clients.drive_folder_link), so the two features
      // don't collide, but every request for this client shares one
      // folder rather than each request picking its own.
      const [attRes, meetRes, actRes, clientRes] = await Promise.all([
        supabase.from('service_request_attachments').select('*').eq('service_request_id', serviceRequestId).order('uploaded_at', { ascending: false }),
        supabase.from('service_request_meetings').select('*').eq('service_request_id', serviceRequestId).order('meeting_date', { ascending: false }),
        supabase.from('service_request_activity_log').select('*').eq('service_request_id', serviceRequestId).order('activity_date', { ascending: false }),
        supabase.from('clients').select('service_requests_drive_folder_link').eq('id', clientId).maybeSingle(),
      ])
      if (cancelled) return
      setAttachments((attRes.data || []) as AttachmentRow[])
      setMeetings((meetRes.data || []) as MeetingRow[])
      setActivity((actRes.data || []) as ActivityRow[])
      const raw = (clientRes.data as any)?.service_requests_drive_folder_link as string | undefined
      if (raw) { try { const parsed = JSON.parse(raw); setDriveFolder(parsed?.id && parsed?.name ? parsed : null) } catch { setDriveFolder(null) } }
      else setDriveFolder(null)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceRequestId, clientId])

  // ── attachments ──
  async function connectDrive() {
    const folder = await drive.connectDriveFolder({ table: 'clients', idColumn: 'id', id: clientId }, 'service_requests_drive_folder_link')
    if (folder) setDriveFolder(folder)
  }

  async function doUpload(files: FileList | File[]) {
    if (!driveFolder) { await connectDrive(); return }
    const uploaded = await drive.uploadFilesGeneric(files, { table: 'service_request_attachments', idColumn: 'service_request_id', id: serviceRequestId }, driveFolder)
    if (uploaded.length > 0) { setAttachments(prev => [...(uploaded as AttachmentRow[]), ...prev]); touchRequest() }
  }

  async function removeAttachment(doc: AttachmentRow) {
    const ok = await drive.deleteDocumentGeneric(doc, 'service_request_attachments')
    if (ok) setAttachments(prev => prev.filter(d => d.id !== doc.id))
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.type.startsWith('image/')) {
          const pasted = item.getAsFile()
          if (pasted) {
            const named = new File([pasted], pasted.name || `pasted-screenshot.${item.type.split('/')[1] || 'png'}`, { type: item.type })
            doUpload([named])
          }
          e.preventDefault()
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveFolder, serviceRequestId])

  // ── meetings ──
  function openMeetingForm(mode: 'log' | 'schedule') {
    setMeetingMode(mode)
    setMeetingTitle('')
    setMeetingDate(new Date().toISOString().slice(0, 10))
    setMeetingTime('')
    setMeetingNotes('')
  }

  async function saveMeeting() {
    if (!meetingTitle.trim() || !meetingDate) return
    setSavingMeeting(true)
    const isScheduled = meetingMode === 'schedule'
    let calendarEventId: string | null = null
    if (isScheduled) {
      // Creates the event on the advisor's connected Google Calendar. Uses
      // the same MCP Calendar connector already wired up for the account —
      // if that connection isn't set up, the meeting still saves, just
      // without a synced calendar entry.
      try {
        const res = await fetch('/api/service-requests/schedule-meeting', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: meetingTitle.trim(), date: meetingDate, time: meetingTime || null, notes: meetingNotes.trim() || null }),
        })
        if (res.ok) { const d = await res.json(); calendarEventId = d.eventId || null }
      } catch { /* non-fatal — meeting still saves below */ }
    }
    const { data, error } = await supabase.from('service_request_meetings').insert({
      service_request_id: serviceRequestId, title: meetingTitle.trim(), meeting_date: meetingDate,
      meeting_time: meetingTime || null, notes: meetingNotes.trim() || null,
      is_scheduled: isScheduled, google_calendar_event_id: calendarEventId,
    }).select().maybeSingle()
    setSavingMeeting(false)
    if (error) { alert('Could not save meeting: ' + error.message); return }
    if (data) { setMeetings(prev => [data as MeetingRow, ...prev]); touchRequest() }
    setMeetingMode(null)
  }

  async function deleteMeeting(id: string) {
    if (!window.confirm('Delete this meeting?')) return
    const meeting = meetings.find(m => m.id === id)
    setMeetings(prev => prev.filter(m => m.id !== id))
    const { error } = await supabase.from('service_request_meetings').delete().eq('id', id)
    if (error) alert('Delete failed: ' + error.message)
    // Best-effort cleanup on the Calendar side too, so a deleted meeting
    // doesn't leave a stray event sitting on the advisor's actual calendar.
    if (meeting?.google_calendar_event_id) {
      fetch('/api/service-requests/schedule-meeting', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: meeting.google_calendar_event_id }),
      }).catch(() => {})
    }
  }

  // ── activity log ──
  async function addActivity() {
    if (!activityDraft.trim()) return
    const { data, error } = await supabase.from('service_request_activity_log')
      .insert({ service_request_id: serviceRequestId, activity_date: activityDateDraft, description: activityDraft.trim() })
      .select().maybeSingle()
    if (error) { alert('Could not add entry: ' + error.message); return }
    if (data) { setActivity(prev => [data as ActivityRow, ...prev]); touchRequest() }
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
    const { error } = await supabase.from('service_request_activity_log').update(patch).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
    else touchRequest()
  }

  async function deleteActivity(id: string) {
    if (!window.confirm('Delete this entry?')) return
    setActivity(prev => prev.filter(a => a.id !== id))
    const { error } = await supabase.from('service_request_activity_log').delete().eq('id', id)
    if (error) alert('Delete failed: ' + error.message)
  }

  const inputStyle: React.CSSProperties = { padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }
  const btnStyle: React.CSSProperties = { padding: '7px 14px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: 'pointer' }
  const ghostBtnStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: T.textDim, background: 'var(--cream2)', border: `1px solid ${T.line}`, borderRadius: 999, padding: '5px 11px', cursor: 'pointer' }

  return (
    <div>
      {/* ── attachments ── */}
      <SectionLabel>Attachments</SectionLabel>
      {loading ? (
        <div style={{ fontSize: 12.5, color: T.textFaint }}>Loading…</div>
      ) : attachments.length === 0 ? (
        <div style={{ fontSize: 12.5, color: T.textFaint, fontStyle: 'italic', marginBottom: 8 }}>No attachments yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
          {attachments.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <a href={d.drive_view_url || '#'} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, fontSize: 12.5, color: T.gold, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name}</a>
              <button onClick={() => removeAttachment(d)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
            </div>
          ))}
        </div>
      )}

      {drive.uploadError && <div style={{ fontSize: 11.5, color: T.rose, marginBottom: 8 }}>{drive.uploadError}</div>}

      <div
        onClick={() => (document.getElementById(`sr-file-input-${serviceRequestId}`) as HTMLInputElement)?.click()}
        onDragOver={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={e => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files) }}
        style={{
          cursor: 'pointer', textAlign: 'center', borderRadius: 8, padding: '14px 12px',
          border: `1.5px dashed ${dragActive ? T.gold : 'rgba(168,131,74,.5)'}`,
          background: dragActive ? T.goldSoft : 'transparent',
        }}>
        <input id={`sr-file-input-${serviceRequestId}`} type="file" multiple disabled={drive.uploading} style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) doUpload(e.target.files); e.target.value = '' }} />
        <p style={{ fontSize: 12, color: T.textFaint, margin: 0 }}>
          {drive.uploading ? 'Uploading…' : driveFolder ? `Paste, drag in, or click to upload to ${driveFolder.name}` : 'Paste, drag in, or click — you\'ll be asked to pick a folder for this client\'s service requests'}
        </p>
      </div>
      {driveFolder && (
        <button onClick={connectDrive} disabled={drive.connecting}
          style={{ marginTop: 6, fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
          {drive.connecting ? 'Connecting…' : "Change folder — applies to all this client's service requests"}
        </button>
      )}

      {/* ── meetings ── */}
      <SectionLabel>Meetings</SectionLabel>
      {meetings.length === 0 && meetingMode === null && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', marginBottom: 8 }}>No meetings yet.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {meetings.map(m => (
          <div key={m.id} style={{ padding: '8px 10px', background: 'var(--cream2)', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{m.title}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: T.textFaint, whiteSpace: 'nowrap' }}>{fmtDate(m.meeting_date)}{m.meeting_time ? `, ${m.meeting_time.slice(0, 5)}` : ''}</span>
                <button onClick={() => deleteMeeting(m.id)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
              </div>
            </div>
            {m.notes && <p style={{ fontSize: 12, color: T.textDim, margin: '4px 0 0' }}>{m.notes}</p>}
            {m.is_scheduled && (
              <p style={{ fontSize: 10.5, color: m.google_calendar_event_id ? 'var(--emerald)' : T.textFaint, margin: '4px 0 0' }}>
                {m.google_calendar_event_id ? '✓ synced to calendar' : 'scheduled — calendar not connected'}
              </p>
            )}
          </div>
        ))}
      </div>

      {meetingMode === null ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => openMeetingForm('log')} style={ghostBtnStyle}>Log past meeting</button>
          <button onClick={() => openMeetingForm('schedule')} style={ghostBtnStyle}>Schedule meeting</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, background: 'var(--cream2)', borderRadius: 8 }}>
          <input value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} placeholder="What's this meeting about?" style={inputStyle} />
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <input type="time" value={meetingTime} onChange={e => setMeetingTime(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
          </div>
          <textarea value={meetingNotes} onChange={e => setMeetingNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => setMeetingMode(null)} style={{ ...ghostBtnStyle, background: 'transparent' }}>Cancel</button>
            <button onClick={saveMeeting} disabled={savingMeeting || !meetingTitle.trim() || !meetingDate} style={{ ...btnStyle, opacity: savingMeeting || !meetingTitle.trim() ? 0.6 : 1 }}>
              {savingMeeting ? 'Saving…' : meetingMode === 'schedule' ? 'Schedule' : 'Log meeting'}
            </button>
          </div>
        </div>
      )}

      {/* ── activity log ── */}
      <SectionLabel>Activity log</SectionLabel>
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
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="date" value={activityDateDraft} onChange={e => setActivityDateDraft(e.target.value)} style={{ ...inputStyle, width: 128 }} />
        <input value={activityDraft} onChange={e => setActivityDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addActivity() }}
          placeholder="What did you do?" style={{ ...inputStyle, flex: 1 }} />
        <button onClick={addActivity} style={btnStyle}>Add</button>
      </div>
    </div>
  )
}