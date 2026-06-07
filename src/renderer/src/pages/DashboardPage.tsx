import { useEffect, useState } from 'react'
import type { DashboardRollup } from '@shared/ipc'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * Live "Main Inventory" rollup — replaces the spreadsheet's manually-typed
 * per-project allocation columns with numbers computed straight from
 * `item_units` (see src/main/db/repositories/dashboard.ts), so they can
 * never drift out of sync with reality.
 */
export function DashboardPage(): React.JSX.Element {
  const [rollup, setRollup] = useState<DashboardRollup | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload(): Promise<void> {
    try {
      setRollup(await window.api.dashboard.rollup())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    reload()
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Main inventory</h2>
        <p className="text-muted-foreground text-sm">
          Per item: how many units sit in each active project, plus what's available and the
          grand total — computed live, not maintained by hand.
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {rollup && rollup.rows.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No items yet</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Add item types under the Items tab to see them rolled up here.
            </p>
          </CardContent>
        </Card>
      )}

      {rollup && rollup.rows.length > 0 && (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Initial stock</TableHead>
                {rollup.projects.map((project) => (
                  <TableHead key={project.id} className="text-right">
                    {project.name}
                  </TableHead>
                ))}
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rollup.rows.map((row) => (
                <TableRow key={row.itemId}>
                  <TableCell>{row.category}</TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right">{row.initialStock}</TableCell>
                  {rollup.projects.map((project) => (
                    <TableCell key={project.id} className="text-right">
                      {row.countsByProjectId[project.id] ?? 0}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">{row.available}</TableCell>
                  <TableCell className="text-right font-semibold">{row.totalUnits}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
