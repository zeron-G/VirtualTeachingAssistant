'use client';

export function SignOutButton() {
  async function signOut(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }
  return (
    <button type="button" className="link" onClick={signOut}>
      Sign out
    </button>
  );
}
