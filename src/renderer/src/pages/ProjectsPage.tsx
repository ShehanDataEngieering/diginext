import { useEffect, useState } from 'react'
import {
  Archive,
  ArrowRightLeft,
  ClipboardCheck,
  Download,
  FolderKanban,
  Pencil,
  Plus,
  RotateCcw,
  Upload
} from 'lucide-react'
import type { ItemUnitWithDetails, Project, ProjectInput, ImportSummary } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
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

  const [transferProject, setTransferProject] = useState<Project | null>(null)
  const [transferUnits, setTransferUnits] = useState<ItemUnitWithDetails[]>([])
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<number>>(new Set())
  const [bulkDestProjectId, setBulkDestProjectId] = useState(UNASSIGNED)
  const [bulkTransferring, setBulkTransferring] = useState(false)

  // Shown right after a new project is created, so units can be assigned to
  // it immediately instead of bouncing to the Item Units page.
  const [assignProject, setAssignProject] = useState<Project | null>(null)
  const [assignUnits, setAssignUnits] = useState<ItemUnitWithDetails[]>([])
  const [selectedAssignUnitIds, setSelectedAssignUnitIds] = useState<Set<number>>(new Set())
  const [assigning, setAssigning] = useState(false)

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
        const created = await window.api.projects.create(input)
        setDialogProject(null)
        await reload()
        await openAssignUnits(created)
        return
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

  async function openAssignUnits(project: Project): Promise<void> {
    setAssignProject(project)
    setSelectedAssignUnitIds(new Set())
    try {
      const units = await window.api.itemUnits.list({})
      setAssignUnits(units.filter((u) => u.assignedProjectId !== project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function toggleAssignUnitSelected(unitId: number): void {
    setSelectedAssignUnitIds((prev) => {
      const next = new Set(prev)
      if (next.has(unitId)) next.delete(unitId)
      else next.add(unitId)
      return next
    })
  }

  async function handleAssignUnits(): Promise<void> {
    if (!assignProject || selectedAssignUnitIds.size === 0) return
    setAssigning(true)
    setError(null)
    try {
      const selected = assignUnits.filter((u) => selectedAssignUnitIds.has(u.id))
      for (const unit of selected) {
        await window.api.itemUnits.update(unit.id, {
          itemId: unit.itemId,
          serialId: unit.serialId,
          assignedProjectId: assignProject.id,
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
          toProjectId: assignProject.id,
          transferredBy: null,
          authorizedBy: null,
          notes: null,
          status: 'Completed'
        })
      }
      setAssignProject(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAssigning(false)
    }
  }

  // Group units by their parent item so the assign-units picker reads as
  // "Item -> its units" rather than one flat list.
  const groupedAssignUnits = (() => {
    const groups = new Map<number, { itemCategory: string; itemName: string; units: ItemUnitWithDetails[] }>()
    for (const unit of assignUnits) {
      const group = groups.get(unit.itemId) ?? { itemCategory: unit.itemCategory, itemName: unit.itemName, units: [] }
      group.units.push(unit)
      groups.set(unit.itemId, group)
    }
    // Available (unassigned) units are the most likely candidates to move
    // into a brand-new project, so surface them first within each group.
    for (const group of groups.values()) {
      group.units.sort((a, b) => {
        const aAvailable = a.assignedProjectId === null
        const bAvailable = b.assignedProjectId === null
        if (aAvailable !== bAvailable) return aAvailable ? -1 : 1
        return 0
      })
    }
    return Array.from(groups.entries()).sort(([, a], [, b]) =>
      `${a.itemCategory} ${a.itemName}`.localeCompare(`${b.itemCategory} ${b.itemName}`)
    )
  })()

  const availableAssignCount = assignUnits.filter((u) => u.assignedProjectId === null).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#1D1D1F]">Projects</h2>
          <p className="mt-0.5 text-xs text-[#6E6E73]">
            Sites/regions that equipment is deployed to. Archiving keeps history but stops new
            assignments.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} strokeWidth={1.5} /> Add project
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

      <div className="overflow-hidden rounded-md border border-[#E5E5E5]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#F5F5F7]">
            <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Updated by</th>
              <th className="px-3 py-2 text-left">Last updated</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="w-40 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {projects?.map((project, idx) => (
              <tr
                key={project.id}
                className={`group h-9 border-t border-[#F0F0F0] transition-colors duration-150 hover:bg-[#F0F6FF] ${
                  idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'
                }`}
              >
                <td className="px-3 py-2 font-medium text-[#1D1D1F]">{project.name}</td>
                <td className="px-3 py-2 text-[#6E6E73]">{project.location ?? '—'}</td>
                <td className="px-3 py-2 text-[#6E6E73]">{project.updatedBy ?? '—'}</td>
                <td className="px-3 py-2 text-[#6E6E73]">{project.lastUpdatedDate ?? '—'}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${
                      project.status === 'active'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-[#E5E5E5] text-[#6E6E73]'
                    }`}
                  >
                    {project.status === 'active' ? 'Active' : 'Completed'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={`Export inventory sheet for ${project.name}`}
                      disabled={exportingId === project.id}
                      onClick={() => handleExport(project)}
                    >
                      <Download size={14} strokeWidth={1.5} />
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(project)}>
                      <Pencil size={14} strokeWidth={1.5} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Transfer units out of this project"
                      onClick={() => openTransferUnits(project)}
                    >
                      <ArrowRightLeft size={14} strokeWidth={1.5} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Start handover for this project"
                      onClick={() => onStartHandover?.(project.id)}
                    >
                      <ClipboardCheck size={14} strokeWidth={1.5} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={project.status === 'active' ? 'Archive' : 'Reactivate'}
                      onClick={() => toggleStatus(project)}
                    >
                      {project.status === 'active' ? (
                        <Archive size={14} strokeWidth={1.5} />
                      ) : (
                        <RotateCcw size={14} strokeWidth={1.5} />
                      )}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {projects?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center">
                  <FolderKanban size={40} strokeWidth={1.5} className="mx-auto mb-2 text-[#AEAEB2]" />
                  <p className="text-sm font-medium text-[#1D1D1F]">No projects yet</p>
                  <p className="mt-0.5 mb-3 text-xs text-[#6E6E73]">
                    Add your first project site to start assigning equipment.
                  </p>
                  <Button size="sm" onClick={openCreate}>
                    <Plus size={14} strokeWidth={1.5} /> Add project
                  </Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={dialogProject !== null} onOpenChange={(open) => !open && setDialogProject(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{dialogProject === 'new' ? 'Add project' : 'Edit project'}</SheetTitle>
            <SheetDescription>Site/region details, mirroring the per-project sheet header.</SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. At North Copenhagen"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="project-location">Location</Label>
              <Input
                id="project-location"
                value={form.location ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="project-updated-by">Updated by</Label>
                <Input
                  id="project-updated-by"
                  value={form.updatedBy ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, updatedBy: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="project-last-updated">Last updated date</Label>
                <Input
                  id="project-last-updated"
                  type="date"
                  value={form.lastUpdatedDate ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, lastUpdatedDate: e.target.value }))}
                />
              </div>
            </div>
          </SheetBody>

          <SheetFooter>
            <Button variant="outline" onClick={() => setDialogProject(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {dialogProject === 'new' ? 'Create' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={transferProject !== null} onOpenChange={(open) => !open && setTransferProject(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Transfer units</SheetTitle>
            <SheetDescription>
              {transferProject
                ? `Move selected units out of "${transferProject.name}" to another project.`
                : ''}
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-3">
            <div className="max-h-80 overflow-y-auto rounded-md border">
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
          </SheetBody>

          <SheetFooter>
            <Button variant="outline" onClick={() => setTransferProject(null)}>
              Cancel
            </Button>
            <Button onClick={handleBulkTransfer} disabled={bulkTransferring || selectedUnitIds.size === 0}>
              Transfer {selectedUnitIds.size > 0 ? `(${selectedUnitIds.size})` : ''}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={assignProject !== null} onOpenChange={(open) => !open && setAssignProject(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Assign units to {assignProject?.name}</SheetTitle>
            <SheetDescription>
              {availableAssignCount > 0
                ? `${availableAssignCount} unassigned unit${availableAssignCount === 1 ? '' : 's'} (shown first in each group) are available to move in, or reassign units from other projects below.`
                : 'No unassigned units right now — pick units to reassign from other projects, or skip and assign later from the Item Units page.'}
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="rounded-none border-0 p-0">
            {groupedAssignUnits.map(([itemId, group]) => (
              <div key={itemId} className="border-b last:border-b-0">
                <div className="bg-muted/50 px-3 py-1.5 text-sm font-medium">
                  {group.itemCategory} — {group.itemName}
                </div>
                <Table>
                  <TableBody>
                    {group.units.map((unit) => (
                      <TableRow key={unit.id}>
                        <TableCell className="w-10">
                          <input
                            type="checkbox"
                            checked={selectedAssignUnitIds.has(unit.id)}
                            onChange={() => toggleAssignUnitSelected(unit.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{unit.serialId ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {unit.projectName ?? 'Available'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
            {assignUnits.length === 0 && (
              <p className="text-muted-foreground p-4 text-center text-sm">No units to assign yet.</p>
            )}
          </SheetBody>

          <SheetFooter>
            <Button variant="outline" onClick={() => setAssignProject(null)}>
              Skip
            </Button>
            <Button onClick={handleAssignUnits} disabled={assigning || selectedAssignUnitIds.size === 0}>
              Assign {selectedAssignUnitIds.size > 0 ? `(${selectedAssignUnitIds.size})` : ''}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
