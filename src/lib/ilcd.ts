import type { DatasetType } from "@/lib/datasets"

/**
 * A practical subset of the ILCD (International Life Cycle Data) format used by
 * tiangong-lca-next, scoped to the fields a person actually authors. Sections that
 * are large, computed/workflow output in the real app (LCIA Results, the Validation
 * review record, mathematicalRelations) are intentionally not modeled here.
 */

export const LANGS = ["en", "zh"] as const
export type Lang = string
export const LANG_LABELS: Record<Lang, string> = { en: "English", zh: "简体中文" }

export interface LangText {
  lang: Lang
  text: string
}

export function langText(en: string, zh = ""): LangText[] {
  const out: LangText[] = []
  if (en) out.push({ lang: "en", text: en })
  if (zh) out.push({ lang: "zh", text: zh })
  return out
}

export function getLangText(value: LangText[] | undefined, lang: Lang): string {
  return value?.find((v) => v.lang === lang)?.text ?? ""
}

export function setLangText(
  value: LangText[] | undefined,
  lang: Lang,
  text: string,
): LangText[] {
  const entries = value ?? []
  const index = entries.findIndex(v => v.lang === lang)
  if (index < 0) return text ? [...entries, { lang, text }] : entries
  return text
    ? entries.map((entry, i) => i === index ? { ...entry, text } : entry)
    : entries.filter((_, i) => i !== index)
}

/** ILCD's "GlobalReference": a pointer at another dataset, with a cached label. */
export interface DatasetRef {
  refObjectId: string | null
  type: DatasetType
  shortDescription: string
}

export function emptyRef(type: DatasetType): DatasetRef {
  return { refObjectId: null, type, shortDescription: "" }
}

export interface ComplianceDeclaration {
  referenceToComplianceSystem: string
  approvalOfOverallCompliance: string
}

export type ExchangeDirection = "Input" | "Output"

export interface ProcessExchange {
  dataSetInternalID: number
  referenceToFlowDataSet: DatasetRef
  exchangeDirection: ExchangeDirection
  meanAmount: number | null
  resultingAmount: number | null
  generalComment: LangText[]
}

export const DATASET_TYPES_OF_DATA_SET = [
  "LCI result",
  "Partly terminated system",
  "Average dataset",
  "Unit process, single operation",
  "Unit process, black box",
] as const

export const LICENSE_TYPES = [
  "Free of charge for all users and uses",
  "Free of charge for some user types or use types",
  "Free of charge for members only",
  "License fee",
  "Other",
] as const

export interface ProcessDataSet {
  processInformation: {
    dataSetInformation: {
      name: {
        baseName: LangText[]
        treatmentStandardsRoutes: LangText[]
        mixAndLocationTypes: LangText[]
      }
      classification: string[]
      generalComment: LangText[]
    }
    quantitativeReference: {
      referenceToReferenceFlow: number | null
    }
    time: {
      referenceYear: number | null
    }
    geography: {
      location: string
    }
  }
  modellingAndValidation: {
    typeOfDataSet: string
    dataCutOffAndCompletenessPrinciples: LangText[]
    referenceToDataSource: DatasetRef
    annualSupplyOrProductionVolume: LangText[]
    complianceDeclarations: ComplianceDeclaration[]
  }
  administrativeInformation: {
    referenceToCommissioner: DatasetRef
    intendedApplications: LangText[]
    referenceToPersonOrEntityGeneratingTheDataSet: DatasetRef
    dataSetVersion: string
    permanentDataSetURI: string
    referenceToOwnershipOfDataSet: DatasetRef
    copyright: boolean
    licenseType: string
    timeStamp: string
  }
  exchanges: ProcessExchange[]
}

