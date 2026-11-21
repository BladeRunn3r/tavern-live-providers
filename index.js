const lookups = {
    '/api/openrouter/models/providers': {
        source: 'openrouter',
        modelId: 'model_openrouter_select',
        pickerId: 'openrouter_providers_chat',
        setting: 'openrouter_providers',
        readProviders: data => Array.isArray(data) && data.length ? data : null,
        defaultResponse: [],
    },
    '/api/nanogpt/models/providers': {
        source: 'nanogpt',
        modelId: 'model_nanogpt_select',
        pickerId: 'nanogpt_provider',
        setting: 'nanogpt_provider',
        readProviders: data => data?.supportsProviderSelection && Array.isArray(data.providers)
            && data.providers.length ? data.providers : null,
        defaultResponse: { supportsProviderSelection: false, providers: [] },
    },
};

const latestLookup = new Map();
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

function addProviders(lookup, data) {
    const picker = document.getElementById(lookup.pickerId);
    const providers = lookup.readProviders(data);
    if (!picker || !providers) {
        return;
    }

    // Use exactly the names/IDs the local route returns. The native picker and
    // request builder already agree on these values.
    const available = new Set(providers.filter(value => typeof value === 'string' && value.trim()));
    if (available.size === 0) {
        return;
    }

    const selected = getContext()?.chatCompletionSettings?.[lookup.setting];
    const saved = new Set(Array.isArray(selected) ? selected : [selected]);
    const present = new Map(Array.from(picker.options, option => [option.value, option]));
    let restored = false;

    // A new, unsaved option must never pin a NanoGPT request automatically.
    for (const value of available) {
        if (present.has(value)) {
            continue;
        }

        const wasSaved = saved.has(value);
        const option = new Option(value, value, false, wasSaved);
        picker.add(option);
        present.set(value, option);
        restored ||= wasSaved;
    }

    if (restored && picker.multiple) {
        // The stock handler reads selected values in DOM order.
        for (const value of saved) {
            const option = present.get(value);
            if (option?.selected) {
                picker.append(option);
                option.selected = true;
            }
        }
    }

    for (const option of picker.options) {
        option.disabled = option.value !== '' && !available.has(option.value);
    }

    // Refresh Select2 without invoking the app's settings or billing handlers.
    window.jQuery?.(picker).trigger('change.select2');
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
            addProviders(lookup, original.data);
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

    const context = getContext();
    context?.eventSource?.once(context.eventTypes.APP_READY, refreshCurrentModel);
    refreshCurrentModel();
}

install();
