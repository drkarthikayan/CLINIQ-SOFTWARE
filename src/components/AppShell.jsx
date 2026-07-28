import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../store/authStore'
import { signOut } from '../services/auth.service'

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
  '/templates': 'Consult templates', '/settings': 'Settings',
  '/superadmin': 'Superadmin',
}

const Item = ({ to, icon, label }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      `flex items-center gap-2.5 px-2.5 py-[9px] rounded-lg text-[13.5px] no-underline ` +
      (isActive ? 'bg-teal text-white font-medium' : 'text-[#B9C9C7] hover:bg-ink-2 hover:text-white')
    }
  >
    <span>{icon}</span> <span className="max-md:hidden">{label}</span>
  </NavLink>
)

export default function AppShell({ children }) {
  const { user, clear } = useAuth()
  const { pathname } = useLocation()
  const can = (item) => item.roles.includes(user.role)
  const initials = user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="flex min-h-screen">
      <nav className="w-[196px] max-md:w-16 bg-ink text-[#B9C9C7] p-3 pt-4 flex flex-col gap-0.5 shrink-0">
        <div className="font-disp text-[19px] font-semibold text-white px-2.5 pb-4 max-md:text-sm">
          CLINI<span className="text-teal-bright">Q</span>
        </div>
        {NAV.filter(can).map((i) => <Item key={i.to} {...i} />)}
        <div className="text-[10.5px] uppercase tracking-widest text-[#5F7377] px-2.5 pt-4 pb-1.5 max-md:hidden">Modules</div>
        {MODULES.filter(can).map((i) => <Item key={i.to} {...i} />)}
        {user.superadmin && (
          <>
            <div className="text-[10.5px] uppercase tracking-widest text-[#5F7377] px-2.5 pt-4 pb-1.5 max-md:hidden">Super admin</div>
            <Item to="/superadmin" icon="◆" label="Superadmin" />
          </>
        )}
        <div className="mt-auto pt-3 px-1 border-t border-ink-2 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-teal text-white flex items-center justify-center text-xs font-semibold">{initials}</div>
          <div className="max-md:hidden min-w-0">
            <div className="text-[13px] text-white truncate">{user.name}</div>
            <button
              className="text-[11px] text-[#8AA0A0] hover:text-white"
              onClick={async () => { await signOut(); clear() }}
            >
              {user.role} · sign out
            </button>
          </div>
        </div>
      </nav>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-line bg-white">
          <h2 className="font-disp font-semibold text-[17px]">{TITLES[pathname] || 'CLINIQ'}</h2>
          <span className="text-[13px] text-body-2">
            {user.tenantName || user.tenantId} · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className="p-6 max-w-[1180px] w-full">{children}</div>
      </div>
    </div>
  )
}
