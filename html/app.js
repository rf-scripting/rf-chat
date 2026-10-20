const chat = document.getElementById('chat');
const messagesEl = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');
const suggestionsEl = document.getElementById('suggestions');

const resourceName = typeof GetParentResourceName === 'function'
    ? GetParentResourceName()
    : 'rf-chat';

let hideDelay = 7000;
let maxMessages = 8;
let suggestionLimit = 5;
let hideTimer = null;
let inputOpen = false;
let backingSuggestions = [];
const removedSuggestions = [];
const messageHistory = [];
const historyLimit = 50;
let historyIndex = 0;
let historyDraft = '';

function post(name, data) {
    return fetch(`https://${resourceName}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(data || {}),
    });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showChat() {
    chat.classList.add('visible');
}

function scheduleHide() {
    if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }

    if (inputOpen) {
        return;
    }

    hideTimer = setTimeout(() => {
        if (!inputOpen) {
            chat.classList.remove('visible');
        }
    }, hideDelay);
}

function applySetup(data) {
    if (typeof data.hideDelay === 'number') {
        hideDelay = data.hideDelay;
    }
    if (typeof data.maxMessages === 'number') {
        maxMessages = data.maxMessages;
    }
    if (typeof data.maxLength === 'number') {
        input.maxLength = data.maxLength;
    }
    if (typeof data.suggestionLimit === 'number') {
        suggestionLimit = data.suggestionLimit;
    }
    if (data.position) {
        chat.dataset.position = data.position;
    }
}

function addMessage(message) {
    if (!message || !message.text) {
        return;
    }

    const type = message.type === 'me' ? 'me' : 'system';
    const row = document.createElement('div');
    row.className = `msg msg-${type}`;

    if (type === 'me' && message.name) {
        row.innerHTML = `<span class="name">${escapeHtml(message.name)}</span> ${escapeHtml(message.action || '')}`;
    } else {
        row.textContent = message.text;
    }

    messagesEl.appendChild(row);

    while (messagesEl.children.length > maxMessages) {
        messagesEl.removeChild(messagesEl.firstChild);
    }

    showChat();
    scheduleHide();
}

function addSuggestion(suggestion) {
    if (!suggestion || !suggestion.name) {
        return;
    }

    const existing = backingSuggestions.find((entry) => entry.name === suggestion.name);
    if (existing) {
        if (suggestion.help || suggestion.params) {
            existing.help = suggestion.help || '';
            existing.params = suggestion.params || [];
        }
        return;
    }

    if (!suggestion.params) {
        suggestion.params = [];
    }

    const removedIndex = removedSuggestions.indexOf(suggestion.name);
    if (removedIndex > -1) {
        removedSuggestions.splice(removedIndex, 1);
    }

    backingSuggestions.push(suggestion);
}

function removeSuggestion(name) {
    if (removedSuggestions.indexOf(name) <= -1) {
        removedSuggestions.push(name);
    }
}

function activeSuggestions() {
    return backingSuggestions.filter((entry) => removedSuggestions.indexOf(entry.name) <= -1);
}

function currentSuggestions(message) {
    if (!message) {
        return [];
    }

    const filtered = activeSuggestions().filter((suggestion) => {
        if (!suggestion.name.startsWith(message)) {
            const suggestionParts = suggestion.name.split(' ');
            const messageParts = message.split(' ');
            const params = Array.isArray(suggestion.params) ? suggestion.params : [];

            for (let i = 0; i < messageParts.length; i += 1) {
                if (i >= suggestionParts.length) {
                    return i < suggestionParts.length + params.length;
                }
                if (suggestionParts[i] !== messageParts[i]) {
                    return false;
                }
            }
        }

        return true;
    }).slice(0, suggestionLimit);

    filtered.forEach((suggestion) => {
        suggestion.disabled = !suggestion.name.startsWith(message);

        if (!suggestion.params) {
            return;
        }

        const params = Array.isArray(suggestion.params)
            ? suggestion.params
            : Object.keys(suggestion.params).map((key) => suggestion.params[key]);

        params.forEach((param, index) => {
            const wild = (index === params.length - 1) ? '.' : '\\S';
            const regex = new RegExp(`${suggestion.name} (?:\\w+ ){${index}}(?:${wild}*)$`);
            param.disabled = message.match(regex) == null;
        });
    });

    return filtered;
}

function resetHistoryCursor() {
    historyIndex = messageHistory.length;
    historyDraft = '';
}

function pushHistory(value) {
    const message = String(value || '').trim();

    if (message && messageHistory[messageHistory.length - 1] !== message) {
        messageHistory.push(message);

        if (messageHistory.length > historyLimit) {
            messageHistory.shift();
        }
    }

    resetHistoryCursor();
}

function applyHistoryEntry() {
    input.value = historyIndex === messageHistory.length
        ? historyDraft
        : messageHistory[historyIndex];

    const cursor = input.value.length;
    input.setSelectionRange(cursor, cursor);
    renderSuggestions();
}

function historyUp() {
    if (!messageHistory.length || historyIndex <= 0) {
        return;
    }

    if (historyIndex === messageHistory.length) {
        historyDraft = input.value;
    }

    historyIndex -= 1;
    applyHistoryEntry();
}

function historyDown() {
    if (historyIndex >= messageHistory.length) {
        return;
    }

    historyIndex += 1;
    applyHistoryEntry();
}

function renderSuggestions() {
    if (!inputOpen) {
        suggestionsEl.hidden = true;
        suggestionsEl.innerHTML = '';
        return;
    }

    const matches = currentSuggestions(input.value);
    if (matches.length === 0) {
        suggestionsEl.hidden = true;
        suggestionsEl.innerHTML = '';
        return;
    }

    suggestionsEl.innerHTML = matches.map((suggestion) => {
        const params = Array.isArray(suggestion.params) ? suggestion.params : [];
        const paramHtml = params.map((param) => (
            `<span class="suggestion-param${param.disabled ? ' disabled' : ''}">[${escapeHtml(param.name || '')}]</span>`
        )).join('');

        let help = '';
        if (!suggestion.disabled && suggestion.help) {
            help = suggestion.help;
        } else {
            const activeParam = params.find((param) => !param.disabled && param.help);
            help = activeParam ? activeParam.help : '';
        }

        return `
            <div class="suggestion">
                <div class="suggestion-line">
                    <span class="suggestion-name${suggestion.disabled ? ' disabled' : ''}">${escapeHtml(suggestion.name)}</span>
                    ${paramHtml}
                </div>
                ${help ? `<small class="suggestion-help">${escapeHtml(help)}</small>` : ''}
            </div>
        `;
    }).join('');

    suggestionsEl.hidden = false;
}

function openInput(data) {
    applySetup(data || {});
    inputOpen = true;
    input.value = '';
    resetHistoryCursor();
    chat.classList.add('open');
    showChat();
    if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
    renderSuggestions();
    requestAnimationFrame(() => input.focus());
}

function closeInput() {
    inputOpen = false;
    input.value = '';
    input.blur();
    chat.classList.remove('open');
    renderSuggestions();
    scheduleHide();
}

form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value;
    pushHistory(value);
    post('submit', { message: value });
    closeInput();
});

input.addEventListener('input', renderSuggestions);

window.addEventListener('keydown', (event) => {
    if (!inputOpen) {
        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        post('close', {});
        closeInput();
        return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        historyUp();
        return;
    }

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        historyDown();
    }
});

window.addEventListener('message', (event) => {
    const data = event.data || {};

    switch (data.action) {
        case 'setup':
            applySetup(data);
            break;
        case 'openInput':
            openInput(data);
            break;
        case 'closeInput':
            closeInput();
            break;
        case 'addMessage':
            applySetup(data);
            addMessage(data.message);
            break;
        case 'addSuggestion':
            addSuggestion(data.suggestion);
            renderSuggestions();
            break;
        case 'removeSuggestion':
            removeSuggestion(data.name);
            renderSuggestions();
            break;
        case 'clear':
            messagesEl.innerHTML = '';
            break;
        default:
            break;
    }
});

post('ready', {});
