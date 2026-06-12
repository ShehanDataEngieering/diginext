import { useEffect, useState } from 'react'
import { Archive, ArrowRightLeft, ClipboardCheck, Download, Pencil, Plus, RotateCcw, Upload } from 'lucide-react'
import type { ItemUnitWithDetails, Project, ProjectInput, ImportSummary } from '@shared/ipc'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const UNASSIGNED = '__unassigned__'

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

export function ProjectsPage({
  onStartHandover
}: {
  onStartHandover?: (projectId: number) => void
} = {}): React.JSX.Element {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogProject, setDialogProject] = useState<Project | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [exportingId, setExportingId] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Path-based import fallback for WSLg where drag-and-drop from Windows
  // Explorer never reaches the app (WSLg doesn't bridge drag events).
  const [importPath, setImportPath] = useState('')

  const [transferProject, setTransferProject] = useState<Project | null>(null)
  const [transferUnits, setTransferUnits] = useState<ItemUnitWithDetails[]>([])
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<number>>(new Set())
  const [bulkDestProjectId, setBulkDestProjectId] = useState(UNASSIGNED)
  const [bulkTransferring, setBulkTransferring] = useState(false)

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
  // The main process writes straight to a fixed "Diginext Inventory Exports"
  // folder under Documents (no save-as picker — see dataHandlers.ts for why
  // native dialogs aren't usable here) and hands back exactly where it landed.
  async function handleExport(project: Project): Promise<void> {
    setExportingId(project.id)
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.excel.exportProject(project.id)
      setNotice(`Exported "${project.name}" to ${result.filePath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExportingId(null)
    }
  }

  async function runImport(sourcePath: string): Promise<void> {
    setImporting(true)
    setError(null)
    setNotice(null)
    setImportSummary(null)
    try {
      const summary = await window.api.excel.importProject(sourcePath)
      if (!summary) {
        setError('This file is not a valid Diginext export (missing metadata sheet).')
      } else {
        setImportSummary(summary)
        setNotice(`Imported "${summary.projectName}" — ${summary.transfersCreated} transfer(s) recorded.`)
        await reload()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  async function handleImport(files: FileList | null): Promise<void> {
    const file = files?.[0]
    if (!file) return
    await runImport(window.api.photos.pathForFile(file))
  }

  async function handleImportFromPath(): Promise<void> {
    const path = importPath.trim()
    if (!path) return
    await runImport(path)
    setImportPath('')
  }

  async function openTransferUnits(project: Project): Promise<void> {
    setTransferProject(project)
    setSelectedUnitIds(new Set())
    setBulkDestProjectId(UNASSIGNED)
    try {
      const units = await window.api.itemUnits.list({ projectId: project.id })
      setTransferUnits(units)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function toggleUnitSelected(unitId: number): void {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev)
      if (next.has(unitId)) next.delete(unitId)
      else next.add(unitId)
      return next
    })
  }

  async function handleBulkTransfer(): Promise<void> {
    if (!transferProject || selectedUnitIds.size === 0) return
    const toProjectId = bulkDestProjectId === UNASSIGNED ? null : Number(bulkDestProjectId)
    setBulkTransferring(true)
    setError(null)
    try {
      const selected = transferUnits.filter((u) => selectedUnitIds.has(u.id))
      for (const unit of selected) {
        await window.api.itemUnits.update(unit.id, {
          itemId: unit.itemId,
          serialId: unit.serialId,
          assignedProjectId: toProjectId,
          auditDate: unit.auditDate,
          remarks: unit.remarks,
          status: unit.status,
          photoEvidenceRef: unit.photoEvidenceRef
        })
        await window.api.transfers.create({
          date: new Date().toISOString().slice(0, 10),
          itemId: unit.itemId,
          serialId: unit.serialId,
          qty: 1,
          fromProjectId: unit.assignedProjectId,
          toProjectId,
          transferredBy: null,
          authorizedBy: null,
          notes: null,
          status: 'Completed'
        })
      }
      setTransferProject(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBulkTransferring(false)
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

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void handleImport(event.dataTransfer.files)
        }}
        className={`flex flex-col gap-3 rounded-lg border border-dashed p-4 text-sm transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="text-muted-foreground/50 flex size-10 shrink-0 items-center justify-center rounded border border-dashed">
            {importing ? (
              <div className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Upload className="size-5" />
            )}
          </div>
          <p className="text-muted-foreground">
            {importing
              ? 'Importing and reconciling…'
              : 'Drag and drop a filled-in export sheet here to import transfers.'}
          </p>
        </div>

        {/* Path input fallback — drag-and-drop from Windows Explorer does not
            work in WSLg (drag events never reach Linux apps). Paste the full
            Linux path to the xlsx file here instead, e.g.
            /home/user/Documents/Diginext Inventory Exports/Inventory - X.xlsx */}
        <div className="flex gap-2">
          <Input
            className="font-mono text-xs"
            placeholder="/home/shehanp12/Documents/Diginext Inventory Exports/Inventory - ….xlsx"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleImportFromPath()}
            disabled={importing}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={importing || !importPath.trim()}
            onClick={() => void handleImportFromPath()}
          >
            Import
          </Button>
        </div>
      </div>

      {importSummary && (
        <div className="rounded-lg border bg-blue-50 p-4">
          <h3 className="mb-2 font-semibold">
            Import complete — {importSummary.projectName}
            {importSummary.projectCreated && (
              <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">
                new project created
              </span>
            )}
          </h3>
          <ul className="space-y-1 text-sm">
            {importSummary.itemsCreated > 0 && (
              <li>🆕 New item types created: {importSummary.itemsCreated}</li>
            )}
            <li>➕ Units added: {importSummary.unitsAdded}</li>
            <li>✏️ Units updated (audit / remarks): {importSummary.unitsUpdated}</li>
            <li>🔄 Units transferred here: {importSummary.transfersCreated}</li>
            {importSummary.unitsRemoved > 0 && (
              <li className="text-amber-700">
                ⚠️ Units missing from sheet (review manually): {importSummary.unitsRemoved}
              </li>
            )}
          </ul>
          {importSummary.details.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">View details</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {importSummary.details.map((detail, i) => (
                  <li key={i} className={detail.type === 'removed' ? 'text-amber-700' : ''}>
                    {detail.type === 'added' && `+ ${detail.itemName} (${detail.serialId ?? 'no serial'}) — ${detail.notes ?? ''}`}
                    {detail.type === 'removed' && `⚠ ${detail.itemName} (${detail.serialId ?? 'no serial'}) — ${detail.notes ?? ''}`}
                    {detail.type === 'transferred' &&
                      `→ ${detail.itemName} (${detail.serialId ?? 'no serial'}) from ${detail.fromProject ?? 'unknown'}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

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
                      title="Transfer units out of this project"
                      onClick={() => openTransferUnits(project)}
                    >
                      <ArrowRightLeft />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Start handover for this project"
                      onClick={() => onStartHandover?.(project.id)}
                    >
                      <ClipboardCheck />
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

      <Dialog open={transferProject !== null} onOpenChange={(open) => !open && setTransferProject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer units</DialogTitle>
            <DialogDescription>
              {transferProject
                ? `Move selected units out of "${transferProject.name}" to another project.`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="max-h-64 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Item</TableHead>
                    <TableHead>Serial / ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transferUnits.map((unit) => (
                    <TableRow key={unit.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedUnitIds.has(unit.id)}
                          onChange={() => toggleUnitSelected(unit.id)}
                        />
                      </TableCell>
                      <TableCell>
                        {unit.itemCategory} — {unit.itemName}
                      </TableCell>
                      <TableCell className="font-medium">{unit.serialId ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                  {transferUnits.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-muted-foreground text-center">
                        No units assigned to this project.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Destination project</Label>
              <Select value={bulkDestProjectId} onValueChange={setBulkDestProjectId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Available (unassigned)</SelectItem>
                  {projects
                    ?.filter((p) => p.id !== transferProject?.id)
                    .map((project) => (
                      <SelectItem key={project.id} value={String(project.id)}>
                        {project.name}
                        {project.status === 'completed' ? ' (completed)' : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferProject(null)}>
              Cancel
            </Button>
            <Button onClick={handleBulkTransfer} disabled={bulkTransferring || selectedUnitIds.size === 0}>
              Transfer {selectedUnitIds.size > 0 ? `(${selectedUnitIds.size})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
