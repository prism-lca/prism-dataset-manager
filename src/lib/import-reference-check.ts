import { DATASET_TYPES, type DatasetType } from './datasets'
import type { PreparedImportRow } from './import-persistence'
export interface ImportReference { id: string; type: DatasetType; path: string; dataset: string }
const roles: Record<string,DatasetType> = {
 referenceToFlowDataSet:'flow',referenceToFlowPropertyDataSet:'flow_property',referenceToReferenceUnitGroup:'unit_group',referenceToProcess:'process',referenceToDataSource:'source',referenceToContact:'contact',referenceToCommissioner:'contact',referenceToPersonOrEntityGeneratingTheDataSet:'contact',referenceToOwnershipOfDataSet:'contact',
}
export function importReferences(rows: PreparedImportRow[]): ImportReference[] {
 const refs:ImportReference[]=[]
 for(const row of rows) {
  function walk(value:unknown,path:string,role:string) {
   if(Array.isArray(value)){value.forEach((child,i)=>walk(child,`${path}/${i}`,role));return}
   if(!value||typeof value!=='object')return
   const object=value as Record<string,unknown>
   if(object.refObjectId!=null) {
    const type=roles[role]??object.type
    if(typeof object.refObjectId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(object.refObjectId)
     ||!DATASET_TYPES.some(t=>t.type===type)||('type' in object&&object.type!==type))throw new Error(`Invalid reference in ${row.name} at ${path}.`)
    refs.push({id:object.refObjectId.toLowerCase(),type:type as DatasetType,path,dataset:row.name})
   }
   for(const [key,child]of Object.entries(object))walk(child,`${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`,key)
  }
  walk(row.payload,'','reference')
 }
 return refs
}
export function missingImportReferences(refs:ImportReference[],known:ReadonlyMap<string,DatasetType>) {
 return refs.filter(ref=>known.get(ref.id)!==ref.type)
}
