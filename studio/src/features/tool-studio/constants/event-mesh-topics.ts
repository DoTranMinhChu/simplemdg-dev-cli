import type { TSearchableSelectOption } from "../../../components/common/SearchableSelect";

/**
 * Real event/topic names this product actually emits — mirrors `TOPIC_ENUM` in the backend's
 * `simplemdg_srv_process_event/srv/helpers/event-helper.ts` (a separate repo, not this one) so the
 * Send Event tab can offer a curated select instead of forcing free-text typing for the common
 * case. Grouping matches that enum's own section comments. Kept as plain data, not imported live,
 * since the backend lives in an entirely different multi-repo codebase — re-sync by hand if that
 * enum ever changes.
 */
const EVENT_MESH_TOPIC_GROUPS: Record<string, string[]> = {
  Validate: ["ValidateTemplatePayloadData", "StartTestrun", "StartDuplicationCheck", "StartAuthorizationCheck", "ValidateParallelChange", "StartDataQualityCheck", "SubmitConcurrencyFailed"],
  Submit: ["SubmitMassConcurrencyFailed", "CompleteSubmitMass", "CompleteSubmitItemValidation", "CompleteSubmitValidation", "CancelMassSubmit"],
  Approve: ["ApproveConcurrencyFailed", "CompleteApproveValidation", "CompleteApproveItemValidation", "ApproveMassConcurrencyFailed", "CompleteApproveMass", "CancelMassApprove"],
  "Approve - Reject": ["CompleteRejectValidation", "CompleteRejectItemValidation", "CompleteRejectMass", "CancelMassReject"],
  Activate: [
    "StartActivate",
    "ActivateConcurrencyFailed",
    "StartScheduleActivate",
    "ActivateFail",
    "ActivateItemFail",
    "StartScheduleActivateItemRequest",
    "InsertFinal",
    "RetryActivateRequest",
    "ActivateSuccess",
    "ActivateItemSuccess",
    "ActivateInComplete",
    "ActivateItemInComplete",
    "ActivateMassConcurrencyFailed",
    "UpdateStatusActivateRequest",
    "SAPActivated",
    "CancelMassActivate",
  ],
  "Activate Reject": ["CompleteActivateRejectMass"],
  NPI: ["NPIActivateRequestSingle", "NPIActivateRequestMass", "NPIActivateStepComplete", "NPIActivateDone", "NPISubmitProjectStep"],
  Listen: [
    "SAPTestRunPassed",
    "SAPTestRunFailed",
    "CRTestRunFailed",
    "SAPActivateFailed",
    "CRValidateTemplatePayloadDataPassed",
    "CRValidateTemplatePayloadDataFailed",
    "CRValidateParallelChangeSuccess",
    "CRValidateParallelChangeFailed",
    "CRDuplicationCheckSuccess",
    "CRDuplicationCheckFailed",
    "AuthorizationCheckSuccess",
    "AuthorizationCheckFailed",
    "DataQualityCheckFailed",
    "CompleteSubmitItem",
    "CompleteApproveItem",
    "CompleteActivateItem",
    "CompleteRejectActivateItem",
    "CompleteRejectItem",
  ],
};

export const EVENT_MESH_TOPIC_OPTIONS: TSearchableSelectOption[] = Object.entries(EVENT_MESH_TOPIC_GROUPS).flatMap(([group, topics]) => topics.map((topic) => ({ value: topic, label: topic, meta: group })));

// Sample values below are illustrative placeholders in the real formats this product actually uses
// (confirmed against production Event Mesh logs and backend test fixtures in the sibling
// `simplemdg-mckesson`/`simplemdg-dashboard` repos) — not empty strings — so a freshly-picked topic
// is send-ready rather than a wall of `""` the user has to fill in by hand.
const SAMPLE_REQ_ID = "CR0000000123";
const SAMPLE_MDG_LOG_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const SAMPLE_TASK_ID = "5ec1ee23-2cc2-40d1-9b00-3c693172ff00";
const SAMPLE_MESSAGE_CORE = "messaging_core_1";
const SAMPLE_MESSAGE_OBJECT_TYPE = "messaging_object_type_1";

