import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>): React.JSX.Element {
  return (
    <input
      type={type}
      className={cn(
        'border-input flex h-8 w-full min-w-0 rounded-md border bg-white px-3 py-1 text-sm transition-colors duration-150 outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Input }
