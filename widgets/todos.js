import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {BarStat} from '../lib/bar.js';
import {clearMenu} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {readText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const TASK = /^(\s*[-*] \[)([ xX])(\] )(.*)$/;
const PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'glancedock', 'todos.md']);
const SHOWN_DONE = 5;

// Next open task from ~/.config/glancedock/todos.md (Markdown checkboxes).
// Click the tile for a popup to tick tasks off and add new ones.
export class TodosWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        // A compact readout, "todo 2/5" over a progress bar; the tasks
        // themselves only show when you click.
        this._stat = new BarStat('todo');
        this.actor = new St.Button({style_class: 'glance-button', child: this._stat.actor, can_focus: true});
        addTooltip(this.actor, () => (this._menu?.isOpen ? null : 'Click to see, tick and add tasks'));

        this._menu = new PopupMenu.PopupMenu(this.actor, 0.5, St.Side.BOTTOM);
        this._menu.actor.add_style_class_name('glance-todo-menu');
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
        this._menuManager.addMenu(this._menu);
        this._list = new PopupMenu.PopupMenuSection();
        this._menu.addMenuItem(this._list);
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._menu.addMenuItem(this._entryItem());
        this._clearItem = this._menu.addAction('Clear completed', () => this._write(
            this._lines.filter(line => !TASK.test(line) || line.match(TASK)[2] === ' ')));
        this._menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._entry.grab_key_focus();
        });
        this.actor.connect('clicked', () => this._menu.toggle(BoxPointer.PopupAnimation.FULL));

        this._monitor = Gio.File.new_for_path(PATH).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._load());
        this._load();
    }

    _entryItem() {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._entry = new St.Entry({hint_text: 'Add a task…', x_expand: true, can_focus: true});
        this._entry.clutter_text.connect('activate', () => {
            const text = this._entry.text.trim();
            if (!text)
                return;
            this._entry.text = '';
            this._write([...this._lines.filter((line, i) => line || i < this._lines.length - 1), `- [ ] ${text}`, '']);
        });
        item.add_child(this._entry);
        return item;
    }

    _load() {
        this._lines = (readText(PATH) ?? '').split('\n');
        const tasks = this._lines.map((line, i) => {
            const m = line.match(TASK);
            return m ? {i, done: m[2] !== ' ', text: m[4].trim()} : null;
        }).filter(Boolean);
        const open = tasks.filter(t => !t.done);
        const done = tasks.filter(t => t.done);
        this._stat.set(tasks.length ? done.length / tasks.length : 0, tasks.length ? `${done.length}/${tasks.length}` : '');

        clearMenu(this._list);
        for (const task of [...open, ...done.slice(-SHOWN_DONE)])
            this._list.addMenuItem(this._taskItem(task));
        this._clearItem.visible = done.length > 0;
    }

    // Clicking a task ticks or unticks it; the menu stays open.
    _taskItem(task) {
        const item = new PopupMenu.PopupBaseMenuItem({activate: false});
        item.add_child(new St.Icon({
            icon_name: task.done ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
            style_class: 'popup-menu-icon',
        }));
        const label = new St.Label({text: task.text, y_align: Clutter.ActorAlign.CENTER});
        if (task.done)
            label.add_style_class_name('glance-todo-done');
        item.add_child(label);
        item.connect('button-release-event', () => {
            const lines = [...this._lines];
            lines[task.i] = lines[task.i].replace(TASK, `$1${task.done ? ' ' : 'x'}$3$4`);
            this._write(lines);
            return Clutter.EVENT_STOP;
        });
        return item;
    }

    _write(lines) {
        GLib.mkdir_with_parents(GLib.path_get_dirname(PATH), 0o755);
        GLib.file_set_contents(PATH, lines.join('\n'));
        this._load();
    }

    destroy() {
        this._monitor.cancel();
        this._menu.destroy();
        super.destroy();
    }
}
