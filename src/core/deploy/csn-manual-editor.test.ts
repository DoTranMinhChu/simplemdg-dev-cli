import { describe, expect, it } from "vitest";
import {
  buildOnTokensFromJoinPairs,
  cdsTypeToDisplayString,
  createEmptyDraftEntity,
  csnToDraft,
  draftToCsn,
  mintEntityId,
  parseCdsTypeString,
  parseJoinPairsFromOnTokens,
  sanitizeLabelToTechnicalName,
} from "./csn-manual-editor";
import { buildDbModelForNamespace, findRootModel } from "./csn-model-builder";
import type { TManualModelDraft } from "./csn-manual-editor";
import type { TCsnContent } from "./csn-model-types";

describe("parseCdsTypeString / cdsTypeToDisplayString", () => {
  it.each([
    ["String(40)", { type: "cds.String", length: 40 }],
    ["Decimal(15,2)", { type: "cds.Decimal", precision: 15, scale: 2 }],
    ["Boolean", { type: "cds.Boolean" }],
    ["UUID", { type: "cds.UUID" }],
    ["Integer", { type: "cds.Integer" }],
  ])("parses %s", (typeString, expected) => {
    expect(parseCdsTypeString(typeString)).toEqual(expected);
  });

  it.each([
    ["String(40)", { type: "cds.String", length: 40 }],
    ["Decimal(15,2)", { type: "cds.Decimal", precision: 15, scale: 2 }],
    ["Boolean", { type: "cds.Boolean" }],
  ])("round-trips %s back to a display string", (expected, element) => {
    expect(cdsTypeToDisplayString(element)).toBe(expected);
  });

  it("strips a trailing 'default ...' clause rather than surfacing it verbatim", () => {
    expect(cdsTypeToDisplayString({ type: "cds.String default 'CENTRAL'" })).toBe("String");
  });
});

describe("sanitizeLabelToTechnicalName / mintEntityId", () => {
  it("strips spaces/punctuation", () => {
    expect(sanitizeLabelToTechnicalName("Drug Enforcement Record")).toBe("DrugEnforcementRecord");
  });

  it("de-duplicates a colliding technical name with a numeric suffix", () => {
    const existing = new Set(["MDG_DEA.Item", "MDG_DEA.Item2"]);
    expect(mintEntityId("MDG_DEA", "Item", existing)).toBe("MDG_DEA.Item3");
  });

  it("mints a fresh id when there's no collision", () => {
    expect(mintEntityId("MDG_DEA", "Item", new Set())).toBe("MDG_DEA.Item");
  });
});

describe("createEmptyDraftEntity", () => {
  it("always seeds a non-removable objectID key field", () => {
    expect(createEmptyDraftEntity("MDG_DEA.DrugEnforcementRecord", "DrugEnforcementRecord")).toEqual({
      id: "MDG_DEA.DrugEnforcementRecord",
      label: "DrugEnforcementRecord",
      fields: [{ name: "objectID", type: "String(10)", isKey: true }],
      relations: [],
    });
  });
});

describe("buildOnTokensFromJoinPairs / parseJoinPairsFromOnTokens", () => {
  it("round-trips a single join pair", () => {
    const tokens = buildOnTokensFromJoinPairs("to_Child", [{ parentField: "linkKey", childField: "linkKey" }]);
    expect(tokens).toEqual([{ ref: ["to_Child", "linkKey"] }, "=", { ref: ["linkKey"] }]);
    expect(parseJoinPairsFromOnTokens(tokens)).toEqual([{ parentField: "linkKey", childField: "linkKey" }]);
  });

  it("round-trips a real customer's multi-key join (CustomerMaterialInfoRecord -> Item)", () => {
    const joinPairs = [
      { parentField: "customer", childField: "customer" },
      { parentField: "distributionChannel", childField: "distributionChannel" },
      { parentField: "salesOrganization", childField: "salesOrganization" },
    ];
    const tokens = buildOnTokensFromJoinPairs("to_CMII", joinPairs);
    expect(tokens).toEqual([
      { ref: ["to_CMII", "customer"] },
      "=",
      { ref: ["customer"] },
      "and",
      { ref: ["to_CMII", "distributionChannel"] },
      "=",
      { ref: ["distributionChannel"] },
      "and",
      { ref: ["to_CMII", "salesOrganization"] },
      "=",
      { ref: ["salesOrganization"] },
    ]);
    expect(parseJoinPairsFromOnTokens(tokens)).toEqual(joinPairs);
  });

  it("returns [] for missing/empty tokens (the common 'nothing beyond the automatic objectID join' case)", () => {
    expect(parseJoinPairsFromOnTokens(undefined)).toEqual([]);
    expect(parseJoinPairsFromOnTokens([])).toEqual([]);
  });
});

