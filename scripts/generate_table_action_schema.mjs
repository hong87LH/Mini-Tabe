#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildActionRequestSchema } from '../agent_api/action_definitions.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(scriptDir, '../agent_api/table_action_api_v0.1.schema.json');
const schema = buildActionRequestSchema();

fs.writeFileSync(outputPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
console.log(`Generated ${outputPath}`);

