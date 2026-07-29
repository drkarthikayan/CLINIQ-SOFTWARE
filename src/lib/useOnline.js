import { useEffect, useState } from 'react'

// Connection state for the offline banner. navigator.onLine only tells us the
// device has *a* network, not that Firestore is reachable — but combined with
// Firestore's own write queue it is enough to tell staff "keep working, this
// will sync", which is the decision they actually need to make.
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return online
}
