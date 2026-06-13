// Side-panel variant of Dialog, built on the same Radix primitive. Add/edit
// forms slide in from the right (440px) instead of opening a centered modal —
// keeps the underlying table visible for reference while editing.
import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>): React.JSX.Element {
  return <SheetPrimitive.Root {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>): React.JSX.Element {
  return <SheetPrimitive.Trigger {...props} />
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>): React.JSX.Element {
  return <SheetPrimitive.Close {...props} />
}

function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>): React.JSX.Element {
  return <SheetPrimitive.Portal {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>): React.JSX.Element {
  return (
    <SheetPrimitive.Overlay
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/25',
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'right' | 'left'
}): React.JSX.Element {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        className={cn(
          'bg-background fixed z-50 flex h-full w-[440px] max-w-[calc(100vw-2rem)] flex-col border-l shadow-lg transition duration-200 ease-out',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          side === 'right'
            ? 'inset-y-0 right-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right'
            : 'inset-y-0 left-0 border-r border-l-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="ring-offset-background focus:ring-ring absolute top-3 right-3 flex size-7 items-center justify-center rounded-md text-[#6E6E73] transition-colors duration-150 hover:bg-[#F5F5F7] focus:ring-1 focus:outline-none disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div className={cn('flex shrink-0 flex-col gap-0.5 border-b px-4 py-3', className)} {...props} />
  )
}

function SheetBody({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4', className)} {...props} />
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      className={cn('flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3', className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>): React.JSX.Element {
  return (
    <SheetPrimitive.Title
      className={cn('text-base leading-tight font-semibold text-[#1D1D1F]', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>): React.JSX.Element {
  return (
    <SheetPrimitive.Description
      className={cn('text-[12px] text-[#6E6E73]', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger
}
