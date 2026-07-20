import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TGitLabAuth } from "../gitlab/gitlab-client";
import type { TObjectTypeRepoRef } from "./object-type-discovery";
import { buildCustomModelCommitActions } from "./custom-model-editor";
import type { TCustomModelEntityView, TCustomModelView } from "./custom-model-editor";
import { parseCdsEntities } from "./cds-model-reader";
import { extractCustomModelAttachments, parseCustomModelEntityNames } from "./custom-model-preserver";
import type { TGitLabCommitAction } from "../gitlab/gitlab-write-client";

const fetchRawFile = vi.fn();
vi.mock("../gitlab/gitlab-client", () => ({
  fetchRawFile: (...args: unknown[]) => fetchRawFile(...args),
  fetchRepositoryTree: vi.fn(async () => []),
}));

const mockAuth = { baseUrl: "https://gitlab.example.com", token: "t" } as unknown as TGitLabAuth;
const mockDbRepo: TObjectTypeRepoRef = { projectId: 1, pathWithNamespace: "group/simplemdg_db_prd", role: "db", defaultBranch: "main" };

const FINAL_1ST_MODEL_NO_CUSTOM = `
namespace prd.model.final;

using core.common.business_1st_level_entity from '@simplemdg/db_common/db/common-model';

@(title : '{i18n>Product}')
entity Product : business_1st_level_entity {
    key product : String(18) @(title : '{i18n>Product}');
    description : String(40) @(title : '{i18n>Product.description}');
    to_Valuation : Composition of many ProductValuation
        on  to_Valuation.objectID = $self.objectID
        and to_Valuation.product  = $self.product;
}
`;

const STAGING_1ST_MODEL_NO_CUSTOM = `
namespace prd.model.staging;

using {prd.model.final.Product as final_Product} from '../final/1st-model.cds';

entity Product : final_Product, business_entity_staging {
    to_Valuation : Composition of many ProductValuation
        on  to_Valuation.objectID = $self.objectID
        and to_Valuation.taskID   = $self.taskID
        and to_Valuation.product  = $self.product;
}
`;

const FINAL_1ST_MODEL_WITH_CUSTOM = `
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

const STAGING_1ST_MODEL_WITH_CUSTOM = `
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

/** `cons` is a fully independent tier (its own namespace, its own root aspect) — confirmed against a real customer repo it re-declares every field rather than inheriting from `final` the way `staging` does. Identity join key is `requestID`, not `objectID` (see `DB_NAMESPACE_CONFIG.cons`). */
const CONS_1ST_MODEL_NO_CUSTOM = `
namespace prd.model.cons;

using core.common.cons_1st_level_entity from '@simplemdg/db_common/db/common-model';

@(title : '{i18n>Product}')
entity Product : cons_1st_level_entity {
    key product : String(18) @(title : '{i18n>Product}');
    description : String(40) @(title : '{i18n>Product.description}');
}
`;

function findAction(actions: TGitLabCommitAction[], filePath: string): string {
  const action = actions.find((item) => item.file_path === filePath);
  if (!action) throw new Error(`Expected an action for "${filePath}", got: ${actions.map((item) => item.file_path).join(", ")}`);
  return action.content ?? "";
}

/** The real CDS formatter column-aligns declarations with content-dependent padding — collapse whitespace runs so assertions aren't tied to that dynamic padding (same convention as `csn-model-builder.test.ts`). */
function normalizeSpaces(text: string): string {
  return text.replace(/[ \t]+/g, " ");
}

function expectNormalizedToContain(content: string, expected: string): void {
  expect(normalizeSpaces(content)).toContain(normalizeSpaces(expected));
}

function makeNoCustomView(): TCustomModelView {
  const generatedEntities = parseCdsEntities(FINAL_1ST_MODEL_NO_CUSTOM, "db/final/1st-model.cds");
  return { generatedEntities, customEntities: [], finalNamespace: "prd.model.final", stagingNamespace: "prd.model.staging", extraTiers: {} };
}

