import { existsSync } from "node:fs";
import { type CodegenConfig } from "@graphql-codegen/cli";

// The accepted runtime SDL is assembled from the CI-published graphql-contract branch.
// Until backend PR #666 merges, the synchronizer resolves that PR's current head automatically
// and overlays only its catalog fields/types. Generated output is never hand-edited.
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
