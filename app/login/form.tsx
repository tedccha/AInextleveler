'use client'

import { loginAction } from './actions'

export function LoginForm() {
  return (
    <form action={loginAction} className="space-y-4">
      <button
        type="submit"
        className="w-full rounded-card bg-[hsl(var(--accent))] px-4 py-2 font-medium text-[hsl(var(--accent-foreground))]"
      >
        Sign in
      </button>
    </form>
  )
}
