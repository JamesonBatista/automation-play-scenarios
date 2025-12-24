import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const projectId = process.env.PROJECT_ID || 'default';
const envId = process.env.ENV_ID || 'default';

// const authDir = path.join(process.cwd(), '.auth');
// const storageStatePath = path.join(authDir, `${projectId}-${envId}.json`);

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  timeout: 60 * 1000,
  expect: { timeout: 10 * 1000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,

  // Login automático (se configurado)

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],

  use: {
    baseURL,
    headless: false,
    viewport: { width: 1366, height: 768 },
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Sessão por projeto+ambiente
    // storageState: storageStatePath
  },

  projects: [
    { name: 'QA', 
      use: { channel: "chrome"}, }
  ],

  outputDir: 'test-results'
});
