---
description: "Route quoted replies to accepted bot messages in the same conversation."
kind: "package-bundle"
---
# dsh-qq-turn-control

English | [中文](README.zh.md)

## Summary

This development plugin routes an unexpired quote of an accepted bot reply in the same account and conversation. Other messages delegate to the chat plugin's existing policy. The native settings page controls the provider without requiring access to a live QQ account. Unquoted multi-person intent, other-bot identification and automatic dialogue throttling remain unfinished.

## Table of Contents

- [Use and limits](#use-and-limits)
- [Testing and privacy](#testing-and-privacy)

<a id="use-and-limits"></a>
## Use and limits

The bundle requires DSH 0.2.2-rc.1, dsh-im-kit 0.2.0 and the unreleased dsh-qq-chat 0.2.0-development integration branch. It adds an owner settings controller and a runtime row; the policy is disabled by default. Open the bundle in DSH Web, enable quote routing and save. Configure the quote window in milliseconds, maximum conversation count and retained reply IDs per conversation on the same page. Enabling fails if another turn policy already owns the service.

Only accepted delivery receipts from completed model replies enter the bounded in-memory index. Results from another group or account, uncertain delivery and unknown reply IDs never match. Saving the settings or restarting the policy clears this index. Explicitly addressed group messages and private messages remain handled by the Chat plugin's normal rules. A missing or failed policy delegates to those rules; failures emit a local diagnostic.

<a id="testing-and-privacy"></a>
## Testing and privacy

`npm test` builds the package and runs local synthetic routing and controller tests. `npm run test:native -- --im-kit-archive <library.tgz> --chat-archive <chat.tgz>` installs independent packages into an isolated DSH SDK profile and uses a controlled local model endpoint. These tests do not send QQ messages. Native checks cover quoted follow-ups, cross-group isolation, explicit addressing and duplicate suppression; they do not establish real QQ delivery or natural conversation quality.

The policy stores no message body and emits no model-facing prompt. Protect the profile and Chat journal separately. An isolated headless Web profile exercises saved settings and light, dark and narrow layouts. Linux and Desktop, actual QQ transport and unquoted multi-person scenarios still require verification. This development version is not a release candidate.
