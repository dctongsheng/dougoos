import { inspectDatabase } from "./inspect.js";

const argumentsWithoutSeparator = process.argv
  .slice(2)
  .filter((argument, index) => !(index === 0 && argument === "--"));
const filePath = argumentsWithoutSeparator[0];
if (filePath === undefined || argumentsWithoutSeparator.length !== 1) {
  process.stderr.write("usage: db-inspect <database-file>\n");
  process.exitCode = 2;
} else {
  try {
    process.stdout.write(`${JSON.stringify(inspectDatabase(filePath))}\n`);
  } catch {
    process.stderr.write("database inspection failed\n");
    process.exitCode = 1;
  }
}