export function emptyProcessDataSet(): ProcessDataSet {
  return {
    processInformation: {
      dataSetInformation: {
        name: { baseName: [], treatmentStandardsRoutes: [], mixAndLocationTypes: [] },
        classification: [],
        generalComment: [],
      },
      quantitativeReference: { referenceToReferenceFlow: null },
      time: { referenceYear: null },
      geography: { location: "" },
    },
    modellingAndValidation: {
      typeOfDataSet: "",
      dataCutOffAndCompletenessPrinciples: [],
      referenceToDataSource: emptyRef("source"),
      annualSupplyOrProductionVolume: [],
      complianceDeclarations: [],
    },
    administrativeInformation: {
      referenceToCommissioner: emptyRef("contact"),
      intendedApplications: [],
      referenceToPersonOrEntityGeneratingTheDataSet: emptyRef("contact"),
      dataSetVersion: "01.01.000",
      permanentDataSetURI: "",
      referenceToOwnershipOfDataSet: emptyRef("contact"),
      copyright: false,
      licenseType: "",
      timeStamp: new Date().toISOString(),
    },
    exchanges: [],
  }
}

/** Type guard + normalizer: fills in any missing branches so partial/legacy data doesn't crash the UI. */
export function toProcessDataSet(payload: unknown): ProcessDataSet {
  const empty = emptyProcessDataSet()
  const p = (payload ?? {}) as Partial<ProcessDataSet>
  return {
    processInformation: {
      dataSetInformation: {
        name: {
          baseName: p.processInformation?.dataSetInformation?.name?.baseName ?? [],
          treatmentStandardsRoutes:
            p.processInformation?.dataSetInformation?.name?.treatmentStandardsRoutes ?? [],
          mixAndLocationTypes:
            p.processInformation?.dataSetInformation?.name?.mixAndLocationTypes ?? [],
        },
        classification: p.processInformation?.dataSetInformation?.classification ?? [],
        generalComment: p.processInformation?.dataSetInformation?.generalComment ?? [],
      },
      quantitativeReference: {
        referenceToReferenceFlow:
          p.processInformation?.quantitativeReference?.referenceToReferenceFlow ?? null,
      },
      time: { referenceYear: p.processInformation?.time?.referenceYear ?? null },
      geography: { location: p.processInformation?.geography?.location ?? "" },
    },
    modellingAndValidation: {
      typeOfDataSet: p.modellingAndValidation?.typeOfDataSet ?? "",
      dataCutOffAndCompletenessPrinciples:
        p.modellingAndValidation?.dataCutOffAndCompletenessPrinciples ?? [],
      referenceToDataSource:
        p.modellingAndValidation?.referenceToDataSource ?? empty.modellingAndValidation.referenceToDataSource,
      annualSupplyOrProductionVolume:
        p.modellingAndValidation?.annualSupplyOrProductionVolume ?? [],
      complianceDeclarations: p.modellingAndValidation?.complianceDeclarations ?? [],
    },
    administrativeInformation: {
      referenceToCommissioner:
        p.administrativeInformation?.referenceToCommissioner ??
        empty.administrativeInformation.referenceToCommissioner,
      intendedApplications: p.administrativeInformation?.intendedApplications ?? [],
      referenceToPersonOrEntityGeneratingTheDataSet:
        p.administrativeInformation?.referenceToPersonOrEntityGeneratingTheDataSet ??
        empty.administrativeInformation.referenceToPersonOrEntityGeneratingTheDataSet,
      dataSetVersion: p.administrativeInformation?.dataSetVersion ?? "01.01.000",
      permanentDataSetURI: p.administrativeInformation?.permanentDataSetURI ?? "",
      referenceToOwnershipOfDataSet:
        p.administrativeInformation?.referenceToOwnershipOfDataSet ??
        empty.administrativeInformation.referenceToOwnershipOfDataSet,
      copyright: p.administrativeInformation?.copyright ?? false,
      licenseType: p.administrativeInformation?.licenseType ?? "",
      timeStamp: p.administrativeInformation?.timeStamp ?? new Date().toISOString(),
    },
    exchanges: normalizeExchanges(p.exchanges),
  }
}

/**
 * Coerces each exchange defensively so legacy/partial data (e.g. rows still on the
 * live database's pre-ILCD payload shape, before `seed.sql` is re-run) renders
 * gracefully instead of crashing on a missing nested reference.
 */
