import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Kind, parse, print } from "graphql";

const repo = "waelhe/app-java-v3";
const contractBranch = "graphql-contract";
const outputPath = resolve("platform-contracts/generated-schema.graphqls");
const manifestPath = resolve("platform-contracts/.manifest.json");

async function fetchText(url, label) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "marketplace-admin-graphql-contract-sync",
      ...(url.startsWith("https://api.github.com/")
        ? {
            accept: "application/vnd.github+json",
            ...(process.env.GH_TOKEN || process.env.GITHUB_TOKEN
              ? { authorization: `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN}` }
              : {}),
          }
        : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${label} fetch failed: HTTP ${response.status} from ${url}`);
  }
  return response.text();
}

async function fetchJson(url, label) {
  const body = await fetchText(url, label);
  try {
    return JSON.parse(body);
  } catch (cause) {
    throw new Error(`${label} did not return valid JSON`, { cause });
  }
}

function named(definition) {
  return definition.name?.value;
}

function fieldsOf(document, typeName) {
  const definition = document.definitions.find(
    candidate =>
      candidate.kind === Kind.OBJECT_TYPE_DEFINITION &&
      named(candidate) === typeName,
  );
  if (!definition) throw new Error(`Published GraphQL SDL is missing required type ${typeName}`);
  return new Set((definition.fields ?? []).map(field => field.name.value));
}

function requireFields(fields, typeName, names) {
  const missing = names.filter(name => !fields.has(name));
  if (missing.length) {
    throw new Error(
      `Published GraphQL SDL is missing required ${typeName} field(s): ${missing.join(", ")}. ` +
      `The schema publisher must publish the accepted backend contract; do not hand-patch generated SDL.`,
    );
  }
}

const branchUrl = `https://api.github.com/repos/${repo}/branches/${contractBranch}`;
const branch = await fetchJson(branchUrl, "published GraphQL contract branch");
const sourceCommit = branch.commit?.sha;
if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) {
  throw new Error(`GitHub did not return an immutable SHA for ${contractBranch}`);
}

const sourceUrl = `https://raw.githubusercontent.com/${repo}/${sourceCommit}/schema.graphqls`;
const sourceText = await fetchText(sourceUrl, "published runtime SDL");
let schema;
try {
  schema = parse(sourceText);
} catch (cause) {
  throw new Error(`Published runtime SDL at ${sourceCommit} is not valid GraphQL SDL`, { cause });
}

const queryFields = fieldsOf(schema, "Query");
const mutationFields = fieldsOf(schema, "Mutation");
requireFields(queryFields, "Query", [
  "storeProduct",
  "storeProducts",
  "storeProductTypes",
  "storeProductAttributeValues",
  "storeProductVariants",
  "storeProductVariantAttributeValues",
]);
requireFields(mutationFields, "Mutation", [
  "createStoreProduct",
  "updateStoreProduct",
  "publishStoreProduct",
  "replaceStoreProductAttributes",
  "createStoreProductVariant",
]);

for (const typeName of [
  "StoreProduct",
  "StoreProductConnection",
  "StoreProductEdge",
  "StoreProductType",
  "StoreProductVariant",
]) {
  fieldsOf(schema, typeName);
}

const generated = `# GENERATED FILE — do not edit.
# Source branch: ${contractBranch}
# Source commit: ${sourceCommit}
# Source URL: ${sourceUrl}
# Regenerate with: pnpm run generate:platform

${print(schema)}
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, generated, "utf8");
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      generated: true,
      sourceRepository: repo,
      sourceBranch: contractBranch,
      sourceCommit,
      sourceUrl,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`Generated platform GraphQL SDL from published contract ${sourceCommit}.`);