/** Two-level draft: `DrugEnforcementRecord` (root) -> `to_Item` (many) -> `DrugEnforcementRecordItem`. */
function makeDraftFixture(): TManualModelDraft {
  return {
    rootEntityId: "MDG_DEA.DrugEnforcementRecord",
    entities: [
      {
        id: "MDG_DEA.DrugEnforcementRecord",
        label: "DrugEnforcementRecord",
        fields: [
          { name: "objectID", type: "String(10)", isKey: true },
          { name: "registrationNumber", type: "String(20)", i18nLabel: "Registration Number" },
        ],
        relations: [{ name: "to_Item", targetEntityId: "MDG_DEA.DrugEnforcementRecordItem", cardinality: "many", joinPairs: [] }],
      },
      {
        id: "MDG_DEA.DrugEnforcementRecordItem",
        label: "DrugEnforcementRecordItem",
        fields: [
          { name: "objectID", type: "String(10)", isKey: true },
          { name: "itemID", type: "String(10)", isKey: true },
          { name: "drugCode", type: "String(18)" },
        ],
        relations: [],
      },
    ],
  } as TManualModelDraft;
}

/**
 * The real formatter (`@sap/cds-lsp`, see `cds-pretty-print.ts`) column-aligns field/relation
 * declarations with content-dependent padding — collapsing whitespace runs to a single space makes
 * assertions robust to that without weakening what's actually checked (mirrors the same helper in
 * `csn-model-builder.test.ts`).
 */
function normalizeSpaces(text: string): string {
  return text.replace(/[ \t]+/g, " ");
}

function expectNormalizedToContain(content: string, expected: string): void {
  expect(normalizeSpaces(content)).toContain(normalizeSpaces(expected));
}

describe("draftToCsn", () => {
  it("forces the root entity's @sap.label to the object type, ignoring the draft's own label", () => {
    const draft = makeDraftFixture();
    draft.entities[0].label = "SomethingElseEntirely";
    const csn = draftToCsn(draft, "DrugEnforcementRecord");
    expect(csn.definitions["MDG_DEA.DrugEnforcementRecord"]["@sap.label"]).toBe("DrugEnforcementRecord");
  });

  it("renders fields with key/type/label and relations as cds.Composition", () => {
    const csn = draftToCsn(makeDraftFixture(), "DrugEnforcementRecord");
    const root = csn.definitions["MDG_DEA.DrugEnforcementRecord"];
    expect(root.elements!.objectID).toEqual({ type: "cds.String", length: 10, key: true, "@sap.label": undefined });
    expect(root.elements!.registrationNumber).toEqual({ type: "cds.String", length: 20, key: undefined, "@sap.label": "Registration Number" });
    expect(root.elements!.to_Item).toEqual({ type: "cds.Composition", target: "MDG_DEA.DrugEnforcementRecordItem", cardinality: { max: "*" }, on: [] });
  });

  it("feeds straight into buildDbModelForNamespace and produces valid, expected CDS", () => {
    const csn = draftToCsn(makeDraftFixture(), "DrugEnforcementRecord");
    const { rootModelName, shortName } = findRootModel(csn, "DrugEnforcementRecord");
    const result = buildDbModelForNamespace("final", csn, rootModelName, "DrugEnforcementRecord", shortName, "eventmesh");

    expect(result.joinRisks).toEqual([]);
    const rootContent = result.dbActions.find((a) => a.file_path === "db/final/1st-model.cds")?.content ?? "";
    expect(rootContent).toContain("entity DrugEnforcementRecord : business_1st_level_entity {");
    expectNormalizedToContain(rootContent, "to_Item : Composition of many DrugEnforcementRecordItem");
    // Exactly one objectID join clause — not duplicated by the (excluded, see csn-model-builder.ts's
    // `identityKeys` filter) key-intersection fallback just because the child also declares objectID.
    expect(rootContent.match(/to_Item\.objectID = \$self\.objectID/g)).toHaveLength(1);

    const childContent = result.dbActions.find((a) => a.file_path === "db/final/2nd-model.cds")?.content ?? "";
    expect(childContent).toContain("entity DrugEnforcementRecordItem : business_child_level_entity {");
  });
});

