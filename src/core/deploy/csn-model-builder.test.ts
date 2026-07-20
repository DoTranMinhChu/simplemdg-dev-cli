import { describe, expect, it } from "vitest";
import { buildDbModelForNamespace, detectRenamedEntityLabels, findRootModel } from "./csn-model-builder";
import type { TCsnContent } from "./csn-model-types";

/** Hand-built 2-level composition tree: `TestObject` (root) → `to_Child` (many) → `ChildObject`. */
function makeCsnFixture(): TCsnContent {
  return {
    definitions: {
      "MDG_TST.TestObject": {
        "@sap.label": "TestObject",
        elements: {
          objectID: { type: "cds.String", length: 10, key: true },
          name: { type: "cds.String", length: 40 },
          isActive: { type: "cds.Boolean" },
          to_Child: {
            type: "cds.Composition",
            target: "MDG_TST.ChildObject",
            cardinality: { max: "*" },
            on: [{ ref: ["to_Child", "linkKey"] }, "=", { ref: ["linkKey"] }],
          },
        },
      },
      "MDG_TST.ChildObject": {
        "@sap.label": "ChildObject",
        elements: {
          objectID: { type: "cds.String", length: 10, key: true },
          childID: { type: "cds.String", length: 10, key: true },
          linkKey: { type: "cds.String", length: 10 },
          description: { type: "cds.String", length: 80 },
        },
      },
    },
  };
}

function findAction(actions: { file_path: string; content?: string }[], filePath: string): string {
  const action = actions.find((item) => item.file_path === filePath);
  if (!action?.content) throw new Error(`Expected a "${filePath}" action, got: ${actions.map((item) => item.file_path).join(", ")}`);
  return action.content;
}

/**
 * The real formatter (`@sap/cds-lsp`, see `cds-pretty-print.ts`) column-aligns field/relation
 * declarations by padding with a run of spaces sized to the widest identifier in the block — exact
 * padding is content-dependent and not something tests should hardcode. Collapsing whitespace runs
 * to a single space (on both sides) makes assertions robust to that dynamic padding while still
 * verifying real content and line structure (newlines are preserved, not collapsed).
 */
function normalizeSpaces(text: string): string {
  return text.replace(/[ \t]+/g, " ");
}

function expectNormalizedToContain(content: string, expected: string): void {
  expect(normalizeSpaces(content)).toContain(normalizeSpaces(expected));
}

describe("findRootModel", () => {
  it("derives the short code from the CSN's own root entity instead of a configured short name", () => {
    const result = findRootModel(makeCsnFixture(), "TestObject");
    expect(result).toEqual({ rootModelName: "MDG_TST.TestObject", shortName: "TST" });
  });

  it("throws when no definition matches the requested object type", () => {
    expect(() => findRootModel(makeCsnFixture(), "SomethingElse")).toThrow(/Cannot find a root entity/);
  });

  it("throws (rather than silently picking the first one) when two different definitions share the root's @sap.label", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": { "@sap.label": "TestObject", elements: { objectID: { type: "cds.String", length: 10, key: true } } },
        "MDG_TST2.TestObject": { "@sap.label": "TestObject", elements: { objectID: { type: "cds.String", length: 10, key: true } } },
      },
    };
    expect(() => findRootModel(csn, "TestObject")).toThrow(/Found 2 definitions.*MDG_TST\.TestObject.*MDG_TST2\.TestObject/s);
  });
});

