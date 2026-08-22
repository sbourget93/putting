import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth-context'
import { loadGis } from '../gis'
import './GoogleSignInButton.css'

/**
 * Renders Google's official Sign in with Google button.
 *
 * We use Google's own `renderButton` (rather than styling our own) so the button
 * stays within their branding guidelines and drives the ID-token flow. On click,
 * Google hands us a credential which we exchange for a backend session via
 * `signInWithCredential`. That session cookie is what actually persists the
 * login — see auth.tsx.
 *
 * The script only loads online. Until it does (or if it fails, e.g. offline) we
 * show a static, disabled placeholder so the drawer isn't empty.
 */
function GoogleSignInButton() {
  const { googleClientId, signInWithCredential } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!googleClientId) return
    let cancelled = false

    loadGis()
      .then((id) => {
        if (cancelled || !containerRef.current) return
        id.initialize({
          client_id: googleClientId,
          callback: (response) => {
            void signInWithCredential(response.credential)
          },
        })
        id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          logo_alignment: 'left',
        })
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [googleClientId, signInWithCredential])

  // No client id configured on the backend: sign-in can't work, so show nothing.
  if (!googleClientId) return null

  return (
    <div className="google-signin-wrap">
      {/* Google renders its button into this node once the script is ready. */}
      <div ref={containerRef} />

      {status !== 'ready' && (
        <button type="button" className="google-signin" disabled>
          {/* Google's "G" mark, inlined so the placeholder works offline. */}
          <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path
              fill="#4285F4"
              d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
            />
            <path
              fill="#34A853"
              d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
            />
            <path
              fill="#FBBC05"
              d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
            />
            <path
              fill="#EA4335"
              d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
            />
          </svg>
          Sign in with Google
        </button>
      )}

      {status === 'error' && (
        <p className="google-signin-note" role="alert">
          Sign-in needs a connection.
        </p>
      )}
    </div>
  )
}

export default GoogleSignInButton
