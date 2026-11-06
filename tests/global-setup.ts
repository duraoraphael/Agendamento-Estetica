import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export default function globalSetup() {
  const root = path.resolve(__dirname, "..");
  const dbPath = path.join(root, "prisma", "test.db");

  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  execSync("npx prisma migrate deploy", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
  });
}
