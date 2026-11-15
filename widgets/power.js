import GObject from 'gi://GObject';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {addPopup, iconButton} from '../lib/popup.js';
import {addTooltip} from '../lib/tooltip.js';
import {Widget} from '../lib/widget.js';

// Lock, suspend, log out, restart and power off, through GNOME's own actions
// (the last three ask for confirmation, as in the top bar).
export class PowerWidget extends Widget {
    constructor(ctx) {
        super(ctx);
        this.actor = iconButton('system-shutdown-symbolic');
        const menu = addPopup(this.actor);
        addTooltip(this.actor, () => (menu.isOpen ? null : 'Lock, log out, restart or power off'));

        const actions = SystemActions.getDefault();
        const add = (label, icon, can, run) => {
            const item = menu.addAction(label, run, icon);
            actions.bind_property(can, item, 'visible', GObject.BindingFlags.SYNC_CREATE);
        };
        add('Lock', 'system-lock-screen-symbolic', 'can-lock-screen', () => actions.activateLockScreen());
        add('Suspend', 'media-playback-pause-symbolic', 'can-suspend', () => actions.activateSuspend());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        add('Log out…', 'system-log-out-symbolic', 'can-logout', () => actions.activateLogout());
        add('Restart…', 'system-reboot-symbolic', 'can-restart', () => actions.activateRestart());
        add('Power off…', 'system-shutdown-symbolic', 'can-power-off', () => actions.activatePowerOff());
    }
}
