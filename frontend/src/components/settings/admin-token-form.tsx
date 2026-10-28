"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { getAdminToken, setAdminToken } from "@/lib/api"
import { adminTokenSchema, type AdminTokenValues } from "@/lib/schemas"

export function AdminTokenForm() {
  const queryClient = useQueryClient()
  const form = useForm<AdminTokenValues>({
    resolver: zodResolver(adminTokenSchema),
    defaultValues: { token: "" },
  })

  // localStorage is only readable after mount.
  useEffect(() => {
    form.reset({ token: getAdminToken() })
  }, [form])

  function onSubmit({ token }: AdminTokenValues) {
    setAdminToken(token)
    toast.success(token ? "Admin token saved in this browser" : "Admin token cleared")
    return queryClient.invalidateQueries()
  }

  return (
    <Card>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CardHeader>
          <CardTitle>Backend access</CardTitle>
          <CardDescription>
            Only needed when the backend sets <code className="font-mono">ADMIN_TOKEN</code>. Stored in this
            browser, not on the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <Controller
            name="token"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="admin-token">Admin token</FieldLabel>
                <Input {...field} id="admin-token" type="password" autoComplete="off" className="font-mono" />
                <FieldDescription>Sent as the X-Admin-Token header on every API call.</FieldDescription>
              </Field>
            )}
          />
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" variant="outline">
            Save token
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
