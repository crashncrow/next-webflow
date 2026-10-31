---
"next-webflow": minor
---

New `WebflowCollectionNotFoundError` (a subclass of `WebflowConfigError`, so existing `catch`es still match) when the site has no collection with the requested slug. The draft route uses it to tell setup problems from unknown collections: a missing token, `fetch` or site ID now answers 500 "Draft mode isn't configured: …" (and logs a warning) instead of 404 "Collection not found", and other API errors, such as a wrong site ID, are no longer reported as an unknown collection.
