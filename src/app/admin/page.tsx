"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase"
import { useConfirm } from "@/components/ConfirmDialog"

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

const ADMIN_SECTIONS = [
  {
    title: "CPF Settings",
    description: "Update Ordinary Wage and Additional Wage ceilings annually when CPF Board announces changes.",
    href: "/admin/cpf-settings",
    icon: "⚙",
    tag: "Annual update",
  },
  {
    title: "University Education Costs",
    description: "Update annual tuition and living expense estimates by university type. Used in Education Fund calculations across Wealth Protection and Education Planning.",
    href: "/dashboard/admin/uni-costs",
    icon: "🎓",
    tag: "As needed",
  },
  {
    title: "Insurance Reference Data",
    description: "Manage policy types, companies and products for the Wealth Protection Portfolio dropdowns. Add, edit or remove items per insurance category.",
    href: "/admin/insurance",
    icon: "🛡",
    tag: "As needed",
  },
  {
    title: "Medisave Withdrawal Limits",
    description: "Configure Integrated Shield Plan Medisave withdrawal limits by age band. Changes apply instantly to all recommendation cards.",
    href: "/admin/medisave-limits",
    icon: "🏥",
    tag: "As needed",
  },
]

function PendingAdvisorsCard() {
  const confirmAction = useConfirm()
  const [pending, setPending] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/get-pending-advisors')
      .then(r => r.json())
      .then(data => { setPending(data || []); setLoading(false) })
  }, [])

 async function handleApprove(id: string) {
    setActionId(id)
    await fetch('/api/approve-advisor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setPending(prev => prev.filter(a => a.id !== id))
    setActionId(null)
  }

 async function handleReject(id: string) {
    if (!await confirmAction('Reject and delete this advisor account? This cannot be undone.')) return
    setActionId(id)
    await fetch('/api/delete-advisor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setPending(prev => prev.filter(a => a.id !== id))
    setActionId(null)
  }

  return (
    <div style={{ background: 'white', border: '0.5px solid #E0DDD6', borderRadius: 12, padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: '#FFF3E0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⏳</div>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#A8834A', background: '#F5EFE3', padding: '3px 8px', borderRadius: 4 }}>
          {loading ? '…' : pending.length} Pending
        </span>
      </div>
      <p style={{ fontSize: 15, fontWeight: 500, color: '#1A1816', margin: '0 0 6px' }}>Pending Approvals</p>
      <p style={{ fontSize: 13, color: '#9A9690', margin: '0 0 16px', lineHeight: 1.5 }}>Advisors who have signed up and are awaiting your approval.</p>
      {loading && <p style={{ fontSize: 13, color: '#9A9690' }}>Loading…</p>}
      {!loading && pending.length === 0 && <p style={{ fontSize: 13, color: '#9A9690' }}>No pending approvals.</p>}
      {pending.map(a => (
        <div key={a.id} style={{ padding: '10px 0', borderTop: '1px solid #F0EDE6' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1816' }}>{a.name || '—'}</div>
          <div style={{ fontSize: 12, color: '#9A9690', marginBottom: 8 }}>{a.email}{a.firm ? ` · ${a.firm}` : ''}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleApprove(a.id)} disabled={actionId === a.id}
              style={{ flex: 1, padding: '7px', background: '#2D5A4E', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
              {actionId === a.id ? '…' : '✓ Approve'}
            </button>
            <button onClick={() => handleReject(a.id)} disabled={actionId === a.id}
              style={{ flex: 1, padding: '7px', background: 'white', color: '#C0392B', border: '1px solid #C0392B', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
              ✕ Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  approved: { bg: '#EAF3EF', color: '#2D5A4E', label: 'Active' },
  pending: { bg: '#FFF3E0', color: '#A8834A', label: 'Pending' },
  suspended: { bg: '#FBEAEA', color: '#C0392B', label: 'Suspended' },
}

// Relative-time formatting for Last Active — easier to scan for "who's gone
// quiet" than a raw date. Falls back to the date itself past ~5 weeks.
function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMins < 60) return diffMins <= 1 ? 'Just now' : `${diffMins} min ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 35) return `${Math.floor(diffDays / 7)}w ago`
  return new Date(iso).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] || { bg: '#F0EDE6', color: '#9A9690', label: status }
  return (
    <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: s.color, background: s.bg, padding: '3px 8px', borderRadius: 4 }}>
      {s.label}
    </span>
  )
}

function RegisteredAdvisorsCard() {
  const confirmAction = useConfirm()
  const [advisors, setAdvisors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)

  function load() {
    setLoading(true)
    fetch('/api/get-all-advisors')
      .then(r => r.json())
      .then(data => { setAdvisors(Array.isArray(data) ? data : []); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function handleSuspend(id: string) {
    if (!await confirmAction('Suspend this advisor? They will be signed out and unable to log in until reactivated. Their data is kept.')) return
    setActionId(id)
    await fetch('/api/suspend-advisor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setAdvisors(prev => prev.map(a => a.id === id ? { ...a, status: 'suspended' } : a))
    setActionId(null)
  }

  async function handleReactivate(id: string) {
    setActionId(id)
    await fetch('/api/approve-advisor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setAdvisors(prev => prev.map(a => a.id === id ? { ...a, status: 'approved' } : a))
    setActionId(null)
  }

  async function handleDelete(id: string, name: string) {
    if (!await confirmAction(`Permanently delete ${name || 'this advisor'}? This deletes their login and cascades to all of their clients' data. This cannot be undone.`)) return
    setActionId(id)
    await fetch('/api/delete-advisor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setAdvisors(prev => prev.filter(a => a.id !== id))
    setActionId(null)
  }

  async function handleToggleFeature(id: string, feature: string, enabled: boolean) {
    setActionId(id)
    const res = await fetch('/api/toggle-extra-feature', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, feature, enabled }),
    })
    const data = await res.json()
    if (res.ok) setAdvisors(prev => prev.map(a => a.id === id ? { ...a, beta_features: data.beta_features } : a))
    setActionId(null)
  }

  return (
    <div style={{ gridColumn: '1 / -1', background: 'white', border: '0.5px solid #E0DDD6', borderRadius: 12, padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: '#1A1816', margin: 0 }}>Registered Advisors</p>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#9A9690', background: '#F5EFE3', padding: '3px 8px', borderRadius: 4 }}>
          {loading ? '…' : advisors.length} Total
        </span>
      </div>
      <p style={{ fontSize: 13, color: '#9A9690', margin: '0 0 16px', lineHeight: 1.5 }}>
        Every advisor account, regardless of status. Suspend to block access without deleting their data; delete to permanently remove the account and cascade-delete their clients.
      </p>
      {loading && <p style={{ fontSize: 13, color: '#9A9690' }}>Loading…</p>}
      {!loading && advisors.length === 0 && <p style={{ fontSize: 13, color: '#9A9690' }}>No registered advisors yet.</p>}
      {!loading && advisors.length > 0 && (
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' as const, color: '#9A9690', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>
                <th style={{ padding: '8px 8px 8px 0', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '8px', fontWeight: 500 }}>Email</th>
                <th style={{ padding: '8px', fontWeight: 500 }}>Firm</th>
                <th style={{ padding: '8px', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '8px', fontWeight: 500 }}>Servicing (Beta)</th>
                <th style={{ padding: '8px', fontWeight: 500 }}>Business Dashboard (Beta)</th>
                <th style={{ padding: '8px', fontWeight: 500 }}>Joined</th>
                <th style={{ padding: '8px', fontWeight: 500 }}>Last Active</th>
                <th style={{ padding: '8px 0 8px 8px', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {advisors.map(a => {
                const isCreator = a.id === CREATOR_ID
                const busy = actionId === a.id
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid #F0EDE6' }}>
                    <td style={{ padding: '10px 8px 10px 0', color: '#1A1816', fontWeight: 500 }}>{a.name || '—'}{isCreator && <span style={{ color: '#A8834A', fontWeight: 400 }}> · you</span>}</td>
                    <td style={{ padding: '10px 8px', color: '#4A4740' }}>{a.email}</td>
                    <td style={{ padding: '10px 8px', color: '#4A4740' }}>{a.firm || '—'}</td>
                    <td style={{ padding: '10px 8px' }}><StatusBadge status={a.status} /></td>
                    <td style={{ padding: '10px 8px' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: (busy || isCreator) ? 'default' : 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={isCreator || (Array.isArray(a.beta_features) && a.beta_features.includes('servicing'))}
                          disabled={busy || isCreator}
                          onChange={e => handleToggleFeature(a.id, 'servicing', e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: '#2D5A4E', cursor: (busy || isCreator) ? 'default' : 'pointer' }}
                        />
                        {isCreator && <span style={{ fontSize: 11, color: '#9A9690' }}>always on</span>}
                      </label>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      {(() => {
                        const servicingOn = isCreator || (Array.isArray(a.beta_features) && a.beta_features.includes('servicing'))
                        return (
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: (busy || isCreator || !servicingOn) ? 'default' : 'pointer' }}
                            title={!servicingOn && !isCreator ? 'Requires Servicing (Beta) — Claims Board reads the same claims data' : undefined}>
                            <input
                              type="checkbox"
                              checked={isCreator || (Array.isArray(a.beta_features) && a.beta_features.includes('business_dashboard'))}
                              disabled={busy || isCreator || !servicingOn}
                              onChange={e => handleToggleFeature(a.id, 'business_dashboard', e.target.checked)}
                              style={{ width: 16, height: 16, accentColor: '#2D5A4E', cursor: (busy || isCreator || !servicingOn) ? 'default' : 'pointer' }}
                            />
                            {isCreator && <span style={{ fontSize: 11, color: '#9A9690' }}>always on</span>}
                            {!isCreator && !servicingOn && <span style={{ fontSize: 11, color: '#9A9690' }}>needs Servicing</span>}
                          </label>
                        )
                      })()}
                    </td>
                    <td style={{ padding: '10px 8px', color: '#9A9690', fontFamily: 'DM Mono, monospace' }}>
                      {a.created_at ? new Date(a.created_at).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td style={{ padding: '10px 8px', color: a.last_active_at ? '#4A4740' : '#C0392B', fontFamily: 'DM Mono, monospace' }}>
                      {formatRelativeTime(a.last_active_at)}
                    </td>
                    <td style={{ padding: '10px 0 10px 8px' }}>
                      {isCreator ? (
                        <span style={{ color: '#9A9690', fontSize: 12 }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {a.status === 'suspended' ? (
                            <button onClick={() => handleReactivate(a.id)} disabled={busy}
                              style={{ padding: '5px 10px', background: '#2D5A4E', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
                              {busy ? '…' : 'Reactivate'}
                            </button>
                          ) : a.status === 'approved' ? (
                            <button onClick={() => handleSuspend(a.id)} disabled={busy}
                              style={{ padding: '5px 10px', background: 'white', color: '#A8834A', border: '1px solid #A8834A', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
                              {busy ? '…' : 'Suspend'}
                            </button>
                          ) : null}
                          <button onClick={() => handleDelete(a.id, a.name)} disabled={busy}
                            style={{ padding: '5px 10px', background: 'white', color: '#C0392B', border: '1px solid #C0392B', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>
                            {busy ? '…' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const TYPE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  bug: { bg: '#FBEAE7', color: '#7D2F22', label: 'Bug' },
  suggestion: { bg: '#EAF1EE', color: '#1E4237', label: 'Suggestion' },
}

function TypeBadge({ type }: { type: string }) {
  const s = TYPE_STYLE[type] || { bg: '#F0EDE6', color: '#9A9690', label: type }
  return (
    <span style={{ fontSize: 11, fontWeight: 500, color: s.color, background: s.bg, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' as const }}>
      {s.label}
    </span>
  )
}

function BugReportsCard() {
  const confirmAction = useConfirm()
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  function load() {
    setLoading(true)
    fetch('/api/get-bug-reports')
      .then(r => r.json())
      .then(data => { setReports(Array.isArray(data) ? data : []); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function setStatus(id: string, status: 'new' | 'resolved') {
    setActionId(id)
    await fetch('/api/update-bug-report-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r))
    setActionId(null)
  }

  async function deleteReport(id: string) {
    if (!await confirmAction('Permanently delete this report? This cannot be undone.')) return
    setActionId(id)
    await fetch('/api/delete-bug-report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setReports(prev => prev.filter(r => r.id !== id))
    setActionId(null)
  }

  const newReports = reports.filter(r => r.status === 'new')
  const resolvedReports = reports.filter(r => r.status === 'resolved')

  function Row({ r }: { r: any }) {
    const busy = actionId === r.id
    return (
      <div style={{ background: 'white', borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
          {r.screenshot_url && (
            <a href={r.screenshot_url} target="_blank" rel="noopener noreferrer">
              <img src={r.screenshot_url} alt="Screenshot" style={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 4, border: '0.5px solid #E0DDD6' }} />
            </a>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <TypeBadge type={r.type} />
            </div>
            <p style={{ fontSize: 13, color: '#1A1816', margin: 0, wordBreak: 'break-word' as const }}>{r.description}</p>
            <p style={{ fontSize: 11, color: '#9A9690', margin: '2px 0 0', fontFamily: 'DM Mono, monospace' }}>
              {r.advisor?.name || r.advisor?.email || 'Unknown'} · {new Date(r.created_at).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}
              {r.page_context ? ` · ${r.page_context}` : ''}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => setStatus(r.id, r.status === 'new' ? 'resolved' : 'new')}
            disabled={busy}
            style={{ padding: '6px 10px', background: 'white', color: r.status === 'new' ? '#2D5A4E' : '#9A9690', border: `1px solid ${r.status === 'new' ? '#2D5A4E' : '#D0CDC5'}`, borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' as const }}
          >
            {busy ? '…' : r.status === 'new' ? 'Mark resolved' : 'Reopen'}
          </button>
          <button
            onClick={() => deleteReport(r.id)}
            disabled={busy}
            title="Delete permanently"
            style={{ padding: '6px 8px', background: 'white', color: '#C0392B', border: '1px solid #C0392B', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 500 }}
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ gridColumn: '1 / -1', background: 'white', border: '0.5px solid #E0DDD6', borderRadius: 12, padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: '#1A1816', margin: 0 }}>Bug Reports and Suggestions</p>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#A8834A', background: '#F5EFE3', padding: '3px 8px', borderRadius: 4 }}>
          {loading ? '…' : newReports.length} New
        </span>
      </div>
      <p style={{ fontSize: 13, color: '#9A9690', margin: '0 0 16px', lineHeight: 1.5 }}>
        Submitted by advisors from the sidebar. Every report includes a screenshot.
      </p>
      {loading && <p style={{ fontSize: 13, color: '#9A9690' }}>Loading…</p>}
      {!loading && newReports.length === 0 && <p style={{ fontSize: 13, color: '#9A9690', marginBottom: 12 }}>No new reports.</p>}
      {!loading && newReports.map(r => <Row key={r.id} r={r} />)}

      {!loading && resolvedReports.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowResolved(s => !s)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#9A9690' }}
          >
            <span style={{ fontSize: 11, transform: showResolved ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>⌄</span>
            <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' as const }}>Resolved ({resolvedReports.length})</span>
          </button>
          {showResolved && <div style={{ marginTop: 10 }}>{resolvedReports.map(r => <Row key={r.id} r={r} />)}</div>}
        </div>
      )}
    </div>
  )
}

export default function AdminPage() {
  const router = useRouter()
  const supabase = createClient()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || user.id !== CREATOR_ID) { router.replace("/dashboard"); return }
      setChecking(false)
    }
    check()
  }, [])

  if (checking) return null

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2.5rem 2rem", fontFamily: "Inter, sans-serif" }}>
      <Link href="/dashboard" style={{ display: "inline-block", fontSize: 12, color: "#9A9690", marginBottom: 16, textDecoration: "none" }}>
        ← Back to Dashboard
      </Link>
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#9A9690", margin: "0 0 6px" }}>Creator</p>
        <h1 style={{ fontSize: 30, fontFamily: "Cormorant Garamond, serif", fontWeight: 600, color: "#1A1816", margin: "0 0 8px", lineHeight: 1.2 }}>Admin Hub</h1>
        <p style={{ fontSize: 14, color: "#4A4740", margin: 0 }}>Backend settings visible only to you. Changes apply instantly across all advisor accounts.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
        {ADMIN_SECTIONS.map(section => (
          <Link key={section.href} href={section.href} style={{ textDecoration: "none" }}>
            <div
              style={{ background: "white", border: "0.5px solid #E0DDD6", borderRadius: 12, padding: "1.5rem", cursor: "pointer", transition: "border-color 0.15s" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "#A8834A"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "#E0DDD6"}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, background: "#F5EFE3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#A8834A" }}>
                  {section.icon}
                </div>
                <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#A8834A", background: "#F5EFE3", padding: "3px 8px", borderRadius: 4 }}>
                  {section.tag}
                </span>
              </div>
              <p style={{ fontSize: 15, fontWeight: 500, color: "#1A1816", margin: "0 0 6px" }}>{section.title}</p>
              <p style={{ fontSize: 13, color: "#9A9690", margin: 0, lineHeight: 1.5 }}>{section.description}</p>
            </div>
          </Link>
        ))}
        <div style={{ background: "#F5F3EE", border: "0.5px dashed #D0CDC5", borderRadius: 12, padding: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: 13, color: "#9A9690", margin: 0, textAlign: "center" as const }}>More settings will appear here as the app grows.</p>
        </div>
        <PendingAdvisorsCard />
        <RegisteredAdvisorsCard />
        <BugReportsCard />
      </div>
    </div>
  )
}