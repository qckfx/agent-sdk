/**
 * Configuration validator for agent configs
 * @module configValidator
 */

import Ajv2019 from 'ajv/dist/2019';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get the directory path of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load schema from file
const schemaPath = path.resolve(__dirname, '../../schemas/agent-config.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

// Create AJV instance
const ajv = new Ajv2019({ allErrors: true });
const validate = ajv.compile(schema);

/**
 * Error class for validation errors
 */
export class ConfigValidationError extends Error {
  errors: any[];
  
  constructor(message: string, errors: any[]) {
    super(message);
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

/**
 * Validates an agent configuration object against the schema
 * 
 * @param config The configuration object to validate
 * @throws {ConfigValidationError} If validation fails
 * @returns The validated config (same as input if valid)
 */
export function validateConfig<T>(config: T): T {
  const valid = validate(config);
  
  if (!valid) {
    const errorMessages = validate.errors?.map(err => {
      return `${err.instancePath} ${err.message}`;
    }).join('\n');
    
    throw new ConfigValidationError(
      `Invalid agent configuration: \n${errorMessages}`, 
      validate.errors || []
    );
  }
  
  return config;
}