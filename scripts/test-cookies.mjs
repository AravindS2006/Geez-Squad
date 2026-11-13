/**
 * Merge Set-Cookie headers into a Cookie header the way a browser does: by name, so a
 * response that re-issues one cookie (for example Better Auth's session cache cookie)
 * keeps the others, and a cleared or expired cookie is dropped.
 */
export function mergeCookies(current, setCookies) {
  const jar = new Map(
    (current ?? '')
      .split('; ')
      .filter(Boolean)
      .map((pair) => [pair.slice(0, pair.indexOf('=')), pair]),
  );
  for (const header of setCookies) {
    const [pair, ...attributes] = header.split(';');
    const name = pair.slice(0, pair.indexOf('=')).trim();
    const value = pair.slice(pair.indexOf('=') + 1);
    const expired = attributes.some((a) => /^\s*max-age=(0|-\d+)\s*$/i.test(a));
    if (!value || expired) jar.delete(name);
    else jar.set(name, pair.trim());
  }
  return [...jar.values()].join('; ');
}
