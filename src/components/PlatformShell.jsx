// Minimal chrome for the platform (SaaS owner) console — deliberately NOT the
// clinic rail. A platform admin has no tenant, so there is no clinic to show;
// they manage every tenant from the cross-tenant Superadmin tools inside.
import { useAuth } from '../store/authStore'
import { signOut } from '../services/auth.service'

export default function PlatformShell({ children }) {
  const { user, clear } = useAuth()
  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-ink text-white flex items-center justify-between px-6 py-3.5">
        <div className="flex items-center gap-3">
          <span className="font-disp text-[19px] font-semibold">CLINI<span className="text-teal-bright">Q</span></span>
          <span className="text-[11px] uppercase tracking-widest bg-teal/30 text-teal-bright px-2 py-0.5 rounded">Platform</span>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <span className="text-[#B9C9C7] max-sm:hidden">{user.name} · platform owner</span>
          <button className="text-[#8AA0A0] hover:text-white" onClick={async () => { await signOut(); clear() }}>Sign out</button>
        </div>
      </header>
      <div className="p-6 max-w-[1100px] mx-auto w-full">
        <h2 className="font-disp font-semibold text-[18px] mb-1">Clinics on CLINIQ</h2>
        <p className="text-body-2 text-[13.5px] mb-5">Create and provision tenants, seed pharmacy stock and demo data, manage price lists and staff accounts.</p>
        {children}
      </div>
    </div>
  )
}
