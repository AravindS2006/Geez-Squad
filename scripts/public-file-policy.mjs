const templates = new Set(['.env.example', '.env.production.example']);
export function privatePathReason(file) {
  const normalized = file.replaceAll('\\', '/');
  if (templates.has(normalized)) return null;
  if (
    /(^|\/)(?:\.git|\.vercel|\.agents|\.codex|\.ssh|\.aws|\.azure|\.next|node_modules|test-results|playwright-report)(\/|$)/i.test(
      normalized,
    )
  )
    return 'private or generated directory';
  if (/(^|\/)(?:\.env(?:\.|$)|\.envrc$|\.netrc$)/i.test(normalized))
    return 'private environment file';
  if (
    /\.(?:db(?:-wal|-shm|-journal)?|sqlite3?|pem|key|p12|pfx|dump|backup|bak|har|log|mp4|webm|mov|avi|zip|7z|tar(?:\.gz)?)$/i.test(
      normalized,
    )
  )
    return 'database, key, recording, log, or archive';
  if (
    /(^|\/)(?:id_rsa|id_ed25519|(?:cookies|credentials|storage[-_]?state|auth[-_]?state|session[-_]?state)\.(?:json|txt)|.*(?:dump|backup).*\.sql)$/i.test(
      normalized,
    )
  )
    return 'credential state or database dump';
  if (/^docs\/(?:screenshots\/|accessibility-report\.json$)/i.test(normalized))
    return 'generated diagnostic output';
  return null;
}

export function unsafeTemplateKeys(source) {
  return source.split(/\r?\n/).flatMap((line) => {
    const assignment = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (
      !assignment ||
      !/(?:SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL|DIRECT_URL)/.test(assignment[1])
    )
      return [];
    const value = assignment[2].replace(/^(["'])(.*)\1$/, '$2');
    if (!value || /^replace-with-/.test(value)) return [];
    if (assignment[1] === 'DATABASE_URL' && value === 'file:./dev.db') return [];
    return [assignment[1]];
  });
}
