/**
 * Test/fixture-only compatibility JSON loader.
 *
 * TD-181 forbids runtime consumers from deserializing app-model.json. Scripts
 * that intentionally exercise fixture or migration compatibility may use this
 * helper; production code must use AppModelService.
 */
import * as fs from 'fs'
import * as path from 'path'
import { validateAppModelObject } from '../../src/core/onboarding/ModelValidator'

export function loadAppModelFixture(appName: string): Record<string, unknown> {
  const modelPath = path.resolve('models', appName, 'app-model.json')
  if (!fs.existsSync(modelPath)) {
    throw new Error(`App Model fixture not found: ${modelPath}`)
  }
  const model = JSON.parse(fs.readFileSync(modelPath, 'utf-8')) as Record<string, unknown>
  const result = validateAppModelObject(model)
  if (!result.valid) {
    throw new Error(
      `App Model fixture validation failed for ${appName}:\n${result.errors.join('\n')}`,
    )
  }
  return model
}
