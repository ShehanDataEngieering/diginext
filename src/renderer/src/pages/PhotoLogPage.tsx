import { useEffect, useMemo, useState } from 'react'
import { Camera, Download, Plus, Search, Trash2 } from 'lucide-react'
import type { ItemUnitWithDetails, PhotoLogEntry, Project } from '@shared/ipc'
import { PhotoDropField } from '@/components/PhotoDropField'
import { PhotoThumbnail } from '@/components/PhotoThumbnail'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ALL_PROJECTS = '__all__'

function downloadFileName(label: string, reference: string): string {
  const ext = reference.includes('.') ? reference.slice(reference.lastIndexOf('.')) : ''
  const safeLabel = label.trim().replace(/[/\\:*?"<>|]+/g, '-')
  return `${safeLabel || 'photo'}${ext}`
}

function PhotoLogCard({
  entry,
  onDelete
}: {
  entry: PhotoLogEntry
  onDelete: (id: number) => void
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
        <p className="truncate text-[11px] text-[#AEAEB2]">{entry.projectName ?? 'No project'}</p>
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
          {dataUrl && <img src={dataUrl} alt={entry.label} className="max-h-[75vh] w-full rounded object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function PhotoLogPage(): React.JSX.Element {
  const [units, setUnits] = useState<ItemUnitWithDetails[]>([])
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS)

  const [photoLog, setPhotoLog] = useState<PhotoLogEntry[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newPhotoRef, setNewPhotoRef] = useState<string | null>(null)
  const [newProjectId, setNewProjectId] = useState(ALL_PROJECTS)
  const [saving, setSaving] = useState(false)

  async function load(): Promise<void> {
    try {
      setLoading(true)
      const [allUnits, entries, projects] = await Promise.all([
        window.api.itemUnits.list(),
        window.api.photoLog.list(),
        window.api.projects.list()
      ])
      setUnits(allUnits)
      setPhotoLog(entries)
      setAllProjects(projects)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAddPhoto(): Promise<void> {
    if (!newLabel.trim() || !newPhotoRef) return
    setSaving(true)
    setError(null)
    try {
      await window.api.photoLog.create({
        label: newLabel.trim(),
        photoEvidenceRef: newPhotoRef,
        projectId: newProjectId === ALL_PROJECTS ? null : Number(newProjectId)
      })
      setAddOpen(false)
      setNewLabel('')
      setNewPhotoRef(null)
      setNewProjectId(ALL_PROJECTS)
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

  const unitsWithPhotos = useMemo(
    () => units.filter((u) => u.photoEvidenceRef !== null && u.photoEvidenceRef !== ''),
    [units]
  )

  const projectNames = useMemo(() => {
    const names = new Map<number, string>()
    for (const u of units) {
      if (u.assignedProjectId !== null && u.projectName) {
        names.set(u.assignedProjectId, u.projectName)
      }
    }
    for (const p of photoLog) {
      if (p.projectId !== null && p.projectName) {
        names.set(p.projectId, p.projectName)
      }
    }
    return Array.from(names.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [units, photoLog])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return unitsWithPhotos.filter((u) => {
      if (projectFilter !== ALL_PROJECTS && u.assignedProjectId !== Number(projectFilter)) return false
      if (needle) {
        const haystack = `${u.serialId ?? ''} ${u.itemName} ${u.itemCategory}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [unitsWithPhotos, search, projectFilter])

  const filteredPhotoLog = useMemo(() => {
    if (projectFilter === ALL_PROJECTS) return photoLog
    return photoLog.filter((p) => p.projectId === Number(projectFilter))
  }, [photoLog, projectFilter])

  const photoLogGroups = useMemo(() => {
    const groups = new Map<string, { projectId: number | null; projectName: string; entries: PhotoLogEntry[] }>()
    for (const entry of filteredPhotoLog) {
      const key = entry.projectId === null ? 'none' : String(entry.projectId)
      const name = entry.projectName ?? 'No project'
      let group = groups.get(key)
      if (!group) {
        group = { projectId: entry.projectId, projectName: name, entries: [] }
        groups.set(key, group)
      }
      group.entries.push(entry)
    }
    return Array.from(groups.values()).sort((a, b) => {
      if (a.projectId === null) return 1
      if (b.projectId === null) return -1
      return a.projectName.localeCompare(b.projectName)
    })
  }, [filteredPhotoLog])

  if (loading) {
    return <div className="p-4 text-sm text-[#6E6E73]">Loading photos…</div>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start justify-between gap-2 px-4 pt-4 pb-3">
        <div>
          <h2 className="text-base font-semibold text-[#1D1D1F]">Photo Log</h2>
          <p className="mt-0.5 text-xs text-[#6E6E73]">
            All item units with attached photo evidence — {unitsWithPhotos.length} photo{unitsWithPhotos.length === 1 ? '' : 's'} total.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} strokeWidth={1.5} /> Add new image
        </Button>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[#E5E5E5] px-4">
        <div className="relative w-[220px]">
          <Search
            size={14}
            strokeWidth={1.5}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[#AEAEB2]"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search serial or item…"
            className="h-7 pl-7 text-[13px]"
          />
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-7 w-48 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {projectNames.map(([id, name]) => (
              <SelectItem key={id} value={String(id)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="px-3.5 pt-2 text-[12px] text-red-500">{error}</p>}

      {photoLogGroups.length > 0 && (
        <div className="shrink-0 border-b border-[#E5E5E5] px-4 py-3">
          {photoLogGroups.map((group) => (
            <div key={group.projectId ?? 'none'} className="mb-4 last:mb-0">
              <h3 className="mb-2 text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
                {group.projectName}
              </h3>
              <div className="flex flex-wrap gap-3">
                {group.entries.map((entry) => (
                  <PhotoLogCard key={entry.id} entry={entry} onDelete={handleDeletePhoto} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Camera size={40} strokeWidth={1.5} className="mb-2 text-[#AEAEB2]" />
            <p className="text-sm font-medium text-[#1D1D1F]">
              {unitsWithPhotos.length === 0
                ? 'No photos attached to any units yet'
                : 'No photos match the current filters'}
            </p>
            <p className="mt-0.5 text-xs text-[#6E6E73]">
              {unitsWithPhotos.length === 0
                ? 'Attach photo evidence to units, or add a general image above.'
                : 'Try a different search or project filter.'}
            </p>
          </div>
        ) : (
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-[#F5F5F7]">
              <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
                <th className="w-[64px] px-3 py-2 text-left">Photo</th>
                <th className="px-3 py-2 text-left">Serial / Unique ID</th>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Project</th>
                <th className="w-[110px] px-3 py-2 text-left">Audit Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((unit, idx) => (
                <tr
                  key={unit.id}
                  className={`h-9 border-b border-[#F0F0F0] transition-colors duration-150 hover:bg-[#F0F6FF] ${
                    idx % 2 === 0 ? 'bg-[#FAFAFA]' : 'bg-white'
                  }`}
                >
                  <td className="px-3 py-1.5">
                    <PhotoThumbnail
                      reference={unit.photoEvidenceRef}
                      label={unit.serialId ?? `${unit.itemName} (unit #${unit.id})`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-[#1D1D1F]">
                    {unit.serialId ?? <span className="text-[#D1D1D6]">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[#1D1D1F]">{unit.itemName}</td>
                  <td className="px-3 py-2 text-[#6E6E73]">{unit.itemCategory}</td>
                  <td className="px-3 py-2 text-[#6E6E73]">
                    {unit.projectName ?? <span className="text-[#AEAEB2]">Available</span>}
                  </td>
                  <td className="px-3 py-2 text-[#6E6E73]">
                    {unit.auditDate ?? <span className="text-[#D1D1D6]">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Add new image</SheetTitle>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="photo-log-label">Label</Label>
              <Input
                id="photo-log-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. DG/25/TB 02 - FIRST"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Project</Label>
              <Select value={newProjectId} onValueChange={setNewProjectId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROJECTS}>No project</SelectItem>
                  {allProjects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <PhotoDropField reference={newPhotoRef} onChange={setNewPhotoRef} label={newLabel || 'New photo'} />
          </SheetBody>

          <SheetFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddPhoto} disabled={saving || !newLabel.trim() || !newPhotoRef}>
              Add
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
