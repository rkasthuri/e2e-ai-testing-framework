/**
 * FORGE — Autonomous Quality Engineering
 * Framework for Observed, Reasoned, and Grounded Evaluation
 *
 * Copyright (c) 2026 AnvilQ Technologies LLC
 * Author: Raj Kasthuri
 *
 * Proprietary and confidential.
 * Unauthorized copying, distribution, or modification
 * of this software is strictly prohibited.
 */

/**
 * users.ts
 * ─────────────────────────────────────────────────────────────
 * Centralized user credential store for the FORGE framework.
 * ALL credentials read from environment variables — zero
 * hardcoded strings anywhere in the framework.
 *
 * Add to .env:
 *   PASSWORD=secret_sauce
 *   USER_STANDARD=standard_user
 *   USER_LOCKED=locked_out_user
 *   USER_PROBLEM=problem_user
 *   USER_GLITCH=performance_glitch_user
 *   USER_ERROR=error_user
 *   USER_VISUAL=visual_user
 * ─────────────────────────────────────────────────────────────
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root — makes users.ts self-contained.
// No dependency on playwright.config.ts loading dotenv first.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface UserCredentials {
  username: string;
  password: string;
}

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const Users = {
  standard: (): UserCredentials => ({
    username: getEnv('USER_STANDARD'),
    password: getEnv('PASSWORD'),
  }),
  locked: (): UserCredentials => ({
    username: getEnv('USER_LOCKED'),
    password: getEnv('PASSWORD'),
  }),
  problem: (): UserCredentials => ({
    username: getEnv('USER_PROBLEM'),
    password: getEnv('PASSWORD'),
  }),
  glitch: (): UserCredentials => ({
    username: getEnv('USER_GLITCH'),
    password: getEnv('PASSWORD'),
  }),
  error: (): UserCredentials => ({
    username: getEnv('USER_ERROR'),
    password: getEnv('PASSWORD'),
  }),
  visual: (): UserCredentials => ({
    username: getEnv('USER_VISUAL'),
    password: getEnv('PASSWORD'),
  }),
} as const;
