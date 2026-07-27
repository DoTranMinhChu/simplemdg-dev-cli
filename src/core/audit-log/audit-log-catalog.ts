/**
 * Static catalog of every audit/log entity documented from the simplemdg-dashboard
 * (core product) and simplemdg-mckesson (client fork) CAP/CDS codebases. This file
 * says what logs CAN exist, anywhere — whether a given table actually exists in a
 * given BTP environment is a runtime question answered by `audit-log-table-resolver.ts`,
 * never assumed here.
 *
 * Two tiers, matching how the source actually organizes them:
 *  - "core": one-off log entities scattered across the core db_* packages
 *    (db_process, db_config, db_user, db_data_quality, db_consolidate, db_background).
 *    Each maps to exactly one physical table per environment.
 *  - "master-data-domain": a small number of CDS aspects (MDConsolidateLog,
 *    <Domain>StatusLog, ...) that repeat once per master-data domain package
 *    (business-partner, customer, product, ... ~70 folders under be-group/master-data).
 *    Only business-partner (bp.model.f4.*) and document-info-record
 *    (dir.model.final.DIRStatusLog) were read directly to confirm the pattern —
 *    the exact per-domain namespace abbreviation (bp/dir/art/...) is NOT assumed
 *    for the other ~65 domains, so these entries are `multiTable: true` and the
 *    resolver reports however many real tables it finds by suffix match, listed
 *    by their raw table name rather than guessed back to a domain slug.
 */

export type TAuditLogTier = "core" | "master-data-domain";

export type TAuditLogCategory =
  | "activation"
  | "outbox"
  | "mass-upload"
  | "workflow-task"
  | "config-admin"
  | "generic-audit"
  | "consolidation"
  | "data-quality"
  | "onprem-sync"
  | "eres-lock"
  | "domain-status-log";

/** Which db_* package (or service layer) a "core" entry lives in. Not meaningful for "master-data-domain" entries. */
export type TAuditLogModule = "process" | "config" | "user" | "data-quality" | "consolidate" | "background" | "service-defined";

export type TAuditLogSourceHint = "core" | "client-extension";

export type TAuditLogDefinition = {
  id: string;
  displayName: string;
  tier: TAuditLogTier;
  category: TAuditLogCategory;
  module?: TAuditLogModule;
  description: string;
  cdsEntity?: string;
  /** Case-insensitive substrings matched against real table/view names during resolution. */
  tableNameCandidates: string[];
  timestampColumn?: string;
  statusColumn?: string;
  /** Free-text error/log-blob column, if any (e.g. `errorMessage`, `lastError`, `log`). */
  errorColumn?: string;
  /** Column names usable to trace one business key (reqID, activateID, ...) across tables. */
  correlationKeys: string[];
  sourceHint: TAuditLogSourceHint;
  /** True when one catalog entry can resolve to many physical tables in one environment (the master-data-domain pattern). */
  multiTable?: boolean;
};

