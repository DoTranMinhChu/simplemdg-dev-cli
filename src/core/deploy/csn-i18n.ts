import type { TGitLabCommitAction } from "../gitlab/gitlab-write-client";

/**
 * Ported from `OTI18nHelper.buildI18n`'s core behavior: both i18n files are pipeline-owned and
 * fully overwritten from the fragments accumulated while walking the CSN (`Table=Table` /
 * `Table.field=Label` lines) — not merged with whatever i18n content already exists on the target
 * branch. Legacy also augments these fragments with F4/MD-table mapping labels sourced from
 * `ot-multiple-helper.ts`; that's Phase 5 of the port (see the plan) and isn't included here.
 */
export function buildI18nActions(i18nFragments: string[]): TGitLabCommitAction[] {
  const content = i18nFragments.join("\n");
  return [
    { action: "update", file_path: "db/i18n/i18n.properties", content },
    { action: "update", file_path: "db/i18n/i18n_en.properties", content },
  ];
}