describe("buildDbModelForNamespace — eventmesh mode", () => {
  const csn = makeCsnFixture();
  const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");

  it("produces final + staging files for every level, no multi-ERP srv actions", () => {
    expect(result.dbActions.map((a) => a.file_path)).toEqual(["db/final/1st-model.cds", "db/staging/1st-model.cds", "db/final/2nd-model.cds", "db/staging/2nd-model.cds"]);
    expect(result.srvActions).toEqual([]);
  });

  it("renders the root entity with correct namespace, base aspect, fields, and relation", () => {
    const content = findAction(result.dbActions, "db/final/1st-model.cds");
    expect(content).toContain("namespace tst.model.final;");
    expect(content).toContain("entity TestObject : business_1st_level_entity {");
    expectNormalizedToContain(content, "key objectID : String(10) @(title : '{i18n>TestObject.objectID}');");
    expectNormalizedToContain(content, "name : String(40) @(title : '{i18n>TestObject.name}');");
    // eventmesh mode: Boolean has no `default false` (only non-eventmesh-family modes get that).
    expectNormalizedToContain(content, "isActive : Boolean @(title : '{i18n>TestObject.isActive}');");
    expect(content).toContain("to_Child : Composition of many ChildObject");
    // Namespace identity join (objectID, from DB_NAMESPACE_CONFIG.final) + the CSN's own on-condition
    // (linkKey), one clause per line (matches legacy's line structure, avoids diff noise from a flat join).
    expectNormalizedToContain(content, "on to_Child.objectID = $self.objectID\n and to_Child.linkKey = $self.linkKey");
    expectNormalizedToContain(content, "using {tst.model.final.ChildObject} from './2nd-model';");
  });

  it("renders the staging entity re-scoping the relation with an inserted taskID join, no restated fields", () => {
    const content = findAction(result.dbActions, "db/staging/1st-model.cds");
    expect(content).toContain("namespace tst.model.staging;");
    expect(content).toContain("entity TestObject : final_TestObject, business_entity_staging {");
    expectNormalizedToContain(content, "on to_Child.objectID = $self.objectID\n and to_Child.taskID = $self.taskID\n and to_Child.linkKey = $self.linkKey");
    // Scalar fields are inherited from `final_TestObject`, never restated in staging.
    expect(content).not.toContain("name : String(40)");
  });

  it("renders the leaf child entity at the next level", () => {
    const content = findAction(result.dbActions, "db/final/2nd-model.cds");
    expect(content).toContain("entity ChildObject : business_child_level_entity {");
    expectNormalizedToContain(content, "key childID : String(10)");
    expectNormalizedToContain(content, "description : String(80)");
  });
});

describe("buildDbModelForNamespace — matches a real customer's multi-key composition (CustomerMaterialInfoRecord)", () => {
  // Reproduces the exact shape of a live `simplemdg_db_cmi` composition: the CSN's own on-condition
  // carries 3 "and"-joined business-key segments (not just 1), on top of the namespace's own
  // `objectID` identity join — verified against the real generated `db/final/1st-model.cds`:
  //   to_CMII on to_CMII.objectID = $self.objectID and to_CMII.customer = $self.customer
  //   and to_CMII.distributionChannel = $self.distributionChannel and to_CMII.salesOrganization = $self.salesOrganization;
  it("joins every CSN-provided segment after the namespace identity join, in order", () => {
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

    const result = buildDbModelForNamespace("final", csn, "MDG_CMI.CustomerMaterialInfoRecord", "CustomerMaterialInfoRecord", "CMI", "eventmesh");
    const content = findAction(result.dbActions, "db/final/1st-model.cds");
    expectNormalizedToContain(
      content,
      [
        "on to_CMII.objectID = $self.objectID",
        "and to_CMII.customer = $self.customer",
        "and to_CMII.distributionChannel = $self.distributionChannel",
        "and to_CMII.salesOrganization = $self.salesOrganization",
      ].join("\n "),
    );
  });
});

