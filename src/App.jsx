import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './store/authStore'
import AppShell from './components/AppShell'
import PlatformShell from './components/PlatformShell'
import Login from './pages/Login'
import FrontDesk from './pages/FrontDesk'

const Appointments = lazy(() => import('./pages/Appointments'))
const Consultation = lazy(() => import('./pages/Consultation'))
const History = lazy(() => import('./pages/History'))
const Billing = lazy(() => import('./pages/Billing'))
const Pharmacy = lazy(() => import('./pages/Pharmacy'))
const Templates = lazy(() => import('./pages/Templates'))
const Settings = lazy(() => import('./pages/Settings'))
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'))

const Spin = () => (
  <div className="p-10 text-body-3 text-sm">Loading…</div>
)

export default function App() {
  const user = useAuth((s) => s.user)
  if (!user) return <Login />

  // Platform owner (superadmin, no tenant) → cross-tenant console, no clinic rail.
  if (user.superadmin && !user.tenantId) {
    return (
      <PlatformShell>
        <Suspense fallback={<Spin />}><SuperAdmin /></Suspense>
      </PlatformShell>
    )
  }

  return (
    <AppShell>
      <Suspense fallback={<Spin />}>
        <Routes>
          <Route path="/" element={<Navigate to="/frontdesk" replace />} />
          <Route path="/frontdesk" element={<FrontDesk />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/consult" element={<Consultation />} />
          <Route path="/history" element={<History />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/pharmacy" element={<Pharmacy />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/settings" element={<Settings />} />
        <Route path="/superadmin" element={<SuperAdmin />} />
          <Route path="*" element={<Navigate to="/frontdesk" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}
