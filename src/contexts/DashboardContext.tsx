'use client'

// Shared auth/client context for the dashboard.
//
// Root cause of the multi-second dashboard load times (July 2026 perf
// investigation): every dashboard page independently called
// supabase.auth.getUser() (a real network round-trip) and independently
// re-fetched the `clients` table, even though dashboard/layout.tsx already
// fetched both. On a small Supabase compute tier (max_connections=60), those
// redundant concurrent requests queue for DB connections — that's what was
// actually costing multiple seconds per page load, not query execution
// (confirmed fast via pg_stat_statements) and not missing indexes (already
// fixed separately).
//
// This context fetches user + advisor + clients ONCE in the layout and
// exposes them to every child page. Pages that need client-specific data
// (fact_finding, family_members, etc.) still fetch that themselves — only
// the redundant auth/clients calls are centralized here.

import { createContext, useContext, useEffect, useState, useCallback, Dispatch, SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export interface Advisor {
  id: string
  name: string | null
  firm: string | null
  email: string | null
  status: string | null
  [key: string]: any
}

export interface ClientRow {
  id: string
  advisor_id: string
  name: string
  dob: string | null
  gender: string | null
  age: number | null
  start_year: number | null
  notes: string | null
  created_at: string
  updated_at: string
  [key: string]: any
}

interface DashboardContextValue {
  user: any | null
  advisor: Advisor | null
  clients: ClientRow[]
  activeClient: ClientRow | null
  activeClientId: string | null
  spouseNames: Record<string, string>
  // True until the initial auth/advisor/clients fetch resolves (or redirects
  // to /auth). Child pages should hold their own loading state until this
  // clears before firing client-specific fetches.
  authLoading: boolean
  setActiveClient: Dispatch<SetStateAction<ClientRow | null>>
  setClients: Dispatch<SetStateAction<ClientRow[]>>
  setAdvisor: Dispatch<SetStateAction<Advisor | null>>
  setSpouseNames: Dispatch<SetStateAction<Record<string, string>>>
  // Patches fields on the active client both in `activeClient` and in the
  // matching row of `clients`, so the sidebar and any page reading either
  // stay in sync after an update (e.g. renaming a client on the Executive
  // Summary page now updates the sidebar label too).
  updateActiveClientFields: (fields: Partial<ClientRow>) => void
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error('useDashboard must be used within a DashboardProvider')
  return ctx
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null)
  const [advisor, setAdvisor] = useState<Advisor | null>(null)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [activeClient, setActiveClient] = useState<ClientRow | null>(null)
  const [spouseNames, setSpouseNames] = useState<Record<string, string>>({})
  const [authLoading, setAuthLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => { checkAuth() }, [])

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    // advisors and clients both depend only on the authenticated user (RLS
    // scopes clients to the requesting advisor), not on each other — fire
    // them together instead of waiting for the approval check to resolve
    // first. If the advisor turns out not to be approved we just discard
    // the clients result below; the query itself is harmless.
    const [{ data: adv }, { data: cls }] = await Promise.all([
      supabase.from('advisors').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('clients').select('*').order('name', { ascending: true }),
    ])
    // Re-check approval status on every load, not just at login — otherwise a
    // suspended advisor with an existing session keeps full access until it
    // expires. This also covers advisors who never got approved in the first place.
    if (!adv || adv.status !== 'approved') {
      await supabase.auth.signOut()
      router.push('/auth')
      return
    }
    setUser(user)
    setAdvisor(adv)
    if (cls) {
      setClients(cls)
      if (cls.length > 0) {
        const savedId = localStorage.getItem('selectedClientId')
        const match = cls.find((c: any) => c.id === savedId)
        const selected = match || cls[0]
        setActiveClient(selected)
        localStorage.setItem('selectedClientId', selected.id)
      }
      const clientIds = cls.map((c: any) => c.id)
      if (clientIds.length > 0) {
        const { data: spouses } = await supabase.from('family_members').select('client_id, name').eq('relationship', 'Spouse').in('client_id', clientIds)
        if (spouses) {
          const map: Record<string, string> = {}
          spouses.forEach((s: any) => { if (s.name) map[s.client_id] = s.name })
          setSpouseNames(map)
        }
      }
    }
    setAuthLoading(false)
  }

  const updateActiveClientFields = useCallback((fields: Partial<ClientRow>) => {
    setActiveClient(prev => (prev ? { ...prev, ...fields } : prev))
    setClients(prev => prev.map(c => (activeClient && c.id === activeClient.id ? { ...c, ...fields } : c)))
  }, [activeClient])

  const value: DashboardContextValue = {
    user,
    advisor,
    clients,
    activeClient,
    activeClientId: activeClient?.id ?? null,
    spouseNames,
    authLoading,
    setActiveClient,
    setClients,
    setAdvisor,
    setSpouseNames,
    updateActiveClientFields,
  }

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}