import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getActiveTabOrigin } from './tab-utils';

// Mock lit-html and its directives
vi.mock('lit-html', () => ({
  html: vi.fn((strings, ...values) => ({ strings, values })),
  render: vi.fn()
}));

vi.mock('lit-html/directives/unsafe-svg.js', () => ({
  unsafeSVG: vi.fn(content => content)
}));

// Mock CSS import
vi.mock('./popup.css', () => ({}));

// Mock SVG imports
vi.mock('../assets/add-icon.svg?raw', () => ({ default: '<svg>add</svg>' }));
vi.mock('../assets/delete-icon.svg?raw', () => ({ default: '<svg>delete</svg>' }));
vi.mock('../assets/error-icon.svg?raw', () => ({ default: '<svg>error</svg>' }));

// `tabs.query` is overloaded with a promise form and a callback form. `vi.spyOn`
// infers the last overload, which returns void, so the resolved tabs have to be
// widened past that signature to reach the promise form the code actually calls.
const mockTabsQuery = (tabs: { url?: string }[]) =>
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue(tabs as never);

describe('getActiveTabOrigin', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('should return active tab origin when tab has http URL', async () => {
    const mockTabs = [{ url: 'https://example.com/page' }];
    mockTabsQuery(mockTabs);

    const result = await getActiveTabOrigin();

    expect(result).toEqual({
      placeholderURL: 'https://example.com',
      inputText: 'https://example.com'
    });
    expect(fakeBrowser.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it('should return default values when tab URL does not start with http', async () => {
    const mockTabs = [{ url: 'chrome://settings/' }];
    mockTabsQuery(mockTabs);

    const result = await getActiveTabOrigin();

    expect(result).toEqual({
      placeholderURL: 'https://www.audiogata.com',
      inputText: ''
    });
  });

  it('should return default values when no tabs are returned', async () => {
    mockTabsQuery([]);

    const result = await getActiveTabOrigin();

    expect(result).toEqual({
      placeholderURL: 'https://www.audiogata.com',
      inputText: ''
    });
  });

  it('should return default values when tab has no URL', async () => {
    const mockTabs = [{}];
    mockTabsQuery(mockTabs);

    const result = await getActiveTabOrigin();

    expect(result).toEqual({
      placeholderURL: 'https://www.audiogata.com',
      inputText: ''
    });
  });

  it('should return default values and log error when browser.tabs.query throws', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(fakeBrowser.tabs, 'query').mockRejectedValue(new Error('Permission denied'));

    const result = await getActiveTabOrigin();

    expect(result).toEqual({
      placeholderURL: 'https://www.audiogata.com',
      inputText: ''
    });
    expect(consoleSpy).toHaveBeenCalledWith('Unable to get active tab origin:', expect.any(Error));
    
    consoleSpy.mockRestore();
  });

  it('should handle URLs with paths and query parameters correctly', async () => {
    const mockTabs = [{ url: 'https://music.youtube.com/watch?v=123&list=456' }];
    mockTabsQuery(mockTabs);

    const result = await getActiveTabOrigin();

    expect(result).toEqual({
      placeholderURL: 'https://music.youtube.com',
      inputText: 'https://music.youtube.com'
    });
  });

  it('should handle URLs with non-standard ports', async () => {
    const mockTabs = [{ url: 'http://localhost:3000/app' }];
    mockTabsQuery(mockTabs);

    const result = await getActiveTabOrigin();

    expect(result).toEqual({
      placeholderURL: 'http://localhost:3000',
      inputText: 'http://localhost:3000'
    });
  });
});

describe('popup-script initialization', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.clearAllMocks();
    
    // Mock document.body
    global.document = {
      body: {}
    } as any;
  });

  it('should use default origins when no stored origins exist', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockResolvedValue({} as never);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockResolvedValue(undefined);
    mockTabsQuery([{ url: 'https://example.com' }]);
    
    // Import the module to trigger initialization
    await import('./popup-script');
    
    // Allow async initialization to complete
    await new Promise(resolve => setTimeout(resolve, 0));
    
    expect(fakeBrowser.storage.local.get).toHaveBeenCalledWith(['origins']);
    expect(fakeBrowser.storage.local.set).toHaveBeenCalledWith({
      origins: JSON.stringify(['https://www.audiogata.com', 'https://www.videogata.com', 'https://www.readergata.com', 'https://www.socialgata.com'])
    });
  });
});