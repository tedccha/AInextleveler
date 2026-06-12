'use client'

import Link from 'next/link'
import { FluentProvider, teamsLightTheme } from '@fluentui/react-components'

export function AppLayoutContent({
  children,
  logoutAction,
}: {
  children: React.ReactNode
  logoutAction: (formData: FormData) => Promise<void>
}) {
  return (
    <FluentProvider theme={teamsLightTheme}>
      <div className="min-h-screen flex flex-col">
        <header style={{ borderBottom: '1px solid #f0f0f0' }}>
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
              <Link href="/" className="font-semibold hover:opacity-80">
                AI Workshop
              </Link>
              <nav style={{ display: 'flex', gap: '16px' }}>
                <Link
                  href="/inbox"
                  style={{
                    fontSize: '14px',
                    color: '#616161',
                    textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#0078d4')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#616161')}
                >
                  Inbox
                </Link>
                <Link
                  href="/archive"
                  style={{
                    fontSize: '14px',
                    color: '#616161',
                    textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#0078d4')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#616161')}
                >
                  Archive
                </Link>
              </nav>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                style={{
                  fontSize: '14px',
                  color: '#616161',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#000'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#616161'
                }}
              >
                Log out
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
      </div>
    </FluentProvider>
  )
}
