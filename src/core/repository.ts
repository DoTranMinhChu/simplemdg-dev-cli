import path from "node:path";
import fs from "fs-extra";
import type { TRepositoryInfo } from "./types";

export async function findNearestRepository(startPath: string): Promise<TRepositoryInfo | undefined> {
  let currentPath = path.resolve(startPath);

  while (true) {
    if (await fs.pathExists(path.join(currentPath, "package.json"))) {
      return { repositoryPath: currentPath };
    }

    const parentPath = path.dirname(currentPath);

    if (parentPath === currentPath) {
      return undefined;
    }

    currentPath = parentPath;
  }
}

export async function resolveRepositoryPath(cwd: string): Promise<string> {
  const absoluteCwd = path.resolve(cwd);
  const repository = await findNearestRepository(absoluteCwd);

  if (repository?.repositoryPath) {
    return repository.repositoryPath;
  }

  if (await fs.pathExists(path.join(absoluteCwd, "package.json"))) {
    return absoluteCwd;
  }

  throw new Error(`Cannot find repository from ${absoluteCwd}`);
}