describe("buildDbModelForNamespace — multiple_erp mode", () => {
  const csn = makeCsnFixture();
  const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "multiple_erp");

  it("generates a Mapping entity + to_<Table>Mapping composition per business table with keys", () => {
    const content = findAction(result.dbActions, "db/final/1st-model.cds");
    expect(content).toContain("entity TestObjectMapping : mapping_entity {");
    expectNormalizedToContain(content, "key ERPSystem : String;");
    // multiple_erp mode drops the length suffix entirely (`buildTypeByFieldConfig`'s bare-type convention).
    expectNormalizedToContain(content, "key objectID : String @(title : '{i18n>TestObject.objectID}');");
    expectNormalizedToContain(content, "ERPname : String @(title : '{i18n>TestObject.name}');");
    expect(content).toContain("to_TestObjectMapping : Composition of many TestObjectMapping");
    expectNormalizedToContain(content, "on to_TestObjectMapping.objectID = $self.objectID\n and to_TestObjectMapping.objectID = $self.objectID;");
  });

  it("generates srv/master-data-service.cds exposing every business + Mapping table across all levels", () => {
    expect(result.srvActions).toHaveLength(1);
    const content = result.srvActions[0].content ?? "";
    expect(content).toContain("namespace tst.service.masterdata;");
    expect(content).toContain("using tst.model.final as tst_1st from '@simplemdg/db_tst/db/final/1st-model';");
    expect(content).toContain("using tst.model.final as tst_2nd from '@simplemdg/db_tst/db/final/2nd-model';");
    // The real formatter reflows the `@(requires: [...]) @(path: ...)` annotation pair across
    // multiple lines — check its pieces rather than one exact joined string.
    expectNormalizedToContain(content, "service TestObjectMasterDataService @(requires : [");
    expect(content).toContain("'MD_TestObject',");
    expect(content).toContain("'system-user'");
    expectNormalizedToContain(content, "@(path : '/TestObjectMasterDataService') {");
    expectNormalizedToContain(content, "entity TestObject as projection on tst_1st.TestObject;");
    expectNormalizedToContain(content, "entity ChildObjectMapping as projection on tst_2nd.ChildObjectMapping;");
  });
});

describe("buildDbModelForNamespace — validation (fail-fast)", () => {
  it("throws immediately when the root entity's @sap.label doesn't match the requested object type", () => {
    const csn = makeCsnFixture();
    expect(() => buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "SomethingElse", "TST", "eventmesh")).toThrow(/@sap\.label !== SomethingElse/);
  });

  it("throws immediately when the root model is missing entirely", () => {
    const csn = makeCsnFixture();
    expect(() => buildDbModelForNamespace("final", csn, "MDG_TST.DoesNotExist", "TestObject", "TST", "eventmesh")).toThrow(/Missing table/);
  });

  it("aggregates a missing @sap.label on a non-root entity into one error and builds no CommitActions", () => {
    const csn = makeCsnFixture();
    delete csn.definitions["MDG_TST.ChildObject"]["@sap.label"];

    let thrown: unknown;
    try {
      buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("Missing @sap.label");
    expect((thrown as Error).message).toContain("MDG_TST.ChildObject");
  });
});

describe("buildDbModelForNamespace — composition with no `on` tokens (modern cds-dk EDMX import)", () => {
  // Reproduces a real gap found in a live customer upload: `@sap/cds-dk@9.9.2`'s EDMX importer
  // leaves compositions with no `<ReferentialConstraint>` as `{ ..., keys: [] }` — no `on` array at
  // all — even for the ordinary "child repeats parent's business keys" MDG pattern. Also reproduces
  // the real customer's exact shape where the shared field is NOT itself a key on the child
  // (`AdditionalCMIRItem.customer` is a plain field there, only `alternativeMatByCustomer` is a key).
  it("falls back to matching the parent's key fields against ANY field on the child, not just the child's own keys", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": {
          "@sap.label": "TestObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            customer: { type: "cds.String", length: 10, key: true },
            to_Extra: { type: "cds.Composition", target: "MDG_TST.ExtraObject", cardinality: { max: "*" }, keys: [] },
          },
        },
        "MDG_TST.ExtraObject": {
          "@sap.label": "ExtraObject",
          elements: {
            noteID: { type: "cds.String", length: 10, key: true },
            // Shares the parent's `customer` field NAME, but does not mark it as a key here.
            customer: { type: "cds.String", length: 10 },
          },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    const content = result.dbActions.find((a) => a.file_path === "db/final/1st-model.cds")?.content ?? "";
    expect(content).toContain("to_Extra : Composition of many ExtraObject");
    expectNormalizedToContain(content, "on to_Extra.objectID = $self.objectID\n and to_Extra.customer = $self.customer");
  });

  it("still skips the relation when there's truly no name overlap at all (rather than emitting a join-less composition)", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": {
          "@sap.label": "TestObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            to_Unrelated: { type: "cds.Composition", target: "MDG_TST.UnrelatedObject", cardinality: { max: "*" }, keys: [] },
          },
        },
        "MDG_TST.UnrelatedObject": {
          "@sap.label": "UnrelatedObject",
          elements: { somethingElse: { type: "cds.String", length: 10, key: true } },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    const content = result.dbActions.find((a) => a.file_path === "db/final/1st-model.cds")?.content ?? "";
    expect(content).not.toContain("to_Unrelated");
    expect(content).not.toContain("UnrelatedObject");
  });
});

