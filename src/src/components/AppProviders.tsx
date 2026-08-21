'use client'

// Bundles the app-wide, non-blocking UI feedback providers so the root
// layout (a server component) only needs to mount one client wrapper.
// Add future global providers (e.g. theme) here rather than in layout.tsx.

import { ToastProvider } from './Toast'
import { ConfirmProvider } from './ConfirmDialog'

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  )
}
