import { describe, expect, it } from "vitest";
import { accumulateCdsEntities, diffCdsEntities, parseCsnEntities } from "./cds-entity-diff";
import type { TCdsModelEntity } from "./cds-model-reader";
import type { TCsnContent } from "./csn-model-types";

function entity(name: string, fields: Array<{ name: string; type: string }>, keyFields: string[] = [], sourceFile = "db/final/1st-model.cds"): TCdsModelEntity {
  return { name, sourceFile, keyFields, fields, compositions: [] };
}

describe("diffCdsEntities", () => {
  it("reports a whole new entity as added, with its full field list itemized as 'added'", () => {
    const changes = diffCdsEntities([], [entity("Product", [{ name: "product", type: "String(18)" }, { name: "description", type: "String(40)" }], ["product"])]);
    expect(changes).toEqual([
      {
        entity: "Product",
        sourceFile: "db/final/1st-model.cds",
        kind: "added",
        fields: [
          { field: "description", kind: "added", newType: "String(40)", newKey: false },
          { field: "product", kind: "added", newType: "String(18)", newKey: true },
        ],
      },
    ]);
  });

  it("reports a whole entity removal, with its full field list itemized as 'removed'", () => {
    const changes = diffCdsEntities([entity("Product", [{ name: "product", type: "String(18)" }, { name: "description", type: "String(40)" }], ["product"])], []);
    expect(changes).toEqual([
      {
        entity: "Product",
        sourceFile: "db/final/1st-model.cds",
        kind: "removed",
        fields: [
          { field: "description", kind: "removed", oldType: "String(40)", oldKey: false },
          { field: "product", kind: "removed", oldType: "String(18)", oldKey: true },
        ],
      },
    ]);
  });

  it("omits an entity with no field differences entirely", () => {
    const before = entity("Product", [{ name: "product", type: "String(18)" }], ["product"]);
    const after = entity("Product", [{ name: "product", type: "String(18)" }], ["product"]);
    expect(diffCdsEntities([before], [after])).toEqual([]);
  });

  it("reports an added field on an otherwise-unchanged entity", () => {
    const before = entity("Product", [{ name: "product", type: "String(18)" }], ["product"]);
    const after = entity("Product", [{ name: "product", type: "String(18)" }, { name: "description", type: "String(40)" }], ["product"]);
    expect(diffCdsEntities([before], [after])).toEqual([
      { entity: "Product", sourceFile: "db/final/1st-model.cds", kind: "changed", fields: [{ field: "description", kind: "added", newType: "String(40)", newKey: false }] },
    ]);
  });

  it("reports a removed field", () => {
    const before = entity("Product", [{ name: "product", type: "String(18)" }, { name: "description", type: "String(40)" }], ["product"]);
    const after = entity("Product", [{ name: "product", type: "String(18)" }], ["product"]);
    expect(diffCdsEntities([before], [after])).toEqual([
      { entity: "Product", sourceFile: "db/final/1st-model.cds", kind: "changed", fields: [{ field: "description", kind: "removed", oldType: "String(40)", oldKey: false }] },
    ]);
  });

  it("reports a type change and a key-ness change as 'changed'", () => {
    const before = entity("Product", [{ name: "description", type: "String(40)" }]);
    const after = entity("Product", [{ name: "description", type: "String(80)" }], ["description"]);
    expect(diffCdsEntities([before], [after])).toEqual([
      {
        entity: "Product",
        sourceFile: "db/final/1st-model.cds",
        kind: "changed",
        fields: [{ field: "description", kind: "changed", oldType: "String(40)", newType: "String(80)", oldKey: false, newKey: true }],
      },
    ]);
  });

  it("sorts entities and fields alphabetically for stable output", () => {
    const before: TCdsModelEntity[] = [entity("Zebra", []), entity("Apple", [])];
    const after: TCdsModelEntity[] = [entity("Zebra", [{ name: "z", type: "String" }, { name: "a", type: "String" }]), entity("Apple", [{ name: "z", type: "String" }, { name: "a", type: "String" }])];
    const changes = diffCdsEntities(before, after);
    expect(changes.map((c) => c.entity)).toEqual(["Apple", "Zebra"]);
    expect(changes[0].fields.map((f) => f.field)).toEqual(["a", "z"]);
  });

  it("ignores a duplicate entity name and keeps the first occurrence", () => {
    const before = [entity("Product", [{ name: "product", type: "String(18)" }])];
    const after = [entity("Product", [{ name: "product", type: "String(18)" }]), entity("Product", [{ name: "product", type: "String(99)" }])];
    expect(diffCdsEntities(before, after)).toEqual([]);
  });
});

