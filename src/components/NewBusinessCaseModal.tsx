'use client'
import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import type { ClientRow } from '@/contexts/DashboardContext'

// Creates a new_business_cases row. Two entry paths:
//  - Existing Client: search the already-loaded `clients` list (no extra
//    fetch), with an inline "add as new client" escape hatch that writes a
//    real clients row (not just a case-scoped reference) when the person
//    isn't found. On selection, spouse is detected via a targeted
//    family_members query (DashboardContext's spouseNames map has names
//    only, not id/email/phone, and we need those for spouse_family_member_id
//    + the case title + email search seeding later).
//  - New Prospect: name/phone/email/source/referred-by, no client_id yet —
//    stays a standalone case until converted (out of scope for this slice,
//    same as the drawer's disabled Convert button).

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)', cream2: 'var(--cream2)', rose: 'var(--rouge)',
}

interface SpouseInfo { id: string; name: string; email: string | null; phone: string | null }

// Brian, Aug 2026: full names only, never truncated — a Singapore name
// like "Chia Wee Seng Wilson" or "Cindy Chew Ai Ping" isn't "first + last
// word", the middle words matter. shortName() used to drop them
// (case_title stored "Chia Wilson", "Cindy Ping" etc — silently wrong,
// not just cosmetic). Removed; caseTitle below now uses the name as-is.

const inputStyle: React.CSSProperties = {
  width: '100%', border: `1px solid ${T.line}`, borderRadius: 8, padding: '10px 12px',
  fontFamily: 'Inter, sans-serif', fontSize: 13, color: T.text, background: '#fff', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  fontFamily: 'DM Mono, monospace', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 6,
}
const btnStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, padding: '9px 16px',
  borderRadius: 7, border: `1px solid ${T.line}`, background: '#fff', color: T.text, cursor: 'pointer',
}