/** Full 7-field shape confirmed against `EventSubmittedHandler.ts`/`EventApprovedHandler.ts`'s fan-out — used by the Validate/Start*Check/Activate-start family. `stepID` values are the real `PROCESS_ENUM`/`ACTIVATE_PROCESS_ENUM` strings, not numeric indexes. */
function buildValidateStepTemplate(stepID: string, type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reqID: SAMPLE_REQ_ID,
    mdgLogID: SAMPLE_MDG_LOG_ID,
    stepID,
    type,
    isMass: false,
    messageCore: SAMPLE_MESSAGE_CORE,
    messageObjectType: SAMPLE_MESSAGE_OBJECT_TYPE,
    ...extra,
  };
}

/** Minimal 4-field completion/gate shape confirmed against `EventLocalSubmitHandler.ts`'s `TCompleteSubmit*` types — used by the Complete*Validation/Mass family. */
function buildCompleteTemplate(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageCore: SAMPLE_MESSAGE_CORE,
    messageObjectType: SAMPLE_MESSAGE_OBJECT_TYPE,
    reqID: SAMPLE_REQ_ID,
    mdgLogID: SAMPLE_MDG_LOG_ID,
    ...extra,
  };
}

/** 3-field shape confirmed live for `CancelMassSubmit` — no `mdgLogID`/`type` on any Cancel* topic. */
function buildCancelMassTemplate(): Record<string, unknown> {
  return {
    messageCore: SAMPLE_MESSAGE_CORE,
    messageObjectType: SAMPLE_MESSAGE_OBJECT_TYPE,
    reqID: SAMPLE_REQ_ID,
  };
}

/** Validator-answer shape used by the `CR*Success/Failed`/`AuthorizationCheck*`/`DataQualityCheckFailed` "Listen" topics — Failed variants carry a `log` describing what failed. */
function buildCrResultTemplate(type: string, failed: boolean): Record<string, unknown> {
  return {
    reqID: SAMPLE_REQ_ID,
    itemID: "1",
    mdgLogID: SAMPLE_MDG_LOG_ID,
    type,
    messageCore: SAMPLE_MESSAGE_CORE,
    messageObjectType: SAMPLE_MESSAGE_OBJECT_TYPE,
    ...(failed ? { log: "This object is locked for the following fields: Net Weight" } : {}),
  };
}

/** `SAPTestRunPassed`/`SAPTestRunFailed` use a completely different snake_case shape (confirmed against `event-helper.ts`), not the reqID/mdgLogID convention every other topic here uses. */
function buildSapListenTemplate(failed: boolean): Record<string, unknown> {
  return {
    messaging_core: SAMPLE_MESSAGE_CORE,
    messaging_object_type: SAMPLE_MESSAGE_OBJECT_TYPE,
    cr_number: SAMPLE_REQ_ID,
    cr_item: 1,
    mdglogid: SAMPLE_MDG_LOG_ID,
    message_log: failed ? "Sample failure detail from SAP test run." : "",
    ...(failed ? { warning_message_log: "" } : {}),
  };
}

/**
 * Per-topic templates for every topic we have real evidence for (production Event Mesh logs +
 * backend test fixtures/handler code in the sibling repos) — everything else falls back to
 * `DEFAULT_EVENT_PAYLOAD_TEMPLATE`. Grouped to match `EVENT_MESH_TOPIC_GROUPS` above.
 */