describe("buildDbModelForNamespace — joinRisks (early warning for no-ReferentialConstraint compositions)", () => {
  it("reports a critical finding when a parent key has no match by name or label on the child", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": {
          "@sap.label": "TestObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            to_Unrelated: { type: "cds.Composition", target: "MDG_TST.UnrelatedObject", cardinality: { max: "*" }, keys: [] },
          },
        },
        "MDG_TST.UnrelatedObject": {
          "@sap.label": "UnrelatedObject",
          elements: { somethingElse: { type: "cds.String", length: 10, key: true } },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    expect(result.joinRisks).toEqual([
      expect.objectContaining({ severity: "critical", outcome: "dropped-no-suggestion", parentKeyField: "objectID", targetBusinessTable: "UnrelatedObject" }),
    ]);
  });

  it("reports a high-severity finding with a suggested field when the child has a differently-named field sharing the same @sap.label", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": {
          "@sap.label": "TestObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            objectClass: { type: "cds.String", length: 1, key: true, "@sap.label": "Ind.: Object/Class" },
            to_Detail: { type: "cds.Composition", target: "MDG_TST.DetailObject", cardinality: { max: "*" }, keys: [] },
          },
        },
        "MDG_TST.DetailObject": {
          "@sap.label": "DetailObject",
          elements: {
            objectID: { type: "cds.String", length: 10 },
            indicatorObj: { type: "cds.String", length: 1, "@sap.label": "Ind.: Object/Class" },
          },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    expect(result.joinRisks).toContainEqual(
      expect.objectContaining({
        severity: "high",
        outcome: "dropped-with-label-suggestion",
        parentKeyField: "objectClass",
        targetBusinessTable: "DetailObject",
        message: expect.stringContaining("indicatorObj"),
      }),
    );
  });

  it("reports a medium-severity finding when a same-named field exists on both sides but its @sap.label differs", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": {
          "@sap.label": "TestObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            counter: { type: "cds.String", length: 4, key: true, "@sap.label": "Int. counter" },
            to_Detail: { type: "cds.Composition", target: "MDG_TST.DetailObject", cardinality: { max: "*" }, keys: [] },
          },
        },
        "MDG_TST.DetailObject": {
          "@sap.label": "DetailObject",
          elements: {
            objectID: { type: "cds.String", length: 10 },
            counter: { type: "cds.String", length: 3, "@sap.label": "Characteristic value counter" },
          },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    expect(result.joinRisks).toContainEqual(
      expect.objectContaining({ severity: "medium", outcome: "label-mismatch", parentKeyField: "counter", targetBusinessTable: "DetailObject" }),
    );
  });

  it("reports an info finding (not a blocker) when KEY_INTERSECTION_FIELD_OVERRIDES already resolves the mismatch", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_CMI.CMIRItemClassif": {
          "@sap.label": "CMIRItemClassif",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            objectClass: { type: "cds.String", length: 1, key: true },
            counter: { type: "cds.String", length: 4, key: true },
            to_CMICharac: { type: "cds.Composition", target: "MDG_CMI.Characteristics", cardinality: { max: "*" }, keys: [] },
          },
        },
        "MDG_CMI.Characteristics": {
          "@sap.label": "Characteristics",
          elements: {
            objectID: { type: "cds.String", length: 10 },
            indicatorObj: { type: "cds.String", length: 1 },
            intCounter: { type: "cds.String", length: 4 },
          },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_CMI.CMIRItemClassif", "CMIRItemClassif", "CMI", "eventmesh");
    expect(result.joinRisks).toHaveLength(2);
    expect(result.joinRisks).toContainEqual(expect.objectContaining({ severity: "info", outcome: "resolved-by-override", parentKeyField: "objectClass" }));
    expect(result.joinRisks).toContainEqual(expect.objectContaining({ severity: "info", outcome: "resolved-by-override", parentKeyField: "counter" }));

    const content = result.dbActions.find((a) => a.file_path === "db/final/1st-model.cds")?.content ?? "";
    expectNormalizedToContain(content, "and to_CMICharac.indicatorObj = $self.objectClass");
    expectNormalizedToContain(content, "and to_CMICharac.intCounter = $self.counter");
  });

  it("produces no findings when the composition has a real ReferentialConstraint-derived `on` condition", () => {
    const result = buildDbModelForNamespace("final", makeCsnFixture(), "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    expect(result.joinRisks).toEqual([]);
  });
});

