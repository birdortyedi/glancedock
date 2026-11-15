import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BarStat} from '../lib/bar.js';
import {addTooltip} from '../lib/tooltip.js';
import {setText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

// Click to start or pause, right-click to reset. A finished focus block
// starts the break; a finished break waits for you.
export class PomodoroWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._phase = 'focus';
        this._running = false;
        this._remaining = this._length();
        this._endAt = 0;

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
            const what = this._phase === 'focus' ? 'focus' : 'break';
            return `${time} of ${what} left\nClick to ${this._running ? 'pause' : 'start'}, right-click to reset`;
        });
        this.every(1, () => this._tick());
    }

    _length(phase = this._phase) {
        const key = phase === 'focus' ? 'pomodoro-work-minutes' : 'pomodoro-break-minutes';
        return this.ctx.settings.get_int(key) * 60;
    }

    _left() {
        return this._running
            ? Math.max(0, Math.ceil((this._endAt - Date.now()) / 1000))
            : this._remaining;
    }

    _start(seconds) {
        this._endAt = Date.now() + seconds * 1000;
        this._running = true;
    }

    _toggle() {
        if (this._running) {
            this._remaining = this._left();
            this._running = false;
        } else {
            this._start(this._remaining);
        }
        this._render();
    }

    _reset() {
        this._running = false;
        this._phase = 'focus';
        this._remaining = this._length();
        this._render();
    }

    _tick() {
        if (this._running && this._left() === 0) {
            if (this._phase === 'focus') {
                this._phase = 'break';
                this._start(this._length());
                Main.notify('Focus block done', `Take ${this._length() / 60} minutes.`);
            } else {
                this._phase = 'focus';
                this._running = false;
                this._remaining = this._length();
                Main.notify('Break is over', 'Click the timer when you’re ready.');
            }
        }
        this._render();
    }

    _render() {
        const left = this._left();
        const total = this._length();
        const idle = !this._running && left === total;
        let caption = this._phase;
        if (!this._running && !idle)
            caption = 'paused';
        setText(this._stat.caption, caption);
        const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        this._stat.set(1 - left / total, clock, this._phase === 'break' ? 'warn' : 'ok');
        this._stat.actor[this._running ? 'add_style_class_name' : 'remove_style_class_name']('glance-running');
    }
}
