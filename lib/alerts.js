// Alerts you clicked away. Kept at module level, so they stay dismissed when
// the screen locks (GNOME turns the extension off and on) or the bar rebuilds.
// Widgets put what makes an alert new (such as a reset time) in its key.
const dismissed = new Set();

// Collects "you should know this now" messages from widgets. The bar shows
// the most urgent one; clicking it hides that alert.
export class AlertHub {
    constructor(onChange) {
        this._alerts = new Map(); // key -> {text, level}
        this._onChange = onChange;
    }

    // Make the alerts under `prefix` exactly `entries` (a Map of key -> {text, level}).
    replace(prefix, entries) {
        for (const key of [...this._alerts.keys()]) {
            if (key.startsWith(prefix) && !entries.has(key))
                this._alerts.delete(key);
        }
        for (const [key, alert] of entries)
            this._alerts.set(key, alert);
        this._onChange();
    }

    dismiss(key) {
        dismissed.add(key);
        this._onChange();
    }

    top() {
        let best = null;
        for (const [key, alert] of this._alerts) {
            if (dismissed.has(key))
                continue;
            if (!best || (alert.level === 'crit' && best.alert.level !== 'crit'))
                best = {key, alert};
        }
        return best;
    }
}
