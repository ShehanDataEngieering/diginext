import { useEffect, useState } from 'react'
import { ArrowRightLeft, Boxes, Pencil, Plus, Trash2, Search } from 'lucide-react'
import type {
  Item,
  ItemUnitInput,
  ItemUnitWithDetails,
  Project,
  UnitStatus
} from '@shared/ipc'
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
import { PhotoDropField } from '@/components/PhotoDropField'
import { PhotoThumbnail } from '@/components/PhotoThumbnail'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const UNASSIGNED = '__unassigned__'
const ALL = '__all__'

// Muted, pill-shaped status colors — bright/filled badges read as buttons in
// a dense table.
const STATUS_PILL: Record<UnitStatus, string> = {
  Available: 'bg-green-50 text-green-700',
  'In Use': 'bg-blue-50 text-blue-700',
  'Retired-Damaged': 'bg-red-50 text-red-600'
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

export function ItemUnitsPage({
  projectSeed
}: {
  // Set by the sidebar's "Projects" shortcuts (see App.tsx) to pre-apply a
  // project filter when navigating here. The nonce makes repeat clicks on
  // the same project re-apply the filter even if the user changed it since.
  projectSeed?: { projectId: number; nonce: number } | null
} = {}): React.JSX.Element {
  const [units, setUnits] = useState<ItemUnitWithDetails[] | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dialogUnit, setDialogUnit] = useState<ItemUnitWithDetails | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [transferUnit, setTransferUnit] = useState<ItemUnitWithDetails | null>(null)
  const [transferProjectId, setTransferProjectId] = useState(UNASSIGNED)
  const [transferNotes, setTransferNotes] = useState('')
  const [transferring, setTransferring] = useState(false)

  // Filters — match the per-item / per-project drill-down the dashboard rollup implies.
  const [itemFilter, setItemFilter] = useState(ALL)
  const [projectFilter, setProjectFilter] = useState(ALL)
  const [serialSearch, setSerialSearch] = useState('')

  async function reload(): Promise<void> {
    try {
      const filter: { itemId?: number; projectId?: number | null; serialId?: string } = {}
      if (itemFilter !== ALL) filter.itemId = Number(itemFilter)
      if (projectFilter !== ALL) filter.projectId = projectFilter === UNASSIGNED ? null : Number(projectFilter)
      if (serialSearch) filter.serialId = serialSearch
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
  }, [itemFilter, projectFilter, serialSearch])

  useEffect(() => {
    if (projectSeed) setProjectFilter(String(projectSeed.projectId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSeed?.nonce])

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

  function openTransfer(unit: ItemUnitWithDetails): void {
    setTransferUnit(unit)
    setTransferProjectId(UNASSIGNED)
    setTransferNotes('')
  }

  async function handleTransfer(): Promise<void> {
    if (!transferUnit) return
    const toProjectId = transferProjectId === UNASSIGNED ? null : Number(transferProjectId)
    setTransferring(true)
    setError(null)
    try {
      await window.api.itemUnits.update(transferUnit.id, {
        itemId: transferUnit.itemId,
        serialId: transferUnit.serialId,
        assignedProjectId: toProjectId,
        auditDate: transferUnit.auditDate,
        remarks: transferUnit.remarks,
        status: transferUnit.status,
        photoEvidenceRef: transferUnit.photoEvidenceRef
      })
      await window.api.transfers.create({
        date: new Date().toISOString().slice(0, 10),
        itemId: transferUnit.itemId,
        serialId: transferUnit.serialId,
        qty: 1,
        fromProjectId: transferUnit.assignedProjectId,
        toProjectId,
        transferredBy: null,
        authorizedBy: null,
        notes: transferNotes.trim() || null,
        status: 'Completed'
      })
      setTransferUnit(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTransferring(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#1D1D1F]">Item units</h2>
          <p className="mt-0.5 text-xs text-[#6E6E73]">
            Individually tracked physical units — the source of truth for "how many of X are at
            project Y".
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus size={16} strokeWidth={1.5} /> Add unit
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Select value={itemFilter} onValueChange={setItemFilter}>
          <SelectTrigger className="h-7 w-56 text-[13px]">
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
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-7 w-56 text-[13px]">
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
        <div className="relative w-56">
          <Search
            size={14}
            strokeWidth={1.5}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[#AEAEB2]"
          />
          <Input
            placeholder="Search by serial ID"
            value={serialSearch}
            onChange={(e) => setSerialSearch(e.target.value)}
            className="h-7 pl-7 text-[13px]"
          />
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="overflow-hidden rounded-md border border-[#E5E5E5]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#F5F5F7]">
            <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
              <th className="w-16 px-3 py-2 text-left">Photo</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Serial / ID</th>
              <th className="px-3 py-2 text-left">Project</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Audit date</th>
              <th className="px-3 py-2 text-left">Remarks</th>
              <th className="w-28 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {units?.map((unit, idx) => (
              <tr
                key={unit.id}
                className={`group h-9 border-t border-[#F0F0F0] transition-colors duration-150 hover:bg-[#F0F6FF] ${
                  idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'
                }`}
              >
                <td className="px-3 py-1.5">
                  <PhotoThumbnail
                    reference={unit.photoEvidenceRef}
                    label={unit.serialId ?? `${unit.itemName} (unit #${unit.id})`}
                  />
                </td>
                <td className="px-3 py-2 text-[#6E6E73]">
                  {unit.itemCategory} — <span className="text-[#1D1D1F]">{unit.itemName}</span>
                </td>
                <td className="px-3 py-2 font-medium text-[#1D1D1F]">{unit.serialId ?? '—'}</td>
                <td className="px-3 py-2 text-[#6E6E73]">
                  {unit.projectName ?? <span className="text-[#AEAEB2]">Available</span>}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${STATUS_PILL[unit.status]}`}
                  >
                    {unit.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-[#6E6E73]">{unit.auditDate ?? '—'}</td>
                <td className="max-w-xs truncate px-3 py-2 text-[#6E6E73]" title={unit.remarks ?? undefined}>
                  {unit.remarks ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <Button variant="ghost" size="icon" title="Transfer to…" onClick={() => openTransfer(unit)}>
                      <ArrowRightLeft size={14} strokeWidth={1.5} />
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(unit)}>
                      <Pencil size={14} strokeWidth={1.5} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-[#6E6E73] hover:text-red-600"
                      title="Delete"
                      onClick={() => handleDelete(unit)}
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {units?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center">
                  <Boxes size={40} strokeWidth={1.5} className="mx-auto mb-2 text-[#AEAEB2]" />
                  <p className="text-sm font-medium text-[#1D1D1F]">No units match these filters</p>
                  <p className="mt-0.5 text-xs text-[#6E6E73]">
                    Adjust the filters above, or add a new unit.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={dialogUnit !== null} onOpenChange={(open) => !open && setDialogUnit(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{dialogUnit === 'new' ? 'Add item unit' : 'Edit item unit'}</SheetTitle>
            <SheetDescription>
              A single physical unit — its serial/ID, current assignment, status, and audit info.
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
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
            <div className="flex flex-col gap-1">
              <Label htmlFor="unit-serial">Serial / unique ID</Label>
              <Input
                id="unit-serial"
                value={form.serialId}
                onChange={(e) => setForm((f) => ({ ...f, serialId: e.target.value }))}
                placeholder="Leave blank for quantity-only items"
              />
            </div>
            <div className="flex flex-col gap-1">
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
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
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
              <div className="flex flex-col gap-1">
                <Label htmlFor="unit-audit-date">Audit date</Label>
                <Input
                  id="unit-audit-date"
                  type="date"
                  value={form.auditDate}
                  onChange={(e) => setForm((f) => ({ ...f, auditDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Photo evidence</Label>
              <PhotoDropField
                reference={form.photoEvidenceRef.trim() || null}
                onChange={(reference) =>
                  setForm((f) => ({ ...f, photoEvidenceRef: reference ?? '' }))
                }
                label={form.serialId.trim() || 'Photo evidence'}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="unit-remarks">Remarks</Label>
              <Input
                id="unit-remarks"
                value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              />
            </div>
          </SheetBody>

          <SheetFooter>
            <Button variant="outline" onClick={() => setDialogUnit(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.itemId}>
              {dialogUnit === 'new' ? 'Create' : 'Save changes'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={transferUnit !== null} onOpenChange={(open) => !open && setTransferUnit(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Transfer to…</SheetTitle>
            <SheetDescription>
              {transferUnit
                ? `${transferUnit.serialId ?? `Unit #${transferUnit.id}`} (${transferUnit.itemName}) — currently ${
                    transferUnit.projectName ?? 'Available'
                  }`
                : ''}
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label>Destination project</Label>
              <Select value={transferProjectId} onValueChange={setTransferProjectId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Available (unassigned)</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={String(project.id)}>
                      {project.name}
                      {project.status === 'completed' ? ' (completed)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="transfer-notes">Notes</Label>
              <Input
                id="transfer-notes"
                value={transferNotes}
                onChange={(e) => setTransferNotes(e.target.value)}
                placeholder="Optional notes for the transfer log"
              />
            </div>
          </SheetBody>

          <SheetFooter>
            <Button variant="outline" onClick={() => setTransferUnit(null)}>
              Cancel
            </Button>
            <Button onClick={handleTransfer} disabled={transferring}>
              Transfer
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
