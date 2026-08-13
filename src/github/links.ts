export function parseLinkHeader(
  value: string | undefined,
): Record<string, string> {
  const links: Record<string, string> = {};
  if (!value) return links;
  for (const part of value.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?([^";\s]+)"?/i);
    if (match) links[match[2].toLowerCase()] = match[1];
  }
  return links;
}