function normalizeExchanges(value: unknown): ProcessExchange[] {
  if (!Array.isArray(value)) return []
  return value.map((v, i) => {
    const e = (v ?? {}) as Partial<ProcessExchange>
    return {
      dataSetInternalID: e.dataSetInternalID ?? i + 1,
      referenceToFlowDataSet: e.referenceToFlowDataSet ?? emptyRef("flow"),
      exchangeDirection: e.exchangeDirection === "Output" ? "Output" : "Input",
      meanAmount: e.meanAmount ?? null,
      resultingAmount: e.resultingAmount ?? null,
      generalComment: e.generalComment ?? [],
    }
  })
}

/**
 * The "shared" admin block per the 2026-09-11 schema research: every ILCD type
 * carries dataEntryBy/publicationAndOwnership; Process additionally has
 * commissioner/dataGenerator/copyright/licenseType, which the other 5 types
 * (Contact, Source, Unit Group, Flow Property, Flow) don't.
 */
export interface SharedAdministrativeInformation {
  referenceToOwnershipOfDataSet: DatasetRef
  dataSetVersion: string
  permanentDataSetURI: string
  timeStamp: string
}

function emptySharedAdmin(): SharedAdministrativeInformation {
  return {
    referenceToOwnershipOfDataSet: emptyRef("contact"),
    dataSetVersion: "01.01.000",
    permanentDataSetURI: "",
    timeStamp: new Date().toISOString(),
  }
}

function toSharedAdmin(p: Partial<SharedAdministrativeInformation> | undefined): SharedAdministrativeInformation {
  const empty = emptySharedAdmin()
  return {
    referenceToOwnershipOfDataSet: p?.referenceToOwnershipOfDataSet ?? empty.referenceToOwnershipOfDataSet,
    dataSetVersion: p?.dataSetVersion ?? empty.dataSetVersion,
    permanentDataSetURI: p?.permanentDataSetURI ?? "",
    timeStamp: p?.timeStamp ?? empty.timeStamp,
  }
}

function normalizeComplianceDeclarations(value: unknown): ComplianceDeclaration[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => {
    const c = (v ?? {}) as Partial<ComplianceDeclaration>
    return {
      referenceToComplianceSystem: c.referenceToComplianceSystem ?? "",
      approvalOfOverallCompliance: c.approvalOfOverallCompliance ?? "",
    }
  })
}

function normalizeRefList(value: unknown, type: DatasetType): DatasetRef[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => {
    const r = (v ?? {}) as Partial<DatasetRef>
    return {
      refObjectId: r.refObjectId ?? null,
      type: r.type ?? type,
      shortDescription: r.shortDescription ?? "",
    }
  })
}

// ---------------------------------------------------------------------------
// Contact — 2 tabs, the simplest of the 6 types: an address-book entry.
// ---------------------------------------------------------------------------

export interface ContactDataSet {
  contactInformation: {
    dataSetInformation: {
      shortName: LangText[]
      name: LangText[]
      classification: string[]
      email: string
      wwwAddress: string
      centralContactPoint: LangText[]
      contactAddress: string
      telephone: string
      telefax: string
      generalComment: LangText[]
      referenceToContact: DatasetRef[]
    }
  }
  administrativeInformation: SharedAdministrativeInformation
}

export function emptyContactDataSet(): ContactDataSet {
  return {
    contactInformation: {
      dataSetInformation: {
        shortName: [],
        name: [],
        classification: [],
        email: "",
        wwwAddress: "",
        centralContactPoint: [],
        contactAddress: "",
        telephone: "",
        telefax: "",
        generalComment: [],
        referenceToContact: [],
      },
    },
    administrativeInformation: emptySharedAdmin(),
  }
}

