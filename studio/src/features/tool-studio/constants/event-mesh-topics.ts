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

/** Two shapes confirmed against the real consumer/producer code; everything else falls back to `DEFAULT_EVENT_PAYLOAD_TEMPLATE`. */
export const EVENT_PAYLOAD_TEMPLATES: Record<string, Record<string, unknown>> = {
  ValidateParallelChange: { reqID: "", itemID: "", mdgLogID: "", stepID: "", type: "Submit", isMass: false, messageCore: "", messageObjectType: "" },
  StartTestrun: { reqID: "", type: "Submit", mdgLogID: "", itemID: "", stepID: "", messageCore: "", messageObjectType: "", skipWarning: false },
};

export const DEFAULT_EVENT_PAYLOAD_TEMPLATE: Record<string, unknown> = { reqID: "", mdgLogID: "", stepID: "", type: "Submit", isMass: false, messageCore: "", messageObjectType: "" };

export function getEventPayloadTemplate(topic: string): Record<string, unknown> {
  return EVENT_PAYLOAD_TEMPLATES[topic] ?? DEFAULT_EVENT_PAYLOAD_TEMPLATE;
}
