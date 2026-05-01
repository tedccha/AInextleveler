import Link from 'next/link'
import { requireSession, logOut } from '@/lib/auth'
import { redirect } from 'next/navigation'

export const runtime = 'nodejs'

async function logoutAction() {
  'use server'
  await logOut()
  redirect('/login')
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Single auth gate per eng review A1.
  await requireSession()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[hsl(var(--border))]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-6 text-sm">
            <span className="font-semibold">AInextleveler</span>
            <Link href="/capability-map" className="hover:underline">
              Capability Map
            </Link>
            <Link href="/inbox" className="hover:underline">
              Inbox
            </Link>
            <Link href="/next" className="hover:underline">
              Next
            </Link>
          </nav>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
    </div>
  )
}
