import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Kind, parse, print, visit } from "graphql";

const repo = "waelhe/app-java-v3";
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
const catalogSourceSha = pendingPr.merged === true ? pendingPr.merge_commit_sha : pendingRef;
if (!/^[0-9a-f]{40}$/.test(catalogSourceSha ?? "")) {
  throw new Error("GitHub did not return an immutable catalog SDL source SHA");
}
const pendingSdlUrl = `https://raw.githubusercontent.com/${repo}/${pendingRef}/marketplace-app/src/main/resources/graphql/schema.graphqls`;
const catalogSdlUrl = `https://raw.githubusercontent.com/${repo}/${catalogSourceSha}/marketplace-app/src/main/resources/graphql/schema.graphqls`;
const acceptedTextPromise = fetchText(acceptedSdlUrl, "published runtime SDL");
const catalogTextPromise = fetchText(
  catalogSdlUrl,
  pendingPr.merged === true ? "merged catalog SDL" : "pending catalog SDL",
);
const [acceptedText, catalogText] = await Promise.all([acceptedTextPromise, catalogTextPromise]);

let accepted = parse(acceptedText);
const runtimeQuery = objectDefinition(accepted, "Query");
const runtimeMutation = objectDefinition(accepted, "Mutation");
const runtimeHasCatalog = Boolean(
  runtimeQuery?.fields?.some(field => field.name.value === "storeProducts") &&
  runtimeQuery?.fields?.some(field => field.name.value === "storeProductTypes") &&
  runtimeMutation?.fields?.some(field => field.name.value === "publishStoreProduct") &&
  objectDefinition(accepted, "StoreProduct") &&
  objectDefinition(accepted, "StoreProductConnection") &&
  objectDefinition(accepted, "StoreProductEdge")
);
// If the merge completed before the contract-publishing workflow, compose from the exact merge
// commit until the runtime schema artifact catches up. No branch SHA or schema path is hand-pinned.
const needsCatalogOverlay = pendingPr.merged !== true || !runtimeHasCatalog;
if (needsCatalogOverlay) {
  const pending = parse(catalogText);
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

  // Until the backend change is published, derive the generated connection and edge shapes
  // from the already-published Spring runtime schema. They are not maintained by hand.
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
}
const generated = `# GENERATED FILE — do not edit.
# Accepted runtime source: ${acceptedSdlUrl}
# Catalog schema source: ${needsCatalogOverlay ? catalogSdlUrl : acceptedSdlUrl}
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
    catalogSourceCommit: catalogSourceSha,
    catalogSourceUrl: catalogSdlUrl,
    pendingCatalogOverrideRequiredUntilMerged: pendingPr.merged !== true,
    runtimeSchemaPublishLag: pendingPr.merged === true && needsCatalogOverlay,
  }, null, 2)}\n`,
  "utf8",
);
console.log(`Assembled platform GraphQL SDL from runtime commit ${acceptedSha}${needsCatalogOverlay ? ` plus catalog commit ${catalogSourceSha}` : " (catalog contract is published)"}.`);
