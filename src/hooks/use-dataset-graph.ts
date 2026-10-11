import { useEffect, useState } from "react"
import { getDataset, getDatasetDependencies, type Dataset } from "@/lib/datasets"
import { useSessionStore } from "@/state/session"

export function useDatasetGraph(id: string | undefined) {
  const userId = useSessionStore((s) => s.session?.user.id)
  const [result, setResult] = useState<{
    id: string | undefined
    userId: string | undefined
    dataset: Dataset | null
    dependencies: Map<string, Dataset>
    error?: string
  }>()

  useEffect(() => {
    if (!id) return
    let cancelled = false
    Promise.all([getDataset(id), getDatasetDependencies(id)]).then(([dataset, rows]) => {
      if (!cancelled) setResult({ id, userId, dataset: dataset ?? null,
        dependencies: new Map(rows.map((row) => [row.id, row])) })
    }).catch((error: unknown) => {
      if (!cancelled) setResult({ id, userId, dataset: null, dependencies: new Map(),
        error: error instanceof Error ? error.message : "Couldn't load this dataset." })
    })
    return () => { cancelled = true }
  }, [id, userId])

  const current = result?.id === id && result?.userId === userId ? result : undefined
  return { dataset: current?.dataset, dependencies: current?.dependencies ?? new Map<string, Dataset>(),
    error: current?.error }
}
