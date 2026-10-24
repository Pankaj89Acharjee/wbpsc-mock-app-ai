#!/usr/bin/env node
// Starts apps/api-ai with its own virtual environment (no manual "activate" needed).
//   npm run dev:api-ai
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiAi = join(root, "apps", "api-ai");
const python =
  process.platform === "win32"
    ? join(apiAi, ".venv", "Scripts", "python.exe")
    : join(apiAi, ".venv", "bin", "python");

if (!existsSync(python)) {
  console.error(`api-ai virtual environment not found at ${python}

Create it once:
  cd apps/api-ai
  python -m venv .venv
  ${process.platform === "win32" ? ".venv\\Scripts\\python" : ".venv/bin/python"} -m pip install -r requirements.txt
`);
  process.exit(1);
}

const child = spawn(
  python,
  ["-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8081", "--env-file", join(root, ".env")],
  { cwd: apiAi, stdio: "inherit" }
);
child.on("exit", (code) => process.exit(code ?? 0));
