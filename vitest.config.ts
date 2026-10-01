import {defineConfig} from "vitest/config";
export default defineConfig({test:{include:["tests/conformance/*.test.ts"],testTimeout:15000}});
