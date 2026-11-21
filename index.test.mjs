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

function host({ source, settings = {}, fetch }) {
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
            options.splice(options.indexOf(option), 1);
            options.push(option);
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
    const window = {
        fetch,
        SillyTavern: { getContext: () => ({ chatCompletionSettings: settings }) },
        jQuery: () => ({ trigger: event => events.push(event) }),
    };
    runInNewContext(script, {
        window,
        document: { getElementById: id => elements[id] ?? null },
        Option,
        Response,
        console,
    });
    function lookup(path, id) {
        return window.fetch(path, { method: 'POST', body: JSON.stringify({ model: id }) });
    }
    return { model, picker, settings, events, window, lookup };
}

test('OpenRouter adds returned names and restores saved provider order', async () => {
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
    assert.equal(state.picker.options[0].disabled, true);
    assert.deepEqual(state.events, ['change.select2']);
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
