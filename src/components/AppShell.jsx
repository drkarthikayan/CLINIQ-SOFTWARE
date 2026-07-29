import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { signOut } from '../services/auth.service'
import { DEMO } from '../lib/firebase'

const NAV = [
  { to: '/frontdesk', label: 'Front desk', icon: '▤', roles: ['admin', 'doctor', 'nurse', 'frontdesk'] },
  { to: '/appointments', label: 'Appointments', icon: '▦', roles: ['admin', 'doctor', 'nurse', 'frontdesk'] },
  { to: '/consult', label: 'Consultation', icon: '✚', roles: ['admin', 'doctor'] },
  { to: '/history', label: 'Patient history', icon: '↺', roles: ['admin', 'doctor', 'nurse'] },
  { to: '/billing', label: 'Billing', icon: '₹', roles: ['admin', 'doctor', 'frontdesk'] },
]
const MODULES = [
  { to: '/pharmacy', label: 'Pharmacy', icon: '⬡', roles: ['admin', 'doctor', 'nurse'] },
  { to: '/templates', label: 'Templates', icon: '≡', roles: ['admin', 'doctor'] },
  { to: '/settings', label: 'Settings', icon: '⚙', roles: ['admin', 'doctor'] },
]
const TITLES = {
  '/frontdesk': 'Front desk', '/appointments': 'Appointments', '/consult': 'Consultation',
  '/history': 'Patient history', '/billing': 'Billing', '/pharmacy': 'Pharmacy & stock',
  '/templates': 'Consult templates', '/settings': 'Settings', '/superadmin': 'Superadmin',
}
const ROLES = ['doctor', 'nurse', 'frontdesk', 'admin']
const ROLE_LABEL = { doctor: 'Doctor', nurse: 'Staff nurse', frontdesk: 'Front desk', admin: 'Admin' }

const Item = ({ to, icon, label }) => (
  <NavLink to={to}
    className={({ isActive }) =>
      'flex items-center gap-2.5 px-2.5 py-[9px] rounded-lg text-[13.5px] no-underline ' +
      (isActive ? 'bg-teal text-white font-medium' : 'text-[#B9C9C7] hover:bg-ink-2 hover:text-white')
    }>
    <span>{icon}</span> <span>{label}</span>
  </NavLink>
)

export default function AppShell({ children }) {
  const { user, clear, setUser } = useAuth()
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const can = (item) => item.roles.includes(user.role)
  const initials = user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  const visibleNav = NAV.filter(can)
  const visibleModules = MODULES.filter(can)
  // Phones get the 4 most-used destinations plus a "More" sheet; a 9-item rail
  // squeezed to icons is unusable one-handed at a busy front desk.
  const bottomNav = visibleNav.slice(0, 4)
  const overflow = [...visibleNav.slice(4), ...visibleModules, ...(user.superadmin ? [{ to: '/superadmin', label: 'Superadmin', icon: '◆' }] : [])]

  return (
    <div className="flex min-h-screen">
      {/* Desktop / tablet rail */}
      <nav className="w-[196px] bg-ink text-[#B9C9C7] p-3 pt-4 flex flex-col gap-0.5 shrink-0 max-md:hidden">
        <div className="font-disp text-[19px] font-semibold text-white px-2.5 pb-4">
          CLINI<span className="text-teal-bright">Q</span>
        </div>
        {visibleNav.map((i) => <Item key={i.to} {...i} />)}
        <div className="text-[10.5px] uppercase tracking-widest text-[#5F7377] px-2.5 pt-4 pb-1.5">Modules</div>
        {visibleModules.map((i) => <Item key={i.to} {...i} />)}
        {user.superadmin && (
          <>
            <div className="text-[10.5px] uppercase tracking-widest text-[#5F7377] px-2.5 pt-4 pb-1.5">Super admin</div>
            <Item to="/superadmin" icon="◆" label="Superadmin" />
          </>
        )}
        <div className="mt-auto pt-3 px-1 border-t border-ink-2 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-teal text-white flex items-center justify-center text-xs font-semibold">{initials}</div>
          <div className="min-w-0">
            <div className="text-[13px] text-white truncate">{user.name}</div>
            <button className="text-[11px] text-[#8AA0A0] hover:text-white" onClick={async () => { await signOut(); clear() }}>
              {ROLE_LABEL[user.role] || user.role} · sign out
            </button>
          </div>
        </div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center justify-between gap-3 px-6 max-md:px-4 py-3.5 border-b border-line bg-white">
          <h2 className="font-disp font-semibold text-[17px] truncate">{TITLES[pathname] || 'CLINIQ'}</h2>
          <div className="flex items-center gap-3 shrink-0">
            {/* Role preview is demo-only: it re-renders the rail for a given
                role but grants nothing — real access comes from custom claims
                enforced in firestore.rules. */}
            {DEMO && (
              <label className="flex items-center gap-1.5 text-[12px] text-body-3 max-sm:hidden">
                Preview as
                <select className="inp !w-auto !py-1 !text-[12px]" value={user.role}
                  onChange={(e) => setUser({ ...user, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </label>
            )}
            <span className="text-[13px] text-body-2 max-lg:hidden">
              {user.tenantName || user.tenantId} · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <span className="text-[12.5px] text-body-2 lg:hidden">{user.tenantName || user.tenantId}</span>
            <button className="w-8 h-8 rounded-full bg-teal text-white text-xs font-semibold md:hidden" onClick={async () => { await signOut(); clear() }} title="Sign out">{initials}</button>
          </div>
        </header>

        <div className="p-6 max-md:p-4 max-w-[1180px] w-full max-md:pb-24">{children}</div>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-ink border-t border-ink-2 flex">
        {bottomNav.map((i) => (
          <NavLink key={i.to} to={i.to} onClick={() => setMoreOpen(false)}
            className={({ isActive }) =>
              'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10.5px] no-underline ' +
              (isActive ? 'text-teal-bright font-medium' : 'text-[#8AA0A0]')
            }>
            <span className="text-[16px] leading-none">{i.icon}</span>
            <span className="truncate max-w-full px-1">{i.label}</span>
          </NavLink>
        ))}
        {overflow.length > 0 && (
          <button onClick={() => setMoreOpen((v) => !v)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10.5px] ${moreOpen ? 'text-teal-bright font-medium' : 'text-[#8AA0A0]'}`}>
            <span className="text-[16px] leading-none">⋯</span><span>More</span>
          </button>
        )}
      </nav>

      {/* Mobile "More" sheet */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-ink/50" />
          <div className="absolute bottom-[52px] inset-x-0 bg-ink p-3 grid gap-0.5" onClick={(e) => e.stopPropagation()}>
            {overflow.map((i) => (
              <div key={i.to} onClick={() => setMoreOpen(false)}><Item {...i} /></div>
            ))}
            <button className="text-left px-2.5 py-[9px] rounded-lg text-[13.5px] text-[#8AA0A0] hover:bg-ink-2"
              onClick={async () => { await signOut(); clear() }}>↩ Sign out</button>
          </div>
        </div>
      )}
    </div>
  )
}
