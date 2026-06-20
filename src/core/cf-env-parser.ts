import type { TParsedCloudFoundryEnvironment } from "./types";

const SECTION_MARKERS = [
  "System-Provided:",
  "User-Provided:",
  "Running Environment Variable Groups:",
  "Staging Environment Variable Groups:",
];

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function findMatchingJsonEnd(value: string, startIndex: number): number {
  const openingCharacter = value[startIndex];
  const closingCharacter = openingCharacter === "{" ? "}" : "]";
  let depth = 0;
  let isInsideString = false;
  let isEscaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];

    if (isInsideString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === "\\") {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        isInsideString = false;
      }

      continue;
    }

    if (character === '"') {
      isInsideString = true;
      continue;
    }

    if (character === openingCharacter) depth += 1;
    if (character === closingCharacter) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function parseSimpleValue(rawValue: string): unknown {
  const value = rawValue.trim();

  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function parseKeyValueBlock(block: string): TParsedCloudFoundryEnvironment {
  const result: TParsedCloudFoundryEnvironment = {};
  let cursor = 0;

  while (cursor < block.length) {
    const nextMatch = /(^|\n)([A-Za-z_][A-Za-z0-9_]*):\s*/g;
    nextMatch.lastIndex = cursor;
    const match = nextMatch.exec(block);

    if (!match) break;

    const key = match[2];
    const valueStart = nextMatch.lastIndex;
    const firstCharacter = block[valueStart];

    if (firstCharacter === "{" || firstCharacter === "[") {
      const valueEnd = findMatchingJsonEnd(block, valueStart);
      if (valueEnd === -1) {
        throw new Error(`Cannot parse JSON value for ${key}`);
      }

      const rawJson = block.slice(valueStart, valueEnd + 1);
      result[key] = JSON.parse(rawJson);
      cursor = valueEnd + 1;
      continue;
    }

    const nextLineIndex = block.indexOf("\n", valueStart);
    const valueEnd = nextLineIndex === -1 ? block.length : nextLineIndex;
    result[key] = parseSimpleValue(block.slice(valueStart, valueEnd));
    cursor = valueEnd + 1;
  }

  return result;
}

function getSection(raw: string, sectionName: string): string {
  const startIndex = raw.indexOf(sectionName);
  if (startIndex === -1) return "";

  const contentStartIndex = startIndex + sectionName.length;
  const nextSectionIndexes = SECTION_MARKERS
    .filter((marker) => marker !== sectionName)
    .map((marker) => raw.indexOf(marker, contentStartIndex))
    .filter((index) => index !== -1);

  const contentEndIndex = nextSectionIndexes.length > 0 ? Math.min(...nextSectionIndexes) : raw.length;
  return raw.slice(contentStartIndex, contentEndIndex).trim();
}

export function parseCloudFoundryEnvironment(rawOutput: string): TParsedCloudFoundryEnvironment {
  const cleanedOutput = stripAnsi(rawOutput);
  const systemProvidedBlock = getSection(cleanedOutput, "System-Provided:");
  const userProvidedBlock = getSection(cleanedOutput, "User-Provided:");
  const result: TParsedCloudFoundryEnvironment = {};

  Object.assign(result, parseKeyValueBlock(systemProvidedBlock));
  Object.assign(result, parseKeyValueBlock(userProvidedBlock));

  return result;
}
