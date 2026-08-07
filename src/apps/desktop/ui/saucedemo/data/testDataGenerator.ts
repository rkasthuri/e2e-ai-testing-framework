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

export interface TestUser {
  username: string;
  password: string;
  expectedBehavior: 'success' | 'locked' | 'error' | 'validation_error' | 'slow';
  description: string;
}

export interface EdgeCaseInput {
  type: string;
  username: string;
  password: string;
  description: string;
}

export class TestDataGenerator {
  // Valid test users from SauceDemo
  static getValidUsers(): TestUser[] {
    return [
      {
        username: 'standard_user',
        password: 'secret_sauce',
        expectedBehavior: 'success',
        description: 'Standard user with no issues'
      },
      {
        username: 'problem_user',
        password: 'secret_sauce',
        expectedBehavior: 'success',
        description: 'User with UI issues (images broken)'
      },
      {
        username: 'performance_glitch_user',
        password: 'secret_sauce',
        expectedBehavior: 'slow',
        description: 'User with performance delays'
      },
      {
        username: 'error_user',
        password: 'secret_sauce',
        expectedBehavior: 'success',
        description: 'User that encounters errors'
      },
      {
        username: 'visual_user',
        password: 'secret_sauce',
        expectedBehavior: 'success',
        description: 'User with visual differences'
      }
    ];
  }

  // Invalid credentials for negative testing
  static getInvalidUsers(): TestUser[] {
    return [
      {
        username: 'locked_out_user',
        password: 'secret_sauce',
        expectedBehavior: 'locked',
        description: 'Locked out user account'
      },
      {
        username: 'invalid_user',
        password: 'wrong_password',
        expectedBehavior: 'error',
        description: 'Invalid username and password'
      },
      {
        username: 'standard_user',
        password: 'wrong_password',
        expectedBehavior: 'error',
        description: 'Valid username, wrong password'
      },
      {
        username: '',
        password: '',
        expectedBehavior: 'validation_error',
        description: 'Empty username and password'
      },
      {
        username: 'standard_user',
        password: '',
        expectedBehavior: 'validation_error',
        description: 'Valid username, empty password'
      },
      {
        username: '',
        password: 'secret_sauce',
        expectedBehavior: 'validation_error',
        description: 'Empty username, valid password'
      }
    ];
  }

  // Edge case inputs for security and boundary testing
  static getEdgeCaseInputs(): EdgeCaseInput[] {
    return [
      {
        type: 'sql_injection',
        username: "' OR '1'='1",
        password: "' OR '1'='1",
        description: 'SQL injection attempt'
      },
      {
        type: 'xss_attempt',
        username: '<script>alert("XSS")</script>',
        password: '<script>alert("XSS")</script>',
        description: 'Cross-site scripting attempt'
      },
      {
        type: 'long_input',
        username: 'a'.repeat(1000),
        password: 'b'.repeat(1000),
        description: 'Very long input strings'
      },
      {
        type: 'special_chars',
        username: '!@#$%^&*()',
        password: '!@#$%^&*()',
        description: 'Special characters'
      },
      {
        type: 'unicode',
        username: '测试用户',
        password: 'пароль',
        description: 'Unicode characters'
      },
      {
        type: 'whitespace',
        username: '   standard_user   ',
        password: '   secret_sauce   ',
        description: 'Leading and trailing whitespace'
      },
      {
        type: 'case_sensitivity',
        username: 'STANDARD_USER',
        password: 'SECRET_SAUCE',
        description: 'Uppercase credentials'
      }
    ];
  }

  // Generate random test data
  static generateRandomUser(): TestUser {
    const randomString = Math.random().toString(36).substring(7);
    return {
      username: `user_${randomString}`,
      password: `pass_${randomString}`,
      expectedBehavior: 'error',
      description: 'Randomly generated invalid user'
    };
  }

  // Get all test users (valid + invalid)
  static getAllTestUsers(): TestUser[] {
    return [...this.getValidUsers(), ...this.getInvalidUsers()];
  }
} 