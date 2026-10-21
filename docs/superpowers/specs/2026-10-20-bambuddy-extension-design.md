# Bambuddy browser extension: design

# Bambuddy browser extension (MV3) — port of the 3D Model Manager extension

## Context
The existing extension at `/home/OLYMPOS/jagannath/projects/3d-model-manager/extension` saves MakerWorld/Thingiverse/Printables pages into 3D Model Manager via that app's `/api/ext/*` routes, pushes a MakerWorld cookie, and syncs "remote collections". The user is moving to **Bambuddy** (v1.2.5.7, `https://bambuddy.azureolympos.com`, auth enabled, Bambu Cloud signed in). Bambuddy has a different API surface, so this is a new standalone repo at `/home/OLYMPOS/jagannath/projects/bambuddy-browser-extension` (empty today), version 0.1.0, same no-bundler ESM + `node --test` style.

Decisions already made with the user:
- All three sites. Printables/Thingiverse files are fetched **into memory by the service worker** and uploaded; nothing touches the Downloads folder.
- Popup shows **profile + folder pickers** before a MakerWorld import; right-click save is one-click (default profile, last folder).
- Old collection sync is replaced by **bulk import of a MakerWorld collection into a Bambuddy folder** (explicit action, no auto-sync on visit).
- Live test instance available. The API key the user pasted in chat must never be written to the repo, tests, or docs; pass it via env var `BB_KEY` during live checks. Recommend the user rotate it when done.

Dropped (no Bambuddy counterpart): cookie courier, `/ext/credentials`, `/ext/collections*`, `/ext/imports` polling, `cookies` permission, `tabs.onUpdated` auto-sync.

## Bambuddy API (verified live via OpenAPI + GETs)
Prefix `/api/v1`, header `X-API-Key: bb_…`, no CORS → every fetch runs in the background service worker with an optional host permission for the Bambuddy origin.
- `GET /auth/status` → `{auth_enabled, requires_setup}`; `GET /makerworld/status` → `{has_cloud_token, can_download, sign_in_expired}`
- `POST /makerworld/resolve {url}` → `{model_id, profile_id|null, design{}, instances[], already_imported_library_ids[]}`
- `POST /makerworld/import {source_type:"makerworld", model_id, profile_id?, instance_id?, folder_id?}` → `{library_file_id, filename, folder_id, profile_id, was_existing}`
- `POST /library/files?folder_id=&generate_stl_thumbnails=` multipart field `file` → `{id, filename, file_type, file_size, thumbnail_path, duplicate_of, metadata}`; `.3mf/.stl/.zip` ok, bare `.gcode` rejected; FAT32-safe names. `POST /library/files/extract-zip` exists.
- `PUT /library/files/{id} {notes?, external_url?(≤500), folder_id?, filename?}`; `POST /library/files/{id}/preview-thumbnail` field `thumbnail`
- `GET/POST /library/folders` (`{name, parent_id?}`), `GET/POST /library/tags` (`{name}`), `POST /library/tags/bulk-assign {file_ids, tag_ids, action}`
- `/api-keys/` is admin-only (403 for API keys) — options page must not call it.

Printables anonymous GraphQL verified live: `print(id){ id name premium user{publicUsername} image{filePath} images{filePath} stls{id name fileSize} gcodes{id name fileSize} otherFiles{id name fileSize} }`; download via `getDownloadLink(printId, files:[{fileType, ids}], source:"model_detail"){ok output{link}}`. Thingiverse is Cloudflare-walled for curl; the extension must use the user's browser session (spike in T1).

