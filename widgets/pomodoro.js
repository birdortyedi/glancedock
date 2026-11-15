import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BarStat} from '../lib/bar.js';
import {addTooltip} from '../lib/tooltip.js';
import {setText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

// The timer's state, at module level so a running block survives a screen
// lock (GNOME turns the extension off and on) and the bar rebuilding.
const state = {phase: 'focus', running: false, remaining: null, endAt: 0, full: null};

// Click to start or pause, right-click to reset. A finished focus block
// starts the break; a finished break waits for you.
export class PomodoroWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        // An idle timer takes the current length (it may have changed in Preferences).
        const full = this._length();
        if (state.remaining === null || (!state.running && state.remaining === state.full))
            state.remaining = full;
        state.full = full;

        // A readout: phase, countdown, and a bar that fills as the block runs.
        this._stat = new BarStat('focus');
        this._stat.actor.add_style_class_name('glance-focus');
        this.actor = new St.Button({
            style_class: 'glance-item glance-button',
            child: this._stat.actor,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            can_focus: true,
        });
        this.actor.connect('clicked', (_b, button) => (button === 3 ? this._reset() : this._toggle()));
        addTooltip(this.actor, () => {
            const left = this._left();
            const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
            const what = state.phase === 'focus' ? 'focus' : 'break';
            return `${time} of ${what} left\nClick to ${state.running ? 'pause' : 'start'}, right-click to reset`;
        });
        this.every(1, () => this._tick());
    }

    _length(phase = state.phase) {
        const key = phase === 'focus' ? 'pomodoro-work-minutes' : 'pomodoro-break-minutes';
        return this.ctx.settings.get_int(key) * 60;
    }

    _left() {
        return state.running
            ? Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000))
            : state.remaining;
    }

    _start(seconds) {
        state.endAt = Date.now() + seconds * 1000;
        state.running = true;
    }

    _toggle() {
        if (state.running) {
            state.remaining = this._left();
            state.running = false;
        } else {
            this._start(state.remaining);
        }
        this._render();
    }

    _reset() {
        state.running = false;
        state.phase = 'focus';
        state.remaining = state.full = this._length();
        this._render();
    }

    _tick() {
        if (state.running && this._left() === 0) {
            if (state.phase === 'focus') {
                state.phase = 'break';
                this._start(this._length());
                Main.notify('Focus block done', `Take ${this._length() / 60} minutes.`);
            } else {
                state.phase = 'focus';
                state.running = false;
                state.remaining = state.full = this._length();
                Main.notify('Break is over', 'Click the timer when you’re ready.');
            }
        }
        this._render();
    }

    _render() {
        const left = this._left();
        const total = this._length();
        const idle = !state.running && left === total;
        let caption = state.phase;
        if (!state.running && !idle)
            caption = 'paused';
        setText(this._stat.caption, caption);
        const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        this._stat.set(1 - left / total, clock, state.phase === 'break' ? 'warn' : 'ok');
        this._stat.actor[state.running ? 'add_style_class_name' : 'remove_style_class_name']('glance-running');
    }
}
