import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

// False on the server and during hydration, true afterwards. Use it to hold
// back client-only data (e.g. a query another component already fetched) so
// the first client render matches the server HTML.
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
