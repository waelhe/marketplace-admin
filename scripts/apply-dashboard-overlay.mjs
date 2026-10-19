import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const dashboardRoot = resolve(process.argv[2] || "dashboard");
const pinnedVersion = "3.23.39";
const pinnedCommit = "bc75e988da0fa4fbc3d47378a888d859d070746f";

async function read(path) {
  return readFile(join(dashboardRoot, path), "utf8");
}

async function write(path, value) {
  await writeFile(join(dashboardRoot, path), value, "utf8");
}

function requireShape(condition, message) {
  if (!condition) throw new Error(`Dashboard overlay refused to apply: ${message}`);
}

if (dashboardRoot === resolve(repoRoot)) {
  const sourcePin = (await read(".platform-upstream-commit")).trim();
  requireShape(sourcePin === pinnedCommit, `expected source pin ${pinnedCommit}, found ${sourcePin}`);
} else {
  const actualCommit = execFileSync("git", ["-C", dashboardRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  requireShape(actualCommit === pinnedCommit, `expected pinned upstream commit ${pinnedCommit}, found ${actualCommit}`);
}

const packageJson = JSON.parse(await read("package.json"));
requireShape(packageJson.name === "saleor-dashboard", `unexpected package name: ${packageJson.name}`);
requireShape(packageJson.version === pinnedVersion, `expected Saleor Dashboard ${pinnedVersion}, found ${packageJson.version}`);

const entryPath = "src/index.tsx";
let entry = await read(entryPath);
requireShape(entry.includes('import "./index.css";'), "the pinned entrypoint import marker changed");
requireShape(entry.includes('const root = createRoot(document.querySelector("#dashboard-app")!);'), "the pinned React root marker changed");
requireShape(entry.includes("root.render("), "the React root render marker is missing");

if (!entry.includes('import MarketplaceAdminApp from "./marketplaceAdmin/MarketplaceAdminApp";')) {
  entry = entry.replace(
    'import "./index.css";',
    'import "./index.css";\nimport MarketplaceAdminApp from "./marketplaceAdmin/MarketplaceAdminApp";',
  );
}

const renderStart = entry.lastIndexOf("\nroot.render(");
requireShape(renderStart >= 0, "could not locate the terminal React root.render call");
const normalRender = entry.slice(renderStart + 1);
requireShape(normalRender.includes("<StrictMode>") && normalRender.includes("<App />"), "the upstream render body changed");
const overlayRender = `if (import.meta.env.VITE_MARKETPLACE_ADMIN_MODE === "true") {
  root.render(<MarketplaceAdminApp />);
} else {
${normalRender.split("\n").map(line => `  ${line}`).join("\n")}
}`;
entry = entry.slice(0, renderStart + 1) + overlayRender;
await write(entryPath, entry);

const sourceDir = join(repoRoot, "dashboard-overlay");
const targetDir = join(dashboardRoot, "src/marketplaceAdmin");
await mkdir(targetDir, { recursive: true });
for (const filename of ["MarketplaceAdminApp.tsx", "marketplace-api.ts", "marketplace-admin.css"]) {
  await copyFile(join(sourceDir, filename), join(targetDir, filename));
}

const envSource = await readFile(join(sourceDir, "vite-env.d.ts"), "utf8");
const envPath = join(dashboardRoot, "src/vite-env.d.ts");
let envTarget = await readFile(envPath, "utf8");
if (!envTarget.includes("VITE_MARKETPLACE_ADMIN_MODE")) {
  envTarget += `\n\n// Types for the independently maintained platform-admin overlay.\n${envSource.replace(/^\/\/\/ <reference types="vite\/client" \/>\s*/m, "")}\n`;
  await write(envPath, envTarget);
}

const e2eDir = join(dashboardRoot, "e2e-marketplace-admin");
await mkdir(e2eDir, { recursive: true });
await copyFile(join(repoRoot, "platform-e2e/product-lifecycle.spec.ts"), join(e2eDir, "product-lifecycle.spec.ts"));
await copyFile(join(repoRoot, "platform-e2e/playwright.config.ts"), join(e2eDir, "playwright.config.ts"));
console.log(`Applied platform overlay to Saleor Dashboard ${pinnedVersion} (${pinnedCommit}).`);
