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

/** A governed pointer to credential source variables; never credential material. */
export interface CredentialReference {
  usernameEnv: string
  passwordEnv: string
}

/** Read-only, operation-scoped credential access. Getters refuse use after disposal. */
export interface CredentialMaterial {
  readonly username: string
  readonly password: string
}

export type CredentialScopeResult<T> =
  | { kind: 'completed'; value: T }
  | { kind: 'unavailable' }

export interface CredentialExecutionScope {
  isAvailable(reference: CredentialReference): boolean
  run<T>(
    reference: CredentialReference,
    operation: (material: CredentialMaterial) => Promise<T>,
  ): Promise<CredentialScopeResult<T>>
  runProvided<T>(
    material: { username: string; password: string },
    operation: (material: CredentialMaterial) => Promise<T>,
  ): Promise<T>
}

interface MaterialHolder {
  username: string
  password: string
  disposed: boolean
}

function scopedView(holder: MaterialHolder): CredentialMaterial {
  const read = (field: 'username' | 'password'): string => {
    if (holder.disposed) throw new Error('Credential material is no longer available outside its operation scope.')
    return holder[field]
  }
  return Object.freeze({
    get username() { return read('username') },
    get password() { return read('password') },
  })
}

async function useMaterial<T>(
  username: string,
  password: string,
  operation: (material: CredentialMaterial) => Promise<T>,
): Promise<T> {
  const holder: MaterialHolder = { username, password, disposed: false }
  const view = scopedView(holder)
  try {
    return await operation(view)
  } finally {
    // JavaScript cannot guarantee physical heap zeroization. This removes the
    // values from FORGE's live holder and makes every retained view fail closed.
    holder.username = ''
    holder.password = ''
    holder.disposed = true
  }
}

/**
 * Sole runtime materializer for governed environment references and directly
 * supplied operation credentials. It never mutates process.env, persists,
 * logs, or returns credential material beyond the supplied callback.
 */
export class EnvironmentCredentialExecutionScope implements CredentialExecutionScope {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  isAvailable(reference: CredentialReference): boolean {
    return Boolean(this.environment[reference.usernameEnv] && this.environment[reference.passwordEnv])
  }

  async run<T>(
    reference: CredentialReference,
    operation: (material: CredentialMaterial) => Promise<T>,
  ): Promise<CredentialScopeResult<T>> {
    const username = this.environment[reference.usernameEnv]
    const password = this.environment[reference.passwordEnv]
    if (!username || !password) return { kind: 'unavailable' }
    return { kind: 'completed', value: await useMaterial(username, password, operation) }
  }

  runProvided<T>(
    material: { username: string; password: string },
    operation: (material: CredentialMaterial) => Promise<T>,
  ): Promise<T> {
    return useMaterial(material.username, material.password, operation)
  }
}

export const credentialExecutionScope: CredentialExecutionScope = new EnvironmentCredentialExecutionScope()
