import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveImportFilePath } from "./npmrc";

describe("resolveImportFilePath", () => {
  const cwd = "C:\\repo";

  it("resolves a plain relative path against cwd", () => {
    expect(resolveImportFilePath(cwd, "packages.txt")).toBe(path.resolve(cwd, "packages.txt"));
  });

  it("strips quotes left over from Windows 'Copy as path'", () => {
    expect(resolveImportFilePath(cwd, '"C:\\Users\\me\\packages.txt"')).toBe(path.resolve("C:\\Users\\me\\packages.txt"));
  });

  it("strips single-quoted paths too", () => {
    expect(resolveImportFilePath(cwd, "'./packages.txt'")).toBe(path.resolve(cwd, "packages.txt"));
  });

  it("expands a leading ~ to the home directory", () => {
    expect(resolveImportFilePath(cwd, "~/packages.txt")).toBe(path.resolve(path.join(os.homedir(), "packages.txt")));
  });

  it("expands a bare ~", () => {
    expect(resolveImportFilePath(cwd, "~")).toBe(path.resolve(os.homedir()));
  });

  it("keeps an already-absolute path untouched", () => {
    expect(resolveImportFilePath(cwd, "D:\\notes\\packages.txt")).toBe(path.resolve("D:\\notes\\packages.txt"));
  });
});
