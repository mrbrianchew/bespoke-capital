'use client'

import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Cross-platform PWA install affordance.
 * - Android/Chrome: captures `beforeinstallprompt` and exposes `promptInstall()`.
 * - iOS/iPadOS Safari: no install API exists — `isIOS` lets the caller show
 *   the "tap Share → Add to Home Screen" instruction instead.
 * `isStandalone` is true once the app is already installed (either
 * platform), so callers can hide the install affordance entirely.
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    )
    // iPadOS Safari has reported a desktop-class user agent (no "iPad"
    // substring) since iPadOS 13, by design — it presents as Mac Safari so
    // sites don't downgrade to a mobile layout. The reliable signal is
    // touch support on a "MacIntel" platform, since a real Mac reports 0
    // maxTouchPoints. iPhone/iPod still identify themselves normally.
    const ua = window.navigator.userAgent
    const isIPadDesktopUA = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
    setIsIOS(/iphone|ipad|ipod/i.test(ua) || isIPadDesktopUA)

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }, [deferredPrompt])

  return { canInstall: !!deferredPrompt, promptInstall, isIOS, isStandalone }
}