describe("csnToDraft", () => {
  it("recovers a draft from a real multi-key CSN fixture, including its join pairs", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_CMI.CustomerMaterialInfoRecord": {
          "@sap.label": "CustomerMaterialInfoRecord",
          elements: {
            salesOrganization: { type: "cds.String", length: 4, key: true },
            distributionChannel: { type: "cds.String", length: 2, key: true },
            customer: { type: "cds.String", length: 10, key: true },
            to_CMII: {
              type: "cds.Composition",
              target: "MDG_CMI.CustomerMaterialInfoRecordItem",
              cardinality: { max: "*" },
              on: [
                { ref: ["to_CMII", "customer"] },
                "=",
                { ref: ["customer"] },
                "and",
                { ref: ["to_CMII", "distributionChannel"] },
                "=",
                { ref: ["distributionChannel"] },
                "and",
                { ref: ["to_CMII", "salesOrganization"] },
                "=",
                { ref: ["salesOrganization"] },
              ],
            },
          },
        },
        "MDG_CMI.CustomerMaterialInfoRecordItem": {
          "@sap.label": "CustomerMaterialInfoRecordItem",
          elements: { material: { type: "cds.String", length: 40 } },
        },
      },
    };

    const draft = csnToDraft(csn, "MDG_CMI.CustomerMaterialInfoRecord");
    expect(draft.rootEntityId).toBe("MDG_CMI.CustomerMaterialInfoRecord");
    expect(draft.entities.map((e) => e.id)).toEqual(["MDG_CMI.CustomerMaterialInfoRecord", "MDG_CMI.CustomerMaterialInfoRecordItem"]);

    const root = draft.entities[0];
    expect(root.fields.map((f) => f.name)).toEqual(["salesOrganization", "distributionChannel", "customer"]);
    expect(root.relations).toEqual([
      {
        name: "to_CMII",
        targetEntityId: "MDG_CMI.CustomerMaterialInfoRecordItem",
        cardinality: "many",
        joinPairs: [
          { parentField: "customer", childField: "customer" },
          { parentField: "distributionChannel", childField: "distributionChannel" },
          { parentField: "salesOrganization", childField: "salesOrganization" },
        ],
      },
    ]);
  });

  it("does not recurse forever on a composition cycle", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.A": { "@sap.label": "A", elements: { objectID: { type: "cds.String", length: 10, key: true }, to_B: { type: "cds.Composition", target: "MDG_TST.B", cardinality: { max: "*" }, on: [] } } },
        "MDG_TST.B": { "@sap.label": "B", elements: { objectID: { type: "cds.String", length: 10, key: true }, to_A: { type: "cds.Composition", target: "MDG_TST.A", cardinality: { max: "*" }, on: [] } } },
      },
    };

    const draft = csnToDraft(csn, "MDG_TST.A");
    expect(draft.entities.map((e) => e.id)).toEqual(["MDG_TST.A", "MDG_TST.B"]);
  });

  it("round-trips draftToCsn(csnToDraft(x)) back through buildDbModelForNamespace unchanged", () => {
    const original = draftToCsn(makeDraftFixture(), "DrugEnforcementRecord");
    const roundTripped = draftToCsn(csnToDraft(original, "MDG_DEA.DrugEnforcementRecord"), "DrugEnforcementRecord");
    expect(roundTripped).toEqual(original);
  });
});
