---
description: "Route quoted replies to accepted bot messages in the same conversation."
kind: "package-bundle"
---
# dsh-qq-turn-control

English | [中文](README.zh.md)

## Summary

This preview plugin routes an unexpired quote of an accepted bot reply in the same account and conversation. An optional service interface can pass recent context to a separately installed intent classifier; this package does not include a classifier. Without one, other messages delegate to the chat plugin's existing policy. Other-bot identification and automatic dialogue throttling remain unfinished.

## Table of Contents

- [Use and limits](#use-and-limits)
- [Testing and privacy](#testing-and-privacy)

<a id="use-and-limits"></a>
## Use and limits

The bundle requires DSH 0.2.2-rc.1, the public dsh-im-kit 0.2.1 and dsh-qq-chat 0.2.1 packages. It adds an owner settings controller and a runtime row; the policy and optional intent routing are disabled by default. Open the bundle in DSH Web, enable routing and save. Configure quote and context limits on the same page. Enabling fails if another turn policy already owns the service. Intent routing requires an independently registered `qqTurnIntent` service; the page refuses to enable it when that service is absent. A profile configured before the service starts still handles quotes and reports the missing classifier; intent decisions fall back until the service appears. No compatible classifier is distributed in this package.

Only accepted delivery receipts from completed model replies enter the bounded in-memory index. Results from another group or account, uncertain delivery and unknown reply IDs never match. Intent routing holds recent admitted group text and accepted bot replies in memory, bounded by the configured time, scope, message and character limits; a fixed ceiling rejects settings exceeding 64 million retained text characters. The classifier receives only that group's preceding snapshot and candidate with per-call member aliases, including aliases for mentions; an unknown reply is marked without implying its target. User text itself can still contain identifiers. Media types are identified without claiming that their contents were read. Saving settings or restarting the policy clears both indexes. Explicitly addressed group messages and private messages remain handled by the Chat plugin's normal rules. A missing or failed policy delegates to those rules; failures emit a local diagnostic.

Disabling or unloading the policy stops new decisions, cancels and joins its classifier calls, and clears transient windows before disposal completes. Chat journals and classifier Sessions are retained.

<a id="testing-and-privacy"></a>
Download the independent release archive and install it with `dsh plugin --profile <profile> add <archive.tgz>`. The shared library and Chat code resolve through public release dependencies; a working profile must still enable the Chat service. Isolated SDK/Web checks use a pinned pnpm and complete declared required DSH peers without borrowing ancestor dependencies.

## Testing and privacy

`npm test` builds the package and runs local synthetic routing and controller tests. `npm run test:native -- --im-kit-archive <library.tgz> --chat-archive <chat.tgz>` installs independent packages into an isolated DSH SDK profile and uses a controlled local model endpoint. These tests do not send QQ messages. Native checks cover quoted follow-ups, cross-group isolation, explicit addressing and duplicate suppression; they do not establish real QQ delivery or natural conversation quality.

With intent disabled the policy retains no message body. Enabling it retains bounded group text temporarily and passes it to the selected classifier, which owns any model requests and their persistence. Each in-memory group window receives a random opaque context ID for classifier-side session isolation; complete window expiry, eviction or restart changes that ID. The classifier must still bound and isolate its own Sessions. Protect the profile and Chat journal separately. An isolated headless Web profile exercises saved settings and light, dark and narrow layouts. CI records cross-platform execution; Desktop, actual QQ transport, the independent native classifier composition and natural conversation quality still require verification. This preview does not complete natural multi-person dialogue or all bot controls.
