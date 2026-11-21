# Live Providers

A frontend extension for the OpenRouter and NanoGPT chat-completion provider pickers in SillyTavern and TauriTavern.

Both apps look up the available providers for the selected model. Live Providers adds missing entries from that response to the existing picker. NanoGPT's Auto choice and pay-as-you-go toggle work as usual.

## Install

Open **Extensions → Install Extension** and paste this URL.

```text
https://github.com/BladeRunn3r/tavern-live-providers
```

## Try it

In **API Connections**, connect to OpenRouter or NanoGPT and choose a model. Open its existing provider picker to see the providers returned for that model. Changing the model triggers a new lookup. If a lookup fails, the app keeps the existing options and handles the error as usual.

## Maintenance

Live Providers is provided as-is and is not actively maintained. Fixes, feature changes, and continued compatibility with SillyTavern or TauriTavern are not guaranteed, including on the versions listed below.

## Compatibility

The provider routes and picker controls match SillyTavern 1.18.0 and 1.19.0 and TauriTavern 2.4.0 and the November 11, 2026 canary. The extension uses the Chat Completion pickers. Live installs and real generations in the apps still need a device test.

Run the focused regression tests with `node --test index.test.mjs`.

## License

[MIT](LICENSE)
