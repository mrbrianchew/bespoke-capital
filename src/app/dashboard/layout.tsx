'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'
import DateInput from '@/components/DateInput'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Year-only age calculation (matches the convention used across the app —
// see dashboard/page.tsx getAge). DOB is the reliable source; the stored
// `age` column is stale and only used as a fallback when dob is missing.
function getAge(dob: string | null | undefined): number | null {
  if (!dob) return null
  const birth = new Date(dob)
  return Math.max(0, new Date().getFullYear() - birth.getFullYear())
}

const NAV = [
  { href: '/dashboard', label: 'Executive Summary', icon: '⊞', id: 'overview' },
  { href: '/dashboard/financials', label: 'Financial Profile', icon: '◎', id: 'factfinding' },
  { href: '/dashboard/objectives', label: 'Strategic Objectives', icon: '◉', id: 'objectives' },
  { href: '/dashboard/protection', label: 'Risk Management', icon: '◈', id: 'protection' },
  { href: '/dashboard/investments', label: 'Capital Mandate', icon: '◲', id: 'goals' },
  { href: '/dashboard/recommendations', label: 'Strategic Recommendations', icon: '◇', id: 'recommendations' },
  { href: '/dashboard/report', label: 'Financial Report', icon: '⊡', id: 'report' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null)
  const [advisor, setAdvisor] = useState<any>(null)
  const [clients, setClients] = useState<any[]>([])
  const [activeClient, setActiveClient] = useState<any>(null)
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [showClientModal, setShowClientModal] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  useEffect(() => { checkAuth() }, [])

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    setUser(user)
    const { data: adv } = await supabase.from('advisors').select('*').eq('id', user.id).maybeSingle()
    if (adv) setAdvisor(adv)
    const { data: cls } = await supabase.from('clients').select('*').order('name', { ascending: true })
    if (cls) { setClients(cls); if (cls.length > 0) { const savedId = localStorage.getItem('selectedClientId'); const match = cls.find((c: any) => c.id === savedId); const selected = match || cls[0]; setActiveClient(selected); localStorage.setItem('selectedClientId', selected.id) } }
  }

  async function deleteClient(clientId: string) {
    if (!confirm('Delete this client? This cannot be undone.')) return
    await supabase.from('fact_finding').delete().eq('client_id', clientId)
    await supabase.from('family_members').delete().eq('client_id', clientId)
    await supabase.from('clients').delete().eq('id', clientId)
    const remaining = clients.filter(c => c.id !== clientId)
    setClients(remaining)
    if (activeClient?.id === clientId) {
      if (remaining.length > 0) {
        setActiveClient(remaining[0])
        localStorage.setItem('selectedClientId', remaining[0].id)
        window.location.reload()
      } else {
        localStorage.removeItem('selectedClientId')
        setActiveClient(null)
      }
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  const initials = (name: string) => name?.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const activeTab = NAV.find(n => pathname === n.href || (n.id !== 'overview' && pathname.startsWith(n.href)))?.id || 'overview'
  const filteredClients = clients
    .filter(c => c.name?.toLowerCase().includes(clientSearch.trim().toLowerCase()))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--cream)' }}>
      <aside className="sidebar-scroll flex flex-col overflow-y-auto flex-shrink-0" style={{ width: 240, background: 'white', borderRight: '1px solid var(--line)' }}>
        <div className="px-6 py-7" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-lg font-semibold" style={{ color: 'var(--ink)' }}>{advisor?.firm || 'Bespoke Heartwork'}</div>
<div className="text-xs tracking-widest uppercase mt-0.5" style={{ color: 'var(--ink3)' }}>Financial Plan</div>
        </div>
        <div className="relative px-3 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
          <button onClick={() => setShowClientDrop(!showClientDrop)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md transition-colors text-left"
            style={{ background: 'var(--cream)', border: '1px solid var(--line)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'}>
            {activeClient ? (
              <>
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-serif text-xs text-white flex-shrink-0" style={{ background: '#C4A882' }}>{initials(activeClient.name)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{activeClient.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Age {getAge(activeClient.dob) ?? activeClient.age ?? '?'}</div>
                </div>
                <span className="text-xs" style={{ color: 'var(--ink3)' }}>⌄</span>
              </>
            ) : (<span className="text-sm" style={{ color: 'var(--ink3)' }}>Select client…</span>)}
          </button>
          {showClientDrop && (
            <div className="absolute left-3 right-3 top-full mt-1 z-50 shadow-lg" style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 6 }}>
              <div className="px-2 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
                <input autoFocus type="text" value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                  placeholder="Search clients…" className="w-full px-2.5 py-1.5 text-sm outline-none"
                  style={{ background: 'var(--cream)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--ink)' }} />
              </div>
              <div style={{ maxHeight: 168, overflowY: 'auto' }}>
              {filteredClients.length === 0 && (
                <div className="px-3 py-3 text-sm" style={{ color: 'var(--ink3)' }}>No clients found</div>
              )}
              {filteredClients.map(c => (
                <button key={c.id} onClick={() => { setActiveClient(c); localStorage.setItem('selectedClientId', c.id); window.location.reload(); setShowClientDrop(false); setClientSearch('') }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
                  style={{ background: activeClient?.id === c.id ? 'var(--gold-l)' : 'transparent', borderLeft: activeClient?.id === c.id ? '2px solid var(--gold)' : '2px solid transparent' }}
                  onMouseEnter={e => { if (activeClient?.id !== c.id) (e.currentTarget as HTMLElement).style.background = 'var(--cream)' }}
                  onMouseLeave={e => { if (activeClient?.id !== c.id) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center font-serif text-xs text-white flex-shrink-0" style={{ background: activeClient?.id === c.id ? 'var(--gold)' : 'var(--ink2)' }}>{initials(c.name)}</div>
                  <div>
                    <div className="text-sm font-medium" style={{ color: activeClient?.id === c.id ? 'var(--gold-tag)' : 'var(--ink)' }}>{c.name}</div><button onClick={e => { e.stopPropagation(); deleteClient(c.id) }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#C0392B', cursor: 'pointer', fontSize: 13, padding: '0 6px' }}>✕</button>
                    <div className="text-xs" style={{ color: 'var(--ink3)' }}>Age {getAge(c.dob) ?? c.age ?? '?'}</div>
                  </div>
                  {activeClient?.id === c.id && <span className="ml-auto text-xs" style={{ color: 'var(--gold)' }}>✓</span>}
                </button>
              ))}
              </div>
              <div style={{ borderTop: '1px solid var(--line)', padding: '8px' }}>
                <button onClick={() => { setShowClientModal(true); setShowClientDrop(false); setClientSearch('') }}
                  className="w-full text-left text-xs px-2 py-2 transition-colors" style={{ color: 'var(--ink3)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--gold)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--ink3)'}>
                  + Add New Client
                </button>
              </div>
            </div>
          )}
        </div>
        <nav className="flex-1 px-3 py-2">
          {NAV.map(item => (
            <Link key={item.id} href={item.href}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded transition-all mb-0.5 text-sm"
              style={{ color: activeTab === item.id ? 'var(--gold-tag)' : 'var(--ink3)', background: activeTab === item.id ? 'var(--gold-l)' : 'transparent', fontWeight: activeTab === item.id ? 500 : 400 }}>
              <span className="text-base w-4 text-center">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        {user?.id === process.env.NEXT_PUBLIC_CREATOR_ID && (
          <div className="px-3 py-3" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="px-3 mb-1 text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Admin</div>
            <Link href="/admin" className="flex items-center gap-2.5 px-3 py-2.5 rounded transition-all text-sm" style={{ color: pathname.startsWith('/admin') ? 'var(--gold-tag)' : 'var(--ink3)', background: pathname.startsWith('/admin') ? 'var(--gold-l)' : 'transparent' }}>
              <span className="text-base w-4 text-center">&#9881;</span> Admin Hub
            </Link>
          </div>
        )}
        <div className="px-6 py-4" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>{advisor?.name || user?.email}</div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/profile" className="text-xs transition-colors"
              style={{ color: pathname === '/dashboard/profile' ? 'var(--gold-tag)' : 'var(--ink3)' }}
              onMouseEnter={e => { if (pathname !== '/dashboard/profile') (e.currentTarget as HTMLElement).style.color = 'var(--gold)' }}
              onMouseLeave={e => { if (pathname !== '/dashboard/profile') (e.currentTarget as HTMLElement).style.color = 'var(--ink3)' }}>
              My Profile
            </Link>
            <button onClick={signOut} className="text-xs transition-colors" style={{ color: 'var(--ink3)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--rouge)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--ink3)'}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--cream)' }}>{children}</main>
      {showClientDrop && (<div className="fixed inset-0 z-40" onClick={() => { setShowClientDrop(false); setClientSearch('') }} />)}
      {showClientModal && (
        <AddClientModal
          userId={user?.id}
          onClose={() => setShowClientModal(false)}
          onSaved={async (client) => { setClients(prev => [client, ...prev]); setActiveClient(client); setShowClientModal(false) }}
        />
      )}
    </div>
  )
}

function AddClientModal({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: (c: any) => void }) {
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  function calcAge(dobStr: string) {
    if (!dobStr) return null
    const birth = new Date(dobStr)
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    const m = today.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
    return age
  }

  async function save() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!userId) { setError('Not logged in'); return }
    setLoading(true)
    const age = dob ? calcAge(dob) : null
    const { data, error: err } = await supabase.from('clients').insert({
      name: name.trim(), dob: dob || null, gender: gender || null,
      age, advisor_id: userId
    }).select().single()
    if (err) { setError(err.message); setLoading(false); return }
    const categories = ['Will / Estate Planning', 'Investments Planning', 'Wealth Protection (Life)', 'Health / Medical Insurance', 'Critical Illness Coverage', 'Disability Income Protection', 'Education Planning']
    await supabase.from('planning_checklist').insert(categories.map(category => ({ client_id: data.id, category, status: 'pending' })))
    onSaved(data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-md" style={{ background: 'white', borderRadius: 8 }}>
        <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-xl">Add New Client</div>
        </div>
        <div className="px-6 py-5 space-y-4">
          {[{ label: 'Full Name', type: 'text', val: name, set: setName, req: true, ph: 'e.g. Andy Au' }].map(f => (
            <div key={f.label}>
              <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>{f.label}</label>
              <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)} required={f.req} placeholder={f.ph} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--cream)' }} />
            </div>
          ))}
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Date of Birth</label>
            <DateInput value={dob} onChange={setDob} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--cream)' }} />
          </div>
          <div>
            <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Gender</label>
            <select value={gender} onChange={e => setGender(e.target.value)} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--cream)' }}>
              <option value="">— Select —</option><option>Male</option><option>Female</option>
            </select>
          </div>
          {error && <div className="text-sm px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>{error}</div>}
        </div>
        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Cancel</button>
          <button onClick={save} disabled={loading} className="px-4 py-2 text-sm font-medium text-white" style={{ background: loading ? 'var(--ink2)' : 'var(--ink)' }}>{loading ? 'Saving…' : 'Save Client'}</button>
        </div>
      </div>
    </div>
  )
}
