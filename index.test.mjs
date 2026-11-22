import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const openrouter = '/api/openrouter/models/providers';
const nanogpt = '/api/nanogpt/models/providers';

class Option {
    constructor(text, value, _defaultSelected = false, selected = false) {
        Object.assign(this, { text, value, disabled: false, selected });
    }
}

function host({
    source, settings = {}, fetch,
    fetchEndpoints = async () => new Response(null, { status: 503 }),
}) {
    const modelId = source === 'openrouter' ? 'model_openrouter_select' : 'model_nanogpt_select';
    const pickerId = source === 'openrouter' ? 'openrouter_providers_chat' : 'nanogpt_provider';
    const options = [];
    const picker = {
        options,
        multiple: source === 'openrouter',
        add(option) {
            if (option.selected && !this.multiple) {
                for (const previous of options) previous.selected = false;
            }
            options.push(option);
        },
        append(option) {
            const index = options.indexOf(option);
            if (index !== -1) options.splice(index, 1);
            options.push(option);
        },
        replaceChildren(...nextOptions) {
            options.splice(0, options.length, ...nextOptions);
        },
    };
    const model = { value: '' };
    const elements = {
        main_api: { value: 'openai' },
        chat_completion_source: { value: source },
        [modelId]: model,
        [pickerId]: picker,
    };
    const events = [];
    const notices = [];
    const handlers = new Map();
    const context = {
        chatCompletionSettings: settings,
        eventTypes: { OAI_PRESET_CHANGED_BEFORE: 'preset-before', APP_READY: 'app-ready' },
        eventSource: {
            on: (event, listener) => handlers.set(event, listener),
            once() {},
        },
    };
    const window = {
        fetch(url, init) {
            return url.startsWith('https://openrouter.ai/api/v1/models/')
                ? fetchEndpoints(url, init)
                : fetch(url, init);
        },
        SillyTavern: { getContext: () => context },
        jQuery: () => ({
            on: (event, _selector, listener) => handlers.set(event, listener),
            trigger(event) {
                events.push(event);
                if (event === 'change') {
                    const selected = options.filter(option => option.selected).map(option => option.value);
                    if (picker.multiple) settings.openrouter_providers = selected;
                    else settings.nanogpt_provider = selected[0] ?? '';
                }
            },
        }),
        toastr: { warning: message => notices.push(message) },
    };
    runInNewContext(script, {
        window,
        document: { getElementById: id => elements[id] ?? null },
        Option,
        Response,
        Headers,
        AbortSignal,
        console,
    });
    function lookup(path, id) {
        return window.fetch(path, { method: 'POST', body: JSON.stringify({ model: id }) });
    }
    return { model, picker, settings, events, notices, handlers, window, lookup };
}

test('OpenRouter replaces the stock list and preserves the saved order', async () => {
    const state = host({
        source: 'openrouter',
        settings: { openrouter_providers: ['New Host', 'Stock'] },
        fetch: async () => Response.json(['Stock', 'New Host', 'Other New Host']),
    });
    state.picker.add(new Option('Stock', 'Stock', false, true));
    state.picker.add(new Option('Unavailable', 'Unavailable'));
    state.model.value = 'author/model';
    const response = await state.lookup(openrouter, state.model.value);
    assert.deepEqual(await response.json(), ['Stock', 'New Host', 'Other New Host']);
    assert.deepEqual(state.picker.options.filter(option => option.selected).map(option => option.value),
        ['New Host', 'Stock']);
    assert.deepEqual(state.picker.options.map(option => option.value), ['Other New Host', 'New Host', 'Stock']);
    assert.deepEqual(state.events, ['change.select2']);
});

test('OpenRouter lists each real endpoint once for providers with variants', async () => {
    const state = host({
        source: 'openrouter',
        settings: { openrouter_providers: ['wafer/us', 'Wafer'] },
        fetch: async () => Response.json(['Wafer', 'Wafer', 'Other']),
        fetchEndpoints: async (url, { credentials, headers }) => {
            assert.equal(url, 'https://openrouter.ai/api/v1/models/author/model/endpoints');
            assert.equal(credentials, 'omit');
            assert.equal(headers, undefined);
            return Response.json({ data: { endpoints: [
                { provider_name: 'Wafer', tag: 'wafer/us' },
                { provider_name: 'Wafer', tag: 'wafer/mxfp4' },
                { provider_name: 'Wafer', tag: 'wafer/us' },
                { provider_name: 'Other', tag: 'other' },
            ] } });
        },
    });
    state.model.value = 'author/model';
    const response = await state.lookup(openrouter, state.model.value);
    assert.deepEqual(await response.json(), ['Other', 'wafer/us', 'wafer/mxfp4']);
    assert.deepEqual(state.picker.options.map(({ text, value, selected }) => [text, value, selected]), [
        ['Other', 'Other', false],
        ['Wafer (wafer/mxfp4)', 'wafer/mxfp4', false],
        ['Wafer (wafer/us)', 'wafer/us', true],
    ]);
    assert.deepEqual(state.settings.openrouter_providers, ['wafer/us']);
    assert.equal(state.notices.length, 1);
});

