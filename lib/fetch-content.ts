/**
 * Fetch and parse content from URLs, GitHub repos, or plain text.
 * Returns title + summary + full content for assessment.
 */

export type FetchedContent = {
  title: string
  url: string
  contentType: 'article' | 'github' | 'code' | 'text'
  summary: string // First 500 chars of content
  fullContent: string // Up to 4000 chars for LLM assessment
  metadata: {
    author?: string
    publishedAt?: string
    language?: string
  }
}

async function fetchUrl(url: string): Promise<FetchedContent> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; AIWorkshop/1.0; +http://localhost)',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const html = await response.text()
    const title = extractTitle(html, url)
    const content = extractMainContent(html)

    return {
      title,
      url,
      contentType: 'article',
      summary: content.slice(0, 500),
      fullContent: content.slice(0, 4000),
      metadata: {
        language: 'en',
      },
    }
  } catch (err) {
    throw new Error(`Failed to fetch URL: ${String(err)}`)
  }
}

async function fetchGitHub(url: string): Promise<FetchedContent> {
  // Extract owner/repo from URL
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) throw new Error('Invalid GitHub URL')

  const [, owner, repo] = match
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`

  try {
    const res = await fetch(apiUrl, {
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`)

    const data = (await res.json()) as {
      name: string
      description: string
      topics: string[]
      language: string
      stars: number
    }

    // Fetch README
    const readmeRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      {
        headers: { Accept: 'application/vnd.github.v3.raw' },
      },
    )
    const readmeContent = readmeRes.ok ? await readmeRes.text() : ''

    const content = [
      `Repository: ${data.name}`,
      `Stars: ${data.stars}`,
      `Language: ${data.language || 'N/A'}`,
      `Topics: ${data.topics.join(', ') || 'None'}`,
      '',
      `Description:\n${data.description || 'No description'}`,
      '',
      `README:\n${readmeContent.slice(0, 3000)}`,
    ].join('\n')

    return {
      title: `${owner}/${repo}`,
      url,
      contentType: 'github',
      summary: content.slice(0, 500),
      fullContent: content.slice(0, 4000),
      metadata: {
        language: data.language || undefined,
      },
    }
  } catch (err) {
    throw new Error(`Failed to fetch GitHub: ${String(err)}`)
  }
}

function extractTitle(html: string, url: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch) return titleMatch[1].trim()

  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  if (h1Match) return h1Match[1].trim()

  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 50)
  }
}

function extractMainContent(html: string): string {
  // Remove scripts and styles
  let content = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n') // Replace tags with newlines
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .slice(0, 5000)

  return content
}

export async function fetchContent(
  url: string,
  sourceType: 'link' | 'github' | 'pastedText',
): Promise<FetchedContent> {
  if (sourceType === 'pastedText') {
    return {
      title: 'Pasted Content',
      url: 'pasted',
      contentType: 'text',
      summary: url.slice(0, 500),
      fullContent: url.slice(0, 4000),
      metadata: {},
    }
  }

  if (sourceType === 'github' || url.includes('github.com')) {
    return fetchGitHub(url)
  }

  return fetchUrl(url)
}
