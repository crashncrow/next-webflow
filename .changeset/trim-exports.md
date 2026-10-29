---
"next-webflow": minor
---

Removed internal helpers from the public entry points before the stable release: `UNSIGNED_WEBHOOK_MESSAGE` (`next-webflow/webhook`), and `safeRelativePath`, `DEFAULT_PREVIEW_EXPIRES_IN_SECONDS` and `DEFAULT_MAX_PREVIEW_LIFETIME_SECONDS` (`next-webflow/draft`). The defaults stay documented (1 hour, 30 days). `ExitPreviewLink` (`next-webflow/components/client`) is now documented in the README for custom draft banners.
