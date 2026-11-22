# Live Providers

A frontend extension for the OpenRouter and NanoGPT chat-completion provider pickers in SillyTavern and TauriTavern.

Both apps look up the available providers for the selected model. Live Providers replaces the picker options with the providers returned for the selected model. NanoGPT's Auto choice and pay-as-you-go toggle work as usual.

## Install

Open **Extensions → Install Extension** and paste this URL.

```text
https://github.com/BladeRunn3r/tavern-live-providers
```

## Try it

In **API Connections**, connect to OpenRouter or NanoGPT and choose a model. Open its existing provider picker to see the providers returned for that model. Changing the model triggers a new lookup. On success, the picker keeps your available selections in their existing priority order and shows a notice if it clears an unavailable selection. NanoGPT returns to Auto if it clears your pin. If a lookup fails, the existing options remain. OpenRouter's website default uses the stock provider list because it has no model-specific lookup.

## Maintenance

Live Providers is provided as-is and is not actively maintained. Fixes, feature changes, and continued compatibility with SillyTavern or TauriTavern are not guaranteed, including on the versions listed below.

## Compatibility

The provider routes and picker controls match SillyTavern 1.18.0 and 1.19.0 and TauriTavern 2.4.0 and the November 11, 2026 canary. The extension uses the Chat Completion pickers. NanoGPT provider discovery was confirmed on TauriTavern for Android with version 0.1.0. The rebuilt picker in 0.2.0 has local regression tests.

Run the focused regression tests with `node --test index.test.mjs`.

## License

[MIT](LICENSE)
