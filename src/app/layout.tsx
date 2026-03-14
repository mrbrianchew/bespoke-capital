import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bespoke Capital — Financial Plan',
  description: 'Financial Planning Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
