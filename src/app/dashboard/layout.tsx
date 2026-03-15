'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: '⊞', id: 'overview' },
  { href: '/dashboard/factfinding', label: 'Fact Finding', icon: '◎', id: 'factfinding' },
  { href: '/dashboard/protection', label: 'Wealth Protection', icon: '◈', id: 'protection' },
  { href: '/dashboard/goals', label: 'Investment Goals', icon: '◲', id: 'goals' },
  { href: '/dashboard/recommendations', label: 'Recommendations', icon: '◇', id: 'recommendations' },
  { href: '/dashboard/report', label: 'Report & PDF', icon: '⊡', id: 'report' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null)
  const [advisor, setAdvisor] = useState<any>(null)
  const [clients, setClients] = useState<any[]>([])
  const [activeClient, setActiveClient] = useState<any>(null)
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [showClientModal, setShowClientModal] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  useEffect(() => {
    checkAuth()
  }, [])

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    setUser(user)
    const { data: adv } = await supabase.from('advisors').select('*').eq('id', user.id).single()
    if (adv) setAdvisor(adv)
    const { data: cls } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
    if (cls) {
      setClients(cls)
      if (cls.length > 0) setActiveClient(cls[0])
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  const initials = (name: string) => name?.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
  const activeTab = NAV.find(n => pathname === n.href || (n.id !== 'overview' && pathname.startsWith(n.href)))?.id || 'overview'

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--cream)' }}>
      <aside className="sidebar-scroll flex flex-col overflow-y-auto flex-shrink-0"
        style={{ width: 240, background: 'white', borderRight: '1px solid var(--line)' }}>
        <div className="px-6 py-7" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-lg font-semibold" style={{ color: 'var(--ink)' }}>Bespoke Capital</div>
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
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-serif text-xs text-white flex-shrink-0"
                  style={{ background: '#C4A882' }}>
                  {initials(activeClient.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>{activeClient.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>Age {activeClient.age || '?'} · Since {activeClient.start_year || '?'}</div>
                </div>
                <span className="text-xs" style={{ color: 'var(--ink3)' }}>⌄</span>
              </>
            ) : (
              <span className="text-sm" style={{ color: 'var(--ink3)' }}>Select client…</span>
            )}
          </button>
          {showClientDrop && (
            <div className="absolute left-3 right-3 top-full mt-1 z-50 overflow-hidden shadow-lg"
              style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 6 }}>
              {clients.map(c => (
                <button key={c.id} onClick={() => { setActiveClient(c); setShowClientDrop(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
                  style={{ background: activeClient?.id === c.id ? 'var(--gold-l)' : 'transparent', borderLeft: activeClient?.id === c.id ? '2px solid var(--gold)' : '2px solid transparent' }}
                  onMouseEnter={e => { if (activeClient?.id !== c.id) (e.currentTarget as HTMLElement).style.background = 'var(--cream)' }}
                  onMouseLeave={e => { if (activeClient?.id !== c.id) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center font-serif text-xs text-white flex-shrink-0"
                    style={{ background: activeClient?.id === c.id ? 'var(--gold)' : 'var(--ink2)' }}>
                    {initials(c.name)}
                  </div>
                  <div>
                    <div className="text-sm font-medium" style={{ color: activeClient?.id === c.id ? 'var(--gold-tag)' : 'var(--ink)' }}>{c.name}</div>
                    <div className="text-xs" style={{ color: 'var(--ink3)' }}>Age {c.age || '?'}</div>
                  </div>
                  {activeClient?.id === c.id && <span className="ml-auto text-xs" style={{ color: 'var(--gold)' }}>✓</span>}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--line)', padding: '8px' }}>
                <button onClick={() => { setShowClientModal(true); setShowClientDrop(false) }}
                  className="w-full text-left text-xs px-2 py-2 transition-colors"
                  style={{ color: 'var(--ink3)' }}
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
        <div className="px-6 py-4" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="text-xs mb-1" style={{ color: 'var(--ink3)' }}>{advisor?.name || user?.email}</div>
          <button onClick={signOut} className="text-xs transition-colors" style={{ color: 'var(--ink3)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--rouge)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--ink3)'}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--cream)' }}>
        {children}
      </main>
      {showClientDrop && (<div className="fixed inset-0 z-40" onClick={() => setShowClientDrop(false)} />)}
      {showClientModal && (
        <AddClientModal onClose={() => setShowClientModal(false)} onSaved={async (client) => { setClients(prev => [client, ...prev]); setActiveClient(client); setShowClientModal(false) }} />
      )}
    </div>
  )
}

function AddClientModal({ onClose, onSaved }: { onClose: () => void; onSaved: (c: any) => void }) {
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState('')
  const [startYear, setStartYear] = useState('')
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
    setLoading(true)
    const age = dob ? calcAge(dob) : null
    const { data, error: err } = await supabase.from('clients').insert({ name: name.trim(), dob: dob || null, gender: gender || null, age, start_year: startYear ? parseInt(startYear) : null }).select().single()
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
          {[{ label: 'Full Name', type: 'text', val: name, set: setName, req: true, ph: 'e.g. Andy Au' }, { label: 'Date of Birth', type: 'date', val: dob, set: setDob, req: false, ph: '' }, { label: 'Investment Start Year', type: 'number', val: startYear, set: setStartYear, req: false, ph: 'e.g. 2019' }].map(f => (
            <div key={f.label}>
              <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>{f.label}</label>
              <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)} required={f.req} placeholder={f.ph} className="w-full px-3 py-2.5 text-sm outline-none" style={{ border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--cream)' }} />
            </div>
          ))}
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