describe("buildDbModelForNamespace — joinRisks (structural anomalies beyond join-key matching)", () => {
  it("flags a composition/association whose property name doesn't start with `to_` and omits it from the generated model", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": {
          "@sap.label": "TestObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            childRef: { type: "cds.Composition", target: "MDG_TST.ChildObject", cardinality: { max: "*" }, on: [{ ref: ["childRef", "objectID"] }, "=", { ref: ["objectID"] }] },
          },
        },
        "MDG_TST.ChildObject": {
          "@sap.label": "ChildObject",
          elements: { objectID: { type: "cds.String", length: 10, key: true } },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    expect(result.joinRisks).toContainEqual(
      expect.objectContaining({ severity: "critical", outcome: "non-standard-relation-name", relationName: "childRef", targetBusinessTable: "ChildObject" }),
    );
    const content = result.dbActions.find((a) => a.file_path === "db/final/1st-model.cds")?.content ?? "";
    expect(content).not.toContain("childRef");
    expect(content).not.toContain("ChildObject");
  });

  it("flags a composition cycle back to a non-immediate ancestor and skips it instead of recursing forever", () => {
    // 3 levels deep: TestObject -> MidObject -> LeafObject -> back to TestObject. LeafObject's
    // immediate parent is MidObject, not TestObject, so the existing `target === parentModelName`
    // guard (which only catches an immediate child<->parent back-reference) does NOT catch this —
    // only the broader ancestor-chain check does.
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": {
          "@sap.label": "TestObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            to_Mid: { type: "cds.Composition", target: "MDG_TST.MidObject", cardinality: { max: "*" }, on: [{ ref: ["to_Mid", "objectID"] }, "=", { ref: ["objectID"] }] },
          },
        },
        "MDG_TST.MidObject": {
          "@sap.label": "MidObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            to_Leaf: { type: "cds.Composition", target: "MDG_TST.LeafObject", cardinality: { max: "*" }, on: [{ ref: ["to_Leaf", "objectID"] }, "=", { ref: ["objectID"] }] },
          },
        },
        "MDG_TST.LeafObject": {
          "@sap.label": "LeafObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            // Points back to the ROOT — an ancestor 2 levels up, not its immediate parent (MidObject).
            to_Root: { type: "cds.Composition", target: "MDG_TST.TestObject", cardinality: { max: "*" }, on: [{ ref: ["to_Root", "objectID"] }, "=", { ref: ["objectID"] }] },
          },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    expect(result.joinRisks).toContainEqual(
      expect.objectContaining({ severity: "critical", outcome: "composition-cycle", relationName: "to_Root", parentBusinessTable: "LeafObject", targetBusinessTable: "TestObject" }),
    );
    // Didn't hang/stack-overflow, and all 3 real levels were still generated.
    expect(result.dbActions.some((a) => a.file_path === "db/final/3rd-model.cds")).toBe(true);
    expect(result.dbActions.some((a) => a.file_path === "db/final/4th-model.cds")).toBe(false);
  });

  it("flags a composition/association whose target has no resolvable @sap.label instead of emitting invalid CDS", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": {
          "@sap.label": "TestObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            to_Ghost: { type: "cds.Composition", target: "MDG_TST.DoesNotExist", cardinality: { max: "*" }, on: [{ ref: ["to_Ghost", "objectID"] }, "=", { ref: ["objectID"] }] },
          },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    expect(result.joinRisks).toContainEqual(
      expect.objectContaining({ severity: "critical", outcome: "dangling-target", relationName: "to_Ghost", targetBusinessTable: "MDG_TST.DoesNotExist" }),
    );
    const content = result.dbActions.find((a) => a.file_path === "db/final/1st-model.cds")?.content ?? "";
    expect(content).not.toContain("undefined");
    expect(content).not.toContain("to_Ghost");
  });

  it("renders the child entity only once when two different relations on the same parent target it", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": {
          "@sap.label": "TestObject",
          elements: {
            objectID: { type: "cds.String", length: 10, key: true },
            to_CreatedBy: { type: "cds.Composition", target: "MDG_TST.UserObject", cardinality: { max: "1" }, on: [{ ref: ["to_CreatedBy", "objectID"] }, "=", { ref: ["objectID"] }] },
            to_ChangedBy: { type: "cds.Composition", target: "MDG_TST.UserObject", cardinality: { max: "1" }, on: [{ ref: ["to_ChangedBy", "objectID"] }, "=", { ref: ["objectID"] }] },
          },
        },
        "MDG_TST.UserObject": {
          "@sap.label": "UserObject",
          elements: { objectID: { type: "cds.String", length: 10, key: true } },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh");
    const rootContent = result.dbActions.find((a) => a.file_path === "db/final/1st-model.cds")?.content ?? "";
    expect(rootContent).toContain("to_CreatedBy");
    expect(rootContent).toContain("to_ChangedBy");

    const childContent = result.dbActions.find((a) => a.file_path === "db/final/2nd-model.cds")?.content ?? "";
    expect(childContent.match(/entity UserObject\b/g)).toHaveLength(1);
  });
});

