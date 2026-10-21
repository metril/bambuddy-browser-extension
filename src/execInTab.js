// Run `func(...args)` in the page's MAIN world; returns the first frame's result.
export async function execInTab(tabId, func, args = []) {
  try {
    const [first] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: 'MAIN' });
    return first?.result;
  } catch (e) {
    throw new Error(`Cannot read the page (tab unreachable): ${e?.message || e}`);
  }
}
