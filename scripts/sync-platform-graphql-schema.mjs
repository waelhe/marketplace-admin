import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Kind, parse, print, visit } from "graphql";

const repo = "waelhe/app-java-v3";
const outputPath = resolve("platform-contracts/generated-schema.graphqls");
const manifestPath = resolve("platform-contracts/.manifest.json");

async function fetchText(url, label) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "marketplace-admin-graphql-contract-sync",
    },
  });
  if (!response.ok) {
    throw new Error(`${label} fetch failed: HTTP ${response.status} from ${url}`);
  }
  return response.text();
}

async function fetchJson(url, label) {
  const text = await fetchText(url, label);
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`${label} did not return valid JSON`, { cause });
  }
}

function named(definition) {
  return definition.name?.value;
}

function objectDefinition(document, name) {
  return document.definitions.find(
    definition => definition.kind === Kind.OBJECT_TYPE_DEFINITION && named(definition) === name,
  );
}

function addFields(document, typeName, fields, predicate) {
  const definition = objectDefinition(document, typeName);
  if (!definition) throw new Error(`Accepted runtime SDL is missing required root type ${typeName}`);
  const existing = new Set((definition.fields ?? []).map(field => field.name.value));
  const additions = fields.filter(field => predicate(field.name.value) && !existing.has(field.name.value));
  if (!additions.length) return document;
  return {
    ...document,
    definitions: document.definitions.map(candidate =>
      candidate === definition
        ? { ...definition, fields: [...(definition.fields ?? []), ...additions] }
        : candidate,
    ),
  };
}

function cloneConnectionType(document, sourceName, targetName, replacements) {
  const source = objectDefinition(document, sourceName);
  if (!source) throw new Error(`Accepted runtime SDL is missing connection template ${sourceName}`);
  return visit(source, {
    ObjectTypeDefinition(node) {
      return { ...node, name: { ...node.name, value: targetName } };
    },
    NamedType(node) {
      const replacement = replacements[node.name.value];
      return replacement
        ? { ...node, name: { ...node.name, value: replacement } }
        : undefined;
    },
  });
}

const [branch, pendingPr] = await Promise.all([
  fetchJson(`https://api.github.com/repos/${repo}/branches/graphql-contract`, "published GraphQL contract branch"),
  fetchJson(`https://api.github.com/repos/${repo}/pulls/666`, "pending catalog GraphQL contract PR"),
]);
const acceptedSha = branch.commit?.sha;
const pendingRef = pendingPr.head?.sha;
if (!/^[0-9a-f]{40}$/.test(acceptedSha ?? "")) {
  throw new Error("GitHub did not return an immutable commit SHA for graphql-contract");
}
if (!/^[0-9a-f]{40}$/.test(pendingRef ?? "")) {
  throw new Error("GitHub did not return an immutable head SHA for catalog PR #666");
}
if (pendingPr.state === "closed" && pendingPr.merged !== true) {
  throw new Error("Catalog PR #666 was closed without merging; refusing to generate from a rejected contract.");
}

const acceptedSdlUrl = `https://raw.githubusercontent.com/${repo}/${acceptedSha}/schema.graphqls`;
const pendingSdlUrl = `https://raw.githubusercontent.com/${repo}/${pendingRef}/marketplace-app/src/main/resources/graphql/schema.graphqls`;
const [acceptedText, pendingText] = await Promise.all([
  fetchText(acceptedSdlUrl, "published runtime SDL"),
  fetchText(pendingSdlUrl, "pinned pending catalog SDL"),
]);

let accepted = parse(acceptedText);
const pending = parse(pendingText);
const pendingQuery = objectDefinition(pending, "Query");
const pendingMutation = objectDefinition(pending, "Mutation");
if (!pendingQuery || !pendingMutation) {
  throw new Error("Pending catalog SDL does not define both Query and Mutation");
}

accepted = addFields(accepted, "Query", pendingQuery.fields ?? [], name => name.startsWith("storeProduct"));
accepted = addFields(accepted, "Mutation", pendingMutation.fields ?? [], name =>
  /^(create|update|publish|replace)StoreProduct/.test(name),
);

const existingNames = new Set(accepted.definitions.map(named).filter(Boolean));
const catalogDefinitions = pending.definitions.filter(definition => {
  const name = named(definition);
  return name?.startsWith("StoreProduct") && !existingNames.has(name);
});
accepted = { ...accepted, definitions: [...accepted.definitions, ...catalogDefinitions] };

const afterTypeNames = new Set(accepted.definitions.map(named).filter(Boolean));
if (!afterTypeNames.has("StoreProductConnection")) {
  const connection = cloneConnectionType(accepted, "ServiceConnection", "StoreProductConnection", {
    ServiceEdge: "StoreProductEdge",
  });
  accepted = { ...accepted, definitions: [...accepted.definitions, connection] };
}
const withConnectionNames = new Set(accepted.definitions.map(named).filter(Boolean));
if (!withConnectionNames.has("StoreProductEdge")) {
  const edge = cloneConnectionType(accepted, "ServiceEdge", "StoreProductEdge", {
    Service: "StoreProduct",
  });
  accepted = { ...accepted, definitions: [...accepted.definitions, edge] };
}

const generated = `# GENERATED FILE — do not edit.
# Accepted runtime source: ${acceptedSdlUrl}
# Pending catalog contract source (temporary until backend PR #666 is merged): ${pendingSdlUrl}
# Regenerate with: pnpm run generate:platform

${print(accepted)}
`;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, generated, "utf8");
await writeFile(
  manifestPath,
  `${JSON.stringify({
    generated: true,
    acceptedRuntimeCommit: acceptedSha,
    acceptedRuntimeUrl: acceptedSdlUrl,
    pendingCatalogCommit: pendingRef,
    pendingCatalogUrl: pendingSdlUrl,
    pendingCatalogOverrideRequiredUntilMerged: pendingPr.merged !== true,
  }, null, 2)}\n`,
  "utf8",
);
console.log(`Assembled platform GraphQL SDL from runtime commit ${acceptedSha} and catalog PR #666 head ${pendingRef}.`);
