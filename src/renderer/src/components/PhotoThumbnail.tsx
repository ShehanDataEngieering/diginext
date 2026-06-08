// Small reusable "thumbnail that enlarges into a lightbox on click" — used
// anywhere an item unit's attached photo needs to be shown (Item Units table,
// Dashboard drill-down). Resolves the opaque `photo_evidence_ref` to a data
// URL via `photos:read`; renders nothing distinctive for units that don't
// have a *manageable* photo (no ref, or an old free-text reference from the
// spreadsheet days that isn't a file we own).
import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function PhotoThumbnail({
  reference,
  label
}: {
  reference: string | null
  // Used as the lightbox title and the <img> alt text — typically the unit's
  // serial/ID or item name, so the enlarged view is self-explanatory.
  label: string
}): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    if (!reference) return
    window.api.photos.read(reference).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [reference])

  if (!dataUrl) {
    return (
      <div className="text-muted-foreground/50 flex size-10 items-center justify-center rounded border border-dashed">
        <ImageOff className="size-4" />
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:ring-primary block size-10 overflow-hidden rounded border hover:ring-2"
        title={`View photo — ${label}`}
      >
        <img src={dataUrl} alt={label} className="size-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
          </DialogHeader>
          <img src={dataUrl} alt={label} className="max-h-[70vh] w-full rounded object-contain" />
        </DialogContent>
      </Dialog>
    </>
  )
}
