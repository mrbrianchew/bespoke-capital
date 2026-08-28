import type { Metadata, Viewport } from 'next'
import { Cormorant_Garamond, Inter, DM_Mono } from 'next/font/google'
import './globals.css'
import AppProviders from '@/components/AppProviders'

export const metadata: Metadata = {
  title: 'Bespoke Capital — Financial Plan',
  description: 'Financial Planning Platform',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Bespoke Capital',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1C1A17',
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
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}