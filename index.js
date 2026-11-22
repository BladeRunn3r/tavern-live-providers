const lookups = {
    '/api/openrouter/models/providers': {
        source: 'openrouter',
        modelId: 'model_openrouter_select',
        pickerId: 'openrouter_providers_chat',
        setting: 'openrouter_providers',
        readProviders: data => Array.isArray(data) ? data : null,
        defaultResponse: [],
    },
    '/api/nanogpt/models/providers': {
        source: 'nanogpt',
        modelId: 'model_nanogpt_select',
        pickerId: 'nanogpt_provider',
        setting: 'nanogpt_provider',
        readProviders: data => typeof data?.supportsProviderSelection === 'boolean' && Array.isArray(data.providers)
            ? (data.supportsProviderSelection ? data.providers : []) : null,
        defaultResponse: { supportsProviderSelection: false, providers: [] },
    },
};

const latestLookup = new Map();
const stockProviderLabels = new WeakMap();
const originalFetch = window.fetch;

function getContext() {
    return window.SillyTavern?.getContext?.();
}

function activeModel(lookup) {
    const mainApi = document.getElementById('main_api')?.value;
    const source = document.getElementById('chat_completion_source')?.value;
    if (mainApi !== 'openai' || source !== lookup.source) {
        return null;
    }

    return document.getElementById(lookup.modelId)?.value || null;
}

function getSavedProviders(value) {
    return Array.isArray(value) ? value : value ? [value] : [];
}

function getProviderLabels(picker) {
    if (!stockProviderLabels.has(picker)) {
        stockProviderLabels.set(picker, new Map(Array.from(picker.options, option => [option.value, option.text])));
    }
    return stockProviderLabels.get(picker);
}

function replaceProviders(lookup, providers) {
    const picker = document.getElementById(lookup.pickerId);
    if (!picker || providers === null) {
        return;
    }

    const labels = getProviderLabels(picker);
    const available = new Set(providers.filter(value => typeof value === 'string' && value.trim()));
    const saved = getSavedProviders(getContext()?.chatCompletionSettings?.[lookup.setting]);
    const retained = saved.filter(value => available.has(value));
    const retainedSet = new Set(retained);
    const unselected = Array.from(available).filter(value => !retainedSet.has(value));
    unselected.sort((a, b) => (labels.get(a) ?? a).localeCompare(labels.get(b) ?? b));

    const options = picker.multiple ? [] : [new Option(labels.get('') ?? 'Auto', '', false, retained.length === 0)];
    // The native OpenRouter handler reads the selected options in DOM order.
    for (const value of [...unselected, ...retained]) {
        options.push(new Option(labels.get(value) ?? value, value, false, retainedSet.has(value)));
    }
    picker.replaceChildren(...options);

    if (retained.length !== saved.length) {
        // Keep the request settings in sync with the replacement dropdown.
        window.jQuery?.(picker).trigger('change');
        const message = picker.multiple
            ? 'Removed unavailable OpenRouter providers from the selection.'
            : 'The saved NanoGPT provider is unavailable for this model. Switched to Auto.';
        window.toastr?.warning(message, 'Live Providers');
    } else {
        window.jQuery?.(picker).trigger('change.select2');
    }
}

function preparePresetProviders({ preset }) {
    if (getContext()?.chatCompletionSettings?.bind_preset_to_connection === false) {
        return;
    }
    for (const lookup of Object.values(lookups)) {
        const picker = document.getElementById(lookup.pickerId);
        const values = getSavedProviders(preset?.[lookup.setting]);
        if (!picker || values.length === 0) {
            continue;
        }
        const labels = getProviderLabels(picker);
        const current = new Map(Array.from(picker.options, option => [option.value, option]));
        // Presets apply their values through the native select before discovery.
        // Make those values selectable until the selected model's lookup runs.
        for (const value of values) {
            const option = current.get(value);
            if (option) {
                option.disabled = false;
            }
            if (picker.multiple || !option) {
                picker.append(option ?? new Option(labels.get(value) ?? value, value));
            }
        }
    }
}

function restoreOpenRouterDefaults() {
    const lookup = lookups['/api/openrouter/models/providers'];
    const model = activeModel(lookup);
    const picker = document.getElementById(lookup.pickerId);
    const labels = stockProviderLabels.get(picker);
    if (model && !model.includes('/') && labels) {
        // OpenRouter's website default does not have a model-specific lookup.
        const saved = getSavedProviders(getContext()?.chatCompletionSettings?.[lookup.setting]);
        replaceProviders(lookup, [...labels.keys(), ...saved]);
    }
}

async function inspectResponse(responsePromise) {
    const response = await responsePromise;
    let data;
    if (response.ok) {
        try {
            data = await response.clone().json();
        } catch {
            // Leave errors and non-JSON responses to TauriTavern's own handler.
        }
    }
    return { response, data };
}

function currentResponse(result) {
    if (result.data !== undefined) {
        return Response.json(result.data);
    }
    // The native caller only checks ok/status before parsing JSON.
    return new Response(null, { status: result.response.ok ? 502 : result.response.status });
}

async function applyLookup(lookup, entry) {
    const original = await entry.result;

    for (;;) {
        const model = activeModel(lookup);
        if (!model) {
            return original.response;
        }

        const current = latestLookup.get(lookup);
        if (current === entry && model === entry.model) {
            replaceProviders(lookup, lookup.readProviders(original.data));
            return original.response;
        }
        if (current?.model !== model) {
            // Some selections, such as OpenRouter's website default, skip discovery.
            return Response.json(lookup.defaultResponse);
        }

        // The stock handler runs after fetch resolves. Let an older call finish
        // with the current model's data so it cannot re-disable its providers.
        const result = await current.result;
        if (latestLookup.get(lookup) === current && activeModel(lookup) === model) {
            return currentResponse(result);
        }
    }
}

function findLookup(input, init) {
    const lookup = typeof input === 'string' && Object.hasOwn(lookups, input)
        ? lookups[input]
        : null;
    if (!lookup || init?.method !== 'POST' || typeof init.body !== 'string') {
        return null;
    }

    try {
        const { model } = JSON.parse(init.body);
        return model && activeModel(lookup) === model ? { lookup, model } : null;
    } catch {
        return null;
    }
}

function install() {
    window.fetch = function (...args) {
        const match = findLookup(args[0], args[1]);
        const response = Reflect.apply(originalFetch, this, args);
        if (!match) {
            return response;
        }

        const { lookup, model } = match;
        const entry = { model, result: inspectResponse(response) };
        latestLookup.set(lookup, entry);
        return applyLookup(lookup, entry);
    };

    function refreshCurrentModel() {
        const context = getContext();
        for (const [path, lookup] of Object.entries(lookups)) {
            const model = activeModel(lookup);
            if (!context?.getRequestHeaders || !model || model === 'OR_Website'
                || latestLookup.get(lookup)?.model === model) {
                continue;
            }

            // Deferred extensions can load after the initial native lookup.
            void window.fetch(path, {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({ model }),
            }).catch(error => console.warn('Live Providers: initial lookup failed', error));
        }
    }

    window.jQuery?.(document).on('change.liveProviders', '#model_openrouter_select, #chat_completion_source', restoreOpenRouterDefaults);
    const context = getContext();
    context?.eventSource?.on(context.eventTypes.OAI_PRESET_CHANGED_BEFORE, preparePresetProviders);
    context?.eventSource?.once(context.eventTypes.APP_READY, refreshCurrentModel);
    refreshCurrentModel();
}

install();
