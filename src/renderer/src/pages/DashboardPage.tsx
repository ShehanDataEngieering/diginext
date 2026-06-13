import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Info,
  MoreVertical,
  Pencil,
  Search,
  Trash2
} from 'lucide-react'
import type { DashboardRollup, DashboardRow, Item, ItemInput, ItemUnitWithDetails } from '@shared/ipc'
import { PhotoThumbnail } from '@/components/PhotoThumbnail'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const ALL_CATEGORIES = '__all__'

// Same category → dot-color mapping as the sidebar, so the visual language
// (which color means which category) stays consistent across the app.
const CATEGORY_DOT_COLOR: Record<string, string> = {
  'Office Use Items': 'bg-blue-500',
  'Safety Related Items': 'bg-orange-400'
}
function categoryDotClass(category: string): string {
  return CATEGORY_DOT_COLOR[category] ?? 'bg-gray-400'
}

interface DerivedRow extends DashboardRow {
  // "Deployed" = units currently sitting in *active* projects (sum of the
  // per-project columns) — distinct from `totalUnits`, which also counts
  // units parked on completed projects or retired.
  deployed: number
  // Per the design's tooltip definition: Available = Initial stock − Deployed.
  // This is intentionally NOT the same as DashboardRow.available (which
  // counts physically-unassigned tracked units) — that figure answers "how
  // many spare units exist right now"; this one answers "how does the
  // nominal baseline compare to what's currently out the door", and can go
  // negative if more has been deployed than the recorded initial stock.
  derivedAvailable: number
}

function deriveRows(rollup: DashboardRollup): DerivedRow[] {
  return rollup.rows.map((row) => {
    const deployed = Object.values(row.countsByProjectId).reduce((sum, n) => sum + n, 0)
    return { ...row, deployed, derivedAvailable: row.initialStock - deployed }
  })
}

interface StatCellProps {
  label: string
  value: number
  sub: string
  valueClassName?: string
}

