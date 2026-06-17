import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ImageIcon, ImageOff, Plus } from 'lucide-react'
import type { PhotoLogEntry, Project } from '@shared/ipc'
import { PhotoDropField } from '@/components/PhotoDropField'
import { PhotoLogCard } from '@/components/PhotoLogCard'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type AddMode = 'upload' | 'existing'

// A small, non-interactive thumbnail for the "from photo log" picker (the row
// itself handles selection, so we don't want a nested click target here).
function PickerThumb({ reference, alt }: { reference: string; alt: string }): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.photos.read(reference).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [reference])

  if (!dataUrl) {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center rounded border border-dashed text-[#AEAEB2]">
        <ImageOff className="size-4" />
      </div>
    )
  }
  return (
    <img src={dataUrl} alt={alt} className="size-12 shrink-0 rounded border object-cover" />
  )
}

/**
 * Per-project "toolbox photos" gallery. Reached from a Projects-row action
 * (hidden tab, like Handover flow). Its images are simply the photo-log
 * entries tagged with this project — so anything added here shows up in the
 * Photo Log grouped under the project, and anything added there for this
 * project shows up here. Photos can be uploaded fresh or pulled in from the
 * shared Photo Log.
 */
export function ProjectPhotosPage({
  projectSeed,
  onBack
}: {
  projectSeed?: { projectId: number; nonce: number } | null
  onBack?: () => void
} = {}): React.JSX.Element {
  const [project, setProject] = useState<Project | null>(null)
  const [photos, setPhotos] = useState<PhotoLogEntry[]>([])
  // Photo-log entries NOT already on this project — candidates to pull in.
  const [otherPhotos, setOtherPhotos] = useState<PhotoLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddMode>('upload')
  const [newLabel, setNewLabel] = useState('')
  const [newPhotoRef, setNewPhotoRef] = useState<string | null>(null)
  const [selectedExisting, setSelectedExisting] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  const projectId = projectSeed?.projectId ?? null

  const load = useCallback(async (): Promise<void> => {
    if (projectId === null) return
    try {
      setLoading(true)
      const [projects, entries] = await Promise.all([
        window.api.projects.list(),
        window.api.photoLog.list()
      ])
      setProject(projects.find((p) => p.id === projectId) ?? null)
      setPhotos(entries.filter((e) => e.projectId === projectId))
      setOtherPhotos(entries.filter((e) => e.projectId !== projectId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    load()
  }, [load, projectSeed?.nonce])

  function openAdd(): void {
    setAddMode('upload')
    setNewLabel('')
    setNewPhotoRef(null)
    setSelectedExisting(new Set())
    setAddOpen(true)
  }

  function toggleExisting(id: number): void {
    setSelectedExisting((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleUpload(): Promise<void> {
    if (projectId === null || !newLabel.trim() || !newPhotoRef) return
    setSaving(true)
    setError(null)
    try {
      await window.api.photoLog.create({
        label: newLabel.trim(),
        photoEvidenceRef: newPhotoRef,
        projectId
      })
      setAddOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleAddFromLog(): Promise<void> {
    if (projectId === null || selectedExisting.size === 0) return
    setSaving(true)
    setError(null)
    try {
      for (const id of selectedExisting) {
        await window.api.photoLog.setProject(id, projectId)
      }
      setAddOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeletePhoto(id: number): Promise<void> {
    setError(null)
    try {
      await window.api.photoLog.delete(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (projectId === null) {
    return (
      <div className="p-4 text-sm text-[#6E6E73]">
        No project selected. Open this view from a project row.
      </div>
    )
  }

  if (loading) {
    return <div className="p-4 text-sm text-[#6E6E73]">Loading photos…</div>
  }

  const canSave = addMode === 'upload' ? !!newLabel.trim() && !!newPhotoRef : selectedExisting.size > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {onBack && (
            <Button variant="ghost" size="icon" title="Back to projects" onClick={onBack}>
              <ArrowLeft size={16} strokeWidth={1.5} />
            </Button>
          )}
          <div>
            <h2 className="text-base font-semibold text-[#1D1D1F]">
              Toolbox photos{project ? ` — ${project.name}` : ''}
            </h2>
            <p className="mt-0.5 text-xs text-[#6E6E73]">
              Photos of toolboxes and equipment for this project. Anything added here also appears
              in the Photo Log, grouped under {project ? project.name : 'this project'}.
            </p>
          </div>
        </div>
        <Button onClick={openAdd}>
          <Plus size={16} strokeWidth={1.5} /> Add image
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-[#E5E5E5] py-16 text-center">
          <ImageIcon size={40} strokeWidth={1.5} className="mb-2 text-[#AEAEB2]" />
          <p className="text-sm font-medium text-[#1D1D1F]">No toolbox photos yet</p>
          <p className="mt-0.5 mb-3 text-xs text-[#6E6E73]">
            Upload an image, or pull one in from the Photo Log. It will be saved to this project.
          </p>
          <Button size="sm" onClick={openAdd}>
            <Plus size={14} strokeWidth={1.5} /> Add image
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {photos.map((entry) => (
            <PhotoLogCard
              key={entry.id}
              entry={entry}
              onDelete={handleDeletePhoto}
              showProject={false}
            />
          ))}
        </div>
      )}

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add toolbox image</SheetTitle>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-3">
            <div className="flex rounded-md border border-[#E5E5E5] p-0.5 text-[13px]">
              <button
                type="button"
                onClick={() => setAddMode('upload')}
                className={cn(
                  'flex-1 rounded-[5px] px-3 py-1 font-medium transition-colors duration-150',
                  addMode === 'upload'
                    ? 'bg-[#DCE8F8] text-[#0066CC]'
                    : 'text-[#6E6E73] hover:bg-[#F5F5F7]'
                )}
              >
                Upload new
              </button>
              <button
                type="button"
                onClick={() => setAddMode('existing')}
                className={cn(
                  'flex-1 rounded-[5px] px-3 py-1 font-medium transition-colors duration-150',
                  addMode === 'existing'
                    ? 'bg-[#DCE8F8] text-[#0066CC]'
                    : 'text-[#6E6E73] hover:bg-[#F5F5F7]'
                )}
              >
                From Photo Log
              </button>
            </div>

            {addMode === 'upload' ? (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="project-photo-label">Label</Label>
                  <Input
                    id="project-photo-label"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. Toolbox 02 — full kit"
                  />
                </div>
                <PhotoDropField
                  reference={newPhotoRef}
                  onChange={setNewPhotoRef}
                  label={newLabel || 'New photo'}
                />
              </>
            ) : otherPhotos.length === 0 ? (
              <p className="rounded-md border border-dashed border-[#E5E5E5] px-3 py-8 text-center text-sm text-[#6E6E73]">
                No other photos in the Photo Log to pull in. Upload a new one instead.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-[#6E6E73]">
                  Select photos to move into this project. They&apos;ll be re-tagged from their
                  current project.
                </p>
                <div className="flex max-h-96 flex-col gap-1 overflow-y-auto rounded-md border border-[#E5E5E5] p-1">
                  {otherPhotos.map((entry) => {
                    const checked = selectedExisting.has(entry.id)
                    return (
                      <label
                        key={entry.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-md p-1.5 transition-colors duration-150',
                          checked ? 'bg-[#F0F6FF]' : 'hover:bg-[#F5F5F7]'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleExisting(entry.id)}
                          className="shrink-0"
                        />
                        <PickerThumb reference={entry.photoEvidenceRef} alt={entry.label} />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-[#1D1D1F]" title={entry.label}>
                            {entry.label}
                          </p>
                          <p className="truncate text-[11px] text-[#AEAEB2]">
                            {entry.projectName ?? 'No project'}
                          </p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </SheetBody>

          <SheetFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={addMode === 'upload' ? handleUpload : handleAddFromLog}
              disabled={saving || !canSave}
            >
              {addMode === 'existing' && selectedExisting.size > 0
                ? `Add ${selectedExisting.size}`
                : 'Add'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
