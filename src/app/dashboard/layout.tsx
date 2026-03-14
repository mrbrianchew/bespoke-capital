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
      <aside className="sidebar-scroll flex flex-col overflow-y-auto flex-shrink-0" style={{ width: 240, background: 'white', borderRight: '1px solid var(--line)' }}>
        <div className="px-6 py-7" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-lg font-semibold" style={{ color: 'var(--ink)' }}>Bespoke Capital</div>
          <div className="text-xs tracking-widest uppercase mt-0.5" style={{ color: 'var(--ink3)' }}>Financial Plan</div>
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
          <button onClick={signOut} className="text-xs transition-colors" style={{ color: 'var(--ink3)' }}>Sign out</button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--cream)' }}>{children}</main>
    </div>
  )
}