"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase"

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
    if (!confirm('Reject and delete this advisor account? This cannot be undone.')) return
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

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] || { bg: '#F0EDE6', color: '#9A9690', label: status }
  return (
    <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: s.color, background: s.bg, padding: '3px 8px', borderRadius: 4 }}>
      {s.label}
    </span>
  )
}

function RegisteredAdvisorsCard() {
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
    if (!confirm('Suspend this advisor? They will be signed out and unable to log in until reactivated. Their data is kept.')) return
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
    if (!confirm(`Permanently delete ${name || 'this advisor'}? This deletes their login and cascades to all of their clients' data. This cannot be undone.`)) return
    setActionId(id)
    await fetch('/api/delete-advisor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setAdvisors(prev => prev.filter(a => a.id !== id))
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
                <th style={{ padding: '8px', fontWeight: 500 }}>Joined</th>
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
                    <td style={{ padding: '10px 8px', color: '#9A9690', fontFamily: 'DM Mono, monospace' }}>
                      {a.created_at ? new Date(a.created_at).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
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
      </div>
    </div>
  )
}
