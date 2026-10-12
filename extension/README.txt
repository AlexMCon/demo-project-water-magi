WaterMagician Downloader 1.2.0

Activate the update
-------------------
Load this extension folder using Chrome's "Load unpacked" button. If you already
use the Downloads/watermagician-ext copy, you can keep using that installed copy
or load this repository's extension folder instead.
1. Open chrome://extensions.
2. Find WaterMagician Downloader and click its Reload button. Enable Developer
   mode if necessary to show the unpacked extension controls.
3. Refresh the chapter tab so the updated content scripts are loaded.
4. Use the existing chapter selection, skipped pages, and Start button.

What changed
------------
The downloader now reads /api/v1/chapters/<id> for chapter reader URLs such as
/title/<title-slug>/<id>-chapter-<number>. On comix.to it generates the _ query
parameter and decodes the response using the site's currently loaded secure
module. This handles the current kid-prefixed tokens and x-enc: 2 responses.

page-codec.js runs in the page's MAIN world. It finds the same-origin secure
module already loaded by the site and obtains its request/response handlers by
registering them on a small client adapter. It does not replace the site's
network functions. Only requests for the chapter open in the current reader
tab are accepted. Results are passed to the isolated downloader by messages.

chapter-api.js retains the old three-stage codec for compatibility with the
previous format and supports ordinary status/result responses and unwrapped
chapter objects as well.

content.js uses the decoded page count and image URLs. When a page is rendered
on canvas, it saves that rendered image as before, since the site may have
processed the original image. Other pages can download directly from API URLs.
If the API is unavailable or decoding fails, the rendered-page method remains
available. Failed images are retried and missing pages are reported.

Direct downloads keep the image's actual extension (.webp, .jpg, .png, .gif,
or .avif). Canvas output remains .webp. HTTP error pages and unrecognized image
responses are rejected instead of being saved as images. Out-of-range entries
in the skipped-page list do not reduce the expected page count.
Image requests use referrerPolicy: no-referrer, matching the current reader.
DOM fallback accepts normal HTTP image URLs including the current /hi/ path.

How the pieces fit
------------------
manifest.json loads page-codec.js in the MAIN world on comix.to, and loads
chapter-api.js before content.js in the isolated content-script world. The API
helper uses native browser APIs; no Node runtime is needed in the extension.
Chrome documents script ordering and isolated worlds here:
https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

The chapter request is same-origin. Cross-origin image requests remain subject
to the site's CORS rules, which is one reason the canvas path remains useful:
https://developer.chrome.com/docs/extensions/develop/concepts/network-requests

Validation
----------
Run from this folder:
  node --test tests/chapter-api.test.cjs tests/page-codec.test.cjs

All 20 tests passed. They cover the supplied encrypted sample and all 22 page
records, exact re-encoding, a request-signature vector from the original codec,
plaintext compatibility, HTTP and decoding errors, timeouts, relative URLs,
image format detection, skip behavior, rendered-canvas preference, fallback,
and missing-page reporting. They also cover current-codec bridge handling,
origin/chapter restrictions, message correlation, HTTP errors, no-referrer
image requests, and the /hi/ DOM fallback. Network, DOM, and file writes are
mocked in these automated regression tests.

Live test on 2026-10-12:
https://comix.to/title/emenr-tokyo-ghoulre/10044830-chapter-1

The old 1.1.0 token received HTTP 403 invalid_token. The 1.2.0 page-module
integration received HTTP 200 with x-enc: 2 and recovered all 48 page records.
The extension's Start button downloaded and wrote 48/48 images (70,392,178 bytes).
For automation, its directory picker was redirected to a browser-private test
directory; the real API, image requests, UI, and file-writing code ran normally.
The test files are exported to Downloads/watermagician-live-test-20261012.

The embedded legacy constants match secure-tm8ho8-BG12c_J_.js. Current comix.to
downloads reuse the loaded secure module instead. If its exported interceptor
interface changes, the extension reports the API problem and uses DOM fallback.

The packaged ZIP contains the extension and this README. Tests and fixtures
are retained in the working folder, outside the packaged ZIP.
