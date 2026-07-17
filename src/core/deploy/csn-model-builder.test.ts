import { describe, expect, it } from "vitest";
import { buildDbModelForNamespace, findRootModel } from "./csn-model-builder";
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

describe("findRootModel", () => {
  it("derives the short code from the CSN's own root entity instead of a configured short name", () => {
    const result = findRootModel(makeCsnFixture(), "TestObject");
    expect(result).toEqual({ rootModelName: "MDG_TST.TestObject", shortName: "TST" });
  });

  it("throws when no definition matches the requested object type", () => {
    expect(() => findRootModel(makeCsnFixture(), "SomethingElse")).toThrow(/Cannot find a root entity/);
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
    expect(content).toContain("key objectID : String(10) @(title : '{i18n>TestObject.objectID}');");
    expect(content).toContain("name : String(40) @(title : '{i18n>TestObject.name}');");
    // eventmesh mode: Boolean has no `default false` (only non-eventmesh-family modes get that).
    expect(content).toContain("isActive : Boolean @(title : '{i18n>TestObject.isActive}');");
    expect(content).toContain("to_Child : Composition of many ChildObject on");
    // Namespace identity join (objectID, from DB_NAMESPACE_CONFIG.final) + the CSN's own on-condition (linkKey).
    expect(content).toContain("to_Child.objectID = $self.objectID and to_Child.linkKey = $self.linkKey");
    expect(content).toContain("using {\n    tst.model.final.ChildObject\n} from './2nd-model';");
  });

  it("renders the staging entity re-scoping the relation with an inserted taskID join, no restated fields", () => {
    const content = findAction(result.dbActions, "db/staging/1st-model.cds");
    expect(content).toContain("namespace tst.model.staging;");
    expect(content).toContain("entity TestObject : final_TestObject, business_entity_staging {");
    expect(content).toContain("to_Child.objectID = $self.objectID and to_Child.taskID = $self.taskID and to_Child.linkKey = $self.linkKey");
    // Scalar fields are inherited from `final_TestObject`, never restated in staging.
    expect(content).not.toContain("name : String(40)");
  });

  it("renders the leaf child entity at the next level", () => {
    const content = findAction(result.dbActions, "db/final/2nd-model.cds");
    expect(content).toContain("entity ChildObject : business_child_level_entity {");
    expect(content).toContain("key childID : String(10)");
    expect(content).toContain("description : String(80)");
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
    expect(content).toContain(
      "to_CMII.objectID = $self.objectID and to_CMII.customer = $self.customer and to_CMII.distributionChannel = $self.distributionChannel and to_CMII.salesOrganization = $self.salesOrganization",
    );
  });
});

describe("buildDbModelForNamespace — multiple_erp mode", () => {
  const csn = makeCsnFixture();
  const result = buildDbModelForNamespace("final", csn, "MDG_TST.TestObject", "TestObject", "TST", "multiple_erp");

  it("generates a Mapping entity + to_<Table>Mapping composition per business table with keys", () => {
    const content = findAction(result.dbActions, "db/final/1st-model.cds");
    expect(content).toContain("entity TestObjectMapping : mapping_entity {");
    expect(content).toContain("key ERPSystem : String;");
    // multiple_erp mode drops the length suffix entirely (`buildTypeByFieldConfig`'s bare-type convention).
    expect(content).toContain("key objectID : String @(title : '{i18n>TestObject.objectID}');");
    expect(content).toContain("ERPname : String @(title : '{i18n>TestObject.name}');");
    expect(content).toContain("to_TestObjectMapping : Composition of many TestObjectMapping on to_TestObjectMapping.objectID = $self.objectID  and");
    expect(content).toContain("to_TestObjectMapping.objectID = $self.objectID;");
  });

  it("generates srv/master-data-service.cds exposing every business + Mapping table across all levels", () => {
    expect(result.srvActions).toHaveLength(1);
    const content = result.srvActions[0].content ?? "";
    expect(content).toContain("namespace tst.service.masterdata;");
    expect(content).toContain("using tst.model.final as tst_1st from '@simplemdg/db_tst/db/final/1st-model';");
    expect(content).toContain("using tst.model.final as tst_2nd from '@simplemdg/db_tst/db/final/2nd-model';");
    expect(content).toContain("service TestObjectMasterDataService @(requires: ['MD_TestObject', 'system-user']) @(path: '/TestObjectMasterDataService') {");
    expect(content).toContain("entity TestObject  as projection on tst_1st.TestObject;");
    expect(content).toContain("entity ChildObjectMapping  as projection on tst_2nd.ChildObjectMapping;");
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
    expect(content).toContain("to_Extra : Composition of many ExtraObject on");
    expect(content).toContain("to_Extra.objectID = $self.objectID and to_Extra.customer = $self.customer");
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
