// Multi-photo drag-and-drop (and "Browse…") gallery for the item-unit edit
// form. Manages an ordered list of managed photo references; the first is the
// "cover" that the table/dashboard/Excel export show. Each dropped or selected
// File is resolved to an absolute path via `webUtils.getPathForFile` (bridged
// in preload) and imported into the managed photo store, appending its
// reference to the list. Removing a photo just drops it from the list — the
// update/delete IPC handlers clean up the orphaned storage objects on save.
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

function GalleryImage({
  reference,
  isCover,
  onRemove,
  onMakeCover
}: {
  reference: string
  isCover: boolean
  onRemove: () => void
  onMakeCover: () => void
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setUrl(null)
    window.api.photos.read(reference).then((u) => {
      if (!cancelled) setUrl(u)
    })
    return () => {
      cancelled = true
    }
  }, [reference])

  return (
    <div className="group relative size-20 shrink-0 overflow-hidden rounded border">
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <div className="text-muted-foreground/50 flex size-full items-center justify-center">
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}
      {isCover && (
        <span className="bg-primary text-primary-foreground absolute bottom-0 left-0 flex items-center gap-0.5 rounded-tr px-1 py-0.5 text-[10px] font-medium">
          <Star className="size-2.5 fill-current" /> Cover
        </span>
      )}
      {!isCover && (
        <button
          type="button"
          title="Make cover photo"
          onClick={onMakeCover}
          className="bg-background/80 absolute bottom-0.5 left-0.5 hidden rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:block"
        >
          <Star className="size-3" />
        </button>
      )}
      <button
        type="button"
        title="Remove photo"
        onClick={onRemove}
        className="bg-background/80 text-destructive absolute right-0.5 top-0.5 rounded p-0.5 hover:bg-background"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

export function PhotoGalleryField({
  refs,
  onChange,
  label
}: {
  refs: string[]
  // Called with the new ordered list after any add / remove / reorder. The
  // caller stores it and passes it as `photoRefs` when saving the unit.
  onChange: (refs: string[]) => void
  label: string
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null): Promise<void> {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return
    setBusy(true)
    setError(null)
    const added: string[] = []
    try {
      for (const file of list) {
        const sourcePath = window.api.photos.pathForFile(file)
        const result = await window.api.photos.import(sourcePath)
        added.push(result.reference)
      }
      if (added.length > 0) onChange([...refs, ...added])
    } catch (err) {
      // Keep whatever imported successfully before the failure.
      if (added.length > 0) onChange([...refs, ...added])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function removeAt(index: number): void {
    onChange(refs.filter((_, i) => i !== index))
  }

  function makeCover(index: number): void {
    if (index === 0) return
    const next = [...refs]
    const [picked] = next.splice(index, 1)
    onChange([picked, ...next])
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void handleFiles(event.dataTransfer.files)
        }}
        className={`flex flex-col gap-3 rounded-lg border border-dashed p-3 text-sm transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
        }`}
      >
        {refs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {refs.map((reference, index) => (
              <GalleryImage
                key={reference}
                reference={reference}
                isCover={index === 0}
                onRemove={() => removeAt(index)}
                onMakeCover={() => makeCover(index)}
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <div className="text-muted-foreground/50 flex size-10 shrink-0 items-center justify-center rounded border border-dashed">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground">
              {busy
                ? 'Importing…'
                : refs.length > 0
                  ? 'Drag more photos here, or browse, to add them. The first is the cover.'
                  : 'Drag and drop photos here, or browse, to attach them (JPG, PNG, GIF, WEBP, or BMP).'}
            </p>
            {!busy && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse…
              </Button>
            )}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
          className="hidden"
          onChange={(event) => {
            void handleFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <span className="sr-only">{label}</span>
    </div>
  )
}
