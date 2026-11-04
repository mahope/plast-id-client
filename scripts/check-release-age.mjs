import { readFile } from "node:fs/promises";

const { packages } = JSON.parse(await readFile("package-lock.json", "utf8"));
const metadata = new Map();
const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
let checked = 0;
for (const [path, entry] of Object.entries(packages)) {
  if (!path) continue;
  const name = path.split("node_modules/").at(-1);
  if (!metadata.has(name)) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error(`Cannot check release age: ${name} (${response.status})`);
    metadata.set(name, await response.json());
  }
  const published = metadata.get(name).time?.[entry.version];
  if (!published || !(Date.parse(published) <= cutoff)) {
    throw new Error(`Release must be at least 3 days old: ${name}@${entry.version} (${published ?? "unknown"})`);
  }
  checked++;
}
console.log(`Release age: ${checked} locked packages are at least 3 days old.`);
