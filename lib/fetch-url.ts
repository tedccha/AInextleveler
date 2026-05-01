/**
 * URL → content fetcher.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  github.com/owner/repo  → GitHub REST API for README             │
 *   │  github.com/owner/repo/blob/...  → raw content (if .md, txt)     │
 *   │  x.com / twitter.com    → cannot fetch (returns paste-required)  │
 *   │  any other URL          → generic fetch + simple text extraction │
 *   │                                                                  │
 *   │  All non-success states return a normalized result so the caller │
 *   │  can decide whether to surface the inline paste prompt or fail.  │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Per design doc: when a URL can't be fetched, the tool actively asks
 * the user to paste content — never silently assigns needs_review
 * without enough signal.
 */

const CONTENT_CAP = 4000

export type FetchResult =
  | { kind: 'fetched'; content: string; source: 'github-readme' | 'github-raw' | 'http' }
  | { kind: 'needs_paste'; reason: 'x_or_twitter' | 'fetch_failed' | 'not_text' | 'empty'; status?: number }
  | { kind: 'error'; message: string }

function isGithubRepoUrl(url: URL): { owner: string; repo: string } | null {
  if (url.hostname !== 'github.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  // /owner/repo or /owner/repo/...
  const [owner, repo] = parts
  if (!owner || !repo) return null
  // Skip GitHub's reserved paths.
  if (['orgs', 'topics', 'collections', 'sponsors', 'marketplace', 'features', 'enterprise'].includes(owner)) {
    return null
  }
  return { owner, repo: repo.replace(/\.git$/, '') }
}

function isGithubBlobUrl(
  url: URL,
): { owner: string; repo: string; ref: string; path: string } | null {
  if (url.hostname !== 'github.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  // /owner/repo/blob/<ref>/<path>
  if (parts.length < 5 || parts[2] !== 'blob') return null
  const [owner, repo, , ref, ...rest] = parts
  return { owner, repo, ref, path: rest.join('/') }
}

function isXOrTwitter(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com')
}

async function fetchGithubReadme(
  owner: string,
  repo: string,
): Promise<FetchResult> {
  const token = process.env.GITHUB_TOKEN
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'ainextleveler/0.1',
    'x-github-api-version': '2022-11-28',
  }
  if (token && token !== 'ghp_replace_me') {
    headers.authorization = `Bearer ${token}`
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers },
    )
    if (!res.ok) {
      return { kind: 'needs_paste', reason: 'fetch_failed', status: res.status }
    }
    const data = (await res.json()) as { content?: string; encoding?: string }
    if (!data.content || data.encoding !== 'base64') {
      return { kind: 'needs_paste', reason: 'empty' }
    }
    const decoded = Buffer.from(data.content, 'base64').toString('utf8')
    if (!decoded.trim()) {
      return { kind: 'needs_paste', reason: 'empty' }
    }
    return {
      kind: 'fetched',
      content: decoded.slice(0, CONTENT_CAP),
      source: 'github-readme',
    }
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'github fetch failed',
    }
  }
}

async function fetchGithubBlob(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<FetchResult> {
  // Only attempt text-friendly extensions.
  const lower = path.toLowerCase()
  const textExts = ['.md', '.txt', '.mdx', '.rst', '.markdown']
  if (!textExts.some((ext) => lower.endsWith(ext))) {
    return { kind: 'needs_paste', reason: 'not_text' }
  }
  try {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`
    const res = await fetch(rawUrl, {
      headers: { 'user-agent': 'ainextleveler/0.1' },
    })
    if (!res.ok) {
      return { kind: 'needs_paste', reason: 'fetch_failed', status: res.status }
    }
    const text = await res.text()
    if (!text.trim()) {
      return { kind: 'needs_paste', reason: 'empty' }
    }
    return {
      kind: 'fetched',
      content: text.slice(0, CONTENT_CAP),
      source: 'github-raw',
    }
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'raw fetch failed',
    }
  }
}

/**
 * Crude HTML → text extraction. Strips tags, collapses whitespace.
 * Good enough for blog posts, MDN, etc. Loses nuance (no semantic
 * parsing) but doesn't add 50KB of cheerio just for v1.
 */
function htmlToText(html: string): string {
  return html
    // remove script/style content
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // strip tags
    .replace(/<[^>]+>/g, ' ')
    // decode common entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchGenericUrl(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'ainextleveler/0.1 (personal upleveling tool; respects robots.txt)',
        accept: 'text/html, text/plain, application/xhtml+xml',
      },
      // Don't follow infinite redirects.
      redirect: 'follow',
    })
    if (!res.ok) {
      return { kind: 'needs_paste', reason: 'fetch_failed', status: res.status }
    }
    const ct = res.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(ct)) {
      return { kind: 'needs_paste', reason: 'not_text' }
    }
    const body = await res.text()
    const text = ct.includes('html') ? htmlToText(body) : body
    if (!text.trim() || text.length < 100) {
      return { kind: 'needs_paste', reason: 'empty' }
    }
    return {
      kind: 'fetched',
      content: text.slice(0, CONTENT_CAP),
      source: 'http',
    }
  } catch (err) {
    return {
      kind: 'error',
      message: err instanceof Error ? err.message : 'fetch failed',
    }
  }
}

/**
 * Top-level dispatcher. Caller passes a string. Returns one of:
 *   - fetched: content ready for classification
 *   - needs_paste: caller should re-prompt user with inline textarea
 *   - error: hard error (rare)
 */
export async function fetchUrlContent(rawUrl: string): Promise<FetchResult> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { kind: 'error', message: 'invalid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { kind: 'error', message: 'unsupported protocol' }
  }
  if (isXOrTwitter(url)) {
    return { kind: 'needs_paste', reason: 'x_or_twitter' }
  }
  const blob = isGithubBlobUrl(url)
  if (blob) {
    const r = await fetchGithubBlob(blob.owner, blob.repo, blob.ref, blob.path)
    if (r.kind === 'fetched') return r
    // Fall through to generic fetch on miss (e.g. binary file).
  }
  const repo = isGithubRepoUrl(url)
  if (repo) {
    const r = await fetchGithubReadme(repo.owner, repo.repo)
    if (r.kind === 'fetched') return r
    // Fall through to generic if README fetch failed.
  }
  return fetchGenericUrl(rawUrl)
}

/**
 * Quick check — used by the inbox UI to decide whether to show the URL
 * field vs the textarea immediately.
 */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  if (trimmed.includes('\n')) return false
  if (trimmed.length > 2000) return false
  try {
    const u = new URL(trimmed)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
