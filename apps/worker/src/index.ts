import { loadLocalEnv } from "./env.ts";
import { main } from "./main.ts";

loadLocalEnv();
process.exitCode = main();
