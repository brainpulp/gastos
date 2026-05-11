import { useState } from 'react'
import { supabase } from './supabase.js'

export default function Auth() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleGoogle = async () => {
    setLoading(true)
    setError(null)
    const redirectTo = window.location.origin + window.location.pathname
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (err) { setError(err.message); setLoading(false) }
    // on success the browser redirects — no state update needed
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif',
      background: '#f5f5f5',
    }}>
      <div style={{
        background: '#fff', padding: '2rem 2.5rem', borderRadius: 12,
        boxShadow: '0 2px 16px rgba(0,0,0,0.1)', minWidth: 320,
        textAlign: 'center',
      }}>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.4rem', color: '#222' }}>
          💸 Gastos
        </h2>
        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '0.6rem', width: '100%', padding: '0.7rem 1rem',
            background: '#fff', color: '#444', border: '1px solid #ddd',
            borderRadius: 6, fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {loading ? 'Redirigiendo…' : 'Entrar con Google'}
        </button>
        {error && (
          <p style={{ color: '#c00', marginTop: '0.75rem', fontSize: '0.9rem' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
