# Bambuddy browser extension

A Chrome (Manifest V3) extension that sends models from MakerWorld, Printables and Thingiverse into your self-hosted Bambuddy library. It is not published in a store; you load it unpacked.

## Features

- MakerWorld: Bambuddy imports the model server-side. You pick a profile and a library folder in the popup, and the extension warns if the model is already in your library.
- Printables and Thingiverse: the extension downloads each file and streams it to Bambuddy. It adds the source URL, notes, a thumbnail and (optionally) a tag with the site name.
- Bulk import of MakerWorld collections into Bambuddy folders, with progress, cancel and resume after an interruption.
- Right-click "Save model to Bambuddy" on a model page, or "Save linked model to Bambuddy" on a link to one.
- Keyboard shortcut Alt+Shift+B saves the current page (change it at `chrome://extensions/shortcuts`).
- Desktop notifications and a short toolbar badge show the result.

## Install (unpacked)

1. Open `chrome://extensions` and enable Developer mode.
2. Click "Load unpacked" and select this folder (or the unzipped release zip).
3. Open the extension options, enter your Bambuddy URL and API key, then click "Test connection".

Chrome 116 or newer is required.

## Configure

1. In Bambuddy, go to Settings, API Keys and create a key with the "Manage library" scope.
2. Paste the key and your Bambuddy URL (for example `https://bambuddy.example.com`) into the options page. The extension asks for permission to reach that origin when you save.
3. For MakerWorld, Bambu Cloud must be signed in inside Bambuddy, because Bambuddy does the download.

Other options: upload mode (Auto, Stream, Buffer), max file size in MB (default 250), bulk concurrency (1 to 3), and whether to tag uploads with the site name.

## Usage

- MakerWorld model page: open the popup, choose profile and folder, click "Import to Bambuddy". If it is a duplicate you can open the existing item or import anyway. Paid models may fail.
- Printables model page: the popup lists the .3mf and .stl files; choose a folder and import. Club or paid models are not importable. Files over the size limit ask for confirmation first.
- Thingiverse Thing page: import from the popup. You must be able to view the page normally in that browser (see "Verified site behaviour").
- MakerWorld collection pages: the popup lists collections to import into a parent folder. Progress shows in the popup; use Cancel, or Resume after an interruption.
- Any supported page or link: use the context menu or Alt+Shift+B instead of the popup. Results appear as a notification; click it to open the item in Bambuddy.

## How uploads work

For Printables and Thingiverse the service worker fetches the file and sends it to Bambuddy as a streamed multipart upload, so the whole file is not held in memory. This needs HTTP/2 to your Bambuddy server. In Auto mode, if streaming is not supported (for example HTTP/1.1 or some proxies), the extension falls back to buffering the file in memory. Stream mode never falls back; Buffer mode always buffers. Some reverse proxies reject HTTP/2 request bodies that have no Content-Length (which is how streaming works) with a bare 403. Test connection probes this without side effects and remembers the result; when streaming is not usable, Auto mode uses buffered uploads from the start. If the probe was never run, the extension falls back to buffered uploads automatically after the first stream attempt fails, which costs one extra download of the first file. Nothing is written to your Downloads folder. The max file size setting bounds per-file memory use in buffer mode.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Settings, diagnostics and bulk job state |
| `alarms` | Clears the toolbar badge reliably after the service worker sleeps |
| `contextMenus` | Right-click save entries |
| `scripting` | Reads model metadata and file links from the open model page |
| `notifications` | Result notifications |
| Host access to makerworld.com, printables.com (incl. api, media, files), thingiverse.com (incl. api, cdn) | Read the model page and download files |
| Optional access to any origin | Requested at runtime only for your Bambuddy URL |

## Verified site behaviour

- Printables: the GraphQL API at `api.printables.com` answers requests from the extension, and file links come from `files.printables.com`. Checked with direct requests.
- Thingiverse: unverified. Thingiverse sits behind a Cloudflare check that could not be tested from the development environment. The adapter tries, in order: the Thing's `/zip` download; the individual file links found on the open page; then an error asking you to open the Thing page, pass the Cloudflare check and retry. If Thingiverse saves fail, please report the text from Options, Diagnostics (last error and strategy used per site).
- MakerWorld: relies on Bambuddy's import; behaviour in the live browser has not been exercised by the author's test setup beyond unit tests and API checks.

## Troubleshooting

- "Check your API key": the key is wrong or lacks the "Manage library" scope. Create a new one and re-test.
- Test connection fails: check the URL, that the server is reachable from the browser, and that you granted the origin permission.
- MakerWorld import fails: confirm Bambu Cloud is signed in inside Bambuddy; paid models may not be downloadable.
- "Download returned a web page instead of a file": sign in to the site, or pass its Cloudflare check in a tab, then retry.
- Large uploads fail in Stream mode: switch to Auto or Buffer in Options.
- Anything else: open Options, Diagnostics for the last error per site.

## Firefox

Not supported or tested. The manifest uses `background.service_worker` and the code uses the `chrome.*` namespace. A Firefox port would need `background.scripts` instead of a service worker, `browser.*` (or a polyfill), and would fall back to buffer mode, because Firefox does not support streaming request bodies.

## Development

```
npm test      # node --test test/*.test.js
npm run zip   # needs the external zip binary
```

`npm run zip` writes `dist/bambuddy-extension-<version>.zip` containing `manifest.json`, `src/`, `icons/`, `LICENSE`, `README.md` and `CHANGELOG.md`. `npm run icons` regenerates the icons.

## License

MIT
