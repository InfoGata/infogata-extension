/**
 * Fails if a development-only affordance reached a production build.
 *
 * Both things checked here are dead code in a release *by construction* -- they
 * sit behind `import.meta.env.DEV`, or behind the entrypoints:resolved hook in
 * wxt.config.ts -- so this passes today. It exists because the failure is
 * silent: the consent bypass shipping to users would undo the guarantee the
 * consent window exists to make, and nothing about the extension would look
 * wrong. A grep is cheap; noticing on your own is not.
 *
 * Run after `npm run build` and `npm run build:firefox`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const TARGETS = [".output/chrome-mv3", ".output/firefox-mv2"];

const FORBIDDEN = [
  // The dev-only switch that answers every consent prompt with "allow".
  { needle: "devAutoConsent", why: "dev consent-bypass storage key" },
  { needle: "Skip consent prompts", why: "dev consent-bypass popup toggle" },
  { needle: "auto-allowing", why: "dev consent-bypass warning" },
  // The debug page drives the privileged fetch with arbitrary input.
  { needle: "Open Debug Page", why: "debug page button" },
];

const FORBIDDEN_FILES = ["debug.html"];

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const failures = [];

for (const target of TARGETS) {
  if (!existsSync(target)) {
    failures.push(`${target} does not exist -- build both targets first`);
    continue;
  }

  for (const name of FORBIDDEN_FILES) {
    if (existsSync(join(target, name))) {
      failures.push(`${target}/${name} must not ship in a production build`);
    }
  }

  for (const file of walk(target)) {
    let contents;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue; // Binary asset.
    }
    for (const { needle, why } of FORBIDDEN) {
      if (contents.includes(needle)) {
        failures.push(`${file} contains "${needle}" (${why})`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Production bundle check failed:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nThese are development-only. If one is now intended in a release, change" +
      "\nthis script deliberately -- do not delete the check to make it pass.\n"
  );
  process.exit(1);
}

console.log(
  `Production bundle check passed (${TARGETS.join(", ")}): no dev-only code shipped.`
);
