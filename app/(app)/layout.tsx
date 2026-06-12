import Link from 'next/link'
import { requireSession, logOut } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AppLayoutContent } from './layout-content'

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
  await requireSession()

  return (
    <AppLayoutContent logoutAction={logoutAction}>
      {children}
    </AppLayoutContent>
  )
}
