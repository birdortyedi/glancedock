import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {AlertHub} from './lib/alerts.js';
import {AiWidget} from './widgets/ai.js';
import {AppsWidget} from './widgets/apps.js';
import {AudioWidget} from './widgets/audio.js';
import {BluetoothWidget} from './widgets/bluetooth.js';
import {ClockWidget} from './widgets/clock.js';
import {DayWidget} from './widgets/day.js';
import {DriveWidget} from './widgets/drive.js';
import {FoldersWidget} from './widgets/folders.js';
import {GpuWidget} from './widgets/gpu.js';
import {MediaWidget} from './widgets/media.js';
import {NetworkWidget} from './widgets/network.js';
import {NotesWidget} from './widgets/notes.js';
import {PomodoroWidget} from './widgets/pomodoro.js';
import {PowerWidget} from './widgets/power.js';
import {StorageWidget} from './widgets/storage.js';
import {SystemWidget} from './widgets/system.js';
import {TailscaleWidget} from './widgets/tailscale.js';
import {TerminalWidget} from './widgets/terminal.js';
import {TodosWidget} from './widgets/todos.js';
import {TogglesWidget} from './widgets/toggles.js';
import {WeatherWidget} from './widgets/weather.js';

// [settings key, side of the bar, class, shared tile]; each has a show-<key>
// setting. Side widgets sit in tiles; ones naming the same tile share it.
const WIDGETS = [
    // Left: what you're doing
    ['media', 'left', MediaWidget],
    ['pomodoro', 'left', PomodoroWidget],
    ['todos', 'left', TodosWidget, 'work'],
    ['notes', 'left', NotesWidget, 'work'],
    ['terminal', 'left', TerminalWidget, 'work'],
    ['folders', 'left', FoldersWidget, 'work'],
    ['drive', 'left', DriveWidget, 'work'],
    // Then your main apps, as the last section on the left
    ['apps', 'left', AppsWidget],
    // Right: AI limits, compute, connections, controls, time, and power
    // in the corner
    ['ai', 'right', AiWidget],
    ['gpu', 'right', GpuWidget, 'compute'],
    ['system', 'right', SystemWidget, 'compute'],
    ['storage', 'right', StorageWidget, 'compute'],
    ['network', 'right', NetworkWidget, 'connections'],
    ['tailscale', 'right', TailscaleWidget, 'connections'],
    ['bluetooth', 'right', BluetoothWidget, 'connections'],
    ['audio', 'right', AudioWidget, 'controls'],
    ['toggles', 'right', TogglesWidget, 'controls'],
    ['weather', 'right', WeatherWidget, 'time'],
    ['day', 'right', DayWidget, 'time'],
    ['clock', 'right', ClockWidget, 'time'],
    ['power', 'right', PowerWidget],
];

const GAP = 0; // space between the bar and whatever is below it
const HIDE_DELAY = 700; // ms after the pointer leaves before the bar slides away

// Height of the Ubuntu Dock (or Dash to Dock) when it sits along the bottom
// of `monitor`, so the island can float just above it. 0 if there's none.
function bottomDockHeight(monitor) {
    const bottom = monitor.y + monitor.height;
    for (const actor of Main.uiGroup.get_children()) {
        if (actor.name !== 'dashtodockContainer' || !actor.visible)
            continue;
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        const centre = x + w / 2;
        const onMonitor = centre >= monitor.x && centre < monitor.x + monitor.width;
        // y + h below the edge also covers an auto-hidden dock that slid away.
        if (onMonitor && w > h && y + h >= bottom - 2 && y > monitor.y + monitor.height / 2)
            return Math.round(h);
    }
    return 0;
}

