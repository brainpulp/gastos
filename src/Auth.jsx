import { useState } from 'react'
import { supabase } from './supabase.js'

export default function Auth() {
  const [email, setEmail] = useState('maxi.goldschwartz@gmail.com')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const redirectTo = window.location.origin + window.location.pathname
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })
    setLoading(false)
    if (err) setError(err.message)
    else setSent(true)
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
      }}>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.4rem', color: '#222' }}>
          💸 Gastos
        </h2>
        {sent ? (
          <p style={{ color: '#444' }}>
            ✅ Revisá tu email — te mandamos un magic link para entrar.
          </p>
        ) : (
          <form onSubmit={handleLogin}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              required
              style={{
                width: '100%', padding: '0.6rem 0.8rem', marginBottom: '1rem',
                border: '1px solid #ddd', borderRadius: 6, fontSize: '1rem',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '0.7rem', background: '#1a1a2e',
                color: '#fff', border: 'none', borderRadius: 6,
                fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Enviando…' : 'Enviar magic link'}
            </button>
            {error && (
              <p style={{ color: '#c00', marginTop: '0.75rem', fontSize: '0.9rem' }}>
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
