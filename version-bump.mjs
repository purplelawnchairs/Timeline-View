import { readFileSync, writeFileSync } from "fs";

// Run via `npm version <patch|minor|major>`, which sets npm_package_version for us.
const targetVersion = process.env.npm_package_version;

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

// versions.json maps each plugin version to the minimum Obsidian version it needs,
// so older Obsidian installs are offered the newest release they can actually run.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t") + "\n");
