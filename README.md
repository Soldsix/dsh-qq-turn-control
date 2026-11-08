# dsh-qq-turn-control

Development plugin for optional quote-aware routing. It recognizes only an unexpired quote of an accepted bot reply in the same account and conversation; other messages delegate to the chat plugin's existing policy. The plugin keeps bounded reply IDs in memory and resets them on restart. It does not infer unquoted multi-person intent or identify other bots.

This source requires the unreleased `codex/turn-control-integration` chat branch, DSH 0.2.2-rc.1, and dsh-im-kit 0.2.0. The bundle is disabled by default. It has not yet received native profile, UI, or real QQ acceptance and is not a release candidate.
