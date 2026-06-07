import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { Item, ItemInput } from '@shared/ipc'
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

// Known categories from the original Master_Inventory workbook — offered as
// quick-pick suggestions, but the field stays free text since new categories
// will inevitably come up (per plan: "free-text-with-suggestions").
const KNOWN_CATEGORIES = [
  'Termination Tools',
  'Safety Related Items',
  'Site Tools',
  'Office Use Items',
  'Welfare'
]

const emptyForm: ItemInput = { category: '', name: '', initialStock: 0 }

export function ItemsPage(): React.JSX.Element {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogItem, setDialogItem] = useState<Item | 'new' | null>(null)
  const [form, setForm] = useState<ItemInput>(emptyForm)
  const [saving, setSaving] = useState(false)

  async function reload(): Promise<void> {
    try {
      setItems(await window.api.items.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const categorySuggestions = useMemo(() => {
    const fromData = (items ?? []).map((item) => item.category)
    return Array.from(new Set([...KNOWN_CATEGORIES, ...fromData])).sort()
  }, [items])

  function openCreate(): void {
    setForm(emptyForm)
    setDialogItem('new')
  }

  function openEdit(item: Item): void {
    setForm({ category: item.category, name: item.name, initialStock: item.initialStock })
    setDialogItem(item)
  }

  async function handleSave(): Promise<void> {
    if (!form.category.trim() || !form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (dialogItem === 'new') {
        await window.api.items.create(form)
      } else if (dialogItem) {
        await window.api.items.update(dialogItem.id, form)
      }
      setDialogItem(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item: Item): Promise<void> {
    if (!confirm(`Delete "${item.name}"? This only works if it has no recorded units.`)) return
    setError(null)
    try {
      await window.api.items.delete(item.id)
      await reload()
    } catch (err) {
      // Surfaces the friendly FK-violation message translated in dataHandlers.ts
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Items catalog</h2>
          <p className="text-muted-foreground text-sm">
            Item *types* — categories, names, and expected stock levels. Individually tracked
            units live under Item Units.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus /> Add item
        </Button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Initial stock</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items?.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.category}</TableCell>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell className="text-right">{item.initialStock}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(item)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(item)}>
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {items?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground text-center">
                  No items yet — add the first one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogItem !== null} onOpenChange={(open) => !open && setDialogItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogItem === 'new' ? 'Add item' : 'Edit item'}</DialogTitle>
            <DialogDescription>
              Item type details. Individual serialized units are managed separately.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-category">Category</Label>
              <Input
                id="item-category"
                list="item-category-suggestions"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="e.g. Site Tools"
              />
              <datalist id="item-category-suggestions">
                {categorySuggestions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-name">Name</Label>
              <Input
                id="item-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Body Harness"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-stock">Initial stock</Label>
              <Input
                id="item-stock"
                type="number"
                min={0}
                value={form.initialStock}
                onChange={(e) =>
                  setForm((f) => ({ ...f, initialStock: Number(e.target.value) || 0 }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogItem(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.category.trim() || !form.name.trim()}>
              {dialogItem === 'new' ? 'Create' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
