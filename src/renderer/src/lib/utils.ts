import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Standard shadcn/ui helper: lets components accept a `className` prop and
// merge it with their own Tailwind classes without specificity fights
// (twMerge resolves conflicting utilities like `px-2` vs `px-4` sanely).
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
