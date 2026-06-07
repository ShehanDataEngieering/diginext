import { Plus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TitleBarProps {
  onAddItem: () => void
}

/**
 * Custom macOS-style titlebar (traffic-light dots are purely decorative here
 * — Electron's own frame is hidden via autoHideMenuBar/frame settings — this
 * just makes the chrome read as "native Mac app" to match the rest of the design).
 */
export function TitleBar({ onAddItem }: TitleBarProps): React.JSX.Element {
  return (
    <div className="relative flex h-[38px] shrink-0 items-center border-b border-gray-200 bg-[#ECECEC] px-3">
      <div className="flex items-center gap-1.5">
        <span className="size-3 rounded-full" style={{ backgroundColor: '#FF5F57' }} />
        <span className="size-3 rounded-full" style={{ backgroundColor: '#FFBD2E' }} />
        <span className="size-3 rounded-full" style={{ backgroundColor: '#28C840' }} />
      </div>

      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[13px] font-medium text-gray-500">
        Inventory Manager
      </span>

      <div className="ml-auto flex items-center gap-2">
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
    </div>
  )
}
