import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {addPopup, clearMenu, iconButton} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {readText} from '../lib/utils.js';
import {Widget} from '../lib/widget.js';

const BOOKMARKS = GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-3.0', 'bookmarks']);

// Your folders, one click away: Home plus the bookmarks in Files' sidebar
// (so editing them in Files edits this list). Each opens in Files.
export class FoldersWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this.actor = iconButton('folder-symbolic');
        this._menu = addPopup(this.actor, () => this._fill());
        addTooltip(this.actor, () => (this._menu.isOpen ? null : 'Folders\nClick for Home and your Files bookmarks'));
    }

    _fill() {
        clearMenu(this._menu);
        const home = GLib.filename_to_uri(GLib.get_home_dir(), null);
        this._add(home, 'Home', 'user-home-symbolic');
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const line of (readText(BOOKMARKS) ?? '').split('\n')) {
            const [uri, ...rest] = line.trim().split(' ');
            if (!uri || uri === home)
                continue;
            const name = rest.join(' ') || decodeURIComponent(uri.replace(/\/$/, '').split('/').pop());
            const remote = !uri.startsWith('file://');
            this._add(uri, name, remote ? 'folder-remote-symbolic' : 'folder-symbolic');
        }
    }

    _add(uri, name, icon) {
        this._menu.addAction(name, () => {
            // Files (Nautilus) explicitly; it also connects remote places like Drive.
            try {
                Gio.DesktopAppInfo.new('org.gnome.Nautilus.desktop')
                    .launch_uris([uri], global.create_app_launch_context(0, -1));
            } catch (e) {
                Main.notify('Couldn’t open the folder', e.message);
            }
        }, icon);
    }
}
