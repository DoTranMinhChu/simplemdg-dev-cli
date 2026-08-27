import { describe, expect, it } from "vitest";
import { diffCdsEntities } from "./cds-entity-diff";
import type { TCdsModelEntity } from "./cds-model-reader";

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
