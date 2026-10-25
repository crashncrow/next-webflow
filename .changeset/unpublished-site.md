---
"next-webflow": patch
---

Live reads of a site that was never published (Webflow answers 409, "The site is not published.") return an empty list, or `null` for `getItemBySlug` and `getItem`, the same way a never-published collection's 404 already did, instead of throwing and failing the build.
