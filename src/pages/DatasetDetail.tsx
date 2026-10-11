import { DatasetSourceData } from '@/components/ilcd/dataset-source-data'
import { useParams } from "react-router-dom"
import { getDatasetTypeInfo } from "@/lib/datasets"
import { ModelDetail } from "@/pages/ModelDetail"
import { ProcessDetail } from "@/pages/ProcessDetail"
import { FlowDetail } from "@/pages/FlowDetail"
import { FlowPropertyDetail } from "@/pages/FlowPropertyDetail"
import { UnitGroupDetail } from "@/pages/UnitGroupDetail"
import { SourceDetail } from "@/pages/SourceDetail"
import { ContactDetail } from "@/pages/ContactDetail"

export function DatasetDetail() {
  const { type } = useParams<{ type: string }>()
  const typeInfo = type ? getDatasetTypeInfo(type) : undefined

  if (!typeInfo) return null
  switch (typeInfo.type) {
    case "model":
      return <><ModelDetail /><DatasetSourceData /></>
    case "process":
      return <><ProcessDetail /><DatasetSourceData /></>
    case "flow":
      return <><FlowDetail /><DatasetSourceData /></>
    case "flow_property":
      return <><FlowPropertyDetail /><DatasetSourceData /></>
    case "unit_group":
      return <><UnitGroupDetail /><DatasetSourceData /></>
    case "source":
      return <><SourceDetail /><DatasetSourceData /></>
    case "contact":
      return <><ContactDetail /><DatasetSourceData /></>
  }
}
