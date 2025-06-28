import 'jest-webextension-mock';
import browser from 'webextension-polyfill';

// Add webRequest mock to browser object
(browser as any).webRequest = {
  onBeforeSendHeaders: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  },
};

// Add windows mock to browser object
(browser as any).windows = {
  create: jest.fn(),
  remove: jest.fn(),
};

// Mock chrome global for Chrome-specific features
(global as any).chrome = {
  ...(global as any).chrome,
  scripting: {
    executeScript: jest.fn().mockResolvedValue([]),
  },
  declarativeNetRequest: {
    updateDynamicRules: jest.fn().mockResolvedValue(undefined),
    RuleActionType: {
      MODIFY_HEADERS: 'modifyHeaders',
    },
    HeaderOperation: {
      REMOVE: 'remove',
    },
    ResourceType: {
      XMLHTTPREQUEST: 'xmlhttprequest',
    },
  },
  runtime: {
    ...(global as any).chrome.runtime,
    id: 'test-extension-id',
  },
};

// Mock fetch globally
(global as any).fetch = jest.fn();

// Mock FileReader
(global as any).FileReader = jest.fn(() => ({
  readAsDataURL: jest.fn(),
  onloadend: jest.fn(),
  result: 'data:text/plain;base64,dGVzdA==',
}));

// Clear all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
});

// Suppress unhandled promise rejection warnings in tests
process.on('unhandledRejection', (reason) => {
  // Ignore expected test rejections
  if (reason && (reason as any).message === 'No receiver') {
    return;
  }
  console.error('Unhandled Rejection:', reason);
});

// Add a dummy test to satisfy Jest
test('setup file loads correctly', () => {
  expect(true).toBe(true);
});