describe("parseCsnEntities", () => {
  it("skips the bare namespace/service root definition (no elements) and reads every real entity's fields/keys", () => {
    const csn: TCsnContent = {
      definitions: {
        MDG_F4: { kind: "service", "@cds.external": true },
        "MDG_F4.APPLOGMSG": {
          "@sap.label": "Application log messages",
          elements: {
            logNumber: { type: "cds.String", length: 20, key: true },
            messageNumber: { type: "cds.String", length: 6, key: true },
            logDate: { type: "cds.Date" },
          },
        },
      },
    };
    expect(parseCsnEntities(csn, "db/external/MDG_F4.csn")).toEqual([
      {
        name: "MDG_F4.APPLOGMSG",
        sourceFile: "db/external/MDG_F4.csn",
        keyFields: ["logNumber", "messageNumber"],
        fields: [
          { name: "logNumber", type: "String(20)" },
          { name: "messageNumber", type: "String(6)" },
          { name: "logDate", type: "Date" },
        ],
        compositions: [],
      },
    ]);
  });

  it("splits out target-bearing elements as compositions instead of scalar fields", () => {
    const csn: TCsnContent = {
      definitions: {
        "MDG_F4.SearchHelp": {
          "@sap.label": "Search Help",
          elements: {
            searchHelpId: { type: "cds.String", length: 10, key: true },
            to_Field: { type: "cds.Association", target: "MDG_F4.SearchHelpField", cardinality: { max: "*" } },
          },
        },
        "MDG_F4.SearchHelpField": { "@sap.label": "Search Help Field", elements: { fieldName: { type: "cds.String", length: 30, key: true } } },
      },
    };
    const [searchHelp] = parseCsnEntities(csn, "db/external/MDG_F4.csn");
    expect(searchHelp.fields).toEqual([{ name: "searchHelpId", type: "String(10)" }]);
    expect(searchHelp.compositions).toEqual([{ field: "to_Field", target: "MDG_F4.SearchHelpField", cardinality: "many" }]);
  });

  it("feeds straight into diffCdsEntities, matching entities purely by CSN definition name — this is what lets F4's Review changes step show '9 entities added, 3 changed' instead of only a raw text diff", () => {
    const before: TCsnContent = {
      definitions: {
        MDG_F4: { kind: "service" },
        "MDG_F4.APPLOGMSG": { "@sap.label": "Log", elements: { logNumber: { type: "cds.String", length: 20, key: true } } },
        "MDG_F4.MDCUACUMAX": { "@sap.label": "Acumax", elements: { objectID: { type: "cds.String", length: 10, key: true }, fILLER: { type: "cds.String", length: 5 } } },
      },
    };
    const after: TCsnContent = {
      definitions: {
        MDG_F4: { kind: "service" },
        "MDG_F4.APPLOGMSG": { "@sap.label": "Log", elements: { logNumber: { type: "cds.String", length: 20, key: true } } },
        "MDG_F4.MDCUACUMAX": { "@sap.label": "Acumax", elements: { objectID: { type: "cds.String", length: 10, key: true }, businessPartner: { type: "cds.String", length: 10 } } },
        "MDG_F4.MDLICENSEMASTER": { "@sap.label": "License Master", elements: { licenseId: { type: "cds.String", length: 10, key: true } } },
      },
    };
    const oldEntities = parseCsnEntities(before, "db/external/MDG_F4.csn");
    const newEntities = parseCsnEntities(after, "db/external/MDG_F4.csn");
    const changes = diffCdsEntities(oldEntities, newEntities);

    expect(changes.find((c) => c.entity === "MDG_F4.MDLICENSEMASTER")?.kind).toBe("added");
    expect(changes.find((c) => c.entity === "MDG_F4.APPLOGMSG")).toBeUndefined(); // unchanged -> omitted
    const acumax = changes.find((c) => c.entity === "MDG_F4.MDCUACUMAX");
    expect(acumax?.kind).toBe("changed");
    expect(acumax?.fields).toEqual([
      { field: "businessPartner", kind: "added", newType: "String(10)", newKey: false },
      { field: "fILLER", kind: "removed", oldType: "String(5)", oldKey: false },
    ]);
  });
});

describe("accumulateCdsEntities — includeCsn", () => {
  const csnContent = JSON.stringify({ definitions: { "MDG_F4.APPLOGMSG": { "@sap.label": "Log", elements: { logNumber: { type: "cds.String", length: 20, key: true } } } } } satisfies TCsnContent);

  it("ignores a .csn file by default (includeCsn omitted) — required so a normal object type's raw srv/external/*.csn never double-counts alongside its generated .cds entities", () => {
    const target: TCdsModelEntity[] = [];
    accumulateCdsEntities(target, "srv/external/MDG_BP.csn", csnContent);
    expect(target).toEqual([]);
  });

  it("parses a .csn file when includeCsn is true", () => {
    const target: TCdsModelEntity[] = [];
    accumulateCdsEntities(target, "db/external/MDG_F4.csn", csnContent, true);
    expect(target).toEqual([{ name: "MDG_F4.APPLOGMSG", sourceFile: "db/external/MDG_F4.csn", keyFields: ["logNumber"], fields: [{ name: "logNumber", type: "String(20)" }], compositions: [] }]);
  });

  it("still parses .cds files as before regardless of includeCsn", () => {
    const target: TCdsModelEntity[] = [];
    accumulateCdsEntities(target, "db/final/1st-model.cds", "entity Product : business_1st_level_entity { key product: String(18); }", true);
    expect(target).toHaveLength(1);
    expect(target[0].name).toBe("Product");
  });

  it("swallows malformed .csn content instead of throwing", () => {
    const target: TCdsModelEntity[] = [];
    expect(() => accumulateCdsEntities(target, "db/external/MDG_F4.csn", "not valid json", true)).not.toThrow();
    expect(target).toEqual([]);
  });
});
