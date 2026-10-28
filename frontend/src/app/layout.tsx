import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Suspense } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { LoginResultToast } from "@/components/login-result-toast"
import { Providers } from "@/components/providers"
import { Topbar } from "@/components/topbar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

import "./globals.css"

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: { default: "Copy Trader", template: "%s · Copy Trader" },
  description: "Admin console for the Zerodha Kite multi-account copy trading system",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes sets the theme class on <html> before hydration.
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body>
        <Providers>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <Topbar />
              <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 md:p-6">{children}</main>
            </SidebarInset>
          </SidebarProvider>
          {/* useSearchParams needs a Suspense boundary to keep the shell static. */}
          <Suspense>
            <LoginResultToast />
          </Suspense>
        </Providers>
      </body>
    </html>
  )
}
