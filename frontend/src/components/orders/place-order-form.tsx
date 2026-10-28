"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2Icon } from "lucide-react"
import { useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"

import { Segmented } from "@/components/orders/segmented"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { usePlaceOrder } from "@/hooks/use-api"
import {
  EXCHANGES,
  ORDER_TYPES,
  PRODUCTS,
  needsPrice,
  needsTrigger,
  placeOrderSchema,
  type PlaceOrderValues,
} from "@/lib/schemas"
import { cn } from "@/lib/utils"

const PRODUCT_LABELS = { CNC: "CNC · Delivery", MIS: "MIS · Intraday", NRML: "NRML · F&O" } as const

const DEFAULTS: PlaceOrderValues = {
  exchange: "NSE",
  tradingsymbol: "",
  transaction_type: "BUY",
  quantity: 1,
  product: "CNC",
  order_type: "MARKET",
  variety: "regular",
  price: undefined,
  trigger_price: undefined,
}

type Props = {
  masterId: string | null
  canTrade: boolean
  dryRun: boolean
  activeChildren: number
}

// Number input bound to an optional number: empty <-> undefined.
function toNumber(e: React.ChangeEvent<HTMLInputElement>) {
  return e.target.value === "" ? undefined : e.target.valueAsNumber
}

function describe(o: PlaceOrderValues): string {
  const at =
    o.order_type === "MARKET"
      ? "at market"
      : o.order_type === "SL-M"
        ? `at market once ${o.trigger_price} trades`
        : o.order_type === "SL"
          ? `limit ${o.price}, trigger ${o.trigger_price}`
          : `limit ${o.price}`
  return `${o.transaction_type} ${o.quantity} ${o.exchange}:${o.tradingsymbol} ${at} (${o.product}${o.variety === "amo" ? ", AMO" : ""})`
}

export function PlaceOrderForm({ masterId, canTrade, dryRun, activeChildren }: Props) {
  const place = usePlaceOrder()
  const [confirming, setConfirming] = useState<PlaceOrderValues | null>(null)
  const form = useForm<PlaceOrderValues>({ resolver: zodResolver(placeOrderSchema), defaultValues: DEFAULTS })
  const [side, orderType] = useWatch({ control: form.control, name: ["transaction_type", "order_type"] })

  async function confirm() {
    if (!confirming) return
    const result = await place.mutateAsync(confirming).catch(() => null) // error toast comes from the hook
    setConfirming(null)
    if (!result) return
    toast.success(`Order placed in ${masterId}`, {
      description: `${describe(confirming)}. Kite order ${result.order_id}. Children copy it once it completes.`,
    })
  }

  return (
    <Card>
      <form onSubmit={form.handleSubmit(setConfirming)} noValidate>
        <CardHeader>
          <CardTitle>Place order</CardTitle>
          <CardDescription>
            Placed in the master account{masterId ? ` ${masterId}` : ""}. Once it completes, the ticker copies it to
            the child accounts.
          </CardDescription>
        </CardHeader>

        <CardContent className="py-6">
          <fieldset disabled={!canTrade || place.isPending} className="contents">
            <FieldGroup>
              <Controller
                name="transaction_type"
                control={form.control}
                render={({ field }) => (
                  <Segmented
                    value={field.value}
                    onChange={field.onChange}
                    options={["BUY", "SELL"] as const}
                    aria-label="Buy or sell"
                    itemClassName={(v) =>
                      cn(
                        "font-semibold data-pressed:text-white",
                        v === "BUY" ? "data-pressed:bg-emerald-600" : "data-pressed:bg-red-600",
                      )
                    }
                  />
                )}
              />

              <div className="grid grid-cols-[7rem_1fr] gap-3">
                <Controller
                  name="exchange"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="order-exchange">Exchange</FieldLabel>
                      <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                        <SelectTrigger id="order-exchange" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXCHANGES.map((x) => (
                            <SelectItem key={x} value={x}>
                              {x}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
                <Controller
                  name="tradingsymbol"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="order-symbol">Symbol</FieldLabel>
                      <Input
                        {...field}
                        id="order-symbol"
                        placeholder="INFY"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        className="font-mono uppercase"
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              </div>

              <Controller
                name="product"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel>Product</FieldLabel>
                    <Segmented
                      value={field.value}
                      onChange={field.onChange}
                      options={PRODUCTS}
                      labels={PRODUCT_LABELS}
                      aria-label="Product"
                    />
                  </Field>
                )}
              />

              <Controller
                name="order_type"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel>Order type</FieldLabel>
                    <Segmented
                      value={field.value}
                      onChange={field.onChange}
                      options={ORDER_TYPES}
                      aria-label="Order type"
                    />
                  </Field>
                )}
              />

              <div className="grid grid-cols-3 gap-3">
                <Controller
                  name="quantity"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="order-qty">Quantity</FieldLabel>
                      <Input
                        {...field}
                        id="order-qty"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        value={Number.isNaN(field.value) ? "" : field.value}
                        onChange={(e) => field.onChange(e.target.value === "" ? NaN : e.target.valueAsNumber)}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  name="price"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid} data-disabled={!needsPrice(orderType)}>
                      <FieldLabel htmlFor="order-price">Price</FieldLabel>
                      <Input
                        {...field}
                        id="order-price"
                        type="number"
                        inputMode="decimal"
                        step="0.05"
                        min="0"
                        disabled={!needsPrice(orderType)}
                        placeholder={needsPrice(orderType) ? "" : "Market"}
                        value={needsPrice(orderType) ? (field.value ?? "") : ""}
                        onChange={(e) => field.onChange(toNumber(e))}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  name="trigger_price"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid} data-disabled={!needsTrigger(orderType)}>
                      <FieldLabel htmlFor="order-trigger">Trigger</FieldLabel>
                      <Input
                        {...field}
                        id="order-trigger"
                        type="number"
                        inputMode="decimal"
                        step="0.05"
                        min="0"
                        disabled={!needsTrigger(orderType)}
                        placeholder={needsTrigger(orderType) ? "" : "—"}
                        value={needsTrigger(orderType) ? (field.value ?? "") : ""}
                        onChange={(e) => field.onChange(toNumber(e))}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              </div>

              <Controller
                name="variety"
                control={form.control}
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <Switch
                      id="order-amo"
                      checked={field.value === "amo"}
                      onCheckedChange={(on) => field.onChange(on ? "amo" : "regular")}
                    />
                    <div className="grid gap-1">
                      <FieldLabel htmlFor="order-amo">After-market order (AMO)</FieldLabel>
                      <FieldDescription>Queue the order for the next market open.</FieldDescription>
                    </div>
                  </Field>
                )}
              />
            </FieldGroup>
          </fieldset>
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            disabled={!canTrade || place.isPending}
            className={cn(
              "w-full text-white",
              side === "BUY" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700",
            )}
          >
            {place.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
            {side === "BUY" ? "Buy" : "Sell"}
          </Button>
        </CardFooter>
      </form>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && !place.isPending && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Place this order in {masterId}?</AlertDialogTitle>
            <AlertDialogDescription render={<div />} className="grid gap-2">
              <p className="font-mono text-foreground">{confirming && describe(confirming)}</p>
              <p>
                This is a real order on your Zerodha account.{" "}
                {dryRun
                  ? "Dry run is on, so the child copies will only be logged, not placed."
                  : `Once it completes, it is copied to ${activeChildren} active child account${activeChildren === 1 ? "" : "s"}.`}
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={place.isPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={confirm}
              disabled={place.isPending}
              className={cn(
                "text-white",
                confirming?.transaction_type === "SELL"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-emerald-600 hover:bg-emerald-700",
              )}
            >
              {place.isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              Place {confirming?.transaction_type === "SELL" ? "sell" : "buy"} order
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
