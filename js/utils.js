function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (match) => {
        const escapeMap = {
            '&': '&amp;', '<': '&lt;', '>': '&gt;',
            '"': '&quot;', "'": '&#39;'
        };
        return escapeMap[match];
    });
}

function escapeAttribute(str) {
    if (!str) return '';
    return String(str).replace(/"/g, '&quot;');
}

function preloadImages(urls) {
    if (!Array.isArray(urls)) return;
    const queue = [...urls];
    const preload = (deadline) => {
        while ((deadline.timeRemaining() > 0 || deadline.didTimeout) && queue.length > 0) {
            const url = queue.pop();
            if (url) {
                const img = new Image();
                img.src = url;
            }
        }
        if (queue.length > 0 && typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(preload);
        }
    };

    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(preload);
    } else {
        setTimeout(() => queue.forEach(u => { const i = new Image(); i.src = u; }), 500);
    }
}

function debounce(fn, wait = 200) {
    let timeoutId = null;
    return function (...args) {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            fn.apply(this, args);
            timeoutId = null;
        }, wait);
    };
}

function memoize(fn, keyFn = (...args) => JSON.stringify(args)) {
    const cache = new Map();
    return function (...args) {
        const key = keyFn(...args);
        if (cache.has(key)) return cache.get(key);
        const res = fn.apply(this, args);
        cache.set(key, res);
        return res;
    };
}

class VirtualScroller {
    constructor({ container, itemHeight = 64, buffer = 5, renderItem }) {
        this.container = container;
        this.itemHeight = itemHeight;
        this.buffer = buffer;
        this.renderItem = renderItem;
        this.items = [];

        this.topPadding = document.createElement('div');
        this.bottomPadding = document.createElement('div');
        this.content = document.createElement('div');

        this.container.innerHTML = '';
        this.container.appendChild(this.topPadding);
        this.container.appendChild(this.content);
        this.container.appendChild(this.bottomPadding);

        this.onScroll = this.onScroll.bind(this);
        this.container.addEventListener('scroll', this.onScroll, { passive: true });
    }

    setItems(items) {
        this.items = items || [];
        this.render();
    }

    onScroll() {
        requestAnimationFrame(() => this.render());
    }

    render() {
        const total = this.items.length;
        const scrollTop = this.container.scrollTop;
        const viewportHeight = this.container.clientHeight;

        let startIndex = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.buffer);
        let endIndex = Math.min(total, Math.ceil((scrollTop + viewportHeight) / this.itemHeight) + this.buffer);

        this.topPadding.style.height = `${startIndex * this.itemHeight}px`;
        this.bottomPadding.style.height = `${Math.max(0, (total - endIndex) * this.itemHeight)}px`;

        this.content.innerHTML = '';
        const visibleSlice = this.items.slice(startIndex, endIndex);
        visibleSlice.forEach((item, i) => {
            const el = this.renderItem(item, startIndex + i);
            if (el) this.content.appendChild(el);
        });
    }

    destroy() {
        this.container.removeEventListener('scroll', this.onScroll);
    }
}

class ToastManager {
    constructor() {
        this.container = null;
        this._ensureContainer();
    }

    _ensureContainer() {
        if (typeof document === 'undefined') return;
        this.container = document.getElementById('dhun-toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'dhun-toast-container';
            this.container.className = 'dhun-toast-container';
            document.body.appendChild(this.container);
        }
    }

    show(message, { type = 'info', duration = 3500, action = null } = {}) {
        this._ensureContainer();
        if (!this.container) return null;
        const toast = document.createElement('div');
        toast.className = `dhun-toast dhun-toast-${type}`;

        const textSpan = document.createElement('span');
        textSpan.className = 'dhun-toast-msg';
        textSpan.textContent = message;
        toast.appendChild(textSpan);

        if (action && action.label && typeof action.callback === 'function') {
            const actBtn = document.createElement('button');
            actBtn.className = 'dhun-toast-action';
            actBtn.textContent = action.label;
            actBtn.onclick = (e) => {
                e.stopPropagation();
                action.callback();
                this._dismiss(toast);
            };
            toast.appendChild(actBtn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.className = 'dhun-toast-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this._dismiss(toast);
        toast.appendChild(closeBtn);

        this.container.appendChild(toast);

        // Slide in
        requestAnimationFrame(() => toast.classList.add('visible'));

        if (duration > 0) {
            setTimeout(() => this._dismiss(toast), duration);
        }
        return toast;
    }

    _dismiss(toast) {
        if (!toast || !toast.parentNode) return;
        toast.classList.remove('visible');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }
}

const toastManager = new ToastManager();

if (typeof window !== 'undefined') {
    window.escapeHTML = escapeHTML;
    window.escapeAttribute = escapeAttribute;
    window.preloadImages = preloadImages;
    window.debounce = debounce;
    window.memoize = memoize;
    window.VirtualScroller = VirtualScroller;
    window.ToastManager = ToastManager;
    window.toastManager = toastManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHTML, escapeAttribute, preloadImages, debounce, memoize, VirtualScroller, ToastManager, toastManager };
}
