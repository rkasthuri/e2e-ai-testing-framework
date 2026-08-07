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


import { loadAppModelFixture } from '../helpers/load-app-model-fixture'
import * as path from 'path'

async function verify() {
  console.log('Phase 5.1 — App Model verification\n')

  // Validate schema file exists
  const schemaPath = path.resolve('models/schema/app-model.schema.json')
  const modelPath  = path.resolve('models/saucedemo/app-model.json')

  const fs = require('fs')
  if (!fs.existsSync(schemaPath)) throw new Error('Schema file missing')
  if (!fs.existsSync(modelPath))  throw new Error('SauceDemo model missing')
  console.log('✓ Schema file exists:', schemaPath)
  console.log('✓ Model file exists: ', modelPath)

  // Load, validate, and inspect the compatibility fixture.
  const model = loadAppModelFixture('saucedemo') as any
  console.log('[OK] SauceDemo model validates against schema')
  console.log('✓ Model loaded successfully')
  console.log('  App name:       ', model.app.name)
  console.log('  App type:       ', model.app.appType)
  console.log('  Model version:  ', model.app.modelVersion)
  console.log('  Pages:          ', model.pages.length)
  console.log('  Roles:          ', model.roles.length)
  console.log('  Flows:          ', model.flows.length)
  console.log('  API:            ', model.api === null ? 'null (UI-only)' : 'populated')

  // Verify element ID format {pageId}:{name}
  let idFormatErrors = 0
  for (const page of model.pages) {
    for (const el of page.elements) {
      if (!el.id.startsWith(`${page.id}:`)) {
        console.error(`✗ Element ID format wrong: ${el.id} on page ${page.id}`)
        idFormatErrors++
      }
    }
  }
  if (idFormatErrors === 0) {
    console.log('✓ All element IDs follow {pageId}:{name} format')
  }

  // Verify assert-navigation steps have targetPageId
  let navErrors = 0
  for (const flow of model.flows) {
    for (const step of flow.steps) {
      if (step.action === 'assert-navigation' && !step.targetPageId) {
        console.error(`✗ assert-navigation missing targetPageId in flow ${flow.id} step ${step.stepIndex}`)
        navErrors++
      }
    }
  }
  if (navErrors === 0) {
    console.log('✓ All assert-navigation steps have targetPageId')
  }

  // Verify critical elements have 2+ strategies
  let strategyErrors = 0
  for (const page of model.pages) {
    for (const el of page.elements) {
      if (el.critical && el.strategies.length < 2) {
        console.error(`✗ Critical element ${el.id} has fewer than 2 strategies`)
        strategyErrors++
      }
    }
  }
  if (strategyErrors === 0) {
    console.log('✓ All critical elements have 2+ strategies')
  }

  // Count total elements
  const totalElements = model.pages.reduce(
    (sum: number, p: any) => sum + p.elements.length, 0
  )
  const criticalElements = model.pages.reduce(
    (sum: number, p: any) => sum + p.elements.filter((e: any) => e.critical).length, 0
  )
  console.log(`\n  Total elements:    ${totalElements}`)
  console.log(`  Critical elements: ${criticalElements}`)
  console.log(`  Total flow steps:  ${model.flows.reduce((s: number, f: any) => s + f.steps.length, 0)}`)

  console.log('\n✅ Phase 5.1 — App Model schema and sample model verified')
}

verify().catch(e => { console.error('✗', e.message); process.exit(1) })
