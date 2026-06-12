export function renderMarkdown(text: string): (string | React.ReactNode)[] {
  const parts: (string | React.ReactNode)[] = []
  let lastIndex = 0

  // Match **bold**, *italic*, and line breaks
  const regex = /\*\*([^*]+)\*\*|\*([^*]+)\*|(\n+)/g
  let match

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[1]) {
      // **bold**
      parts.push(
        <strong key={`bold-${parts.length}`} style={{ fontWeight: 600 }}>
          {match[1]}
        </strong>,
      )
    } else if (match[2]) {
      // *italic*
      parts.push(
        <em key={`italic-${parts.length}`} style={{ fontStyle: 'italic' }}>
          {match[2]}
        </em>,
      )
    } else if (match[3]) {
      // Line breaks
      parts.push(<br key={`br-${parts.length}`} />)
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}