const CORE_CATALOG: TAuditLogDefinition[] = [
  // --- Activation / replication (db_process: activation-process-model.cds, business-process-model.cds) ---
  {
    id: "activate-request-log", displayName: "ActivateRequestLog", tier: "core", category: "activation", module: "process",
    description: "Activation audit trail (action/oldValue/newValue/reason) for a single-object ActivateRequest.",
    cdsEntity: "core.process.activation.ActivateRequestLog", tableNameCandidates: ["ACTIVATEREQUESTLOG"],
    timestampColumn: "createdAt", statusColumn: "action", correlationKeys: ["activateID"], sourceHint: "core",
  },
  {
    id: "activate-request-item-log", displayName: "ActivateRequestItemLog", tier: "core", category: "activation", module: "process",
    description: "Per-item activation audit trail for mass CRs (action/oldValue/newValue/reason).",
    cdsEntity: "core.process.activation.ActivateRequestItemLog", tableNameCandidates: ["ACTIVATEREQUESTITEMLOG"],
    timestampColumn: "createdAt", statusColumn: "action", correlationKeys: ["activateID", "activateItemID"], sourceHint: "core",
  },
  {
    id: "integration-activation-log", displayName: "IntegrationActivationLog", tier: "core", category: "activation", module: "process",
    description: "Per-target-system activation result (status FAILED/PASSED + errorlog). Declared in the schema but no writer was found in dashboard core — likely dormant or client-wired only.",
    cdsEntity: "core.process.activation.IntegrationActivationLog", tableNameCandidates: ["INTEGRATIONACTIVATIONLOG"],
    statusColumn: "status", errorColumn: "errorlog", correlationKeys: ["activateID"], sourceHint: "core",
  },
  {
    id: "submit-event-log", displayName: "SubmitEventLog", tier: "core", category: "workflow-task", module: "process",
    description: "Step-by-step technical log of the Submit pipeline (per stepID/mdgLogID) for a request item.",
    cdsEntity: "core.process.business.SubmitEventLog", tableNameCandidates: ["SUBMITEVENTLOG"],
    timestampColumn: "createdAt", statusColumn: "status", errorColumn: "log", correlationKeys: ["reqID", "mdgLogID"], sourceHint: "core",
  },
  {
    id: "submit-mass-event-log", displayName: "SubmitMassEventLog", tier: "core", category: "workflow-task", module: "process",
    description: "Mass-submit progress log (itemCount/itemProcessedCount) per scope.",
    cdsEntity: "core.process.business.SubmitMassEventLog", tableNameCandidates: ["SUBMITMASSEVENTLOG"],
    timestampColumn: "createdAt", statusColumn: "action", correlationKeys: ["reqID"], sourceHint: "core",
  },
  {
    id: "approve-event-log", displayName: "ApproveEventLog", tier: "core", category: "workflow-task", module: "process",
    description: "Step-by-step technical log of the Approve pipeline (per stepID/mdgLogID) for a request item.",
    cdsEntity: "core.process.business.ApproveEventLog", tableNameCandidates: ["APPROVEEVENTLOG"],
    timestampColumn: "createdAt", statusColumn: "status", errorColumn: "log", correlationKeys: ["reqID", "mdgLogID"], sourceHint: "core",
  },
  {
    id: "approve-mass-event-log", displayName: "ApproveMassEventLog", tier: "core", category: "workflow-task", module: "process",
    description: "Mass-approve progress log (itemCount/itemProcessedCount) per scope.",
    cdsEntity: "core.process.business.ApproveMassEventLog", tableNameCandidates: ["APPROVEMASSEVENTLOG"],
    timestampColumn: "createdAt", statusColumn: "action", correlationKeys: ["reqID"], sourceHint: "core",
  },
  {
    id: "activate-event-log", displayName: "ActivateEventLog", tier: "core", category: "activation", module: "process",
    description: "Step-by-step technical log of the Activate/replicate-to-SAP pipeline (per stepID/mdgLogID), correlated by activateID.",
    cdsEntity: "core.process.business.ActivateEventLog", tableNameCandidates: ["ACTIVATEEVENTLOG"],
    timestampColumn: "createdAt", statusColumn: "status", errorColumn: "log", correlationKeys: ["activateID", "reqID", "mdgLogID"], sourceHint: "core",
  },
  {
    id: "activate-mass-event-log", displayName: "ActivateMassEventLog", tier: "core", category: "activation", module: "process",
    description: "Mass-activate progress log (itemCount/itemProcessedCount) per activateID.",
    cdsEntity: "core.process.business.ActivateMassEventLog", tableNameCandidates: ["ACTIVATEMASSEVENTLOG"],
    timestampColumn: "createdAt", statusColumn: "action", correlationKeys: ["activateID", "reqID"], sourceHint: "core",
  },
  {
    id: "on-premise-event-log", displayName: "OnPremiseEventLog", tier: "core", category: "activation", module: "process",
    description: "Maps onPremiseObjectID back to the reqID/activateID/itemID that created it in SAP — the reverse-lookup table for 'what CR produced this on-prem object'.",
    cdsEntity: "core.process.business.OnPremiseEventLog", tableNameCandidates: ["ONPREMISEEVENTLOG"],
    timestampColumn: "createdAt", correlationKeys: ["onPremiseObjectID", "reqID", "activateID", "mdgLogID"], sourceHint: "core",
  },
  {
    id: "activate-request-background", displayName: "ActivateRequestBackground", tier: "core", category: "activation", module: "background",
    description: "Scheduled/background activation queue entry with a free-text execution log.",
    cdsEntity: "core.process.background.ActivateRequestBackground", tableNameCandidates: ["ACTIVATEREQUESTBACKGROUND"],
    timestampColumn: "createdAt", statusColumn: "activateStatus", errorColumn: "log", correlationKeys: ["activateID", "reqID"], sourceHint: "core",
  },

  // --- Task / workflow action logs (db_process: business-process-model.cds) ---
  {
    id: "request-action-log", displayName: "RequestActionLog", tier: "core", category: "workflow-task", module: "process",
    description: "General action log at request level (free-text `log` per `action`).",
    cdsEntity: "core.process.business.RequestActionLog", tableNameCandidates: ["REQUESTACTIONLOG"],
    timestampColumn: "createdAt", statusColumn: "action", errorColumn: "log", correlationKeys: ["reqID"], sourceHint: "core",
  },
  {
    id: "request-item-action-log", displayName: "RequestItemActionLog", tier: "core", category: "workflow-task", module: "process",
    description: "General action log at request-item level (free-text `log` per `action`).",
    cdsEntity: "core.process.business.RequestItemActionLog", tableNameCandidates: ["REQUESTITEMACTIONLOG"],
    timestampColumn: "createdAt", statusColumn: "action", errorColumn: "log", correlationKeys: ["reqID", "itemID"], sourceHint: "core",
  },
  {
    id: "request-task-log", displayName: "RequestTaskLog", tier: "core", category: "workflow-task", module: "process",
    description: "Per-approval-task action/comment log (who did what on a RequestTask).",
    cdsEntity: "core.process.business.RequestTaskLog", tableNameCandidates: ["REQUESTTASKLOG"],
    timestampColumn: "createdAt", statusColumn: "action", correlationKeys: ["reqID", "taskID"], sourceHint: "core",
  },
  {
    id: "request-item-task-log", displayName: "RequestItemTaskLog", tier: "core", category: "workflow-task", module: "process",
    description: "Per-approval-task action/comment log for mass request items.",
    cdsEntity: "core.process.business.RequestItemTaskLog", tableNameCandidates: ["REQUESTITEMTASKLOG"],
    timestampColumn: "createdAt", statusColumn: "action", correlationKeys: ["reqID", "taskID", "itemID"], sourceHint: "core",
  },
  {
    id: "request-task-background-log", displayName: "RequestTaskBackgroundLog", tier: "core", category: "workflow-task", module: "process",
    description: "Background/test-run task processing snapshot, keyed by mdgLogID.",
    cdsEntity: "core.process.business.RequestTaskBackgroundLog", tableNameCandidates: ["REQUESTTASKBACKGROUNDLOG"],
    timestampColumn: "createdAt", correlationKeys: ["reqID", "mdgLogID"], sourceHint: "core",
  },
  {
    id: "request-history", displayName: "RequestHistory", tier: "core", category: "generic-audit", module: "process",
    description: "Field-level change history for a CR: exact oldValue/newValue per businessField, per task step. The 'what changed, when' answer for a single field.",
    cdsEntity: "core.process.business.RequestHistory", tableNameCandidates: ["REQUESTHISTORY"],
    statusColumn: "status", correlationKeys: ["reqID", "objectID", "taskID"], sourceHint: "core",
  },
  {
    id: "project-audit-log", displayName: "ProjectAuditLog", tier: "core", category: "generic-audit", module: "process",
    description: "Audit log for NPI/Project actions (status changes, member assignment, etc.).",
    cdsEntity: "core.process.project.ProjectAuditLog", tableNameCandidates: ["PROJECTAUDITLOG"],
    timestampColumn: "createdAt", statusColumn: "action", correlationKeys: ["projectID"], sourceHint: "core",
  },
  {
    id: "activate-project-step-item-event-data", displayName: "ActivateProjectStepItemEventData", tier: "core", category: "activation", module: "process",
    description: "Per-project-step-item activation log during NPI project activation.",
    cdsEntity: "core.process.project.ActivateProjectStepItemEventData", tableNameCandidates: ["ACTIVATEPROJECTSTEPITEMEVENTDATA"],
    statusColumn: "status", errorColumn: "log", correlationKeys: ["npiLogID", "projectID", "projectStepID", "projectStepItemID"], sourceHint: "core",
  },

  // --- Outbox / Event Mesh messaging (db_process: business-process-model.cds — CAP transactional outbox) ---
  {
    id: "event-messages", displayName: "EventMessages", tier: "core", category: "outbox", module: "process",
    description: "CAP transactional outbox for generic/system Event Mesh messages (attempts/lastError tracked for retry).",
    cdsEntity: "core.process.business.EventMessages", tableNameCandidates: ["EVENTMESSAGES"],
    timestampColumn: "timestamp", errorColumn: "lastError", correlationKeys: ["target"], sourceHint: "core",
  },
  {
    id: "requestor-messages", displayName: "RequestorMessages", tier: "core", category: "outbox", module: "process",
    description: "CAP transactional outbox for Requestor-persona Event Mesh messages.",
    cdsEntity: "core.process.business.RequestorMessages", tableNameCandidates: ["REQUESTORMESSAGES"],
    timestampColumn: "timestamp", errorColumn: "lastError", correlationKeys: ["target"], sourceHint: "core",
  },
  {
    id: "approver-messages", displayName: "ApproverMessages", tier: "core", category: "outbox", module: "process",
    description: "CAP transactional outbox for Approver-persona Event Mesh messages.",
    cdsEntity: "core.process.business.ApproverMessages", tableNameCandidates: ["APPROVERMESSAGES"],
    timestampColumn: "timestamp", errorColumn: "lastError", correlationKeys: ["target"], sourceHint: "core",
  },
  {
    id: "steward-messages", displayName: "StewardMessages", tier: "core", category: "outbox", module: "process",
    description: "CAP transactional outbox for Steward-persona Event Mesh messages.",
    cdsEntity: "core.process.business.StewardMessages", tableNameCandidates: ["STEWARDMESSAGES"],
    timestampColumn: "timestamp", errorColumn: "lastError", correlationKeys: ["target"], sourceHint: "core",
  },

  // --- On-premise sync (db_process: business-process-model.cds) ---
  {
    id: "system-sync-log", displayName: "SystemSyncLog", tier: "core", category: "onprem-sync", module: "process",
    description: "On-premise <-> cloud sync log, free-text per onPremiseObjectID/objectID.",
    cdsEntity: "core.process.business.SystemSyncLog", tableNameCandidates: ["SYSTEMSYNCLOG"],
    timestampColumn: "createdAt", errorColumn: "log", correlationKeys: ["onPremiseObjectID", "objectID"], sourceHint: "core",
  },
  {
    id: "master-data-sync-log", displayName: "MasterDataSyncLog", tier: "core", category: "onprem-sync", module: "process",
    description: "On-premise <-> cloud master-data sync log (short description per onPremiseObjectID/objectID).",
    cdsEntity: "core.process.business.MasterDataSyncLog", tableNameCandidates: ["MASTERDATASYNCLOG"],
    timestampColumn: "createdAt", correlationKeys: ["onPremiseObjectID", "objectID"], sourceHint: "core",
  },

  // --- Config / admin (db_config: template-configuration-model.cds, common-configuration-model.cds) ---
  {
    id: "template-log", displayName: "TemplateLog", tier: "core", category: "config-admin", module: "config",
    description: "Audit log for Template configuration changes (CREATE/UPDATE/DELETE/ACTIVATE/REASSIGN).",
    cdsEntity: "core.configuration.template.TemplateLog", tableNameCandidates: ["TEMPLATELOG"],
    timestampColumn: "createdAt", statusColumn: "action", correlationKeys: ["tempID"], sourceHint: "core",
  },
  {
    id: "admin-action-log", displayName: "AdminActionLog", tier: "core", category: "config-admin", module: "config",
    description: "Audit log for admin actions on Condition Table / Template configuration screens.",
    cdsEntity: "core.configuration.common.AdminActionLog", tableNameCandidates: ["ADMINACTIONLOG"],
    timestampColumn: "createdAt", statusColumn: "actionType", errorColumn: "actionLog", correlationKeys: ["MDGLogID", "userID"], sourceHint: "core",
  },

  // --- Generic audit trail (db_user: authorization-model.cds) ---
  {
    id: "audit-log", displayName: "AuditLog", tier: "core", category: "generic-audit", module: "user",
    description: "System-wide generic change log (businessTable/businessField/oldValue/newValue), tagged by module via TableMetadata. The closest thing to a single unified audit table in the core product.",
    cdsEntity: "core.auth.AuditLog", tableNameCandidates: ["AUDITLOG"],
    timestampColumn: "actionAt", statusColumn: "action", correlationKeys: ["businessTable", "keys"], sourceHint: "core",
  },
  {
    id: "user-locked-eres-on-req", displayName: "UserLockedERESOnReq", tier: "core", category: "eres-lock", module: "process",
    description: "ERES (electronic signature) failed-login/lockout tracking on Request submission.",
    cdsEntity: "core.process.business.UserLockedERESOnReq", tableNameCandidates: ["USERLOCKEDERESONREQ"],
    statusColumn: "isLockERES", correlationKeys: ["reqID"], sourceHint: "core",
  },
  {
    id: "user-locked-eres-on-act", displayName: "UserLockedERESOnACT", tier: "core", category: "eres-lock", module: "process",
    description: "ERES (electronic signature) failed-login/lockout tracking on Activation.",
    cdsEntity: "core.process.activation.UserLockedERESOnACT", tableNameCandidates: ["USERLOCKEDERESONACT"],
    statusColumn: "isLockERES", correlationKeys: ["activateID"], sourceHint: "core",
  },

  // --- Data quality (db_data_quality: data-quality-process.cds) ---
  {
    id: "evaluation-config-log", displayName: "EvaluationConfigLog", tier: "core", category: "data-quality", module: "data-quality",
    description: "Snapshot of the rule configuration used by one Data Quality evaluation report run.",
    cdsEntity: "dqm.process.EvaluationConfigLog", tableNameCandidates: ["EVALUATIONCONFIGLOG"],
    correlationKeys: ["reportID"], sourceHint: "core",
  },
  {
    id: "evaluation-report", displayName: "EvaluationReport", tier: "core", category: "data-quality", module: "data-quality",
    description: "Data Quality evaluation run header (RUNNING/COMPLETED) with a free-text systemLog.",
    cdsEntity: "dqm.process.EvaluationReport", tableNameCandidates: ["EVALUATIONREPORT"],
    timestampColumn: "createdAt", statusColumn: "status", errorColumn: "systemLog", correlationKeys: ["reportID"], sourceHint: "core",
  },

  // --- Consolidation (db_consolidate: consolidate-admin-model.cds — generic, cross-domain) ---
  {
    id: "md-error-log", displayName: "MDErrorLog", tier: "core", category: "consolidation", module: "consolidate",
    description: "Generic master-data consolidation/merge error log (not domain-specific — see MDConsolidateLog for the per-domain pattern).",
    cdsEntity: "cons.configuration.MDErrorLog", tableNameCandidates: ["MDERRORLOG"],
    statusColumn: "type", errorColumn: "log", correlationKeys: ["requestID"], sourceHint: "core",
  },

  // --- Client-extension only (confirmed present in simplemdg-mckesson, absent from dashboard core) ---
  {
    id: "golden-record-log", displayName: "GoldenRecordLog", tier: "core", category: "consolidation", module: "process",
    description: "Golden-record governance action log (per mdgKey/reqID, with target-system ERPData snapshot and lastErrorLog). mckesson-only — not present in dashboard core's business-process-model.cds.",
    cdsEntity: "core.process.business.GoldenRecordLog", tableNameCandidates: ["GOLDENRECORDLOG"],
    timestampColumn: "createdAt", statusColumn: "status", errorColumn: "lastErrorLog", correlationKeys: ["reqID", "mdgKey"], sourceHint: "client-extension",
  },
  {
    id: "upload-mass-background-log", displayName: "UploadMassBackgroundLog", tier: "core", category: "mass-upload", module: "service-defined",
    description: "Per-batch processing status (PROCESSING/DONE/FAILD) for Excel/SharePoint mass-upload background jobs, keyed by reqID+fileId+batchID+businessTable. Also doubles as a distributed lock (duplicate-key insert = another worker already owns the batch). Defined in the srv_system_process service layer, not a db_* package — mckesson-confirmed, may not exist elsewhere.",
    tableNameCandidates: ["UPLOADMASSBACKGROUNDLOG"],
    statusColumn: "status", correlationKeys: ["reqID", "fileId", "batchID"], sourceHint: "client-extension",
  },
  {
    id: "upload-mass-background-error-log", displayName: "UploadMassBackgroundErrorLog", tier: "core", category: "mass-upload", module: "service-defined",
    description: "Per-batch error detail (errorMessage + Excel range) when a mass-upload batch insert fails after exhausting retries.",
    tableNameCandidates: ["UPLOADMASSBACKGROUNDERRORLOG"],
    errorColumn: "errorMessage", correlationKeys: ["reqID", "fileId", "batchID"], sourceHint: "client-extension",
  },
  {
    id: "cv-all-outbox-messages", displayName: "CV_ALL_OUTBOX_MESSAGES", tier: "core", category: "outbox", module: "process",
    description: "HANA calculation view unioning every outbox table (EventMessages/RequestorMessages/ApproverMessages/StewardMessages) for the mckesson Monitor dashboard. A view, not a base table.",
    tableNameCandidates: ["CV_ALL_OUTBOX_MESSAGES", "ALL_OUTBOX_MESSAGES"],
    timestampColumn: "timestamp", statusColumn: "status", errorColumn: "lasterror", correlationKeys: ["target"], sourceHint: "client-extension",
  },
  {
    id: "cv-long-running-cr", displayName: "CV_LONG_RUNNING_CR", tier: "core", category: "workflow-task", module: "process",
    description: "HANA calculation view surfacing CRs stuck/long-running in the pipeline, joined with elapsed time. mckesson Monitor dashboard only.",
    tableNameCandidates: ["CV_LONG_RUNNING_CR", "LONG_RUNNING_CR"],
    timestampColumn: "created_at", statusColumn: "status", errorColumn: "event_log", correlationKeys: ["request_id", "activate_status"], sourceHint: "client-extension",
  },
  {
    id: "cv-user-usage", displayName: "CV_USER_USAGE", tier: "core", category: "generic-audit", module: "process",
    description: "HANA calculation view aggregating per-client item/payload usage by hour. mckesson Monitor dashboard only — not an error/action log, but useful for capacity auditing.",
    tableNameCandidates: ["CV_USER_USAGE", "USER_USAGE"],
    timestampColumn: "created_datetime", correlationKeys: ["client"], sourceHint: "client-extension",
  },
];

