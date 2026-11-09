---
description: "Route quoted replies to accepted bot messages in the same conversation."
kind: "package-bundle"
---
# dsh-qq-turn-control

English | [中文](README.zh.md)

## Summary

This preview routes quotes of accepted bot replies and supplies bounded, speaker-aware context to an optional independent intent classifier. It limits automatic continuations per group and throttles explicitly configured bot senders. Ordinary explicit mentions and known quotes bypass the human continuation budget. Bot identity is configured by the operator, never inferred from member text; this package contains no language model classifier.

## Table of Contents

- [Use and limits](#use-and-limits)
- [Testing and privacy](#testing-and-privacy)

<a id="use-and-limits"></a>
## Use and limits

The bundle requires DSH 0.2.2-rc.1, dsh-im-kit 0.2.1 and dsh-qq-chat 0.2.3. It adds an owner settings controller and a runtime row; routing and intent are disabled by default. In the DSH Web bundle page, enable routing, configure quote/context/frequency limits, and save. Another policy cannot be replaced implicitly. Intent requires a separately registered `qqTurnIntent` service; the page refuses to enable it while absent. Quote routing remains available without that service.

Only accepted delivery receipts from completed model replies enter the bounded in-memory quote index. Account and conversation must match; uncertain deliveries and unknown IDs never match. Intent context holds admitted text and accepted replies with time, scope, message and character limits and a 64-million-character settings ceiling. Call-local aliases identify speakers, mentions, known quote targets and the recipient of a bot answer. Unknown quotes imply no recipient. User text may still contain identities; media labels reveal no contents. A known quote or mention addressed to another member is ignored without classification. Private messages are unchanged.

Unquoted continuations selected by the classifier or the basic Chat trigger reserve at most 3 attempts per group per 60 seconds, at least 8 seconds apart by default. `default` becomes ignore; classifier errors are diagnosed by Chat and do not trigger a same-sender fallback. Explicit ordinary mentions and known bot quotes bypass this ambient budget. Configure `botIds` as authenticated sender IDs to limit other bots to 3 attempts each and 6 total per group per 60 seconds; their unaddressed messages are ignored. All limits are editable, reservations are synchronous, and failed generation or delivery still consumes an attempt. Saving, eviction, expiry or restart resets transient state. Disabling cancels and joins owned calls; Chat journals, memory and classifier Sessions are retained. See the [upgrade guide](docs/upgrade-guide/v0.1.0/conservative-multi-party/guide.md).

<a id="testing-and-privacy"></a>
Download the independent release archive and install it with `dsh plugin --profile <profile> add <archive.tgz>`. The shared library and Chat code resolve through public release dependencies; a working profile must still enable the Chat service. Isolated SDK/Web checks use a pinned pnpm and complete declared required DSH peers without borrowing ancestor dependencies.

## Testing and privacy

`npm test` builds the package and runs local synthetic routing and controller tests. `npm run test:native -- --im-kit-archive <library.tgz> --chat-archive <chat.tgz>` installs independent packages into an isolated DSH SDK profile and uses a controlled local model endpoint. These tests do not send QQ messages. Native checks cover quoted follow-ups, cross-group isolation, explicit addressing and duplicate suppression; they do not establish real QQ delivery or natural conversation quality.

With intent disabled no message body is retained here. With intent enabled bounded group text goes to the selected classifier, which owns model requests and their durable Sessions. Each transient group window has a random context ID, replaced on complete expiry, eviction or restart. Synthetic tests include three distinct 15-member routing cases and parallel reservations; their controlled classifier is not a language-intelligence benchmark. Native SDK and isolated headless Web tests exercise installed bundles; real QQ delivery, Desktop, other-bot identity discovery, natural conversation quality and per-media meme throttling require separate verification. This policy controls Chat reply attempts, not standalone background sends.