describe("detectRenamedEntityLabels", () => {
  // Reproduces a real production incident: the source SAP system relabeled two entities
  // (`CMIRItemTextType`'s @sap.label from "CMIRItemText" to "CMIItemText", and
  // `CMIRItemClassificationType`'s from "CMIRItemClassification" to "CMIRItemClassif") while their
  // EDMX EntityType technical names stayed identical. Because this tool names generated CDS entities
  // after `@sap.label`, the redeploy silently created differently-named, empty entities instead of
  // updating the existing ones — orphaning the real HANA tables backing the old names.
  it("flags an entity whose @sap.label changed while its technical name stayed the same", () => {
    const previousCsn: TCsnContent = {
      definitions: {
        "MDG_CMI.CMIRItemText": { "@sap.label": "CMIRItemText", elements: { textObject: { type: "cds.String", length: 10, key: true } } },
        "MDG_CMI.CMIRItemClassification": { "@sap.label": "CMIRItemClassification", elements: { object: { type: "cds.String", length: 90, key: true } } },
        "MDG_CMI.CustomerMaterialInfoRecord": { "@sap.label": "CustomerMaterialInfoRecord", elements: { objectID: { type: "cds.String", length: 10, key: true } } },
      },
    };
    const newCsn: TCsnContent = {
      definitions: {
        "MDG_CMI.CMIRItemText": { "@sap.label": "CMIItemText", elements: { textObject: { type: "cds.String", length: 10, key: true } } },
        "MDG_CMI.CMIRItemClassification": { "@sap.label": "CMIRItemClassif", elements: { object: { type: "cds.String", length: 90, key: true } } },
        "MDG_CMI.CustomerMaterialInfoRecord": { "@sap.label": "CustomerMaterialInfoRecord", elements: { objectID: { type: "cds.String", length: 10, key: true } } },
      },
    };

    const renamed = detectRenamedEntityLabels(previousCsn, newCsn);
    expect(renamed).toEqual([
      { technicalName: "CMIRItemText", oldLabel: "CMIRItemText", newLabel: "CMIItemText" },
      { technicalName: "CMIRItemClassification", oldLabel: "CMIRItemClassification", newLabel: "CMIRItemClassif" },
    ]);
  });

  it("reports nothing when labels are unchanged", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": { "@sap.label": "TestObject", elements: { objectID: { type: "cds.String", length: 10, key: true } } },
      },
    };
    expect(detectRenamedEntityLabels(csn, csn)).toEqual([]);
  });

  it("reports nothing when there is no previous deploy to compare against", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_TST.TestObject": { "@sap.label": "TestObject", elements: { objectID: { type: "cds.String", length: 10, key: true } } },
      },
    };
    expect(detectRenamedEntityLabels(undefined, csn)).toEqual([]);
  });
});

