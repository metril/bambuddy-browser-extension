# Changelog

## 0.1.1

- Pages with locale prefixes such as zh-hans, pt-br or en-US are now recognised.
- The keyboard shortcut can read the active tab on any page (adds the activeTab permission).
- The first profile is selected when a model's default profile is not in its list.
- Printables and Thingiverse uploads now enforce the size limit while streaming, even when the site sends no file size.
- The done view marks files already in your library and lists skipped files with the reason.
- The shortcut and menu say "Not a supported model page" when there is nothing to save.
- A failed progress write can no longer interrupt a bulk import.
- Resume checks that the saved tab is still a MakerWorld collections page.
- Plain hostnames such as http://bambuddy:8000 no longer trigger the unencrypted-key warning.
- A stalled stream test is treated as blocked, so buffer mode is used without re-testing on every save.
- Test connection reminds you that write access is only verified on the first upload.
- GitHub Actions CI and tag-driven release workflow that publishes the zip and its sha256.

## 0.1.0

Initial release.

- Save MakerWorld models through Bambuddy's server-side import, with profile and folder pickers and duplicate detection.
- Save Printables and Thingiverse models by streaming the files from the site into Bambuddy, with source URL, notes, thumbnail and an optional site tag.
- Bulk import of MakerWorld collections into Bambuddy folders, with progress, cancel and resume.
- Right-click "Save model to Bambuddy" on pages and links, and the Alt+Shift+B shortcut.
- Notifications and a toolbar badge for results.
- Options page: connection test, upload mode (auto, stream, buffer), size limit, bulk concurrency, and a Diagnostics panel with the last error per site.