class Dock {
    constructor(extension, settings) {
        this._extension = extension;
        this._settings = settings;
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._theme = St.ThemeContext.get_for_stage(global.stage);
        this._widgets = [];
        this._rebuildId = 0;
        this._geometry = '';
        this._alertKey = null;
        this.alerts = new AlertHub(() => this._renderAlert());

        // A strip from the bar down to the screen edge. Without auto-hide it
        // reserves the space, so maximized windows stop above the bar. Only
        // the bar itself takes clicks, so a dock below it (if any) stays usable.
        this.actor = new St.Widget({name: 'glanceDock', layout_manager: new Clutter.BinLayout()});
        // left group (ending with the apps) | spare room | right group.
        // _queueFit() keeps the apps within their own width plus the spare room.
        this._island = new St.BoxLayout({
            style_class: 'glance-island',
            reactive: true,
            track_hover: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.START,
        });
        this._left = new St.BoxLayout({style_class: 'glance-group', y_align: Clutter.ActorAlign.CENTER});
        this._center = new St.Bin({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._right = new St.BoxLayout({style_class: 'glance-group', y_align: Clutter.ActorAlign.CENTER});
        this._island.add_child(this._left);
        this._island.add_child(this._center);
        this._island.add_child(this._right);
        for (const part of [this._left, this._right, this._center])
            part.connect('notify::width', () => this._queueFit());
        this.actor.add_child(this._island);

        this._addChrome();
        // Auto-hide: leaving the bar slides it away; touching the bottom edge brings it back.
        this._hidden = false;
        this._hideId = 0;
        this._island.connect('notify::hover', () => (this._island.hover ? this._show() : this._queueHide()));
        this._edge = new St.Widget({reactive: true, track_hover: true, visible: false});
        this._edge.connect('notify::hover', () => this._edge.hover && this._show());
        Main.layoutManager.addChrome(this._edge, {affectsInputRegion: true, trackFullscreen: true});
        this._autoHideId = this._settings.connect('changed::auto-hide', () => {
            Main.layoutManager.untrackChrome(this._island);
            Main.layoutManager.removeChrome(this.actor);
            this._addChrome();
            this._show();
        });
        // The alert pill floats just above the bar, so it never squeezes the widgets.
        // GNOME forces fullscreen-tracked chrome visible, so it tracks a holder
        // and the pill inside shows and hides on its own.
        this._alertBin = new St.Bin({child: this._buildAlert()});
        Main.layoutManager.addChrome(this._alertBin, {trackFullscreen: true});

        this._settingsId = this._settings.connect('changed', () => this._queueRebuild());
        this._ifaceId = this._iface.connect('changed::clock-format', () => this._queueRebuild());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._reposition());
        this._scaleId = this._theme.connect('notify::scale-factor', () => this._reposition());
        // The Ubuntu Dock may start after us or change size; follow it.
        this._followId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._reposition();
            return GLib.SOURCE_CONTINUE;
        });

