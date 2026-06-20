export type TKeyValueMap = Record<string, string>;

export type TInstallCommandOptions = {
  cwd?: string;
  cmd?: string;
  set?: string[];
  override?: string[];
  pattern?: string[];
  checkPackage?: string[];
  autoDoctor?: boolean;
};
