# @e2e-cpp/native

An `@e2e-cpp/core/engine` plugin for a cooperating native application, including Qt
Widgets and Qt Quick applications using the reference helper. Tests remain TypeScript;
the application can be C++. No AI is required for locator-based tests. `modelPolicy: 'forbid'` blocks the
built-in model path; explicitly supplied custom executors remain trusted project code.

```ts
import { qt } from '@e2e-cpp/native';

export default {
  modelPolicy: 'forbid',
  targets: [{
    engine: qt(),
    app: { appPath: './build/my-application', launchArguments: ['--test-profile'] },
  }],
};
```

Include the helper in the application and enable it only in a controlled test
build. It must implement the authenticated [protocol](PROTOCOL.md). This package
does not discover/control arbitrary installed Qt applications. `app.open()`
starts the pinned executable. `app.restart()` starts it again; no state-reset
or back-navigation capability is claimed. Each attempt owns its process tree.

`native(options)` defaults to platform `desktop`; `qt(options)` defaults to
`qt`. Options are `actions`, `keyboard`, `screenshots`, `launchTimeout`,
`requestTimeout`, `maxMessageBytes`, `platform`, and `cwd`. The declared action
subset must be supported by the helper. Defaults: the nine basic Qt actions
listed in the protocol, keyboard/screenshots enabled, a 30-second launch
timeout, a 10-second request timeout, a 16 MiB frame bound, and one worker.
Supply `appPath` and optional `launchArguments`; `app.command`, URL, bundle ID
and permission provisioning are not a native launch interface here.

The layers can be extended by inheritance:

```ts
import { NativeEngine, RpcNativeDriver, type NativeDriver, type NativeTransport } from '@e2e-cpp/native';

class ProjectDriver extends RpcNativeDriver {
  // Add explicitly typed project operations, preserving the base contract.
}

class ProjectEngine extends NativeEngine {
  protected override createDriver(transport: NativeTransport): NativeDriver {
    return new ProjectDriver(transport);
  }
}

const engine = new ProjectEngine({ screenshots: false }).handle();
```

`NativeTransport` defines bounded serialized request/close operations;
`JsonRpcTcpTransport` implements loopback JSON-RPC. `NativeDriver` defines
typed application operations; `RpcNativeDriver` validates protocol responses.
`NativeEngine` owns the e2e lifecycle, process supervision, and capabilities.
Override `createTransport` or `createDriver` rather than duplicating lifecycle
code. Custom drivers are trusted application code and must preserve masking,
actionability, cancellation, and uncertain-mutation rules.

Qt event injection tests application event handling. The included Widgets and
Quick adapters cover selected controls; the reference Quick workflow has Linux
offscreen verification. This does not qualify global OS focus/input, native OS
dialogs, WebEngine/CEF/WebView2 or other toolkits. Those capabilities need their
own adapters and validation. Screenshots require source masking. Tests must
provide isolated persistent-data paths when settings/files can influence later
tests. See the protocol for exact bounds.

## Release contract hardening

Locators fail on truncated trees because neither absence nor uniqueness can be proved.
Mutating protocol methods must acknowledge with `null`; malformed acknowledgements fail
as an uncertain action. Cleanup attempts every owned resource even if an extension hook
throws, including a transport acquired before driver construction fails. An already
cancelled restart leaves the current application running. Protocol faults are retained
as attempt failures even after the last successful reply. Bridge disconnects are
reported separately from confirmed process exits.
Unterminated final stdout/stderr lines use the same bounded decoding and redaction path.

Qt selects the global modal or focused window before its toolkit adapter. It discards
screenshots captured across tree or geometry changes and retries a fresh capture at most
twice; persistent instability returns `POLICY_DENIED`. This covers marked secure controls
in the cooperative tree, not arbitrary application copies of secrets in custom painting.