/**
 * Master-data-domain pattern entries. Each repeats once per master-data package under
 * be-group/master-data/* (~70 domains: business-partner, customer, product, gl-account, ...).
 * Only business-partner and document-info-record were read directly to confirm field shapes;
 * `multiTable: true` tells the resolver to report every matching table it finds by raw name,
 * rather than assuming a 1:1 mapping to a specific domain.
 */
const MASTER_DATA_DOMAIN_CATALOG: TAuditLogDefinition[] = [
  {
    id: "md-consolidate-log", displayName: "MDConsolidateLog (per master-data domain)", tier: "master-data-domain", category: "consolidation",
    description: "Per-domain consolidation/merge status log (onPremiseObjectID+requestID+stepID, with errorMessage). Confirmed mckesson-only (db/consolidate-model.cds, byte-identical across all 13 mckesson domains) — not present anywhere in simplemdg-dashboard core, which uses the generic core-level MDErrorLog instead. Which domains exist, and under what table name, varies per environment — resolved at scan time.",
    tableNameCandidates: ["MDCONSOLIDATELOG"],
    statusColumn: "status", errorColumn: "errorMessage", correlationKeys: ["requestID", "onPremiseObjectID"], sourceHint: "client-extension", multiTable: true,
  },
  {
    id: "md-sync-data-batch", displayName: "MDSyncDataBatch (per master-data domain)", tier: "master-data-domain", category: "onprem-sync",
    description: "Per-domain sync batch tracker (requestID+onPremiseObjectID+userID+objectType). Confirmed mckesson-only (same file/domains as MDConsolidateLog) — not present in dashboard core.",
    tableNameCandidates: ["MDSYNCDATABATCH"],
    correlationKeys: ["requestID", "onPremiseObjectID"], sourceHint: "client-extension", multiTable: true,
  },
  {
    id: "md-process-report", displayName: "MDProcessReport (per master-data domain)", tier: "master-data-domain", category: "data-quality",
    description: "Per-domain rule-evaluation report data (reportID+ruleID+dataValue). Confirmed mckesson-only (same file/domains as MDConsolidateLog) — not present in dashboard core.",
    tableNameCandidates: ["MDPROCESSREPORT"],
    correlationKeys: ["reportID", "ruleID"], sourceHint: "client-extension", multiTable: true,
  },
  {
    id: "domain-status-log", displayName: "<Domain>StatusLog (per master-data domain)", tier: "master-data-domain", category: "domain-status-log",
    description: "Mirror of the source SAP system's own native status-log table (e.g. DIRStatusLog for Document Info Record), one per domain that has a status-log concept upstream. Field names (status code column, timestamp split into date+time) are NOT generalized across domains — inspect columns per resolved table in the Detail view rather than relying on a shared statusColumn/timestampColumn here.",
    tableNameCandidates: ["STATUSLOG"],
    correlationKeys: [], sourceHint: "core", multiTable: true,
  },
];

