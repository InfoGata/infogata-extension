import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContentMessage, ManifestAuthentication } from '../src/types';

// Mock the @emoji-gen/clone-into module
vi.mock('@emoji-gen/clone-into', () => ({
  cloneInto: vi.fn((obj) => obj)
}));

describe('InfoGata hook functionality', () => {
  let mockWindow: any;
  let messageEventListeners: ((event: MessageEvent) => void)[] = [];

  beforeEach(() => {
    messageEventListeners = [];
    
    mockWindow = {
      postMessage: vi.fn(),
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') {
          messageEventListeners.push(listener);
        }
      }),
      removeEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') {
          const index = messageEventListeners.indexOf(listener);
          if (index > -1) {
            messageEventListeners.splice(index, 1);
          }
        }
      }),
      Promise: global.Promise
    };

    global.window = mockWindow as any;
    vi.clearAllMocks();
  });

  describe('message passing', () => {
    it('should send getVersion message correctly', () => {
      let messageId = 0;
      const getMessageId = () => ++messageId;
      
      const sendMessage = (message: any) => {
        mockWindow.postMessage(message, '*');
      };

      const uid = getMessageId();
      sendMessage({ type: 'infogata-extension-getversion-hook', uid });
      
      expect(mockWindow.postMessage).toHaveBeenCalledWith(
        { type: 'infogata-extension-getversion-hook', uid: 1 },
        '*'
      );
    });

    it('should send network request message correctly', () => {
      let messageId = 0;
      const getMessageId = () => ++messageId;
      
      const sendMessage = (message: any) => {
        mockWindow.postMessage(message, '*');
      };

      const url = 'https://api.example.com/data';
      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' })
      };
      const options = { useProxy: true };
      const uid = getMessageId();

      const cleanInit = {
        headers: init.headers,
        mode: init.mode,
        method: init.method,
        signal: init.signal,
        credentials: init.credentials,
        body: init.body,
      };

      sendMessage({
        type: 'infogata-extension-request',
        input: url,
        init: cleanInit,
        uid,
        options,
      });
      
      expect(mockWindow.postMessage).toHaveBeenCalledWith({
        type: 'infogata-extension-request',
        input: url,
        init: cleanInit,
        uid: 1,
        options
      }, '*');
    });

    it('should send openLoginWindow message correctly', () => {
      const sendMessage = (message: any) => {
        mockWindow.postMessage(message, '*');
      };

      const auth: ManifestAuthentication = {
        loginUrl: 'https://auth.example.com/login',
        cookiesToFind: ['session_token']
      };
      const pluginId = 'test-plugin-123';
      
      sendMessage({ type: 'infogata-extension-openlogin-hook', auth, pluginId });
      
      expect(mockWindow.postMessage).toHaveBeenCalledWith({
        type: 'infogata-extension-openlogin-hook',
        auth,
        pluginId
      }, '*');
    });
  });

  describe('message filtering', () => {
    it('should filter messages by uid', () => {
      const targetUid = 123;
      const wrongUid = 456;
      
      const messageFilter = (e: MessageEvent<ContentMessage>) => {
        if (e.source !== mockWindow || !e.data || ('uid' in e.data && e.data.uid !== targetUid)) {
          return false;
        }
        return true;
      };

      // Test correct uid
      const correctMessage = {
        source: mockWindow,
        data: { type: 'test', uid: targetUid }
      } as unknown as MessageEvent<ContentMessage>;
      
      expect(messageFilter(correctMessage)).toBe(true);

      // Test wrong uid
      const wrongMessage = {
        source: mockWindow,
        data: { type: 'test', uid: wrongUid }
      } as unknown as MessageEvent<ContentMessage>;
      
      expect(messageFilter(wrongMessage)).toBe(false);
    });

    it('should filter messages by source', () => {
      const messageFilter = (e: MessageEvent<ContentMessage>) => {
        if (e.source !== mockWindow || !e.data) {
          return false;
        }
        return true;
      };

      // Test correct source
      const correctMessage = {
        source: mockWindow,
        data: { type: 'test' }
      } as unknown as MessageEvent<ContentMessage>;
      
      expect(messageFilter(correctMessage)).toBe(true);

      // Test wrong source
      const wrongMessage = {
        source: {},
        data: { type: 'test' }
      } as unknown as MessageEvent<ContentMessage>;
      
      expect(messageFilter(wrongMessage)).toBe(false);
    });

    it('should filter messages without data', () => {
      const messageFilter = (e: MessageEvent<ContentMessage>) => {
        if (e.source !== mockWindow || !e.data) {
          return false;
        }
        return true;
      };

      const messageWithoutData = {
        source: mockWindow,
        data: null
      } as unknown as MessageEvent<ContentMessage>;
      
      expect(messageFilter(messageWithoutData)).toBe(false);
    });
  });

  describe('message ID generation', () => {
    it('should increment message IDs correctly', () => {
      let messageId = 0;
      const getMessageId = () => ++messageId;
      
      expect(getMessageId()).toBe(1);
      expect(getMessageId()).toBe(2);
      expect(getMessageId()).toBe(3);
    });
  });
});