export const EVENT_PAYLOAD_TEMPLATES: Record<string, Record<string, unknown>> = {
  // Validate — shape + stepID confirmed against the Submit/Approve fan-out handlers.
  ValidateTemplatePayloadData: buildValidateStepTemplate("validateTemplatePayloadData", "Submit"),
  StartTestrun: buildValidateStepTemplate("validateTestrun", "Submit", { itemID: "1", skipWarning: false }),
  StartDuplicationCheck: buildValidateStepTemplate("validateDuplication", "Submit"),
  StartAuthorizationCheck: buildValidateStepTemplate("validateAuthorization", "Submit", { userID: "USER0001", scopeID: "SCOPE0001", taskID: SAMPLE_TASK_ID }),
  ValidateParallelChange: buildValidateStepTemplate("validateParallelChange", "Submit", { itemID: "1" }),
  StartDataQualityCheck: buildValidateStepTemplate("validateDataQuality", "Submit", { itemID: "1", taskID: SAMPLE_TASK_ID }),
  SubmitConcurrencyFailed: buildCrResultTemplate("Submit", true),

  // Submit — 4-field completion/gate shape.
  SubmitMassConcurrencyFailed: buildCrResultTemplate("Submit", true),
  CompleteSubmitMass: buildCompleteTemplate({ itemCount: 1, projectStepID: "1" }),
  CompleteSubmitItemValidation: buildCompleteTemplate({ itemID: "1" }),
  CompleteSubmitValidation: buildCompleteTemplate(),
  CancelMassSubmit: buildCancelMassTemplate(),

  // Approve — same shapes as Submit, mirrored.
  ApproveConcurrencyFailed: buildCrResultTemplate("Approve", true),
  CompleteApproveValidation: buildCompleteTemplate(),
  CompleteApproveItemValidation: buildCompleteTemplate({ itemID: "1" }),
  ApproveMassConcurrencyFailed: buildCrResultTemplate("Approve", true),
  CompleteApproveMass: buildCompleteTemplate({ itemCount: 1, projectStepID: "1" }),
  CancelMassApprove: buildCancelMassTemplate(),

  // Approve - Reject.
  CompleteRejectValidation: buildCompleteTemplate(),
  CompleteRejectItemValidation: buildCompleteTemplate({ itemID: "1" }),
  CompleteRejectMass: buildCompleteTemplate({ itemCount: 1, projectStepID: "1" }),
  CancelMassReject: buildCancelMassTemplate(),

  // Activate — stepIDs confirmed against ACTIVATE_PROCESS_ENUM; unmapped Activate topics fall back to the default.
  StartActivate: buildValidateStepTemplate("startActivate", "Activate"),
  StartScheduleActivate: buildValidateStepTemplate("scheduledActivate", "Activate"),
  InsertFinal: buildValidateStepTemplate("insertFinal", "Activate"),
  CancelMassActivate: buildCancelMassTemplate(),

  // Activate Reject.
  CompleteActivateRejectMass: buildCompleteTemplate({ itemCount: 1, projectStepID: "1" }),

  // Listen — CR*/AuthorizationCheck/DataQuality validator-answer topics.
  CRTestRunFailed: buildCrResultTemplate("Submit", true),
  CRValidateTemplatePayloadDataPassed: buildCrResultTemplate("Submit", false),
  CRValidateTemplatePayloadDataFailed: buildCrResultTemplate("Submit", true),
  CRValidateParallelChangeSuccess: buildCrResultTemplate("Submit", false),
  CRValidateParallelChangeFailed: buildCrResultTemplate("Submit", true),
  CRDuplicationCheckSuccess: buildCrResultTemplate("Submit", false),
  CRDuplicationCheckFailed: buildCrResultTemplate("Submit", true),
  AuthorizationCheckSuccess: buildCrResultTemplate("Submit", false),
  AuthorizationCheckFailed: buildCrResultTemplate("Submit", true),
  DataQualityCheckFailed: buildCrResultTemplate("Submit", true),

  // SAP listen — distinct snake_case shape, not the reqID/mdgLogID convention.
  SAPTestRunPassed: buildSapListenTemplate(false),
  SAPTestRunFailed: buildSapListenTemplate(true),

  // --- Everything below is BEST-EFFORT, inferred by family/naming pattern from the confirmed
  // shapes above — the sibling repos had no direct evidence (no test fixture, no production log
  // line) for these specific topics. Still real-format sample values, not blank strings, but treat
  // the exact field set with more skepticism than everything above this line. ---

  // Activate — ConcurrencyFailed/Fail/InComplete siblings of the already-confirmed Submit/Approve
  // *ConcurrencyFailed shape; Success mirrors the CR*Success result shape.
  ActivateConcurrencyFailed: buildCrResultTemplate("Activate", true),
  ActivateMassConcurrencyFailed: buildCrResultTemplate("Activate", true),
  ActivateFail: buildCrResultTemplate("Activate", true),
  ActivateItemFail: buildCrResultTemplate("Activate", true),
  ActivateInComplete: buildCrResultTemplate("Activate", true),
  ActivateItemInComplete: buildCrResultTemplate("Activate", true),
  ActivateSuccess: buildCrResultTemplate("Activate", false),
  ActivateItemSuccess: buildCrResultTemplate("Activate", false),
  // stepID left blank — no ACTIVATE_PROCESS_ENUM value confirmed for these three specifically.
  RetryActivateRequest: buildValidateStepTemplate("", "Activate"),
  StartScheduleActivateItemRequest: buildValidateStepTemplate("", "Activate", { itemID: "1" }),
  UpdateStatusActivateRequest: buildValidateStepTemplate("", "Activate"),
  // Same "SAP calls back" naming convention as the confirmed SAPTestRunPassed/Failed pair.
  SAPActivated: buildSapListenTemplate(false),

  // Listen — same 4-field gate shape as the confirmed CompleteSubmitItemValidation/
  // CompleteApproveItemValidation, just without the "Validation" suffix on the topic name.
  CompleteSubmitItem: buildCompleteTemplate({ itemID: "1" }),
  CompleteApproveItem: buildCompleteTemplate({ itemID: "1" }),
  CompleteActivateItem: buildCompleteTemplate({ itemID: "1" }),
  CompleteRejectActivateItem: buildCompleteTemplate({ itemID: "1" }),
  CompleteRejectItem: buildCompleteTemplate({ itemID: "1" }),
  SAPActivateFailed: buildSapListenTemplate(true),

  // NPI — a genuinely separate feature area with ZERO confirmed evidence anywhere in either sibling
  // repo (no NPI-specific message type, test, or log line found). Shape guessed purely from the
  // topic's own name against the two families every other topic in this file uses; treat as a
  // starting point to edit, not a verified contract.
  NPIActivateRequestSingle: buildValidateStepTemplate("", "Activate", { isMass: false }),
  NPIActivateRequestMass: buildValidateStepTemplate("", "Activate", { isMass: true }),
  NPIActivateStepComplete: buildCompleteTemplate({ projectStepID: "1" }),
  NPIActivateDone: buildCompleteTemplate(),
  NPISubmitProjectStep: buildValidateStepTemplate("", "Submit", { projectStepID: "1" }),
};

/** Generic fallback for topics we have no confirmed shape for — still real-format sample values, not blank strings, except `stepID` which genuinely varies per flow and has no safe generic guess. */
export const DEFAULT_EVENT_PAYLOAD_TEMPLATE: Record<string, unknown> = {
  reqID: SAMPLE_REQ_ID,
  mdgLogID: SAMPLE_MDG_LOG_ID,
  stepID: "",
  type: "Submit",
  isMass: false,
  messageCore: SAMPLE_MESSAGE_CORE,
  messageObjectType: SAMPLE_MESSAGE_OBJECT_TYPE,
};

export function getEventPayloadTemplate(topic: string): Record<string, unknown> {
  return EVENT_PAYLOAD_TEMPLATES[topic] ?? DEFAULT_EVENT_PAYLOAD_TEMPLATE;
}
