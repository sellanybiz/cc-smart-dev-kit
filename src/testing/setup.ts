// Preloaded before every test file (bunfig.toml): hooks here apply to every test.
import { afterEach } from "bun:test";
import { removeTempDirs } from "./temp";

afterEach(removeTempDirs);
