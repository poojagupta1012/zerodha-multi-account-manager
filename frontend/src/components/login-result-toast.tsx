"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { toast } from "sonner"

/**
 * After a Kite login the backend redirects to /?logged_in=AB1234 (or
 * /accounts?...). Show a toast once, then drop the param from the URL.
 */
export function LoginResultToast() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const loggedIn = params.get("logged_in")

  useEffect(() => {
    if (!loggedIn) return
    toast.success(`${loggedIn} logged in`, { description: "Access token saved. Valid until 6 AM IST." })
    router.replace(pathname, { scroll: false })
  }, [loggedIn, pathname, router])

  return null
}
