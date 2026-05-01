import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'

export const metadata: Metadata = {
  title: 'AInextleveler',
  description: 'Personal AI upleveling tool — paste, evaluate, queue.',
}

// Per eng review A1/A2: no Edge runtime anywhere.
export const runtime = 'nodejs'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