export function toContactDataSet(payload: unknown): ContactDataSet {
  const p = (payload ?? {}) as Partial<ContactDataSet>
  const di = p.contactInformation?.dataSetInformation
  return {
    contactInformation: {
      dataSetInformation: {
        shortName: di?.shortName ?? [],
        name: di?.name ?? [],
        classification: di?.classification ?? [],
        email: di?.email ?? "",
        wwwAddress: di?.wwwAddress ?? "",
        centralContactPoint: di?.centralContactPoint ?? [],
        contactAddress: di?.contactAddress ?? "",
        telephone: di?.telephone ?? "",
        telefax: di?.telefax ?? "",
        generalComment: di?.generalComment ?? [],
        referenceToContact: normalizeRefList(di?.referenceToContact, "contact"),
      },
    },
    administrativeInformation: toSharedAdmin(p.administrativeInformation),
  }
}

// ---------------------------------------------------------------------------
// Source — 2 tabs, close to a citation record.
// ---------------------------------------------------------------------------

export const PUBLICATION_TYPES = [
  "Undefined",
  "Article in periodical",
  "Chapter in anthology",
  "Monograph",
  "Direct measurement",
  "Oral communication",
  "Personal written communication",
  "Questionnaire",
  "Software or database",
  "Other unpublished and grey literature",
] as const

export interface SourceDataSet {
  sourceInformation: {
    dataSetInformation: {
      shortName: LangText[]
      classification: string[]
      sourceCitation: string
      publicationType: string
      sourceDescriptionOrComment: LangText[]
      referenceToContact: DatasetRef
    }
  }
  administrativeInformation: SharedAdministrativeInformation
}

export function emptySourceDataSet(): SourceDataSet {
  return {
    sourceInformation: {
      dataSetInformation: {
        shortName: [],
        classification: [],
        sourceCitation: "",
        publicationType: "",
        sourceDescriptionOrComment: [],
        referenceToContact: emptyRef("contact"),
      },
    },
    administrativeInformation: emptySharedAdmin(),
  }
}

export function toSourceDataSet(payload: unknown): SourceDataSet {
  const p = (payload ?? {}) as Partial<SourceDataSet>
  const di = p.sourceInformation?.dataSetInformation
  return {
    sourceInformation: {
      dataSetInformation: {
        shortName: di?.shortName ?? [],
        classification: di?.classification ?? [],
        sourceCitation: di?.sourceCitation ?? "",
        publicationType: di?.publicationType ?? "",
        sourceDescriptionOrComment: di?.sourceDescriptionOrComment ?? [],
        referenceToContact: di?.referenceToContact ?? emptyRef("contact"),
      },
    },
    administrativeInformation: toSharedAdmin(p.administrativeInformation),
  }
}

// ---------------------------------------------------------------------------
// Unit Group — 3 tabs + a units[] list (e.g. kg/g/t, all relative to one
// reference unit with a conversion factor of 1.0).
// ---------------------------------------------------------------------------

export interface UnitGroupUnit {
  dataSetInternalID: number
  name: string
  meanValue: number | null
  generalComment: LangText[]
}

export interface UnitGroupDataSet {
  unitGroupInformation: {
    dataSetInformation: {
      name: LangText[]
      classification: string[]
      generalComment: LangText[]
    }
    quantitativeReference: {
      referenceToReferenceUnit: number | null
    }
  }
  modellingAndValidation: {
    complianceDeclarations: ComplianceDeclaration[]
  }
  administrativeInformation: SharedAdministrativeInformation
  units: UnitGroupUnit[]
}

export function emptyUnitGroupDataSet(): UnitGroupDataSet {
  return {
    unitGroupInformation: {
      dataSetInformation: { name: [], classification: [], generalComment: [] },
      quantitativeReference: { referenceToReferenceUnit: null },
    },
    modellingAndValidation: { complianceDeclarations: [] },
    administrativeInformation: emptySharedAdmin(),
    units: [],
  }
}

export function toUnitGroupDataSet(payload: unknown): UnitGroupDataSet {
  const p = (payload ?? {}) as Partial<UnitGroupDataSet>
  const di = p.unitGroupInformation?.dataSetInformation
  return {
    unitGroupInformation: {
      dataSetInformation: {
        name: di?.name ?? [],
        classification: di?.classification ?? [],
        generalComment: di?.generalComment ?? [],
      },
      quantitativeReference: {
        referenceToReferenceUnit:
          p.unitGroupInformation?.quantitativeReference?.referenceToReferenceUnit ?? null,
      },
    },
    modellingAndValidation: {
      complianceDeclarations: normalizeComplianceDeclarations(
        p.modellingAndValidation?.complianceDeclarations,
      ),
    },
    administrativeInformation: toSharedAdmin(p.administrativeInformation),
    units: normalizeUnits(p.units),
  }
}

