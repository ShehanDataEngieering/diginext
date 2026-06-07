import { Plus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TitleBarProps {
  onAddItem: () => void
}

/**
 * Slim action toolbar under the OS's own window chrome. The original design
 * reference simulated a whole macOS window (traffic-light dots, centered
 * title) — but this app already runs inside a real native window with its
 * own controls and title, so reproducing fake ones here would just stack two
 * titlebars on top of each other. Keeping only the bits that add value:
 * global quick actions.
 */
export function TitleBar({ onAddItem }: TitleBarProps): React.JSX.Element {
  return (
    <div className="flex h-[44px] shrink-0 items-center justify-end gap-2 border-b border-gray-200 bg-[#ECECEC] px-3.5">
      <Button variant="outline" size="sm" className="h-auto rounded-md px-3 py-1 text-[12px]" onClick={onAddItem}>
        <Plus /> Add item
      </Button>
      <Button
        size="sm"
        className="h-auto rounded-md px-3 py-1 text-[12px]"
        disabled
        title="Excel export lands in a later milestone"
      >
        <Upload /> Export
      </Button>
    </div>
  )
}
