import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, Upload } from 'lucide-react'
import { HANDOVER_ACTIONS } from '@shared/ipc'
import type { Handover, ImportSummary, ItemUnitWithDetails, Project } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const CONDITIONS = ['Good', 'Damaged', 'Needs Repair', 'Lost']

// "Retain at site" is intentionally NOT offered: this flow marks the project
// completed on submit, so keeping a unit deployed to a closed site is a
// contradiction. Every unit must go somewhere — back to stock, retired, or
// transferred onward.
const ACTION_RETURN = HANDOVER_ACTIONS.return
const ACTION_RETIRE = HANDOVER_ACTIONS.retire
const ACTION_TRANSFER = HANDOVER_ACTIONS.transfer
const ACTIONS = [ACTION_RETURN, ACTION_RETIRE, ACTION_TRANSFER]

const UNASSIGNED = '__unassigned__'

interface UnitState {
  condition: string
  action: string
  destProjectId: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function HandoverFlowPage({
  projectSeed
}: {
  projectSeed?: { projectId: number; nonce: number } | null
} = {}): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [units, setUnits] = useState<ItemUnitWithDetails[]>([])
  const [unitStates, setUnitStates] = useState<Record<number, UnitState>>({})
  const [handoverDate, setHandoverDate] = useState(today())
  const [handedOverBy, setHandedOverBy] = useState('')
  const [receivedBy, setReceivedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [completedHandover, setCompletedHandover] = useState<Handover | null>(null)
  const [exporting, setExporting] = useState(false)

  // Excel import
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null)

  useEffect(() => {
    window.api.projects.list().then(setProjects)
  }, [])

