// Auth flow (OHC pattern): email/password sign-in, then tenantId + role
// resolved from custom claims set by scripts/seedTenant.mjs / seedStaff.mjs.
//
// Two sign-in modes, one credential store:
//   • clinic   — staff of one tenant. Claims carry { tenantId, role }. Lands
//                in the clinic app scoped to that tenant.
//   • platform — the SaaS owner. Claim carries { superadmin: true } and NO
//                tenantId. Lands in the cross-tenant Platform console.
// A legacy hybrid account (tenantId + superadmin) can sign in either way.
import { DEMO, auth } from '../lib/firebase'
import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'firebase/auth'

// Public demo clinic account (safe to show on the login screen). Never carries
// the superadmin claim.
export const DEMO_CLINIC = { email: 'demo@cliniq.app', password: 'Demo@1234' }
// The single super-admin (SaaS owner) email. Recognised by BOTH the client
// (below) and firestore.rules, so this account works when created straight
// from the Firebase console — no Admin-SDK claim script required.
export const SUPERADMIN_EMAIL = 'superadmin@cliniq.app'
export const DEMO_TENANT = 'demo-clinic'

const CLINIC_DEMO_USER = {
  uid: 'demo-doctor', email: DEMO_CLINIC.email, name: 'Dr. Demo',
  role: 'doctor', tenantId: 'demo-clinic', tenantName: 'Demo Clinic', superadmin: false,
}
const PLATFORM_DEMO_USER = {
  uid: 'demo-platform', email: 'superadmin@cliniq.app', name: 'Super Admin',
  role: 'superadmin', tenantId: null, tenantName: null, superadmin: true,
}

// mode: 'clinic' | 'platform'
export async function staffLogin(email, password, mode = 'clinic') {
  if (DEMO) return mode === 'platform' ? PLATFORM_DEMO_USER : CLINIC_DEMO_USER

  const cred = await signInWithEmailAndPassword(auth, email, password)
  const token = await cred.user.getIdTokenResult(true)
  let { tenantId, role, superadmin } = token.claims
  const emailLc = (cred.user.email || '').toLowerCase()

  // Convenience accounts that can be created straight from the Firebase console
  // (Authentication → Add user) with NO custom claims. The matching grants live
  // in firestore.rules (super-admin email allowance + open demo-clinic), so
  // these still pass security rules. Real clinics keep their proper claims.
  if (!superadmin && emailLc === SUPERADMIN_EMAIL) superadmin = true
  if (!tenantId && !superadmin && emailLc === DEMO_CLINIC.email) { tenantId = DEMO_TENANT; role = 'doctor' }

  if (!tenantId && !superadmin) {
    await fbSignOut(auth)
    throw new Error('Account has no clinic assigned. Run the seed script or contact admin.')
  }
  if (mode === 'platform' && !superadmin) {
    await fbSignOut(auth)
    throw new Error('Not a super admin account. Use the Clinic staff sign-in.')
  }
  if (mode === 'clinic' && !tenantId) {
    await fbSignOut(auth)
    throw new Error('This is a super admin account. Use the Super admin sign-in.')
  }

  return {
    uid: cred.user.uid,
    email: cred.user.email,
    name: cred.user.displayName || cred.user.email,
    role: role || (superadmin && !tenantId ? 'superadmin' : 'frontdesk'),
    tenantId: tenantId || null,
    superadmin: !!superadmin,
  }
}

export async function signOut() {
  if (DEMO) return
  await fbSignOut(auth)
}

export function watchAuth(cb) {
  if (DEMO) return () => {}
  return onAuthStateChanged(auth, cb)
}
