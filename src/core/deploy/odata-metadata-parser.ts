import { XMLParser } from "fast-xml-parser";

export type TODataVersion = "v2" | "v4";

export type TODataProperty = { name: string; type: string; nullable: boolean };
export type TODataNavigationProperty = { name: string };

export type TODataEntityType = {
  name: string;
  keys: string[];
  properties: TODataProperty[];
  navigationProperties: TODataNavigationProperty[];
};

export type TODataEntitySet = { name: string; entityTypeName: string };

export type TODataFunctionParameter = { name: string; type: string; nullable: boolean };

export type TODataFunctionImport = {
  name: string;
  httpMethod: string;
  parameters: TODataFunctionParameter[];
};

export type TODataServiceMetadata = {
  version: TODataVersion;
  entitySets: TODataEntitySet[];
  entityTypes: Record<string, TODataEntityType>;
  functionImports: TODataFunctionImport[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TXmlNode = any;

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function stripNamespace(qualifiedName: string): string {
  const index = qualifiedName.lastIndexOf(".");
  return index === -1 ? qualifiedName : qualifiedName.slice(index + 1);
}

function parseParameter(node: TXmlNode): TODataFunctionParameter {
  return { name: node["@_Name"], type: node["@_Type"] ?? "Edm.String", nullable: node["@_Nullable"] !== "false" };
}

/**
 * Parses an OData `$metadata` EDMX document (V2 or V4 — SAP MDG customers run both, depending on
 * whether the CAP srv layer was configured for the classic Gateway-style protocol or CAP's own
 * default) into a flat, UI-friendly shape: entity sets, their properties/navigation properties
 * (for building $select/$expand pickers), and function imports/actions (for parameter forms).
 * `removeNSPrefix` sidesteps the fact that V2 uses `edmx:`/`m:`/`sap:` prefixes bound to Microsoft's
 * legacy namespace URIs while V4 uses the OASIS ones — the element/attribute names themselves are
 * what we actually care about, not which namespace URI they're bound to in a given document.
 */
export function parseODataMetadata(xml: string): TODataServiceMetadata {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, parseAttributeValue: false, parseTagValue: false });
  const doc = parser.parse(xml) as TXmlNode;

  const edmx = doc.Edmx;
  if (!edmx) throw new Error("Not a valid EDMX $metadata document (no <Edmx> root element found).");
  const version: TODataVersion = edmx["@_Version"] === "4.0" ? "v4" : "v2";

  const schemas = toArray(edmx.DataServices?.Schema);
  const entityTypes: Record<string, TODataEntityType> = {};
  // V4 keys top-level Function/Action definitions by their simple name — overloads (same name,
  // different signature) collapse to "last wins", which is an acceptable simplification for a
  // dev-tool parameter form rather than a spec-complete resolver.
  const functionDefinitionsByName: Record<string, { parameters: TODataFunctionParameter[] }> = {};

  for (const schema of schemas) {
    for (const entityType of toArray(schema.EntityType)) {
      const name = entityType["@_Name"];
      if (!name) continue;
      const keys = toArray(entityType.Key?.PropertyRef)
        .map((ref: TXmlNode) => ref["@_Name"] as string | undefined)
        .filter((value): value is string => Boolean(value));
      const properties = toArray(entityType.Property)
        .filter((prop: TXmlNode) => prop["@_Name"])
        .map((prop: TXmlNode) => ({ name: prop["@_Name"] as string, type: (prop["@_Type"] as string) ?? "Edm.String", nullable: prop["@_Nullable"] !== "false" }));
      const navigationProperties = toArray(entityType.NavigationProperty)
        .filter((nav: TXmlNode) => nav["@_Name"])
        .map((nav: TXmlNode) => ({ name: nav["@_Name"] as string }));
      entityTypes[name] = { name, keys, properties, navigationProperties };
    }

    for (const fn of [...toArray(schema.Function), ...toArray(schema.Action)]) {
      const name = fn["@_Name"];
      if (!name) continue;
      const parameters = toArray(fn.Parameter).filter((p: TXmlNode) => p["@_Name"]).map(parseParameter);
      functionDefinitionsByName[name] = { parameters };
    }
  }

  const entitySets: TODataEntitySet[] = [];
  const functionImports: TODataFunctionImport[] = [];

  for (const schema of schemas) {
    for (const container of toArray(schema.EntityContainer)) {
      for (const set of toArray(container.EntitySet)) {
        if (!set["@_Name"]) continue;
        entitySets.push({ name: set["@_Name"], entityTypeName: stripNamespace(set["@_EntityType"] ?? "") });
      }

      for (const functionImport of toArray(container.FunctionImport)) {
        const name = functionImport["@_Name"];
        if (!name) continue;
        const inlineParameters = toArray(functionImport.Parameter).filter((p: TXmlNode) => p["@_Name"]);
        // V2 FunctionImport carries its parameters inline; V4 FunctionImport just references a
        // top-level Function by name, which is where the real parameter list lives.
        const parameters = inlineParameters.length
          ? inlineParameters.map(parseParameter)
          : functionDefinitionsByName[stripNamespace(functionImport["@_Function"] ?? name)]?.parameters ?? [];
        functionImports.push({ name, httpMethod: functionImport["@_HttpMethod"] ?? "GET", parameters });
      }

      for (const actionImport of toArray(container.ActionImport)) {
        const name = actionImport["@_Name"];
        if (!name) continue;
        const parameters = functionDefinitionsByName[stripNamespace(actionImport["@_Action"] ?? name)]?.parameters ?? [];
        functionImports.push({ name, httpMethod: "POST", parameters });
      }
    }
  }

  return { version, entitySets, entityTypes, functionImports };
}
