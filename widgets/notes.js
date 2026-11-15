import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {clearMenu} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {readText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const NOTE = /^- (?:(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+)?(.*)$/;
const SHOWN = 6;
const OBSIDIAN_IDS = ['obsidian.desktop', 'md.obsidian.Obsidian.desktop', 'obsidian_obsidian.desktop'];

// Quick notes, kept as "- time  text" lines in <notes folder>/Inbox.md so
// Obsidian (or any Markdown app) shows them as a normal note. Click the tile
// to jot one down; "Open in Obsidian" opens the inbox there.
export class NotesWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        const folder = ctx.settings.get_string('notes-folder').trim().replace(/^~(?=\/|$)/, GLib.get_home_dir());
        this._folder = folder || GLib.build_filenamev([GLib.get_home_dir(), 'Notes']);
        this._path = GLib.build_filenamev([this._folder, 'Inbox.md']);

        // Just an icon on the bar (it's crowded); the latest note is in the tooltip.
        this.actor = new St.Button({
            style_class: 'glance-icon-button',
            child: new St.Icon({icon_name: 'accessories-text-editor-symbolic'}),
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        addTooltip(this.actor, () => (this._menu.isOpen ? null
            : `${this._latest ? `Latest: ${this._latest}` : 'No notes yet'}\nClick to write a note (saved in ${this._path})`));

        this._menu = new PopupMenu.PopupMenu(this.actor, 0.5, St.Side.BOTTOM);
        this._menu.actor.add_style_class_name('glance-todo-menu');
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
        this._menuManager.addMenu(this._menu);
        this._menu.addMenuItem(this._entryItem());
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._list = new PopupMenu.PopupMenuSection();
        this._menu.addMenuItem(this._list);
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._obsidianItem = this._menu.addAction('Open in Obsidian', () => this._openObsidian());
        this._menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._entry.grab_key_focus();
        });
        this.actor.connect('clicked', () => this._menu.toggle(BoxPointer.PopupAnimation.FULL));

        GLib.mkdir_with_parents(this._folder, 0o755);
        this._monitor = Gio.File.new_for_path(this._path).monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._load());
        this._load();
    }

    _entryItem() {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._entry = new St.Entry({hint_text: 'Write a note and press Enter…', x_expand: true, can_focus: true});
        this._entry.clutter_text.connect('activate', () => {
            const note = this._entry.text.trim();
            if (!note)
                return;
            this._entry.text = '';
            const stamp = GLib.DateTime.new_now_local().format('%Y-%m-%d %H:%M');
            const old = readText(this._path) ?? '# Inbox\n';
            GLib.file_set_contents(this._path, `${old.replace(/\n*$/, '\n')}- ${stamp}  ${note}\n`);
            this._load();
        });
        item.add_child(this._entry);
        return item;
    }

    _load() {
        const notes = (readText(this._path) ?? '').split('\n')
            .map(line => line.match(NOTE)).filter(Boolean)
            .map(([, when, text]) => ({when, text: text.trim()})).filter(n => n.text)
            .reverse(); // newest first
        this._latest = notes[0]?.text ?? null;
        clearMenu(this._list);
        for (const note of notes.slice(0, SHOWN)) {
            const item = new PopupMenu.PopupMenuItem(note.text);
            item.label.add_style_class_name('glance-note');
            if (note.when) {
                const when = new St.Label({text: note.when.slice(5), style_class: 'glance-caption', y_align: Clutter.ActorAlign.CENTER});
                item.add_child(when);
            }
            item.connect('activate', () => this._openObsidian());
            this._list.addMenuItem(item);
        }
        this._obsidianItem.label.text = findObsidian() ? 'Open in Obsidian' : 'Obsidian not found';
    }

    // Opens the inbox in Obsidian. The obsidian:// link goes to whatever app
    // handles that scheme (only Obsidian registers it), the same path GNOME
    // uses for any link; a direct launch is the fallback. Never the default
    // Markdown app. Every step is logged, so a failure can't be silent.
    _openObsidian() {
        const ctx = global.create_app_launch_context(0, -1);
        const inVault = vaultFolders().some(v => this._folder === v || this._folder.startsWith(`${v}/`));
        const uri = `obsidian://open?path=${encodeURIComponent(this._path)}`;
        try {
            if (inVault && Gio.AppInfo.get_default_for_uri_scheme('obsidian')) {
                console.log(`[Glance Dock] notes: opening ${uri}`);
                Gio.AppInfo.launch_default_for_uri(uri, ctx);
                return;
            }
            const app = findObsidian();
            if (!app) {
                Main.notify('Obsidian not found', 'Install Obsidian, or put its AppImage in ~/Applications.');
                return;
            }
            const info = app instanceof Gio.AppInfo ? app
                : Gio.AppInfo.create_from_commandline(`"${app}"`, 'Obsidian', Gio.AppInfoCreateFlags.SUPPORTS_URIS);
            console.log(`[Glance Dock] notes: launching ${info.get_commandline()} ${inVault ? uri : ''}`);
            info.launch_uris(inVault ? [uri] : [], ctx);
        } catch (e) {
            console.error('[Glance Dock] notes: could not open Obsidian:', e);
            Main.notify('Couldn’t open Obsidian', e.message);
            return;
        }
        if (!inVault)
            Main.notify('Add your notes folder to Obsidian',
                `In Obsidian, choose “Open folder as vault” and pick ${this._folder}.`);
    }

    destroy() {
        this._monitor.cancel();
        this._menu.destroy();
        super.destroy();
    }
}

// Folders Obsidian knows as vaults, from its own settings file.
function vaultFolders() {
    try {
        const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'obsidian', 'obsidian.json']);
        return Object.values(JSON.parse(readText(path) ?? '{}').vaults ?? {}).map(v => v.path).filter(Boolean);
    } catch {
        return [];
    }
}

// An installed Obsidian (desktop entry), else an Obsidian AppImage in the usual folders.
function findObsidian() {
    for (const id of OBSIDIAN_IDS) {
        const info = Gio.DesktopAppInfo.new(id);
        if (info)
            return info;
    }
    for (const dir of ['Applications', 'Downloads', '.local/bin', 'bin']) {
        const path = GLib.build_filenamev([GLib.get_home_dir(), dir]);
        let children;
        try {
            children = Gio.File.new_for_path(path).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            continue;
        }
        let info, found = null;
        while (!found && (info = children.next_file(null))) {
            if (/^obsidian.*\.appimage$/i.test(info.get_name()))
                found = GLib.build_filenamev([path, info.get_name()]);
        }
        children.close(null);
        if (found && GLib.file_test(found, GLib.FileTest.IS_EXECUTABLE))
            return found;
    }
    return null;
}
