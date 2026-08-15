'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { ClientRow } from '@/contexts/DashboardContext'
import { fetchClientOpenItems, ClientOpenItems } from '@/lib/clientOpenItems'

// Floating "+" reachable from anywhere in the app (mounted once in
// dashboard/layout.tsx, gated on business dashboard access) — lets Brian
// log a todo or meeting against any client without first navigating into
// that specific case/request panel. Aug 2026.
//
// Scope decision: this only LOGS a meeting (is_scheduled=false, no Google
// Calendar sync) — the full Schedule flow with calendar integration stays
// on each pipeline's own panel (NewBusinessCaseExtras / ServiceRequestExtras),
// since replicating per-pipeline calendar API calls here would be a lot of
// surface area for a "quick" add. If a meeting needs to go on the calendar,
// open the case/request directly.
//
// Claims are addressed at LINE ITEM granularity (see clientOpenItems.ts) —
// a claim todo can't attach to "the claim" in general, only to one of its
// pending line items, so Claims never gets a Meeting option here (claims
// don't have a meetings table at all).

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(45,90,78,.12)',
  rose: 'var(--rouge)', slate: '#5C6B73', slateSoft: 'rgba(92,107,115,.12)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)', line: 'var(--line)',
}

type Pipe = 'claims' | 'newbiz' | 'service'
type Target = { id: string; label: string; sublabel: string; supportsMeeting: boolean }

function targetsFor(pipe: Pipe, items: ClientOpenItems): Target[] {
  if (pipe === 'claims') return items.claims.map(i => ({ id: i.id, label: i.description, sublabel: i.policyLabel, supportsMeeting: false }))
  if (pipe === 'newbiz') return items.newBusiness.map(c => ({ id: c.id, label: c.title, sublabel: c.stage.replace('_', ' '), supportsMeeting: true }))
  return items.service.map(r => ({ id: r.id, label: r.requestType, sublabel: r.status.replace('_', ' '), supportsMeeting: true }))
}

