# Kubo — DONE

Issue prefix: `KUBO-xxx`

Completed work, most recent first.

## 2026-04-21

- **KUBO-030: Rebrand Android shell to Kubo** — `a2020d2e` (merged as `b937160c`)
  `applicationId` / launcher label / Capacitor `appId` / `appName` switched from `pub.ditto.app` / Ditto to `com.kubo.app` / Kubo. `versionName` reset to `0.1.0` — fresh Kubo lineage, not a continuation of Ditto's 2.10.2. Kept `namespace = pub.ditto.app` so the five native Java sources under `android/app/src/main/java/pub/ditto/app/` compile unchanged (invisible to users). Built a debug APK and shipped it as GitHub release [`kubo-v0.1.0`](https://github.com/JeroenOnNostr/kubo/releases/tag/kubo-v0.1.0) with `kubo-v0.1.0-debug.apk` attached. Follow-ups deferred: Kubo launcher icon, Java-package move to `com.kubo.app`, real release-signing keystore, `ditto.pub` deep-link filter cleanup.
