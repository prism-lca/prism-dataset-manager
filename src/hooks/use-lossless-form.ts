import { useCallback, useRef, useState } from 'react'
import { applyFormEdits, sameJson } from '@/lib/lossless-edits'
import type { Dataset, NewDataset } from '@/lib/datasets'

export function useLosslessForm<T>(normalize: (payload: unknown) => T) {
  const [value, setValue] = useState<T>(() => normalize(undefined))
  const baseline = useRef(value)
  const original = useRef<Dataset | null>(null)
  const loadDataset = useCallback((dataset: Dataset) => {
    const projection = normalize(dataset.payload)
    original.current = dataset
    baseline.current = projection
    setValue(projection)
  }, [normalize])
  function prepareInput(input: NewDataset): NewDataset {
    if (!original.current) return input
    const result = applyFormEdits(original.current.payload, baseline.current, value)
    if (result.removedExtraPaths.length && !window.confirm('The items you removed contain additional imported data. Delete those items and their additional data?')) {
      throw new Error('Deletion cancelled. The original data has not been changed.')
    }
    const root = ({ process: 'processInformation', model: 'modelInformation', flow: 'flowInformation', flow_property: 'flowPropertiesInformation', unit_group: 'unitGroupInformation', source: 'sourceInformation', contact: 'contactInformation' } as const)[input.type]
    function fields(projection: unknown) {
      const p = projection as Record<string, { dataSetInformation?: Record<string, unknown> }>
      return p[root]?.dataSetInformation ?? {}
    }
    const old = fields(baseline.current), next = fields(value)
    return { ...input, payload: result.payload,
      name: sameJson([old.name, old.shortName], [next.name, next.shortName]) ? original.current.name : input.name,
      description: sameJson([old.generalComment, old.sourceDescriptionOrComment], [next.generalComment, next.sourceDescriptionOrComment]) ? original.current.description : input.description }
  }
  return { value, setValue, loadDataset, prepareInput }
}