export default function GlobalQuickAdd({ clients }: { clients: ClientRow[] }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'client' | 'target' | 'form' | 'done'>('client')
  const [search, setSearch] = useState('')
  const [client, setClient] = useState<ClientRow | null>(null)
  const [loadingItems, setLoadingItems] = useState(false)
  const [items, setItems] = useState<ClientOpenItems | null>(null)
  const [pipe, setPipe] = useState<Pipe | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [kind, setKind] = useState<'todo' | 'meeting'>('todo')
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients.slice(0, 8)
    return clients.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8)
  }, [search, clients])

  function reset() {
    setStep('client'); setSearch(''); setClient(null); setItems(null); setPipe(null); setTarget(null)
    setKind('todo'); setText(''); setDate(''); setTime(''); setSaveError(null)
  }

  function close() { setOpen(false); reset() }

  async function pickClient(c: ClientRow) {
    setClient(c)
    setLoadingItems(true)
    setStep('target')
    const supabase = createClient()
    const data = await fetchClientOpenItems(supabase, c.id)
    setItems(data)
    setLoadingItems(false)
  }

  function pickTarget(p: Pipe, t: Target) {
    setPipe(p); setTarget(t); setKind('todo'); setStep('form')
  }

  async function save() {
    if (!text.trim() || !pipe || !target) return
    setSaving(true)
    setSaveError(null)
    const supabase = createClient()
    let error: any = null

    if (kind === 'todo') {
      if (pipe === 'claims') {
        ;({ error } = await supabase.from('claim_followup_todos').insert({ line_item_id: target.id, task: text.trim(), due_date: date || null, done: false }))
      } else if (pipe === 'newbiz') {
        ;({ error } = await supabase.from('new_business_case_todos').insert({ case_id: target.id, text: text.trim(), due_date: date || null }))
      } else {
        ;({ error } = await supabase.from('service_request_todos').insert({ service_request_id: target.id, text: text.trim(), due_date: date || null }))
      }
    } else {
      if (!date) { setSaveError('Pick a date for the meeting.'); setSaving(false); return }
      if (pipe === 'newbiz') {
        ;({ error } = await supabase.from('new_business_case_meetings').insert({
          case_id: target.id, title: text.trim(), meeting_type: 'other', meeting_date: date, meeting_time: time || null,
          duration_minutes: 30, is_scheduled: false, google_calendar_event_id: null,
        }))
      } else {
        ;({ error } = await supabase.from('service_request_meetings').insert({
          service_request_id: target.id, title: text.trim(), meeting_type: 'in_person', meeting_date: date, meeting_time: time || null,
          duration_minutes: 30, is_scheduled: false, google_calendar_event_id: null,
        }))
      }
    }

    setSaving(false)
    if (error) { setSaveError('Could not save: ' + error.message); return }
    setStep('done')
  }

  return (
    <>
      <button onClick={() => setOpen(true)} title="Quick add — todo or meeting for any client"
        style={{
          position: 'fixed', bottom: 24, right: 24, width: 52, height: 52, borderRadius: '50%',
          background: 'var(--charcoal)', color: '#fff', border: 'none', fontSize: 26, fontWeight: 400,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          boxShadow: '0 8px 22px rgba(28,26,23,0.28)', zIndex: 40, lineHeight: 1, paddingBottom: 3,
        }}>
        +
      </button>

      {open && (
        <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.35)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', background: 'var(--cream)',
            borderRadius: '16px 16px 0 0', boxShadow: '0 -10px 40px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.line}`, position: 'sticky', top: 0, background: 'var(--cream)' }}>
              <div className="font-serif" style={{ fontSize: 19, fontWeight: 600, color: T.text }}>Quick Add</div>
              <button onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 20, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: 20 }}>
              {step === 'client' && (
                <>
                  <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…"
                    style={{ width: '100%', padding: '10px 12px', fontSize: 13.5, border: `1px solid ${T.line}`, borderRadius: 8, outline: 'none', background: '#fff', marginBottom: 12 }} />
                  {filteredClients.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, padding: '10px 2px' }}>No matching clients.</div>}
                  {filteredClients.map(c => (
                    <div key={c.id} onClick={() => pickClient(c)} style={{ padding: '11px 12px', fontSize: 13, fontWeight: 600, color: T.text, background: '#fff', border: `1px solid ${T.line}`, borderRadius: 9, marginBottom: 6, cursor: 'pointer' }}>
                      {c.name}
                    </div>
                  ))}
                </>
              )}

              {step === 'target' && (
                <>
                  <button onClick={() => setStep('client')} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 11.5, cursor: 'pointer', padding: 0, marginBottom: 12 }}>← {client?.name}</button>
                  {loadingItems ? (
                    <div style={{ fontSize: 12.5, color: T.textFaint, padding: '10px 2px' }}>Loading open items…</div>
                  ) : items && (
                    <>
                      {(['claims', 'newbiz', 'service'] as Pipe[]).map(p => {
                        const targets = targetsFor(p, items)
                        if (targets.length === 0) return null
                        const label = p === 'claims' ? 'Claims' : p === 'newbiz' ? 'New Business' : 'Service Requests'
                        const color = p === 'claims' ? T.emerald : p === 'newbiz' ? T.goldText : T.slate
                        const soft = p === 'claims' ? T.emeraldSoft : p === 'newbiz' ? T.goldSoft : T.slateSoft
                        return (
                          <div key={p} style={{ marginBottom: 16 }}>
                            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, background: soft, color }}>{label}</span>
                            <div style={{ marginTop: 8 }}>
                              {targets.map(t => (
                                <div key={t.id} onClick={() => pickTarget(p, t)} style={{ padding: '11px 12px', background: '#fff', border: `1px solid ${T.line}`, borderRadius: 9, marginBottom: 6, cursor: 'pointer' }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{t.label}</div>
                                  <div style={{ fontSize: 11, color: T.textFaint, marginTop: 1, textTransform: 'capitalize' }}>{t.sublabel}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                      {items.claims.length === 0 && items.newBusiness.length === 0 && items.service.length === 0 && (
                        <div style={{ fontSize: 12.5, color: T.textFaint, padding: '10px 2px' }}>
                          Nothing open for {client?.name} in any pipeline — nothing to attach a todo or meeting to yet.
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {step === 'form' && target && (
                <>
                  <button onClick={() => setStep('target')} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 11.5, cursor: 'pointer', padding: 0, marginBottom: 4 }}>← {target.label}</button>
                  <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 16 }}>{client?.name} · {target.sublabel}</div>

                  {target.supportsMeeting && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--cream2)', border: `1px solid ${T.line}`, borderRadius: 8, padding: 3, maxWidth: 200 }}>
                      {(['todo', 'meeting'] as const).map(k => (
                        <button key={k} onClick={() => setKind(k)} style={{
                          flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, padding: '7px 0', border: 'none',
                          borderRadius: 5, cursor: 'pointer', color: kind === k ? T.text : T.textFaint,
                          background: kind === k ? '#fff' : 'none',
                        }}>
                          {k === 'todo' ? 'Todo' : 'Meeting'}
                        </button>
                      ))}
                    </div>
                  )}

                  <input value={text} onChange={e => setText(e.target.value)} placeholder={kind === 'todo' ? 'What needs doing?' : 'Meeting title'}
                    style={{ width: '100%', padding: '10px 12px', fontSize: 13.5, border: `1px solid ${T.line}`, borderRadius: 8, outline: 'none', background: '#fff', marginBottom: 10 }} />

                  <div style={{ display: 'flex', gap: 8, marginBottom: kind === 'meeting' ? 4 : 16 }}>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)}
                      style={{ flex: 1, padding: '9px 10px', fontSize: 13, border: `1px solid ${T.line}`, borderRadius: 8, outline: 'none', background: '#fff' }} />
                    {kind === 'meeting' && (
                      <input type="time" value={time} onChange={e => setTime(e.target.value)}
                        style={{ flex: 1, padding: '9px 10px', fontSize: 13, border: `1px solid ${T.line}`, borderRadius: 8, outline: 'none', background: '#fff' }} />
                    )}
                  </div>
                  {kind === 'meeting' && (
                    <div style={{ fontSize: 10.5, color: T.textFaint, marginBottom: 16 }}>
                      Logs the meeting only — no Google Calendar sync. Open the {pipe === 'newbiz' ? 'case' : 'request'} directly to schedule with calendar sync.
                    </div>
                  )}

                  {saveError && <div style={{ fontSize: 12, color: T.rose, marginBottom: 10 }}>{saveError}</div>}

                  <button onClick={save} disabled={saving || !text.trim()} style={{
                    width: '100%', padding: '11px 0', fontSize: 13, fontWeight: 700, color: '#fff',
                    background: saving || !text.trim() ? 'var(--ink3)' : 'var(--charcoal)', border: 'none', borderRadius: 9,
                    cursor: saving || !text.trim() ? 'default' : 'pointer',
                  }}>
                    {saving ? 'Saving…' : `Add ${kind === 'todo' ? 'Todo' : 'Meeting'}`}
                  </button>
                </>
              )}

              {step === 'done' && client && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 18 }}>Added for {client.name}.</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button onClick={reset} style={{ padding: '9px 16px', fontSize: 12.5, fontWeight: 600, border: `1px solid ${T.line}`, borderRadius: 8, background: '#fff', color: T.textDim, cursor: 'pointer' }}>Add another</button>
                    <Link href={`/dashboard/business/client/${client.id}`} onClick={close} style={{ padding: '9px 16px', fontSize: 12.5, fontWeight: 600, border: 'none', borderRadius: 8, background: 'var(--charcoal)', color: '#fff', cursor: 'pointer', textDecoration: 'none' }}>
                      View all for {client.name.split(' ')[0]}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}