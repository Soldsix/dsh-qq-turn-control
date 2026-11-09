---
kind: upgrade-guide
description: Automatic continuations now have group budgets and uncertain intent decisions no longer invoke same-sender fallback.
---
# Multi-person reply control

## Change

With intent routing enabled, classifier `reply` decisions reserve at most 3 automatic reply attempts per group per 60 seconds, at least 8 seconds apart by default. `default` is treated as ignore. Ordinary explicit mentions and recognized quotes of bot replies bypass this budget. A known reply or mention to another member is ignored without classification. The optional classifier receives bounded quote-target text and the recipient alias of bot replies.

Configured `botIds` have separate per-sender and group limits, including explicit mentions; their unaddressed messages are ignored. No automatic bot identity detection is provided. Reservations count attempts even when generation or delivery fails. State is transient and resets on eviction, expiry, settings reload or restart.

## Migration

1. Update this bundle and its pinned Chat dependency to dsh-qq-chat 0.2.2. Chat must support `ChatTurnPolicy.guard()`; older Chat versions do not enforce the bot limits.
2. On the native bundle page, review `ambientWindowMs`, `minAmbientGapMs`, and `maxAmbientReplies`. Use zero maximum attempts for explicit-addressing-only operation, or zero gap to remove the spacing requirement. Explicit ordinary mentions and recognized quotes remain allowed.
3. Enter other bots' authenticated sender IDs in `botIds`; review `botWindowMs`, `maxBotReplies`, and `maxBotGroupReplies`. Never derive identities from display names or user text.
4. Save and test A asking the bot, B challenging its answer, B quoting another member, and concurrent bot mentions. No persona, SQLite, durable Session, archive or memory migration is required. This package controls Chat replies, not independently scheduled media sends.