  useEffect(() => {
    if (projectSeed) setProjectId(String(projectSeed.projectId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSeed?.nonce])

  function reloadUnits(id: string): void {
    if (!id) { setUnits([]); return }
    window.api.itemUnits.list({ projectId: Number(id) }).then((rows) => {
      setUnits(rows)
      setUnitStates((prev) => {
        const next: Record<number, UnitState> = {}
        for (const unit of rows) {
          next[unit.id] = prev[unit.id] ?? { condition: '', action: '', destProjectId: UNASSIGNED }
        }
        return next
      })
    })
  }

  useEffect(() => {
    reloadUnits(projectId)
  }, [projectId])

  async function runImport(filePath: string): Promise<void> {
    setImporting(true)
    setError(null)
    setImportSummary(null)
    try {
      const summary = await window.api.excel.importProject(filePath)
      if (!summary) {
        setError('Could not read this file — make sure it is a Diginext export or original inventory sheet.')
      } else {
        setImportSummary(summary)
        // If the imported project matches the selected one, reload its units
        if (projectId) reloadUnits(projectId)
        const parts = [
          summary.unitsAdded > 0 ? `${summary.unitsAdded} unit(s) added` : '',
          summary.unitsUpdated > 0 ? `${summary.unitsUpdated} updated` : '',
          summary.transfersCreated > 0 ? `${summary.transfersCreated} transfer(s)` : '',
        ].filter(Boolean).join(' · ')
        toast.success(`Imported "${summary.projectName}"`, { description: parts || 'No changes detected.' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  async function handleImportDrop(files: FileList | null): Promise<void> {
    const file = files?.[0]
    if (!file) return
    await runImport(window.api.photos.pathForFile(file))
  }

  async function handleBrowseImport(): Promise<void> {
    const filePath = await window.api.dialog.openFile()
    if (filePath) await runImport(filePath)
  }

  function updateUnitState(unitId: number, field: keyof UnitState, value: string): void {
    setUnitStates((prev) => ({
      ...prev,
      [unitId]: { ...prev[unitId], [field]: value }
    }))
  }

  async function handleSubmit(): Promise<void> {
    if (!projectId) return
    const numericProjectId = Number(projectId)

    for (const unit of units) {
      const state = unitStates[unit.id]
      if (state?.action === ACTION_TRANSFER && state.destProjectId === UNASSIGNED) {
        setError(`Choose a destination project for ${unit.serialId ?? `unit #${unit.id}`}.`)
        return
      }
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      // When closing a site, any unit the operator didn't explicitly act on is
      // treated as returned to available stock — an inventory system never
      // leaves gear "deployed" to a project that no longer exists.
      const effectiveAction = (unitId: number): string =>
        unitStates[unitId]?.action || ACTION_RETURN

      // All consequences (unit moves, transfer log, marking the project
      // completed) are applied atomically inside handovers.create — see the
      // repository. The renderer only describes intent; it no longer mutates
      // units one-by-one, so a mid-way failure can't strand gear.
      const createdHandover = await window.api.handovers.create({
        projectId: numericProjectId,
        handoverDate,
        handedOverBy: handedOverBy.trim() || null,
        receivedBy: receivedBy.trim() || null,
        notes: notes.trim() || null,
        signatureRef: null,
        items: units.map((unit) => {
          const state = unitStates[unit.id]
          const action = effectiveAction(unit.id)
          const transferProjectId =
            action === ACTION_TRANSFER && state?.destProjectId && state.destProjectId !== UNASSIGNED
              ? Number(state.destProjectId)
              : null
          return {
            itemUnitId: unit.id,
            condition: state?.condition || null,
            action,
            transferProjectId
          }
        })
      })

      setSuccess('Handover recorded and project marked as completed.')
      setCompletedHandover(createdHandover)
      toast.success('Handover recorded', {
        description: `Project marked as completed · ${units.length} unit(s) processed`
      })
      setHandedOverBy('')
      setReceivedBy('')
      setNotes('')
      setUnitStates({})
      setUnits([])
      setProjectId('')
      setImportSummary(null)
      window.api.projects.list().then(setProjects)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-[#1D1D1F]">New handover</h2>
        <p className="mt-0.5 text-xs text-[#6E6E73]">
          Record a hand-over of all units currently assigned to a project — set the condition and
          follow-up action for each unit. Submitting marks the project as completed.
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {success && (
        <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm text-emerald-700">{success}</p>
          {completedHandover && (
            <Button
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={async () => {
                setExporting(true)
                try {
                  const result = await window.api.excel.exportHandover(completedHandover.id)
                  toast.success('Handover exported', { description: result.filePath })
                } catch (err) {
                  toast.error('Export failed', { description: err instanceof Error ? err.message : String(err) })
                } finally {
                  setExporting(false)
                }
              }}
            >
              <Download size={14} strokeWidth={1.5} />
              {exporting ? 'Exporting…' : 'Download to Excel'}
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-md border border-[#E5E5E5] bg-white p-4 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <Label>Project</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects
                .filter((p) => p.status === 'active')
                .map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>
                    {project.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="handover-date">Date</Label>
          <Input
            id="handover-date"
            type="date"
            value={handoverDate}
            onChange={(e) => setHandoverDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="handed-over-by">Handed over by</Label>
          <Input
            id="handed-over-by"
            value={handedOverBy}
            onChange={(e) => setHandedOverBy(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="received-by">Received by</Label>
          <Input
            id="received-by"
            value={receivedBy}
            onChange={(e) => setReceivedBy(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="handover-notes">Notes</Label>
          <Input id="handover-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Import the filled-in Excel sheet from the site lead */}
      {projectId && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void handleImportDrop(e.dataTransfer.files) }}
            className={`flex items-center justify-between gap-3 rounded-lg border border-dashed p-3 text-sm transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="text-muted-foreground/50 flex size-9 shrink-0 items-center justify-center rounded border border-dashed">
                {importing
                  ? <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  : <Upload className="size-4" />}
              </div>
              <div>
                <p className="text-[#1D1D1F] text-xs font-medium">
                  {importing ? 'Importing filled-in Excel sheet…' : 'Import filled-in inventory sheet (optional)'}
                </p>
                <p className="text-muted-foreground text-xs">
                  If the site lead updated the sheet, import it first to reconcile audit dates and remarks.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled={importing} onClick={() => void handleBrowseImport()}>
              Browse files
            </Button>
          </div>

          {importSummary && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-[#1D1D1F]">
                Import complete — {importSummary.projectName}
                {importSummary.projectCreated && (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-normal text-emerald-700">
                    new project created
                  </span>
                )}
              </h3>
              <ul className="space-y-1 text-sm text-[#1D1D1F]">
                {importSummary.itemsCreated > 0 && (
                  <li>🆕 New item types created: {importSummary.itemsCreated}</li>
                )}
                <li>➕ Units added: {importSummary.unitsAdded}</li>
                <li>✏️ Units updated (audit / remarks): {importSummary.unitsUpdated}</li>
                <li>🔄 Units transferred: {importSummary.transfersCreated}</li>
              </ul>
              {importSummary.details.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-[#6E6E73]">View details</summary>
                  <ul className="mt-2 space-y-1 text-xs text-[#6E6E73]">
                    {importSummary.details.map((detail, i) => (
                      <li key={i} className={detail.type === 'removed' ? 'text-amber-700' : ''}>
                        {detail.type === 'added' && `+ ${detail.itemName} (${detail.serialId ?? 'no serial'})`}
                        {detail.type === 'removed' && `⚠ ${detail.itemName} (${detail.serialId ?? 'no serial'})`}
                        {detail.type === 'transferred' &&
                          `→ ${detail.itemName} (${detail.serialId ?? 'no serial'}) from ${detail.fromProject ?? 'unknown'}`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </>
      )}

      <div className="overflow-hidden rounded-md border border-[#E5E5E5]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#F5F5F7]">
            <tr className="text-xs font-medium tracking-wide text-[#6E6E73] uppercase">
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Serial / ID</th>
              <th className="px-3 py-2 text-left">Condition</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Destination</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit, idx) => (
              <tr
                key={unit.id}
                className={`border-t border-[#F0F0F0] ${idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'}`}
              >
                <td className="px-3 py-2 text-[#6E6E73]">
                  {unit.itemCategory} — <span className="text-[#1D1D1F]">{unit.itemName}</span>
                </td>
                <td className="px-3 py-2 font-medium text-[#1D1D1F]">{unit.serialId ?? '—'}</td>
                <td className="px-3 py-2">
                  <Select
                    value={unitStates[unit.id]?.condition ?? ''}
                    onValueChange={(v) => updateUnitState(unit.id, 'condition', v)}
                  >
                    <SelectTrigger className="h-7 w-40 text-[13px]">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Select
                    value={unitStates[unit.id]?.action ?? ''}
                    onValueChange={(v) => updateUnitState(unit.id, 'action', v)}
                  >
                    <SelectTrigger className="h-7 w-52 text-[13px]">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIONS.map((a) => (
                        <SelectItem key={a} value={a}>{a}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  {unitStates[unit.id]?.action === ACTION_TRANSFER ? (
                    <Select
                      value={unitStates[unit.id]?.destProjectId ?? UNASSIGNED}
                      onValueChange={(v) => updateUnitState(unit.id, 'destProjectId', v)}
                    >
                      <SelectTrigger className="h-7 w-48 text-[13px]">
                        <SelectValue placeholder="Choose project…" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects
                          .filter((p) => String(p.id) !== projectId && p.status === 'active')
                          .map((project) => (
                            <SelectItem key={project.id} value={String(project.id)}>
                              {project.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-[#D1D1D6]">—</span>
                  )}
                </td>
              </tr>
            ))}
            {projectId && units.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-[#6E6E73]">
                  No units currently assigned to this project.
                </td>
              </tr>
            )}
            {!projectId && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-[#6E6E73]">
                  Choose a project to list its assigned units.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={!projectId || (units.length === 0 && !importSummary) || saving}
        >
          Record handover &amp; complete project
        </Button>
      </div>
    </div>
  )
}
