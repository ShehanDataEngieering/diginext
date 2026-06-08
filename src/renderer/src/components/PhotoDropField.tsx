// Drag-and-drop photo attachment for the item-unit edit form. There is no
// "browse…" fallback here — `<input type="file">` opens the same native (GTK)
// picker that froze the whole app during Excel export under WSLg (see
// dataHandlers.ts), so drag-and-drop onto the app window is the only file
// input this app offers. `webUtils.getPathForFile` (bridged in preload)
// resolves the dropped File to an absolute path for the main process to copy
// into the managed photo store.
import { useEffect, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PhotoDropField({
  reference,
  onChange,
  label
}: {
  reference: string | null
  // Called with the new managed reference after a successful import, or null
  // when the user removes the photo — the caller is responsible for saving it
  // onto the unit (and the existing update/delete handlers already clean up
  // orphaned files when the reference changes).
  onChange: (reference: string | null) => void
  label: string
}): React.JSX.Element {
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    if (!reference) return
    window.api.photos.read(reference).then((url) => {
      if (!cancelled) setPreview(url)
    })
    return () => {
      cancelled = true
    }
  }, [reference])

  async function handleFiles(files: FileList | null): Promise<void> {
    const file = files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const sourcePath = window.api.photos.pathForFile(file)
      const result = await window.api.photos.import(sourcePath)
      onChange(result.reference)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
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
        className={`flex items-center gap-3 rounded-lg border border-dashed p-3 text-sm transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
        }`}
      >
        {preview ? (
          <img src={preview} alt={label} className="size-16 shrink-0 rounded border object-cover" />
        ) : (
          <div className="text-muted-foreground/50 flex size-16 shrink-0 items-center justify-center rounded border border-dashed">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">
            {busy
              ? 'Importing…'
              : 'Drag and drop a photo here to attach it (JPG, PNG, GIF, WEBP, or BMP).'}
          </p>
          {preview && !busy && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive w-fit"
              onClick={() => onChange(null)}
            >
              <Trash2 /> Remove photo
            </Button>
          )}
        </div>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}
