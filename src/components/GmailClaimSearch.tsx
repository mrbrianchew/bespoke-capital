'use client'
import { useEffect, useState } from 'react'

interface EmailMatch {
  id: string
  threadId: string
  subject: string
  from: string
  date: string
  permalink: string
}

// Session-only cache (resets on a full page reload — deliberately not
// sessionStorage/localStorage, since email metadata shouldn't sit in
// browser storage any longer than the tab is open). Keyed by whichever id
// is in play (claim or service request) so reopening the same one within
// the same tab shows the last results instantly instead of forcing a
// re-search. A different id always starts fresh.
const searchCache: Record<string, { terms: string[]; matches: EmailMatch[] | null; searched: boolean }> = {}

// Renders as its own collapsible section (matching the Documents section's
// header style directly above it in servicing/claims/page.tsx) rather than a
// floating dropdown — the earlier dropdown version got silently clipped by a
// parent with overflow:hidden. Defaults to collapsed so the claim page
// doesn't grow taller for advisors who never use this feature.
//
// Reused as-is by the Service Requests board — pass serviceRequestId
// instead of claimId and everything else (caching, rate limiting, audit
// log) is handled identically server-side. New Business cases use
// newBusinessCaseId the same way. Exactly one of the three must be given;
// which one is present is what /api/gmail/search uses to decide which
// table to check ownership against.
export default function GmailClaimSearch({ claimId, serviceRequestId, newBusinessCaseId, defaultTerms, keySuffix }: { claimId?: string; serviceRequestId?: string; newBusinessCaseId?: string; defaultTerms: string[]; keySuffix?: string }) {
  // keySuffix distinguishes multiple panels that share the same underlying
  // target id — e.g. one GmailClaimSearch per product on a New Business
  // case, all passing the same newBusinessCaseId (that's what the API's
  // ownership check and audit log key off), but each needing its own
  // session cache slot so they don't show each other's search results.
  // Never sent to the API — server-side scoping is unchanged.
  const cacheKey = (claimId || serviceRequestId || newBusinessCaseId || '') + (keySuffix ? `:${keySuffix}` : '')
  const cached = searchCache[cacheKey]
  const [expanded, setExpanded] = useState(false)
  const [terms, setTerms] = useState<string[]>(cached?.terms || defaultTerms.filter(Boolean))
  const [termInput, setTermInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConnect, setNeedsConnect] = useState(false)
  const [matches, setMatches] = useState<EmailMatch[] | null>(cached?.matches ?? null)
  const [searched, setSearched] = useState(cached?.searched || false)

  // Keeps the cache in sync so the next mount for this same id (modal
  // reopened, page revisited) picks up right where this one left off.
  useEffect(() => {
    searchCache[cacheKey] = { terms, matches, searched }
  }, [cacheKey, terms, matches, searched])

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
    try {
      const res = await fetch('/api/gmail/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, serviceRequestId, newBusinessCaseId, terms }),
      })
      const data = await res.json()
      if (res.status === 409 && (data.error === 'not_connected' || data.error === 'reconnect_required')) {
        setNeedsConnect(true)
        setMatches(null)
      } else if (!res.ok) {
        setError(data.error || 'Search failed. Please try again.')
        setMatches(null)
      } else {
        setMatches(data.matches || [])
      }
    } catch {
      setError('Search failed. Please try again.')
      setMatches(null)
    }
    setSearched(true)
    setLoading(false)
  }

  return (
    <div style={{ marginTop: 20 }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: expanded ? 10 : 0, padding: '0 2px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}>
        <div>
          <div className="claims-serif" style={{ fontSize: 19, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 10 }}>
            Related emails
            {matches !== null && (
              <span className="claims-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--charcoal)', background: 'var(--gold)', borderRadius: 999, padding: '3px 11px', lineHeight: 1.3 }}>
                {matches.length}
              </span>
            )}
          </div>
          <div style={{ fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink3)', fontWeight: 700 }}>
            {searched && terms.length > 0 ? `Gmail · matched on ${terms.join(', ')}` : 'Search Gmail for related emails'}
          </div>
        </div>
        <span style={{ color: 'var(--ink3)', fontSize: 14, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s', display: 'inline-block', flexShrink: 0 }}>▾</span>
      </button>

      {expanded && (
        <div style={{ background: 'var(--cream)', border: '1px solid var(--line)', borderRadius: 14, padding: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {terms.map(t => (
              <span key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, background: 'white',
                border: '1px solid var(--line)', borderRadius: 999, padding: '3px 8px', fontSize: 12, color: 'var(--ink)',
              }}>
                {t}
                <button onClick={() => removeTerm(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)', fontSize: 12, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 12, maxWidth: 480 }}>
            <input
              value={termInput}
              onChange={e => setTermInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTerm() } }}
              placeholder="Add a term, e.g. claim reference"
              style={{ flex: 1, padding: '6px 8px', fontSize: 12.5, border: '1px solid var(--line)', borderRadius: 6, outline: 'none', background: 'white' }}
            />
            <button onClick={addTerm} style={{ padding: '6px 10px', fontSize: 12, border: '1px solid var(--line)', borderRadius: 6, background: 'white', cursor: 'pointer' }}>Add</button>
            <button onClick={runSearch} disabled={loading}
              style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, color: 'white', background: loading ? 'var(--ink2)' : 'var(--ink)', border: 'none', borderRadius: 6, cursor: loading ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>

          {needsConnect && (
            <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
              Gmail isn't connected yet. <a href="/dashboard/profile" style={{ color: 'var(--gold)', fontWeight: 700 }}>Connect it in your profile</a>, then search again.
            </div>
          )}

          {error && !needsConnect && (
            <div style={{ fontSize: 12.5, color: 'var(--rouge)' }}>{error}</div>
          )}

          {matches && matches.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--ink3)' }}>No matching emails found.</div>
          )}

          {matches && matches.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {matches.map((m, i) => (
                <a key={m.id} href={m.permalink} target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    padding: '10px 6px', borderTop: i === 0 ? 'none' : '1px solid var(--line)', textDecoration: 'none',
                  }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.subject}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.from}</div>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink3)', flexShrink: 0 }}>{m.date}</div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}