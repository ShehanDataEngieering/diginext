import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type {
  Item,
  ItemUnitInput,
  ItemUnitWithDetails,
  Project,
  UnitStatus
} from '@shared/ipc'
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
const ALL = '__all__'

const STATUS_VARIANT: Record<UnitStatus, 'default' | 'secondary' | 'destructive'> = {
  Available: 'secondary',
  'In Use': 'default',
  'Retired-Damaged': 'destructive'
}

interface FormState {
  itemId: string
  serialId: string
  assignedProjectId: string
  auditDate: string
  remarks: string
  status: UnitStatus
  photoEvidenceRef: string
}

function emptyForm(defaultItemId?: number): FormState {
  return {
    itemId: defaultItemId ? String(defaultItemId) : '',
    serialId: '',
    assignedProjectId: UNASSIGNED,
    auditDate: '',
    remarks: '',
    status: 'Available',
    photoEvidenceRef: ''
  }
}

function toInput(form: FormState): ItemUnitInput | null {
  const itemId = Number(form.itemId)
  if (!itemId) return null
  return {
    itemId,
    serialId: form.serialId.trim() || null,
    assignedProjectId: form.assignedProjectId === UNASSIGNED ? null : Number(form.assignedProjectId),
    auditDate: form.auditDate.trim() || null,
    remarks: form.remarks.trim() || null,
    status: form.status,
    photoEvidenceRef: form.photoEvidenceRef.trim() || null
  }
}

export function ItemUnitsPage(): React.JSX.Element {
  const [units, setUnits] = useState<ItemUnitWithDetails[] | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dialogUnit, setDialogUnit] = useState<ItemUnitWithDetails | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)

  // Filters — match the per-item / per-project drill-down the dashboard rollup implies.
  const [itemFilter, setItemFilter] = useState(ALL)
  const [projectFilter, setProjectFilter] = useState(ALL)

  async function reload(): Promise<void> {
    try {
      const filter: { itemId?: number; projectId?: number | null } = {}
      if (itemFilter !== ALL) filter.itemId = Number(itemFilter)
      if (projectFilter !== ALL) filter.projectId = projectFilter === UNASSIGNED ? null : Number(projectFilter)
      const [unitRows, itemRows, projectRows] = await Promise.all([
        window.api.itemUnits.list(filter),
        window.api.items.list(),
        window.api.projects.list()
      ])
      setUnits(unitRows)
      setItems(itemRows)
      setProjects(projectRows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemFilter, projectFilter])

  function openCreate(): void {
    const defaultItemId = itemFilter !== ALL ? Number(itemFilter) : undefined
    setForm(emptyForm(defaultItemId))
    setDialogUnit('new')
  }

  function openEdit(unit: ItemUnitWithDetails): void {
    setForm({
      itemId: String(unit.itemId),
      serialId: unit.serialId ?? '',
      assignedProjectId: unit.assignedProjectId === null ? UNASSIGNED : String(unit.assignedProjectId),
      auditDate: unit.auditDate ?? '',
      remarks: unit.remarks ?? '',
      status: unit.status,
      photoEvidenceRef: unit.photoEvidenceRef ?? ''
    })
    setDialogUnit(unit)
  }

  async function handleSave(): Promise<void> {
    const input = toInput(form)
    if (!input) return
    setSaving(true)
    setError(null)
    try {
      if (dialogUnit === 'new') {
        await window.api.itemUnits.create(input)
      } else if (dialogUnit) {
        await window.api.itemUnits.update(dialogUnit.id, input)
      }
      setDialogUnit(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(unit: ItemUnitWithDetails): Promise<void> {
    const label = unit.serialId ?? `unit #${unit.id}`
    if (!confirm(`Delete ${label} (${unit.itemName})? This removes its history permanently.`)) return
    setError(null)
    try {
      await window.api.itemUnits.delete(unit.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Item units</h2>
          <p className="text-muted-foreground text-sm">
            Individually tracked physical units — the source of truth for "how many of X are at
            project Y".
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus /> Add unit
        </Button>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Filter by item</Label>
          <Select value={itemFilter} onValueChange={setItemFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All items</SelectItem>
              {items.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.category} — {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Filter by project</Label>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All projects</SelectItem>
              <SelectItem value={UNASSIGNED}>Unassigned (Available)</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Serial / ID</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Audit date</TableHead>
              <TableHead>Remarks</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {units?.map((unit) => (
              <TableRow key={unit.id}>
                <TableCell>
                  {unit.itemCategory} — {unit.itemName}
                </TableCell>
                <TableCell className="font-medium">{unit.serialId ?? '—'}</TableCell>
                <TableCell>{unit.projectName ?? <span className="text-muted-foreground">Available</span>}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[unit.status]}>{unit.status}</Badge>
                </TableCell>
                <TableCell>{unit.auditDate ?? '—'}</TableCell>
                <TableCell className="max-w-xs truncate" title={unit.remarks ?? undefined}>
                  {unit.remarks ?? '—'}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(unit)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(unit)}>
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {units?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-center">
                  No units match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogUnit !== null} onOpenChange={(open) => !open && setDialogUnit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogUnit === 'new' ? 'Add item unit' : 'Edit item unit'}</DialogTitle>
            <DialogDescription>
              A single physical unit — its serial/ID, current assignment, status, and audit info.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Item</Label>
              <Select value={form.itemId} onValueChange={(v) => setForm((f) => ({ ...f, itemId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an item type" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.category} — {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-serial">Serial / unique ID</Label>
              <Input
                id="unit-serial"
                value={form.serialId}
                onChange={(e) => setForm((f) => ({ ...f, serialId: e.target.value }))}
                placeholder="Leave blank for quantity-only items"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Assigned project</Label>
              <Select
                value={form.assignedProjectId}
                onValueChange={(v) => setForm((f) => ({ ...f, assignedProjectId: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned (Available)</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                      {project.status === 'completed' ? ' (completed)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as UnitStatus }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Available">Available</SelectItem>
                  <SelectItem value="In Use">In Use</SelectItem>
                  <SelectItem value="Retired-Damaged">Retired-Damaged</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-audit-date">Audit date</Label>
              <Input
                id="unit-audit-date"
                type="date"
                value={form.auditDate}
                onChange={(e) => setForm((f) => ({ ...f, auditDate: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-photo">Photo evidence reference</Label>
              <Input
                id="unit-photo"
                value={form.photoEvidenceRef}
                onChange={(e) => setForm((f) => ({ ...f, photoEvidenceRef: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-remarks">Remarks</Label>
              <Input
                id="unit-remarks"
                value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogUnit(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.itemId}>
              {dialogUnit === 'new' ? 'Create' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
