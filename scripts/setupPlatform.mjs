// One-off Admin SDK script: creates (or reuses) the CLINIQ SUPER ADMIN
// account — a superadmin with NO tenantId, who signs in via the "Super admin"
// tab and manages every clinic. Keeps platform access separate from any single
// clinic's staff. Run from Cloud Shell only.
//   node scripts/setupPlatform.mjs superadmin@cliniq.app <password> "Super Admin"
//
// To keep the public demo safe, also strip superadmin from any clinic account
// that shouldn't have it:
//   node scripts/setSuperadmin.mjs dr.priya@sunriseclinic.in off
import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const [, , email, password, name] = process.argv
if (!email || !password || !name) {
  console.error('Usage: node scripts/setupPlatform.mjs <email> <password> "<name>"')
  process.exit(1)
}

const sa = JSON.parse(readFileSync('./serviceAccount.json', 'utf8'))
initializeApp({ credential: cert(sa) })
const auth = getAuth()

const run = async () => {
  let user
  try {
    user = await auth.getUserByEmail(email)
  } catch {
    user = await auth.createUser({ email, password, displayName: name })
  }
  // Super admin: superadmin true, NO tenantId. That absence is what routes
  // them to the Platform console instead of a clinic.
  await auth.setCustomUserClaims(user.uid, { superadmin: true })
  console.log(`Super admin ready: ${email}`)
  console.log('Sign in via the "Super admin" tab. Change the password after first login.')
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
