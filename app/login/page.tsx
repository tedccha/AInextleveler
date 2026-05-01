import { LoginForm } from './form'

export const runtime = 'nodejs'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-2">AInextleveler</h1>
        <p className="mb-8 text-sm text-[hsl(var(--muted-foreground))]">
          Personal AI upleveling tool. Paste, evaluate, queue.
        </p>
        <LoginForm />
      </div>
    </main>
  )
}
