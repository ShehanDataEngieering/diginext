import { useEffect, useState } from 'react'
import { Archive, Download, Pencil, Plus, RotateCcw } from 'lucide-react'
import type { Project, ProjectInput } from '@shared/ipc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const emptyForm: ProjectInput = { name: '', location: '', updatedBy: '', lastUpdatedDate: '' }

// The form keeps these as plain strings (empty string = "not set" in the UI)
// and we translate to the nullable shape the DB/IPC layer expects on save —
// keeps the inputs simple controlled components without `value={x ?? ''}` everywhere.
function toInput(form: typeof emptyForm): ProjectInput {
  return {
    name: form.name.trim(),
    location: form.location?.trim() || null,
    updatedBy: form.updatedBy?.trim() || null,
    lastUpdatedDate: form.lastUpdatedDate?.trim() || null
  }
}

export function ProjectsPage(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogProject, setDialogProject] = useState<Project | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [exportingId, setExportingId] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function reload(): Promise<void> {
    try {
      setProjects(await window.api.projects.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    reload()
  }, [])

  function openCreate(): void {
    setForm(emptyForm)
    setDialogProject('new')
  }

  function openEdit(project: Project): void {
    setForm({
      name: project.name,
      location: project.location ?? '',
      updatedBy: project.updatedBy ?? '',
      lastUpdatedDate: project.lastUpdatedDate ?? ''
    })
    setDialogProject(project)
  }

  async function handleSave(): Promise<void> {
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const input = toInput(form)
      if (dialogProject === 'new') {
        await window.api.projects.create(input)
      } else if (dialogProject) {
        await window.api.projects.update(dialogProject.id, input)
      }
      setDialogProject(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(project: Project): Promise<void> {
    const next = project.status === 'active' ? 'completed' : 'active'
    if (
      next === 'completed' &&
      !confirm(
        `Archive "${project.name}"? It stays visible for history, but won't get its own ` +
          'dashboard column or appear as an assignment target for new units.'
      )
    ) {
      return
    }
    setError(null)
    try {
      await window.api.projects.setStatus(project.id, next)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // "Export inventory sheet for [Project]" (plan's Excel Export section).
  // The actual file-picking and writing happens in the main process — this
  // just triggers it and reports back. A canceled save dialog isn't an
  // error, so it's distinguished from real failures rather than surfaced
  // through the same `error` banner as everything else on this page.
  async function handleExport(project: Project): Promise<void> {
    setExportingId(project.id)
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.excel.exportProject(project.id)
      if (!result.canceled && result.filePath) {
        setNotice(`Exported "${project.name}" to ${result.filePath}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExportingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Projects</h2>
          <p className="text-muted-foreground text-sm">
            Sites/regions that equipment is deployed to. Archiving keeps history but stops new
            assignments — a hand-over flow lands in a later milestone.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus /> Add project
        </Button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {notice && <p className="text-sm text-emerald-600">{notice}</p>}

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Updated by</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects?.map((project) => (
              <TableRow key={project.id}>
                <TableCell className="font-medium">{project.name}</TableCell>
                <TableCell>{project.location ?? '—'}</TableCell>
                <TableCell>{project.updatedBy ?? '—'}</TableCell>
                <TableCell>{project.lastUpdatedDate ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={project.status === 'active' ? 'default' : 'secondary'}>
                    {project.status === 'active' ? 'Active' : 'Completed'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={`Export inventory sheet for ${project.name}`}
                      disabled={exportingId === project.id}
                      onClick={() => handleExport(project)}
                    >
                      <Download />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(project)}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={project.status === 'active' ? 'Archive' : 'Reactivate'}
                      onClick={() => toggleStatus(project)}
                    >
                      {project.status === 'active' ? <Archive /> : <RotateCcw />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {projects?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center">
                  No projects yet — add the first one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogProject !== null} onOpenChange={(open) => !open && setDialogProject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogProject === 'new' ? 'Add project' : 'Edit project'}</DialogTitle>
            <DialogDescription>Site/region details, mirroring the per-project sheet header.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. At North Copenhagen"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-location">Location</Label>
              <Input
                id="project-location"
                value={form.location ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-updated-by">Updated by</Label>
              <Input
                id="project-updated-by"
                value={form.updatedBy ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, updatedBy: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-last-updated">Last updated date</Label>
              <Input
                id="project-last-updated"
                type="date"
                value={form.lastUpdatedDate ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, lastUpdatedDate: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogProject(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {dialogProject === 'new' ? 'Create' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