function StatCell({ label, value, sub, valueClassName }: StatCellProps): React.JSX.Element {
  return (
    <div className="rounded-md border border-[#E5E5E5] bg-white p-4">
      <div className="text-xs text-[#6E6E73]">{label}</div>
      <div className={cn('mt-0.5 text-2xl font-semibold text-[#1D1D1F] tabular-nums', valueClassName)}>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-[#AEAEB2]">{sub}</div>
    </div>
  )
}

function NumericCell({ value }: { value: number }): React.JSX.Element {
  return (
    <td className="px-3 py-2 text-right text-sm text-[#6E6E73] tabular-nums">
      {value === 0 ? <span className="text-[#D1D1D6]">—</span> : value}
    </td>
  )
}

function AvailableChip({ value }: { value: number }): React.JSX.Element {
  const tone =
    value > 0
      ? 'bg-green-50 text-green-700'
      : value === 0
        ? 'bg-red-50 text-red-600'
        : 'bg-amber-50 text-amber-700'
  return (
    <span className={cn('inline-block rounded-sm px-1.5 py-0 text-[11px] font-medium tabular-nums', tone)}>
      {value}
    </span>
  )
}

const emptyEditForm: ItemInput = { category: '', name: '', initialStock: 0 }

/**
 * Live "Main Inventory" rollup styled to match the macOS/Numbers-style
 * design spec — replaces the spreadsheet's manually-typed per-project
 * allocation columns with numbers computed straight from `item_units`.
 */
export function DashboardPage({
  categorySeed
}: {
  // Set by the sidebar's "Categories" shortcuts (see App.tsx) to pre-apply a
  // category filter when navigating here. The nonce makes repeat clicks on
  // the same category re-apply the filter even if the user changed it since.
  categorySeed?: { category: string; nonce: number } | null
}): React.JSX.Element {
  const [rollup, setRollup] = useState<DashboardRollup | null>(null)
  // Loaded once alongside the rollup and grouped client-side by item — backs
  // the per-row "show units" drill-down (client wants to see each unit's
  // unique/serial ID, and its photo, without a separate page round-trip).
  const [units, setUnits] = useState<ItemUnitWithDetails[]>([])
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES)
  const [sortDesc, setSortDesc] = useState(false)

  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [editForm, setEditForm] = useState<ItemInput>(emptyEditForm)
  const [saving, setSaving] = useState(false)

  async function reload(): Promise<void> {
    try {
      const [rollupResult, unitRows] = await Promise.all([
        window.api.dashboard.rollup(),
        window.api.itemUnits.list()
      ])
      setRollup(rollupResult)
      setUnits(unitRows)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // Groups the flat unit list by item type so each row's drill-down can show
  // "which physical units (by serial/unique ID) make up this total" without
  // any extra IPC surface — the rollup already gives us the aggregate counts.
  const unitsByItemId = useMemo(() => {
    const map = new Map<number, ItemUnitWithDetails[]>()
    for (const unit of units) {
      const list = map.get(unit.itemId)
      if (list) list.push(unit)
      else map.set(unit.itemId, [unit])
    }
    return map
  }, [units])

  useEffect(() => {
    reload()
  }, [])

  useEffect(() => {
    if (categorySeed) setCategoryFilter(categorySeed.category)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorySeed?.nonce])

  const allRows = useMemo(() => (rollup ? deriveRows(rollup) : []), [rollup])
  const categories = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.category))).sort(),
    [allRows]
  )

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allRows.filter((row) => {
      if (categoryFilter !== ALL_CATEGORIES && row.category !== categoryFilter) return false
      if (needle && !row.name.toLowerCase().includes(needle)) return false
      return true
    })
  }, [allRows, search, categoryFilter])

  // Group by category (rows already arrive ordered by category, name from the
  // repository query) and sort each group's items by name per the Sort toggle.
  const groups = useMemo(() => {
    const byCategory = new Map<string, DerivedRow[]>()
    for (const row of filteredRows) {
      const list = byCategory.get(row.category)
      if (list) list.push(row)
      else byCategory.set(row.category, [row])
    }
    return Array.from(byCategory.entries()).map(([category, rows]) => ({
      category,
      rows: [...rows].sort((a, b) => (sortDesc ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)))
    }))
  }, [filteredRows, sortDesc])

  const stats = useMemo(() => {
    const totalItems = filteredRows.length
    const categoryCount = new Set(filteredRows.map((r) => r.category)).size
    const initialStock = filteredRows.reduce((sum, r) => sum + r.initialStock, 0)
    const totalDeployed = filteredRows.reduce((sum, r) => sum + r.deployed, 0)
    const zeroAvailable = filteredRows.filter((r) => r.derivedAvailable <= 0).length
    return { totalItems, categoryCount, initialStock, totalDeployed, zeroAvailable }
  }, [filteredRows])

  function openEdit(row: DerivedRow): void {
    setEditForm({ category: row.category, name: row.name, initialStock: row.initialStock })
    setEditingItem({ id: row.itemId, category: row.category, name: row.name, initialStock: row.initialStock })
  }

  async function handleSaveEdit(): Promise<void> {
    if (!editingItem || !editForm.category.trim() || !editForm.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await window.api.items.update(editingItem.id, editForm)
      setEditingItem(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: DerivedRow): Promise<void> {
    if (!confirm(`Delete "${row.name}"? This only works if it has no recorded units.`)) return
    setError(null)
    try {
      await window.api.items.delete(row.itemId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!rollup) {
    return <div className="p-4 text-sm text-[#6E6E73]">Loading…</div>
  }

  const projectColumnWidth = rollup.projects.length > 0 ? Math.max(80, Math.floor(360 / rollup.projects.length)) : 0

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="shrink-0 px-4 pt-4 pb-3">
        <h2 className="text-base font-semibold text-[#1D1D1F]">Main inventory</h2>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[#6E6E73]">
          <Info size={12} strokeWidth={1.5} className="text-[#AEAEB2]" />
          <span>Units per active project, available stock and grand total — computed live.</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid shrink-0 grid-cols-4 gap-3 px-4 pb-3">
        <StatCell label="Total items" value={stats.totalItems} sub={`${stats.categoryCount} categories`} />
        <StatCell label="Initial stock" value={stats.initialStock} sub="total units" />
        <StatCell
          label="Total deployed"
          value={stats.totalDeployed}
          sub={`across ${rollup.projects.length} project${rollup.projects.length === 1 ? '' : 's'}`}
        />
        <StatCell
          label="Zero available"
          value={stats.zeroAvailable}
          sub="items fully deployed"
          valueClassName="text-red-600"
        />
      </div>

      {/* Action bar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[#E5E5E5] px-4">
        <div className="relative w-[220px]">
          <Search
            size={14}
            strokeWidth={1.5}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[#AEAEB2]"
          />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" className="h-7 pl-7 text-[13px]" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-7 w-48 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortDesc((d) => !d)}
          title={sortDesc ? 'Sorting Z → A' : 'Sorting A → Z'}
        >
          <ArrowUpDown size={14} strokeWidth={1.5} /> Sort
        </Button>
      </div>

      {error && <p className="px-3.5 pt-2 text-[12px] text-destructive">{error}</p>}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#F5F5F7]">
            <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
              <th className="w-[28px] px-1 py-2" />
              <th className="px-3 py-2 text-left">Item</th>
              <th className="w-[82px] px-3 py-2 text-right">Initial stock</th>
              {rollup.projects.map((project) => (
                <th key={project.id} className="px-3 py-2 text-right" style={{ width: projectColumnWidth }}>
                  {project.name}
                </th>
              ))}
              <th className="w-[82px] px-3 py-2 text-right">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center justify-end gap-1">
                      Available <Info size={11} className="text-gray-400" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Available = Initial stock − Total Deployed</TooltipContent>
                </Tooltip>
              </th>
              <th className="w-[90px] px-3 py-2 text-right">Total Deployed</th>
              <th className="w-[46px] px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.category}>
                <tr className="border-y border-[#E5E5E5] bg-[#FAFAFA]">
                  <td
                    colSpan={6 + rollup.projects.length}
                    className="px-3 py-1.5 text-xs font-medium tracking-wide text-[#6E6E73] uppercase"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn('size-1.5 rounded-full', categoryDotClass(group.category))} />
                      {group.category}
                    </span>
                  </td>
                </tr>
                {group.rows.map((row, idx) => {
                  const rowUnits = unitsByItemId.get(row.itemId) ?? []
                  const expanded = expandedItemId === row.itemId
                  return (
                  <Fragment key={row.itemId}>
                  <tr
                    className={cn(
                      'group h-9 border-b border-[#F0F0F0] transition-colors duration-150 hover:bg-[#F0F6FF]',
                      idx % 2 === 0 ? 'bg-[#FAFAFA]' : 'bg-white',
                      expanded && 'bg-[#F0F6FF]'
                    )}
                  >
                    <td className="px-1 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setExpandedItemId(expanded ? null : row.itemId)}
                        className="text-[#AEAEB2] transition-colors duration-150 hover:text-[#1D1D1F]"
                        title={expanded ? 'Hide individual units' : 'Show individual units (serial/unique IDs, photos)'}
                      >
                        {expanded ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-sm font-medium text-[#1D1D1F]">{row.name}</td>
                    <NumericCell value={row.initialStock} />
                    {rollup.projects.map((project) => (
                      <NumericCell key={project.id} value={row.countsByProjectId[project.id] ?? 0} />
                    ))}
                    <td className="px-3 py-2 text-right">
                      <AvailableChip value={row.derivedAvailable} />
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-semibold text-[#1D1D1F] tabular-nums">
                      {row.deployed}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex size-7 items-center justify-center rounded-md text-[#6E6E73] opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-[#E8E8ED] data-[state=open]:opacity-100"
                          >
                            <MoreVertical size={13} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(row)}>
                            <Pencil /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => handleDelete(row)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-[#E5E5E5] bg-[#F0F6FF]/50">
                      <td colSpan={6 + rollup.projects.length} className="px-3 py-2.5 pl-9">
                        <div className="overflow-hidden rounded-md border border-[#E5E5E5] bg-white">
                          <table className="w-full text-[12px]">
                            <thead className="bg-[#F5F5F7]">
                              <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
                                <th className="px-2.5 py-1.5 text-left">Serial / unique ID</th>
                                <th className="px-2.5 py-1.5 text-left">Project</th>
                                <th className="px-2.5 py-1.5 text-left">Status</th>
                                <th className="px-2.5 py-1.5 text-left">Photo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rowUnits.map((unit) => (
                                <tr key={unit.id} className="border-t border-[#F0F0F0]">
                                  <td className="px-2.5 py-1.5 font-medium text-[#1D1D1F]">
                                    {unit.serialId ?? <span className="text-[#D1D1D6]">—</span>}
                                  </td>
                                  <td className="px-2.5 py-1.5 text-[#6E6E73]">
                                    {unit.projectName ?? <span className="text-[#AEAEB2]">Available</span>}
                                  </td>
                                  <td className="px-2.5 py-1.5 text-[#6E6E73]">{unit.status}</td>
                                  <td className="px-2.5 py-1.5">
                                    <PhotoThumbnail
                                      reference={unit.photoEvidenceRef}
                                      label={unit.serialId ?? `${row.name} (unit #${unit.id})`}
                                    />
                                  </td>
                                </tr>
                              ))}
                              {rowUnits.length === 0 && (
                                <tr>
                                  <td colSpan={4} className="px-2.5 py-2.5 text-center text-[#AEAEB2]">
                                    No individually-tracked units recorded for this item yet.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  )
                })}
              </Fragment>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={6 + rollup.projects.length} className="px-3 py-10 text-center">
                  <Search size={40} strokeWidth={1.5} className="mx-auto mb-2 text-[#AEAEB2]" />
                  <p className="text-sm font-medium text-[#1D1D1F]">No items match these filters</p>
                  <p className="mt-0.5 text-xs text-[#6E6E73]">Try a different search or category.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={editingItem !== null} onOpenChange={(open) => !open && setEditingItem(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit item</SheetTitle>
            <SheetDescription>Updates the underlying item type — category, name, and baseline stock.</SheetDescription>
          </SheetHeader>
          <SheetBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="dash-edit-category">Category</Label>
              <Input
                id="dash-edit-category"
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="dash-edit-name">Name</Label>
                <Input
                  id="dash-edit-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="dash-edit-stock">Initial stock</Label>
                <Input
                  id="dash-edit-stock"
                  type="number"
                  min={0}
                  value={editForm.initialStock}
                  onChange={(e) => setEditForm((f) => ({ ...f, initialStock: Number(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving || !editForm.category.trim() || !editForm.name.trim()}>
              Save changes
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
