// Collects "you should know this now" messages from widgets. The bar shows
// the most urgent one; clicking it hides that alert until it goes away.
export class AlertHub {
    constructor(onChange) {
        this._alerts = new Map(); // key -> {text, level}
        this._dismissed = new Set();
        this._onChange = onChange;
    }

    set(key, text, level = 'warn') {
        const old = this._alerts.get(key);
        if (old?.text === text && old?.level === level)
            return;
        this._alerts.set(key, {text, level});
        this._onChange();
    }

    clear(key) {
        this._dismissed.delete(key);
        if (this._alerts.delete(key))
            this._onChange();
    }

    // Make the alerts under `prefix` exactly `entries` (a Map of key -> {text, level}).
    replace(prefix, entries) {
        for (const key of [...this._alerts.keys()]) {
            if (key.startsWith(prefix) && !entries.has(key)) {
                this._alerts.delete(key);
                this._dismissed.delete(key);
            }
        }
        for (const [key, alert] of entries)
            this._alerts.set(key, alert);
        this._onChange();
    }

    dismiss(key) {
        this._dismissed.add(key);
        this._onChange();
    }

    top() {
        let best = null;
        for (const [key, alert] of this._alerts) {
            if (this._dismissed.has(key))
                continue;
            if (!best || (alert.level === 'crit' && best.alert.level !== 'crit'))
                best = {key, alert};
        }
        return best;
    }
}
