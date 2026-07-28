'use client'

// Persists UI state (active tab, active person, view mode, etc.) per client
// so it survives navigating away from a page and back.
//
// Root cause of the reset-on-navigation bug: pages like Risk Management,
// Financial Profile, Capital Mandate, Strategic Recommendations, and
// Financial Report hold their active tab/view in local useState. Local state
// is wiped on unmount, so leaving the page and returning always lands back
// on the default tab regardless of what you were last looking at — and
// worse, it doesn't distinguish between clients, so client A's last tab
// would leak into client B's session if it were naively persisted globally.
//
// This hook stores each value under a key scoped to BOTH the page (pageKey)
// and the active client (from DashboardContext), mirroring the pattern
// DashboardContext already uses for remembering the selected client via
// localStorage. Each client gets their own remembered tab per page.

import { useState, useEffect, useCallback, Dispatch, SetStateAction } from 'react'
import { useDashboard } from '@/contexts/DashboardContext'

function storageKey(pageKey: string, clientId: string | null): string | null {
  if (!clientId) return null
  return `tabState:${pageKey}:${clientId}`
}

export function useClientTabState<T extends string | number>(
  pageKey: string,
  defaultValue: T,
  initialOverride?: T | null
): [T, Dispatch<SetStateAction<T>>] {
  const { activeClientId } = useDashboard()
  const [value, setValue] = useState<T>(defaultValue)
  const isNumber = typeof defaultValue === 'number'

  // Re-read from storage whenever the active client changes (including on
  // first mount once activeClientId resolves from null -> an actual id).
  // initialOverride (e.g. a ?tab= URL param on a share link) wins over the
  // remembered value on that first resolution, and is persisted so it also
  // becomes the remembered tab going forward.
  useEffect(() => {
    const key = storageKey(pageKey, activeClientId)
    if (!key) return
    if (initialOverride !== undefined && initialOverride !== null) {
      setValue(initialOverride)
      if (typeof window !== 'undefined') window.localStorage.setItem(key, String(initialOverride))
      return
    }
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null
    if (stored === null) { setValue(defaultValue); return }
    if (isNumber) {
      const n = Number(stored)
      setValue((Number.isNaN(n) ? defaultValue : n) as T)
    } else {
      setValue(stored as T)
    }
    // defaultValue/initialOverride/isNumber intentionally omitted from deps:
    // expected to be stable literals at each call site; including them would
    // re-trigger this effect on every render for inline values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId, pageKey])

  const setAndPersist: Dispatch<SetStateAction<T>> = useCallback((next) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      const key = storageKey(pageKey, activeClientId)
      if (key && typeof window !== 'undefined') {
        window.localStorage.setItem(key, String(resolved))
      }
      return resolved
    })
  }, [pageKey, activeClientId])

  return [value, setAndPersist]
}
