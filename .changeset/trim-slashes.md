---
"next-webflow": patch
---

Request URLs trim slashes with a loop instead of a regular expression that took quadratic time on long runs of `/` (reported by CodeQL). URLs, and therefore cache keys, are unchanged.