function normalizeUnits(value: unknown): UnitGroupUnit[] {
  if (!Array.isArray(value)) return []
  return value.map((v, i) => {
    const u = (v ?? {}) as Partial<UnitGroupUnit>
    return {
      dataSetInternalID: u.dataSetInternalID ?? i + 1,
      name: u.name ?? "",
      meanValue: u.meanValue ?? null,
      generalComment: u.generalComment ?? [],
    }
  })
}

// ---------------------------------------------------------------------------
// Flow Property — 3 tabs, simple: a name + a reference to the Unit Group
// that defines its unit.
// ---------------------------------------------------------------------------

export interface FlowPropertyDataSet {
  flowPropertiesInformation: {
    dataSetInformation: {
      name: LangText[]
      classification: string[]
      generalComment: LangText[]
    }
    quantitativeReference: {
      referenceToReferenceUnitGroup: DatasetRef
    }
  }
  modellingAndValidation: {
    referenceToDataSource: DatasetRef
    complianceDeclarations: ComplianceDeclaration[]
  }
  administrativeInformation: SharedAdministrativeInformation
}

export function emptyFlowPropertyDataSet(): FlowPropertyDataSet {
  return {
    flowPropertiesInformation: {
      dataSetInformation: { name: [], classification: [], generalComment: [] },
      quantitativeReference: { referenceToReferenceUnitGroup: emptyRef("unit_group") },
    },
    modellingAndValidation: {
      referenceToDataSource: emptyRef("source"),
      complianceDeclarations: [],
    },
    administrativeInformation: emptySharedAdmin(),
  }
}

export function toFlowPropertyDataSet(payload: unknown): FlowPropertyDataSet {
  const p = (payload ?? {}) as Partial<FlowPropertyDataSet>
  const di = p.flowPropertiesInformation?.dataSetInformation
  return {
    flowPropertiesInformation: {
      dataSetInformation: {
        name: di?.name ?? [],
        classification: di?.classification ?? [],
        generalComment: di?.generalComment ?? [],
      },
      quantitativeReference: {
        referenceToReferenceUnitGroup:
          p.flowPropertiesInformation?.quantitativeReference?.referenceToReferenceUnitGroup ??
          emptyRef("unit_group"),
      },
    },
    modellingAndValidation: {
      referenceToDataSource: p.modellingAndValidation?.referenceToDataSource ?? emptyRef("source"),
      complianceDeclarations: normalizeComplianceDeclarations(
        p.modellingAndValidation?.complianceDeclarations,
      ),
    },
    administrativeInformation: toSharedAdmin(p.administrativeInformation),
  }
}

// ---------------------------------------------------------------------------
// Flow — 3 tabs. Key structural piece: a repeatable flowProperties[] list (a
// flow can carry multiple properties, e.g. Mass + Net calorific value); the
// quantitative reference points at which entry is the flow's native unit.
// ---------------------------------------------------------------------------

export interface FlowPropertyAmount {
  dataSetInternalID: number
  referenceToFlowPropertyDataSet: DatasetRef
  meanValue: number | null
  generalComment: LangText[]
}

export const FLOW_TYPES = ["Elementary flow", "Product flow", "Waste flow", "Other flow"] as const

export interface FlowDataSet {
  flowInformation: {
    dataSetInformation: {
      name: {
        baseName: LangText[]
        treatmentStandardsRoutes: LangText[]
        mixAndLocationTypes: LangText[]
      }
      classification: string[]
      casNumber: string
      sumFormula: string
      generalComment: LangText[]
    }
    quantitativeReference: {
      referenceToReferenceFlowProperty: number | null
    }
  }
  modellingAndValidation: {
    typeOfDataSet: string
    complianceDeclarations: ComplianceDeclaration[]
  }
  administrativeInformation: SharedAdministrativeInformation
  flowProperties: FlowPropertyAmount[]
}

