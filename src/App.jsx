import { useEffect, useState } from 'react'
import { HashRouter } from 'react-router-dom'
import { supabase } from './supabase.js'
import Auth from './Auth.jsx'
import Finanzas from './Finanzas.jsx'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', fontFamily: 'sans-serif', color: '#888',
      }}>
        Cargando…
      </div>
    )
  }

  if (!session) return <Auth />

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <HashRouter>
      <Finanzas session={session} onLogout={handleLogout} />
    </HashRouter>
  )
}
