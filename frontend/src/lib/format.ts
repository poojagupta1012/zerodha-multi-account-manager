// All trading times are shown in IST regardless of the viewer's timezone.
const timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export function formatTime(iso: string | null | undefined): string {
  return iso ? timeFmt.format(new Date(iso)) : "—"
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? `${dateTimeFmt.format(new Date(iso))} IST` : "Never"
}

export function formatMultiplier(m: number): string {
  return `${Number(m.toFixed(4))}x`
}