export default function NewBusinessCaseModal({
  advisorId, clients, setClients, onClose, onCreated, presetClient,
}: {
  advisorId: string
  clients: ClientRow[]
  setClients: (updater: (prev: ClientRow[]) => ClientRow[]) => void
  onClose: () => void
  onCreated: (newCase: any) => void
  // When opened from a client's own workspace (Client Servicing), the
  // client is already known — skip the Existing Client/New Prospect toggle
  // and the search entirely, go straight to the spouse-detection step.
  presetClient?: ClientRow
}) {
  const supabase = createClient()

  const [caseType, setCaseType] = useState<'client' | 'prospect'>('client')

  // existing-client search
  const [query, setQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null)
  const [spouse, setSpouse] = useState<SpouseInfo | null>(null)
  const [spouseLoading, setSpouseLoading] = useState(false)
  const [caseParty, setCaseParty] = useState<'client' | 'spouse' | 'both'>('client')

  // inline add-new-client
  const [addingClient, setAddingClient] = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [newClientPhone, setNewClientPhone] = useState('')
  const [newClientEmail, setNewClientEmail] = useState('')
  const [savingNewClient, setSavingNewClient] = useState(false)

  // prospect fields
  const [prospectName, setProspectName] = useState('')
  const [prospectPhone, setProspectPhone] = useState('')
  const [prospectEmail, setProspectEmail] = useState('')
  const [source, setSource] = useState('Referral — from existing client')
  const [referredBy, setReferredBy] = useState('')

  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const matches = useMemo(() => {
    if (!query.trim()) return []
    const q = query.trim().toLowerCase()
    return clients.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8)
  }, [clients, query])

  async function selectClient(c: ClientRow) {
    setSelectedClient(c)
    setCaseParty('client')
    setQuery('')
    setAddingClient(false)
    setSpouseLoading(true)
    const { data } = await supabase.from('family_members')
      .select('id, name, email, phone').eq('client_id', c.id).eq('relationship', 'Spouse').maybeSingle()
    setSpouse(data ? (data as SpouseInfo) : null)
    setSpouseLoading(false)
  }

  useEffect(() => {
    if (presetClient) selectClient(presetClient)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetClient?.id])

  function clearSelection() {
    setSelectedClient(null)
    setSpouse(null)
    setCaseParty('client')
  }

  async function saveNewClient() {
    if (!newClientName.trim()) return
    setSavingNewClient(true)
    setError('')
    const { data, error: insErr } = await supabase.from('clients')
      .insert({ advisor_id: advisorId, name: newClientName.trim(), phone: newClientPhone.trim() || null, email: newClientEmail.trim() || null })
      .select().single()
    setSavingNewClient(false)
    if (insErr || !data) { setError('Could not create client: ' + (insErr?.message || 'unknown error')); return }
    const row = data as ClientRow
    setClients(prev => [...prev, row])
    setNewClientName(''); setNewClientPhone(''); setNewClientEmail('')
    selectClient(row)
  }

  const caseTitle = useMemo(() => {
    if (caseType === 'prospect') return prospectName.trim() || 'Unnamed Prospect'
    if (!selectedClient) return ''
    if (!spouse || caseParty === 'client') return selectedClient.name
    if (caseParty === 'spouse') return spouse.name
    return `${selectedClient.name} & ${spouse.name}`
  }, [caseType, prospectName, selectedClient, spouse, caseParty])

  const canSubmit = caseType === 'prospect' ? prospectName.trim().length > 0 : !!selectedClient

  async function submit() {
    if (!canSubmit) return
    setSaving(true)
    setError('')

    const base = {
      advisor_id: advisorId,
      created_by: advisorId,
      case_title: caseTitle,
      stage: 'outreach' as const,
      stage_changed_at: new Date().toISOString(),
      notes: notes.trim() || null,
    }

    const payload = caseType === 'prospect'
      ? {
          ...base,
          client_id: null,
          prospect_name: prospectName.trim(),
          prospect_contact: prospectPhone.trim() || null,
          prospect_email: prospectEmail.trim() || null,
          case_party: 'client' as const,
          spouse_family_member_id: null,
          source,
          referred_by: referredBy.trim() || null,
        }
      : {
          ...base,
          client_id: selectedClient!.id,
          prospect_name: null,
          prospect_contact: null,
          prospect_email: null,
          case_party: caseParty,
          spouse_family_member_id: (caseParty === 'spouse' || caseParty === 'both') ? spouse?.id || null : null,
          source: null,
          referred_by: null,
        }

    const { data, error: insErr } = await supabase.from('new_business_cases').insert(payload).select().single()
    setSaving(false)
    if (insErr || !data) { setError('Could not create case: ' + (insErr?.message || 'unknown error')); return }
    onCreated(data)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.46)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(520px, 100%)', background: 'var(--cream)', borderRadius: 14, border: `1px solid ${T.line}`, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ padding: '22px 26px 16px', borderBottom: `1px solid ${T.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="font-serif" style={{ fontSize: 24, fontWeight: 600, color: T.text, margin: '0 0 3px' }}>New Case</div>
            <div style={{ fontSize: 12, color: T.textFaint }}>Starts in the Outreach stage</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 22, lineHeight: 1, padding: 2 }}>×</button>
        </div>

        <div style={{ padding: '20px 26px 6px' }}>
          {!presetClient && (
            <div style={{ display: 'flex', background: '#fff', border: `1px solid ${T.line}`, borderRadius: 8, padding: 3, marginBottom: 20 }}>
              {(['client', 'prospect'] as const).map(t => (
                <div key={t} onClick={() => setCaseType(t)}
                  style={{
                    flex: 1, textAlign: 'center', padding: '8px 10px', fontSize: 12.5, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                    background: caseType === t ? T.text : 'transparent', color: caseType === t ? 'var(--cream)' : T.textFaint,
                  }}>
                  {t === 'client' ? 'Existing Client' : 'New Prospect'}
                </div>
              ))}
            </div>
          )}

          {caseType === 'client' && (
            <div style={{ marginBottom: 16 }}>
              {!presetClient && <div style={labelStyle}>Search Client</div>}
              {!presetClient && !selectedClient && (
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Type a name..." style={inputStyle} />
              )}

              {!presetClient && !selectedClient && query.trim() && (
                <div>
                  {matches.map(c => (
                    <div key={c.id} onClick={() => selectClient(c)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: `1px solid ${T.line}`, borderRadius: 8, background: '#fff', cursor: 'pointer', marginTop: 6 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>{c.name}</div>
                    </div>
                  ))}
                  {matches.length === 0 && !addingClient && (
                    <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', marginTop: 6 }}>No matching clients</div>
                  )}
                  {!addingClient && (
                    <div onClick={() => { setAddingClient(true); setNewClientName(query) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: `1px dashed ${T.line}`, borderRadius: 8, background: '#fff', cursor: 'pointer', marginTop: 6 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: T.textDim }}>+ Add &ldquo;{query}&rdquo; as a new client</div>
                    </div>
                  )}
                </div>
              )}

              {addingClient && (
                <div style={{ background: '#fff', border: `1px solid ${T.line}`, borderRadius: 8, padding: 14, marginTop: 6 }}>
                  <div style={{ marginBottom: 10 }}>
                    <div style={labelStyle}>Full Name</div>
                    <input value={newClientName} onChange={e => setNewClientName(e.target.value)} style={inputStyle} />
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={labelStyle}>Phone</div>
                      <input value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)} placeholder="+65 9xxx xxxx" style={inputStyle} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={labelStyle}>Email</div>
                      <input value={newClientEmail} onChange={e => setNewClientEmail(e.target.value)} type="email" placeholder="name@email.com" style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 12, lineHeight: 1.4 }}>
                    This creates a real client record in your client list — not just a case reference.
                  </div>
                  <button onClick={saveNewClient} disabled={savingNewClient || !newClientName.trim()}
                    style={{ ...btnStyle, background: T.text, color: 'var(--cream)', opacity: savingNewClient || !newClientName.trim() ? 0.6 : 1 }}>
                    {savingNewClient ? 'Saving…' : 'Save & Select Client'}
                  </button>
                </div>
              )}

              {selectedClient && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: `1px solid ${T.gold}`, background: T.goldSoft, borderRadius: 8 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#6B5225' }}>{selectedClient.name}</div>
                    {!presetClient && (
                      <button onClick={clearSelection} style={{ background: 'none', border: 'none', color: '#6B5225', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
                    )}
                  </div>

                  {spouseLoading && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 8 }}>Checking for spouse…</div>}

                  {!spouseLoading && (
                    <div style={{ fontSize: 11, color: (selectedClient as any).email ? T.textFaint : T.rose, marginTop: 8 }}>
                      {(selectedClient as any).email
                        ? <>Email on file: <b style={{ color: T.textDim }}>{(selectedClient as any).email}</b></>
                        : 'No email on file for this client — add one before relying on email search for this case.'}
                    </div>
                  )}

                  {!spouseLoading && spouse && (
                    <div style={{ marginTop: 14 }}>
                      <div style={labelStyle}>This case is for</div>
                      <div style={{ display: 'flex', background: '#fff', border: `1px solid ${T.line}`, borderRadius: 8, padding: 3 }}>
                        {([
                          { key: 'client', label: 'Client only' },
                          { key: 'spouse', label: 'Spouse only' },
                          { key: 'both', label: 'Both' },
                        ] as const).map(opt => (
                          <div key={opt.key} onClick={() => setCaseParty(opt.key)}
                            style={{
                              flex: 1, textAlign: 'center', padding: '8px 6px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                              background: caseParty === opt.key ? T.text : 'transparent', color: caseParty === opt.key ? 'var(--cream)' : T.textFaint,
                            }}>{opt.label}</div>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: T.textFaint, marginTop: 6 }}>
                        Case title will show as: <b style={{ color: T.textDim }}>{caseTitle}</b>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {caseType === 'prospect' && (
            <div>
              <div style={{ marginBottom: 12 }}>
                <div style={labelStyle}>Full Name</div>
                <input value={prospectName} onChange={e => setProspectName(e.target.value)} placeholder="e.g. Ravindran s/o Muthu" style={inputStyle} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>Phone</div>
                  <input value={prospectPhone} onChange={e => setProspectPhone(e.target.value)} placeholder="+65 9xxx xxxx" style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>Email</div>
                  <input value={prospectEmail} onChange={e => setProspectEmail(e.target.value)} type="email" placeholder="name@email.com" style={inputStyle} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 16, lineHeight: 1.4 }}>
                No client record is created yet — this case stays a standalone prospect until you convert it, or a product is incepted.
              </div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>Source</div>
                  <select value={source} onChange={e => setSource(e.target.value)} style={inputStyle}>
                    <option>Referral — from existing client</option>
                    <option>Referral — from colleague / network</option>
                    <option>Cold outreach</option>
                    <option>Walk-in / inbound enquiry</option>
                    <option>Other</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={labelStyle}>Referred By <span style={{ textTransform: 'none', fontStyle: 'italic' }}>optional</span></div>
                  <input value={referredBy} onChange={e => setReferredBy(e.target.value)} placeholder="e.g. Mr. Tan" style={inputStyle} />
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16, marginBottom: 8 }}>
            <div style={labelStyle}>Notes <span style={{ textTransform: 'none', fontStyle: 'italic' }}>optional</span></div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Context for this case — e.g. what prompted the conversation..."
              style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }} />
          </div>

          {error && <div style={{ fontSize: 12, color: T.rose, marginTop: 8 }}>{error}</div>}
        </div>

        <div style={{ padding: '16px 26px 22px', display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: `1px solid ${T.line}`, marginTop: 10 }}>
          <button onClick={onClose} style={btnStyle}>Cancel</button>
          <button onClick={submit} disabled={saving || !canSubmit}
            style={{ ...btnStyle, background: T.text, color: 'var(--cream)', opacity: saving || !canSubmit ? 0.6 : 1 }}>
            {saving ? 'Creating…' : 'Create Case'}
          </button>
        </div>
      </div>
    </div>
  )
}