## Layout
```
manifest.json  package.json ("type":"module", test: node --test test/*.test.js)
README.md  LICENSE (MIT)  .gitignore   icons/icon{16,32,48,128}.png (scripts/make-icons.mjs, node:zlib)
docs/superpowers/specs/2026-10-20-bambuddy-extension-design.md  (this plan's design section, committed)
src/lib/  (pure, chrome-free, tested)
  detect.js          copy+trim old detect.js; export HOST_PATTERNS as single source for menus (test asserts == manifest host_permissions)
  api.js             rewrite of old api.js: createClient({baseUrl, apiKey, fetchImpl}); X-API-Key; never-throw {ok,status,data,error,kind}; kind ∈ auth|notfound|network|server|client; multipart upload(path, field, blob, filename, query) with 120s timeout
  settings.js        rewrite of config.js: one storage key per field (no read-merge-write → fixes cross-context lost update)
  mwCollections.js   copy old collections.js parsers (parse/extract/findDesignListIn/mapDesignHits/collectionDetailPathnameFrom)
  mwPageReaders.js   port in-page readers from old syncFlow.js (readCollectionsDataInPage, data-route fetch, anchor collector, favorites fallback with encodeURIComponent(handle)); drop hash/push/throttle
  filenames.js       FAT32-safe sanitize, allowed extensions (.3mf .stl .zip .gcode.3mf), notes string builder
  adapters/makerworld.js   resolve→picker model {modelId, defaultProfileId, profiles[], alreadyImported[]}; import body
  adapters/printables.js   GraphQL bodies, parse print, selectFiles (3mf/stl from stls+otherFiles, *.gcode.3mf only from gcodes), thumbnail URL
  adapters/thingiverse.js  id parse, metadata parse, download strategy from T1 spike
  multipartStream.js pure: buildMultipartStream({field, filename, contentType, body: ReadableStream}) → {stream, boundary}; preamble + piped body + epilogue; plus a counting TransformStream for sent-bytes progress. Tested by collecting the stream and parsing it back.
  uploadPipeline.js  per file, sequentially: GET source (Content-Length pre-check, confirm in popup above `maxFileMB` setting default 250) → upload → updateFile{external_url, notes} → setThumbnail (warn-only) → tag (warn-only); returns {ok, fileIds, warnings, duplicateOf}; any failed upload ⇒ ok:false.
                     Upload mode, default = STREAM: pipe the source body through the counting transform into buildMultipartStream and POST with `body: stream, duplex: "half"` (no Content-Length; needs HTTP/2 or HTTP/3, which Chrome requires for streaming request bodies). Peak memory ≈ one chunk.
                     Fallback = BUFFER: if the streaming POST rejects with the HTTP/1.1 TypeError (or the origin is already known to be h1), re-fetch the source once, read chunks → Blob (progress callback) → FormData upload. The chosen mode is cached per Bambuddy origin in settings (`uploadMode`), seeded by Test connection via `PerformanceResourceTiming.nextHopProtocol` (h2/h3 → stream, http/1.1 → buffer). Buffer mode also used for retry after a mid-stream upload failure.
                     Tests: stream mode builds a valid multipart body and reports progress; h1 rejection flips to buffer mode and re-fetches exactly once; mode cache honored on the next file.
  bulkJob.js         pool runner (concurrency 2, max 3), AbortController cancel, skip set, per-item results, summary
  router.js          message dispatch {type → handler(deps)}; handlers: save, getPickerData, listFolders, testConnection, startBulk, cancelBulk, getJob
src/background.js    thin chrome wiring; src/execInTab.js (the ONE executeScript wrapper)
src/popup.{html,js}  src/options.{html,js}
test/*.test.js + test/helpers/{fakeChrome.js,fakeFetch.js}
```

Manifest: permissions `storage, alarms, contextMenus, scripting, notifications` (+ `declarativeNetRequestWithHostAccess` only if Printables spike needs Origin rewrite); host_permissions for makerworld, printables (www, api, media, download CDN host seen in spike), thingiverse (www, api, cdn); optional_host_permissions `http://*/*`, `https://*/*`; `commands.save-current-page` (Alt+Shift+B); `icons`; `options_ui {open_in_tab:true}`; `minimum_chrome_version "116"`.

## Old bugs fixed by design
Per-field storage (no lost update); 401/404 no longer transient (`kind`); partial failure ⇒ not success; `encodeURIComponent(handle)`; alarm-based badge clear; single `execInTab` and single host-pattern list; `load().catch`; https warning; background/popup logic moved into tested `router.js`/helpers; whole-cache-replace bug is moot.

## Enhancements shipped in 0.1.0
Profile/folder pickers, duplicate detection before import, "Open in Bambuddy" deep link (folder route to be confirmed in UI; fallback base URL), bulk collection import with resume, keyboard shortcut, completion notification, site tag + source URL + designer notes + site thumbnail on uploads, Test connection showing cloud sign-in state.
Deferred: recent-imports panel, per-site default folders, Printables/Thingiverse collection bulk import, Firefox build.

## Unverified assumptions (settle in T1 or first live run)
1. Thingiverse: SW passes Cloudflare with session cookies; `/zip` still exists. 2. Printables: api accepts extension Origin, DNR can rewrite Origin for SW requests; download-link host. 3. Bambuddy File Manager deep-link route. 4. `findDesignListIn` field names carried over from old code. 5. SW keep-alive during long bulk jobs (resume path is the safety net). 6. `extract-zip` accepts `folder_id` and returns created ids. 7. `PUT /library/files/{id}` accepts `external_url` under the key's scope. 8. Bambuddy's reverse proxy and Starlette accept a chunked multipart request body with no Content-Length over h2 (expected yes; buffer fallback covers a no).

## Verification
- Unit: `node --test test/*.test.js` after every task.
- Live API with `BB_KEY` env var: auth/status, makerworld/status, resolve a known model, list folders, upload a tiny .stl to a scratch folder then PUT notes/external_url, delete it in the UI.
- Chrome via chrome-devtools MCP: load unpacked → options Test connection; MakerWorld import with changed profile/folder, re-import shows `was_existing`; right-click link save, badge clears ~3s with idle SW; Printables and Thingiverse uploads show thumbnail + external_url in Bambuddy; bulk-import a 3–5 item collection, close popup mid-run, reopen shows progress, cancel, re-run shows skips; Downloads folder stays empty.