describe("buildCustomModelCommitActions — add-entity", () => {
  beforeEach(() => {
    fetchRawFile.mockReset();
    fetchRawFile.mockImplementation(async (_auth: unknown, _projectId: unknown, filePath: string) => {
      if (filePath === "db/final/1st-model.cds") return FINAL_1ST_MODEL_NO_CUSTOM;
      if (filePath === "db/staging/1st-model.cds") return STAGING_1ST_MODEL_NO_CUSTOM;
      return undefined;
    });
  });

  it("adds a new custom entity, wires its attachment into both tiers, and writes dedicated i18n", async () => {
    const view = makeNoCustomView();

    const { actions, warnings } = await buildCustomModelCommitActions(mockAuth, mockDbRepo, view, [
      {
        op: "add-entity",
        name: "ProductCustom",
        attachedTo: "Product",
        fields: [
          { name: "product", type: "String", isKey: true },
          { name: "requestor", type: "String", i18nLabel: "Requestor" },
        ],
      },
    ]);

    expect(warnings).toEqual([]);

    const customModelCds = findAction(actions, "db/final/custom-model.cds");
    expect(customModelCds).toContain("entity ProductCustom : business_child_level_entity {");
    expectNormalizedToContain(customModelCds, "key product : String");
    expectNormalizedToContain(customModelCds, "requestor : String");

    const stagingCustomModelCds = findAction(actions, "db/staging/custom-model.cds");
    expect(stagingCustomModelCds).toContain("entity ProductCustom : final_ProductCustom, business_entity_staging {}");
    expect(stagingCustomModelCds).toContain("using {prd.model.final.ProductCustom as final_ProductCustom} from '../final/custom-model';");

    const i18n = findAction(actions, "db/i18n/custom-model_en.properties");
    expect(i18n).toContain("ProductCustom=ProductCustom");
    expect(i18n).toContain("ProductCustom.requestor=Requestor");
    expect(findAction(actions, "db/i18n/custom-model.properties")).toBe(i18n);

    const finalModel = findAction(actions, "db/final/1st-model.cds");
    expectNormalizedToContain(finalModel, "using {prd.model.final.ProductCustom} from './custom-model.cds';");
    expectNormalizedToContain(finalModel, "to_ProductCustom : Composition of one ProductCustom");
    expectNormalizedToContain(finalModel, "to_ProductCustom.objectID = $self.objectID");
    expectNormalizedToContain(finalModel, "to_ProductCustom.product = $self.product");
    // The pre-existing to_Valuation composition must survive the splice untouched.
    expectNormalizedToContain(finalModel, "to_Valuation : Composition of many ProductValuation");

    const stagingModel = findAction(actions, "db/staging/1st-model.cds");
    expectNormalizedToContain(stagingModel, "using {prd.model.staging.ProductCustom} from './custom-model.cds';");
    expectNormalizedToContain(stagingModel, "to_ProductCustom.taskID = $self.taskID");

    // Round-trip against Part A: the preserver must recover exactly this attachment from what we just wrote.
    const customEntityNames = parseCustomModelEntityNames(customModelCds);
    expect(customEntityNames).toEqual(new Set(["ProductCustom"]));
    const recovered = extractCustomModelAttachments(finalModel, customEntityNames);
    expect(recovered.byParentEntity.Product).toBeDefined();
    expect(recovered.byParentEntity.Product.importLines).toEqual(["using {prd.model.final.ProductCustom} from './custom-model.cds';"]);
  });

  it("flags a name collision with an existing generated entity instead of silently corrupting the model", async () => {
    const view = makeNoCustomView();

    const { warnings } = await buildCustomModelCommitActions(mockAuth, mockDbRepo, view, [
      { op: "add-entity", name: "Product", attachedTo: "Product", fields: [{ name: "x", type: "String" }] },
    ]);

    expect(warnings.some((warning) => warning.includes("collides"))).toBe(true);
  });

  it("warns instead of throwing when attachedTo names an entity that doesn't exist", async () => {
    const view = makeNoCustomView();

    const { warnings, actions } = await buildCustomModelCommitActions(mockAuth, mockDbRepo, view, [
      { op: "add-entity", name: "GhostCustom", attachedTo: "DoesNotExist", fields: [{ name: "x", type: "String" }] },
    ]);

    expect(warnings.some((warning) => warning.includes("GhostCustom") && warning.includes("DoesNotExist"))).toBe(true);
    // custom-model.cds itself is still written (the entity exists), just not wired anywhere.
    expect(findAction(actions, "db/final/custom-model.cds")).toContain("entity GhostCustom");
  });
});

