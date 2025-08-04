export const getActiveTabOrigin = async (): Promise<{ placeholderURL: string; inputText: string }> => {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.url && tabs[0].url.startsWith('http')) {
      const currentURL = new URL(tabs[0].url);
      return {
        placeholderURL: currentURL.origin,
        inputText: currentURL.origin
      };
    }
  } catch (e) {
    console.log("Unable to get active tab origin:", e);
  }
  
  return {
    placeholderURL: "https://www.audiogata.com",
    inputText: ""
  };
};