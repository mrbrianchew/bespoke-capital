"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase"

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

async function approveAdvisor(id: string, supabase: any) {
  await supabase.from('advisors').update({ status: 'approved' }).eq('id', id)
}

async function rejectAdvisor(id: string, supabase: any) {
  await supabase.from('advisors').delete().eq('id', id)
  const { createClient: createAdmin } = await import('@supabase/supabase-js')
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  await admin.auth.admin.deleteUser(id)
}

async function sendInvite(email: string): Promise<{ success?: boolean; error?: string }> {
  const res = await fetch('/api/invite-advisor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })
  return res.json()
}

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
]

function InviteAdvisorCard() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleInvite() {
    if (!email.trim()) return
    setStatus('loading')
    const result = await sendInvite(email.trim())
    if (result.error) { setErrorMsg(result.error); setStatus('error') }
    else { setStatus('success'); setEmail('') }
  }

  return (
    <div style={{ background: 'white', border: '0.5px solid #E0DDD6', borderRadius: 12, padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: '#F5EFE3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#A8834A' }}>👤</div>
        <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: '#A8834A', background: '#F5EFE3', padding: '3px 8px', borderRadius: 4 }}>Invite</span>
      </div>
      <p style={{ fontSize: 15, fontWeight: 500, color: '#1A1816', margin: '0 0 6px' }}>Invite Advisor</p>
      <p style={{ fontSize: 13, color: '#9A9690', margin: '0 0 16px', lineHeight: 1.5 }}>Send an invite email to a new advisor. They'll set their own password and be isolated to their own clients.</p>
      <input
        type="email"
        placeholder="advisor@email.com"
        value={email}
        onChange={e => { setEmail(e.target.value); setStatus('idle') }}
        onKeyDown={e => e.key === 'Enter' && handleInvite()}
        style={{ width: '100%', padding: '9px 12px', border: '1px solid #E0DDD6', borderRadius: 6, fontSize: 13, background: '#FAFAF8', marginBottom: 10, boxSizing: 'border-box' as const }}
      />
      {status === 'error' && <p style={{ fontSize: 12, color: '#C0392B', margin: '0 0 8px' }}>{errorMsg}</p>}
      {status === 'success' && <p style={{ fontSize: 12, color: '#27AE60', margin: '0 0 8px' }}>✓ Invite sent successfully</p>}
      <button
        onClick={handleInvite}
        disabled={status === 'loading' || !email.trim()}
        style={{ width: '100%', padding: '9px', background: status === 'loading' ? '#C4A882' : '#A8834A', color: 'white', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
      >
        {status === 'loading' ? 'Sending…' : 'Send Invite'}
      </button>
    </div>
  )
}

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
    await supabase.from('advisors').delete().eq('id', id)
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
      </div>
    </div>
  )
}
