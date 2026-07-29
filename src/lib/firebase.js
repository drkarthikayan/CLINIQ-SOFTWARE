// Firebase bootstrap. In demo mode nothing here is touched.
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'firebase/firestore'

export const DEMO = import.meta.env.VITE_DEMO_MODE === 'true'

let app = null
export let auth = null
export let db = null

if (!DEMO) {
  app = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  })
  auth = getAuth(app)

  // Offline-first: Firestore keeps an IndexedDB copy of everything this device
  // has read, serves reads from it when the network drops, and queues writes
  // until it reconnects — so a consult continues through the patchy
  // connectivity that is normal in Tier-2/3 towns. The multi-tab manager lets
  // two open tabs (front desk + consult room on one machine) share one cache
  // instead of fighting over the lock.
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } catch (e) {
    // Private browsing or an unsupported browser: fall back to the in-memory
    // cache rather than failing to start at all.
    console.warn('Offline persistence unavailable, using in-memory cache:', e?.message || e)
    db = initializeFirestore(app, {})
  }
}
