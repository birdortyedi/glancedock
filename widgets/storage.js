import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {BarStat} from '../lib/bar.js';
import {addPopup, clearMenu} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {levelFor, readText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const GB = 1024 ** 3;

// The fullest real drive as a meter. Click for a card with every drive (click
// one to see what fills it in Disk Usage Analyzer) and GNOME's disk tools:
// Disk Usage Analyzer, Disks for partitions, System Monitor's file systems.
export class StorageWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this._drives = [];
        this._stat = new BarStat('disk');
        this.actor = new St.Button({style_class: 'glance-button', child: this._stat.actor, can_focus: true});
        this._menu = addPopup(this.actor, () => this._fill());
        addTooltip(this.actor, () => (this._menu.isOpen ? null
            : `${this._drives.map(summary).join('\n')}\nClick for drives and disk tools`));
        this.every(60, () => this._update());
    }

    _update() {
        this._drives = drives();
        const top = this._drives[0];
        this.actor.visible = Boolean(top);
        if (!top)
            return;
        this._stat.set(top.used, String(Math.round(top.used * 100)), levelFor(top.used));
        this._stat.caption.text = top.path === '/' ? 'disk' : top.path.split('/').pop();
    }

    _fill() {
        this._update();
        clearMenu(this._menu);
        for (const d of this._drives) {
            const item = new PopupMenu.PopupBaseMenuItem({style_class: 'glance-drive-item'});
            const box = new St.BoxLayout({style_class: 'glance-drive', x_expand: true});
            box.layout_manager.orientation = Clutter.Orientation.VERTICAL;
            const top = new St.BoxLayout();
            top.add_child(new St.Label({text: d.path === '/' ? '/  system' : d.path, style_class: 'glance-num glance-card-title', x_expand: true}));
            top.add_child(new St.Label({text: `${(d.free / GB).toFixed(0)} GB free of ${(d.size / GB).toFixed(0)} GB`, style_class: 'glance-num glance-caption'}));
            box.add_child(top);
            const meter = new BarStat(d.dev.replace('/dev/', ''));
            meter.set(d.used, `${Math.round(d.used * 100)}%`, levelFor(d.used));
            meter.actor.add_style_class_name('glance-drive-meter');
            box.add_child(meter.actor);
            item.add_child(box);
            item.connect('activate', () => launch('org.gnome.baobab.desktop', [GLib.filename_to_uri(d.path, null)]));
            this._menu.addMenuItem(item);
        }
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._menu.addAction('Disk Usage Analyzer', () => launch('org.gnome.baobab.desktop'), 'drive-multidisk-symbolic');
        this._menu.addAction('Disks (partitions)', () => launch('org.gnome.DiskUtility.desktop'), 'drive-harddisk-symbolic');
        this._menu.addAction('System Monitor (file systems)', () => launchCommand('gnome-system-monitor -f', 'System Monitor'),
            'utilities-system-monitor-symbolic');
    }
}

function summary(d) {
    return `${d.path}: ${(d.free / GB).toFixed(0)} GB free of ${(d.size / GB).toFixed(0)} GB (${Math.round(d.used * 100)}% used)`;
}

// Real drives, fullest first.
function drives() {
    return mounts().map(({dev, path}) => {
        try {
            const info = Gio.File.new_for_path(path)
                .query_filesystem_info('filesystem::size,filesystem::free', null);
            const size = info.get_attribute_uint64('filesystem::size');
            const free = info.get_attribute_uint64('filesystem::free');
            return size ? {dev, path, size, free, used: 1 - free / size} : null;
        } catch {
            return null;
        }
    }).filter(Boolean).sort((a, b) => b.used - a.used);
}

// Mount points of real block devices, one per device, skipping boot and snap mounts.
function mounts() {
    const seen = new Set();
    const found = [];
    for (const line of (readText('/proc/mounts') ?? '').split('\n')) {
        const [dev, path] = line.split(' ');
        if (!dev?.startsWith('/dev/') || dev.startsWith('/dev/loop') || seen.has(dev) ||
            /^\/(boot|snap|var\/snap)(\/|$)/.test(path))
            continue;
        seen.add(dev);
        found.push({dev, path: path.replace(/\\040/g, ' ')});
    }
    return found;
}

function launch(id, uris = []) {
    try {
        Gio.DesktopAppInfo.new(id).launch_uris(uris, global.create_app_launch_context(0, -1));
    } catch (e) {
        Main.notify('Couldn’t open the disk tool', e.message);
    }
}

function launchCommand(command, name) {
    try {
        Gio.AppInfo.create_from_commandline(command, name, Gio.AppInfoCreateFlags.NONE)
            .launch([], global.create_app_launch_context(0, -1));
    } catch (e) {
        Main.notify(`Couldn’t open ${name}`, e.message);
    }
}