        this._rebuild();
        this._queueHide(2000); // show the bar briefly at login, then get out of the way
    }

    // The apps show what fits in the space between the two sides. Runs
    // after layout, before the next frame.
    _queueFit() {
        if (this._fitId)
            return;
        this._fitId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._fitId = 0;
            const apps = this._apps?.actor;
            if (!apps)
                return false;
            // The apps may use their own width plus all the spare room.
            this._apps.fit?.(apps.width + this._center.width);
            return false;
        });
    }

    // Auto-hide doesn't reserve space: the bar slides over windows when shown.
    _addChrome() {
        this._autoHide = this._settings.get_boolean('auto-hide');
        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: !this._autoHide, affectsInputRegion: false, trackFullscreen: true,
        });
        Main.layoutManager.trackChrome(this._island, {affectsInputRegion: true, affectsStruts: false});
    }

    _show() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = 0;
        if (this._hidden) {
            this._hidden = false;
            this._edge.hide();
            this.actor.show();
            this.actor.ease({
                translation_y: 0, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: () => {
                    this._placeAlert();
                    this._updateInputRegion();
                },
            });
        }
        if (!this._island.hover)
            this._queueHide(); // revealed from the edge but never entered
    }

    _queueHide(delay = HIDE_DELAY) {
        if (!this._autoHide || this._hidden || this._hideId)
            return;
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            // Stay while hovered, or while a menu or the overview has the screen.
            if (this._island.hover || Main.modalCount > 0)
                return GLib.SOURCE_CONTINUE;
            this._hideId = 0;
            this._hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _hide() {
        this._hidden = true;
        this.actor.ease({
            translation_y: this.actor.height, duration: 220, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => {
                if (this._hidden) {
                    this.actor.hide();
                    this._edge.show();
                    this._placeAlert();
                }
                this._updateInputRegion();
            },
        });
    }

    // Sliding is a translation, which GNOME doesn't count as moving: it
    // recalculates where the shell takes clicks only when a tracked actor's
    // allocation changes. Without this the bar can show while its clickable
    // area is still below the screen, and every button seems dead.
    _updateInputRegion() {
        Main.layoutManager._queueUpdateRegions(); // private, but stable since GNOME 3
    }

    _buildAlert() {
        const box = new St.BoxLayout({style_class: 'glance-alert-box'});
        box.add_child(new St.Icon({icon_name: 'dialog-warning-symbolic', y_align: Clutter.ActorAlign.CENTER}));
        this._alertLabel = new St.Label({style_class: 'glance-alert-label', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._alertLabel);
        this._alert = new St.Button({
            style_class: 'glance-alert',
            child: box,
            visible: false,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._alert.connect('clicked', () => {
            if (this._alertKey)
                this.alerts.dismiss(this._alertKey);
        });
        return this._alert;
    }

    _renderAlert() {
        if (!this._alert)
            return;
        const top = this.alerts.top();
        this._alertKey = top?.key ?? null;
        this._alert.visible = Boolean(top);
        if (!top)
            return;
        this._alertLabel.text = top.alert.text;
        if (top.alert.level === 'crit')
            this._alert.add_style_class_name('glance-crit');
        else
            this._alert.remove_style_class_name('glance-crit');
        this._placeAlert();
    }

    _placeAlert() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!this._alert?.visible || this._barTop === undefined || !monitor)
            return;
        const [, width] = this._alert.get_preferred_width(-1);
        const [, height] = this._alert.get_preferred_height(width);
        // Above the bar, or above the screen edge while the bar is hidden.
        const base = this._hidden ? monitor.y + monitor.height : this._barTop;
        this._alertBin.set_position(Math.round(monitor.x + (monitor.width - width) / 2),
            Math.round(base - height - 6 * this._theme.scale_factor));
    }

    _queueRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._rebuildId = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild() {
        this._widgets.forEach(w => w.destroy());
        this._widgets = [];
        this._tiles?.forEach(t => t.destroy());
        this._tiles = new Map(); // shared tile name -> box
        const ctx = {
            extension: this._extension,
            settings: this._settings,
            alerts: this.alerts,
            fitApps: () => this._queueFit(),
            use12h: this._iface.get_string('clock-format') === '12h',
        };
        for (const [key, side, WidgetClass, tile] of WIDGETS) {
            if (!this._settings.get_boolean(`show-${key}`))
                continue;
            try {
                const widget = new WidgetClass(ctx);
                const parent = side === 'left' ? this._left : this._right;
                if (tile) {
                    if (!this._tiles.has(tile)) {
                        const box = new St.BoxLayout({style_class: 'glance-tile', y_align: Clutter.ActorAlign.CENTER});
                        this._tiles.set(tile, box);
                        parent.add_child(box);
                    }
                    this._tiles.get(tile).add_child(widget.actor);
                } else {
                    widget.actor.add_style_class_name('glance-tile');
                    parent.add_child(widget.actor);
                }
                this._widgets.push(widget);
            } catch (e) {
                console.error(`[Glance Dock] could not start the ${key} widget:`, e);
            }
        }
        this._apps = this._widgets.find(w => w instanceof AppsWidget) ?? null;
        this._apps?.actor.connect('notify::width', () => this._queueFit());
        this._geometry = '';
        this._reposition();
        this._queueFit();
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const scale = this._theme.scale_factor;
        const islandHeight = Math.round(this._settings.get_int('dock-height') * scale);
        const offset = this._settings.get_int('bottom-offset');
        const below = offset >= 0 ? Math.round(offset * scale) : bottomDockHeight(monitor);
        const total = islandHeight + Math.round(GAP * scale) + below;

        const geometry = `${monitor.x},${monitor.y + monitor.height - total},${monitor.width},${total}`;
        if (geometry === this._geometry)
            return;
        this._geometry = geometry;
        this._barTop = monitor.y + monitor.height - total;
        this.actor.set_position(monitor.x, this._barTop);
        this.actor.set_size(monitor.width, total);
        if (this._hidden)
            this.actor.translation_y = total;
        this._edge.set_position(monitor.x, monitor.y + monitor.height - 1);
        this._edge.set_size(monitor.width, 1);
        this._island.height = islandHeight;
        this._placeAlert();
    }

    destroy() {
        if (this._rebuildId)
            GLib.source_remove(this._rebuildId);
        GLib.source_remove(this._followId);
        if (this._hideId)
            GLib.source_remove(this._hideId);
        if (this._fitId)
            global.compositor.get_laters().remove(this._fitId);
        this._settings.disconnect(this._autoHideId);
        this._settings.disconnect(this._settingsId);
        this._iface.disconnect(this._ifaceId);
        Main.layoutManager.disconnect(this._monitorsId);
        this._theme.disconnect(this._scaleId);
        this._widgets.forEach(w => w.destroy());
        this._widgets = [];
        Main.layoutManager.removeChrome(this._alertBin);
        this._alertBin.destroy();
        this._alert = null;
        Main.layoutManager.removeChrome(this._edge);
        this._edge.destroy();
        Main.layoutManager.untrackChrome(this._island);
        Main.layoutManager.removeChrome(this.actor);
        this.actor.remove_all_transitions();
        this.actor.destroy();
    }
}

// Hides GNOME's top bar, except in Activities (Super), where the calendar,
// Wi-Fi menu and tray icons stay reachable. A hidden bar reserves no space.
class TopBar {
    constructor(settings) {
        this._settings = settings;
        this._box = Main.layoutManager.panelBox;
        this._inOverview = Main.overview.visible;
        this._hidden = false;
        this._settingsId = settings.connect('changed::hide-top-bar', () => this._sync());
        this._overviewIds = [
            Main.overview.connect('showing', () => this._setOverview(true)),
            Main.overview.connect('hidden', () => this._setOverview(false)),
        ];
        this._sync();
    }

    _setOverview(shown) {
        this._inOverview = shown;
        this._sync();
    }

    // GNOME adds the top bar as chrome that reserves space and follows
    // fullscreen; re-adding it changes both.
    _track(hidden) {
        if (hidden === this._hidden)
            return;
        this._hidden = hidden;
        Main.layoutManager.removeChrome(this._box);
        Main.layoutManager.addChrome(this._box, {affectsStruts: !hidden, trackFullscreen: !hidden});
    }

    _sync() {
        const hide = this._settings.get_boolean('hide-top-bar');
        this._track(hide);
        this._box.visible = !hide || this._inOverview;
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        this._overviewIds.forEach(id => Main.overview.disconnect(id));
        this._track(false);
        this._box.show();
    }
}

export default class GlanceDockExtension extends Extension {
    enable() {
        const settings = this.getSettings();
        this._dock = new Dock(this, settings);
        this._topBar = new TopBar(settings);
    }

    disable() {
        this._topBar?.destroy();
        this._topBar = null;
        this._dock?.destroy();
        this._dock = null;
    }
}
