import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "examples"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/cli/**", "src/daemon/**", "src/index.ts"],
      reporter: ["text", "lcov", "html"],
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 50,
        lines: 50,
      },
    },
    testTimeout: 30000,
    hookTimeout: 15000,
    pool: "forks",
    sequence: {
      shuffle: false,
    },
  },
});
