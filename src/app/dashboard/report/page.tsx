'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { buildOverviewSnapshot, OverviewSnapshot } from '@/lib/financialPlanSnapshot'
import { buildProtectionDTPDSnapshot, ProtectionDTPDSnapshot } from '@/lib/protectionSnapshot'
import OverviewDisplay from './OverviewDisplay'
import ProtectionDisplay from './ProtectionDisplay'

export default function ReportPage() {
  const supabase = createClient()
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState('')
  const [spouseName, setSpouseName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null)
  const [protectionSnapshot, setProtectionSnapshot] = useState<ProtectionDTPDSnapshot | null>(null)

  const [password, setPassword] = useState('')
  const [passwordHint, setPasswordHint] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedLink, setSavedLink] = useState('')

  const [loadedData, setLoadedData] = useState<{
    client: { name: string; dob: string }
    familyMembers: { name: string; relationship: string; dob?: string }[]
    fin: Record<string, any>
    estateData: Record<string, any>
    nonMortgageDebts: { amount?: number }[]
  } | null>(null)

  useEffect(() => {
    const id = localStorage.getItem('selectedClientId')
    if (!id) { setError('No client selected. Pick a client from the dashboard first.'); setLoading(false); return }
    setClientId(id)
    load(id)
  }, [])

  async function load(id: string) {
    setLoading(true)
    setError('')
    const [{ data: client }, { data: family }, { data: ffRows }] = await Promise.all([
      supabase.from('clients').select('name, dob').eq('id', id).maybeSingle(),
      supabase.from('family_members').select('id, name, relationship, dob, gender').eq('client_id', id),
      supabase.from('fact_finding').select('section, data').eq('client_id', id).in('section', ['financials', 'estate', 'protection_needs', 'protection_portfolio']),
    ])
    if (!client) { setError('Client not found.'); setLoading(false); return }
    setClientName(client.name)

    const merged: Record<string, any> = {}
    for (const row of ffRows || []) merged[row.section] = row.data || {}

    const isCouple = (family || []).some((f: any) => f.relationship === 'Spouse')
    const spouse = (family || []).find((f: any) => f.relationship === 'Spouse')
    setSpouseName(spouse?.name || '')
    const children = (family || []).filter((f: any) => ['Son', 'Daughter', 'Child'].includes(f.relationship))
    const policies = merged['protection_portfolio']?.risk_management?.policies || []

    const data = {
      client: { name: client.name, dob: client.dob || '' },
      familyMembers: (family || []).map((f: any) => ({ name: f.name, relationship: f.relationship, dob: f.dob })),
      fin: merged['financials'] || {},
      estateData: merged['estate'] || {},
      nonMortgageDebts: merged['protection_needs']?.protection?.nonMortgageDebts || [],
    }
    setLoadedData(data)

    try {
      setSnapshot(buildOverviewSnapshot(data))
    } catch (e: any) {
      setError('Snapshot build failed: ' + e.message)
    }

    try {
      setProtectionSnapshot(buildProtectionDTPDSnapshot({
        ff: merged['financials'] || {},
        protection: merged['protection_needs']?.protection || {},
        policies,
        children: children.map((c: any) => ({ id: c.id, dob: c.dob, gender: c.gender })),
        isCouple,
      }))
    } catch (e: any) {
      setError('Protection snapshot build failed: ' + e.message)
    }

    setLoading(false)
  }

  async function handleGenerateAndSave() {
    if (!clientId || !snapshot || !password.trim()) return
    setSaving(true)
    setError('')
    try {
      const encoder = new TextEncoder()
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(password.trim()))
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
      const token = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(36)).join('').slice(0, 12)
      const { data: { user } } = await supabase.auth.getUser()

      const label = `Overview Snapshot — ${new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })}`

      const { error } = await supabase.from('financial_plans').insert({
        client_id: clientId,
        label,
        share_token: token,
        password_hash: hashHex,
        password_hint: passwordHint || null,
        snapshot_data: snapshot,
        created_by: user?.id,
      })
      if (error) throw error
      setSavedLink(`${window.location.origin}/share/${token}`)
    } catch (e: any) {
      setError('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="py-8">
          <div className="font-serif text-3xl font-light" style={{ color: '#F0EDE8' }}>Report &amp; PDF</div>
          <div style={{ color: 'rgba(240,237,232,0.5)', fontSize: 13, marginTop: 4 }}>
            {clientName ? `Test harness — ${clientName}` : 'Test harness'}
          </div>
        </div>
      </div>

      <div style={{ padding: '48px', maxWidth: 960 }}>
        {loading && <p>Loading client data…</p>}
        {error && <p style={{ color: 'var(--rouge)' }}>{error}</p>}

        {!loading && !error && (
          <>
            {snapshot && (
              <>
                <div>
                  <OverviewDisplay snapshot={snapshot} />
                </div>

                <details style={{ marginTop: 16 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--ink3)' }}>View raw snapshot data</summary>
                  <pre style={{
                    marginTop: 12, background: '#1C1A17', color: '#E8E4DC', padding: 20,
                    borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 400,
                  }}>
                    {JSON.stringify(snapshot, null, 2)}
                  </pre>
                </details>

                {protectionSnapshot && (
                  <>
                    <div style={{ marginTop: 32 }}>
                      <ProtectionDisplay snapshot={protectionSnapshot} clientName={clientName} spouseName={spouseName} />
                    </div>
                    <details style={{ marginTop: 16 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--ink3)' }}>View raw protection data</summary>
                      <pre style={{
                        marginTop: 12, background: '#1C1A17', color: '#E8E4DC', padding: 20,
                        borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 400,
                      }}>
                        {JSON.stringify(protectionSnapshot, null, 2)}
                      </pre>
                    </details>
                  </>
                )}

                <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
                  <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, marginBottom: 12 }}>
                    Generate &amp; save this as a real plan
                  </div>
                  <input
                    type="password"
                    placeholder="Set a password for this link"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    style={{ display: 'block', marginBottom: 8, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6, width: 280 }}
                  />
                  <input
                    type="text"
                    placeholder="Password hint (optional)"
                    value={passwordHint}
                    onChange={e => setPasswordHint(e.target.value)}
                    style={{ display: 'block', marginBottom: 12, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6, width: 280 }}
                  />
                  <button
                    onClick={handleGenerateAndSave}
                    disabled={saving || !password.trim()}
                    style={{ background: 'var(--charcoal)', color: 'white', padding: '10px 20px', borderRadius: 6, border: 'none', fontSize: 14, cursor: 'pointer', opacity: saving || !password.trim() ? 0.5 : 1 }}
                  >
                    {saving ? 'Saving…' : 'Generate & Save Plan'}
                  </button>

                  {savedLink && (
                    <div style={{ marginTop: 16, fontSize: 13 }}>
                      <p style={{ marginBottom: 6 }}>Saved. Share this link with the client:</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <a href={savedLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-tag)', textDecoration: 'underline' }}>
                          {savedLink}
                        </a>
                        <button
                          onClick={() => navigator.clipboard.writeText(savedLink)}
                          style={{ background: 'var(--cream2)', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
