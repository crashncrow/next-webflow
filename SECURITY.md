# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through GitHub: on this repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/crashncrow/next-webflow/security/advisories/new)).

Include what's affected (version or commit, entry point such as `next-webflow/webhook`), how to reproduce it, and what an attacker could do. Don't include real tokens or secrets.

You'll get an answer as soon as possible. Once a fix is ready, we'll agree on when to publish the advisory and credit you if you want.

## Supported versions

next-webflow is in pre-release (`0.1.0` betas). Fixes go into the latest version only.

## Scope

In scope: this library's code, the CLI and the example app. For example: webhook signature verification, signed preview links and the draft route, Basic auth for the drafts page, and Rich Text sanitizing.

Out of scope here: problems in Webflow, Next.js, OpenNext or Cloudflare. Report those to their maintainers. If one of them affects how next-webflow should be used, an issue describing the impact on next-webflow (without exploit details) is welcome.
