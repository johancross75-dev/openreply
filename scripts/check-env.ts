/**
 * Prints which deployment environment variables are missing, empty or
 * malformed. Never prints a value. Exit code 1 when an error is found.
 *
 *   npm run check:env
 *
 * On Railway: open the service shell (or add it as a one-off command) to see
 * exactly what the running service receives.
 */
import { checkDeploymentConfig, formatConfigReport } from "../lib/config-check";

const report = checkDeploymentConfig();
console.log(formatConfigReport(report));
process.exit(report.ok ? 0 : 1);
