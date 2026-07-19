import type { Metadata, Viewport } from 'next'
import { Cormorant_Garamond, Inter, DM_Mono } from 'next/font/google'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bespoke HeartWork — Financial Plan',
  description: 'Financial Planning Platform',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

// next/font self-hosts these at build time and inlines the @font-face rules
// into the page's own CSS — no request to fonts.googleapis.com or
// fonts.gstatic.com at runtime, on any page. This replaces the previous
// async-loaded Google Fonts link (which still cost two external round trips
// before styled text appeared) entirely.
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-cormorant',
})

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
  variable: '--font-inter',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['300', '400'],
  display: 'swap',
  variable: '--font-dm-mono',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${inter.variable} ${dmMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
