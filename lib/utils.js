import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

const decoder = new TextDecoder();

export function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? decoder.decode(bytes) : null;
    } catch {
        return null;
    }
}

// St.BoxLayout's `vertical` property is deprecated from GNOME 48; the layout
// manager's orientation works on every supported version.
export function vbox(params = {}) {
    const box = new St.BoxLayout(params);
    box.layout_manager.orientation = Clutter.Orientation.VERTICAL;
    return box;
}

export function setText(label, text) {
    if (label.text !== text)
        label.text = text;
}

export function levelFor(fraction) {
    if (fraction >= 0.9)
        return 'crit';
    if (fraction >= 0.7)
        return 'warn';
    return 'ok';
}

export function formatClock(dt, use12h) {
    return dt.format(use12h ? '%-l:%M %p' : '%H:%M');
}

// A JS Date as a clock time, with the weekday added when it isn't today.
export function formatWhen(date, use12h) {
    const dt = GLib.DateTime.new_from_unix_local(Math.floor(date.getTime() / 1000));
    const now = GLib.DateTime.new_now_local();
    const today = dt.get_year() === now.get_year() &&
        dt.get_day_of_year() === now.get_day_of_year();
    const time = formatClock(dt, use12h);
    return today ? time : `${dt.format('%a')} ${time}`;
}

export function formatDuration(ms) {
    const mins = Math.max(0, Math.round(ms / 60000));
    if (mins < 60)
        return `${mins}m`;
    const h = Math.floor(mins / 60);
    if (h >= 24)
        return `${Math.floor(h / 24)}d ${h % 24}h`;
    return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
}

export function formatCount(n) {
    if (n >= 1e9)
        return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6)
        return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3)
        return `${Math.round(n / 1e3)}k`;
    return String(Math.round(n));
}
