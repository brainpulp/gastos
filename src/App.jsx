import { useEffect, useState, lazy, Suspense } from 'react'
import { HashRouter } from 'react-router-dom'
import { supabase } from './supabase.js'
import Auth from './Auth.jsx'
import Finanzas from './Finanzas.jsx'

const MobileApp = lazy(() => import('./mobile/MobileApp.jsx'))

// Choose shell: native (Capacitor) or narrow viewport → mobile.
// Override with ?view=mobile / ?view=desktop (persisted) for previewing on any device.
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => decide())
  useEffect(() => {
    const onResize = () => setIsMobile(decide())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}
function decide() {
  const params = new URLSearchParams(window.location.search)
  const override = params.get('view')
  if (override === 'mobile') { localStorage.setItem('gastos-view', 'mobile') }
  else if (override === 'desktop') { localStorage.setItem('gastos-view', 'desktop') }
  const saved = localStorage.getItem('gastos-view')
  if (saved === 'mobile') return true
  if (saved === 'desktop') return false
  const native = !!window.Capacitor?.isNativePlatform?.()
  return native || window.matchMedia('(max-width: 767px)').matches
}

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const isMobile = useIsMobile()

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

  if (isMobile) {
    return (
      <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#888' }}>Cargando…</div>}>
        <MobileApp session={session} onLogout={handleLogout} />
      </Suspense>
    )
  }

  return (
    <HashRouter>
      <Finanzas session={session} onLogout={handleLogout} />
    </HashRouter>
  )
}
