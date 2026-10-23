/** A shared meeting link may survive sign-in, but never redirect off-site. */
export function loginDestination(value: string | null) {
  return value && /^\/studio\/[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : '/app';
}

/** Used by both the login page and form, including legacy invitation links. */
export function accountDestination(next: string | null, invite: string | null) {
  return invite ? `/invite?code=${encodeURIComponent(invite)}` : loginDestination(next);
}
