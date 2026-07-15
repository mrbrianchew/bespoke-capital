import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bespoke HeartWork — Financial Plan',
  description: 'Financial Planning Platform',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&family=DM+Mono:wght@300;400&display=swap'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Font CSS was previously a synchronous <link rel="stylesheet">, which
            blocks the browser from rendering anything until it round-trips to
            fonts.googleapis.com and fonts.gstatic.com — on every page. This
            loads the same stylesheet (same font-family names, no other files
            need to change) without blocking first paint: the preload primes
            the cache, the inline script attaches it as a real stylesheet
            once discovered, and the <noscript> tag preserves fonts for
            no-JS clients. */}
        <link rel="preload" as="style" href={GOOGLE_FONTS_URL} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='${GOOGLE_FONTS_URL}';document.head.appendChild(l);})();`,
          }}
        />
        <noscript>
          <link rel="stylesheet" href={GOOGLE_FONTS_URL} />
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  )
}
