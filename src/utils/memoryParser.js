const MEMORY_PATTERN = /^\[\[MEMORY:\s*(.+)\s*\]\]$/i;

export function extractMemoryDirective(text) {
  if (!text) {
    return { content: text, memory: null };
  }

  const trimmed = text.trimEnd();
  const lines = trimmed.split(/\n/);
  const lastLine = lines[lines.length - 1]?.trim();
  const match = lastLine ? lastLine.match(MEMORY_PATTERN) : null;

  if (!match) {
    return { content: text, memory: null };
  }

  const memory = match[1]?.trim();
  const content = lines.slice(0, -1).join('\n').trimEnd();
  return {
    content: content || '',
    memory: memory || null
  };
}