describe("buildCustomModelCommitActions — delete-entity", () => {
  it("strips both the composition and the import line, and drops the entity from custom-model.cds", async () => {
    fetchRawFile.mockReset();
    fetchRawFile.mockImplementation(async (_auth: unknown, _projectId: unknown, filePath: string) => {
      if (filePath === "db/final/1st-model.cds") return FINAL_1ST_MODEL_WITH_CUSTOM;
      if (filePath === "db/staging/1st-model.cds") return STAGING_1ST_MODEL_WITH_CUSTOM;
      return undefined;
    });

    const generatedEntities = parseCdsEntities(FINAL_1ST_MODEL_WITH_CUSTOM, "db/final/1st-model.cds");
    const existingCustomEntities: TCustomModelEntityView[] = [{ name: "ProductCustom", attachedTo: "Product", fields: [{ name: "product", type: "String", isKey: true }] }];
    const view: TCustomModelView = { generatedEntities, customEntities: existingCustomEntities, finalNamespace: "prd.model.final", stagingNamespace: "prd.model.staging", extraTiers: {} };

    const { actions } = await buildCustomModelCommitActions(mockAuth, mockDbRepo, view, [{ op: "delete-entity", name: "ProductCustom" }]);

    const finalModel = findAction(actions, "db/final/1st-model.cds");
    expect(finalModel).not.toContain("ProductCustom");
    expectNormalizedToContain(finalModel, "to_Valuation : Composition of many ProductValuation"); // untouched sibling composition survives

    const stagingModel = findAction(actions, "db/staging/1st-model.cds");
    expect(stagingModel).not.toContain("ProductCustom");

    const customModelCds = findAction(actions, "db/final/custom-model.cds");
    expect(customModelCds).not.toContain("entity ProductCustom");
  });
});

describe("buildCustomModelCommitActions — extra tiers (cons/clone_final)", () => {
  it("also writes and wires a detected cons tier, with its own namespace/base-aspect/identity-key", async () => {
    fetchRawFile.mockReset();
    fetchRawFile.mockImplementation(async (_auth: unknown, _projectId: unknown, filePath: string) => {
      if (filePath === "db/final/1st-model.cds") return FINAL_1ST_MODEL_NO_CUSTOM;
      if (filePath === "db/staging/1st-model.cds") return STAGING_1ST_MODEL_NO_CUSTOM;
      if (filePath === "db/cons/1st-model.cds") return CONS_1ST_MODEL_NO_CUSTOM;
      return undefined;
    });

    const generatedEntities = parseCdsEntities(FINAL_1ST_MODEL_NO_CUSTOM, "db/final/1st-model.cds");
    const consEntities = parseCdsEntities(CONS_1ST_MODEL_NO_CUSTOM, "db/cons/1st-model.cds");
    const view: TCustomModelView = {
      generatedEntities,
      customEntities: [],
      finalNamespace: "prd.model.final",
      stagingNamespace: "prd.model.staging",
      extraTiers: { cons: { namespace: "prd.model.cons", entities: consEntities } },
    };

    const { actions, warnings } = await buildCustomModelCommitActions(mockAuth, mockDbRepo, view, [
      { op: "add-entity", name: "ProductCustom", attachedTo: "Product", fields: [{ name: "product", type: "String", isKey: true }] },
    ]);

    expect(warnings).toEqual([]);

    const consCustomModelCds = findAction(actions, "db/cons/custom-model.cds");
    expect(consCustomModelCds).toContain("namespace prd.model.cons;");
    expect(consCustomModelCds).toContain("entity ProductCustom : cons_child_level_entity {");

    const consModel = findAction(actions, "db/cons/1st-model.cds");
    expectNormalizedToContain(consModel, "using {prd.model.cons.ProductCustom} from './custom-model.cds';");
    expectNormalizedToContain(consModel, "to_ProductCustom : Composition of one ProductCustom");
    expectNormalizedToContain(consModel, "to_ProductCustom.requestID = $self.requestID");
    expectNormalizedToContain(consModel, "to_ProductCustom.product = $self.product");
    // cons is keyed by requestID (per DB_NAMESPACE_CONFIG.cons.identityKeys), never objectID/taskID.
    expect(consModel).not.toContain("objectID");
    expect(consModel).not.toContain("taskID");

    // final/staging still get wired too — the extra tier is additive, not a replacement.
    const finalModel = findAction(actions, "db/final/1st-model.cds");
    expectNormalizedToContain(finalModel, "to_ProductCustom.objectID = $self.objectID");
  });

  it("does not touch db/cons at all when no cons tier was detected (extraTiers empty)", async () => {
    fetchRawFile.mockReset();
    fetchRawFile.mockImplementation(async (_auth: unknown, _projectId: unknown, filePath: string) => {
      if (filePath === "db/final/1st-model.cds") return FINAL_1ST_MODEL_NO_CUSTOM;
      if (filePath === "db/staging/1st-model.cds") return STAGING_1ST_MODEL_NO_CUSTOM;
      return undefined;
    });

    const view = makeNoCustomView();
    const { actions } = await buildCustomModelCommitActions(mockAuth, mockDbRepo, view, [
      { op: "add-entity", name: "ProductCustom", attachedTo: "Product", fields: [{ name: "product", type: "String", isKey: true }] },
    ]);

    expect(actions.some((action) => action.file_path.startsWith("db/cons/"))).toBe(false);
  });
});
