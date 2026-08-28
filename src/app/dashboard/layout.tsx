'use client'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'
import DateInput from '@/components/DateInput'
import { DashboardProvider, useDashboard } from '@/contexts/DashboardContext'
import { useClientTabState } from '@/hooks/useClientTabState'
import BugReportModal from '@/components/BugReportModal'
import GlobalQuickAdd from '@/components/GlobalQuickAdd'
import IdleLogoutGuard from '@/components/IdleLogoutGuard'
import { fetchClaimsAttentionCount } from '@/lib/claimsAttention'
import { fetchServiceRequestsAttentionCount } from '@/lib/serviceRequestsAttention'
import { fetchNewBusinessAttentionCount } from '@/lib/newBusinessAttention'
import { fetchPremiumAlertsAttentionCount } from '@/lib/premiumAlertsAttention'
import { useConfirm } from '@/components/ConfirmDialog'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Year-only age calculation (matches the convention used across the app —
// see dashboard/page.tsx getAge). DOB is the reliable source; the stored
// `age` column is stale and only used as a fallback when dob is missing.
function getAge(dob: string | null | undefined): number | null {
  if (!dob) return null
  const birth = new Date(dob)
  return Math.max(0, new Date().getFullYear() - birth.getFullYear())
}

const NAV_PLANNING = [
  { href: '/dashboard', label: 'Executive Summary', icon: '⊞', id: 'overview' },
  { href: '/dashboard/financials', label: 'Financial Profile', icon: '◎', id: 'factfinding' },
  { href: '/dashboard/objectives', label: 'Strategic Objectives', icon: '◉', id: 'objectives' },
  { href: '/dashboard/protection', label: 'Risk Management', icon: '◈', id: 'protection' },
  { href: '/dashboard/investments', label: 'Capital Mandate', icon: '◲', id: 'goals' },
  { href: '/dashboard/recommendations', label: 'Strategic Recommendations', icon: '◇', id: 'recommendations' },
  { href: '/dashboard/report', label: 'Financial Report', icon: '⊡', id: 'report' },
]

const NAV_SERVICING = [
  { href: '/dashboard/servicing/contact-report', label: 'Contact Report', icon: '☎', id: 'contact-report' },
  { href: '/dashboard/servicing/claims', label: 'Medical Claims', icon: '⚑', id: 'claims' },
  { href: '/dashboard/servicing/service-requests', label: 'Service Requests', icon: '◑', id: 'servicing-service-requests' },
  { href: '/dashboard/servicing/new-business', label: 'New Applications', icon: '◐', id: 'servicing-new-business' },
]

type NavGroupId = 'planning' | 'servicing'

const NAV_GROUPS_ALL: { id: NavGroupId; label: string; items: typeof NAV_PLANNING; betaFlag?: string }[] = [
  { id: 'planning', label: 'Financial Planning', items: NAV_PLANNING },
  { id: 'servicing', label: 'Client Servicing', items: NAV_SERVICING, betaFlag: 'servicing' },
]

// Business Dashboard: the client-agnostic sidebar mode (see DashboardLayoutInner
// below). Naming convention going forward: plain noun, no UI-shape suffix
// ("Board," "Pipeline," "Desk") — plural for discrete trackable items
// (Claims, Service Requests), singular/gerund for ongoing process categories.
const NAV_BUSINESS: { href: string; label: string; icon: string; id: string; disabled?: boolean }[] = [
  { href: '/dashboard/business', label: 'Overview', icon: '◈', id: 'business-overview' },
  { href: '/dashboard/business/claims', label: 'Claims', icon: '▤', id: 'claims-board' },
  { href: '/dashboard/business/service-requests', label: 'Service Requests', icon: '◑', id: 'service-requests' },
  { href: '/dashboard/business/premium-alerts', label: 'Premium Alerts', icon: '⏰', id: 'premium-alerts' },
  { href: '/dashboard/business/new-business', label: 'New Business', icon: '◐', id: 'new-business' },
]

// Business Dashboard gating is intentionally stricter than a single flag:
// the Claims Board is a firm-wide read/write view over the same claims data
// as the per-client Medical Claims page, so an advisor without 'servicing'
// access would hit a hard wall the moment they clicked into a card. Require
// both flags rather than let that dead end exist. Creator bypasses both, same
// as every other beta flag.
function hasBusinessDashboardAccess(betaFeatures: string[] | null | undefined, advisorId?: string | null): boolean {
  const isCreator = !!advisorId && advisorId === CREATOR_ID
  if (isCreator) return true
  const flags = Array.isArray(betaFeatures) ? betaFeatures : []
  return flags.includes('business_dashboard') && flags.includes('servicing')
}

// Groups gated by betaFlag only render for advisors whose beta_features
// array (advisors.beta_features, jsonb) includes that flag. Ungated groups
// (Financial Planning) are always visible. This is how staged rollout works
// going forward: build behind a flag, then flip it on per-advisor in the DB —
// no redeploy needed to grant access.
// The creator (CREATOR_ID) always sees every beta-gated group by default,
// regardless of their own beta_features row — new features ship visible to
// Brian immediately, and only need the Admin Hub toggle for other advisors.
function visibleNavGroups(betaFeatures: string[] | null | undefined, advisorId?: string | null) {
  const isCreator = !!advisorId && advisorId === CREATOR_ID
  const flags = Array.isArray(betaFeatures) ? betaFeatures : []
  return NAV_GROUPS_ALL.filter(g => !g.betaFlag || isCreator || flags.includes(g.betaFlag))
}

// Matches overview's exact-match rule (no accidental prefix matches on '/dashboard')
// vs. every other item, which also matches nested routes under it.
function navItemMatches(item: { href: string; id: string }, pathname: string): boolean {
  return pathname === item.href || (item.id !== 'overview' && pathname.startsWith(item.href))
}

// Which group the current route belongs to, if any, among the groups this
// advisor can currently see. Pages outside all visible groups (e.g.
// /dashboard/profile, /admin) return null so the last-remembered group stays
// expanded instead of being overridden.
function routeGroupFor(groups: ReturnType<typeof visibleNavGroups>, pathname: string): NavGroupId | null {
  for (const group of groups) {
    if (group.items.some(item => navItemMatches(item, pathname))) return group.id
  }
  return null
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </DashboardProvider>
  )
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const {
    user, advisor, clients, activeClient, spouseNames,
    setActiveClient, setClients, updateActiveClientFields,
  } = useDashboard()
  const confirmAction = useConfirm()
  const { canInstall, promptInstall, isIOS, isStandalone } = useInstallPrompt()
  const [showClientDrop, setShowClientDrop] = useState(false)
  const [showClientModal, setShowClientModal] = useState(false)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showBugReport, setShowBugReport] = useState(false)
  const [adminBadgeCount, setAdminBadgeCount] = useState(0)
  const [claimsBadgeCount, setClaimsBadgeCount] = useState(0)
  const [serviceRequestsBadgeCount, setServiceRequestsBadgeCount] = useState(0)
  const [premiumAlertsBadgeCount, setPremiumAlertsBadgeCount] = useState(0)
  const [newBusinessBadgeCount, setNewBusinessBadgeCount] = useState(0)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  const [expandedGroup, setExpandedGroup] = useClientTabState<NavGroupId>('navGroup', 'planning')
  const visibleGroups = visibleNavGroups(advisor?.beta_features, advisor?.id)

  // Business Dashboard mode is derived from the route, not stored state —
  // it's just "am I under /dashboard/business". activeClient is untouched by
  // switching modes, so the previously open client is naturally still there
  // when the advisor switches back to Client Workspace.
  const businessAccess = hasBusinessDashboardAccess(advisor?.beta_features, advisor?.id)
  const isBusinessMode = businessAccess && pathname.startsWith('/dashboard/business')
  const businessActiveId = NAV_BUSINESS.find(item => pathname === item.href)?.id

  // Close the mobile drawer on every navigation — otherwise it stays open
  // over the new page since nothing else would trigger a close.
  useEffect(() => { setSidebarOpen(false) }, [pathname])

  // Route wins over whatever was last expanded whenever the current page
  // belongs to a visible group. On pages outside all visible groups (profile,
  // admin), the remembered value from useClientTabState is left alone.
  useEffect(() => {
    const routeGroup = routeGroupFor(visibleGroups, pathname)
    if (routeGroup && routeGroup !== expandedGroup) setExpandedGroup(routeGroup)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, advisor?.beta_features, advisor?.id])

  // Badge refresh cadence. These three counts used to be refetched on every
  // single navigation (keyed on `pathname`), which meant 5 DB queries + 1
  // auth-server round trip + 1 serverless invocation firing in the background
  // on every nav click, app-wide — not just on the pages the badges are
  // about. On a 60-max-connection Supabase tier that queues behind the
  // page's own data fetch and was the direct cause of the 10s+ load times
  // reported Aug 2026. Fixed by fetching once on mount, then refreshing on
  // an interval + tab-focus instead of on every route change. A badge count
  // does not need to be accurate to the second.
  const BADGE_REFRESH_MS = 3 * 60 * 1000

  // Claims attention badge — overdue/due-today follow-ups plus stale claim
  // line items with no follow-up tracked at all (see claimsAttention.ts).
  // Shown on the Business Dashboard toggle (visible in either mode) and on
  // the Claims Board nav item itself. Any advisor with business dashboard
  // access sees their own count — not creator-only, unlike the admin badge.
  useEffect(() => {
    if (!businessAccess) { setClaimsBadgeCount(0); return }
    let cancelled = false
    const refresh = () => fetchClaimsAttentionCount(supabase).then(count => { if (!cancelled) setClaimsBadgeCount(count) }).catch(() => {})
    refresh()
    const interval = setInterval(refresh, BADGE_REFRESH_MS)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', refresh) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessAccess])

  // Service Requests badge — count of open (not-done) requests. Same
  // firm-wide-via-RLS pattern as the claims badge above; shown on the
  // Business Dashboard toggle (summed with the claims count) and on the
  // Service Requests nav item itself.
  useEffect(() => {
    if (!businessAccess) { setServiceRequestsBadgeCount(0); return }
    let cancelled = false
    const refresh = () => fetchServiceRequestsAttentionCount(supabase).then(count => { if (!cancelled) setServiceRequestsBadgeCount(count) }).catch(() => {})
    refresh()
    const interval = setInterval(refresh, BADGE_REFRESH_MS)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', refresh) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessAccess])

  // Premium Alerts badge — overdue/due-today premium reminders only (not
  // "this week", to keep the badge meaning "needs action now" — see
  // premiumAlertsAttention.ts). Same firm-wide-via-RLS pattern as the two
  // badges above; shown on the Business Dashboard toggle (summed with the
  // others) and on the Premium Alerts nav item itself.
  useEffect(() => {
    if (!businessAccess) { setPremiumAlertsBadgeCount(0); return }
    let cancelled = false
    const refresh = () => fetchPremiumAlertsAttentionCount(supabase).then(count => { if (!cancelled) setPremiumAlertsBadgeCount(count) }).catch(() => {})
    refresh()
    const interval = setInterval(refresh, BADGE_REFRESH_MS)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', refresh) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessAccess])

  // New Business badge — overdue/due-today to-dos and meetings, plus cases
  // needing a follow-up (see fetchNewBusinessAttentionCount). Same
  // firm-wide-via-RLS pattern and refresh cadence as the two badges above.
  useEffect(() => {
    if (!businessAccess) { setNewBusinessBadgeCount(0); return }
    let cancelled = false
    const refresh = () => fetchNewBusinessAttentionCount(supabase).then(count => { if (!cancelled) setNewBusinessBadgeCount(count) }).catch(() => {})
    refresh()
    const interval = setInterval(refresh, BADGE_REFRESH_MS)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', refresh) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessAccess])

  // Admin Hub notification badge — pending advisor approvals + unresolved
  // bug reports. Creator-only. Refreshed on mount + interval + tab focus
  // rather than on every navigation (see BADGE_REFRESH_MS note above) — the
  // /api/get-admin-badge-counts route is the most expensive of the three,
  // since requireCreator() makes a real network round trip to Supabase's
  // auth server (auth.getUser()) on top of its own 2 DB queries.
  useEffect(() => {
    if (!user?.id || user.id !== CREATOR_ID) return
    let cancelled = false
    const refresh = () => fetch('/api/get-admin-badge-counts')
      .then(r => r.json())
      .then(data => { if (!cancelled) setAdminBadgeCount((data?.pendingAdvisors || 0) + (data?.newBugReports || 0)) })
      .catch(() => {})
    refresh()
    const interval = setInterval(refresh, BADGE_REFRESH_MS)
    window.addEventListener('focus', refresh)
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('focus', refresh) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function deleteClient(clientId: string) {
    if (!await confirmAction('Delete this client? This cannot be undone.', { danger: true, confirmLabel: 'Delete' })) return
    await supabase.from('fact_finding').delete().eq('client_id', clientId)
    await supabase.from('family_members').delete().eq('client_id', clientId)
    await supabase.from('clients').delete().eq('id', clientId)
    const remaining = clients.filter(c => c.id !== clientId)
    setClients(remaining)
    if (activeClient?.id === clientId) {
      if (remaining.length > 0) {
        setActiveClient(remaining[0])
        localStorage.setItem('selectedClientId', remaining[0].id)
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
  const activeTab = visibleGroups.flatMap(g => g.items).find(n => navItemMatches(n, pathname))?.id || 'overview'
  const filteredClients = clients
    .filter(c => {
      const q = clientSearch.trim().toLowerCase()
      if (!q) return true
      const nameMatch = c.name?.toLowerCase().includes(q)
      const spouseMatch = spouseNames[c.id]?.toLowerCase().includes(q)
      return nameMatch || spouseMatch
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--cream)' }}>
      {/* Mobile-only hamburger — hidden entirely at md+ where the sidebar is always visible */}
      <button onClick={() => setSidebarOpen(o => !o)}
        className="md:hidden fixed top-3 left-3 z-50 flex items-center justify-center"
        style={{ width: 40, height: 40, borderRadius: 999, background: 'white', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{sidebarOpen ? '✕' : '☰'}</span>
      </button>

      {/* Scrim behind the drawer on mobile only */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40" style={{ background: 'rgba(26,24,22,0.5)' }} onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`sidebar-scroll flex flex-col overflow-y-auto flex-shrink-0 fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-[calc(100%+16px)]'}`}
        style={{
          width: 240, margin: 16, borderRadius: 20,
          background: `linear-gradient(to right, transparent calc(100% - 1px), rgba(168,131,74,0.3) calc(100% - 1px), rgba(168,131,74,0.3) 100%),
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.02 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"),
            linear-gradient(180deg, #F8F6F1 0%, var(--cream) 45%, var(--cream2) 100%)`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8), inset 1px 0 0 rgba(255,255,255,0.4), 0 24px 60px rgba(28,26,23,0.14), 0 6px 16px rgba(28,26,23,0.08)',
        }}>
        <div className="px-6 py-7" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-lg font-semibold" style={{ color: 'var(--ink)' }}>{advisor?.firm || 'Bespoke Capital'}</div>
<div className="text-xs tracking-widest uppercase mt-0.5" style={{ color: 'var(--ink3)' }}>Financial Plan</div>
        </div>
        {businessAccess && (
          <div className="px-3 pt-3" style={{ borderBottom: isBusinessMode ? '1px solid var(--line)' : 'none' }}>
            <div className="flex" style={{ background: 'var(--cream)', border: '1px solid var(--line)', borderRadius: 8, padding: 2, marginBottom: 12 }}>
              <button onClick={() => router.push('/dashboard')}
                className="flex-1 text-center transition-colors"
                style={{ padding: '6px 4px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
                  color: !isBusinessMode ? 'white' : 'var(--ink3)', background: !isBusinessMode ? 'var(--charcoal)' : 'transparent' }}>
                Client Workspace
              </button>
              <button onClick={() => router.push('/dashboard/business')}
                className="flex-1 text-center transition-colors"
                style={{ padding: '6px 4px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, position: 'relative',
                  color: isBusinessMode ? 'white' : 'var(--ink3)', background: isBusinessMode ? 'var(--charcoal)' : 'transparent' }}>
                Business Dashboard
                {(claimsBadgeCount + serviceRequestsBadgeCount + premiumAlertsBadgeCount + newBusinessBadgeCount) > 0 && (
                  <span
                    className="flex items-center justify-center text-xs font-medium"
                    style={{ position: 'absolute', top: -6, right: -6, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--rouge)', color: 'white', lineHeight: 1, fontSize: 9.5 }}
                  >
                    {(claimsBadgeCount + serviceRequestsBadgeCount + premiumAlertsBadgeCount + newBusinessBadgeCount) > 99 ? '99+' : (claimsBadgeCount + serviceRequestsBadgeCount + premiumAlertsBadgeCount + newBusinessBadgeCount)}
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
        {!isBusinessMode && (
        <div className="relative px-3 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-stretch gap-1.5">
            <div role="button" tabIndex={0}
              onClick={() => setShowClientDrop(!showClientDrop)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setShowClientDrop(!showClientDrop) }}
              className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 rounded-md transition-colors text-left cursor-pointer"
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
            </div>
            {activeClient && (
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => {
                    if (activeClient.client_folder_url) {
                      window.open(activeClient.client_folder_url, '_blank', 'noopener,noreferrer')
                    } else {
                      setShowFolderModal(true)
                    }
                  }}
                  title={activeClient.client_folder_url ? 'Open client folder' : 'Add client folder link'}
                  className="w-9 h-full flex items-center justify-center rounded-md transition-colors"
                  style={{ background: 'var(--cream)', border: '1px solid var(--line)', color: activeClient.client_folder_url ? 'var(--gold-tag)' : 'var(--ink3)' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'}>
                  <span className="text-sm">📁</span>
                </button>
                {activeClient.client_folder_url && (
                  <button
                    onClick={e => { e.stopPropagation(); setShowFolderModal(true) }}
                    title="Edit folder link"
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full transition-colors"
                    style={{ background: 'white', border: '1px solid var(--line)', fontSize: 8, color: 'var(--ink3)' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--gold)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--ink3)'}>
                    ✎
                  </button>
                )}
              </div>
            )}
          </div>
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
                <button key={c.id} onClick={() => { setActiveClient(c); localStorage.setItem('selectedClientId', c.id); setShowClientDrop(false); setClientSearch('') }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
                  style={{ background: activeClient?.id === c.id ? 'var(--gold-l)' : 'transparent', borderLeft: activeClient?.id === c.id ? '2px solid var(--gold)' : '2px solid transparent' }}
                  onMouseEnter={e => { if (activeClient?.id !== c.id) (e.currentTarget as HTMLElement).style.background = 'var(--cream)' }}
                  onMouseLeave={e => { if (activeClient?.id !== c.id) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center font-serif text-xs text-white flex-shrink-0" style={{ background: activeClient?.id === c.id ? 'var(--gold)' : 'var(--ink2)' }}>{initials(c.name)}</div>
                  <div>
                    <div className="text-sm font-medium" style={{ color: activeClient?.id === c.id ? 'var(--gold-tag)' : 'var(--ink)' }}>{c.name}</div><button onClick={e => { e.stopPropagation(); deleteClient(c.id) }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#C0392B', cursor: 'pointer', fontSize: 13, padding: '0 6px' }}>✕</button>
                    <div className="text-xs" style={{ color: 'var(--ink3)' }}>
                      Age {getAge(c.dob) ?? c.age ?? '?'}
                      {spouseNames[c.id] && (
                        <span> · Spouse: {spouseNames[c.id]}</span>
                      )}
                    </div>
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
        )}
        <nav className="flex-1 px-3 py-2">
          {isBusinessMode ? (
            NAV_BUSINESS.map(item => (
              item.disabled ? (
                <div key={item.id}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded mb-0.5 text-sm"
                  style={{ color: 'var(--ink3)', opacity: 0.5, cursor: 'default' }}>
                  <span className="text-base w-4 text-center">{item.icon}</span>
                  {item.label}
                  <span className="ml-auto text-xs tracking-widest uppercase" style={{ fontSize: 9.5 }}>Soon</span>
                </div>
              ) : (
                <Link key={item.id} href={item.href}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded transition-all mb-0.5 text-sm"
                  style={{ color: businessActiveId === item.id ? 'var(--gold-tag)' : 'var(--ink3)', background: businessActiveId === item.id ? 'var(--gold-l)' : 'transparent', fontWeight: businessActiveId === item.id ? 500 : 400 }}>
                  <span className="text-base w-4 text-center">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.id === 'claims-board' && claimsBadgeCount > 0 && (
                    <span
                      className="flex items-center justify-center text-xs font-medium"
                      style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--rouge)', color: 'white', lineHeight: 1 }}
                    >
                      {claimsBadgeCount > 99 ? '99+' : claimsBadgeCount}
                    </span>
                  )}
                  {item.id === 'service-requests' && serviceRequestsBadgeCount > 0 && (
                    <span
                      className="flex items-center justify-center text-xs font-medium"
                      style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--rouge)', color: 'white', lineHeight: 1 }}
                    >
                      {serviceRequestsBadgeCount > 99 ? '99+' : serviceRequestsBadgeCount}
                    </span>
                  )}
                  {item.id === 'premium-alerts' && premiumAlertsBadgeCount > 0 && (
                    <span
                      className="flex items-center justify-center text-xs font-medium"
                      style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--rouge)', color: 'white', lineHeight: 1 }}
                    >
                      {premiumAlertsBadgeCount > 99 ? '99+' : premiumAlertsBadgeCount}
                    </span>
                  )}
                  {item.id === 'new-business' && newBusinessBadgeCount > 0 && (
                    <span
                      className="flex items-center justify-center text-xs font-medium"
                      style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--rouge)', color: 'white', lineHeight: 1 }}
                    >
                      {newBusinessBadgeCount > 99 ? '99+' : newBusinessBadgeCount}
                    </span>
                  )}
                </Link>
              )
            ))
          ) : visibleGroups.length === 1 ? (
            visibleGroups[0].items.map(item => (
              <Link key={item.id} href={item.href}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded transition-all mb-0.5 text-sm"
                style={{ color: activeTab === item.id ? 'var(--gold-tag)' : 'var(--ink3)', background: activeTab === item.id ? 'var(--gold-l)' : 'transparent', fontWeight: activeTab === item.id ? 500 : 400 }}>
                <span className="text-base w-4 text-center">{item.icon}</span>
                {item.label}
              </Link>
            ))
          ) : visibleGroups.map(group => {
            const isOpen = expandedGroup === group.id
            return (
              <div key={group.id} className="mb-1">
                <button onClick={() => setExpandedGroup(group.id)}
                  className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded transition-colors text-left"
                  style={{ color: 'var(--ink3)' }}>
                  <span className="text-xs tracking-widest uppercase font-medium">{group.label}</span>
                  <span className="text-xs transition-transform" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>⌄</span>
                </button>
                {isOpen && (
                  <div className="mt-0.5">
                    {group.items.map(item => (
                      <Link key={item.id} href={item.href}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded transition-all mb-0.5 text-sm"
                        style={{ color: activeTab === item.id ? 'var(--gold-tag)' : 'var(--ink3)', background: activeTab === item.id ? 'var(--gold-l)' : 'transparent', fontWeight: activeTab === item.id ? 500 : 400 }}>
                        <span className="text-base w-4 text-center">{item.icon}</span>
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
        {user?.id === process.env.NEXT_PUBLIC_CREATOR_ID && (
          <div className="px-3 py-3" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="px-3 mb-1 text-xs tracking-widest uppercase" style={{ color: 'var(--ink3)' }}>Admin</div>
            <Link href="/admin" className="flex items-center gap-2.5 px-3 py-2.5 rounded transition-all text-sm" style={{ color: pathname.startsWith('/admin') ? 'var(--gold-tag)' : 'var(--ink3)', background: pathname.startsWith('/admin') ? 'var(--gold-l)' : 'transparent' }}>
              <span className="text-base w-4 text-center">&#9881;</span>
              <span className="flex-1">Admin Hub</span>
              {adminBadgeCount > 0 && (
                <span
                  className="flex items-center justify-center text-xs font-medium"
                  style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--rouge)', color: 'white', lineHeight: 1 }}
                >
                  {adminBadgeCount > 99 ? '99+' : adminBadgeCount}
                </span>
              )}
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
          <button onClick={() => setShowBugReport(true)} className="text-xs transition-colors mt-2 block" style={{ color: 'var(--ink3)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--gold)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--ink3)'}>
            Report a bug
          </button>
          {!isStandalone && (canInstall || isIOS) && (
            <button
              onClick={() => {
                if (canInstall) {
                  promptInstall()
                } else {
                  confirmAction(
                    'Tap the Share icon in Safari, then "Add to Home Screen".',
                    { title: 'Install this app', confirmLabel: 'Got it' }
                  )
                }
              }}
              className="text-xs transition-colors mt-2 block" style={{ color: 'var(--ink3)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--gold)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--ink3)'}>
              Install app
            </button>
          )}
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden pt-14 md:pt-0" style={{ background: 'var(--cream)' }}>
        <div key={activeClient?.id || 'no-client'} className="contents">{children}</div>
      </main>
      {showClientDrop && (<div className="fixed inset-0 z-40" onClick={() => { setShowClientDrop(false); setClientSearch('') }} />)}
      {showClientModal && (
        <AddClientModal
          userId={user?.id}
          onClose={() => setShowClientModal(false)}
          onSaved={async (client) => { setClients(prev => [client, ...prev]); setActiveClient(client); setShowClientModal(false) }}
        />
      )}
      {showBugReport && <BugReportModal onClose={() => setShowBugReport(false)} />}
      {businessAccess && <GlobalQuickAdd />}
      <IdleLogoutGuard />
      {showFolderModal && activeClient && (
        <ClientFolderModal
          clientName={activeClient.name}
          currentUrl={activeClient.client_folder_url}
          onClose={() => setShowFolderModal(false)}
          onSaved={(url) => { updateActiveClientFields({ client_folder_url: url }); setShowFolderModal(false) }}
        />
      )}
    </div>
  )
}

function ClientFolderModal({ clientName, currentUrl, onClose, onSaved }: { clientName: string; currentUrl: string | null; onClose: () => void; onSaved: (url: string) => void }) {
  const [url, setUrl] = useState(currentUrl || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { activeClient } = useDashboard()
  const supabase = createClient()

  async function save() {
    const trimmed = url.trim()
    if (trimmed && !/^https?:\/\//i.test(trimmed)) { setError('Link must start with http:// or https://'); return }
    if (!activeClient) return
    setLoading(true)
    const { error: err } = await supabase.from('clients')
      .update({ client_folder_url: trimmed || null, updated_at: new Date().toISOString() })
      .eq('id', activeClient.id)
    setLoading(false)
    if (err) { setError(err.message); return }
    onSaved(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-md" style={{ background: 'white', borderRadius: 8 }}>
        <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-xl">Client Folder Link</div>
          <div className="text-xs mt-1" style={{ color: 'var(--ink3)' }}>{clientName}</div>
        </div>
        <div className="px-6 py-5 space-y-2">
          <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Google Drive folder URL</label>
          <input type="url" value={url} onChange={e => setUrl(e.target.value)} autoFocus
            placeholder="https://drive.google.com/drive/folders/…"
            className="w-full px-3 py-2.5 text-sm outline-none"
            style={{ border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--cream)' }} />
          <div className="text-xs" style={{ color: 'var(--ink3)' }}>Paste the folder's share link. One click will open it in Drive from now on.</div>
          {error && <div className="text-sm px-3 py-2 mt-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>{error}</div>}
        </div>
        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Cancel</button>
          <button onClick={save} disabled={loading} className="px-4 py-2 text-sm font-medium text-white" style={{ background: loading ? 'var(--ink2)' : 'var(--ink)' }}>{loading ? 'Saving…' : 'Save Link'}</button>
        </div>
      </div>
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