test('OpenRouter retains saved endpoint tags if the public catalog fails', async () => {
    const state = host({
        source: 'openrouter',
        settings: { openrouter_providers: ['wafer/us'] },
        fetch: async () => Response.json(['Wafer']),
    });
    state.model.value = 'author/model';
    const response = await state.lookup(openrouter, state.model.value);
    assert.deepEqual(await response.json(), ['Wafer', 'wafer/us']);
    assert.deepEqual(state.picker.options.map(({ value, selected }) => [value, selected]),
        [['Wafer', false], ['wafer/us', true]]);
    assert.deepEqual(state.settings.openrouter_providers, ['wafer/us']);
    assert.equal(state.notices.length, 0);
});

test('NanoGPT uses live IDs without pinning Auto or changing PAYG', async () => {
    const state = host({
        source: 'nanogpt',
        settings: { nanogpt_provider: '', nanogpt_payg_override: true },
        fetch: async () => Response.json({ supportsProviderSelection: true, providers: ['new-host'] }),
    });
    state.picker.add(new Option('Auto', '', false, true));
    state.model.value = 'author/model';
    await state.lookup(nanogpt, state.model.value);
    assert.deepEqual(state.picker.options.map(({ value, selected, disabled }) => [value, selected, disabled]),
        [['', true, false], ['new-host', false, false]]);
    assert.deepEqual(state.settings, { nanogpt_provider: '', nanogpt_payg_override: true });
});

test('an unavailable NanoGPT pin returns to Auto with one warning', async () => {
    const state = host({
        source: 'nanogpt',
        settings: { nanogpt_provider: 'stock-host', nanogpt_payg_override: true },
        fetch: async () => Response.json({ supportsProviderSelection: true, providers: ['new-host'] }),
    });
    state.picker.add(new Option('Auto', ''));
    state.picker.add(new Option('Stock Host', 'stock-host', false, true));
    state.model.value = 'author/new';
    await state.lookup(nanogpt, state.model.value);
    await state.lookup(nanogpt, state.model.value);
    assert.deepEqual(state.picker.options.map(({ text, value, selected }) => [text, value, selected]),
        [['Auto', '', true], ['new-host', 'new-host', false]]);
    assert.deepEqual(state.settings, { nanogpt_provider: '', nanogpt_payg_override: true });
    assert.deepEqual(state.events, ['change', 'change.select2']);
    assert.deepEqual(state.notices, ['The saved NanoGPT provider is unavailable for this model. Switched to Auto.']);
});

test('presets can restore an OpenRouter pin after it was filtered out', async () => {
    const state = host({
        source: 'openrouter',
        settings: { openrouter_providers: ['Keep', 'Remove'] },
        fetch: async (_url, init) => Response.json(JSON.parse(init.body).model === 'author/first' ? ['Keep'] : ['Keep', 'Remove']),
    });
    state.picker.add(new Option('Keep', 'Keep', false, true));
    state.picker.add(new Option('Remove', 'Remove', false, true));
    state.model.value = 'author/first';
    await state.lookup(openrouter, state.model.value);
    assert.deepEqual(state.settings.openrouter_providers, ['Keep']);
    assert.equal(state.notices.length, 1);

    state.handlers.get('preset-before')({ preset: { openrouter_providers: ['Remove', 'Keep'] } });
    const restored = state.picker.options.find(option => option.value === 'Remove');
    assert.equal(restored.disabled, false);
    assert.deepEqual(state.picker.options.map(option => option.value), ['Remove', 'Keep']);
    state.settings.openrouter_providers = ['Remove', 'Keep'];
    state.model.value = 'author/second';
    await state.lookup(openrouter, state.model.value);
    assert.deepEqual(state.picker.options.map(({ value, selected }) => [value, selected]), [['Remove', true], ['Keep', true]]);
    assert.equal(state.notices.length, 1);

    state.model.value = 'OR_Website';
    state.handlers.get('change.liveProviders')();
    assert.deepEqual(state.picker.options.map(option => option.value), ['Remove', 'Keep']);
});

test('a stale provider lookup cannot overwrite the current picker', async () => {
    const pending = new Map();
    const state = host({
        source: 'openrouter',
        fetch: (_path, init) => new Promise(resolve => pending.set(JSON.parse(init.body).model, resolve)),
    });
    state.model.value = 'author/old';
    const old = state.lookup(openrouter, state.model.value);
    state.model.value = 'author/new';
    const current = state.lookup(openrouter, state.model.value);
    pending.get('author/new')(Response.json(['New Host']));
    await current;
    pending.get('author/old')(Response.json(['Old Host']));
    assert.deepEqual(await (await old).json(), ['New Host']);
    assert.deepEqual(state.picker.options.map(option => option.value), ['New Host']);
});

test('lookup errors keep prior options and generation passes through the same response', async () => {
    const generation = {};
    const state = host({
        source: 'nanogpt',
        fetch: path => path === nanogpt ? Promise.resolve(new Response(null, { status: 503 })) : generation,
    });
    state.picker.add(new Option('Auto', '', false, true));
    state.model.value = 'author/model';
    assert.equal((await state.lookup(nanogpt, state.model.value)).status, 503);
    assert.equal(state.picker.options.length, 1);
    assert.equal(state.window.fetch('/api/backends/chat-completions/generate', { method: 'POST' }), generation);
});
