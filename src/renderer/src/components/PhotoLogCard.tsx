import { useEffect, useState } from 'react'
import { Camera, Download, Trash2 } from 'lucide-react'
import type { PhotoLogEntry } from '@shared/ipc'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

export function downloadFileName(label: string, reference: string): string {
  const ext = reference.includes('.') ? reference.slice(reference.lastIndexOf('.')) : ''
  const safeLabel = label.trim().replace(/[/\\:*?"<>|]+/g, '-')
  return `${safeLabel || 'photo'}${ext}`
}

/**
 * A single photo-log image card: thumbnail (click to enlarge), label, project
 * name, plus Download / Remove actions. Shared by the Photo Log page and the
 * per-project Toolbox Photos page so both render identically.
 */
export function PhotoLogCard({
  entry,
  onDelete,
  showProject = true
}: {
  entry: PhotoLogEntry
  onDelete: (id: number) => void
  showProject?: boolean
}): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    window.api.photos.read(entry.photoEvidenceRef).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [entry.photoEvidenceRef])

  return (
    <div className="flex w-full max-w-[360px] flex-col gap-2 rounded-md border border-[#E5E5E5] bg-white p-2 transition-shadow duration-150 hover:shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <button
        type="button"
        onClick={() => dataUrl && setOpen(true)}
        className="block h-56 w-full overflow-hidden rounded bg-gray-50"
        disabled={!dataUrl}
      >
        {dataUrl ? (
          <img src={dataUrl} alt={entry.label} className="size-full object-contain" />
        ) : (
          <div className="flex size-full items-center justify-center text-gray-300">
            <Camera size={28} />
          </div>
        )}
      </button>
      <div>
        <p className="truncate text-[13px] font-medium text-[#1D1D1F]" title={entry.label}>
          {entry.label}
        </p>
        {showProject && (
          <p className="truncate text-[11px] text-[#AEAEB2]">{entry.projectName ?? 'No project'}</p>
        )}
      </div>
      <div className="flex items-center gap-3 text-[12px]">
        {dataUrl && (
          <a
            href={dataUrl}
            download={downloadFileName(entry.label, entry.photoEvidenceRef)}
            className="flex items-center gap-1 text-[#0066CC] transition-colors duration-150 hover:text-[#0052A3]"
          >
            <Download size={12} strokeWidth={1.5} /> Download
          </a>
        )}
        <button
          type="button"
          onClick={() => onDelete(entry.id)}
          className="flex items-center gap-1 text-[#6E6E73] transition-colors duration-150 hover:text-red-600"
        >
          <Trash2 size={12} strokeWidth={1.5} /> Remove
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{entry.label}</DialogTitle>
          </DialogHeader>
          {dataUrl && (
            <img src={dataUrl} alt={entry.label} className="max-h-[75vh] w-full rounded object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
