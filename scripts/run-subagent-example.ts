#!/usr/bin/env ts-node
/*
 * Very small manual test demonstrating sub-agent support.
 *
 * Usage:  npx ts-node scripts/run-subagent-example.ts
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config()

// When running this script directly with a TS runner (e.g. `ts-node` or
// `tsx`), we need to point the import at the raw TypeScript source.  The
// compiled `*.js` files only exist under `dist/` after the project has been
// built, so importing `../src/Agent.js` would fail if the consumer has not
// executed `npm run build` first.  Referencing the `.ts` source allows the
// transpiler to pick it up automatically irrespective of the build step.

import { Agent } from '../src/Agent.ts';

// ---------------------------------------------------------------------------
// Load main agent configuration from .qckfx directory
// ---------------------------------------------------------------------------

const mainCfgPath = path.resolve(process.cwd(), '.qckfx', 'main-agent.json');
const mainRaw = fs.readFileSync(mainCfgPath, 'utf8');
const mainCfg = JSON.parse(mainRaw);

const mainAgent = new Agent(mainCfg, {
  onToolExecutionStarted: (obj) =>
    console.info('tool started: ' + JSON.stringify(obj)),
  onToolExecutionCompleted: (obj) =>
    console.info('tool completed: ' + JSON.stringify(obj)),
});

(async () => {
  const result = await mainAgent.processQuery('Tell me a good joke');

  console.log('messages: ', result.sessionState.contextWindow._messages)
  console.log('JokeAgent returned:', result);
})();
