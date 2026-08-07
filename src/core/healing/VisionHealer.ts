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

import { Page } from '@playwright/test';
import { aiCall } from '../ai/AiClient'

const VISION_HEAL_BUDGET = parseInt(process.env.VISION_HEAL_BUDGET ?? '5', 10);
const VISION_CONFIDENCE_THRESHOLD = 0.8;

interface VisionHealResult {
  selector:   string;
  confidence: number;
  reasoning:  string;
  success:    boolean;
}

let visionCallsThisRun = 0;

export class VisionHealer {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Attempt to identify a failing element using Claude Vision.
   * Returns a VisionHealResult -- caller decides whether to use it.
   */
  async heal(elementDescription: string): Promise<VisionHealResult> {
    // Check API key
    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        selector:   '',
        confidence: 0,
        reasoning:  'ANTHROPIC_API_KEY not set -- Vision healing unavailable',
        success:    false,
      };
    }

    // Check budget
    if (visionCallsThisRun >= VISION_HEAL_BUDGET) {
      return {
        selector:   '',
        confidence: 0,
        reasoning:  `Vision budget exhausted (${VISION_HEAL_BUDGET} calls/run)`,
        success:    false,
      };
    }

    visionCallsThisRun++;
    console.log(
      `[VisionHealer] Attempting vision heal for: "${elementDescription}" ` +
      `(call ${visionCallsThisRun}/${VISION_HEAL_BUDGET})`
    );

    try {
      // Capture screenshot
      const screenshot = await this.page.screenshot({ fullPage: false });
      const base64Image = screenshot.toString('base64');

      // Capture simplified DOM
      const domSnapshot = await this.getDomSnapshot();

      // Call Claude Vision
      const result = await this.callClaudeVision(
        base64Image,
        domSnapshot,
        elementDescription
      );

      if (result.success && result.confidence >= VISION_CONFIDENCE_THRESHOLD) {
        console.log(
          `[VisionHealer] Healed with confidence ${result.confidence}: ${result.selector}`
        );
      } else {
        console.log(
          `[VisionHealer] Low confidence (${result.confidence}) -- not applying heal`
        );
      }

      return result;

    } catch (error: any) {
      console.error('[VisionHealer] Vision heal failed:', error.message);
      return {
        selector:   '',
        confidence: 0,
        reasoning:  `Vision heal error: ${error.message}`,
        success:    false,
      };
    }
  }

  // -- Private --

  private async getDomSnapshot(): Promise<string> {
    return this.page.evaluate(() => {
      const elements = document.querySelectorAll(
        'button, input, a, [data-test], [id], select, textarea'
      );
      return Array.from(elements)
        .slice(0, 50) // cap at 50 to keep prompt size manageable
        .map(el => {
          const attrs: string[] = [];
          if (el.id)                          attrs.push(`id="${el.id}"`);
          if (el.getAttribute('data-test'))   attrs.push(`data-test="${el.getAttribute('data-test')}"`);
          if (el.getAttribute('name'))        attrs.push(`name="${el.getAttribute('name')}"`);
          if (el.getAttribute('type'))        attrs.push(`type="${el.getAttribute('type')}"`);
          const text = el.textContent?.trim().slice(0, 30);
          if (text)                           attrs.push(`text="${text}"`);
          return `<${el.tagName.toLowerCase()} ${attrs.join(' ')} />`;
        })
        .join('\n');
    });
  }

  private async callClaudeVision(
    base64Image: string,
    domSnapshot: string,
    elementDescription: string
  ): Promise<VisionHealResult> {
    const aiResp = await aiCall({
      operation: 'vision-heal',
      appName:   process.env.APP_NAME || 'unknown',
      messages:  [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: {
              type:       'base64',
              media_type: 'image/png',
              data:       base64Image,
            },
          },
          {
            type: 'text',
            text: `You are a Playwright test automation expert analyzing a webpage screenshot.

A test is trying to find this element: "${elementDescription}"

The current DOM contains these interactive elements:
${domSnapshot}

Your task:
1. Look at the screenshot to understand the page layout
2. Identify which DOM element best matches the description
3. Return the BEST Playwright selector for that element

Respond ONLY with valid JSON in this exact format:
{
  "selector": "the-playwright-selector",
  "confidence": 0.95,
  "reasoning": "brief explanation of why this selector was chosen"
}

Rules:
- Prefer data-test attributes over id over CSS
- confidence must be between 0 and 1
- If you cannot identify the element with confidence >= 0.8, set confidence below 0.8
- selector must be a valid CSS/attribute selector that Playwright can use`,
          },
        ],
      }],
      maxTokens: 500,
    })

    const text = aiResp.content

    // Parse JSON response
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return {
      selector:   parsed.selector   ?? '',
      confidence: parsed.confidence ?? 0,
      reasoning:  parsed.reasoning  ?? '',
      success:    (parsed.confidence ?? 0) >= VISION_CONFIDENCE_THRESHOLD,
    };
  }
}

// Reset budget counter between test runs
export function resetVisionBudget(): void {
  visionCallsThisRun = 0;
}

export function getVisionCallsUsed(): number {
  return visionCallsThisRun;
}
