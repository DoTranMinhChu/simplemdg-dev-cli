import { describe, expect, it } from "vitest";
import { extractCustomModelAttachments, mergeCustomModelPreservation, parseCustomModelEntityNames } from "./custom-model-preserver";

/** Shape confirmed against a real customer repo (`simplemdg_db_prd`, GitLab MR !17). */
const FINAL_1ST_MODEL = `
namespace prd.model.final;

using core.common.business_1st_level_entity from '@simplemdg/db_common/db/common-model';
using {prd.model.final.ProductCustom} from './custom-model.cds';

@(title : '{i18n>Product}')
entity Product : business_1st_level_entity {
    key product : String(18) @(title : '{i18n>Product}');
    description : String(40) @(title : '{i18n>Product.description}');
    to_Valuation : Composition of many ProductValuation
        on  to_Valuation.objectID = $self.objectID
        and to_Valuation.product  = $self.product;
    to_ProductCustom : Composition of one ProductCustom
        on  to_ProductCustom.objectID = $self.objectID
        and to_ProductCustom.product  = $self.product;
}
`;

const STAGING_1ST_MODEL = `
namespace prd.model.staging;

using {prd.model.final.Product as final_Product} from '../final/1st-model.cds';
using {prd.model.staging.ProductCustom} from './custom-model.cds';

entity Product : final_Product, business_entity_staging {
    to_Valuation : Composition of many ProductValuation
        on  to_Valuation.objectID = $self.objectID
        and to_Valuation.taskID   = $self.taskID
        and to_Valuation.product  = $self.product;
    to_ProductCustom : Composition of one ProductCustom
        on  to_ProductCustom.objectID = $self.objectID
        and to_ProductCustom.taskID   = $self.taskID
        and to_ProductCustom.product  = $self.product;
}
`;

const CUSTOM_MODEL_CDS = `
namespace prd.model.final;
using core.common.business_child_level_entity from '@simplemdg/db_common/db/common-model';

@(title: '{i18n>ProductCustom}')
entity ProductCustom : business_child_level_entity {
    key product : String @(title: '{i18n>ProductCustom.product}');
    requestor : String @(title: '{i18n>ProductCustom.requestor}');
}
`;

describe("parseCustomModelEntityNames", () => {
  it("finds every entity custom-model.cds itself defines", () => {
    expect(parseCustomModelEntityNames(CUSTOM_MODEL_CDS)).toEqual(new Set(["ProductCustom"]));
  });

  it("returns an empty set for content with no entity declarations", () => {
    expect(parseCustomModelEntityNames("namespace foo;\n").size).toBe(0);
  });
});

describe("extractCustomModelAttachments", () => {
  it("recovers the Product -> ProductCustom composition + import line from a real final-tier file", () => {
    const result = extractCustomModelAttachments(FINAL_1ST_MODEL, new Set(["ProductCustom"]));
    const attachment = result.byParentEntity.Product;

    expect(attachment).toBeDefined();
    expect(attachment.importLines).toEqual(["using {prd.model.final.ProductCustom} from './custom-model.cds';"]);
    const composition = attachment.compositionLines.join(" ");
    expect(composition).toContain("to_ProductCustom : Composition of one ProductCustom");
    expect(composition).toContain("to_ProductCustom.objectID = $self.objectID");
    expect(composition).toContain("to_ProductCustom.product  = $self.product");
    // The unrelated to_Valuation composition must NOT leak into the preserved attachment.
    expect(attachment.compositionLines.some((line) => line.includes("to_Valuation"))).toBe(false);
  });

  it("recovers the staging-tier variant (extra taskID join, staging namespace import)", () => {
    const result = extractCustomModelAttachments(STAGING_1ST_MODEL, new Set(["ProductCustom"]));
    const attachment = result.byParentEntity.Product;

    expect(attachment.importLines).toEqual(["using {prd.model.staging.ProductCustom} from './custom-model.cds';"]);
    expect(attachment.compositionLines.join(" ")).toContain("to_ProductCustom.taskID");
  });

  it("returns no attachments when the custom entity name doesn't appear anywhere", () => {
    const result = extractCustomModelAttachments(FINAL_1ST_MODEL, new Set(["SomethingElseCustom"]));
    expect(result.byParentEntity).toEqual({});
  });

  it("returns no attachments for an empty customEntityNames set", () => {
    const result = extractCustomModelAttachments(FINAL_1ST_MODEL, new Set());
    expect(result.byParentEntity).toEqual({});
  });
});

describe("mergeCustomModelPreservation", () => {
  it("merges + de-dupes across multiple ordinal-file extractions", () => {
    const partA = extractCustomModelAttachments(FINAL_1ST_MODEL, new Set(["ProductCustom"]));
    const partB = extractCustomModelAttachments(FINAL_1ST_MODEL, new Set(["ProductCustom"]));
    const merged = mergeCustomModelPreservation([partA, partB]);

    expect(merged.byParentEntity.Product.importLines).toEqual(["using {prd.model.final.ProductCustom} from './custom-model.cds';"]);
    expect(merged.byParentEntity.Product.compositionLines).toEqual(partA.byParentEntity.Product.compositionLines);
  });
});
