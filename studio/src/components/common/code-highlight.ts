import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// highlight.js/lib/core ships with zero grammars registered — pulling in the full `highlight.js`
// entry (~190 languages) would bloat the bundle for a local dev tool, so only the languages we
// realistically see in coding-agent transcripts are registered here, each under every alias a
// fenced-code-block language tag might use.
const REGISTRATIONS: Array<[string[], unknown]> = [
  [["javascript", "js", "jsx", "mjs", "cjs"], javascript],
  [["typescript", "ts", "tsx"], typescript],
  [["json", "jsonc"], json],
  [["xml", "html", "svg"], xml],
  [["css", "scss", "less"], css],
  [["bash", "sh", "shell", "zsh"], bash],
  [["powershell", "ps1", "ps"], powershell],
  [["python", "py"], python],
  [["sql"], sql],
  [["yaml", "yml"], yaml],
  [["markdown", "md"], markdown],
  [["diff", "patch"], diff],
  [["java"], java],
  [["csharp", "cs"], csharp],
  [["go", "golang"], go],
  [["rust", "rs"], rust],
  [["cpp", "c", "c++", "cc"], cpp],
  [["ruby", "rb"], ruby],
  [["ini", "toml"], ini],
];

for (const [aliases, grammar] of REGISTRATIONS) {
  hljs.registerLanguage(aliases[0], grammar as never);
  for (const alias of aliases.slice(1)) hljs.registerAliases(alias, { languageName: aliases[0] });
}

export { hljs };
