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

﻿const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.goto('https://www.saucedemo.com');
  await p.fill('#user-name', 'standard_user');
  await p.fill('#password', 'secret_sauce');
  await p.click('#login-button');
  await p.waitForLoadState('networkidle');
  const els = await p.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.textContent.trim().slice(0,40),
      href: a.getAttribute('href'),
      cls:  a.className.slice(0,40)
    }));
  });
  console.log(JSON.stringify(els, null, 2));
  await b.close();
})().catch(console.error);
