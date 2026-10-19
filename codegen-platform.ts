import { existsSync } from "node:fs";
import { type CodegenConfig } from "@graphql-codegen/cli";

// The accepted runtime SDL is assembled from the CI-published graphql-contract branch.
// Before backend PR #666 lands, the pinned SDL in .platform-graphql-contract-ref supplies
// only the pending catalog fields/types; the sync script overlays them onto the runtime SDL.
// Generated output is never hand-edited.
const output = existsSync("./dashboard-overlay")
  ? "./dashboard-overlay/generated/platform-operations.ts"
  : "./src/marketplaceAdmin/generated/platform-operations.ts";

const config: CodegenConfig = {
  schema: ["./platform-contracts/generated-schema.graphqls"],
  documents: ["./platform-operations/**/*.graphql"],
  generates: {
    [output]: {
      plugins: ["typescript", "typescript-operations"],
      config: {
        useTypeImports: true,
        avoidOptionals: false,
        nonOptionalTypename: false,
        enumsAsTypes: false,
      },
    },
  },
};

export default config;