export const AUDIT_LOG_CATALOG: TAuditLogDefinition[] = [...CORE_CATALOG, ...MASTER_DATA_DOMAIN_CATALOG];

export function findAuditLogDefinition(id: string): TAuditLogDefinition | undefined {
  return AUDIT_LOG_CATALOG.find((entry) => entry.id === id);
}

export function listAuditLogCategories(): TAuditLogCategory[] {
  return Array.from(new Set(AUDIT_LOG_CATALOG.map((entry) => entry.category)));
}

/** Every correlation key name known across the catalog, for the Trace pane's key-type picker. */
export function listKnownCorrelationKeys(): string[] {
  return Array.from(new Set(AUDIT_LOG_CATALOG.flatMap((entry) => entry.correlationKeys))).sort();
}

/**
 * The ~70 master-data domain folder slugs under be-group/master-data/* in both
 * simplemdg-dashboard and simplemdg-mckesson, kept here only as documentation of scale
 * (NOT used to predict table names — see the module doc comment above for why).
 */
export const KNOWN_MASTER_DATA_DOMAINS: string[] = [
  "activity-rate", "activity-types", "article", "article-hierarchy", "article-master", "asset-master",
  "assortment", "assortment-module", "bank-master", "batch-master", "bin-master", "bom", "business-partner",
  "catalogue-code-group", "characteristics", "chemical-application-tracking", "class", "consolidation-unit",
  "cost-center", "cost-center-group", "cost-center-hierarchy", "cost-element-group", "customer",
  "customer-hierarchy", "customer-material-info-record", "document-info-record", "engineering-change-master",
  "equipment-master", "fico-set", "fincs-fsi-maprv", "fs-item", "functional-location", "glaccount",
  "hierarchy-article", "hierarchy-customer", "inspection-method", "internal-order", "maintenance-order",
  "maintenance-plan", "master-inspection-characteristic", "material-determination", "measuring-point",
  "merchandise-category", "merchandise-category-hierarchy", "mixed-costing", "order-group",
  "packing-instruction", "parked-document", "partner-app", "pricing-condition", "pricing-condition-record",
  "product", "product-hierarchy", "production-version", "profit-center", "profit-center-hierarchy",
  "purchase-requisition", "purchasing-document", "purchasing-info-record", "quality-info-record", "routing",
  "sales-document", "sampling-procedure", "sampling-scheme", "selected-set-code", "service-master",
  "site-master", "source-list", "staticscal-key-figures", "supplier-hierarchy", "task-list", "vendor",
  "vendor-invoice", "work-breakdown-structure", "work-center",
];
