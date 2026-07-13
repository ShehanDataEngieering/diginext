// Table/dashboard thumbnail for a unit's photo gallery: shows the cover image
// with a "+N" badge when there's more than one, and opens a lightbox that pages
// through every photo. Resolves opaque refs to data URLs via `photos:read`.
// Renders a muted placeholder for units with no manageable photo (empty list,
// or only an old free-text reference from the spreadsheet days).
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

function useDataUrl(reference: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setUrl(null)
    if (!reference) return
    window.api.photos.read(reference).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [reference])
  return url
}

export function PhotoGalleryThumbnail({
  references,
  label
}: {
  references: string[]
  // Lightbox title / alt text — typically the unit's serial or item name.
  label: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)

  const cover = references[0] ?? null
  const coverUrl = useDataUrl(cover)
  const activeRef = references[index] ?? cover
  const activeUrl = useDataUrl(open ? activeRef : null)

  if (!coverUrl) {
    return (
      <div className="text-muted-foreground/50 flex size-10 items-center justify-center rounded border border-dashed">
        <ImageOff className="size-4" />
      </div>
    )
  }

  const count = references.length

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIndex(0)
          setOpen(true)
        }}
        className="hover:ring-primary relative block size-10 overflow-hidden rounded border hover:ring-2"
        title={count > 1 ? `View ${count} photos — ${label}` : `View photo — ${label}`}
      >
        <img src={coverUrl} alt={label} className="size-full object-cover" />
        {count > 1 && (
          <span className="bg-background/80 text-foreground absolute bottom-0 right-0 rounded-tl px-1 text-[10px] font-medium">
            +{count - 1}
          </span>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {label}
              {count > 1 && (
                <span className="text-muted-foreground ml-2 text-sm font-normal">
                  {index + 1} / {count}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="relative">
            {activeUrl ? (
              <img src={activeUrl} alt={label} className="max-h-[70vh] w-full rounded object-contain" />
            ) : (
              <div className="text-muted-foreground flex h-64 items-center justify-center">Loading…</div>
            )}
            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setIndex((i) => (i - 1 + count) % count)}
                  className="bg-background/70 hover:bg-background absolute left-2 top-1/2 -translate-y-1/2 rounded-full border p-1"
                  title="Previous"
                >
                  <ChevronLeft className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIndex((i) => (i + 1) % count)}
                  className="bg-background/70 hover:bg-background absolute right-2 top-1/2 -translate-y-1/2 rounded-full border p-1"
                  title="Next"
                >
                  <ChevronRight className="size-5" />
                </button>
              </>
            )}
          </div>
          {count > 1 && (
            <div className="flex flex-wrap gap-2">
              {references.map((ref, i) => (
                <GalleryStripThumb
                  key={ref}
                  reference={ref}
                  active={i === index}
                  onClick={() => setIndex(i)}
                />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function GalleryStripThumb({
  reference,
  active,
  onClick
}: {
  reference: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const url = useDataUrl(reference)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`size-12 overflow-hidden rounded border ${active ? 'ring-primary ring-2' : ''}`}
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <div className="bg-muted size-full" />
      )}
    </button>
  )
}
