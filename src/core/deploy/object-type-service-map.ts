/**
 * Maps a SimpleMDG "-srv-<abbrev>" app suffix to its CDS-defined CommonService OData path —
 * extracted from each object type's own `srv/common-service.cds` `@(path: '/XCommonService')`
 * annotation (source: be-group/master-data in the SimpleMDG dashboard monorepo). Every "-srv-*"
 * app disables its live service index in production (confirmed against several real customer
 * deployments), so without either this map or a linked GitLab group to scan, there's no way to
 * auto-discover its OData path at all — this is what turns "type the path yourself" into
 * automatic discovery for every object type below, the same way BusinessPartner/Product already
 * worked once their path was known by hand.
 *
 * Deliberately NOT exhaustive: some object types' source wasn't available locally to extract a
 * path from (e.g. customer, vendor, order-group — present as a repo shell with no `srv/` checked
 * out), and any object type added/renamed after this list was captured won't be here either.
 * Both cases fall straight through to the existing GitLab-scan/manual-entry fallbacks — this map
 * is a fast-path shortcut layered on top of them, never a requirement.
 */
export const OBJECT_TYPE_COMMON_SERVICE_PATH: Record<string, string> = {
  ar: "/ActivityRateCommonService",
  at: "/ActivityTypeCommonService",
  art: "/ArticleCommonService",
  ah: "/ArticleHierarchyCommonService",
  artm: "/ArticleMasterCommonService",
  am: "/AssetMasterCommonService",
  asmt: "/AssortmentCommonService",
  asmm: "/AssortmentModuleCommonService",
  bm: "/BankMasterCommonService",
  bcl: "/BatchMasterCommonService",
  bin: "/BinMasterCommonService",
  bom: "/BillOfMaterialCommonService",
  bp: "/BusinessPartnerCommonService",
  cha: "/CharacteristicsCommonService",
  cl: "/ClassCommonService",
  csu: "/ConsolidationUnitCommonService",
  cc: "/CostCenterCommonService",
  ccgr: "/CostCenterGroupCommonService",
  cch: "/CCHierarchyCommonService",
  ch: "/CustomerHierarchyCommonService",
  cmi: "/CustomerMaterialInfoRecordCommonService",
  dir: "/DocumentInfoRecordCommonService",
  ecm: "/EngineeringChangeMasterCommonService",
  equi: "/EquipmentCommonService",
  fsi: "/FSItemCommonService",
  floc: "/FunctionalLocationCommonService",
  gl: "/GLAccountInChartOfAccountsCommonService",
  io: "/InternalOrderCommonService",
  mord: "/MaintenanceOrderCommonService",
  mpln: "/MaintenancePlanCommonService",
  mc: "/MerchCategoryCommonService",
  mch: "/MCHierarchyCommonService",
  mix: "/MixedCostingCommonService",
  pi: "/PackingInstructionCommonService",
  pkd: "/ParkedDocumentCommonService",
  pa: "/PartnerAppCommonService",
  pcr: "/PricingConditionRecordCommonService",
  prd: "/ProductCommonService",
  prdh: "/ProductHierarchyCommonService",
  pv: "/ProductionVersionCommonService",
  pc: "/ProfitCenterCommonService",
  pch: "/PCHierarchyCommonService",
  pr: "/PurchaseRequisitionCommonService",
  pdoc: "/PurchasingDocumentCommonService",
  pir: "/PurchasingInfoRecordCommonService",
  rt: "/RoutingCommonService",
  sdoc: "/SalesDocumentCommonService",
  sc: "/SamplingSchemeCommonService",
  site: "/SiteMasterCommonService",
  sl: "/SourceListCommonService",
  skf: "/SKFiguresCommonService",
  sh: "/SupplierHierarchyCommonService",
  tl: "/TaskListCommonService",
  vinv: "/VendorInvoiceCommonService",
  wc: "/WorkCenterCommonService",
};

/**
 * Extracts the "-srv-<abbrev>" suffix from a live CF app name. Anchored at the end so it only
 * matches the base app — "simplemdg-srv-bp-process" (its async-worker sibling, never the one
 * carrying the OData service) doesn't end in "-srv-<letters>" and correctly doesn't match.
 */
export function extractSrvAbbreviation(appName: string): string | undefined {
  const match = appName.match(/-srv-([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : undefined;
}

export function lookupKnownCommonServicePath(appName: string): string | undefined {
  const abbreviation = extractSrvAbbreviation(appName);
  return abbreviation ? OBJECT_TYPE_COMMON_SERVICE_PATH[abbreviation] : undefined;
}
