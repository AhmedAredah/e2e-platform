# @e2e-cpp/oauth

> Fork installation: these package names are local release identities. Use the
> checksummed kit in [INSTALL_CPP.md](../../INSTALL_CPP.md), or pack the needed
> workspace module locally. Registry availability is not established.

Sign in to a personal AI subscription once, then use it as a [Vercel AI SDK](https://ai-sdk.dev) model.

| Plan | Login | Model |
| --- | --- | --- |
| ChatGPT Plus/Pro (the Codex sign-in) | `npx --no-install e2e-cpp-oauth login openai` | `chatgpt('gpt-5.5')` from `@e2e-cpp/oauth/chatgpt` |
| GitHub Copilot | `npx --no-install e2e-cpp-oauth login github-copilot` | `copilot('claude-sonnet-5')` from `@e2e-cpp/oauth/copilot` |
| SuperGrok / X Premium+ | `npx --no-install e2e-cpp-oauth login spacexai` | `grok('grok-4')` from `@e2e-cpp/oauth/grok` |

Each subpath needs its provider package: `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, or `@ai-sdk/xai`.

```ts
import { generateText } from 'ai';
import { chatgpt } from '@e2e-cpp/oauth/chatgpt';

const { text } = await generateText({ model: chatgpt('gpt-5.5'), prompt: 'Hello' });
```

How it works: the login runs the vendor's OAuth flow (PKCE with a local callback, or an RFC 8628 device code) and stores the tokens in `~/.config/e2e-cpp/oauth.json` with mode 0600. The model is the vendor's own AI SDK provider constructed with a `fetch` that reads the stored login per request, refreshes it ahead of expiry (once, however many calls race), replaces the SDK's key header with the bearer token, and applies what the vendor needs beyond that: the Codex backend URL and body shape for ChatGPT, the initiator and vision headers for Copilot.

For your own product, `createOAuthFetch(provider, { store, userAgent })` is the `fetch` any provider factory accepts, `login(providerId, { callbacks })` runs a flow with your prompts, and `OAuthProvider` is the interface a new vendor implements. Set `userAgent` and `originator` to your product's name.

Claude Pro/Max is not included: Anthropic permits subscription sign-in only for its own applications.

The fork documentation is in [`docs/subscriptions.mdx`](../../docs/subscriptions.mdx).

OAuth token exchanges, refreshes and each device request have a 30-second
network deadline, including reading the response. Device polls also respect the
remaining code lifetime. Aborting a model request stops that caller's wait;
a concurrent caller can finish the shared refresh. Custom providers receive an
optional signal in `refresh(credentials, signal)` and should honor it.
`createOAuthFetch` accepts `refreshTimeoutMs` for a different shared refresh bound.

Provider error bodies are limited to 64 KiB. Diagnostics redact submitted grant
values, remove control characters and are limited to 512 characters. This does
not discover unknown or transformed secrets in arbitrary provider output.
