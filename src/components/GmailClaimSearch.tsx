'use client'
import { useState } from 'react'

interface EmailMatch {
  id: string
  threadId: string
  subject: string
  from: string
  date: string
  permalink: string
}

export default function GmailClaimSearch({ claimId, defaultTerms }: { claimId: string; defaultTerms: string[] }) {
  const [open, setOpen] = useState(false)
  const [terms, setTerms] = useState<string[]>(defaultTerms.filter(Boolean))
  const [termInput, setTermInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConnect, setNeedsConnect] = useState(false)
  const [matches, setMatches] = useState<EmailMatch[] | null>(null)

  function addTerm() {
    const t = termInput.trim()
    if (t && !terms.includes(t)) setTerms(prev => [...prev, t])
    setTermInput('')
  }

  function removeTerm(t: string) {
    setTerms(prev => prev.filter(x => x !== t))
  }

  async function runSearch() {
    if (terms.length === 0) { setError('Add at least one search term (e.g. the policy number).'); return }
    setLoading(true)
    setError(null)
    setNeedsConnect(false)
    setMatches(null)
    try {
      const res = await fetch('/api/gmail/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, terms }),
      })
      const data = await res.json()
      if (res.status === 409 && (data.error === 'not_connected' || data.error === 'reconnect_required')) {
        setNeedsConnect(true)
      } else if (!res.ok) {
        setError(data.error || 'Search failed. Please try again.')
      } else {
        setMatches(data.matches || [])
      }
    } catch {
      setError('Search failed. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => { setOpen(o => !o); if (!open) { setMatches(null); setError(null); setNeedsConnect(false) } }}
        style={{ background: 'none', border: 'none', color: 'var(--ink2)', fontSize: 11, fontWeight: 700, padding: '4px 2px', cursor: 'pointer' }}>
        {open ? 'Close email search' : 'Search related emails'}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 8, width: 360, maxWidth: '90vw',
          background: 'white', border: '1px solid var(--line)', borderRadius: 10, padding: 16,
          boxShadow: '0 8px 28px rgba(0,0,0,0.12)', zIndex: 40,
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Search Gmail for this claim</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {terms.map(t => (
              <span key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--cream)',
                border: '1px solid var(--line)', borderRadius: 999, padding: '3px 8px', fontSize: 12, color: 'var(--ink)',
              }}>
                {t}
                <button onClick={() => removeTerm(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 12, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input
              value={termInput}
              onChange={e => setTermInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTerm() } }}
              placeholder="Add a term, e.g. claim reference"
              style={{ flex: 1, padding: '6px 8px', fontSize: 12.5, border: '1px solid var(--line)', borderRadius: 6, outline: 'none' }}
            />
            <button onClick={addTerm} style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--cream)', cursor: 'pointer' }}>Add</button>
          </div>

          <button onClick={runSearch} disabled={loading}
            style={{ width: '100%', padding: '8px 10px', fontSize: 12.5, fontWeight: 700, color: 'white', background: loading ? 'var(--ink2)' : 'var(--ink)', border: 'none', borderRadius: 6, cursor: loading ? 'default' : 'pointer' }}>
            {loading ? 'Searching…' : 'Search'}
          </button>

          {needsConnect && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--ink2)' }}>
              Gmail isn't connected yet. <a href="/dashboard/profile" style={{ color: 'var(--gold)', fontWeight: 700 }}>Connect it in your profile</a>, then search again.
            </div>
          )}

          {error && !needsConnect && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--rouge)' }}>{error}</div>
          )}

          {matches && matches.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--ink3)' }}>No matching emails found.</div>
          )}

          {matches && matches.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
              {matches.map(m => (
                <a key={m.id} href={m.permalink} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6, textDecoration: 'none' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{m.subject}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{m.from}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink3)', marginTop: 2 }}>{m.date}</div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}