export function emptyFlowDataSet(): FlowDataSet {
  return {
    flowInformation: {
      dataSetInformation: {
        name: { baseName: [], treatmentStandardsRoutes: [], mixAndLocationTypes: [] },
        classification: [],
        casNumber: "",
        sumFormula: "",
        generalComment: [],
      },
      quantitativeReference: { referenceToReferenceFlowProperty: null },
    },
    modellingAndValidation: { typeOfDataSet: "", complianceDeclarations: [] },
    administrativeInformation: emptySharedAdmin(),
    flowProperties: [],
  }
}

export function toFlowDataSet(payload: unknown): FlowDataSet {
  const p = (payload ?? {}) as Partial<FlowDataSet>
  const di = p.flowInformation?.dataSetInformation
  return {
    flowInformation: {
      dataSetInformation: {
        name: {
          baseName: di?.name?.baseName ?? [],
          treatmentStandardsRoutes: di?.name?.treatmentStandardsRoutes ?? [],
          mixAndLocationTypes: di?.name?.mixAndLocationTypes ?? [],
        },
        classification: di?.classification ?? [],
        casNumber: di?.casNumber ?? "",
        sumFormula: di?.sumFormula ?? "",
        generalComment: di?.generalComment ?? [],
      },
      quantitativeReference: {
        referenceToReferenceFlowProperty:
          p.flowInformation?.quantitativeReference?.referenceToReferenceFlowProperty ?? null,
      },
    },
    modellingAndValidation: {
      typeOfDataSet: p.modellingAndValidation?.typeOfDataSet ?? "",
      complianceDeclarations: normalizeComplianceDeclarations(
        p.modellingAndValidation?.complianceDeclarations,
      ),
    },
    administrativeInformation: toSharedAdmin(p.administrativeInformation),
    flowProperties: normalizeFlowProperties(p.flowProperties),
  }
}

function normalizeFlowProperties(value: unknown): FlowPropertyAmount[] {
  if (!Array.isArray(value)) return []
  return value.map((v, i) => {
    const fp = (v ?? {}) as Partial<FlowPropertyAmount>
    return {
      dataSetInternalID: fp.dataSetInternalID ?? i + 1,
      referenceToFlowPropertyDataSet: fp.referenceToFlowPropertyDataSet ?? emptyRef("flow_property"),
      meanValue: fp.meanValue ?? null,
      generalComment: fp.generalComment ?? [],
    }
  })
}

// ---------------------------------------------------------------------------
// Model ("Life Cycle Model") — a process graph, not a flat document. Per the
// 2026-09-11 schema research: name/classification/generalComment and the admin
// block use the exact same shape as Process (not the 5-type shared minimal
// admin), and the graph itself is process instances + connections declared
// only from the output side. The lite scope here models that graph as two
// flat lists (a table of instances, a table of edges) rather than the real
// app's visual flowchart editor or its matrix calculation engine — neither is
// in scope. `@flowUUID`/`groups`/`parameters`/`referenceToResultingProcess`
// are cosmetic/calculation-only and dropped, same spirit as skipping
// Process's LCIA Results/Validation.
// ---------------------------------------------------------------------------

export type ModelAdministrativeInformation = ProcessDataSet["administrativeInformation"]

export interface ModelProcessInstance {
  dataSetInternalID: number
  referenceToProcess: DatasetRef
  multiplicationFactor: number | null
}

export interface ModelConnection {
  fromInstanceId: number
  toInstanceId: number
}

export interface ModelDataSet {
  modelInformation: {
    dataSetInformation: {
      name: {
        baseName: LangText[]
        treatmentStandardsRoutes: LangText[]
        mixAndLocationTypes: LangText[]
      }
      classification: string[]
      generalComment: LangText[]
    }
    quantitativeReference: {
      referenceToReferenceProcess: number | null
    }
  }
  modellingAndValidation: {
    complianceDeclarations: ComplianceDeclaration[]
  }
  administrativeInformation: ModelAdministrativeInformation
  processInstances: ModelProcessInstance[]
  connections: ModelConnection[]
}

