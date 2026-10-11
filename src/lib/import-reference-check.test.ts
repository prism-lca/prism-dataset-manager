import { describe,it,expect } from 'vitest'
import { importReferences,missingImportReferences } from './import-reference-check'
import type { PreparedImportRow } from './import-persistence'
const id='10000000-0000-4000-8000-000000000001'
const row=(payload:Record<string,unknown>)=>({id,type:'flow',name:'Imported flow',payload}) as PreparedImportRow

describe('confirmation reference preflight',()=>{
 it('finds nested and repeated references with database-compatible roles',()=>{
  const refs=importReferences([row({'a/b':[{referenceToOwnershipOfDataSet:{refObjectId:id}}]})])
  expect(refs).toEqual([{id,type:'contact',path:'/a~1b/0/referenceToOwnershipOfDataSet',dataset:'Imported flow'}])
  expect(missingImportReferences(refs,new Map())).toHaveLength(1)
  expect(missingImportReferences(refs,new Map([[id,'flow']]))).toHaveLength(1)
  expect(missingImportReferences(refs,new Map([[id,'contact']]))).toHaveLength(0)
 })
 it('rejects wrong declared types and malformed identifiers',()=>{
  expect(()=>importReferences([row({referenceToFlowDataSet:{type:'contact',refObjectId:id}})])).toThrow('Invalid reference')
  expect(()=>importReferences([row({referenceToFlowDataSet:{refObjectId:'not-a-uuid'}})])).toThrow('Invalid reference')
 })
 it('accepts empty reference fields and validates declared extension references',()=>{
  expect(importReferences([row({referenceToFlowDataSet:{refObjectId:null}})])).toEqual([])
  expect(importReferences([row({future:{type:'source',refObjectId:id}})])[0].type).toBe('source')
 })
})
