/**
 * qckfx Agent Evaluation Tool
 * 
 * A streamlined evaluation framework for comparing agent configurations.
 */

import 'dotenv/config';
import { setupEvalCLI } from './cli.js';

// If this file is executed directly, run the CLI
if (require.main === module) {
  const program = setupEvalCLI();
  program.parse(process.argv);
}

// Exports for programmatic usage
export { runABEvaluation } from './runners/ab-runner.js';
export { runJudge } from './runners/judge.js';
export { testCases, getQuickTestCases } from './models/test-cases.js';
export * from './models/ab-types.js';
export * from './models/types.js';