function emptyModelAdmin(): ModelAdministrativeInformation {
  return {
    referenceToCommissioner: emptyRef("contact"),
    intendedApplications: [],
    referenceToPersonOrEntityGeneratingTheDataSet: emptyRef("contact"),
    dataSetVersion: "01.01.000",
    permanentDataSetURI: "",
    referenceToOwnershipOfDataSet: emptyRef("contact"),
    copyright: false,
    licenseType: "",
    timeStamp: new Date().toISOString(),
  }
}

export function emptyModelDataSet(): ModelDataSet {
  return {
    modelInformation: {
      dataSetInformation: {
        name: { baseName: [], treatmentStandardsRoutes: [], mixAndLocationTypes: [] },
        classification: [],
        generalComment: [],
      },
      quantitativeReference: { referenceToReferenceProcess: null },
    },
    modellingAndValidation: { complianceDeclarations: [] },
    administrativeInformation: emptyModelAdmin(),
    processInstances: [],
    connections: [],
  }
}

export function toModelDataSet(payload: unknown): ModelDataSet {
  const empty = emptyModelAdmin()
  const p = (payload ?? {}) as Partial<ModelDataSet>
  const di = p.modelInformation?.dataSetInformation
  const admin = p.administrativeInformation
  return {
    modelInformation: {
      dataSetInformation: {
        name: {
          baseName: di?.name?.baseName ?? [],
          treatmentStandardsRoutes: di?.name?.treatmentStandardsRoutes ?? [],
          mixAndLocationTypes: di?.name?.mixAndLocationTypes ?? [],
        },
        classification: di?.classification ?? [],
        generalComment: di?.generalComment ?? [],
      },
      quantitativeReference: {
        referenceToReferenceProcess:
          p.modelInformation?.quantitativeReference?.referenceToReferenceProcess ?? null,
      },
    },
    modellingAndValidation: {
      complianceDeclarations: normalizeComplianceDeclarations(
        p.modellingAndValidation?.complianceDeclarations,
      ),
    },
    administrativeInformation: {
      referenceToCommissioner: admin?.referenceToCommissioner ?? empty.referenceToCommissioner,
      intendedApplications: admin?.intendedApplications ?? [],
      referenceToPersonOrEntityGeneratingTheDataSet:
        admin?.referenceToPersonOrEntityGeneratingTheDataSet ??
        empty.referenceToPersonOrEntityGeneratingTheDataSet,
      dataSetVersion: admin?.dataSetVersion ?? "01.01.000",
      permanentDataSetURI: admin?.permanentDataSetURI ?? "",
      referenceToOwnershipOfDataSet:
        admin?.referenceToOwnershipOfDataSet ?? empty.referenceToOwnershipOfDataSet,
      copyright: admin?.copyright ?? false,
      licenseType: admin?.licenseType ?? "",
      timeStamp: admin?.timeStamp ?? new Date().toISOString(),
    },
    processInstances: normalizeProcessInstances(p.processInstances),
    connections: normalizeConnections(p.connections),
  }
}

function normalizeProcessInstances(value: unknown): ModelProcessInstance[] {
  if (!Array.isArray(value)) return []
  return value.map((v, i) => {
    const pi = (v ?? {}) as Partial<ModelProcessInstance>
    return {
      dataSetInternalID: pi.dataSetInternalID ?? i + 1,
      referenceToProcess: pi.referenceToProcess ?? emptyRef("process"),
      multiplicationFactor: pi.multiplicationFactor ?? null,
    }
  })
}

function normalizeConnections(value: unknown): ModelConnection[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => {
    const c = (v ?? {}) as Partial<ModelConnection>
    return {
      fromInstanceId: c.fromInstanceId ?? 0,
      toInstanceId: c.toInstanceId ?? 0,
    }
  })
}