describe("buildDbModelForNamespace — custom-model.cds preservation", () => {
  it("re-injects a preserved custom-model.cds attachment into the regenerated entity + its import line", () => {
    const csn = makeCsnFixture();
    const customModelPreservation = {
      final: {
        byParentEntity: {
          TestObject: {
            importLines: ["using {tst.model.final.TestObjectCustom} from './custom-model.cds';"],
            compositionLines: ["to_TestObjectCustom : Composition of one TestObjectCustom", "on to_TestObjectCustom.objectID = $self.objectID", "and to_TestObjectCustom.name = $self.name;"],
          },
        },
      },
      staging: {
        byParentEntity: {
          TestObject: {
            importLines: ["using {tst.model.staging.TestObjectCustom} from './custom-model.cds';"],
            compositionLines: [
              "to_TestObjectCustom : Composition of one TestObjectCustom",
              "on to_TestObjectCustom.objectID = $self.objectID",
              "and to_TestObjectCustom.taskID = $self.taskID",
              "and to_TestObjectCustom.name = $self.name;",
            ],
          },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh", customModelPreservation);

    const finalContent = findAction(result.dbActions, "db/final/1st-model.cds");
    expectNormalizedToContain(finalContent, "using {tst.model.final.TestObjectCustom} from './custom-model.cds';");
    expectNormalizedToContain(finalContent, "to_TestObjectCustom : Composition of one TestObjectCustom");
    expectNormalizedToContain(finalContent, "on to_TestObjectCustom.objectID = $self.objectID\n and to_TestObjectCustom.name = $self.name;");

    const stagingContent = findAction(result.dbActions, "db/staging/1st-model.cds");
    expectNormalizedToContain(stagingContent, "using {tst.model.staging.TestObjectCustom} from './custom-model.cds';");
    expectNormalizedToContain(stagingContent, "and to_TestObjectCustom.taskID = $self.taskID");

    expect(result.customModelWarnings).toEqual([]);
  });

  it("reports a warning instead of silently dropping an attachment whose parent entity no longer exists in this upload", () => {
    const csn = makeCsnFixture();
    const customModelPreservation = {
      final: {
        byParentEntity: {
          SomeVanishedEntity: {
            importLines: ["using {tst.model.final.VanishedCustom} from './custom-model.cds';"],
            compositionLines: ["to_VanishedCustom : Composition of one VanishedCustom on to_VanishedCustom.objectID = $self.objectID;"],
          },
        },
      },
    };

    const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "eventmesh", customModelPreservation);

    expect(result.customModelWarnings).toHaveLength(1);
    expect(result.customModelWarnings[0].businessTable).toBe("SomeVanishedEntity");
    expect(result.customModelWarnings[0].message).toMatch(/could not be re-applied/);

    const finalContent = findAction(result.dbActions, "db/final/1st-model.cds");
    expect(finalContent).not.toContain("VanishedCustom");
  });
});
