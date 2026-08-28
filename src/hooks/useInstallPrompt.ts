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
    setIsIOS(/iphone|ipad|ipod/i.test(window.navigator.userAgent))

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
